import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

const TREE = {
  totals: { hospitals: 1, departments: 2, usersActive: 3, usersDisabled: 1, livePatients: 7 },
  hospitals: [{ id: 'h1', name: 'City Hospital', wards: [
    { id: 'w1', name: 'Ortho', specialty: 'ortho',
      stats: { livePatients: 5, byStatus: { postop: 3, preop: 1, conservative: 1, fordischarge: 0 }, users: 2, lastActivity: Date.now() - 60000 } },
    { id: 'w2', name: 'Surgery', specialty: 'surgery',
      stats: { livePatients: 2, byStatus: { postop: 2, preop: 0, conservative: 0, fordischarge: 0 }, users: 1, lastActivity: null } }
  ]}]
};
const USERS = [
  { id: 'u1', username: 'boss', role: 'admin', active: true, createdAt: 1, wardId: null, orgId: 'o1' },
  { id: 'u2', username: 'pg9', role: 'member', active: true, createdAt: 2, wardId: 'w1', orgId: 'o1' }
];

describe('admin view rendering', () => {
  test('adminUiVisible: only admin + MULTI_TENANT flag', () => {
    const { window } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.serverFlags = { MULTI_TENANT: true };
    assert.equal(window.adminUiVisible(), true);
    window.serverFlags = { MULTI_TENANT: false };
    assert.equal(window.adminUiVisible(), false);
    window.localStorage.setItem('ortho_role', 'member');
    window.serverFlags = { MULTI_TENANT: true };
    assert.equal(window.adminUiVisible(), false);
  });

  test('renderAdminView paints stat tiles, department cards, user rows', () => {
    const { window, document } = loadFrontendEnv();
    window.renderAdminView(TREE, USERS);
    const tiles = [...document.querySelectorAll('#adminStatTiles .admin-stat-tile')];
    assert.equal(tiles.length, 4);
    const tileText = tiles.map(t => t.textContent).join(' ');
    assert.match(tileText, /2/);  // departments
    assert.match(tileText, /3/);  // active users
    assert.match(tileText, /7/);  // live patients
    assert.match(tileText, /5/);  // post-op (3+2)
    const cards = document.querySelectorAll('#adminOrgSection .admin-dept-card');
    assert.equal(cards.length, 2);
    assert.match(cards[0].textContent, /Ortho/);
    assert.ok(cards[0].querySelector('.admin-status-bar'), 'department card has a status bar');
    const rows = document.querySelectorAll('#adminUsersSection tbody tr');
    assert.equal(rows.length, 2);
    const sel = rows[1].querySelector('select[data-assign-user="u2"]');
    assert.ok(sel, 'member row has an assign select');
    assert.equal(sel.value, 'w1');
  });

  test('assign select fires the assign endpoint', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return { ok: true }; };
    window.renderAdminView(TREE, USERS);
    const sel = document.querySelector('select[data-assign-user="u2"]');
    sel.value = 'w2';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/admin/users/u2/assign');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { wardId: 'w2' });
  });

  test('orgs tab renders rollup cards (instance admin surface)', () => {
    const { window, document } = loadFrontendEnv();
    window.renderAdminOrgsTab([
      { id: 'o1', name: 'Pilot Org', plan: 'free', createdAt: 1, stats: { hospitals: 1, departments: 2, users: 4, livePatients: 7 } }
    ]);
    const cards = document.querySelectorAll('#adminOrgsTab .admin-org-card');
    assert.equal(cards.length, 1);
    assert.match(cards[0].textContent, /Pilot Org/);
    assert.match(cards[0].textContent, /7/);
  });
});
