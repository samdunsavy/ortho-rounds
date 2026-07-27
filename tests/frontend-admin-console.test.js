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

describe('admin icon system', () => {
  test('icon() returns an svg use reference to the sprite', () => {
    const { window } = orgAdminEnv();
    const html = window.icon('users');
    assert.match(html, /<svg class="ic[^"]*" aria-hidden="true"><use href="#ic-users"\/><\/svg>/);
  });
  test('icon() applies an extra class', () => {
    const { window } = orgAdminEnv();
    assert.match(window.icon('trash', 'ic-lg'), /class="ic ic-lg"/);
  });
  test('the sprite defines every glyph icon() will be asked for', () => {
    const { document } = orgAdminEnv();
    for(const id of ['ic-dashboard','ic-users','ic-sitemap','ic-hospital','ic-arrow-left',
      'ic-stethoscope','ic-user-check','ic-bed','ic-activity','ic-alert-triangle',
      'ic-chevron-right','ic-chevron-down','ic-plus','ic-edit','ic-trash',
      'ic-map-pin-off','ic-box-off','ic-search']){
      assert.ok(document.getElementById(id), `missing sprite symbol ${id}`);
    }
  });
});

describe('admin console shell: sidebar nav', () => {
  test('org admin sees 3 nav items (no Organizations); instance admin sees 4', () => {
    const { window, document } = orgAdminEnv();
    window.renderAdminSidebarNav();
    assert.deepEqual(
      [...document.querySelectorAll('#adminSidebarNav [data-admin-section]')].map(b => b.dataset.adminSection),
      ['overview', 'people', 'structure']
    );
    window.localStorage.setItem('ortho_role', 'admin');
    window.renderAdminSidebarNav();
    assert.deepEqual(
      [...document.querySelectorAll('#adminSidebarNav [data-admin-section]')].map(b => b.dataset.adminSection),
      ['overview', 'people', 'structure', 'orgs']
    );
  });
  test('the active nav item has aria-current=page and no other does', () => {
    const { window, document } = orgAdminEnv();
    window.renderAdminSidebarNav();
    const current = document.querySelectorAll('#adminSidebarNav [aria-current="page"]');
    assert.equal(current.length, 1);
    assert.equal(current[0].dataset.adminSection, 'overview');
  });
  test('each nav item carries an icon svg', () => {
    const { window, document } = orgAdminEnv();
    window.renderAdminSidebarNav();
    const overview = document.querySelector('#adminSidebarNav [data-admin-section="overview"]');
    assert.ok(overview.querySelector('svg.ic use'));
  });
  test('loadAdminView stamps and shows the "updated" timestamp', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    const stamp = document.getElementById('adminUpdatedStamp');
    assert.equal(stamp.hidden, false);
    assert.match(stamp.textContent, /updated \d{1,2}:\d{2}/);
  });

  test('switchAdminSection shows the target section and hides the others', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    window.switchAdminSection('people');
    assert.equal(document.getElementById('adminPeopleSection').hidden, false);
    assert.equal(document.getElementById('adminOverviewSection').hidden, true);
    assert.equal(document.getElementById('adminStructureSection').hidden, true);
    assert.equal(document.querySelector('[data-admin-section="people"]').getAttribute('aria-current'), 'page');
  });

  test('clicking a nav item switches sections', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    document.querySelector('[data-admin-section="structure"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminStructureSection').hidden, false);
  });

  test('ArrowDown moves to the next nav item and activates it; Home jumps to the first', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    const nav = document.getElementById('adminSidebarNav');
    nav.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(document.getElementById('adminPeopleSection').hidden, false);
    nav.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(document.getElementById('adminStructureSection').hidden, false);
    nav.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assert.equal(document.getElementById('adminOverviewSection').hidden, false);
  });

  test('an unrecognised or unavailable section falls back to Overview on render', () => {
    const { window, document } = orgAdminEnv();
    window.switchAdminSection('orgs'); // org admin: 'orgs' is not visible to them
    window.renderAdminSidebarNav();
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

describe('admin overview dashboard', () => {
  test('each stat tile has an icon', () => {
    const { window, document } = orgAdminEnv();
    document.getElementById('adminStatTiles').innerHTML = window.renderAdminStatTiles(TREE);
    assert.equal(document.querySelectorAll('#adminStatTiles .admin-stat-tile svg.ic').length, 4);
  });
  test('overview renders an org-level status bar', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    window.switchAdminSection('overview');
    assert.ok(document.querySelector('#adminOverviewStatusBar .admin-status-bar'));
  });
  test('needs-attention rows keep their data hooks and gain icons', () => {
    const { window } = orgAdminEnv();
    const cats = { unassigned: [{ username: 'x' }], stale: [], emptyUnits: [], disabled: [] };
    const html = window.renderAdminNeedsAttentionHTML(cats);
    assert.match(html, /data-attention-people="unassigned"/);
    assert.match(html, /<svg class="ic/);
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

  test('org-assigned user is not categorized as stale when org is in orgs list', () => {
    const { window } = loadFrontendEnv();
    const users = [
      { id: 'u-org', username: 'amy', active: true, role: 'member', assignmentType: 'org', assignmentId: 'bfv2-org' }
    ];
    const orgs = [{ id: 'bfv2-org', name: 'Default' }];
    const cats = window.computeAdminNeedsAttention(TREE, users, orgs);
    assert.deepEqual([...cats.stale.map(u => u.id)], []);
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

  test('renderAdminNeedsAttentionHTML uses exact stale-assignment copy (capital A)', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminNeedsAttentionHTML({
      unassigned: [], stale: [{ id: 'u2', username: 'stale1' }], emptyUnits: [], disabled: []
    });
    assert.ok(html.includes('Assigned to a place that no longer exists'));
    assert.ok(!html.includes('assigned to a place that no longer exists'));
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
    assert.equal(window.getAdminPeopleFilter(), 'unassigned');
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

describe('admin soft busy state', () => {
  test('loadAdminView sets is-busy and shows Updating… until the fetch finishes', async () => {
    const { window, document } = loadFrontendEnv();
    let resolveUsers;
    const usersPending = new Promise(r => { resolveUsers = r; });
    window.api = async (path) => {
      if(path === '/api/admin/users'){ await usersPending; return { users: [] }; }
      if(path.startsWith('/api/admin/org')) return {
        org: { id: 'bfv2-org', name: 'Default', stats: { livePatients: 0, byStatus: {}, users: 0, lastActivity: null } },
        totals: { hospitals: 0, departments: 0, units: 0, wards: 0, usersActive: 0, usersDisabled: 0, livePatients: 0 },
        hospitals: []
      };
      return {};
    };
    document.getElementById('adminView').hidden = false;
    const p = window.loadAdminView();
    await new Promise(r => setTimeout(r, 0));
    const view = document.getElementById('adminView');
    assert.equal(view.classList.contains('is-busy'), true);
    assert.equal(view.getAttribute('aria-busy'), 'true');
    const status = document.getElementById('adminBusyStatus');
    assert.ok(status);
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /Updating/);
    resolveUsers({ users: [] });
    await p;
    assert.equal(view.classList.contains('is-busy'), false);
    assert.equal(view.getAttribute('aria-busy'), 'false');
    assert.equal(status.hidden, true);
  });

  test('a failed loadAdminView clears busy and still surfaces the error', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async () => { throw new window.Error('network down'); };
    document.getElementById('adminView').hidden = false;
    await assert.rejects(() => window.loadAdminView(), /network down/);
    assert.equal(document.getElementById('adminView').classList.contains('is-busy'), false);
    assert.equal(document.getElementById('adminBusyStatus').hidden, true);
  });

  test('a stale overlapping load does not clear a newer load\'s busy flag', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin'); // instance admin
    let resolveUsersA;
    const usersAPending = new Promise(r => { resolveUsersA = r; });
    let resolveUsersB;
    const usersBPending = new Promise(r => { resolveUsersB = r; });
    let call = 0;
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [
        { id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }
      ] };
      if(path === '/api/admin/users'){
        call += 1;
        if(call === 1){ await usersAPending; return { users: [] }; }
        await usersBPending;
        return { users: [] };
      }
      return {};
    };
    document.getElementById('adminView').hidden = false;
    const pA = window.loadAdminView();
    await new Promise(r => setTimeout(r, 0));
    const pB = window.loadAdminView();
    resolveUsersA({ users: [] });
    await pA;
    const view = document.getElementById('adminView');
    const status = document.getElementById('adminBusyStatus');
    assert.equal(view.classList.contains('is-busy'), true,
      'stale A finished while B is pending — busy must remain set');
    assert.equal(status.hidden, false,
      'stale A finished while B is pending — busy status must remain visible');
    resolveUsersB({ users: [] });
    await pB;
    assert.equal(view.classList.contains('is-busy'), false,
      'B finished — busy must clear');
    assert.equal(status.hidden, true,
      'B finished — busy status must hide');
  });

  test('switching sections without loadAdminView does not flash busy', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => {
      if(path.startsWith('/api/admin/org')) return {
        org: { id: 'bfv2-org', name: 'Default', stats: { livePatients: 0, byStatus: {}, users: 0, lastActivity: null } },
        totals: { hospitals: 0, departments: 0, units: 0, wards: 0, usersActive: 0, usersDisabled: 0, livePatients: 0 },
        hospitals: []
      };
      if(path === '/api/admin/users') return { users: [] };
      return {};
    };
    await window.loadAdminView();
    assert.equal(document.getElementById('adminView').classList.contains('is-busy'), false);
    window.switchAdminSection('people');
    assert.equal(document.getElementById('adminView').classList.contains('is-busy'), false);
    assert.equal(document.getElementById('adminBusyStatus').hidden, true);
  });
});

describe('admin visual polish hooks', () => {
  test('Admin title uses the admin-view-title class for hierarchy styling', () => {
    const { document } = loadFrontendEnv();
    const title = document.getElementById('adminContextTitle');
    assert.ok(title);
    assert.ok(title.classList.contains('admin-view-title'));
  });

  test('stat tiles and structure panels use elevated card surfaces (shadow token)', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => {
      if(path.startsWith('/api/admin/org')) return {
        org: { id: 'bfv2-org', name: 'Default', stats: { livePatients: 5, byStatus: { postop: 3, preop: 1, conservative: 1, fordischarge: 0 }, users: 2, lastActivity: null } },
        totals: { hospitals: 1, departments: 1, units: 1, wards: 1, usersActive: 2, usersDisabled: 0, livePatients: 5 },
        hospitals: [{ id: 'h1', name: 'City', stats: { livePatients: 5, byStatus: {}, users: 2, lastActivity: null }, departments: [
          { id: 'd1', name: 'Ortho', specialty: 'ortho', stats: { livePatients: 5, byStatus: {}, users: 2, lastActivity: null }, units: [
            { id: 'u1', name: 'IV', stats: { livePatients: 5, byStatus: {}, users: 1, lastActivity: null }, wards: [] }
          ] }
        ] }]
      };
      if(path === '/api/admin/users') return { users: [] };
      return {};
    };
    await window.loadAdminView();
    const tile = document.querySelector('#adminStatTiles .admin-stat-tile');
    assert.ok(tile);
    const tileShadow = window.getComputedStyle(tile).boxShadow;
    assert.equal(tileShadow, 'var(--shadow-sm)');
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    const rail = document.getElementById('adminTreeRail');
    const detail = document.getElementById('adminDetailPane');
    assert.equal(window.getComputedStyle(rail).boxShadow, 'var(--shadow-sm)');
    assert.equal(window.getComputedStyle(detail).boxShadow, 'var(--shadow-sm)');
  });

  test('selected nav item uses accent-soft fill', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => {
      if(path.startsWith('/api/admin/org')) return {
        org: { id: 'bfv2-org', name: 'Default', stats: { livePatients: 0, byStatus: {}, users: 0, lastActivity: null } },
        totals: { hospitals: 0, departments: 0, units: 0, wards: 0, usersActive: 0, usersDisabled: 0, livePatients: 0 },
        hospitals: []
      };
      if(path === '/api/admin/users') return { users: [] };
      return {};
    };
    await window.loadAdminView();
    const item = document.querySelector('[data-admin-section="overview"]');
    assert.equal(item.getAttribute('aria-current'), 'page');
    const bg = window.getComputedStyle(item).backgroundColor;
    // accent-soft is not transparent / not equal to the unselected item's empty background
    assert.notEqual(bg, 'rgba(0, 0, 0, 0)');
    assert.notEqual(bg, 'transparent');
  });
});
