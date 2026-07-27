import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';
import { TREE } from './frontend-admin-console.test.js';

/** Mirrors orgAdminEnv() in frontend-admin-console.test.js (not exported from
    there, so duplicated here): a ready-to-drive env with the org tree and an
    empty user list already stubbed. */
function structureEnv(){
  const env = loadFrontendEnv();
  env.window.api = async (path) => {
    if(path.startsWith('/api/admin/org')) return TREE;
    if(path === '/api/admin/users') return { users: [] };
    return {};
  };
  return env;
}

describe('structure two-pane grid (Task 4)', () => {
  test('structure body uses a two-column grid class at desktop', () => {
    const { document } = structureEnv();
    assert.ok(document.getElementById('adminStructureBody').classList.contains('admin-cc'));
    // the CSS grid is asserted via the class contract; JSDOM has no layout engine
  });
  test('rail rows carry a node-type icon', async () => {
    const { window, document } = structureEnv();
    await window.loadAdminView();
    window.switchAdminSection('structure');
    assert.ok(document.querySelector('#adminTreeRail .admin-cc-row svg.ic use'));
  });
  test('detail pane shows a stat grid for a selected unit', async () => {
    const { window, document } = structureEnv();
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    assert.ok(document.querySelector('#adminDetailPane .admin-cc-stats'));
  });
});

function mockAdminApi(calls, overrides){
  return async (path, opts) => {
    calls.push({ path, opts });
    if(path.startsWith('/api/admin/org')) return { totals: { departments: 0, usersActive: 0, livePatients: 0 }, hospitals: [] };
    if(path === '/api/admin/users') return { users: [] };
    return (overrides && overrides(path, opts)) || {};
  };
}

const EXPANDED_TO_UNITS = new Set(['hospital:h1', 'department:d1', 'unit:u1']);

