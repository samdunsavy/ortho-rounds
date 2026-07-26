import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

export const TREE = {
  totals: { hospitals: 1, departments: 1, units: 2, wards: 1, usersActive: 2, usersDisabled: 0, livePatients: 5 },
  hospitals: [{ id: 'h1', name: 'City Hospital', departments: [
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

describe('command center tree', () => {
  test('renders a row per node with live counts', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, null);
    assert.ok(html.includes('data-node="hospital:h1"'));
    assert.ok(html.includes('data-node="department:d1"'));
    assert.ok(html.includes('data-node="unit:u1"'));
    assert.ok(html.includes('data-node="ward:w1"'));
    assert.ok(html.includes('data-node="users"'));
  });
  test('marks the selected node', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, { type: 'unit', id: 'u1' });
    assert.match(html, /data-node="unit:u1"[^>]*class="[^"]*is-selected/);
  });
  test('findAdminNode locates a node and its parent', () => {
    const { window } = loadFrontendEnv();
    const hit = window.findAdminNode(TREE, 'ward', 'w1');
    assert.equal(hit.node.name, '7MOW');
    assert.equal(hit.parentType, 'unit');
    assert.equal(hit.parentId, 'u1');
    assert.equal(window.findAdminNode(TREE, 'unit', 'nope'), null);
  });
});

// Ported from tests/frontend-admin-view.test.js (renderAdminView is gone —
// see that file's header note for why).
describe('stat tiles', () => {
  test('renderAdminStatTilesInto paints stat tiles into #adminStatTiles', () => {
    const { window, document } = loadFrontendEnv();
    window.renderAdminStatTilesInto(TREE);
    const tiles = [...document.querySelectorAll('#adminStatTiles .admin-stat-tile')];
    assert.equal(tiles.length, 4);
    const tileText = tiles.map(t => t.textContent).join(' ');
    assert.match(tileText, /1/); // departments
    assert.match(tileText, /2/); // active users
    assert.match(tileText, /5/); // live patients
    assert.match(tileText, /3/); // post-op
  });
});

describe('assign-select grouping (still used, now feeds Task 5\'s users panel)', () => {
  test('buildAssignNodeGroups groups nodes by level with hospital/department-qualified labels', () => {
    const { window } = loadFrontendEnv();
    const groups = window.buildAssignNodeGroups(TREE);
    assert.deepEqual([...groups.hospital.map(g => g.id)], ['h1']);
    assert.deepEqual([...groups.department.map(g => g.id)], ['d1']);
    assert.deepEqual([...groups.unit.map(g => g.id)], ['u1', 'u2']);
    assert.deepEqual([...groups.ward.map(g => g.id)], ['w1']);
    assert.equal(groups.unit[0].label, 'IV (Ortho)');
  });

  test('renderAssignSelectOptionsHTML marks the selected node and encodes type:id in option values', () => {
    const { window } = loadFrontendEnv();
    const groups = window.buildAssignNodeGroups(TREE);
    const html = window.renderAssignSelectOptionsHTML(groups, 'unit', 'u1');
    assert.ok(html.includes('<option value="">— none —</option>'));
    assert.match(html, /<option value="unit:u1" selected>/);
    assert.ok(html.includes('<optgroup label="Wards">'));
  });
});

describe('delegated assign-select change handler', () => {
  test('fires the assign endpoint with {nodeType, nodeId}', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return { ok: true }; };
    document.getElementById('adminDetailPane').innerHTML =
      '<select data-assign-user="usr2" data-prev="ward:w1"><option value="">— none —</option><option value="unit:u1">IV (Ortho)</option></select>';
    const sel = document.querySelector('select[data-assign-user="usr2"]');
    sel.value = 'unit:u1';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/admin/users/usr2/assign');
    assert.equal(calls[0].opts.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { nodeType: 'unit', nodeId: 'u1' });
  });

  test('blank option unassigns with nodeId:null', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return { ok: true }; };
    document.getElementById('adminDetailPane').innerHTML =
      '<select data-assign-user="usr2" data-prev="ward:w1"><option value="">— none —</option><option value="unit:u1">IV (Ortho)</option></select>';
    const sel = document.querySelector('select[data-assign-user="usr2"]');
    sel.value = '';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.nodeId, null);
  });
});

