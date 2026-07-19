import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

/* collectWorklistData() and scorePatientForStartHere()/collectStartHereItems()
   are what turn a flat patient list into the Worklist view and the "Start
   here" triage picks -- the single screen a PG on call actually works from.
   Both operate on the module-level `patients` array (a top-level `let`,
   populated normally by reloadFromCache() off IndexedDB) rather than taking
   patients as a parameter, which is why this suite needs a small trick to
   drive them at all: `patients` is a plain top-level `let` binding inside
   app.js, so (per the pattern already noted in frontend-icons test) it does
   NOT become a `window` property when the script is window.eval'd.

   The seeding has to happen via loadFrontendEnv's `initScript` option (see
   tests/helpers/frontend-env.js), appended to app.js's own source before
   the single eval call that defines it -- NOT via a separate window.eval()
   call afterwards. A second, later eval() does not share the first eval's
   top-level `let` bindings in this jsdom setup (only `window` properties --
   function declarations and `var` -- persist across separate eval calls),
   so `patients = [...]` run afterwards silently creates an unrelated
   implicit global that collectWorklistData's closure never sees. Confirmed
   this the hard way: an initial version of this suite used exactly that
   post-hoc approach and every single assertion silently saw an empty
   patient list. */

function loadWithPatients(patients){
  return loadFrontendEnv({ initScript: `patients = ${JSON.stringify(patients)};` });
}

