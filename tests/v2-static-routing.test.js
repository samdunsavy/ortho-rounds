// tests/v2-static-routing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStaticPath } from '../static-path.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

test('root resolves to index.html', () => {
  assert.equal(resolveStaticPath('/', PUBLIC_DIR), '/index.html');
});

test('trailing-slash directory resolves to its index.html', () => {
  assert.equal(resolveStaticPath('/v2/', PUBLIC_DIR), '/v2/index.html');
});

test('bare directory name resolves to its index.html', () => {
  assert.equal(resolveStaticPath('/icons', PUBLIC_DIR), '/icons/index.html');
});

test('a real file path is returned unchanged', () => {
  assert.equal(resolveStaticPath('/app.js', PUBLIC_DIR), '/app.js');
});

test('a nested file path is returned unchanged', () => {
  assert.equal(resolveStaticPath('/v2/css/tokens.css', PUBLIC_DIR), '/v2/css/tokens.css');
});

test('a path with an extension is never treated as a directory', () => {
  assert.equal(resolveStaticPath('/manifest.webmanifest', PUBLIC_DIR), '/manifest.webmanifest');
});

test('a bare name that looks like a directory but does not exist is returned unchanged', () => {
  assert.equal(resolveStaticPath('/nonexistent-dir', PUBLIC_DIR), '/nonexistent-dir');
});