describe('detail panel', () => {
  test('unit detail shows name, stats and its wards', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('IV'));
    assert.ok(html.includes('4 live patient'));
    assert.ok(html.includes('7MOW'));
    assert.ok(html.includes('data-add-child="unit:u1"'));
  });
  test('department detail lists its units and offers add-unit', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'department', id: 'd1' } });
    assert.ok(html.includes('IV'));
    assert.ok(html.includes('General'));
    assert.ok(html.includes('data-add-child="department:d1"'));
  });
  test('department detail includes the status bar', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'department', id: 'd1' } });
    assert.ok(html.includes('admin-status-bar'));
  });
  test('ward detail has no add-child control', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'ward', id: 'w1' } });
    assert.ok(!html.includes('data-add-child='));
  });
  test('childTypeOf maps the hierarchy', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.childTypeOf('hospital'), 'department');
    assert.equal(window.childTypeOf('department'), 'unit');
    assert.equal(window.childTypeOf('unit'), 'ward');
    assert.equal(window.childTypeOf('ward'), null);
  });
});

describe('structural actions', () => {
  test('unit offers rename, move (to other departments) and delete', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('data-rename-node="unit:u1"'));
    assert.ok(html.includes('data-move-node="unit:u1"'));
    assert.ok(html.includes('data-delete-node="unit:u1"'));
  });
  test('hospital has no move control', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'hospital', id: 'h1' } });
    assert.ok(!html.includes('data-move-node='));
  });
  test('delete is disabled with a reason when the node is not empty', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.match(html, /data-delete-node="unit:u1"[^>]*disabled/);
    assert.ok(html.includes('4 patients'));
  });
  test('delete is enabled for an empty node', () => {
    const { window } = loadFrontendEnv();
    const empty = JSON.parse(JSON.stringify(TREE));
    empty.hospitals[0].departments[0].units[1].stats.livePatients = 0;
    empty.hospitals[0].departments[0].units[1].stats.users = 0;
    const html = window.renderAdminDetailHTML({ tree: empty, users: [], orgs: [], selection: { type: 'unit', id: 'u2' } });
    assert.ok(!/data-delete-node="unit:u2"[^>]*disabled/.test(html));
  });
  test('validMoveParents lists same-type-parent nodes excluding the current parent', () => {
    const { window } = loadFrontendEnv();
    const parents = window.validMoveParents(TREE, 'unit', 'd1');
    // Spread into this realm's Array before comparing — values returned
    // from window.eval'd code live in jsdom's vm realm, and assert's
    // deepEqual treats same-shaped-but-cross-realm arrays as unequal (see
    // the identical pattern already used above for buildAssignNodeGroups).
    assert.deepEqual([...parents.map(p => p.id)], []); // only one department exists
    const wardParents = window.validMoveParents(TREE, 'ward', 'u1');
    assert.deepEqual([...wardParents.map(p => p.id)], ['u2']);
  });
});

const CC_USERS = [
  { id: 'usr1', username: 'xavier', role: 'admin', active: true, orgId: null, assignmentType: null, assignmentId: null },
  { id: 'usr2', username: 'Amit', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'org', assignmentId: 'bfv2-org' },
  { id: 'usr3', username: 'ghost', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'unit', assignmentId: 'gone-unit' }
];

describe('users panel', () => {
  test('assignment picker includes an Organizations group', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }], selection: { type: 'users' } });
    assert.ok(html.includes('<optgroup label="Organizations"'));
    assert.ok(html.includes('value="org:bfv2-org"'));
  });
  test('an org-assigned user is preselected, not shown as none', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }], selection: { type: 'users' } });
    assert.match(html, /value="org:bfv2-org"\s+selected/);
  });
  test('a stale assignment is shown explicitly', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [], selection: { type: 'users' } });
    assert.ok(html.includes('Stale (unit:gone-unit)'));
  });
  test('rows carry a search key and a checkbox', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [], selection: { type: 'users' } });
    assert.ok(html.includes('data-user-row="usr2"'));
    assert.ok(html.includes('data-user-check="usr2"'));
    assert.ok(html.includes('id="adminUserSearch"'));
  });
});

