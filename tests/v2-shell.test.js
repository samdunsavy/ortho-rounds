// tests/v2-shell.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const html = readFileSync(new URL('../public/v2/index.html', import.meta.url), 'utf8');

test('shell declares every element app.js binds to', () => {
  const ids = ['hT','hS','sync','ringW','ringFg','ringN','spine','roundList','roundDet',
    'board','workList','workDet','otP','hoP','dcP','adP','pal','palIn','palL','addM',
    'viewer','vwF','vwT','present','prB','prC','scrim','toast','previewBanner'];
  for(const id of ids) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});

test('shell declares every view section', () => {
  for(const v of ['round','ward','work','ot','handover','disch','admin'])
    assert.ok(html.includes(`id="v-${v}"`), `missing #v-${v}`);
});

test('shell loads the seven css layers in order', () => {
  const order = ['tokens','base','shell','card','detail','board','overlay'];
  const found = [...html.matchAll(/css\/([a-z]+)\.css/g)].map(m => m[1]);
  assert.deepEqual(found, order);
});

test('shell reuses the shared milestones module', () => {
  assert.match(html, /src="\.\.\/milestones\.js(\?v=\d+)?"/,
    'v2 must load the shared milestones module; a ?v= cache-buster is allowed');
});

test('shell registers no service worker', () => {
  assert.ok(!/serviceWorker\s*\.\s*register/.test(html), 'v2 must not register a SW');
});

