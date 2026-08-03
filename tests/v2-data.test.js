import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadV2Module } from './helpers/v2-env.js';

const { toViewModel, fetchWard, fetchDischarged, extractDefaultUnit } = await loadV2Module('data.js');

const base = {
  id:'p1', bed:'12', name:'R. Kumar', age:'62', sex:'M', uhid:'MH-1',
  admissionDate:'2026-07-29', surgeryDate:'2026-07-29', surgeon:'Dr Menon',
  unit:'Unit II', diagnosis:'IT femur fracture', procedure:'PFN',
  status:'postop', dailyPlan:'', images:[], postOpChecks:[], dischargeChecks:[],
  planHistory:[], labs:{}
};
const deps = { getPatientPod: () => 4, isItemOverdue: () => false };

test('maps identity fields onto the view model', () => {
  const v = toViewModel(base, deps);
  assert.equal(v.bed, '12');
  assert.equal(v.name, 'R. Kumar');
  assert.equal(v.age, '62/M');
  assert.equal(v.dx, 'IT femur fracture');
  assert.equal(v.pod, 4);
  assert.equal(v.stat, 'Post-op');
});

test('missing name and diagnosis get explicit fallbacks, never blank', () => {
  const v = toViewModel({ ...base, name:'', diagnosis:'' }, deps);
  assert.equal(v.name, 'Unnamed');
  assert.equal(v.dx, 'Diagnosis not entered');
});

test('age without sex renders without a trailing slash', () => {
  const v = toViewModel({ ...base, sex:'' }, deps);
  assert.equal(v.age, '62');
});

test('films carry both the image type and a ready-to-use <img> src', () => {
  const store = { getItem: k => k === 'ortho_token' ? 'TK' : null };
  const v = toViewModel({ ...base, images:[
    { type:'preop',  url:'/api/images/a1.jpg' },
    { type:'postop', url:'/api/images/b2.jpg' }
  ]}, deps, store);
  assert.deepEqual(v.films.map(f => f.type), ['preop','postop']);
  // <img> cannot send an Authorization header, so the token rides the
  // query string — the same mechanism public/app.js:3340-3350 uses.
  assert.equal(v.films[0].src, '/api/images/a1.jpg?token=TK');
  assert.equal(v.films[1].src, '/api/images/b2.jpg?token=TK');
});

test('an image with no url yields a null src, never a broken image', () => {
  const store = { getItem: () => 'TK' };
  const v = toViewModel({ ...base, images:[{ type:'preop' }] }, deps, store);
  assert.equal(v.films[0].type, 'preop');
  assert.equal(v.films[0].src, null);
});

test('with no token an image src is null rather than an unauthorised request', () => {
  const v = toViewModel({ ...base, images:[{ type:'preop', url:'/api/images/a1.jpg' }] },
    deps, { getItem: () => null });
  assert.equal(v.films[0].src, null);
});

test('no images yields an empty films array, not undefined', () => {
  assert.deepEqual(toViewModel(base, deps).films, []);
});

test('track marks the current POD station and ends at discharge when known', () => {
  const v = toViewModel({ ...base, expectedDischargeDate:'2026-08-08' }, deps);
  assert.equal(v.track.at(-1)[0], 'discharge');
  assert.equal(v.track.filter(t => t[2] === 'now').length, 1);
});

test('track terminates at the last milestone when no discharge date exists', () => {
  const v = toViewModel({ ...base,
    postOpChecks:[{label:'Suture removal', duePod:12, status:'pending'}] }, deps);
  assert.notEqual(v.track.at(-1)[0], 'discharge');
});

test('track percentages are ordered and bounded', () => {
  const v = toViewModel({ ...base, expectedDischargeDate:'2026-08-08' }, deps);
  const pcts = v.track.map(t => t[1]);
  assert.deepEqual(pcts, [...pcts].sort((a,b)=>a-b));
  assert.ok(pcts[0] >= 0 && pcts.at(-1) <= 100);
});

test('pre-op patient has null pod and a pre-op track', () => {
  const v = toViewModel({ ...base, status:'preop', surgeryDate:'' },
    { ...deps, getPatientPod: () => null });
  assert.equal(v.pod, null);
  assert.equal(v.track[0][0], 'admit');
});

test('overdue checklist item becomes a bad flag', () => {
  const v = toViewModel({ ...base,
    postOpChecks:[{ id:'s', label:'Suture removal', duePod:2, status:'pending' }] },
    { ...deps, isItemOverdue: () => true });
  assert.ok(v.flags.some(f => f[0] === 'bad' && /Suture removal/.test(f[1])));
});

