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

/* ── Finding 1 (Fix round 1): unit filtering, mirroring public/app.js:1526-1545's
   getOtListPatients exactly — the unit filter applies only when non-empty,
   AND is discarded (not applied at all) when it would produce an empty
   list, rather than showing nobody. */
test('OT list applies the unit filter when it is set and narrows the list', () => {
  const html = R.otList([
    { ...p, id:'a', status:'preop', surgeryDate:'2026-08-02', unit:'Unit II', name:'InUnit' },
    { ...p, id:'b', status:'preop', surgeryDate:'2026-08-02', unit:'Unit I', name:'OtherUnit' }
  ], '2026-08-02', 'Unit II');
  assert.ok(html.includes('InUnit'));
  assert.ok(!html.includes('OtherUnit'));
});

test('OT list discards the unit filter rather than showing nobody, when it would empty the list', () => {
  const html = R.otList([
    { ...p, id:'a', status:'preop', surgeryDate:'2026-08-02', unit:'Unit I', name:'OnlyPatient' }
  ], '2026-08-02', 'Unit II');
  assert.ok(html.includes('OnlyPatient'),
    'unit filter must be discarded (not applied) when it would produce an empty list');
});

test('OT list unit filter is case-insensitive, trims whitespace, and no-ops when unset', () => {
  const html = R.otList([
    { ...p, id:'a', status:'preop', surgeryDate:'2026-08-02', unit:' unit ii ', name:'Matched' },
    { ...p, id:'b', status:'preop', surgeryDate:'2026-08-02', unit:'Unit I', name:'Unmatched' }
  ], '2026-08-02', '  UNIT II  ');
  assert.ok(html.includes('Matched'));
  assert.ok(!html.includes('Unmatched'));

  const noFilter = R.otList([
    { ...p, id:'a', status:'preop', surgeryDate:'2026-08-02', unit:'Unit I', name:'Any' }
  ], '2026-08-02');
  assert.ok(noFilter.includes('Any'), 'no unitFilter argument must render every patient');
});

/* ── Finding 2 (Fix round 1): row order must match public/app.js:1536-1544's
   comparator exactly — otOrder ascending (Number(x.otOrder) || 0), a set
   otOrder always sorting before an unset/zero one on the OTHER side only,
   then theatreTime, then name. */
test('OT list sorts by otOrder ascending, then theatreTime, then name', () => {
  const mk = (id, otOrder, theatreTime, name) =>
    ({ ...p, id, status:'preop', surgeryDate:'2026-08-02', otOrder, theatreTime, name });
  const html = R.otList([
    mk('a', 2, '09:00', 'Bravo'),
    mk('b', 1, '10:00', 'Alpha'),
    mk('c', undefined, '08:00', 'Charlie'),
    mk('d', undefined, '08:00', 'Able')
  ], '2026-08-02');
  const pos = name => html.indexOf(`>${name}<`);
  // Alpha (otOrder 1) before Bravo (otOrder 2); both set-otOrder rows before
  // the two unset ones, which tie-break on theatreTime (equal here) then name.
  assert.ok(pos('Alpha') < pos('Bravo'), 'lower otOrder must sort first');
  assert.ok(pos('Bravo') < pos('Able'), 'a set otOrder must sort before an unset one');
  assert.ok(pos('Able') < pos('Charlie'), 'equal otOrder/theatreTime falls back to name');
});

test('OT list sort: a set otOrder sorts before an unset one even when it is the higher-looking value, one-sided only', () => {
  const html = R.otList([
    { ...p, id:'x', status:'preop', surgeryDate:'2026-08-02', otOrder: undefined, theatreTime:'01:00', name:'NoOrder' },
    { ...p, id:'y', status:'preop', surgeryDate:'2026-08-02', otOrder: 9, theatreTime:'23:00', name:'HasOrder' }
  ], '2026-08-02');
  assert.ok(html.indexOf('>HasOrder<') < html.indexOf('>NoOrder<'),
    'any set otOrder must sort before an unset one, regardless of theatreTime');
});

test('OT list sort: otOrder of 0 is treated the same as an absent otOrder', () => {
  const html = R.otList([
    { ...p, id:'x', status:'preop', surgeryDate:'2026-08-02', otOrder: 0, theatreTime:'09:00', name:'Zero' },
    { ...p, id:'y', status:'preop', surgeryDate:'2026-08-02', theatreTime:'08:00', name:'Unset' }
  ], '2026-08-02');
  // Neither has a truthy otOrder, so they tie-break on theatreTime: Unset (08:00) before Zero (09:00).
  assert.ok(html.indexOf('>Unset<') < html.indexOf('>Zero<'));
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

/* ── Minor (authorised, Fix round 1): real discharge date + computed
   length of stay, in place of the '—' placeholders. '—' only when the
   underlying data is genuinely absent. */
test('discharged renders a real discharge date and a computed length of stay', () => {
  const html = R.discharged([{ ...p, name:'Dated', admissionDate:'2026-07-10', dischargeDate:'2026-07-20' }]);
  assert.ok(/20 Jul/.test(html), 'expected a formatted discharge date');
  assert.ok(html.includes('10d'), 'expected a 10-day computed stay (20 Jul minus 10 Jul)');
});

test('discharged renders — for discharge date and stay only when the underlying data is absent', () => {
  const html = R.discharged([{ ...p, name:'Undated', admissionDate:'', dischargeDate:'' }]);
  const row = html.slice(html.indexOf('Undated'));
  assert.ok(/<td>—<\/td><td class="mono">—<\/td>/.test(row),
    'both discharge date and stay must show — when neither date is present');
});

test('discharged shows — for stay when admissionDate is absent even though dischargeDate is present', () => {
  const html = R.discharged([{ ...p, name:'PartialDates', admissionDate:'', dischargeDate:'2026-07-20' }]);
  assert.ok(/20 Jul/.test(html), 'discharge date must still render when present');
  const row = html.slice(html.indexOf('PartialDates'));
  assert.ok(/<td class="mono">—<\/td>/.test(row), 'stay must show — when admissionDate is missing');
});

/* ── Finding 3 (Fix round 1): the discharged search box filters by name
   and diagnosis, case-insensitively. render.js stays pure — `search` is
   an explicit parameter, not read from any global. */
test('discharged search filters by name, case-insensitively', () => {
  const rows = [
    { ...p, id:'a', name:'Alice Sharma', dx:'Femur fracture' },
    { ...p, id:'b', name:'Bob Verma', dx:'Hip dislocation' }
  ];
  const html = R.discharged(rows, 'alice');
  assert.ok(html.includes('Alice Sharma'));
  assert.ok(!html.includes('Bob Verma'));
});

test('discharged search filters by diagnosis, case-insensitively', () => {
  const rows = [
    { ...p, id:'a', name:'Alice Sharma', dx:'Femur fracture' },
    { ...p, id:'b', name:'Bob Verma', dx:'Hip dislocation' }
  ];
  const html = R.discharged(rows, 'HIP');
  assert.ok(html.includes('Bob Verma'));
  assert.ok(!html.includes('Alice Sharma'));
});

test('discharged with no search term renders every row', () => {
  const rows = [{ ...p, id:'a', name:'Alice Sharma' }, { ...p, id:'b', name:'Bob Verma' }];
  const html = R.discharged(rows);
  assert.ok(html.includes('Alice Sharma'));
  assert.ok(html.includes('Bob Verma'));
});
