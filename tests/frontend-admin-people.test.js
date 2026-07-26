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
  test('scoped stale assignment renders editable reassign select', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({
      tree: TREE,
      users: [CC_USERS[2]],
      orgs: [{ id: 'bfv2-org', name: 'Default' }]
    });
    assert.ok(html.includes('data-assign-user="usr3"'));
    assert.match(html, /<select[^>]*data-assign-user="usr3"/);
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

describe('filter chips', () => {
  const USERS = [
    { id: 'me', username: 'currentuser', role: 'admin', active: true, orgId: null, assignmentType: 'org', assignmentId: 'bfv2-org' },
    { id: 'a', username: 'alice', role: 'admin', active: true, orgId: null, assignmentType: null, assignmentId: null },
    { id: 'b', username: 'bob', role: 'member', active: true, orgId: null, assignmentType: null, assignmentId: null },
    { id: 'c', username: 'carol', role: 'member', active: false, orgId: null, assignmentType: 'unit', assignmentId: 'u1' }
  ];

  test('matchesAdminPeopleFilter: all/unassigned/disabled/admins', () => {
    const { window } = loadFrontendEnv();
    const m = window.matchesAdminPeopleFilter;
    assert.equal(m(USERS[1], 'all'), true);
    assert.equal(m(USERS[1], 'unassigned'), true);
    assert.equal(m(USERS[2], 'unassigned'), true);
    assert.equal(m(USERS[0], 'unassigned'), false);
    assert.equal(m(USERS[3], 'disabled'), true);
    assert.equal(m(USERS[0], 'disabled'), false);
    assert.equal(m(USERS[0], 'admins'), true);
    assert.equal(m(USERS[2], 'admins'), false);
  });

  test('org-assigned user does not match stale filter when org is in orgs list', async () => {
    const { window } = loadFrontendEnv();
    window.api = async (path) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: USERS };
      return {};
    };
    await window.loadAdminView();
    assert.equal(window.matchesAdminPeopleFilter(USERS[0], 'stale'), false);
  });

  test('clicking a chip filters the visible rows and marks it active', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: USERS };
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.querySelector('[data-people-filter="unassigned"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.querySelector('[data-people-filter="unassigned"]').classList.contains('is-active'), true);
    assert.equal(document.querySelector('[data-user-row="a"]').style.display, '');
    assert.equal(document.querySelector('[data-user-row="me"]').style.display, 'none');
  });

  test('the filter survives a mutation, same as search', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: USERS };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    window.showConfirm = () => Promise.resolve(true);
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.querySelector('[data-people-filter="admins"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    document.querySelector('[data-user-toggle="b"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.querySelector('[data-people-filter="admins"]').classList.contains('is-active'), true);
    assert.equal(document.querySelector('[data-user-row="b"]').style.display, 'none');
  });

  test('assigning a user while Unassigned filter is active hides that row', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const users = [
      { id: 'u1', username: 'pat', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null }
    ];
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.querySelector('[data-people-filter="unassigned"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.querySelector('[data-user-row="u1"]').style.display, '');
    const sel = document.querySelector('[data-assign-user="u1"]');
    sel.value = 'unit:u1';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.querySelector('[data-user-row="u1"]').style.display, 'none');
  });
});