// Shared by every test below that exercises a click handler which ends in
// `.then(() => loadAdminView())` — without a tree/users shape loadAdminView
// can render, that follow-up call would throw (e.g. tree.hospitals.flatMap
// on undefined) and the assertions after the awaited tick would never run.
function mockAdminApi(calls, overrides){
  return async (path, opts) => {
    calls.push({ path, opts });
    if(path.startsWith('/api/admin/org')) return { totals: { departments: 0, usersActive: 0, livePatients: 0 }, hospitals: [] };
    if(path === '/api/admin/users') return { users: [] };
    return (overrides && overrides(path, opts)) || {};
  };
}

describe('bulk assign', () => {
  test('checking rows reveals the bulk bar and posts assign-bulk', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    // refreshAdminBulkBar reads the module-scoped adminState (not any state
    // object a test passes into render*HTML directly), so its <select>'s
    // option list — the thing that makes `unit:u1` a settable value below —
    // only contains 'unit:u1' if adminState.tree was actually populated via
    // loadAdminView(). Route through the real load so the whole state (and
    // the DOM it paints) reflects TREE/CC_USERS.
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: CC_USERS };
      return { ok: true };
    };
    await window.loadAdminView();
    const cb = document.querySelector('[data-user-check="usr2"]');
    cb.checked = true;
    cb.dispatchEvent(new window.Event('change', { bubbles: true }));
    const bar = document.getElementById('adminBulkBar');
    assert.equal(bar.hasAttribute('hidden'), false);
    assert.ok(bar.innerHTML.includes('1 selected'));
    // Spread into this realm's Array before comparing — see the identical
    // note above validMoveParents' test for why (cross-realm array from
    // window.eval'd code isn't reference-equal to a same-shaped literal).
    assert.deepEqual([...window.selectedAdminUserIds()], ['usr2']);

    document.getElementById('adminBulkNode').value = 'unit:u1';
    document.getElementById('adminBulkApply').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const assignCall = calls.find(c => c.path === '/api/admin/users/assign-bulk');
    assert.ok(assignCall, 'expected a POST to /api/admin/users/assign-bulk');
    assert.equal(assignCall.opts.method, 'POST');
    assert.deepEqual(JSON.parse(assignCall.opts.body), { userIds: ['usr2'], nodeType: 'unit', nodeId: 'u1' });
  });
});

