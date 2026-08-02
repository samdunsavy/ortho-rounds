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
  assert.ok(html.includes('src="../milestones.js"'));
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
  const btn = document.querySelector('[data-ck="0:0"]');
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
  document.querySelector('[data-ck="0:0"]').click();
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
  document.querySelector('[data-ck="0:0"]').click(); // toggles c1, must not touch c2
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
  const btnC1 = document.querySelector('[data-ck="0:0"]');
  assert.ok(btnC1, 'expected the first milestone checkbox to render');

  btnC1.click(); // starts write cycle A (toggles c1) — its refresh is the slow one
  // toggleCheck's optimistic flip re-renders #roundDet synchronously (still
  // inside this same .click() call, before A's push has even reached the
  // network), replacing the DOM — a reference queried before this click
  // would now be detached and its .click() would never bubble to the
  // document-level listener. Re-query after A's click, not before.
  const btnC2 = document.querySelector('[data-ck="0:1"]');
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