describe('own-row and last-admin disabled states', () => {
  const SOLE_ADMIN = [
    { id: 'me', username: 'currentuser', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
    { id: 'x', username: 'member1', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null }
  ];

  test('isSelfUser matches the logged-in username', () => {
    const { window } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    assert.equal(window.isSelfUser(SOLE_ADMIN[0]), true);
    assert.equal(window.isSelfUser(SOLE_ADMIN[1]), false);
  });

  test('isLastActiveAdmin is true only for the sole active admin of its org bucket', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.isLastActiveAdmin(SOLE_ADMIN[0], SOLE_ADMIN), true);
    const twoAdmins = [SOLE_ADMIN[0], Object.assign({}, SOLE_ADMIN[1], { role: 'admin' })];
    assert.equal(window.isLastActiveAdmin(twoAdmins[0], twoAdmins), false);
  });

  test('isLastActiveAdmin is false for inactive admins', () => {
    const { window } = loadFrontendEnv();
    const inactive = { id: 'x', role: 'admin', active: false, orgId: 'bfv2-org' };
    assert.equal(window.isLastActiveAdmin(inactive, [inactive]), false);
  });

  test('disabling one of two active admins refreshes last-admin guard on the survivor', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'otheradmin');
    let users = [
      { id: 'a1', username: 'admin1', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
      { id: 'a2', username: 'admin2', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null }
    ];
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users };
      if(opts && opts.method === 'POST' && /\/disable$/.test(path)){
        const id = path.match(/\/users\/([^/]+)\/disable/)[1];
        users = users.map(u => u.id === id ? Object.assign({}, u, { active: false }) : u);
        return { ok: true };
      }
      return {};
    };
    window.showConfirm = () => Promise.resolve(true);
    await window.loadAdminView();
    window.switchAdminSection('people');
    assert.equal(document.querySelector('[data-user-toggle="a2"]').disabled, false);
    document.querySelector('[data-user-toggle="a1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const survivorBtn = document.querySelector('[data-user-toggle="a2"]');
    assert.equal(survivorBtn.disabled, true);
    assert.match(survivorBtn.title, /last active admin/i);
  });

  test('your own row disables the Disable button with a reason', () => {
    const { window } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: SOLE_ADMIN, orgs: [] });
    assert.match(html, /data-user-toggle="me"[^>]*disabled[^>]*title="[^"]*own account[^"]*"/);
  });

  test('your own row is marked "You"', () => {
    const { window } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: SOLE_ADMIN, orgs: [] });
    assert.ok(html.includes('You'));
  });

  test('a non-self last active admin cannot be Disabled from the UI', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'otheradmin');
    const users = [
      { id: 'me', username: 'otheradmin', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
      { id: 'only', username: 'soloadmin', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
      { id: 'x', username: 'member1', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null }
    ];
    users[0].role = 'member';
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const btn = document.querySelector('[data-user-toggle="only"]');
    assert.equal(btn.disabled, true);
    assert.match(btn.title, /last active admin/i);
  });
});

describe('show-once secret modal', () => {
  test('showAdminSecret shows the secret and a copy button, and resolves on Done', async () => {
    const { window, document } = loadFrontendEnv();
    window.navigator.clipboard = { writeText: async () => {} };
    const p = window.showAdminSecret('User created', 'bone-plate-1234');
    assert.equal(document.getElementById('adminSecretModal').classList.contains('active'), true);
    assert.equal(document.getElementById('adminSecretValue').value, 'bone-plate-1234');
    document.getElementById('adminSecretDoneBtn').click();
    await p;
    assert.equal(document.getElementById('adminSecretModal').classList.contains('active'), false);
  });

  test('the copy button copies the secret to the clipboard', async () => {
    const { window, document } = loadFrontendEnv();
    const copied = [];
    window.navigator.clipboard = { writeText: async (t) => copied.push(t) };
    window.showAdminSecret('User created', 'bone-plate-1234');
    document.getElementById('adminSecretCopyBtn').click();
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(copied, ['bone-plate-1234']);
  });
});

describe('create person in one step', () => {
  test('create form has username, role and placement together, and no window.alert is used', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users' && (!opts || opts.method !== 'POST')) return { users: [] };
      return { id: 'new1', username: 'newperson', temporaryPassword: 'bone-plate-9999' };
    };
    let alerted = false;
    window.alert = () => { alerted = true; };
    await window.loadAdminView();
    window.switchAdminSection('people');
    assert.ok(document.getElementById('adminNewUserPlacement'), 'expected a placement picker in the create form');

    document.getElementById('adminNewUsername').value = 'newperson';
    document.getElementById('adminCreateUser').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    assert.equal(alerted, false);
    assert.equal(document.getElementById('adminSecretModal').classList.contains('active'), true);
    assert.equal(document.getElementById('adminSecretValue').value, 'bone-plate-9999');
  });

  test('a chosen placement creates the user then assigns them (two calls)', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users' && (!opts || opts.method !== 'POST')) return { users: [] };
      if(path === '/api/admin/users' && opts && opts.method === 'POST') return { id: 'new1', temporaryPassword: 'x' };
      return { ok: true };
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.getElementById('adminNewUsername').value = 'placed1';
    document.getElementById('adminNewUserPlacement').value = 'unit:u1';
    document.getElementById('adminCreateUser').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const createCall = calls.find(c => c.path === '/api/admin/users' && c.opts && c.opts.method === 'POST');
    assert.ok(createCall);
    const createBody = JSON.parse(createCall.opts.body);
    assert.equal(createBody.username, 'placed1');
    assert.equal(createBody.role, 'member');
    assert.equal(createBody.nodeType, undefined);
    assert.equal(createBody.nodeId, undefined);
    const assignCall = calls.find(c => c.path === '/api/admin/users/new1/assign');
    assert.ok(assignCall, 'expected a follow-up POST to /assign');
    assert.deepEqual(JSON.parse(assignCall.opts.body), { nodeType: 'unit', nodeId: 'u1' });
  });

  test('create still shows the temporary password when assign fails', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users' && (!opts || opts.method !== 'POST')) return { users: [] };
      if(path === '/api/admin/users' && opts && opts.method === 'POST') return { id: 'new1', temporaryPassword: 'bone-plate-fail' };
      if(path.endsWith('/assign')) throw new Error('assign failed');
      return { ok: true };
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.getElementById('adminNewUsername').value = 'placed2';
    document.getElementById('adminNewUserPlacement').value = 'unit:u1';
    document.getElementById('adminCreateUser').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const createCall = calls.find(c => c.path === '/api/admin/users' && c.opts && c.opts.method === 'POST');
    assert.ok(createCall);
    const createBody = JSON.parse(createCall.opts.body);
    assert.equal(createBody.nodeType, undefined);
    assert.equal(createBody.nodeId, undefined);
    assert.equal(document.getElementById('adminSecretModal').classList.contains('active'), true);
    assert.equal(document.getElementById('adminSecretValue').value, 'bone-plate-fail');
    assert.equal(document.getElementById('adminNewUsername').value, '');
    assert.equal(document.getElementById('adminNewUserPlacement').value, '');
  });
});