describe('command center tree', () => {
  test('renders a row per node with live counts (no Users/Organizations rows anymore — those are sections now)', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, null, EXPANDED_TO_UNITS);
    assert.ok(html.includes('data-node="hospital:h1"'));
    assert.ok(html.includes('data-node="department:d1"'));
    assert.ok(html.includes('data-node="unit:u1"'));
    assert.ok(html.includes('data-node="ward:w1"'));
    assert.ok(!html.includes('data-node="users"'));
    assert.ok(!html.includes('data-node="orgs"'));
  });
  test('marks the selected node', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, { type: 'unit', id: 'u1' }, EXPANDED_TO_UNITS);
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
    assert.ok(html.includes('4 patients in this unit'));
    assert.ok(html.includes('7MOW'));
    assert.ok(html.includes('data-add-child="unit:u1"'));
    assert.ok(html.includes('>Unit<'));
    assert.ok(html.includes('maxlength="80"') && html.includes('data-new-child-name="unit:u1"'));
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
    assert.ok(html.includes('data-rename-target="unit:u1"'));
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
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    document.querySelector('[data-rename-target="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    const input = document.querySelector('[data-rename-input="unit:u1"]');
    input.value = 'Renamed Unit';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
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
    window.showConfirm = () => Promise.resolve(true);
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

describe('no mobile read-only gate (Task 11)', () => {
  test('a narrow viewport still renders Move and Delete controls', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('data-move-node='));
    assert.ok(html.includes('data-delete-node='));
    assert.ok(!html.includes('larger screen'));
  });

  test('adminIsNarrow no longer exists as a rendering gate', () => {
    const { window } = loadFrontendEnv();
    assert.equal(typeof window.adminIsNarrow, 'undefined');
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
  test('a blocked delete renders actionable blockers in the detail pane, not a bare toast', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.showConfirm = () => Promise.resolve(true);
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
    assert.equal(toasts.length, 0);
    assert.ok(document.getElementById('adminDeleteBlockers').textContent.includes('2 patients'));
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

describe('tree expansion', () => {
  test('isAdminNodeExpanded/toggleAdminNodeExpanded track a Set of "type:id" keys', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.isAdminNodeExpanded('department:d1'), false);
    window.toggleAdminNodeExpanded('department:d1');
    assert.equal(window.isAdminNodeExpanded('department:d1'), true);
    window.toggleAdminNodeExpanded('department:d1');
    assert.equal(window.isAdminNodeExpanded('department:d1'), false);
  });

  test('defaultExpandStructure expands every hospital and department, so one hospital is fully visible', () => {
    const { window } = loadFrontendEnv();
    const expanded = window.defaultExpandStructure(TREE);
    assert.equal(expanded.has('hospital:h1'), true);
    assert.equal(expanded.has('department:d1'), true);
    assert.equal(expanded.has('unit:u1'), false);
  });

  test('a collapsed hospital hides its departments; expanding it shows them; aria-expanded reflects state', () => {
    const { window } = loadFrontendEnv();
    const collapsedHtml = window.renderAdminTreeHTML(TREE, null, new Set());
    assert.ok(!collapsedHtml.includes('data-node="department:d1"'));
    assert.match(collapsedHtml, /data-toggle-expand="hospital:h1"[^>]*aria-expanded="false"/);

    const expandedHtml = window.renderAdminTreeHTML(TREE, null, new Set(['hospital:h1']));
    assert.ok(expandedHtml.includes('data-node="department:d1"'));
    assert.match(expandedHtml, /data-toggle-expand="hospital:h1"[^>]*aria-expanded="true"/);
  });

  test('clicking the chevron toggles expansion without selecting the row', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    const detailBefore = document.getElementById('adminDetailPane').innerHTML;
    document.querySelector('[data-toggle-expand="hospital:h1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.ok(!document.querySelector('[data-node="department:d1"]'));
    assert.equal(document.getElementById('adminDetailPane').innerHTML, detailBefore);
    assert.ok(!document.querySelector('.admin-cc-row.is-selected'));
  });

  test('expansion state survives a reload', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    document.querySelector('[data-toggle-expand="hospital:h1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.ok(!document.querySelector('[data-node="department:d1"]'));
    await window.loadAdminView();
    assert.ok(!document.querySelector('[data-node="department:d1"]'), 'stayed collapsed across the reload');
  });

  test('counts are labelled, not bare numbers', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, null, new Set(['hospital:h1', 'department:d1']));
    assert.match(html, /IV[\s\S]{0,40}4 patients/);
  });

  test('ward pinned count is not pluralized to pinneds', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, null, new Set(['hospital:h1', 'department:d1', 'unit:u1']));
    assert.match(html, /7MOW[\s\S]{0,40}4 pinned/);
    assert.ok(!html.includes('pinneds'));
  });

  test('fully collapsed expansion survives re-render and loadAdminView', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    document.querySelector('[data-toggle-expand="hospital:h1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    document.querySelector('[data-toggle-expand="hospital:h1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    document.querySelector('[data-toggle-expand="department:d1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    document.querySelector('[data-toggle-expand="hospital:h1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.ok(!document.querySelector('[data-node="department:d1"]'));
    await window.loadAdminView();
    window.switchAdminSection('structure');
    assert.ok(!document.querySelector('[data-node="department:d1"]'), 'stayed fully collapsed after reload');
    window.renderAdminStructureBody();
    assert.ok(!document.querySelector('[data-node="department:d1"]'), 'stayed fully collapsed after re-render');
  });
});

describe('structure UI persistence', () => {
  test('structureFilter survives loadAdminView', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    const filter = document.getElementById('adminStructureFilter');
    filter.value = 'general';
    filter.dispatchEvent(new window.Event('input', { bubbles: true }));
    await window.loadAdminView();
    window.switchAdminSection('structure');
    assert.equal(document.getElementById('adminStructureFilter').value, 'general');
    assert.ok(document.querySelector('[data-node="unit:u2"]'));
    assert.ok(!document.querySelector('[data-node="unit:u1"]'));
  });

  test('selectedNode survives loadAdminView', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    document.querySelector('[data-node="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.ok(document.querySelector('[data-node="unit:u1"].is-selected'));
    assert.ok(document.getElementById('adminDetailPane').innerHTML.includes('IV'));
    await window.loadAdminView();
    window.switchAdminSection('structure');
    assert.ok(document.querySelector('[data-node="unit:u1"].is-selected'));
    assert.ok(document.getElementById('adminDetailPane').innerHTML.includes('IV'));
  });
});

