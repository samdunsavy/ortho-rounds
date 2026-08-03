// tests/v2-static-routing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveStaticPath } from '../static-path.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

test('root resolves to index.html', () => {
  assert.deepEqual(resolveStaticPath('/', PUBLIC_DIR), { file: '/index.html' });
});

test('trailing-slash directory resolves to its index.html', () => {
  assert.deepEqual(resolveStaticPath('/v2/', PUBLIC_DIR), { file: '/v2/index.html' });
});

test('a real file path is returned unchanged', () => {
  assert.deepEqual(resolveStaticPath('/app.js', PUBLIC_DIR), { file: '/app.js' });
});

test('a nested file path is returned unchanged', () => {
  assert.deepEqual(resolveStaticPath('/v2/css/tokens.css', PUBLIC_DIR),
    { file: '/v2/css/tokens.css' });
});

test('a path with an extension is never treated as a directory', () => {
  assert.deepEqual(resolveStaticPath('/manifest.webmanifest', PUBLIC_DIR),
    { file: '/manifest.webmanifest' });
});

test('a bare name that looks like a directory but does not exist is returned unchanged', () => {
  assert.deepEqual(resolveStaticPath('/nonexistent-dir', PUBLIC_DIR),
    { file: '/nonexistent-dir' });
});

/* The regression this file exists for. Serving /v2/index.html at the URL
   /v2 leaves the browser's base URL one level too high, so the document's
   relative references resolve wrongly. A redirect is the only correct
   answer. */

test('a bare directory URL REDIRECTS to its trailing-slash form, never serves the index in place', () => {
  assert.deepEqual(resolveStaticPath('/v2', PUBLIC_DIR), { redirect: '/v2/' });
  assert.deepEqual(resolveStaticPath('/icons', PUBLIC_DIR), { redirect: '/icons/' });
});

test('a directory resolution never returns a file — that is what broke the page', () => {
  const r = resolveStaticPath('/v2', PUBLIC_DIR);
  assert.equal(r.file, undefined,
    'serving a bare directory URL as a file breaks every relative href in the document');
});

test('v2/index.html references its assets relatively, which is why the redirect is load-bearing', () => {
  const html = readFileSync(path.join(PUBLIC_DIR, 'v2', 'index.html'), 'utf8');
  const rel = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)]
    .map(m => m[1])
    .filter(u => !/^(https?:)?\/\//.test(u) && !u.startsWith('/'));
  const bare = rel.map(u => u.split('?')[0]);
  assert.ok(bare.includes('css/tokens.css'),
    'stylesheets are relative, so they resolve against the base URL');
  assert.ok(bare.includes('app.js'),
    'app.js is relative — at the URL /v2 it would resolve to /app.js, the MAIN app script');
});
