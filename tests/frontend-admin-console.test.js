import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

export const TREE = {
  totals: { hospitals: 1, departments: 1, units: 2, wards: 1, usersActive: 2, usersDisabled: 0, livePatients: 5 },
  org: { id: 'bfv2-org', name: 'Default', stats: { livePatients: 5, byStatus: { postop: 3, preop: 1, conservative: 1, fordischarge: 0 }, users: 3, lastActivity: Date.now() - 60000 } },
  hospitals: [{ id: 'h1', name: 'City Hospital', stats: { livePatients: 5, byStatus: { postop: 3, preop: 1, conservative: 1, fordischarge: 0 }, users: 2, lastActivity: Date.now() - 60000 }, departments: [
    { id: 'd1', name: 'Ortho', specialty: 'ortho',
      stats: { livePatients: 5, byStatus: { postop: 3, preop: 1, conservative: 1, fordischarge: 0 }, users: 2, lastActivity: Date.now() - 60000 },
      units: [
        { id: 'u1', name: 'IV',
          stats: { livePatients: 4, byStatus: { postop: 3, preop: 1, conservative: 0, fordischarge: 0 }, users: 1, lastActivity: Date.now() - 60000 },
          wards: [{ id: 'w1', name: '7MOW', stats: { livePatients: 4, byStatus: { postop: 3, preop: 1, conservative: 0, fordischarge: 0 }, users: 0, lastActivity: null } }] },
        { id: 'u2', name: 'General',
          stats: { livePatients: 1, byStatus: { postop: 0, preop: 0, conservative: 1, fordischarge: 0 }, users: 1, lastActivity: null },
          wards: [] }
      ] }
  ]}]
};

function orgAdminEnv(){
  const env = loadFrontendEnv();
  const calls = [];
  env.window.api = async (path, opts) => {
    calls.push({ path, opts });
    if(path.startsWith('/api/admin/org')) return TREE;
    if(path === '/api/admin/users') return { users: [] };
    return {};
  };
  return Object.assign({ calls }, env);
}

describe('admin console shell: section tabs', () => {
  test('org admin sees 3 tabs (no Organizations); instance admin sees 4', () => {
    const { window, document } = orgAdminEnv();
    window.renderAdminSectionTabs();
    assert.deepEqual(
      [...document.querySelectorAll('[data-admin-section]')].map(b => b.dataset.adminSection),
      ['overview', 'people', 'structure']
    );
    window.localStorage.setItem('ortho_role', 'admin'); // admin + no org id => instance admin
    window.renderAdminSectionTabs();
    assert.deepEqual(
      [...document.querySelectorAll('[data-admin-section]')].map(b => b.dataset.adminSection),
      ['overview', 'people', 'structure', 'orgs']
    );
  });

  test('the active tab is marked aria-selected and is the only one with tabindex 0', () => {
    const { window, document } = orgAdminEnv();
    window.renderAdminSectionTabs();
    const overviewTab = document.querySelector('[data-admin-section="overview"]');
    assert.equal(overviewTab.getAttribute('aria-selected'), 'true');
    assert.equal(overviewTab.getAttribute('tabindex'), '0');
    const peopleTab = document.querySelector('[data-admin-section="people"]');
    assert.equal(peopleTab.getAttribute('aria-selected'), 'false');
    assert.equal(peopleTab.getAttribute('tabindex'), '-1');
  });

  test('switchAdminSection shows the target section and hides the others', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    window.switchAdminSection('people');
    assert.equal(document.getElementById('adminPeopleSection').hidden, false);
    assert.equal(document.getElementById('adminOverviewSection').hidden, true);
    assert.equal(document.getElementById('adminStructureSection').hidden, true);
    assert.equal(document.querySelector('[data-admin-section="people"]').getAttribute('aria-selected'), 'true');
  });

  test('clicking a tab switches sections', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    document.querySelector('[data-admin-section="structure"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminStructureSection').hidden, false);
  });

  test('ArrowRight moves to the next tab and activates it; Home jumps to the first', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    const tabs = document.getElementById('adminSectionTabs');
    tabs.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(document.getElementById('adminPeopleSection').hidden, false);
    tabs.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(document.getElementById('adminStructureSection').hidden, false);
    tabs.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assert.equal(document.getElementById('adminOverviewSection').hidden, false);
  });

  test('an unrecognised or unavailable section falls back to Overview on render', () => {
    const { window, document } = orgAdminEnv();
    window.switchAdminSection('orgs'); // org admin: 'orgs' is not visible to them
    window.renderAdminSectionTabs();
    assert.equal(document.getElementById('adminOverviewSection').hidden, false);
  });
});