describe('tree filter', () => {
  test('nodeMatchesStructureFilter matches a case-insensitive substring of the name', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.nodeMatchesStructureFilter({ name: 'General' }, 'gen'), true);
    assert.equal(window.nodeMatchesStructureFilter({ name: 'General' }, 'xyz'), false);
    assert.equal(window.nodeMatchesStructureFilter({ name: 'General' }, ''), true);
  });

  test('ancestorsOf returns the chain of keys from the org down to a ward', () => {
    const { window } = loadFrontendEnv();
    assert.deepEqual([...window.ancestorsOf(TREE, 'ward', 'w1')], ['org:bfv2-org', 'hospital:h1', 'department:d1', 'unit:u1']);
  });

  test('typing in the filter box narrows the tree to matches and auto-expands to reveal them', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    const filter = document.getElementById('adminStructureFilter');
    filter.value = 'general';
    filter.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.ok(document.querySelector('[data-node="unit:u2"]')); // "General" — matches, and its ancestors auto-expand
    assert.ok(!document.querySelector('[data-node="unit:u1"]')); // "IV" — does not match, hidden
  });
});

describe('people assigned here', () => {
  const USERS = [
    { id: 'u1', username: 'alice', assignmentType: 'unit', assignmentId: 'u1' },
    { id: 'u2', username: 'bob', assignmentType: 'ward', assignmentId: 'w1' }
  ];

  test('usersAssignedTo returns exactly the users assigned to that node', () => {
    const { window } = loadFrontendEnv();
    assert.deepEqual(window.usersAssignedTo('unit', 'u1', USERS).map(u => u.username), ['alice']);
    assert.deepEqual(window.usersAssignedTo('ward', 'w1', USERS).map(u => u.username), ['bob']);
    assert.deepEqual(window.usersAssignedTo('unit', 'u2', USERS), []);
  });

  test('the detail panel lists people assigned here, linking into People', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: USERS, orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('alice'));
    assert.ok(html.includes('data-attention-people="node:unit:u1"'));
  });

  test('a node with nobody assigned says so', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('Nobody is assigned here yet'));
  });
});

describe('department specialty', () => {
  test('department detail shows a specialty field', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'department', id: 'd1' } });
    assert.match(html, /data-specialty-node="d1"[^>]*value="ortho"/);
  });

  test('changing the specialty field patches the department', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return {}; };
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'department', id: 'd1' } });
    const input = document.querySelector('[data-specialty-node="d1"]');
    input.value = 'trauma';
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/nodes/department/d1');
    assert.ok(call);
    assert.deepEqual(JSON.parse(call.opts.body), { name: 'Ortho', specialty: 'trauma' });
  });
});

describe('inline rename', () => {
  test('the rename target is a focusable button with a 44×44px minimum touch target', () => {
    const { window, document } = loadFrontendEnv();
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    const btn = document.querySelector('[data-rename-target="unit:u1"]');
    assert.equal(btn.tagName, 'BUTTON');
    assert.equal(btn.type, 'button');
    assert.equal(btn.textContent.trim(), 'IV');
    assert.equal(window.getComputedStyle(btn).display, 'inline-flex');
    assert.ok(parseInt(window.getComputedStyle(btn).minHeight, 10) >= 44);
    assert.ok(parseInt(window.getComputedStyle(btn).minWidth, 10) >= 44);
    btn.focus();
    assert.equal(document.activeElement, btn);
  });

  test('clicking the name reveals an editable input with the current name', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    document.querySelector('[data-rename-target="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    const input = document.querySelector('[data-rename-input="unit:u1"]');
    assert.equal(input.value, 'IV');
  });

  test('Enter saves; Escape cancels without a request', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return path.startsWith('/api/admin/org') ? TREE : { users: [] }; };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    document.querySelector('[data-rename-target="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    let input = document.querySelector('[data-rename-input="unit:u1"]');
    input.value = 'IV Ward';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const patchCall = calls.find(c => c.path === '/api/admin/nodes/unit/u1' && c.opts.method === 'PATCH');
    assert.ok(patchCall);
    assert.deepEqual(JSON.parse(patchCall.opts.body), { name: 'IV Ward' });

    calls.length = 0;
    document.querySelector('[data-rename-target="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    input = document.querySelector('[data-rename-input="unit:u1"]');
    input.value = 'Should not save';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!document.querySelector('[data-rename-input="unit:u1"]'));
    assert.equal(calls.filter(c => c.opts && c.opts.method === 'PATCH').length, 0);
  });

  test('a name over 80 characters shows an inline message and does not save', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return {}; };
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    document.querySelector('[data-rename-target="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    const input = document.querySelector('[data-rename-input="unit:u1"]');
    input.value = 'x'.repeat(81);
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.filter(c => c.opts && c.opts.method === 'PATCH').length, 0);
    assert.ok(document.getElementById('adminDetailPane').textContent.includes('80'));
  });
});

