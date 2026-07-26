import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';
import { TREE } from './frontend-admin-console.test.js';

const CC_USERS = [
  { id: 'usr1', username: 'xavier', role: 'admin', active: true, orgId: null, assignmentType: null, assignmentId: null },
  { id: 'usr2', username: 'Amit', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'org', assignmentId: 'bfv2-org' },
  { id: 'usr3', username: 'ghost', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'unit', assignmentId: 'gone-unit' }
];

describe('assign-select grouping', () => {
  test('buildAssignNodeGroups groups nodes by level with full-path labels', () => {
    const { window } = loadFrontendEnv();
    const groups = window.buildAssignNodeGroups(TREE, [{ id: 'bfv2-org', name: 'Default' }]);
    assert.deepEqual([...groups.hospital.map(g => g.id)], ['h1']);
    assert.deepEqual([...groups.department.map(g => g.id)], ['d1']);
    assert.deepEqual([...groups.unit.map(g => g.id)], ['u1', 'u2']);
    assert.deepEqual([...groups.ward.map(g => g.id)], ['w1']);
    assert.equal(groups.department[0].label, 'City Hospital › Ortho');
    assert.equal(groups.unit[0].label, 'Ortho › IV');
    assert.equal(groups.ward[0].label, 'Ortho › IV › 7MOW');
  });

  test('renderAssignSelectOptionsHTML marks the selected node and encodes type:id in option values', () => {
    const { window } = loadFrontendEnv();
    const groups = window.buildAssignNodeGroups(TREE, []);
    const html = window.renderAssignSelectOptionsHTML(groups, 'unit', 'u1');
    assert.ok(html.includes('<option value="">— none —</option>'));
    assert.match(html, /<option value="unit:u1" selected>/);
    assert.ok(html.includes('<optgroup label="Wards">'));
  });

  test('a stale selection reads "Assigned to a place that no longer exists", not a raw type:id', () => {
    const { window } = loadFrontendEnv();
    const groups = window.buildAssignNodeGroups(TREE, []);
    const html = window.renderAssignSelectOptionsHTML(groups, 'unit', 'gone-unit');
    assert.ok(html.includes('Assigned to a place that no longer exists'));
    assert.ok(!html.includes('Stale ('));
  });
});

describe('delegated assign-select change handler', () => {
  test('fires the assign endpoint with {nodeType, nodeId}', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return { ok: true }; };
    document.getElementById('adminPeopleSection').innerHTML =
      '<select data-assign-user="usr2" data-prev="ward:w1"><option value="">— none —</option><option value="unit:u1">Ortho › IV</option></select>';
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
    document.getElementById('adminPeopleSection').innerHTML =
      '<select data-assign-user="usr2" data-prev="ward:w1"><option value="">— none —</option><option value="unit:u1">Ortho › IV</option></select>';
    const sel = document.querySelector('select[data-assign-user="usr2"]');
    sel.value = '';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].opts.body).nodeId, null);
  });
});

describe('users panel', () => {
  test('assignment picker includes an Organizations group', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }] });
    assert.ok(html.includes('<optgroup label="Organizations"'));
    assert.ok(html.includes('value="org:bfv2-org"'));
  });
  test('an org-assigned user is preselected, not shown as none', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }] });
    assert.match(html, /value="org:bfv2-org"\s+selected/);
  });
  test('a stale assignment reads the plain-language warning, not the raw type:id', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [] });
    assert.ok(html.includes('Assigned to a place that no longer exists'));
  });
  test('rows carry a search key and a checkbox', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [] });
    assert.ok(html.includes('data-user-row="usr2"'));
    assert.ok(html.includes('data-user-check="usr2"'));
    assert.ok(html.includes('id="adminUserSearch"'));
  });
});

describe('bulk assign', () => {
  test('checking rows reveals the bulk bar and posts assign-bulk', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: CC_USERS };
      return { ok: true };
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const cb = document.querySelector('[data-user-check="usr2"]');
    cb.checked = true;
    cb.dispatchEvent(new window.Event('change', { bubbles: true }));
    const bar = document.getElementById('adminBulkBar');
    assert.equal(bar.hasAttribute('hidden'), false);
    assert.ok(bar.innerHTML.includes('1 selected'));
    assert.deepEqual([...window.selectedAdminUserIds()], ['usr2']);

    document.getElementById('adminBulkNode').value = 'unit:u1';
    document.getElementById('adminBulkApply').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const assignCall = calls.find(c => c.path === '/api/admin/users/assign-bulk');
    assert.ok(assignCall, 'expected a POST to /api/admin/users/assign-bulk');
    assert.deepEqual(JSON.parse(assignCall.opts.body), { userIds: ['usr2'], nodeType: 'unit', nodeId: 'u1' });
  });
});

