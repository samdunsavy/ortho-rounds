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