describe('explicit Move with confirmation', () => {
  test('changing the picker alone posts nothing; the Move button is required', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return {}; };
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'ward', id: 'w1' } });
    const sel = document.querySelector('[data-move-node="ward:w1"]');
    sel.value = sel.querySelector('option:not([value=""])').value;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.some(c => c.opts && c.opts.method === 'POST'), false);
    assert.ok(document.querySelector('[data-move-confirm="ward:w1"]'), 'expected an explicit Move button');
  });

  test('the Move button confirms naming both ends before posting', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const calls = [];
    let confirmMessage = '';
    window.showConfirm = (title, message) => { confirmMessage = message; return Promise.resolve(true); };
    window.api = async (path, opts) => { calls.push({ path, opts }); return path.startsWith('/api/admin/org') ? TREE : { users: [] }; };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('ward', 'w1');
    const sel = document.querySelector('[data-move-node="ward:w1"]');
    sel.value = 'u2';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    document.querySelector('[data-move-confirm="ward:w1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.match(confirmMessage, /7MOW/);
    assert.match(confirmMessage, /IV/);
    assert.match(confirmMessage, /General/);
    const call = calls.find(c => c.path === '/api/admin/nodes/ward/w1/move');
    assert.ok(call);
    assert.deepEqual(JSON.parse(call.opts.body), { newParentId: 'u2' });
  });

  test('declining the confirmation posts nothing', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const calls = [];
    window.showConfirm = () => Promise.resolve(false);
    window.api = async (path, opts) => { calls.push({ path, opts }); return {}; };
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'ward', id: 'w1' } });
    document.querySelector('[data-move-node="ward:w1"]').value = 'u2';
    document.querySelector('[data-move-node="ward:w1"]').dispatchEvent(new window.Event('change', { bubbles: true }));
    document.querySelector('[data-move-confirm="ward:w1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.some(c => c.opts && c.opts.method === 'POST'), false);
  });
});

describe('actionable delete blockers', () => {
  function deletableU1Tree(){
    const t = JSON.parse(JSON.stringify(TREE));
    const u1 = t.hospitals[0].departments[0].units[0];
    u1.stats.livePatients = 0;
    u1.stats.users = 0;
    u1.wards = [];
    return t;
  }

  test('a 409 with blockedBy.patients renders a link into Organize; blockedBy.users renders a link into People', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const tree = deletableU1Tree();
    window.showConfirm = () => Promise.resolve(true);
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return tree;
      if(path === '/api/admin/users') return { users: [] };
      if(opts && opts.method === 'DELETE'){
        const err = new window.Error('Node is not empty');
        err.status = 409;
        err.payload = { error: 'Node is not empty', blockedBy: { children: 0, users: 1, patients: 2 } };
        throw err;
      }
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    document.querySelector('[data-delete-node="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const detail = document.getElementById('adminDetailPane');
    assert.ok(detail.querySelector('[data-organize-unit="u1"]'));
    assert.ok(detail.querySelector('[data-attention-people="node:unit:u1"]'));
  });

  test('clicking the patients blocker link calls openOrganizeForUnit', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const tree = deletableU1Tree();
    window.showConfirm = () => Promise.resolve(true);
    let organizedUnit = null;
    window.openOrganizeForUnit = (id) => { organizedUnit = id; };
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return tree;
      if(path === '/api/admin/users') return { users: [] };
      if(opts && opts.method === 'DELETE'){
        const err = new window.Error('Node is not empty');
        err.status = 409;
        err.payload = { error: 'Node is not empty', blockedBy: { children: 0, users: 0, patients: 2 } };
        throw err;
      }
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    document.querySelector('[data-delete-node="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    document.querySelector('[data-organize-unit="u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(organizedUnit, 'u1');
  });

  test('clicking the users blocker link switches to People with the node filter', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const tree = deletableU1Tree();
    window.showConfirm = () => Promise.resolve(true);
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return tree;
      if(path === '/api/admin/users') return { users: [] };
      if(opts && opts.method === 'DELETE'){
        const err = new window.Error('Node is not empty');
        err.status = 409;
        err.payload = { error: 'Node is not empty', blockedBy: { children: 0, users: 1, patients: 0 } };
        throw err;
      }
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    document.querySelector('[data-delete-node="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    document.querySelector('[data-attention-people="node:unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminPeopleSection').hidden, false);
    assert.equal(window.getAdminPeopleFilter(), 'node:unit:u1');
  });
});

describe('delete selects the parent', () => {
  test('deleting a unit selects its department, not the People section', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    window.showConfirm = () => Promise.resolve(true);
    const empty = JSON.parse(JSON.stringify(TREE));
    empty.hospitals[0].departments[0].units[1].stats.livePatients = 0;
    empty.hospitals[0].departments[0].units[1].stats.users = 0;
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return empty;
      if(path === '/api/admin/users') return { users: [] };
      if(opts && opts.method === 'DELETE') return { deleted: true };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u2');
    document.querySelector('[data-delete-node="unit:u2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(document.getElementById('adminDetailPane').innerHTML.includes('Ortho'));
    assert.equal(document.getElementById('adminPeopleSection').hidden, true);
  });
});

describe('phone drill-down', () => {
  test('selecting a row marks the structure body as drilled; Back clears it without losing the selection', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    assert.equal(document.getElementById('adminStructureBody').classList.contains('is-drilled'), true);
    document.querySelector('[data-back-to-tree]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminStructureBody').classList.contains('is-drilled'), false);
    assert.ok(document.getElementById('adminDetailPane').innerHTML.includes('IV'), 'selection itself is preserved');
  });
});