describe('request-level coverage: structural actions (wrong parentKey corrupts data)', () => {
  test('add-child posts to the correct route with the correct parentKey, per level', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = mockAdminApi(calls);
    const cases = [
      { selType: 'hospital', selId: 'h1', expectPath: '/api/admin/departments', expectBody: { hospitalId: 'h1', name: 'New Department' } },
      { selType: 'department', selId: 'd1', expectPath: '/api/admin/units', expectBody: { departmentId: 'd1', name: 'New Unit' } },
      { selType: 'unit', selId: 'u1', expectPath: '/api/admin/wards', expectBody: { unitId: 'u1', name: 'New Ward' } }
    ];
    for(const c of cases){
      document.getElementById('adminDetailPane').innerHTML =
        window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: c.selType, id: c.selId } });
      document.querySelector(`[data-new-child-name="${c.selType}:${c.selId}"]`).value = c.expectBody.name;
      document.querySelector(`[data-add-child="${c.selType}:${c.selId}"]`).dispatchEvent(new window.Event('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
      const call = calls.find(x => x.path === c.expectPath && JSON.parse(x.opts.body).name === c.expectBody.name);
      assert.ok(call, `expected a POST to ${c.expectPath} for ${c.selType}:${c.selId}`);
      assert.equal(call.opts.method, 'POST');
      assert.deepEqual(JSON.parse(call.opts.body), c.expectBody);
    }
  });

  test('org add-child (add hospital) posts {orgId, name} so an instance admin can target the org', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = mockAdminApi(calls);
    const orgTree = Object.assign({}, TREE, { org: { id: 'bfv2-org', name: 'Default' } });
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: orgTree, users: [], orgs: [], selection: { type: 'org', id: 'bfv2-org' } });
    document.querySelector('[data-new-child-name="org:bfv2-org"]').value = 'New Hospital';
    document.querySelector('[data-add-child="org:bfv2-org"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/hospitals');
    assert.ok(call, 'expected a POST to /api/admin/hospitals');
    assert.equal(call.opts.method, 'POST');
    assert.deepEqual(JSON.parse(call.opts.body), { orgId: 'bfv2-org', name: 'New Hospital' });
  });

  test('rename posts PATCH with {name}', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = mockAdminApi(calls);
    window.prompt = () => 'Renamed Unit';
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    document.querySelector('[data-rename-node="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/nodes/unit/u1');
    assert.ok(call, 'expected a PATCH to /api/admin/nodes/unit/u1');
    assert.equal(call.opts.method, 'PATCH');
    assert.deepEqual(JSON.parse(call.opts.body), { name: 'Renamed Unit' });
  });

  test('delete posts DELETE to the node route', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = mockAdminApi(calls);
    window.confirm = () => true;
    const empty = JSON.parse(JSON.stringify(TREE));
    empty.hospitals[0].departments[0].units[1].stats.livePatients = 0;
    empty.hospitals[0].departments[0].units[1].stats.users = 0;
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: empty, users: [], orgs: [], selection: { type: 'unit', id: 'u2' } });
    document.querySelector('[data-delete-node="unit:u2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/nodes/unit/u2');
    assert.ok(call, 'expected a DELETE to /api/admin/nodes/unit/u2');
    assert.equal(call.opts.method, 'DELETE');
  });
});

describe('user lifecycle', () => {
  test('rows expose toggle and reset controls; create form present', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [], selection: { type: 'users' } });
    assert.ok(html.includes('data-user-toggle="usr2"'));
    assert.ok(html.includes('data-user-reset="usr2"'));
    assert.ok(html.includes('id="adminCreateUser"'));
    assert.ok(html.includes('id="adminNewUsername"'));
  });
  test('a disabled user offers Enable', () => {
    const { window } = loadFrontendEnv();
    const users = [{ id: 'u9', username: 'off', role: 'member', active: false, orgId: null, assignmentType: null, assignmentId: null }];
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users, orgs: [], selection: { type: 'users' } });
    assert.match(html, /data-user-toggle="u9"[^>]*>Enable</);
  });

  test('create user carries the org in context so the new user is not org-less', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return Object.assign({}, TREE, { org: { id: 'bfv2-org', name: 'Default' } });
      if(path === '/api/admin/users' && (!opts || opts.method !== 'POST')) return { users: [] };
      return { temporaryPassword: 'bone-plate-1234' };
    };
    window.alert = () => {};
    await window.loadAdminView();
    document.getElementById('adminNewUsername').value = 'newpg';
    document.getElementById('adminCreateUser').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/users' && c.opts && c.opts.method === 'POST');
    assert.ok(call, 'expected a POST to /api/admin/users');
    assert.deepEqual(JSON.parse(call.opts.body), { username: 'newpg', role: 'member', orgId: 'bfv2-org' });
  });
});