test('the root service worker ignores /v2 entirely', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const fetchHandler = sw.slice(sw.indexOf("addEventListener('fetch'"));
  assert.ok(/pathname\.startsWith\(['"]\/v2/.test(fetchHandler),
    'sw.js fetch handler must return early for /v2 paths');
  const guardIdx = fetchHandler.search(/pathname\.startsWith\(['"]\/v2/);
  const respondIdx = fetchHandler.indexOf('respondWith');
  assert.ok(guardIdx < respondIdx, 'the /v2 guard must precede respondWith');
});

test('preview banner is present and not dismissible', () => {
  const i = html.indexOf('id="previewBanner"');
  assert.ok(i > -1);
  const banner = html.slice(i, i + 400);
  assert.ok(/real patient/i.test(banner), 'banner must warn edits are real');
  assert.ok(!/data-close|dismiss/i.test(banner), 'banner must not be dismissible');
});

const cssDir = new URL('../public/v2/css/', import.meta.url);
const readCss = f => readFileSync(new URL(f, cssDir), 'utf8');

test('all seven css layers exist', () => {
  const files = readdirSync(cssDir).sort();
  assert.deepEqual(files,
    ['base.css','board.css','card.css','detail.css','overlay.css','shell.css','tokens.css']);
});

test('tokens.css defines both themes and every colour role', () => {
  const css = readCss('tokens.css');
  assert.ok(css.includes(':root{'));
  assert.ok(css.includes('[data-theme="dark"]'));
  for(const v of ['--ink','--paper','--card','--accent','--bone','--good','--warn','--bad','--film'])
    assert.ok(css.includes(v + ':'), `missing ${v}`);
});

test('only tokens.css declares colour variables', () => {
  for(const f of ['shell.css','card.css','detail.css','board.css','overlay.css']){
    assert.ok(!/^\s*--(ink|paper|accent|bone|film)[-:]/m.test(readCss(f)),
      `${f} must not declare colour tokens`);
  }
});

test('no layer hardcodes a hex colour outside tokens and film artwork', () => {
  for(const f of ['shell.css','card.css','detail.css','board.css']){
    const hex = readCss(f).match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.deepEqual(hex, [], `${f} hardcodes ${hex.join(', ')}`);
  }
});

test('exactly three breakpoint tiers, no strays', () => {
  const all = ['shell.css','card.css','detail.css','board.css','overlay.css','base.css']
    .flatMap(f => [...readCss(f).matchAll(/@media\s*\(min-width:\s*(\d+)px\)/g)].map(m => m[1]));
  assert.deepEqual([...new Set(all)].sort((a,b)=>a-b), ['760','1100','1300']);
});

test('reduced motion is honoured', () => {
  assert.ok(readCss('base.css').includes('prefers-reduced-motion'));
});

test('print stylesheet exists', () => {
  assert.ok(readCss('base.css').includes('@media print'));
});

import { bootV2 } from './helpers/v2-env.js';

export const raw = n => ({ id:'p'+n, bed:String(n), name:'P'+n, age:'40', sex:'M',
  diagnosis:'Dx'+n, status:'postop', surgeryDate:'2026-07-29', images:[],
  postOpChecks:[], dischargeChecks:[], planHistory:[], labs:{} });

test('boots, fetches the ward, and renders one row per patient', async () => {
  const { document } = await bootV2({ patients:[raw(1), raw(2), raw(3)] });
  assert.equal(document.querySelectorAll('#roundList .qr').length, 3);
});

test('marking seen advances to the next unseen patient', async () => {
  const { document, api } = await bootV2({ patients:[raw(1), raw(2)] });
  const before = api.state.idx;
  document.querySelector('[data-seen]').click();
  assert.notEqual(api.state.idx, before);
  assert.equal(api.state.seen.size, 1);
});

test('skip advances without marking seen', async () => {
  const { document, api } = await bootV2({ patients:[raw(1), raw(2)] });
  document.querySelector('[data-skip]').click();
  assert.equal(api.state.seen.size, 0);
});

test('the round cannot complete while a patient is only skipped', async () => {
  const { document } = await bootV2({ patients:[raw(1), raw(2)] });
  document.querySelector('[data-skip]').click();
  document.querySelector('[data-seen]').click();
  assert.ok(!document.body.textContent.includes('Round complete'));
});

test('narrow viewport renders the hero and no detail pane', async () => {
  const { document } = await bootV2({ patients:[raw(1), raw(2)], width:360 });
  assert.ok(document.querySelector('#roundList .hero'));
  assert.equal(document.querySelector('#roundDet').innerHTML, '');
});

test('wide viewport renders the list and the detail pane', async () => {
  const { document } = await bootV2({ patients:[raw(1), raw(2)], width:1440 });
  assert.ok(document.querySelector('#roundDet').innerHTML.length > 0);
});

test('a failed fetch surfaces a retry message and never a blank ward', async () => {
  const { document } = await bootV2({
    fetchImpl: async () => ({ ok:false, status:503, json: async () => ({}) }) });
  assert.ok(/couldn.t reach|retry/i.test(document.body.textContent));
});

test('at most ten interactive targets render before the first patient row', async () => {
  const { document } = await bootV2({ patients:[raw(1), raw(2)], width:360 });
  const chrome = [...document.querySelectorAll('.hd button, .nav button, .preview-banner button')];
  assert.ok(chrome.length <= 10, `${chrome.length} chrome targets, spec caps this at 10`);
});

/* ── Fix round 2: silent data loss on real patient records ── */

const rawWithCheck = (n, checks) => Object.assign(raw(n), { postOpChecks: checks });

test('a push that throws a network error never shows a success toast and reverts the optimistic state', async () => {
  const p1 = rawWithCheck(1, [{ id:'c1', label:'Drain out', duePod:1, status:'pending' }]);
  let call = 0;
  const { document, api } = await bootV2({
    // Each response is an independent clone, exactly as a real server
    // response would be — a client-side optimistic mutation must never
    // leak into what a later fetch "returns", or this test would pass
    // for the wrong reason.
    fetchImpl: async () => {
      call++;
      if(call <= 2) return { ok:true, json: async () => ({ serverTime:1, patients:[JSON.parse(JSON.stringify(p1))] }) };
      throw new Error('network down');
    }
  });
  const btn = document.querySelector('[data-ck="0:c1"]');
  assert.ok(btn, 'expected a milestone checkbox to render');
  btn.click();
  await api.state.pending;
  const toastText = document.querySelector('#toast').textContent;
  assert.ok(!/updated/i.test(toastText), `toast must not claim success, got "${toastText}"`);
  assert.ok(/connection/i.test(toastText), `toast must surface the network failure, got "${toastText}"`);
  assert.equal(api.state.patients[0].checks[0][2], 0,
    'the optimistic done-state must be reverted, not left claiming an unsaved success');
});

test('toggling a milestone stamps updatedAt on the toggled item', async () => {
  const p1 = rawWithCheck(1, [{ id:'c1', label:'Drain out', duePod:1, status:'pending' }]);
  let call = 0, pushedBody = null;
  const { document, api } = await bootV2({
    // Independent clones per response, as a real server would return.
    fetchImpl: async (url, opts) => {
      call++;
      if(call <= 2) return { ok:true, json: async () => ({ serverTime:1, patients:[JSON.parse(JSON.stringify(p1))] }) };
      pushedBody = JSON.parse(opts.body);
      return { ok:true, json: async () => ({ serverTime:2 }) };
    }
  });
  const before = Date.now();
  document.querySelector('[data-ck="0:c1"]').click();
  await api.state.pending;
  assert.ok(pushedBody, 'expected a push to have been sent');
  const pushedItem = pushedBody.changes[0].postOpChecks.find(c => c.id === 'c1');
  assert.ok(pushedItem, 'expected the toggled item in the pushed record');
  assert.ok(Number(pushedItem.updatedAt) >= before,
    `expected a fresh updatedAt on the toggled item, got ${pushedItem.updatedAt}`);
});

test('a toggle push reflects a server-side change made after the initial fetch, not the stale snapshot', async () => {
  const p1v0 = rawWithCheck(1, [
    { id:'c1', label:'Drain out', duePod:1, status:'pending' },
    { id:'c2', label:'Mobilise', duePod:2, status:'pending' }
  ]);
  // Simulates another clinician (main app, at /) marking c2 done between
  // this tab's boot fetch and this write.
  const p1v1 = JSON.parse(JSON.stringify(p1v0));
  p1v1.postOpChecks[1].status = 'done';
  p1v1.postOpChecks[1].updatedAt = Date.now();

  let call = 0, pushedBody = null;
  const { document, api } = await bootV2({
    fetchImpl: async (url, opts) => {
      call++;
      if(call === 1) return { ok:true, json: async () => ({ serverTime:1, patients:[p1v0] }) };
      if(call === 2) return { ok:true, json: async () => ({ serverTime:2, patients:[p1v1] }) };
      pushedBody = JSON.parse(opts.body);
      return { ok:true, json: async () => ({ serverTime:3 }) };
    }
  });
  document.querySelector('[data-ck="0:c1"]').click(); // toggles c1, must not touch c2
  await api.state.pending;
  assert.ok(pushedBody, 'expected a push to have been sent');
  const sentC2 = pushedBody.changes[0].postOpChecks.find(c => c.id === 'c2');
  assert.ok(sentC2, 'expected c2 in the pushed record');
  assert.equal(sentC2.status, 'done',
    "clinician B's completed milestone must not be silently reverted by a stale push");
});

/* ── Fix round 3: two overlapping write cycles for the SAME patient must
   not interleave and revert one another ── */

test('two rapid checklist toggles on the same patient are serialised — neither is reverted', async () => {
  const patient0 = rawWithCheck(1, [
    { id:'c1', label:'Drain out', duePod:1, status:'pending' },
    { id:'c2', label:'Mobilise', duePod:2, status:'pending' }
  ]);
  let serverPatient = JSON.parse(JSON.stringify(patient0));
  let serverTime = 1;
  let readCount = 0;
  const pushedBodies = [];
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  let resolveBothPushed;
  const bothPushed = new Promise(res => { resolveBothPushed = res; });

  // fetchImpl distinguishes reads (empty `changes`, i.e. loadWard's
  // fetchWard call) from writes (one entry in `changes`, i.e. pushPatient).
  // The SECOND read issued after boot (readCount === 2 — the very first
  // write cycle's own refresh) is made deliberately slow to resolve, to
  // simulate ordinary network jitter: it's issued first but arrives last.
  // Its response snapshot is captured at REQUEST time (matching a real
  // server, which answers with the state as of when it received the
  // request, not as of when the response happens to arrive) — a slow
  // response is not automatically a stale one; it only becomes a problem
  // if the client applies it after a newer write has already landed.
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if(body.changes && body.changes.length){
      const pushed = JSON.parse(JSON.stringify(body.changes[0]));
      pushedBodies.push(pushed);
      serverPatient = pushed;
      serverTime++;
      if(pushedBodies.length === 2) resolveBothPushed();
      return { ok:true, json: async () => ({ serverTime }) };
    }
    readCount++;
    const snapshot = JSON.parse(JSON.stringify(serverPatient));
    if(readCount === 2) await sleep(30);
    return { ok:true, json: async () => ({ serverTime, patients:[snapshot] }) };
  };

  const { document } = await bootV2({ fetchImpl });
  const btnC1 = document.querySelector('[data-ck="0:c1"]');
  assert.ok(btnC1, 'expected the first milestone checkbox to render');

  btnC1.click(); // starts write cycle A (toggles c1) — its refresh is the slow one
  // toggleCheck's optimistic flip re-renders #roundDet synchronously (still
  // inside this same .click() call, before A's push has even reached the
  // network), replacing the DOM — a reference queried before this click
  // would now be detached and its .click() would never bubble to the
  // document-level listener. Re-query after A's click, not before.
  const btnC2 = document.querySelector('[data-ck="0:c2"]');
  assert.ok(btnC2, 'expected the second milestone checkbox to render');
  btnC2.click(); // starts write cycle B (toggles c2) before A has settled

  await Promise.race([
    bothPushed,
    sleep(2000).then(() => { throw new Error('timed out waiting for both writes to land'); })
  ]);

  const c1 = serverPatient.postOpChecks.find(c => c.id === 'c1');
  const c2 = serverPatient.postOpChecks.find(c => c.id === 'c2');
  assert.equal(c1.status, 'done', "toggle A's change (c1) must not be lost");
  assert.equal(c2.status, 'done', "toggle B's change (c2) must not be reverted by A's stale write");
});

/* ── Task 7 Fix round 1: Finding 3 — the OT date input and discharged
   search must actually do something, client-side, with no new fetch. ── */

async function waitFor(fn, timeout = 1000){
  const start = Date.now();
  while(Date.now() - start < timeout){
    if(fn()) return;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('waitFor timed out');
}

test('changing the OT date re-renders the list for the new date without a new fetch', async () => {
  const p1 = { ...raw(1), status:'preop', surgeryDate:'2026-08-02', name:'AliceOT' };
  const p2 = { ...raw(2), status:'preop', surgeryDate:'2026-08-03', name:'BobOT' };
  let fetchCalls = 0;
  const { document, window } = await bootV2({
    fetchImpl: async () => {
      fetchCalls++;
      return { ok:true, json: async () => ({ serverTime:1, patients:[p1, p2] }) };
    }
  });
  document.querySelector('[data-go="ot"]').click();

  const dateInput = document.querySelector('#otP input[type="date"]');
  assert.ok(dateInput, 'expected the OT date input to render');
  dateInput.value = '2026-08-02';
  dateInput.dispatchEvent(new window.Event('change', { bubbles:true }));
  const callsAfterFirstChange = fetchCalls;
  assert.ok(document.querySelector('#otP').textContent.includes('AliceOT'));
  assert.ok(!document.querySelector('#otP').textContent.includes('BobOT'));

  // Re-query: rOT() rebuilds #otP's innerHTML, so the previous input node is detached.
  const dateInput2 = document.querySelector('#otP input[type="date"]');
  dateInput2.value = '2026-08-03';
  dateInput2.dispatchEvent(new window.Event('change', { bubbles:true }));
  assert.equal(fetchCalls, callsAfterFirstChange, 'changing the OT date must not trigger a new fetch');
  assert.ok(document.querySelector('#otP').textContent.includes('BobOT'));
  assert.ok(!document.querySelector('#otP').textContent.includes('AliceOT'));
});

test('typing in the discharged search filters by name and diagnosis, case-insensitively, with no new fetch', async () => {
  const d1 = { ...raw(1), status:'discharged', dischargeDate:'2026-07-20', admissionDate:'2026-07-10',
    name:'Alice Sharma', diagnosis:'Femur fracture' };
  const d2 = { ...raw(2), status:'discharged', dischargeDate:'2026-07-25', admissionDate:'2026-07-15',
    name:'Bob Verma', diagnosis:'Hip dislocation' };
  let fetchCalls = 0;
  const { document, window, api } = await bootV2({
    fetchImpl: async () => {
      fetchCalls++;
      return { ok:true, json: async () => ({ serverTime:1, patients:[d1, d2] }) };
    }
  });
  document.querySelector('[data-go="disch"]').click();
  await waitFor(() => api.state.dischargedPatients.length === 2);
  assert.ok(document.querySelector('#dcP').textContent.includes('Alice Sharma'));
  assert.ok(document.querySelector('#dcP').textContent.includes('Bob Verma'));
  const callsBeforeTyping = fetchCalls;

  const searchByName = document.querySelector('#dcP input');
  searchByName.value = 'alice';
  searchByName.dispatchEvent(new window.Event('input', { bubbles:true }));
  assert.ok(document.querySelector('#dcP').textContent.includes('Alice Sharma'));
  assert.ok(!document.querySelector('#dcP').textContent.includes('Bob Verma'));

  const searchByDx = document.querySelector('#dcP input');
  searchByDx.value = 'HIP';
  searchByDx.dispatchEvent(new window.Event('input', { bubbles:true }));
  assert.ok(document.querySelector('#dcP').textContent.includes('Bob Verma'));
  assert.ok(!document.querySelector('#dcP').textContent.includes('Alice Sharma'));

  assert.equal(fetchCalls, callsBeforeTyping, 'typing in the discharged search must not trigger a new fetch');
});

/* ── Task 8: command palette, film viewer, presentation mode, keyboard ── */

import { press } from './helpers/v2-env.js';

const typeInPalette = (window, value) => {
  const input = window.document.querySelector('#palIn');
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles:true }));
};

test('palette opens on meta+k and closes on escape', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  assert.ok(document.querySelector('#pal').classList.contains('on'));
  press(window, 'Escape');
  assert.ok(!document.querySelector('#pal').classList.contains('on'));
});