function isoDaysAgo(n){
  // Same local-date-component construction as frontend-milestones.test.js,
  // and for the same reason: daysSince()/calcPOD() parse date strings as
  // local time (`+'T12:00:00'`/`+'T00:00:00'`), so building the string via
  // toISOString() (UTC) silently shifts it a day on this UTC+5:30 sandbox.
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('collectWorklistData — sorting patients into worklist buckets', () => {
  test('pending/abnormal investigations and pending fitness clearances are bucketed per patient', () => {
    const { window } = loadWithPatients([{
      id: 'p1', status: 'postop', bed: '1',
      investigations: [
        { name: 'X-ray', status: 'pending' },
        { name: 'Hb', status: 'abnormal', value: '8' }
      ],
      fitness: [{ dept: 'Cardiology', status: 'pending' }]
    }]);
    const w = window.collectWorklistData();
    assert.equal(w.pendingInvItems.length, 1);
    assert.equal(w.pendingInvItems[0].text, 'X-ray');
    assert.equal(w.abnormalItems.length, 1);
    assert.equal(w.abnormalItems[0].text, 'Hb — 8');
    assert.equal(w.pendingFitItems.length, 1);
    assert.equal(w.pendingFitItems[0].text, 'Cardiology');
  });

  test('a handover note puts the patient in handoverItems; hasUnitHandover reflects the ward-wide note separately', () => {
    const { window } = loadWithPatients([
      { id: 'p1', status: 'postop', bed: '1', handoverNote: '  Watch drain output  ' },
      { id: 'p2', status: 'postop', bed: '2', handoverNote: '' }
    ]);
    const w = window.collectWorklistData();
    assert.equal(w.handoverItems.length, 1);
    assert.equal(w.handoverItems[0].text, 'Watch drain output', 'trims whitespace');
    assert.equal(w.hasUnitHandover, false, 'no ward-wide handover note was set on wardMeta for this test');
  });

  test('a patient with no plan entered today lands in planMissingItems; one with a fresh plan lands in planTodayItems', () => {
    const today = isoDaysAgo(0); // matches todayISO()'s own local-date construction
    const { window } = loadWithPatients([
      { id: 'p1', status: 'postop', bed: '1', dailyPlan: 'Mobilize, wound check', dailyPlanDate: today },
      { id: 'p2', status: 'postop', bed: '2' },
      { id: 'p3', status: 'postop', bed: '3', dailyPlan: 'Old plan', dailyPlanDate: '2020-01-01' }
    ]);
    const w = window.collectWorklistData();
    assert.deepEqual([...w.planTodayItems.map(it => it.p.id)], ['p1']);
    const missingIds = [...w.planMissingItems.map(it => it.p.id)].sort();
    assert.deepEqual(missingIds, ['p2', 'p3']);
    const p3Item = w.planMissingItems.find(it => it.p.id === 'p3');
    assert.match(p3Item.text, /Plan outdated/, 'a stale plan (not today) is called out as outdated, not just "no plan"');
    const p2Item = w.planMissingItems.find(it => it.p.id === 'p2');
    assert.equal(p2Item.text, 'No plan entered for today');
  });

  test('post-op milestone checks bucket into overdue/due/upcoming using the real clinical-day math', () => {
    const { window } = loadWithPatients([{
      id: 'p1', status: 'postop', bed: '1', surgeryDate: isoDaysAgo(5), // POD 5
      postOpChecks: [
        { id: 'c1', label: 'Dressing check', status: 'pending', duePod: 1, duePodEnd: 2 }, // overdue
        { id: 'c2', label: 'Suture removal', status: 'pending', duePod: 4, duePodEnd: 6 },  // due
        { id: 'c3', label: 'Staple removal', status: 'pending', duePod: 7 }                  // upcoming (within 2)
      ]
    }]);
    const w = window.collectWorklistData();
    assert.equal(w.postOpOverdueItems.length, 1);
    assert.match(w.postOpOverdueItems[0].text, /Dressing check \(overdue\)/);
    assert.equal(w.postOpDueItems.length, 1);
    assert.equal(w.postOpDueItems[0].text, 'Suture removal');
    assert.equal(w.postOpUpcomingItems.length, 1);
    assert.match(w.postOpUpcomingItems[0].text, /Staple removal \(upcoming\)/);
  });

  test('discharge checklist: incomplete required items bucket the patient, a fully-cleared one is "ready for discharge"', () => {
    const { window } = loadWithPatients([
      {
        id: 'p1', status: 'fordischarge', bed: '1',
        dischargeChecks: [
          { label: 'Physio sign-off', status: 'pending', required: true },
          { label: 'Optional note', status: 'pending', required: false }
        ]
      },
      {
        id: 'p2', status: 'fordischarge', bed: '2',
        investigations: [], fitness: [],
        dischargeChecks: [{ label: 'Physio sign-off', status: 'done', required: true }]
      }
    ]);
    const w = window.collectWorklistData();
    assert.equal(w.dischargeIncompleteItems.length, 1);
    assert.equal(w.dischargeIncompleteItems[0].text, 'Physio sign-off', 'only the required+pending item is listed, not the optional one');
    assert.equal(w.readyForDischarge.length, 1);
    assert.equal(w.readyForDischarge[0].p.id, 'p2');
  });

  test('abnormal labs (Hb low, CRP high) are flagged; a normal value for the same patient is not', () => {
    const { window } = loadWithPatients([{
      id: 'p1', status: 'postop', bed: '1',
      labs: { hb: '8', crp: '15', wcc: '7000' } // hb below 12 low threshold, crp above 10 high threshold, wcc normal
    }]);
    const w = window.collectWorklistData();
    const keys = [...w.labAbnormalItems.map(it => it.labKey)].sort();
    assert.deepEqual(keys, ['crp', 'hb'], 'wcc 7000 is within range and should not be flagged');
  });

  test('antibiotic course status buckets: overdue, last-day, and ending-soon go to their own lists', () => {
    const { window } = loadWithPatients([
      { id: 'p1', status: 'postop', bed: '1', antibioticCourses: [{ id: 'a1', name: 'Ceftriaxone', start: isoDaysAgo(1), days: 1, stoppedDate: '' }] }, // day 2/1 -> overdue
      { id: 'p2', status: 'postop', bed: '2', antibioticCourses: [{ id: 'a2', name: 'Augmentin', start: isoDaysAgo(0), days: 1, stoppedDate: '' }] },   // day 1/1 -> last_day
      { id: 'p3', status: 'postop', bed: '3', antibioticCourses: [{ id: 'a3', name: 'Metronidazole', start: isoDaysAgo(0), days: 2, stoppedDate: '' }] } // day 1/2 -> ending_soon
    ]);
    const w = window.collectWorklistData();
    assert.equal(w.abxOverdueItems.length, 1);
    assert.match(w.abxOverdueItems[0].text, /Ceftriaxone/);
    assert.equal(w.abxOverdueItems[0].abxAction, 'stop');
    assert.equal(w.abxLastDayItems.length, 1);
    assert.match(w.abxLastDayItems[0].text, /Augmentin/);
    assert.equal(w.abxEndingSoonItems.length, 1);
    assert.match(w.abxEndingSoonItems[0].text, /Metronidazole/);
  });

  test('a stopped antibiotic course never appears in any active bucket', () => {
    const { window } = loadWithPatients([{
      id: 'p1', status: 'postop', bed: '1',
      antibioticCourses: [{ id: 'a1', name: 'Ceftriaxone', start: isoDaysAgo(1), days: 1, stoppedDate: isoDaysAgo(0) }]
    }]);
    const w = window.collectWorklistData();
    assert.equal(w.abxOverdueItems.length, 0);
    assert.equal(w.abxLastDayItems.length, 0);
    assert.equal(w.abxEndingSoonItems.length, 0);
  });

  test('discharged patients are excluded from the worklist entirely', () => {
    const { window } = loadWithPatients([
      { id: 'p1', status: 'discharged', bed: '1', investigations: [{ name: 'X-ray', status: 'pending' }] },
      { id: 'p2', status: 'postop', bed: '2', investigations: [{ name: 'CT', status: 'pending' }] }
    ]);
    const w = window.collectWorklistData();
    assert.equal(w.pendingInvItems.length, 1);
    assert.equal(w.pendingInvItems[0].p.id, 'p2');
  });

  test('items within a bucket sort by bed number, numerically not lexicographically', () => {
    const { window } = loadWithPatients([
      { id: 'p1', status: 'postop', bed: '10', handoverNote: 'note ten' },
      { id: 'p2', status: 'postop', bed: '2', handoverNote: 'note two' }
    ]);
    const w = window.collectWorklistData();
    assert.deepEqual([...w.handoverItems.map(it => it.p.bed)], ['2', '10'], 'bed "2" must sort before "10" (numeric), not after (lexicographic)');
  });

  test('PG scope "mine" filters the whole worklist down to the logged-in PG\'s own patients', () => {
    const { window } = loadWithPatients([
      { id: 'p1', status: 'postop', bed: '1', assignedPg: 'DRX', handoverNote: 'mine' },
      { id: 'p2', status: 'postop', bed: '2', assignedPg: 'DRY', handoverNote: 'not mine' }
    ]);
    window.localStorage.setItem('ortho_username', 'drx');
    window.localStorage.setItem('ortho_pgScope', 'mine');
    const w = window.collectWorklistData();
    assert.deepEqual([...w.handoverItems.map(it => it.p.id)], ['p1']);
  });
});

describe('scorePatientForStartHere — single-patient urgency ranking', () => {
  test('returns null for a patient below the minimum score (nothing notable at all)', () => {
    const { window } = loadFrontendEnv();
    const today = window.todayISO();
    assert.equal(window.scorePatientForStartHere({ id: 'p1', status: 'postop', dailyPlan: 'Fine', dailyPlanDate: today }), null);
  });

  test('an overdue antibiotic stop outranks a handover pin, which outranks an overdue post-op check', () => {
    const { window } = loadFrontendEnv();
    const abxOverdue = window.scorePatientForStartHere({
      id: 'p1', status: 'postop',
      antibioticCourses: [{ id: 'a1', name: 'Abx', start: isoDaysAgo(1), days: 1, stoppedDate: '' }]
    });
    const handover = window.scorePatientForStartHere({ id: 'p2', status: 'postop', handoverPin: 'Call reg if fever' });
    const overduePostop = window.scorePatientForStartHere({
      id: 'p3', status: 'postop', surgeryDate: isoDaysAgo(5),
      postOpChecks: [{ id: 'c1', label: 'Dressing', status: 'pending', duePod: 1, duePodEnd: 2 }]
    });
    assert.ok(abxOverdue.score > handover.score, 'antibiotic-stop-overdue (100) must outrank a handover pin (90)');
    assert.ok(handover.score > overduePostop.score, 'handover pin (90) must outrank overdue post-op (85)');
    assert.match(abxOverdue.text, /Antibiotics stop overdue/);
    assert.match(handover.text, /Call reg if fever/, 'the pin text itself is surfaced, not a generic label');
  });

  test('the surfaced text is always the single highest-scoring reason, even with several reasons present', () => {
    const { window } = loadFrontendEnv();
    const today = window.todayISO();
    const result = window.scorePatientForStartHere({
      id: 'p1', status: 'postop',
      dailyPlan: '', dailyPlanDate: today, // would score 40 alone, but...
      handoverPin: 'Urgent review', // ...this scores 90 and should win
      investigations: [{ name: 'CT', status: 'pending' }] // this only scores 30
    });
    assert.equal(result.score, 90);
    assert.match(result.text, /Urgent review/);
  });
});

describe('collectStartHereItems — the top-3 triage list', () => {
  test('ranks by score descending, caps at 3, and numbers rank 1..3', () => {
    const { window } = loadWithPatients([
      { id: 'p1', status: 'postop', bed: '1', handoverPin: 'pin1' }, // score 90
      { id: 'p2', status: 'postop', bed: '2', antibioticCourses: [{ id: 'a', name: 'Abx', start: isoDaysAgo(1), days: 1, stoppedDate: '' }] }, // score 100
      { id: 'p3', status: 'postop', bed: '3', surgeryDate: isoDaysAgo(5), postOpChecks: [{ id: 'c', label: 'X', status: 'pending', duePod: 1, duePodEnd: 2 }] }, // score 85
      { id: 'p4', status: 'postop', bed: '4', investigations: [{ name: 'CT', status: 'pending' }] } // score 30, should be cut (only top 3 kept)
    ]);
    const items = window.collectStartHereItems();
    assert.equal(items.length, 3, 'START_HERE_LIMIT is 3');
    assert.deepEqual([...items.map(it => it.p.id)], ['p2', 'p1', 'p3'], 'highest score first');
    assert.deepEqual([...items.map(it => it.rank)], [1, 2, 3]);
  });

  test('a tie in score falls back to bed number, numerically', () => {
    const { window } = loadWithPatients([
      { id: 'p1', status: 'postop', bed: '10', handoverPin: 'pin A' },
      { id: 'p2', status: 'postop', bed: '2', handoverPin: 'pin B' }
    ]);
    const items = window.collectStartHereItems();
    assert.deepEqual([...items.map(it => it.p.bed)], ['2', '10']);
  });

  test('a discharged patient never appears, no matter how urgent their old flags look', () => {
    const { window } = loadWithPatients([
      { id: 'p1', status: 'discharged', bed: '1', antibioticCourses: [{ id: 'a', name: 'Abx', start: isoDaysAgo(1), days: 1, stoppedDate: '' }] }
    ]);
    assert.deepEqual([...window.collectStartHereItems()], []);
  });
});
