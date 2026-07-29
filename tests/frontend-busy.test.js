import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFrontendEnv } from './helpers/frontend-env.js';

const INDEX_HTML = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html'),
  'utf8'
);

describe('is-busy CSS scoping', () => {
  test('control busy rules do not use bare .is-busy (spares .admin-view.is-busy)', () => {
    // Global opacity/spinner must not match #adminView.admin-view.is-busy.
    assert.equal(/\n\s*\.is-busy\s*\{/.test(INDEX_HTML), false);
    assert.equal(/\n\s*\.is-busy::after\s*\{/.test(INDEX_HTML), false);
    assert.match(INDEX_HTML, /button\.is-busy\s*,\s*\.btn\.is-busy\s*,\s*\[role=button\]\.is-busy\s*,\s*\.xray-add\.is-busy\s*\{/);
    assert.match(INDEX_HTML, /\.admin-view\.is-busy/);
  });
});

describe('withBusy', () => {
  test('sets busy class, aria-busy, and disabled on a button then clears', async () => {
    const { window, document } = loadFrontendEnv();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    let ran = false;
    const p = window.withBusy(btn, async () => {
      assert.equal(btn.dataset.busy, '1');
      assert.equal(btn.classList.contains('is-busy'), true);
      assert.equal(btn.getAttribute('aria-busy'), 'true');
      assert.equal(btn.disabled, true);
      ran = true;
    });
    await p;
    assert.equal(ran, true);
    assert.equal(btn.dataset.busy, undefined);
    assert.equal(btn.classList.contains('is-busy'), false);
    assert.equal(btn.disabled, false);
  });

  test('second call while in flight is a no-op', async () => {
    const { window, document } = loadFrontendEnv();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    let release;
    const gate = new Promise(r => { release = r; });
    let runs = 0;
    const first = window.withBusy(btn, async () => { runs++; await gate; });
    const second = window.withBusy(btn, async () => { runs++; });
    assert.equal(second, undefined);
    release();
    await first;
    assert.equal(runs, 1);
  });

  test('clears busy when fn throws', async () => {
    const { window, document } = loadFrontendEnv();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await assert.rejects(() => window.withBusy(btn, async () => { throw new Error('boom'); }), /boom/);
    assert.equal(btn.classList.contains('is-busy'), false);
    assert.equal(btn.disabled, false);
  });

  test('non-button gets aria-disabled instead of disabled', async () => {
    const { window, document } = loadFrontendEnv();
    const el = document.createElement('div');
    el.setAttribute('role', 'button');
    document.body.appendChild(el);
    await window.withBusy(el, async () => {
      assert.equal(el.getAttribute('aria-disabled'), 'true');
      assert.equal(el.disabled, undefined);
    });
    assert.equal(el.getAttribute('aria-disabled'), null);
  });

  test('isBusy reflects dataset.busy', async () => {
    const { window, document } = loadFrontendEnv();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    assert.equal(window.isBusy(btn), false);
    let release;
    const gate = new Promise(r => { release = r; });
    const p = window.withBusy(btn, async () => { await gate; });
    assert.equal(window.isBusy(btn), true);
    release();
    await p;
    assert.equal(window.isBusy(btn), false);
  });
});