describe('mobile read-only', () => {
  test('narrow viewport hides editing controls and shows a note', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(!html.includes('data-rename-node='));
    assert.ok(!html.includes('data-add-child='));
    assert.ok(html.includes('larger screen'));
  });
  test('wide viewport keeps the controls', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('data-rename-node='));
  });

  test('narrow users panel has no live write path: no checkbox, no assign select, but still shows username and assignment as text', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }], selection: { type: 'users' } });
    assert.ok(!html.includes('data-assign-user'));
    assert.ok(!html.includes('data-user-check'));
    assert.ok(html.includes('xavier'));
    assert.ok(html.includes('Amit'));
    assert.ok(html.includes('Default')); // usr2's org assignment label, rendered as text
    assert.ok(html.includes('Stale (unit:gone-unit)')); // usr3's stale assignment, still shown, escaped
    assert.ok(html.includes('—')); // usr1 has no assignment
  });

  test('narrow: refreshAdminBulkBar leaves the bulk bar hidden even if a checkbox is injected and checked', () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const pane = document.getElementById('adminDetailPane');
    pane.innerHTML = '<div id="adminBulkBar" hidden></div><input type="checkbox" data-user-check="usr2">';
    const cb = pane.querySelector('[data-user-check="usr2"]');
    cb.checked = true;
    window.refreshAdminBulkBar();
    const bar = document.getElementById('adminBulkBar');
    assert.equal(bar.hasAttribute('hidden'), true);
    assert.equal(bar.innerHTML, '');
  });

  test('wide users panel still renders the live assign select and checkbox (regression guard)', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }], selection: { type: 'users' } });
    assert.ok(html.includes('data-assign-user="usr2"'));
    assert.ok(html.includes('data-user-check="usr2"'));
  });
});

// Finding 1: org-level assignment was dead for org admins because
// adminState.orgs was only ever populated on the instance-admin early-return
// path. An org-admin-shaped load (no localStorage role set -> isAdmin()
// false -> isInstanceAdminUser() false -> loadAdminView's else branch, same
// branch an org admin actually takes) must now populate adminState.orgs
// from the tree's `org` field.
describe('org-level assignment for org admins (Finding 1 fix)', () => {
  test('an org-admin-shaped load path yields an Organizations optgroup and preselects an org-assigned user (not Stale)', async () => {
    const { window, document } = loadFrontendEnv();
    const orgTree = {
      org: { id: 'bfv2-org', name: 'Default' },
      totals: { departments: 0, usersActive: 1, livePatients: 0 },
      hospitals: []
    };
    window.api = async (path) => {
      if(path.startsWith('/api/admin/org')) return orgTree;
      if(path === '/api/admin/users') return { users: [
        { id: 'usr2', username: 'Amit', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'org', assignmentId: 'bfv2-org' }
      ] };
      return {};
    };
    await window.loadAdminView();
    const html = document.getElementById('adminDetailPane').innerHTML;
    assert.ok(html.includes('<optgroup label="Organizations"'));
    assert.match(html, /value="org:bfv2-org"\s+selected/);
    assert.ok(!html.includes('Stale (org:bfv2-org)'));
  });
});

// Finding 2: the rail had no Org root row and childTypeOf had no 'org'
// entry, so an org with zero hospitals could never be fixed from the UI.
describe('org root row (Finding 2 fix)', () => {
  const ORG_TREE = Object.assign({}, TREE, { org: { id: 'bfv2-org', name: 'Default' } });

  test('the tree contains an org root row', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(ORG_TREE, null);
    assert.ok(html.includes('data-node="org:bfv2-org"'));
  });

  test('org detail panel lists hospitals and offers add-child', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: ORG_TREE, users: [], orgs: [], selection: { type: 'org', id: 'bfv2-org' } });
    assert.ok(html.includes('City Hospital'));
    assert.ok(html.includes('data-add-child="org:bfv2-org"'));
  });

  test('org has no move or delete control', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: ORG_TREE, users: [], orgs: [], selection: { type: 'org', id: 'bfv2-org' } });
    assert.ok(!html.includes('data-move-node='));
    assert.ok(!html.includes('data-delete-node='));
  });
});

// Finding 3: instance admins landed on a permanent "Loading…" stat-tile box
// because the instance-admin branch of loadAdminView returns early without
// ever painting tiles.
describe('instance-admin orgs path leaves no stale stat tiles (Finding 3 fix)', () => {
  test('#adminStatTiles is empty after the instance-admin orgs path renders', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    document.getElementById('adminStatTiles').innerHTML = '<div class="small-muted">Loading…</div>';
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [] };
      return {};
    };
    await window.loadAdminView();
    assert.equal(document.getElementById('adminStatTiles').innerHTML, '');
  });
});