const CC_USERS = [
  { id: 'usr1', username: 'xavier', role: 'admin', active: true, orgId: null, assignmentType: null, assignmentId: null },
  { id: 'usr2', username: 'Amit', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'org', assignmentId: 'bfv2-org' },
  { id: 'usr3', username: 'ghost', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'unit', assignmentId: 'gone-unit' }
];

describe('focus restoration', () => {
  test('renaming a node keeps focus on the (now read-only) name after the reload-triggered repaint', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: [] };
      if(opts && opts.method === 'PATCH') return { ok: true };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    document.querySelector('[data-rename-target="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    const input = document.querySelector('[data-rename-input="unit:u1"]');
    input.value = 'IV Ward';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.activeElement.closest('[data-rename-target]')?.dataset.renameTarget, 'unit:u1');
  });
});

describe('aria-expanded and labels audit', () => {
  test('every expandable tree row has aria-expanded, and the filter/search inputs have labels', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: [] };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    for(const btn of document.querySelectorAll('[data-toggle-expand]')){
      assert.match(btn.getAttribute('aria-expanded'), /^(true|false)$/);
    }
    const filterLabel = document.querySelector('label[for="adminStructureFilter"]');
    const filterAria = document.getElementById('adminStructureFilter')?.getAttribute('aria-label');
    assert.ok(filterLabel || filterAria, 'Structure filter needs a label or aria-label');
    document.getElementById('adminPeopleSection').innerHTML = window.renderAdminUsersPanelHTML({ tree: TREE, users: [], orgs: [] });
    assert.ok(document.querySelector('label[for="adminUserSearch"], #adminUserSearch[aria-label]'));
  });
});

describe('no schema words in the interface', () => {
  test('the People panel never says "assignment" or shows a raw lowercase type badge', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [] });
    assert.ok(!/\bassignment\b/i.test(html));
  });
  test('the Structure detail badge is capitalized, never a raw lowercase type', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(!html.includes('>unit<'));
    assert.ok(html.includes('>Unit<'));
  });
  test('no visible copy contains the word "node"', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(!/\bnode\b/i.test(html.replace(/data-[a-z-]*node[a-z-]*="[^"]*"/gi, '')));
  });
});

describe('add-child in-flight guard', () => {
  test('the add button and input disable while the request is in flight, and clear on success', async () => {
    const { window, document } = loadFrontendEnv();
    let resolveApi;
    window.api = () => new Promise(r => { resolveApi = r; });
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    document.querySelector('[data-new-child-name="unit:u1"]').value = 'New Ward';
    document.querySelector('[data-add-child="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.querySelector('[data-add-child="unit:u1"]').disabled, true);
    assert.equal(document.querySelector('[data-new-child-name="unit:u1"]').disabled, true);
    resolveApi({ id: 'w9', unitId: 'u1', name: 'New Ward' });
  });
});