test('palette lists grouped actions before any typing', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  assert.ok(document.querySelectorAll('#palL .pi').length >= 20);
  assert.ok(document.querySelector('#palL .pal-g').textContent.includes('Most used'));
});

test('palette matches patients and actions in one field', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  typeInPalette(window, 'P1');
  assert.ok(document.querySelector('#palL').textContent.includes('P1'));
});

test('palette reports no match rather than rendering empty', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  typeInPalette(window, 'zzzzzz');
  assert.ok(/no match/i.test(document.querySelector('#palL').textContent));
});

test('arrow keys move the palette selection and enter runs it', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  press(window, 'ArrowDown');
  assert.equal(document.querySelectorAll('#palL .pi.sel').length, 1);
  assert.notEqual(document.querySelectorAll('#palL .pi')[0].className.includes('sel'), true);
  press(window, 'Enter');
  assert.ok(!document.querySelector('#pal').classList.contains('on'), 'enter must close the palette');
});

test('all 23 actions are reachable from the palette', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  assert.equal(document.querySelectorAll('#palL .pi').length, 23);
});

test('film viewer arrows are inert before a film is opened', async () => {
  const { document } = await bootV2({ patients:[raw(1)] });
  assert.doesNotThrow(() => document.querySelector('[data-vnav]').click());
});