describe('user lifecycle', () => {
  test('rows expose toggle and reset controls; create form present', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [] });
    assert.ok(html.includes('data-user-toggle="usr2"'));
    assert.ok(html.includes('data-user-reset="usr2"'));
    assert.ok(html.includes('id="adminCreateUser"'));
    assert.ok(html.includes('id="adminNewUsername"'));
  });
  test('a disabled user offers Enable', () => {
    const { window } = loadFrontendEnv();
    const users = [{ id: 'u9', username: 'off', role: 'member', active: false, orgId: null, assignmentType: null, assignmentId: null }];
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users, orgs: [] });
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
    window.switchAdminSection('people');
    document.getElementById('adminNewUsername').value = 'newpg';
    document.getElementById('adminCreateUser').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/users' && c.opts && c.opts.method === 'POST');
    assert.ok(call, 'expected a POST to /api/admin/users');
    assert.deepEqual(JSON.parse(call.opts.body), { username: 'newpg', role: 'member', orgId: 'bfv2-org' });
  });
});

describe('unscoped instance-admin People (Task 1 review fixes)', () => {
  function instanceAdminEnv(apiFn){
    const env = loadFrontendEnv();
    env.window.localStorage.setItem('ortho_role', 'admin');
    if(apiFn) env.window.api = apiFn;
    return env;
  }

  test('detailed assignment shows Within org name, not stale, with edit-in-org action', () => {
    const { window } = instanceAdminEnv();
    const users = [
      { id: 'u1', username: 'pat', role: 'member', active: true, orgId: 'o1', assignmentType: 'unit', assignmentId: 'u1' }
    ];
    const orgs = [{ id: 'o1', name: 'Pilot Org', plan: 'free', stats: { hospitals: 0, departments: 0, users: 1, livePatients: 0 } }];
    const html = window.renderAdminUsersPanelHTML({ tree: null, users, orgs });
    assert.ok(html.includes('Within Pilot Org'));
    assert.ok(!html.includes('no longer exists'));
    assert.ok(!html.includes('data-assign-user'));
    assert.ok(html.includes('data-enter-user-org="o1"'));
  });

  test('org-level assignment still resolves by name in unscoped view', () => {
    const { window } = instanceAdminEnv();
    const users = [
      { id: 'u2', username: 'amy', role: 'member', active: true, orgId: 'o1', assignmentType: 'org', assignmentId: 'o1' }
    ];
    const orgs = [{ id: 'o1', name: 'Pilot Org', plan: 'free', stats: { hospitals: 0, departments: 0, users: 1, livePatients: 0 } }];
    const html = window.renderAdminUsersPanelHTML({ tree: null, users, orgs });
    assert.ok(html.includes('Pilot Org'));
    assert.ok(!html.includes('no longer exists'));
    assert.ok(html.includes('data-enter-user-org="o1"'));
  });

  test('edit-in-org enters that organization context', async () => {
    const paths = [];
    const { window, document } = instanceAdminEnv(async (path) => {
      paths.push(path);
      if(path === '/api/admin/orgs') return { orgs: [{ id: 'o1', name: 'Pilot Org', plan: 'free', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }] };
      if(path === '/api/admin/users') return { users: [
        { id: 'u1', username: 'pat', role: 'member', active: true, orgId: 'o1', assignmentType: 'unit', assignmentId: 'u1' }
      ] };
      if(path.startsWith('/api/admin/org')) return TREE;
      return {};
    });
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.querySelector('[data-enter-user-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(paths.includes('/api/admin/org?orgId=o1'));
    assert.equal(document.getElementById('adminStructureSection').hidden, false);
  });

  test('drilled-in instance admin keeps the assign select for resolved placements', async () => {
    const { window, document } = instanceAdminEnv(async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [{ id: 'bfv2-org', name: 'Default', plan: 'free', stats: { hospitals: 1, departments: 1, users: 2, livePatients: 5 } }] };
      if(path === '/api/admin/users') return { users: CC_USERS };
      if(path.startsWith('/api/admin/org')) return TREE;
      return {};
    });
    await window.loadAdminView();
    document.querySelector('[data-view-org="bfv2-org"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    window.switchAdminSection('people');
    const html = document.getElementById('adminPeopleSection').innerHTML;
    assert.ok(html.includes('data-assign-user="usr2"'));
    assert.match(html, /value="org:bfv2-org"\s+selected/);
  });

  test('create form hidden in unscoped view; Go to Organizations shown instead', async () => {
    const { window, document } = instanceAdminEnv(async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [{ id: 'o1', name: 'Pilot Org', plan: 'free', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }] };
      if(path === '/api/admin/users') return { users: [] };
      return {};
    });
    await window.loadAdminView();
    window.switchAdminSection('people');
    assert.equal(document.getElementById('adminCreateUser'), null);
    assert.ok(document.getElementById('adminPeoplePickOrg'));
    assert.ok(document.getElementById('adminPeopleSection').textContent.includes('Choose an organization'));
  });

  test('Go to Organizations switches to the orgs section', async () => {
    const { window, document } = instanceAdminEnv(async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [{ id: 'o1', name: 'Pilot Org', plan: 'free', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }] };
      if(path === '/api/admin/users') return { users: [] };
      return {};
    });
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.getElementById('adminPeoplePickOrg').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminOrgsSection').hidden, false);
  });

  test('username input has maxlength 32', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [] });
    assert.match(html, /id="adminNewUsername"[^>]*maxlength="32"/);
  });
});

