import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadV2Module } from './helpers/v2-env.js';

const { toViewModel, fetchWard } = await loadV2Module('data.js');

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