describe('admin console shell: data load populates People even with no org chosen (instance admin)', () => {
  test('an instance admin with no viewed org still gets every user in adminData, and Structure/Overview show a chooser', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [{ id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 0, departments: 0, users: 1, livePatients: 0 } }] };
      if(path === '/api/admin/users') return { users: [{ id: 'u9', username: 'crossorg', role: 'member', active: true, orgId: 'o1', assignmentType: null, assignmentId: null }] };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    assert.ok(document.getElementById('adminPeopleSection').innerHTML.includes('crossorg'));
    window.switchAdminSection('structure');
    assert.ok(document.getElementById('adminStructureChooser').hidden === false);
    window.switchAdminSection('overview');
    assert.ok(document.getElementById('adminOverviewChooser').hidden === false);
  });
});

// Ported from the old tests/frontend-admin-view.test.js, which this file's
// predecessor already superseded once for the tree/detail/stat-tile
// coverage; these two are its last survivors.
describe('admin visibility (ported from frontend-admin-view.test.js)', () => {
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

  test('flag off: admin entries stay hidden even for admins, and the view renders nothing', () => {
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

describe('Overview section', () => {
  test('renders the four stat tiles from the loaded tree', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    const tiles = [...document.querySelectorAll('#adminStatTiles .admin-stat-tile')];
    assert.equal(tiles.length, 4);
    assert.match(tiles.map(t => t.textContent).join(' '), /5/); // live patients
  });
});

describe('Overview: computeAdminNeedsAttention', () => {
  const users = [
    { id: 'u1', username: 'unassigned1', active: true, role: 'member', assignmentType: null, assignmentId: null },
    { id: 'u2', username: 'stale1', active: true, role: 'member', assignmentType: 'unit', assignmentId: 'gone' },
    { id: 'u3', username: 'fine1', active: true, role: 'member', assignmentType: 'unit', assignmentId: 'u1' },
    { id: 'u4', username: 'off1', active: false, role: 'member', assignmentType: 'unit', assignmentId: 'u1' }
  ];
  const withEmptyUnit = JSON.parse(JSON.stringify(TREE));
  withEmptyUnit.hospitals[0].departments[0].units.push({ id: 'u-empty', name: 'Empty Unit', stats: { livePatients: 0, byStatus: { postop: 0, preop: 0, conservative: 0, fordischarge: 0 }, users: 0, lastActivity: null }, wards: [] });

  test('categorizes unassigned, stale, empty-unit and disabled', () => {
    const { window } = loadFrontendEnv();
    const cats = window.computeAdminNeedsAttention(withEmptyUnit, users);
    assert.deepEqual([...cats.unassigned.map(u => u.id)], ['u1']);
    assert.deepEqual([...cats.stale.map(u => u.id)], ['u2']);
    assert.deepEqual([...cats.emptyUnits.map(u => u.id)], ['u-empty']);
    assert.deepEqual([...cats.disabled.map(u => u.id)], ['u4']);
  });

  test('a unit with wards, patients or users is not "empty"', () => {
    const { window } = loadFrontendEnv();
    const cats = window.computeAdminNeedsAttention(TREE, []);
    assert.deepEqual([...cats.emptyUnits], []); // u1 has patients+wards, u2 has a user
  });

  test('renderAdminNeedsAttentionHTML omits a category with zero entries', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminNeedsAttentionHTML({ unassigned: [], stale: [], emptyUnits: [], disabled: [] });
    assert.equal(html, '');
  });

  test('renderAdminNeedsAttentionHTML lists a populated category', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminNeedsAttentionHTML({ unassigned: [{ id: 'u1', username: 'unassigned1' }], stale: [], emptyUnits: [], disabled: [] });
    assert.ok(html.includes('unassigned1'));
    assert.ok(html.includes('data-attention-people="unassigned"'));
  });
});

describe('Overview: quick actions', () => {
  test('Add person switches to People and focuses the create form', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    document.getElementById('adminQuickAddPerson').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminPeopleSection').hidden, false);
    assert.equal(document.activeElement.id, 'adminNewUsername');
  });

  test('Fix an assignment switches to People with the Unassigned filter active', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    document.getElementById('adminQuickFixAssignment').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminPeopleSection').hidden, false);
    assert.equal(document.getElementById('adminPeopleSection').dataset.peopleFilter, 'unassigned');
  });

  test('Add ward switches to Structure and selects the first unit', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    document.getElementById('adminQuickAddWard').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminStructureSection').hidden, false);
    assert.equal(document.querySelector('[data-node="unit:u1"]').classList.contains('is-selected'), true);
    assert.ok(document.querySelector('[data-new-child-name="unit:u1"]'));
  });

  test('a category entry navigates and filters: an empty-unit entry selects that unit in Structure', async () => {
    const { window, document } = orgAdminEnv();
    const withEmptyUnit = JSON.parse(JSON.stringify(TREE));
    withEmptyUnit.hospitals[0].departments[0].units.push({ id: 'u-empty', name: 'Empty Unit', stats: { livePatients: 0, byStatus: { postop: 0, preop: 0, conservative: 0, fordischarge: 0 }, users: 0, lastActivity: null }, wards: [] });
    window.api = async (path) => path.startsWith('/api/admin/org') ? withEmptyUnit : { users: [] };
    await window.loadAdminView();
    document.querySelector('[data-attention-unit="u-empty"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminStructureSection').hidden, false);
    assert.equal(document.querySelector('[data-node="unit:u-empty"]').classList.contains('is-selected'), true);
  });
});

