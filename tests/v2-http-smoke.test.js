/* HTTP integration smoke test for the /v2 preview client.
 *
 * This file exists because three shipped bugs were all invisible to a
 * suite that never spoke HTTP:
 *
 *   - /v2 served its index in place instead of redirecting, so the page's
 *     relative asset URLs resolved one level too high (no CSS at all, and
 *     the MAIN app's script loaded into the v2 shell).
 *   - v2 sent no Authorization header, so every request 401'd and the ward
 *     was permanently empty.
 *   - app.js never called render(), so nothing fetched or drew — the test
 *     harness had been performing the app's boot.
 *
 * Each has a named test below. When adding a feature to v2, extend this
 * file rather than only the stubbed suites: this is the only place that
 * exercises real URLs, a real login, and the app's own startup.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { startServer, patient } from './helpers/v2-server.js';

const ROOT = new URL('../', import.meta.url);
let srv;

before(async () => {
  srv = await startServer();
  await srv.seed([1, 2, 3, 4, 5].map(n => patient(n)));
});
after(() => srv?.stop());

/* ── 1. URL resolution ────────────────────────────────────────────────── */

test('GET /v2 redirects to /v2/ — serving the index in place breaks every relative asset URL', async () => {
  const res = await srv.request('/v2', { redirect: 'manual' });
  assert.equal(res.status, 301, 'a bare directory URL must redirect, not serve its index');
  assert.match(res.headers.get('location') || '', /\/v2\/$/);
});

test('every asset the shell references resolves to 200 from the running server', async () => {
  const html = await (await srv.request('/v2/')).text();
  const refs = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)]
    .map(m => m[1])
    .filter(u => !/^(https?:)?\/\//.test(u));
  assert.ok(refs.length >= 9, `expected the shell to reference its assets, found ${refs.length}`);

  const bad = [];
  for(const ref of refs){
    const url = new URL(ref, srv.base + '/v2/');
    const r = await srv.request(url.pathname + url.search);
    if(!r.ok) bad.push(`${ref} -> ${r.status}`);
  }
  assert.deepEqual(bad, [], 'these assets 404 as the browser would request them');
});

test('the version stamp in the shell matches the BUILD constant in app.js', async () => {
  const html = readFileSync(new URL('public/v2/index.html', ROOT), 'utf8');
  const appJs = readFileSync(new URL('public/v2/app.js', ROOT), 'utf8');
  const stamps = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  assert.equal(stamps.length, 1, `the shell must use one version stamp, found ${stamps.join(', ')}`);
  const build = (appJs.match(/const BUILD = 'v(\d+)'/) || [])[1];
  assert.equal(build, stamps[0],
    'BUILD in app.js and the ?v= stamps in index.html must be bumped together');
});

/* ── 2 & 3. Authentication, and the app booting itself ────────────────── */

/** Load /v2/ the way a browser does: fetch the real HTML over HTTP, let
 *  the page's own fetch go to the real server, and await ONLY the app's
 *  own boot promise. Never calls render() — that is the point. */
async function loadPage({ token, width = 1440 } = {}){
  const html = await (await srv.request('/v2/')).text();
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: srv.base + '/v2/' });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  if(token) window.localStorage.setItem('ortho_token', token);

  const nodeFetch = globalThis.fetch;
  window.fetch = (u, o) => nodeFetch(String(u).startsWith('http') ? String(u) : srv.base + String(u), o);
  window.eval(readFileSync(new URL('public/milestones.js', ROOT), 'utf8'));

  const prev = {};
  for(const k of ['window','document','navigator','fetch','localStorage','KeyboardEvent','MouseEvent','Event','requestAnimationFrame']){
    prev[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, {
      value: k === 'requestAnimationFrame' ? (cb => setTimeout(cb, 0)) : window[k],
      configurable: true, writable: true });
  }
  try{
    await import(new URL('public/v2/app.js', ROOT) + '?http=' + Math.random());
    await window.__V2__.ready;
  } finally {
    for(const k of Object.keys(prev)) prev[k] ? Object.defineProperty(globalThis, k, prev[k]) : delete globalThis[k];
  }
  return window;
}

