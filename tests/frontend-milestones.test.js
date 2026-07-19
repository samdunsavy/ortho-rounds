import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

/* milestones.js (628 lines) had zero automated tests, same as app.js —
   but unlike most of app.js, this file is almost entirely pure clinical
   calculation: what post-op day a patient is on, and whether a milestone
   (dressing check, suture removal, etc.) counts as overdue, due, or
   upcoming. This is the logic that decides what a PG sees as "urgent" on
   the worklist and on each patient card — a bug here has real clinical
   consequence, not just a visual one, which makes it the highest-value
   next slice of coverage per POLISH.md Priority 1.

   Date math uses "today" computed at test time (not hardcoded calendar
   dates), so these stay valid regardless of when the suite runs. */

function isoDaysAgo(n){
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - n);
  // calcPOD parses "YYYY-MM-DDT00:00:00" (no zone suffix) as *local* time,
  // and compares it against local midnight today — so this must build the
  // date string from local getFullYear/getMonth/getDate, not
  // toISOString() (which converts to UTC first). In any timezone east of
  // UTC that mismatch silently shifts the date by a day and produces an
  // off-by-one in every test — which is exactly what happened here before
  // this fix, on a UTC+5:30 system.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('calcPOD — post-op day arithmetic', () => {
  test('returns null with no date', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.calcPOD(null), null);
    assert.equal(window.calcPOD(''), null);
  });

  test('surgery today is POD 0', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.calcPOD(isoDaysAgo(0)), 0);
  });

  test('surgery N days ago is POD N', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.calcPOD(isoDaysAgo(1)), 1);
    assert.equal(window.calcPOD(isoDaysAgo(5)), 5);
    assert.equal(window.calcPOD(isoDaysAgo(30)), 30);
  });

  test('a future surgery date gives a negative POD', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.calcPOD(isoDaysAgo(-3)), -3);
  });
});

describe('getPatientPod — which date field counts, by status', () => {
  test('postop/fordischarge use surgeryDate', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.getPatientPod({ status: 'postop', surgeryDate: isoDaysAgo(2) }), 2);
    assert.equal(window.getPatientPod({ status: 'fordischarge', surgeryDate: isoDaysAgo(7) }), 7);
  });

  test('conservative uses admissionDate, not surgeryDate', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.getPatientPod({ status: 'conservative', admissionDate: isoDaysAgo(4), surgeryDate: isoDaysAgo(99) }), 4);
  });

  test('preop has no clinical day at all', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.getPatientPod({ status: 'preop', surgeryDate: isoDaysAgo(2) }), null);
  });

  test('postop with no surgeryDate on file returns null rather than throwing', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.getPatientPod({ status: 'postop' }), null);
    assert.equal(window.getPatientPod(null), null);
  });
});

describe('milestoneDayPrefix — "Day" vs "POD" label', () => {
  test('conservative patients are labeled by Day, everyone else by POD', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.milestoneDayPrefix({ status: 'conservative' }), 'Day');
    assert.equal(window.milestoneDayPrefix({ status: 'postop' }), 'POD');
    assert.equal(window.milestoneDayPrefix({ status: 'preop' }), 'POD');
  });
});

