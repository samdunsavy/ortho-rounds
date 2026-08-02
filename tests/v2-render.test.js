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
  hist:[['1 Aug','Sit out of bed']]
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