test('every icon-only button carries an accessible label', async () => {
  const { document } = await bootV2({ patients:[raw(1)] });
  const bad = [...document.querySelectorAll('button')]
    .filter(b => !b.textContent.trim() && !b.getAttribute('aria-label'));
  assert.deepEqual(bad.map(b => b.outerHTML.slice(0, 60)), []);
});

test('admin view links out to the existing console rather than reimplementing it', async () => {
  const { document, api } = await bootV2({ patients:[raw(1)] });
  api.go('admin');
  const a = document.querySelector('#adP a[href="/"]');
  assert.ok(a, 'admin pane must link back to the main app');
  assert.ok(/admin console/i.test(a.textContent));
});

/* ══════════════════════════════════════════════════════════════════
   Final whole-branch review — blocking findings B1, B2, B3, B5 and
   the should-fix items that live in app.js. Every test below failed
   against the pre-fix code; see the fix-wave report for the recorded
   failure output.

   Checklist controls are located by their LABEL, never by their
   data-ck/data-dc attribute value, so these tests assert on clinical
   behaviour ("the clinician clicked the row that says X") rather than
   on the addressing scheme they are here to change.
   ══════════════════════════════════════════════════════════════════ */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ckByLabel = (document, label) =>
  [...document.querySelectorAll('[data-ck]')].find(b => b.textContent.includes(label));