test('missing plan for today becomes a warn flag', () => {
  const v = toViewModel({ ...base, dailyPlan:'' }, deps);
  assert.ok(v.flags.some(f => f[0] === 'warn' && /plan/i.test(f[1])));
});

test('fetchWard posts a full-resync body and returns normalised patients', async () => {
  let sent = null;
  const fake = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) };
    return { ok:true, json: async () => ({ serverTime: 99, patients: [base] }) }; };
  const out = await fetchWard(fake);
  assert.equal(sent.url, '/api/sync');
  assert.equal(sent.body.since, 0);
  assert.deepEqual(sent.body.changes, []);
  assert.equal(out.serverTime, 99);
  assert.equal(out.patients[0].name, 'R. Kumar');
});

test('fetchWard rejects with a readable message on a failed response', async () => {
  const fake = async () => ({ ok:false, status:401, json: async () => ({}) });
  await assert.rejects(() => fetchWard(fake), /401/);
});

/* Task 7: surgeryDate/theatreTime are the raw (unformatted) fields the
   OT list filter needs — public/app.js:1530's getOtListPatients() filters
   on `p.status === 'preop' && p.surgeryDate === date`, which requires the
   raw ISO date, not the pre-formatted `proc` string. */
test('surgeryDate and theatreTime are carried onto the view model, unformatted', () => {
  const v = toViewModel({ ...base, surgeryDate:'2026-08-02', theatreTime:'11:00' }, deps);
  assert.equal(v.surgeryDate, '2026-08-02');
  assert.equal(v.theatreTime, '11:00');
});

test('surgeryDate and theatreTime default to empty string when absent, never undefined', () => {
  const { surgeryDate, theatreTime, ...rest } = base;
  const v = toViewModel(rest, deps);
  assert.equal(v.surgeryDate, '');
  assert.equal(v.theatreTime, '');
});

/* ── Finding 2 (Fix round 1): otOrder, carried through raw — the main app
   applies Number(x.otOrder) || 0 at comparator time (public/app.js:1538),
   not at storage time, so the view model must carry the raw value
   unconverted and let render.js's otList apply the same coercion. */
test('otOrder is carried onto the view model unformatted, raw', () => {
  const v = toViewModel({ ...base, otOrder: 3 }, deps);
  assert.equal(v.otOrder, 3);
});

test('otOrder is undefined on the view model when absent from the raw record, not coerced to 0', () => {
  const v = toViewModel(base, deps);
  assert.equal(v.otOrder, undefined);
});

/* ── Minor (authorised, Fix round 1): admissionDate/dischargeDate, raw
   ISO, needed for the discharged archive's real date + length-of-stay
   columns. */
test('admissionDate and dischargeDate are carried onto the view model as raw ISO strings', () => {
  const v = toViewModel({ ...base, admissionDate:'2026-07-10', dischargeDate:'2026-07-20' }, deps);
  assert.equal(v.admissionDate, '2026-07-10');
  assert.equal(v.dischargeDate, '2026-07-20');
});

test('admissionDate and dischargeDate default to empty string when absent, never undefined', () => {
  const { admissionDate, dischargeDate, ...rest } = base;
  const v = toViewModel(rest, deps);
  assert.equal(v.admissionDate, '');
  assert.equal(v.dischargeDate, '');
});

test('fetchDischarged keeps only discharged patients, sorted by discharge date descending', async () => {
  const raw = [
    { ...base, id:'a', status:'discharged', dischargeDate:'2026-07-20' },
    { ...base, id:'b', status:'postop' },
    { ...base, id:'c', status:'discharged', dischargeDate:'2026-07-30' },
    { ...base, id:'d', status:'discharged' }
  ];
  const fake = async () => ({ ok:true, json: async () => ({ serverTime: 5, patients: raw }) });
  const out = await fetchDischarged(fake);
  assert.deepEqual(out.patients.map(p => p.id), ['c', 'a', 'd']);
  assert.equal(out.serverTime, 5);
});

test('fetchDischarged rejects with a readable message on a failed response', async () => {
  const fake = async () => ({ ok:false, status:500, json: async () => ({}) });
  await assert.rejects(() => fetchDischarged(fake), /500/);
});

/* ── Finding 1 (Fix round 1): where v2 gets the default unit.
   public/app.js's getDefaultUnit() reads wardMeta.defaultUnit, which is
   NOT in localStorage — it's a record (id "__ward_meta__") synced through
   the same /api/sync endpoint as every patient (see public/app.js:3379-
   3385's saveWardMeta -> cachePut -> scheduleSync, and server.js's sync
   handler, which treats it as an ordinary row keyed by that id). Since
   v2's fetchWard()/fetchDischarged() already POST /api/sync and get this
   record back in the same response, extractDefaultUnit() reads it
   straight from that already-fetched raw array: no new fetch, no
   localStorage, no IndexedDB. See task-7-report.md "Fix round 1" for
   the full trace and for why the record is deliberately left in the raw
   list this function reads, rather than filtered out here. */