describe('role change', () => {
  const USERS = [
    { id: 'me', username: 'currentuser', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
    { id: 'x', username: 'member1', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null }
  ];

  test('the role select posts to /role after a confirmation naming the person and the new role', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    const calls = [];
    let confirmMessage = '';
    window.showConfirm = (title, message) => { confirmMessage = message; return Promise.resolve(true); };
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: USERS };
      return { ok: true, role: 'admin' };
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const sel = document.querySelector('[data-role-user="x"]');
    sel.value = 'admin';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.match(confirmMessage, /member1/);
    assert.match(confirmMessage, /admin/);
    const call = calls.find(c => c.path === '/api/admin/users/x/role');
    assert.ok(call);
    assert.deepEqual(JSON.parse(call.opts.body), { role: 'admin' });
  });

  test('declining the confirmation reverts the select and posts nothing', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    const calls = [];
    window.showConfirm = () => Promise.resolve(false);
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: USERS };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const sel = document.querySelector('[data-role-user="x"]');
    sel.value = 'admin';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(sel.value, 'member');
    assert.equal(calls.some(c => c.path === '/api/admin/users/x/role'), false);
  });

  test('the role select is disabled on your own row and for the last active admin of the org', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    const users = [
      { id: 'me', username: 'currentuser', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
      { id: 'only', username: 'soloadmin', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null }
    ];
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users };
    await window.loadAdminView();
    window.switchAdminSection('people');
    assert.equal(document.querySelector('[data-role-user="me"]').disabled, true);
    assert.ok(document.querySelector('[data-role-user="me"]').title.length > 0);
    assert.equal(document.querySelector('[data-role-user="only"]').disabled, true);
    assert.match(document.querySelector('[data-role-user="only"]').title, /last active admin/i);
  });
});

describe('placement change: inline confirmation and revert', () => {
  test('a successful change shows an inline "Saved" note next to that row only', async () => {
    const { window, document } = loadFrontendEnv();
    const users = CC_USERS.map(u => ({ ...u }));
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const sel = document.querySelector('[data-assign-user="usr2"]');
    sel.value = 'unit:u1';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(document.querySelector('[data-user-row="usr2"]').textContent.includes('Saved'));
    assert.ok(!document.querySelector('[data-user-row="usr1"]').textContent.includes('Saved'));
    const assignCell = document.querySelector('[data-assign-user="usr2"]')?.closest('td');
    assert.ok(assignCell?.querySelector('.admin-inline-note'), 'note lives beside the select');
    assert.equal(document.querySelector('[data-user-row="usr2"] td:last-child').querySelector('.admin-inline-note'), null);
  });

  test('a failed change reverts the select and shows the reason inline, not just a toast', async () => {
    const { window, document } = loadFrontendEnv();
    const users = CC_USERS.map(u => ({ ...u }));
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users };
      if(opts && opts.method === 'POST'){ const e = new window.Error('Node is not in this organization'); throw e; }
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const sel = document.querySelector('[data-assign-user="usr2"]');
    const before = sel.value;
    sel.value = 'unit:u1';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(sel.value, before);
    assert.ok(document.querySelector('[data-user-row="usr2"]').textContent.includes('Node is not in this organization'));
  });
});

