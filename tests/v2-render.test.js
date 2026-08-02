// tests/v2-render.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadV2Module } from './helpers/v2-env.js';

const R = await loadV2Module('render.js');

const p = {
  id:'p1', bed:'12', name:'R. Kumar', age:'62/M', uhid:'MH-1', adm:'29 Jul',
  surgeon:'Dr Menon', unit:'Unit II', dx:'IT femur fracture', proc:'PFN · 29 Jul',
  implant:'PFN long', labs:'Hb 10.8', films:['preop'], pod:4, status:'postop',
  stat:'Post-op', plan:'', track:[['op',0,'done'],['POD 4',40,'now']],
  flags:[['warn','No plan entered today']],
  checks:[['Suture removal','POD 12',0]], dc:[['Summary',0]],
  hist:[['1 Aug','Sit out of bed']],
  surgeryDate:'', theatreTime:''
};

test('esc neutralises every html metacharacter', () => {
  assert.equal(R.esc(`<img src=x onerror="a">&'`),
    '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});

test('esc renders null and undefined as empty, never the literal word', () => {
  assert.equal(R.esc(null), '');
  assert.equal(R.esc(undefined), '');
});

test('patient names are escaped in the hero', () => {
  const html = R.hero({ ...p, name:'<script>x</script>' }, 0);
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('filmBox with a kind renders a zoomable button carrying its index', () => {
  const html = R.filmBox(3, 'preop', 'pre-op');
  assert.ok(html.includes('data-film="3:preop"'));
  assert.ok(html.includes('aria-label'));
});

test('filmBox without a kind renders the bone placeholder, not a button', () => {
  const html = R.filmBox(3, undefined, '');
  assert.ok(html.includes('fnone'));
  assert.ok(!html.includes('<button'));
  assert.ok(html.includes('role="img"'));
});

test('track marks exactly one current station', () => {
  const html = R.track(p);
  assert.equal((html.match(/class="st now"/g) || []).length, 1);
});

test('row shows POD when present and status when not', () => {
  assert.ok(R.row(p, 0, false, false).includes('POD 4'));
  assert.ok(R.row({ ...p, pod:null }, 0, false, false).includes('Post-op'));
});

test('row marks the current patient and seen state', () => {
  assert.ok(R.row(p, 0, true, false).includes('aria-current="true"'));
  assert.ok(R.row(p, 0, false, true).includes('seen'));
});

test('detail checklists carry patient-scoped toggle ids', () => {
  const html = R.detail(p, 5);
  assert.ok(html.includes('data-ck="5:0"'));
  assert.ok(html.includes('data-dc="5:0"'));
});

test('detail marks only the first open milestone as due', () => {
  const html = R.detail({ ...p,
    checks:[['A','POD 1',0],['B','POD 2',0],['C','POD 3',0]] }, 0);
  assert.equal((html.match(/class="ck  due"/g) || []).length, 1);
});

test('detail shows an explicit empty state for an unstarted discharge list', () => {
  const html = R.detail({ ...p, dc:[] }, 0);
  assert.ok(/Not started/i.test(html));
});

test('board groups by status and reports counts', () => {
  const html = R.board([p, { ...p, id:'p2', status:'preop', stat:'Pre-op' }]);
  assert.ok(html.includes('Pre-op'));
  assert.ok(html.includes('For discharge'));
  assert.ok(/None/.test(html), 'empty columns need an explicit empty state');
});

test('complete renders the round summary with the patient count', () => {
  const html = R.complete(8);
  assert.ok(html.includes('Round complete'));
  assert.ok(html.includes('8'));
});

test('filmBox with hostile kind containing quotes and event handlers is escaped', () => {
  const hostile = 'preop" onmouseover="alert(1)';
  const html = R.filmBox(0, hostile, '');
  assert.ok(!html.includes('onmouseover='), 'hostile event handler must not appear unescaped');
  assert.ok(!html.includes(hostile), 'hostile string must not appear unescaped in output');
});

test('filmBox with unknown-but-harmless kind still renders artwork fallback', () => {
  const html = R.filmBox(0, 'lateral', '');
  assert.ok(html.includes('<button'), 'unknown kind should render as button, not placeholder');
  assert.ok(html.includes('data-film="0:preop"'), 'unknown kind should resolve to preop via whitelist');
  assert.ok(html.includes('<svg'), 'should render artwork SVG for fallback preop');
});

/* ── documents (Task 7) ──
   The brief's original otList test drove a field called `otDate`, which
   does not exist anywhere in this codebase (verified: zero occurrences
   in public/app.js or server.js). The real rule, from public/app.js:1530
   (getOtListPatients), is `p.status === 'preop' && p.surgeryDate ===
   date` — pre-op patients whose surgeryDate equals the requested date.
   These two tests are rewritten to drive `surgeryDate`/`status` instead
   of the nonexistent `otDate`, keeping the brief's original intent: one
   asserts only same-date cases appear, the other asserts the empty
   state. */
test('OT list includes only patients scheduled for theatre today', () => {
  const html = R.otList([
    { ...p, id:'a', status:'preop', proc:'ORIF · 2 Aug · OT 11:00', surgeryDate:'2026-08-02', theatreTime:'11:00' },
    { ...p, id:'b', status:'preop', proc:'PFN · 29 Jul', surgeryDate:'2026-07-29', theatreTime:'09:00' }
  ], '2026-08-02');
  assert.ok(html.includes('11:00'));
  assert.ok(!html.includes('29 Jul'));
});

test('OT list renders an empty state when nothing is scheduled', () => {
  assert.ok(/no cases/i.test(R.otList([], '2026-08-02')));
});

test('OT list excludes same-date patients who are not pre-op', () => {
  const html = R.otList([
    { ...p, id:'a', status:'postop', surgeryDate:'2026-08-02', name:'Not On List' }
  ], '2026-08-02');
  assert.ok(!html.includes('Not On List'));
  assert.ok(/no cases/i.test(html));
});

test('otList escapes every patient-supplied field', () => {
  const hostile = '<b>x</b>"onmouseover="a';
  const html = R.otList([{ ...p, status:'preop', surgeryDate:'2026-08-02',
    bed:hostile, name:hostile, age:hostile, dx:hostile, proc:hostile, surgeon:hostile, theatreTime:hostile }],
    '2026-08-02');
  assert.ok(!html.includes(hostile), 'hostile string must not appear unescaped anywhere in the output');
});

test('handover lists every patient and surfaces urgent flags', () => {
  const html = R.handover([{ ...p, flags:[['bad','Antibiotic overdue']] }],
    { when:'2 Aug, 18:30', to:'Dr Verma' });
  assert.ok(html.includes('R. Kumar'));
  assert.ok(html.includes('Antibiotic overdue'));
  assert.ok(html.includes('Dr Verma'));
});

test('handover falls back to the last plan when today has none', () => {
  const html = R.handover([{ ...p, plan:'', hist:[['1 Aug','Sit out of bed']] }],
    { when:'x', to:'y' });
  assert.ok(html.includes('Sit out of bed'));
});

test('handover escapes plan text', () => {
  const html = R.handover([{ ...p, plan:'<b>x</b>' }], { when:'x', to:'y' });
  assert.ok(!html.includes('<b>x</b>'));
});

test('handover escapes every patient-supplied field, not just plan text', () => {
  const hostile = '<b>x</b>"onmouseover="a';
  const html = R.handover([{ ...p, bed:hostile, name:hostile, age:hostile, dx:hostile,
    flags:[['bad', hostile]] }], { when: hostile, to: hostile });
  assert.ok(!html.includes(hostile), 'hostile string must not appear unescaped anywhere in the output');
});

test('discharged renders an empty state for no rows', () => {
  assert.ok(/no discharges/i.test(R.discharged([])));
});

test('discharged lists patients when rows are present', () => {
  const html = R.discharged([{ ...p, name:'V. Pillai', dx:'Femur shaft fracture', proc:'Nailing' }]);
  assert.ok(html.includes('V. Pillai'));
  assert.ok(html.includes('Femur shaft fracture'));
  assert.ok(!/no discharges/i.test(html));
});

test('discharged escapes every patient-supplied field', () => {
  const hostile = '<b>x</b>"onmouseover="a';
  const html = R.discharged([{ ...p, name:hostile, age:hostile, dx:hostile, proc:hostile }]);
  assert.ok(!html.includes(hostile), 'hostile string must not appear unescaped anywhere in the output');
});