describe('isItemOverdue / isItemInDueWindow / isItemUpcoming — milestone bucketing', () => {
  test('a done item is never overdue, due, or upcoming, no matter the date math', () => {
    const { window } = loadFrontendEnv();
    const done = { status: 'done', duePod: 0, duePodEnd: 0 };
    assert.equal(window.isItemOverdue(done, 10), false);
    assert.equal(window.isItemInDueWindow(done, 0), false);
    assert.equal(window.isItemUpcoming(done, -5), false);
  });

  test('open-ended items (no duePodEnd) are never "overdue" by design, only "due" once reached', () => {
    const { window } = loadFrontendEnv();
    const openEnded = { status: 'pending', duePod: 2 };
    assert.equal(window.isItemOverdue(openEnded, 100), false, 'no end date means it cannot be overdue');
    assert.equal(window.isItemInDueWindow(openEnded, 1), false, 'not due yet before duePod');
    assert.equal(window.isItemInDueWindow(openEnded, 2), true, 'due exactly on duePod');
    assert.equal(window.isItemInDueWindow(openEnded, 5), true, 'stays "due" indefinitely past duePod with no end');
  });

  test('a windowed item (duePod..duePodEnd) is overdue only strictly after the end', () => {
    const { window } = loadFrontendEnv();
    const windowed = { status: 'pending', duePod: 2, duePodEnd: 4 };
    assert.equal(window.isItemInDueWindow(windowed, 1), false);
    assert.equal(window.isItemInDueWindow(windowed, 2), true);
    assert.equal(window.isItemInDueWindow(windowed, 4), true, 'boundary: still due exactly at duePodEnd');
    assert.equal(window.isItemOverdue(windowed, 4), false, 'boundary: not yet overdue at duePodEnd itself');
    assert.equal(window.isItemOverdue(windowed, 5), true, 'overdue the day after duePodEnd');
  });

  test('an exactPod item is only ever due on that exact day, not a range', () => {
    const { window } = loadFrontendEnv();
    const exact = { status: 'pending', duePod: 3, exactPod: true };
    assert.equal(window.isItemInDueWindow(exact, 2), false);
    assert.equal(window.isItemInDueWindow(exact, 3), true);
    assert.equal(window.isItemInDueWindow(exact, 4), false, 'exactPod does not stay due after the day passes');
  });

  test('upcoming only fires within the window before duePod, not further out', () => {
    const { window } = loadFrontendEnv();
    const item = { status: 'pending', duePod: 5 };
    assert.equal(window.isItemUpcoming(item, 3, 2), true, '2 days before due, within a 2-pod window');
    assert.equal(window.isItemUpcoming(item, 2, 2), false, '3 days before due is outside a 2-pod window');
    assert.equal(window.isItemUpcoming(item, 5, 2), false, 'due today is "due", not "upcoming"');
  });
});

describe('getMilestoneBuckets — end-to-end bucketing for a real patient shape', () => {
  test('sorts a mixed set of postOpChecks into overdue/due/upcoming correctly', () => {
    const { window } = loadFrontendEnv();
    const patient = {
      status: 'postop',
      surgeryDate: isoDaysAgo(5), // POD 5
      postOpChecks: [
        { id: 'c1', status: 'pending', duePod: 1, duePodEnd: 2 },   // overdue (POD 5 > 2)
        { id: 'c2', status: 'pending', duePod: 4, duePodEnd: 6 },   // due (4 <= 5 <= 6)
        { id: 'c3', status: 'pending', duePod: 7 },                 // upcoming (7-5=2, within default window)
        { id: 'c4', status: 'done', duePod: 1, duePodEnd: 1 },      // done — excluded entirely
      ]
    };
    const buckets = window.getMilestoneBuckets(patient);
    // getMilestoneBuckets runs inside the jsdom window's realm, so its
    // arrays are instances of *that* window's Array, not this test file's —
    // structurally identical but assert.deepEqual treats them as
    // non-equal without the spread, since it (correctly) checks
    // prototype/constructor identity, not just enumerable content.
    assert.deepEqual([...buckets.overdue.map(c=>c.id)], ['c1']);
    assert.deepEqual([...buckets.due.map(c=>c.id)], ['c2']);
    assert.deepEqual([...buckets.upcoming.map(c=>c.id)], ['c3']);
  });

  test('a patient with no clinical day (e.g. pre-op) buckets everything as empty, not throwing', () => {
    const { window } = loadFrontendEnv();
    const patient = { status: 'preop', postOpChecks: [{ id: 'c1', status: 'pending', duePod: 1, duePodEnd: 2 }] };
    const buckets = window.getMilestoneBuckets(patient);
    assert.deepEqual(
      { overdue: [...buckets.overdue], due: [...buckets.due], upcoming: [...buckets.upcoming] },
      { overdue: [], due: [], upcoming: [] }
    );
  });
});