describe('sticky bulk bar reports what happened', () => {
  test('a successful bulk assign reports the count and target, and stays visible with the same selection', async () => {
    const { window, document } = loadFrontendEnv();
    const users = CC_USERS.map(u => ({ ...u }));
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users };
      if(opts && opts.method === 'POST') return { assigned: 1 };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.querySelector('[data-user-check="usr2"]').checked = true;
    document.querySelector('[data-user-check="usr2"]').dispatchEvent(new window.Event('change', { bubbles: true }));
    document.getElementById('adminBulkNode').value = 'unit:u1';
    document.getElementById('adminBulkApply').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(document.querySelector('[data-user-check="usr2"]').checked, 'selection stays visible');
    const bar = document.getElementById('adminBulkBar');
    assert.match(bar.textContent, /Assigned 1 person to Ortho › IV/);
  });
});

describe('mobile card markup for the People list', () => {
  test('every row also renders as a card, hidden by CSS on wide viewports', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [] });
    assert.ok(html.includes('admin-people-cards'));
    assert.ok(html.includes('data-user-card="usr2"'));
  });

  test('Unassigned filter hides cards the same way as table rows', async () => {
    const { window, document } = loadFrontendEnv();
    const users = [
      { id: 'u1', username: 'pat', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
      { id: 'u2', username: 'assigned', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'unit', assignmentId: 'u1' }
    ];
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users };
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.querySelector('[data-people-filter="unassigned"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.querySelector('[data-user-row="u1"]').style.display, '');
    assert.equal(document.querySelector('[data-user-card="u1"]').style.display, '');
    assert.equal(document.querySelector('[data-user-row="u2"]').style.display, 'none');
    assert.equal(document.querySelector('[data-user-card="u2"]').style.display, 'none');
  });

  test('sole last active admin card Disable is disabled with last-admin title', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'otheradmin');
    const users = [
      { id: 'only', username: 'soloadmin', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null }
    ];
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const btn = document.querySelector('[data-user-card="only"] [data-user-toggle="only"]');
    assert.equal(btn.disabled, true);
    assert.match(btn.title, /last active admin/i);
  });

  test('row placement change updates the matching card assign select', async () => {
    const { window, document } = loadFrontendEnv();
    const users = CC_USERS.map(u => ({ ...u }));
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const sel = document.querySelector('[data-assign-user="usr2"]');
    sel.value = 'unit:u1';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const cardSel = document.querySelector('[data-user-card="usr2"] [data-assign-user="usr2"]');
    assert.equal(cardSel.value, 'unit:u1');
    assert.equal(cardSel.selectedOptions[0].textContent, 'Ortho › IV');
  });
});

describe('no mobile read-only gate (Task 11)', () => {
  test('a narrow viewport still renders the assign select, checkbox and create form', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }] });
    assert.ok(html.includes('data-assign-user'));
    assert.ok(html.includes('data-user-check'));
    assert.ok(html.includes('id="adminCreateUser"'));
  });

  test('narrow viewport cards contain full write controls in the DOM', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: CC_USERS };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const card = document.querySelector('[data-user-card="usr2"]');
    assert.ok(card.querySelector('[data-assign-user="usr2"]'));
    assert.ok(card.querySelector('[data-role-user="usr2"]'));
    assert.ok(card.querySelector('[data-user-check="usr2"]'));
  });

  test('assign change on a card select shows Saved beside the card assign control', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const users = CC_USERS.map(u => ({ ...u }));
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.querySelector('[data-user-card="usr2"]')?.classList.add('is-expanded');
    const sel = document.querySelector('[data-user-card="usr2"] [data-assign-user="usr2"]');
    sel.value = 'unit:u1';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const assignHost = document.querySelector('[data-user-card="usr2"] .admin-people-card-assign');
    assert.ok(assignHost?.querySelector('.admin-inline-note')?.textContent.includes('Saved'));
  });

  test('card role change posts to /role after confirm', async () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const users = CC_USERS.map(u => ({ ...u }));
    const calls = [];
    window.showConfirm = () => Promise.resolve(true);
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.querySelector('[data-user-card="usr2"]')?.classList.add('is-expanded');
    const sel = document.querySelector('[data-user-card="usr2"] [data-role-user="usr2"]');
    sel.value = 'admin';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const roleCall = calls.find(c => c.path === '/api/admin/users/usr2/role');
    assert.ok(roleCall, 'expected POST to /role');
    assert.equal(JSON.parse(roleCall.opts.body).role, 'admin');
  });
});
