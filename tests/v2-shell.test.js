// tests/v2-shell.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