// Finding 4: renderAdminDetailHTML returned '' for the Organizations row, so
// clicking it yielded a blank panel with no tab switch.
describe('Organizations row navigates (Finding 4 fix)', () => {
  test('selecting the orgs row switches the active tab to orgs', () => {
    const { window, document } = loadFrontendEnv();
    window.selectAdminNode('orgs', null);
    assert.equal(document.getElementById('adminOrgPane').style.display, 'none');
    assert.equal(document.getElementById('adminOrgsTab').style.display, '');
    assert.ok(document.querySelector('.admin-tab[data-admin-tab="orgs"]').classList.contains('active'));
  });
});

// Finding 6a: a ward's empty-children message read "No childrens yet."
// (childType null -> 'children' + 's').
describe('ward empty-state label (Finding 6a fix)', () => {
  test('ward detail does not say "No childrens yet."', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'ward', id: 'w1' } });
    assert.ok(!html.toLowerCase().includes('childrens'));
  });
});

describe('hospital and org rows show their counts', () => {
  const STATS = (n) => ({ livePatients: n, byStatus: { postop: n, preop: 0, conservative: 0, fordischarge: 0 }, users: 1, lastActivity: null });
  const ROLLED = Object.assign({}, TREE, {
    org: { id: 'bfv2-org', name: 'Default', stats: STATS(5) },
    hospitals: [Object.assign({}, TREE.hospitals[0], { stats: STATS(5) })]
  });

  test('the tree rail renders a count on the org and hospital rows', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(ROLLED, null);
    assert.match(html, /data-node="org:bfv2-org"[^>]*>[^<]*<span class="cc-count">5<\/span>/);
    assert.match(html, /data-node="hospital:h1"[^>]*>[^<]*<span class="cc-count">5<\/span>/);
  });

  test('the org detail panel renders its stats block', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: ROLLED, users: [], orgs: [], selection: { type: 'org', id: 'bfv2-org' } });
    assert.ok(html.includes('5 live patient'));
    assert.ok(html.includes('admin-status-bar'));
  });

  test('a hospital with assigned users cannot be deleted and says why', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const emptied = JSON.parse(JSON.stringify(ROLLED));
    emptied.hospitals[0].departments = [];
    emptied.hospitals[0].stats.livePatients = 0;
    emptied.hospitals[0].stats.users = 2;
    const html = window.renderAdminDetailHTML({ tree: emptied, users: [], orgs: [], selection: { type: 'hospital', id: 'h1' } });
    assert.match(html, /data-delete-node="hospital:h1"[^>]*disabled/);
    assert.ok(html.includes('2 users'));
  });
});

describe('409 blockedBy reaches the UI', () => {
  test('api() attaches the status and parsed body to the thrown error', async () => {
    const { window } = loadFrontendEnv();
    window.fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Node is not empty', blockedBy: { children: 0, users: 1, patients: 3 } })
    });
    await assert.rejects(
      () => window.api('/api/admin/nodes/unit/u1', { method: 'DELETE' }),
      (err) => {
        assert.equal(err.message, 'Node is not empty');
        assert.equal(err.status, 409);
        assert.equal(err.payload.blockedBy.patients, 3);
        return true;
      }
    );
  });

  test('describeDeleteBlock names what is in the way', () => {
    const { window } = loadFrontendEnv();
    const err = new window.Error('Node is not empty');
    err.payload = { blockedBy: { children: 0, users: 1, patients: 3 } };
    assert.equal(window.describeDeleteBlock(err), "Can't delete — still has 3 patients, 1 user");
  });

  test('describeDeleteBlock returns null for an unrelated error', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.describeDeleteBlock(new window.Error('boom')), null);
  });

  test('a blocked delete toasts the explained reason, not the bare server string', async () => {
    const { window, document } = loadFrontendEnv();
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.confirm = () => true;
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return { totals: { departments: 0, usersActive: 0, livePatients: 0 }, hospitals: [] };
      if(path === '/api/admin/users') return { users: [] };
      if(opts && opts.method === 'DELETE'){
        const err = new window.Error('Node is not empty');
        err.status = 409;
        err.payload = { error: 'Node is not empty', blockedBy: { children: 0, users: 0, patients: 2 } };
        throw err;
      }
      return {};
    };
    const empty = JSON.parse(JSON.stringify(TREE));
    empty.hospitals[0].departments[0].units[1].stats.livePatients = 0;
    empty.hospitals[0].departments[0].units[1].stats.users = 0;
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: empty, users: [], orgs: [], selection: { type: 'unit', id: 'u2' } });
    document.querySelector('[data-delete-node="unit:u2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual([...toasts], ["Can't delete — still has 2 patients"]);
  });
});