test('extractDefaultUnit reads defaultUnit off the ward-meta record within a raw sync response', () => {
  const list = [base, { id:'__ward_meta__', defaultUnit:'Unit II' }];
  assert.equal(extractDefaultUnit(list), 'Unit II');
});

test('extractDefaultUnit returns empty string when no ward-meta record is present', () => {
  assert.equal(extractDefaultUnit([base]), '');
});

test('extractDefaultUnit trims whitespace and returns empty string for a blank defaultUnit', () => {
  assert.equal(extractDefaultUnit([{ id:'__ward_meta__', defaultUnit:'  IV  ' }]), 'IV');
  assert.equal(extractDefaultUnit([{ id:'__ward_meta__', defaultUnit:'' }]), '');
});

/* ── Task 8 MUST FIX: the ward-meta record has no `status` field, so
   `p.status !== 'discharged'` in fetchWard is trivially true for it and
   it would otherwise pass through as a phantom "Unnamed" patient at bed
   "—" — visible in the ward list, the spine and the round. Mirrors how
   public/app.js:1824-1830 special-cases this same id. */
test('fetchWard excludes the ward-meta record from its patients list', async () => {
  const raw = [
    { ...base, id:'a' },
    { id:'__ward_meta__', defaultUnit:'Unit II' }
  ];
  const fake = async () => ({ ok:true, json: async () => ({ serverTime: 1, patients: raw }) });
  const out = await fetchWard(fake);
  assert.deepEqual(out.patients.map(p => p.id), ['a']);
});

test('fetchDischarged excludes the ward-meta record from its patients list', async () => {
  const raw = [
    { ...base, id:'a', status:'discharged', dischargeDate:'2026-07-20' },
    { id:'__ward_meta__', defaultUnit:'Unit II' }
  ];
  const fake = async () => ({ ok:true, json: async () => ({ serverTime: 1, patients: raw }) });
  const out = await fetchDischarged(fake);
  assert.deepEqual(out.patients.map(p => p.id), ['a']);
});

test('loadV2Module can be called twice in the same process without crashing', async () => {
  const first = await loadV2Module('data.js');
  const second = await loadV2Module('data.js');
  assert.equal(typeof first.toViewModel, 'function');
  assert.equal(typeof second.toViewModel, 'function');
  const v1 = first.toViewModel(base, deps);
  const v2 = second.toViewModel(base, deps);
  assert.equal(v1.bed, '12');
  assert.equal(v2.bed, '12');
});

/* ══════════════════════════════════════════════════════════════════
   Final whole-branch review — B3(b) and the data-side should-fix items.
   ══════════════════════════════════════════════════════════════════ */