const todayISOForTest = () => {
  const d = new Date();
  const q = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${q(d.getMonth()+1)}-${q(d.getDate())}`;
};
/* Splits a fetchImpl's traffic into reads (fetchWard: empty `changes`)
   and writes (pushPatient: one entry in `changes`), recording every
   pushed record. `reads` returns the snapshot to answer the Nth read
   with; a real server answers with the state as of REQUEST time, so
   the snapshot is cloned at request time, not at resolve time. */
function scriptedServer({ snapshotFor, delayFor = () => 0 }){
  const pushes = [];
  let readCount = 0;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if(body.changes && body.changes.length){
      pushes.push(JSON.parse(JSON.stringify(body.changes[0])));
      return { ok:true, json: async () => ({ serverTime: 100 + pushes.length }) };
    }
    readCount++;
    const n = readCount;
    const snapshot = JSON.parse(JSON.stringify(snapshotFor(n)));
    const wait = delayFor(n);
    if(wait) await sleep(wait);
    return { ok:true, json: async () => ({ serverTime: n, patients:[snapshot] }) };
  };
  return { fetchImpl, pushes, reads: () => readCount };
}

/* ── B1: the wrong milestone gets marked done ──
   S.raw is silently replaced by any write's loadWard() without the
   patient being re-rendered, so positional data-ck indices drift out of
   sync with the record they index into. */
test('a milestone toggle addresses the item the clinician clicked, even after S.raw was refreshed under it', async () => {
  const before = { ...raw(1), dailyPlan:'', postOpChecks:[
    { id:'a1', label:'Weight bearing', duePod:2, status:'pending' }
  ]};
  // Another clinician inserts a milestone AHEAD of the rendered one.
  const after = { ...raw(1), dailyPlan:'', postOpChecks:[
    { id:'b1', label:'Suture removal', duePod:12, status:'pending' },
    { id:'a1', label:'Weight bearing', duePod:2, status:'pending' }
  ]};
  const { fetchImpl, pushes } = scriptedServer({ snapshotFor: n => n === 1 ? before : after });
  const { document, window, api } = await bootV2({ fetchImpl });

  const weightBearing = ckByLabel(document, 'Weight bearing');
  assert.ok(weightBearing, 'expected the Weight bearing milestone to render');

  // A plan write refreshes S.raw (picking up the inserted milestone) and
  // deliberately does NOT re-render the patient.
  const plan = document.querySelector('#roundDet .pin');
  plan.value = 'NPO from midnight';
  plan.dispatchEvent(new window.Event('input', { bubbles:true }));
  await sleep(800);
  await api.state.pending;

  // The clinician now clicks the row they can actually see.
  weightBearing.click();
  await api.state.pending;

  const pushed = pushes.at(-1);
  assert.ok(pushed, 'expected a checklist push');
  const a1 = pushed.postOpChecks.find(c => c.id === 'a1');
  const b1 = pushed.postOpChecks.find(c => c.id === 'b1');
  assert.equal(a1.status, 'done', 'the clicked milestone (Weight bearing) must be the one marked done');
  assert.equal(b1.status, 'pending', 'a milestone the clinician never clicked must not be marked done');
});

test('a discharge-checklist toggle addresses the item the clinician clicked, even after S.raw was refreshed under it', async () => {
  const before = { ...raw(1), dailyPlan:'', dischargeChecks:[
    { id:'x1', label:'Physio review', status:'pending' }
  ]};
  const after = { ...raw(1), dailyPlan:'', dischargeChecks:[
    { id:'y1', label:'Discharge summary', status:'pending' },
    { id:'x1', label:'Physio review', status:'pending' }
  ]};
  const { fetchImpl, pushes } = scriptedServer({ snapshotFor: n => n === 1 ? before : after });
  const { document, window, api } = await bootV2({ fetchImpl });

  const physio = [...document.querySelectorAll('[data-dc]')].find(b => b.textContent.includes('Physio review'));
  assert.ok(physio, 'expected the Physio review item to render');

  const plan = document.querySelector('#roundDet .pin');
  plan.value = 'For discharge tomorrow';
  plan.dispatchEvent(new window.Event('input', { bubbles:true }));
  await sleep(800);
  await api.state.pending;

  physio.click();
  await api.state.pending;

  const pushed = pushes.at(-1);
  assert.ok(pushed, 'expected a discharge-checklist push');
  assert.equal(pushed.dischargeChecks.find(c => c.id === 'x1').status, 'done');
  assert.equal(pushed.dischargeChecks.find(c => c.id === 'y1').status, 'pending');
});

/* ── B2: a typed plan is destroyed by ticking a checkbox ── */
test('ticking a milestone inside the plan debounce keeps the typed plan and writes it', async () => {
  const rec = { ...raw(1), dailyPlan:'', postOpChecks:[
    { id:'c1', label:'Drain out', duePod:1, status:'pending' }
  ]};
  const { fetchImpl, pushes } = scriptedServer({ snapshotFor: () => rec });
  const { document, window, api } = await bootV2({ fetchImpl });

  const typed = 'NPO from midnight, plan ORIF tomorrow';
  const plan = document.querySelector('#roundDet .pin');
  plan.value = typed;
  plan.dispatchEvent(new window.Event('input', { bubbles:true }));

  ckByLabel(document, 'Drain out').click();   // inside the 600ms debounce
  await api.state.pending;

  assert.equal(api.state.patients[0].plan, typed,
    'the un-pushed plan must survive the checklist re-render');
  assert.equal(document.querySelector('#roundDet .pin').value, typed,
    'the plan input must not blank itself under the clinician');

  await sleep(800);
  await api.state.pending;
  const planPush = pushes.find(b => b.dailyPlan);
  assert.ok(planPush, 'the debounced plan write must still carry the typed text, not an empty string');
  assert.equal(planPush.dailyPlan, typed);
});

/* ── B3(a): v2 plan writes must stamp dailyPlanDate, mirroring
   public/app.js:1205 — otherwise merge.js clears it and the main app
   reports the patient as "No plan entered for today". ── */
test('a plan write stamps dailyPlanDate for today, not just planUpdatedAt', async () => {
  const rec = { ...raw(1), dailyPlan:'', dailyPlanDate:'2026-01-01' };
  const { fetchImpl, pushes } = scriptedServer({ snapshotFor: () => rec });
  const { document, window, api } = await bootV2({ fetchImpl });

  const plan = document.querySelector('#roundDet .pin');
  plan.value = 'Mobilise full weight bearing';
  plan.dispatchEvent(new window.Event('input', { bubbles:true }));
  await sleep(800);
  await api.state.pending;

  const pushed = pushes.at(-1);
  assert.ok(pushed, 'expected a plan push');
  assert.equal(pushed.dailyPlan, 'Mobilise full weight bearing');
  assert.equal(pushed.dailyPlanDate, todayISOForTest(),
    'dailyPlanDate must be stamped, or merge.js drops it and / reports "no plan today"');
  assert.ok(Number(pushed.planUpdatedAt) > 0, 'planUpdatedAt must still be stamped');
});

/* ── B5: a refresh starting mid-write must not make the write push a
   boot-era snapshot. ── */
test('a refresh that starts mid-write never makes the write push a stale snapshot', async () => {
  const v0 = { ...raw(1), postOpChecks:[
    { id:'c1', label:'Drain out', duePod:1, status:'pending' }
  ]};
  // Between boot and this write, another clinician marked c1 done and
  // added c2. The write must toggle c1 OFF (done -> pending) and must
  // not drop c2.
  const v1 = { ...raw(1), postOpChecks:[
    { id:'c1', label:'Drain out', duePod:1, status:'done', updatedAt: Date.now() },
    { id:'c2', label:'Mobilise', duePod:2, status:'done', updatedAt: Date.now() }
  ]};
  const { fetchImpl, pushes } = scriptedServer({
    snapshotFor: n => n === 1 ? v0 : v1,
    // read 2 is the write's own refresh (slow); read 3 is the superseding
    // load started 5ms later, which resolves later still.
    delayFor: n => n === 2 ? 60 : n === 3 ? 300 : 0
  });
  const { document, api } = await bootV2({ fetchImpl });

  ckByLabel(document, 'Drain out').click();     // starts the write cycle
  await sleep(5);
  const superseding = api.render();             // bumps loadSeq mid-write
  await api.state.pending;

  const pushed = pushes.at(-1);
  assert.ok(pushed, 'expected a checklist push');
  assert.ok(pushed.postOpChecks.find(c => c.id === 'c2'),
    "another clinician's milestone must not be dropped by a stale full-replace push");
  assert.equal(pushed.postOpChecks.find(c => c.id === 'c1').status, 'pending',
    "the clinician's own toggle must be applied to the fresh record, not inverted by a stale one");
  await superseding;
});

/* ── should-fix: unsaved work on tab close ── */
test('closing the tab with an undebounced plan edit warns rather than losing it silently', async () => {
  const { document, window } = await bootV2({ patients:[raw(1)] });
  const clean = new window.Event('beforeunload', { cancelable:true });
  window.dispatchEvent(clean);
  assert.equal(clean.defaultPrevented, false, 'a tab with nothing pending must not warn');

  const plan = document.querySelector('#roundDet .pin');
  plan.value = 'Not yet pushed';
  plan.dispatchEvent(new window.Event('input', { bubbles:true }));

  const dirty = new window.Event('beforeunload', { cancelable:true });
  window.dispatchEvent(dirty);
  assert.ok(dirty.defaultPrevented, 'an un-pushed plan edit must warn before the tab closes');
});

/* ── should-fix: a failed refresh must not leave a live editable pane ── */
test('a failed refresh clears the detail pane instead of leaving stale live controls', async () => {
  const rec = { ...raw(1), postOpChecks:[{ id:'c1', label:'Drain out', duePod:1, status:'pending' }] };
  let calls = 0;
  const { document, api } = await bootV2({
    fetchImpl: async () => {
      calls++;
      if(calls === 1) return { ok:true, json: async () => ({ serverTime:1, patients:[rec] }) };
      return { ok:false, status:503, json: async () => ({}) };
    }
  });
  assert.ok(document.querySelector('#roundDet .pin'), 'the detail pane starts live');
  await api.render();
  assert.ok(/couldn.t reach|retry/i.test(document.querySelector('#roundList').textContent));
  assert.equal(document.querySelectorAll('#roundDet .pin').length, 0,
    'a stale plan input must not survive a failed refresh');
  assert.equal(document.querySelectorAll('#roundDet [data-ck]').length, 0,
    'stale checkboxes must not survive a failed refresh');
});

/* ── should-fix: presentation mode on an empty ward ── */
test('presentation mode on an empty ward shows an explicit empty slide, not the shell placeholder', async () => {
  const { document, window } = await bootV2({ patients: [] });
  press(window, 'P', { shiftKey:true });
  assert.ok(document.querySelector('#present').classList.contains('on'), 'presentation mode must open');
  assert.notEqual(document.querySelector('#prC').textContent.trim(), '1 of 8',
    "the shell's literal placeholder must never be left on screen");
  assert.ok(document.querySelector('#prB').textContent.trim().length > 0,
    'an empty ward must still say something, never a blank slide');
});

/* ── should-fix: the service worker's /v2 bypass must be prefix-precise ── */
test('the service worker bypass matches /v2 and /v2/... but not /v2x.js', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const fetchHandler = sw.slice(sw.indexOf("addEventListener('fetch'"));
  assert.ok(/pathname\s*===\s*['"]\/v2['"]/.test(fetchHandler),
    'the bypass must match the bare /v2 path exactly');
  assert.ok(/pathname\.startsWith\(['"]\/v2\/['"]\)/.test(fetchHandler),
    'the bypass must match /v2/ descendants');
  assert.ok(!/startsWith\(\s*['"]\/v2['"]\s*\)/.test(fetchHandler),
    "a bare '/v2' prefix test also swallows /v2x.js and /v2-anything");
});

test('a full re-render mid-edit carries the un-pushed plan across, rather than blanking it', async () => {
  const rec = { ...raw(1), dailyPlan:'' };
  const { fetchImpl, pushes } = scriptedServer({ snapshotFor: () => rec });
  const { document, window, api } = await bootV2({ fetchImpl });

  const typed = 'Await ortho review';
  const plan = document.querySelector('#roundDet .pin');
  plan.value = typed;
  plan.dispatchEvent(new window.Event('input', { bubbles:true }));

  await api.render();   // e.g. the retry button, or a rejected write's re-fetch
  assert.equal(api.state.patients[0].plan, typed);
  assert.equal(document.querySelector('#roundDet .pin').value, typed);

  await sleep(800);
  await api.state.pending;
  assert.equal(pushes.at(-1).dailyPlan, typed);
});

/* ── The app must boot itself ────────────────────────────────────────────
   app.js once only DEFINED things: it logged its build line, exposed
   __V2__ and stopped. In a browser nothing fetched and nothing rendered —
   the shell sat on its static placeholder ring with no error, because no
   code had run. The entire suite passed anyway, because bootV2 called
   api.render() itself; the harness was doing the app's boot.

   This test imports app.js WITHOUT any harness assistance and asserts the
   module starts itself. It must never be "fixed" by calling render(). */
test('app.js boots itself — importing it triggers a ward load with no help', async () => {
  const { JSDOM } = await import('jsdom');
  const { readFileSync } = await import('node:fs');
  const shell = readFileSync(new URL('../public/v2/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(shell, { runScripts: 'outside-only', url: 'http://localhost/v2/' });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });

  let fetchCalls = 0;
  window.fetch = async () => { fetchCalls++;
    return { ok: true, status: 200, json: async () => ({ serverTime: 1, patients: [
      { id: 'b1', name: 'Boot', bed: '01', age: '40', sex: 'M', diagnosis: 'Dx',
        status: 'postop', surgeryDate: '2026-07-29', postOpChecks: [], dischargeChecks: [],
        planHistory: [], labs: {}, images: [] }] }) }; };

  const prev = {};
  for(const k of ['window','document','navigator','fetch','localStorage','KeyboardEvent','MouseEvent','Event','requestAnimationFrame']){
    prev[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, {
      value: k === 'requestAnimationFrame' ? (cb => setTimeout(cb, 0)) : window[k],
      configurable: true, writable: true });
  }
  try{
    await import(new URL('../public/v2/app.js', import.meta.url) + '?selfboot=' + Math.random());
    // NOTE: no api.render() call here — that is the whole point.
    await window.__V2__.ready;
  } finally {
    for(const k of Object.keys(prev)) prev[k] ? Object.defineProperty(globalThis, k, prev[k]) : delete globalThis[k];
  }

  assert.ok(fetchCalls > 0, 'importing app.js must trigger a ward fetch on its own');
  assert.equal(window.__V2__.state.patients.length, 1, 'the boot render must populate state');
  assert.notEqual(window.document.querySelector('#ringN').textContent, '0/8',
    'the static placeholder ring must have been overwritten by the boot render');
  assert.equal(window.document.querySelector('#ringN').textContent, '0/1');
});