test('a signed-in page boots itself and renders the real ward over HTTP', async () => {
  const window = await loadPage({ token: srv.token });
  const doc = window.document;
  assert.equal(window.__V2__.state.patients.length, 5);
  assert.equal(doc.querySelectorAll('#roundList .qr').length, 5);
  assert.equal(doc.querySelector('#ringN').textContent, '0/5');
  assert.ok(doc.querySelector('#roundDet').innerHTML.length > 0, 'detail pane must render');
  assert.ok(doc.body.textContent.includes('Patient 1'));
});

test('the ring is really rendered, not the shell placeholder', async () => {
  // The shell ships <b id="ringN">0/8</b> from the prototype's demo ward.
  // Five seeded patients means a passing 0/5 cannot be the placeholder.
  const shell = await (await srv.request('/v2/')).text();
  assert.match(shell, /id="ringN">0\/8</, 'placeholder assumption changed — update this test');
  const window = await loadPage({ token: srv.token });
  assert.equal(window.document.querySelector('#ringN').textContent, '0/5');
});

test('without a token the page says so instead of showing an empty ward', async () => {
  const window = await loadPage({ token: null });
  const text = window.document.querySelector('#roundList').textContent;
  assert.match(text, /not signed in/i);
  assert.match(text, /signed in: no/i, 'the failure state must report token presence');
  assert.equal(window.__V2__.state.patients.length, 0);
});

test('an invalid token is reported as a rejected session, not as a missing one', async () => {
  const window = await loadPage({ token: 'definitely-not-a-valid-token' });
  const text = window.document.querySelector('#roundList').textContent;
  assert.match(text, /session was rejected/i);
  assert.match(text, /signed in: yes/i);
});

test('the request actually carries an Authorization: Bearer header', async () => {
  // Proven at the wire, not by reading data.js: an unauthenticated sync is
  // refused, the same call with the header succeeds.
  const anon = await srv.request('/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ since: 0, changes: [] }) });
  assert.equal(anon.status, 401);

  const authed = await srv.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + srv.token },
    body: JSON.stringify({ since: 0, changes: [] }) });
  assert.equal(authed.status, 200);
  assert.ok((await authed.json()).patients.length >= 5);
});

/* ── data hygiene, end to end ─────────────────────────────────────────── */

test('discharged and soft-deleted records never reach the ward', async () => {
  await srv.seed([
    patient(90, { id: 'http-discharged', status: 'discharged' }),
    patient(91, { id: 'http-deleted', deleted: true })
  ]);
  const window = await loadPage({ token: srv.token });
  const ids = window.__V2__.state.patients.map(p => p.id);
  assert.ok(!ids.includes('http-discharged'), 'discharged patients must not appear on the ward');
  assert.ok(!ids.includes('http-deleted'), 'soft-deleted patients must not appear on the ward');
});

test('the ward-meta record never renders as a phantom patient', async () => {
  await srv.seed([{ id: '__ward_meta__', defaultUnit: 'UNIT II' }]);
  const window = await loadPage({ token: srv.token });
  const ids = window.__V2__.state.patients.map(p => p.id);
  assert.ok(!ids.includes('__ward_meta__'));
  assert.ok(!window.document.body.textContent.includes('Unnamed'));
});

/* ── shapes found in real production data ─────────────────────────────── */