describe('search and selection survive a mutation (defect 1)', () => {
  test('typing a search term, then disabling a different user, keeps the search box value and the filtered rows', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: CC_USERS };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    window.showConfirm = () => Promise.resolve(true);
    await window.loadAdminView();
    window.switchAdminSection('people');

    const search = document.getElementById('adminUserSearch');
    search.value = 'amit';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.querySelector('[data-user-row="usr1"]').style.display, 'none');
    assert.equal(document.querySelector('[data-user-row="usr2"]').style.display, '');

    document.querySelector('[data-user-toggle="usr1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    assert.equal(document.getElementById('adminUserSearch').value, 'amit');
    assert.equal(document.querySelector('[data-user-row="usr1"]').style.display, 'none');
    assert.equal(document.querySelector('[data-user-row="usr2"]').style.display, '');
  });

  test('checking a row, then disabling a different user, keeps the checkbox checked', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: CC_USERS };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    window.showConfirm = () => Promise.resolve(true);
    await window.loadAdminView();
    window.switchAdminSection('people');

    document.querySelector('[data-user-check="usr2"]').checked = true;
    document.querySelector('[data-user-check="usr2"]').dispatchEvent(new window.Event('change', { bubbles: true }));

    document.querySelector('[data-user-toggle="usr1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    assert.equal(document.querySelector('[data-user-check="usr2"]').checked, true);
    assert.equal(document.getElementById('adminBulkBar').hasAttribute('hidden'), false);
  });

  test('disabling a user repaints only that row (other rows untouched)', async () => {
    const { window, document } = loadFrontendEnv();
    let users = CC_USERS.map(u => Object.assign({}, u));
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users };
      if(opts && opts.method === 'POST' && /\/disable$/.test(path)){
        users = users.map(u => u.id === 'usr2' ? Object.assign({}, u, { active: false }) : u);
        return { ok: true };
      }
      return {};
    };
    window.showConfirm = () => Promise.resolve(true);
    await window.loadAdminView();
    window.switchAdminSection('people');
    const otherRowBefore = document.querySelector('[data-user-row="usr1"]').outerHTML;

    document.querySelector('[data-user-toggle="usr2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    assert.equal(document.querySelector('[data-user-row="usr1"]').outerHTML, otherRowBefore);
    assert.match(document.querySelector('[data-user-row="usr2"]').innerHTML, /data-user-toggle="usr2"[^>]*>Enable</);
  });
});

describe('mobile read-only (removed in Task 11 — still gates today)', () => {
  test('narrow users panel has no live write path: no checkbox, no assign select, but still shows username and assignment as text', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }] });
    assert.ok(!html.includes('data-assign-user'));
    assert.ok(!html.includes('data-user-check'));
    assert.ok(html.includes('xavier'));
    assert.ok(html.includes('Amit'));
    assert.ok(html.includes('Default'));
    assert.ok(html.includes('Assigned to a place that no longer exists'));
    assert.ok(html.includes('—'));
  });
  test('narrow: refreshAdminBulkBar leaves the bulk bar hidden even if a checkbox is injected and checked', () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    document.getElementById('adminPeopleSection').innerHTML = '<div id="adminBulkBar" hidden></div><input type="checkbox" data-user-check="usr2">';
    const cb = document.querySelector('[data-user-check="usr2"]');
    cb.checked = true;
    window.refreshAdminBulkBar();
    const bar = document.getElementById('adminBulkBar');
    assert.equal(bar.hasAttribute('hidden'), true);
    assert.equal(bar.innerHTML, '');
  });
  test('wide users panel still renders the live assign select and checkbox (regression guard)', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }] });
    assert.ok(html.includes('data-assign-user="usr2"'));
    assert.ok(html.includes('data-user-check="usr2"'));
  });
});
