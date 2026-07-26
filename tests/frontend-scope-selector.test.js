import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

describe('active scope persistence', () => {
  test('set/get round-trips through localStorage; null clears', () => {
    const { window } = loadFrontendEnv();
    window.setActiveScope({ type: 'department', id: 'dep1' });
    assert.deepEqual({ ...window.getActiveScope() }, { type: 'department', id: 'dep1' });
    window.setActiveScope(null);
    assert.equal(window.getActiveScope(), null);
  });
});

describe('syncNow sends activeScope', () => {
  test('the chosen scope rides on the sync request body', async () => {
    const { window } = loadFrontendEnv();
    window.localStorage.setItem('ortho_token', 't');
    window.setActiveScope({ type: 'unit', id: 'u1' });
    let sentBody = null;
    window.fetch = async (url, opts) => {
      if(String(url).includes('/api/sync')){
        sentBody = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ serverTime: 1, patients: [], apiVersion: 1, scoped: true, rejected: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await window.syncNow({});
    assert.deepEqual(sentBody.activeScope, { type: 'unit', id: 'u1' });
  });
});

describe('logout clears activeScope', () => {
  test('logout() removes LS_ACTIVE_SCOPE so next user starts fresh', () => {
    const { window } = loadFrontendEnv();
    window.localStorage.setItem('ortho_token', 't');
    window.localStorage.setItem('ortho_role', 'admin');
    window.setActiveScope({ type: 'unit', id: 'u1' });
    assert.equal(window.getActiveScope() !== null, true);
    try {
      window.logout();
    } catch (e) {
      // logout may have side effects (e.g., DOM updates); we test the narrow unit anyway
    }
    assert.equal(window.getActiveScope(), null);
  });
});