const todayISOForTest = () => {
  const d = new Date();
  const q = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${q(d.getMonth()+1)}-${q(d.getDate())}`;
};
const hasNoPlanFlag = v => v.flags.some(f => /no plan/i.test(f[1]));

/* ── B3(b): the "plan today" flag can never clear ──
   data.js compared String(planUpdatedAt).slice(0,10) — an epoch NUMBER —
   against todayISO(), which can never match, so every patient carried
   the warning forever and the Work view listed the whole ward. The main
   app's rule is hasPlanToday() at public/app.js:4398:
   `!!(p.dailyPlan && p.dailyPlanDate === todayISO())`. */
test('a plan entered today clears the no-plan warning', () => {
  const v = toViewModel({ ...base, dailyPlan:'Mobilise', dailyPlanDate: todayISOForTest() }, deps);
  assert.ok(!hasNoPlanFlag(v), 'a patient planned today must not be flagged as unplanned');
  assert.ok(v.flags.some(f => f[0] === 'ok'), 'with nothing else outstanding the patient reads as ok');
});

test('a plan from an earlier day still warns', () => {
  const v = toViewModel({ ...base, dailyPlan:'Mobilise', dailyPlanDate:'2026-01-01' }, deps);
  assert.ok(hasNoPlanFlag(v));
});

test('an epoch planUpdatedAt is never mistaken for a date', () => {
  const v = toViewModel({ ...base, dailyPlan:'Mobilise', planUpdatedAt: Date.now() }, deps);
  assert.ok(hasNoPlanFlag(v), 'planUpdatedAt is a timestamp, not the dailyPlanDate the main app reads');
});

/* ── should-fix: conservative patients are not post-operative ──
   deps is omitted deliberately so the REAL public/milestones.js
   functions (loaded onto globalThis by loadV2Module) decide, rather
   than a stub that could encode the wrong rule. */
test('a conservative patient carries a Day prefix and an admission-anchored track', () => {
  const v = toViewModel({ ...base, status:'conservative', surgeryDate:'', admissionDate:'2026-07-30' });
  assert.equal(v.dayPrefix, 'Day', 'milestoneDayPrefix decides this, not v2');
  assert.ok(/^Day \d+$/.test(v.podLabel), `expected a Day label, got ${v.podLabel}`);
  assert.notEqual(v.track[0][0], 'op', 'a never-operated patient has no operation station');
  assert.ok(!v.track.some(t => /^POD /.test(t[0])), 'no track station may say POD');
});

test('a post-op patient keeps the POD prefix', () => {
  const v = toViewModel({ ...base, status:'postop', surgeryDate:'2026-07-30' });
  assert.equal(v.dayPrefix, 'POD');
  assert.ok(/^POD \d+$/.test(v.podLabel));
  assert.equal(v.track[0][0], 'op');
});

/* ── should-fix: buildTrack divide-by-zero ──
   A mistyped future surgery date yields a negative POD; span collapsed
   to 0 and produced width:NaN%. */
test('a negative POD from a mistyped future surgery date never yields a NaN track position', () => {
  const v = toViewModel({ ...base,
    postOpChecks:[{ id:'m1', label:'Drain out', duePod:0, status:'pending' }] },
    { ...deps, getPatientPod: () => -3 });
  for(const [label, pct] of v.track){
    assert.ok(Number.isFinite(pct), `station "${label}" has a non-finite position: ${pct}`);
    assert.ok(pct >= 0 && pct <= 100, `station "${label}" is out of bounds: ${pct}`);
  }
});

/* ── B1 support: the view model must expose each checklist item's stable
   id so render.js can address it by id rather than by list position. ── */
test('checklist view models carry the raw item id', () => {
  const v = toViewModel({ ...base,
    postOpChecks:[{ id:'chk_a', label:'Suture removal', duePod:12, status:'pending' }],
    dischargeChecks:[{ id:'dc_a', label:'Summary', status:'done' }] }, deps);
  assert.equal(v.checks[0][3], 'chk_a');
  assert.equal(v.dc[0][2], 'dc_a');
});

/* ── Authentication ──────────────────────────────────────────────────────
   This app authenticates with a Bearer token from localStorage, NOT a
   session cookie. v2 originally sent only `credentials: 'same-origin'`,
   so every request was unauthenticated, /api/sync returned 401, and the
   ward was permanently empty while the main app at / showed patients
   normally. No test caught it because every test stubbed fetch. */

test('fetchWard sends the main app\'s Bearer token', async () => {
  const { fetchWard: fw } = await loadV2Module('data.js');
  let sentAuth = null;
  const fake = async (url, opts) => { sentAuth = opts.headers.Authorization;
    return { ok: true, status: 200, json: async () => ({ serverTime: 1, patients: [] }) }; };
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: k => k === 'ortho_token' ? 'TKN' : null };
  try { await fw(fake); } finally { globalThis.localStorage = prev; }
  assert.equal(sentAuth, 'Bearer TKN');
});

test('the token key matches the one public/app.js writes', async () => {
  const { LS_TOKEN } = await loadV2Module('data.js');
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(appJs, new RegExp(`LS_TOKEN\\s*=\\s*["']${LS_TOKEN}["']`),
    'v2 must read the same localStorage key the main client writes');
});

test('a 401 raises a signed-out error rather than an empty ward', async () => {
  const { fetchWard: fw } = await loadV2Module('data.js');
  const fake = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(() => fw(fake), /401.*not signed in/);
});

test('soft-deleted records never reach the ward or the archive', async () => {
  const { fetchWard: fw, fetchDischarged: fd } = await loadV2Module('data.js');
  const rows = [
    { ...base, id: 'live' },
    { ...base, id: 'gone', deleted: true },
    { ...base, id: 'goneDc', deleted: true, status: 'discharged' },
    { ...base, id: 'dc', status: 'discharged' }
  ];
  const fake = async () => ({ ok: true, status: 200,
    json: async () => ({ serverTime: 1, patients: rows }) });
  assert.deepEqual((await fw(fake, deps)).patients.map(p => p.id), ['live']);
  assert.deepEqual((await fd(fake, deps)).patients.map(p => p.id), ['dc']);
});