test('a patient with NO status still appears — on the ward, the board and the round', async () => {
  // Production has these: scripts/imaging-coverage.js reported an
  // "unknown" status bucket. board() filters on exact status values, so a
  // record that reached it unnormalised would be in no column at all —
  // the same class of defect as the 'discharge'/'fordischarge' drift.
  // data.js normalises `status: raw.status || 'preop'` before render sees
  // it, matching the main app's own default (public/app.js:2403).
  await srv.seed([patient(80, { id: 'http-nostatus', status: undefined, name: 'No Status' })]);
  const window = await loadPage({ token: srv.token });
  const api = window.__V2__;

  const vm = api.state.patients.find(p => p.id === 'http-nostatus');
  assert.ok(vm, 'a statusless patient must still reach the ward');
  assert.equal(vm.status, 'preop', 'missing status normalises to preop, as the main app does');
  assert.equal(vm.stat, 'Pre-op');

  api.go('ward');
  const board = window.document.querySelector('#board');
  assert.ok(board.textContent.includes('No Status'),
    'a statusless patient must appear in a board column, not vanish between them');
});

test('every ward patient lands in exactly one board column', async () => {
  const window = await loadPage({ token: srv.token });
  const api = window.__V2__;
  api.go('ward');
  const tiles = window.document.querySelectorAll('#board .tile');
  assert.equal(tiles.length, api.state.patients.length,
    'board tiles must account for every patient — no one may fall between columns');
});

/* ── real radiographs, end to end ─────────────────────────────────────── */

test('a stored X-ray renders as a real <img> and that URL actually serves the image', async () => {
  // Upload a real (tiny) JPEG through the real image endpoint, attach it to
  // a patient, then confirm the page renders an <img> whose src the server
  // genuinely serves. This is the whole point: v2 previously discarded the
  // image url and drew stand-in anatomy instead.
  // The endpoint takes a data URL in a JSON body (server.js:1184-1189),
  // matching how the main client uploads after canvas compression.
  const dataURL = 'data:image/jpeg;base64,'
    + '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////'
    + '////////////////////////////////////////////////2wBDAf//////////////'
    + '//////////////////////////////////////////////////////////////////wA'
    + 'ARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAA'
    + 'AAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAA'
    + 'AA/9oADAMBAAIRAxEAPwCdABmX/9k=';

  const up = await srv.request('/api/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + srv.token },
    body: JSON.stringify({ dataURL })
  });
  assert.equal(up.status, 200, 'image upload endpoint must accept the file');
  const { url } = await up.json();
  assert.match(url, /^\/api\/images\//);

  await srv.seed([patient(60, { id: 'http-withfilm', name: 'Has Film',
    images: [{ id: 'img1', type: 'postop', url }] })]);

  const window = await loadPage({ token: srv.token });
  const api = window.__V2__;

  // Rows deliberately carry a mark, not a film: a 27x33 radiograph is
  // unreadable and production films average 166 KB each. Select the
  // patient so the film loads where it can actually be seen.
  assert.equal(window.document.querySelectorAll('#roundList img').length, 0,
    'the round list must not download radiographs');
  api.state.idx = api.state.patients.findIndex(q => q.id === 'http-withfilm');
  assert.ok(api.state.idx >= 0, 'the seeded patient must be on the ward');
  api.go('round');

  const img = window.document.querySelector('#roundDet img');
  assert.ok(img, 'the selected patient\'s stored film must render as an <img>');
  assert.ok(img.getAttribute('src').startsWith(url), 'the src must be the stored image url');
  assert.match(img.getAttribute('src'), /token=/, '<img> cannot send a header, so the token rides the query');
  assert.equal(img.getAttribute('loading'), 'lazy');
  assert.ok(img.getAttribute('alt'), 'the image needs a real alt');

  // And the browser would actually get bytes back from that URL.
  const fetched = await srv.request(img.getAttribute('src'));
  assert.equal(fetched.status, 200, 'the rendered src must really serve the image');
  assert.match(fetched.headers.get('content-type') || '', /image\//);
  assert.match(fetched.headers.get('cache-control') || '', /max-age/,
    'images must be cacheable or every round re-downloads the ward');
});

test('an image URL without a token is refused — the query token is doing real work', async () => {
  const up = await srv.request('/api/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + srv.token },
    body: JSON.stringify({ dataURL: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//2Q==' })
  });
  const { url } = await up.json();
  const anon = await srv.request(url);
  assert.equal(anon.status, 401, 'stored films must not be readable without auth');
});