describe('instance-admin org context', () => {
  const ORGS = [
    { id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 1, departments: 1, users: 2, livePatients: 3 } },
    { id: 'o2', name: 'Org Two', plan: 'paid', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }
  ];
  const ORG_ONE_TREE = {
    org: { id: 'o1', name: 'Org One', stats: { livePatients: 3, byStatus: { postop: 3, preop: 0, conservative: 0, fordischarge: 0 }, users: 2, lastActivity: null } },
    totals: { departments: 0, usersActive: 2, livePatients: 3 },
    hospitals: []
  };

  function instanceAdminEnv(){
    const env = loadFrontendEnv();
    env.window.localStorage.setItem('ortho_role', 'admin'); // isAdmin() && no org id => instance admin
    const paths = [];
    env.window.api = async (path) => {
      paths.push(path);
      if(path === '/api/admin/orgs') return { orgs: ORGS };
      if(path.startsWith('/api/admin/org')) return ORG_ONE_TREE;
      if(path === '/api/admin/users') return { users: [
        { id: 'usr2', username: 'Amit', role: 'member', active: true, orgId: 'o1', assignmentType: 'org', assignmentId: 'o1' }
      ] };
      return {};
    };
    return Object.assign({ paths }, env);
  }

  test('viewing an org loads that org tree; leaving it returns to the org cards', async () => {
    const { window, document, paths } = instanceAdminEnv();
    await window.loadAdminView();
    assert.ok(document.getElementById('adminOrgsTab').innerHTML.includes('Org Two'));

    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(paths.includes('/api/admin/org?orgId=o1'), 'expected the org tree to load for o1');

    paths.length = 0;
    document.getElementById('adminOrgsTab').innerHTML = ''; // prove it gets repainted
    window.exitAdminOrgContext();
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual([...paths], ['/api/admin/orgs'], 'leaving must refetch the org list, not the hidden org tree');
    assert.ok(document.getElementById('adminOrgsTab').innerHTML.includes('Org Two'));
  });

  test('the assignment picker still lists every org after drilling into one', async () => {
    const { window, document } = instanceAdminEnv();
    await window.loadAdminView();
    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const html = document.getElementById('adminDetailPane').innerHTML;
    assert.ok(html.includes('value="org:o1"'));
    assert.ok(html.includes('value="org:o2"'), 'the other org must remain assignable');
  });

  test('switching org drops the previous org selection', async () => {
    const { window, document } = instanceAdminEnv();
    await window.loadAdminView();
    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    window.selectAdminNode('unit', 'gone-in-the-next-org');
    assert.ok(document.getElementById('adminDetailPane').innerHTML.includes('no longer exists'));

    window.exitAdminOrgContext();
    await new Promise(r => setTimeout(r, 0));
    document.querySelector('[data-view-org="o2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(!document.getElementById('adminDetailPane').innerHTML.includes('no longer exists'));
  });

  test('the Organization tab prompts for an org instead of sitting on Loading', async () => {
    const { window, document } = instanceAdminEnv();
    await window.loadAdminView();
    document.getElementById('adminDetailPane').innerHTML = '<div class="small-muted">Loading…</div>';
    document.querySelector('.admin-tab[data-admin-tab="org"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const html = document.getElementById('adminDetailPane').innerHTML;
    assert.ok(!html.includes('Loading'));
    assert.ok(html.includes('Choose an organization'));
  });

  test('creating an organization with a blank name says so instead of doing nothing', async () => {
    const { window, document } = instanceAdminEnv();
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    await window.loadAdminView();
    document.getElementById('adminNewOrgName').value = '   ';
    document.getElementById('adminAddOrgBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual([...toasts], ['Enter an organization name']);
  });
});
