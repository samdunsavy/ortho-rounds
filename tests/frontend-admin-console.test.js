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
