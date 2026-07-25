import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

// NOTE: this suite used to cover renderAdminView (single-column layout:
// department cards, unit rows, ward chips, users table) and the assign
// <select> it painted. The command-center shell (public/admin-console.js)
// replaced that renderer with a tree navigator + a stub detail panel — see
// tests/frontend-admin-console.test.js for the porting of that coverage:
// tree-row assertions, stat tiles via renderAdminStatTilesInto, the
// buildAssignNodeGroups/renderAssignSelectOptionsHTML grouping logic, and
// the delegated assign-select change handler (still live, just no longer
// fed by renderAdminView). Department-card status-bar and per-node
// add-child form assertions were dropped here because that markup doesn't
// exist yet — it lands in the detail panel in Task 3.

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

describe('flag OFF — zero admin UI', () => {
  test('admin entries stay hidden even for admins', () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.serverFlags = {};
    window.updateAccountUI();
    const btn = document.getElementById('moreAdminBtn');
    assert.ok(btn, 'button exists in DOM');
    assert.equal(btn.style.display, 'none');
    assert.equal(document.getElementById('adminView').hidden, true);
  });
});
