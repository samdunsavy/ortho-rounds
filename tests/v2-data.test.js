import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('films list is derived from images', () => {
  const v = toViewModel({ ...base, images:[{type:'preop'},{type:'postop'}] }, deps);
  assert.deepEqual(v.films, ['preop','postop']);
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