describe('loadAdminView atomic adminData (Task 1 review fixes)', () => {
  test('failed tree fetch leaves prior DOM unchanged', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    window.switchAdminSection('people');
    const before = document.getElementById('adminPeopleSection').innerHTML;
    window.api = async (path) => {
      if(path === '/api/admin/users') return { users: [{ id: 'new1', username: 'should-not-render', role: 'member', active: true, orgId: null, assignmentType: null, assignmentId: null }] };
      if(path.startsWith('/api/admin/org')) throw new Error('tree fetch failed');
      return {};
    };
    await assert.rejects(() => window.loadAdminView(), /tree fetch failed/);
    assert.equal(document.getElementById('adminPeopleSection').innerHTML, before);
  });

  test('stale loadAdminView completion is ignored when a newer load finishes first', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    let resolveTreeA;
    const treeAPending = new Promise(r => { resolveTreeA = r; });
    const TREE_A = {
      org: { id: 'o1', name: 'Org Alpha', stats: { livePatients: 1, byStatus: {}, users: 0, lastActivity: null } },
      totals: { departments: 0, usersActive: 0, livePatients: 1 },
      hospitals: [{ id: 'h-alpha', name: 'Alpha Hospital', stats: { livePatients: 1, byStatus: {}, users: 0, lastActivity: null }, departments: [] }]
    };
    const TREE_B = {
      org: { id: 'o2', name: 'Org Beta', stats: { livePatients: 2, byStatus: {}, users: 0, lastActivity: null } },
      totals: { departments: 0, usersActive: 0, livePatients: 2 },
      hospitals: [{ id: 'h-beta', name: 'Beta Hospital', stats: { livePatients: 2, byStatus: {}, users: 0, lastActivity: null }, departments: [] }]
    };
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [
        { id: 'o1', name: 'Org Alpha', plan: 'free', stats: { hospitals: 1, departments: 0, users: 0, livePatients: 1 } },
        { id: 'o2', name: 'Org Beta', plan: 'free', stats: { hospitals: 1, departments: 0, users: 0, livePatients: 2 } }
      ] };
      if(path === '/api/admin/users') return { users: [] };
      if(path === '/api/admin/org?orgId=o1'){ await treeAPending; return TREE_A; }
      if(path === '/api/admin/org?orgId=o2') return TREE_B;
      return {};
    };
    await window.loadAdminView();
    window.enterAdminOrgContext('o1');
    await new Promise(r => setTimeout(r, 0));
    window.enterAdminOrgContext('o2');
    await new Promise(r => setTimeout(r, 0));
    window.switchAdminSection('structure');
    const rail = () => document.getElementById('adminTreeRail').innerHTML;
    assert.ok(rail().includes('Beta Hospital'));
    assert.ok(!rail().includes('Alpha Hospital'));
    resolveTreeA(TREE_A);
    await new Promise(r => setTimeout(r, 0));
    assert.ok(rail().includes('Beta Hospital'));
    assert.ok(!rail().includes('Alpha Hospital'));
  });
});
