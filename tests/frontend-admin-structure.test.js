import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';
import { TREE } from './frontend-admin-console.test.js';

function mockAdminApi(calls, overrides){
  return async (path, opts) => {
    calls.push({ path, opts });
    if(path.startsWith('/api/admin/org')) return { totals: { departments: 0, usersActive: 0, livePatients: 0 }, hospitals: [] };
    if(path === '/api/admin/users') return { users: [] };
    return (overrides && overrides(path, opts)) || {};
  };
}

describe('command center tree', () => {
  test('renders a row per node with live counts (no Users/Organizations rows anymore — those are sections now)', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, null);
    assert.ok(html.includes('data-node="hospital:h1"'));
    assert.ok(html.includes('data-node="department:d1"'));
    assert.ok(html.includes('data-node="unit:u1"'));
    assert.ok(html.includes('data-node="ward:w1"'));
    assert.ok(!html.includes('data-node="users"'));
    assert.ok(!html.includes('data-node="orgs"'));
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
  test('the tree contains an org root row with the org name and count', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, null);
    assert.ok(html.includes('data-node="org:bfv2-org"'));
  });
});

describe('detail panel', () => {
  test('unit detail shows name, capitalized type badge, stats and its wards', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('IV'));
    assert.ok(html.includes('4 live patient'));
    assert.ok(html.includes('7MOW'));
    assert.ok(html.includes('data-add-child="unit:u1"'));
    assert.ok(html.includes('>Unit<'));
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
  test('ward detail has no add-child control and no "childrens" typo', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'ward', id: 'w1' } });
    assert.ok(!html.includes('data-add-child='));
    assert.ok(!html.toLowerCase().includes('childrens'));
  });
  test('childTypeOf maps the hierarchy', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.childTypeOf('hospital'), 'department');
    assert.equal(window.childTypeOf('department'), 'unit');
    assert.equal(window.childTypeOf('unit'), 'ward');
    assert.equal(window.childTypeOf('ward'), null);
  });
  test('org detail panel lists hospitals, offers add-child, and has no move/delete control', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'org', id: 'bfv2-org' } });
    assert.ok(html.includes('City Hospital'));
    assert.ok(html.includes('data-add-child="org:bfv2-org"'));
    assert.ok(!html.includes('data-move-node='));
    assert.ok(!html.includes('data-delete-node='));
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
    assert.deepEqual([...parents.map(p => p.id)], []); // only one department exists
    const wardParents = window.validMoveParents(TREE, 'ward', 'u1');
    assert.deepEqual([...wardParents.map(p => p.id)], ['u2']);
  });
  test('a hospital with assigned users cannot be deleted and says why', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const emptied = JSON.parse(JSON.stringify(TREE));
    emptied.hospitals[0].departments = [];
    emptied.hospitals[0].stats.livePatients = 0;
    emptied.hospitals[0].stats.users = 2;
    const html = window.renderAdminDetailHTML({ tree: emptied, users: [], orgs: [], selection: { type: 'hospital', id: 'h1' } });
    assert.match(html, /data-delete-node="hospital:h1"[^>]*disabled/);
    assert.ok(html.includes('2 users'));
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
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'org', id: 'bfv2-org' } });
    document.querySelector('[data-new-child-name="org:bfv2-org"]').value = 'New Hospital';
    document.querySelector('[data-add-child="org:bfv2-org"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/hospitals');
    assert.ok(call, 'expected a POST to /api/admin/hospitals');
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

  test('delete posts DELETE to the node route and clears selection', async () => {
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

describe('mobile read-only (removed in Task 11 — still gates today)', () => {
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
});

describe('409 blockedBy reaches the UI', () => {
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
    env.window.localStorage.setItem('ortho_role', 'admin');
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
    window.switchAdminSection('orgs');
    assert.ok(document.getElementById('adminOrgsSection').innerHTML.includes('Org Two'));

    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(document.getElementById('adminStructureSection').hidden === false);
    assert.ok(paths.includes('/api/admin/org?orgId=o1'), 'expected the org tree to load for o1');

    window.exitAdminOrgContext();
    await new Promise(r => setTimeout(r, 0));
    assert.ok(document.getElementById('adminOrgsSection').innerHTML.includes('Org Two'));
  });

  test('the assignment picker still lists every org after drilling into one', async () => {
    const { window, document } = instanceAdminEnv();
    await window.loadAdminView();
    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    window.switchAdminSection('people');
    const html = document.getElementById('adminPeopleSection').innerHTML;
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
    document.querySelector('[data-view-org="o2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(!document.getElementById('adminDetailPane').innerHTML.includes('no longer exists'));
  });

  test('Structure prompts for an org instead of sitting on Loading', async () => {
    const { window, document } = instanceAdminEnv();
    await window.loadAdminView();
    window.switchAdminSection('structure');
    assert.equal(document.getElementById('adminStructureChooser').hidden, false);
    assert.equal(document.getElementById('adminStructureBody').hidden, true);
  });

  test('creating an organization with a blank name says so instead of doing nothing', async () => {
    const { window, document } = instanceAdminEnv();
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.getElementById('adminNewOrgName').value = '   ';
    document.getElementById('adminAddOrgBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual([...toasts], ['Enter an organization name']);
  });
});
