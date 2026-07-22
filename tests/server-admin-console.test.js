import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, syncPost } from './helpers/server-harness.js';

async function api(baseUrl, token, path, opts = {}){
  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let json = null;
  try{ json = await res.json(); }catch{}
  return { status: res.status, json };
}

describe('admin console — end-to-end provisioning flow (flag on)', () => {
  let srv, root;
  before(async () => {
    srv = await startServer({ multiTenant: true, seed: async () => {} }); // seed:{} → harness seeds instance admin
    root = (await login(srv.baseUrl)).json.token;
  });
  after(async () => { await srv.stop(); });

  let boss, member, orgId, hospitalId, departmentId, department2Id, memberId, wardId, unitId;

  test('instance admin creates org and its first org admin', async () => {
    const org = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Pilot Org' } });
    assert.equal(org.status, 200);
    orgId = org.json.id;
    assert.equal(org.json.plan, 'free');

    const admin = await api(srv.baseUrl, root, `/api/admin/orgs/${orgId}/admin`, { method: 'POST', body: { username: 'boss' } });
    assert.equal(admin.status, 200);
    assert.ok(admin.json.temporaryPassword);
    boss = (await login(srv.baseUrl, 'boss', admin.json.temporaryPassword)).json.token;
    assert.ok(boss);
  });

  test('org admin builds hospital + departments', async () => {
    const h = await api(srv.baseUrl, boss, '/api/admin/hospitals', { method: 'POST', body: { name: 'City Hospital' } });
    assert.equal(h.status, 200);
    hospitalId = h.json.id;
    const w1 = await api(srv.baseUrl, boss, '/api/admin/departments', { method: 'POST', body: { hospitalId, name: 'Ortho' } });
    assert.equal(w1.status, 200);
    departmentId = w1.json.id;
    assert.equal(w1.json.specialty, 'ortho');
    const w2 = await api(srv.baseUrl, boss, '/api/admin/departments', { method: 'POST', body: { hospitalId, name: 'Surgery', specialty: 'surgery' } });
    department2Id = w2.json.id;
  });

  test('org admin creates a ward under their department, then a unit under that ward', async () => {
    const ward = await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { departmentId, name: 'Ward A' } });
    assert.equal(ward.status, 200);
    assert.equal(ward.json.departmentId, departmentId);
    wardId = ward.json.id;

    const unit = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { wardId, name: 'Bay 1' } });
    assert.equal(unit.status, 200);
    assert.equal(unit.json.wardId, wardId);
    unitId = unit.json.id;
  });

  test('ward/unit validation: bad names, missing parents', async () => {
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { departmentId, name: '' } })).status, 400);
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { departmentId, name: 'x'.repeat(81) } })).status, 400);
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { departmentId: 'nonexistent', name: 'X' } })).status, 404);
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { wardId, name: '' } })).status, 400);
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { wardId: 'nonexistent', name: 'X' } })).status, 404);
  });

  test('org admin creates a member into a department; member syncs scoped', async () => {
    // /api/admin/users still only sets the legacy per-department `wardId`
    // field — it doesn't grant a unit-level `assignment`. scope.js's
    // resolveScope only scopes non-admin members via actor.assignment, so a
    // member with just a legacy wardId (and no assignment) reads nothing
    // until they're assigned a node via /api/admin/users/:id/assign.
    const u = await api(srv.baseUrl, boss, '/api/admin/users', { method: 'POST', body: { username: 'pg9', wardId: departmentId } });
    assert.equal(u.status, 200);
    memberId = u.json.id;
    member = (await login(srv.baseUrl, 'pg9', u.json.temporaryPassword)).json.token;
    const push = await syncPost(srv.baseUrl, member, { since: 0, changes: [{ id: 'cp1', name: 'Console Patient', status: 'postop', updatedAt: Date.now() }] });
    assert.equal(push.status, 200); // contract unchanged: no error, write just not scoped-in
    const pull = await syncPost(srv.baseUrl, member, { since: 0, changes: [] });
    assert.deepEqual(pull.json.patients.map(p => p.id), []);
  });

  test('org tree stats reflect the created world, nested down to the unit', async () => {
    const t = await api(srv.baseUrl, boss, '/api/admin/org');
    assert.equal(t.status, 200);
    assert.equal(t.json.totals.hospitals, 1);
    assert.equal(t.json.totals.departments, 2);
    assert.equal(t.json.totals.wards, 1);
    assert.equal(t.json.totals.units, 1);
    // livePatients is 0, not 1: cp1 above was never scoped-in (see note above),
    // so it was never stamped/stored under this department.
    assert.equal(t.json.totals.livePatients, 0);
    const dep = t.json.hospitals[0].departments.find(x => x.id === departmentId);
    assert.equal(dep.stats.livePatients, 0);
    assert.equal(dep.stats.byStatus.postop, 0);
    assert.equal(dep.stats.users, 1); // user counting still keys off the legacy wardId field
    assert.equal(dep.stats.lastActivity, null);
    const ward = dep.wards.find(w => w.id === wardId);
    assert.ok(ward, 'ward nested under its department');
    assert.equal(ward.name, 'Ward A');
    const unit = ward.units.find(u => u.id === unitId);
    assert.ok(unit, 'unit nested under its ward');
    assert.equal(unit.name, 'Bay 1');
    assert.deepEqual(unit.stats.byStatus, { postop: 0, preop: 0, conservative: 0, fordischarge: 0 });
  });

  test('org-scoped user list; node-based assign takes effect on next request', async () => {
    const list = await api(srv.baseUrl, boss, '/api/admin/users');
    assert.equal(list.status, 200);
    const names = list.json.users.map(u => u.username).sort();
    assert.deepEqual(names, ['boss', 'pg9']); // no instance admin, no other orgs
    assert.equal(list.json.users.find(u => u.username === 'pg9').wardId, departmentId);

    const mv = await api(srv.baseUrl, boss, `/api/admin/users/${memberId}/assign`, { method: 'POST', body: { nodeType: 'unit', nodeId: unitId } });
    assert.equal(mv.status, 200);
    assert.deepEqual(mv.json.assignment, { type: 'unit', id: unitId });

    // GET /api/admin/users must reflect the new assignment so the console's
    // user-assignment <select> can pre-select the user's current node.
    const listAfterAssign = await api(srv.baseUrl, boss, '/api/admin/users');
    const pg9Row = listAfterAssign.json.users.find(u => u.username === 'pg9');
    assert.equal(pg9Row.assignmentType, 'unit');
    assert.equal(pg9Row.assignmentId, unitId);

    // cp1 was dropped on its original push (member had no assignment yet), so
    // it still doesn't exist server-side; the now-scoped member correctly
    // sees nothing until they push again.
    const pull = await syncPost(srv.baseUrl, member, { since: 0, changes: [] });
    assert.deepEqual(pull.json.patients, []);

    // Prove the assignment actually took effect: a fresh push now lands
    // under the assigned unit and shows up in a pull.
    const push2 = await syncPost(srv.baseUrl, member, { since: 0, changes: [{ id: 'cp2', name: 'Bay 1 Patient', status: 'postop', updatedAt: Date.now() }] });
    assert.equal(push2.status, 200);
    const pull2 = await syncPost(srv.baseUrl, member, { since: 0, changes: [] });
    assert.deepEqual(pull2.json.patients.map(p => p.id), ['cp2']);

    // unassign
    const clear = await api(srv.baseUrl, boss, `/api/admin/users/${memberId}/assign`, { method: 'POST', body: { nodeId: null } });
    assert.equal(clear.status, 200);
    assert.equal(clear.json.assignment, null);
  });

  test('cross-org isolation on every console surface', async () => {
    const org2 = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Other Org' } });
    const a2 = await api(srv.baseUrl, root, `/api/admin/orgs/${org2.json.id}/admin`, { method: 'POST', body: { username: 'boss2' } });
    const boss2 = (await login(srv.baseUrl, 'boss2', a2.json.temporaryPassword)).json.token;

    assert.equal((await api(srv.baseUrl, boss2, '/api/admin/departments', { method: 'POST', body: { hospitalId, name: 'Sneaky' } })).status, 403);
    assert.equal((await api(srv.baseUrl, boss2, '/api/admin/wards', { method: 'POST', body: { departmentId, name: 'Sneaky Ward' } })).status, 403);
    assert.equal((await api(srv.baseUrl, boss2, '/api/admin/units', { method: 'POST', body: { wardId, name: 'Sneaky Unit' } })).status, 403);
    assert.equal((await api(srv.baseUrl, boss2, `/api/admin/users/${memberId}/assign`, { method: 'POST', body: { nodeId: null } })).status, 403);
    assert.equal((await api(srv.baseUrl, boss2, `/api/admin/users/${memberId}/disable`, { method: 'POST' })).status, 403);
    const list2 = await api(srv.baseUrl, boss2, '/api/admin/users');
    assert.deepEqual(list2.json.users.map(u => u.username), ['boss2']);
    const t2 = await api(srv.baseUrl, boss2, '/api/admin/org');
    assert.equal(t2.json.totals.hospitals, 0);

    // node-based assign: even for a user in boss2's own org, a cross-org
    // nodeId (belonging to org1) must be rejected by nodeInOrg.
    const own = await api(srv.baseUrl, boss2, '/api/admin/users', { method: 'POST', body: { username: 'org2member' } });
    assert.equal(own.status, 200);
    const crossAssign = await api(srv.baseUrl, boss2, `/api/admin/users/${own.json.id}/assign`, { method: 'POST', body: { nodeType: 'unit', nodeId: unitId } });
    assert.equal(crossAssign.status, 403);
  });

  test('validation: bad names, foreign wardId, instance-admin org targeting', async () => {
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/hospitals', { method: 'POST', body: { name: '' } })).status, 400);
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/hospitals', { method: 'POST', body: { name: 'x'.repeat(81) } })).status, 400);
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/users', { method: 'POST', body: { username: 'pgz', wardId: 'nonexistent' } })).status, 403);
    assert.equal((await api(srv.baseUrl, root, '/api/admin/org')).status, 400); // instance admin must pass ?orgId=
    assert.equal((await api(srv.baseUrl, root, `/api/admin/org?orgId=${orgId}`)).status, 200);
    assert.equal((await api(srv.baseUrl, member, '/api/admin/org')).status, 403); // members never
    const rollups = await api(srv.baseUrl, root, '/api/admin/orgs');
    assert.equal(rollups.status, 200);
    assert.equal(rollups.json.orgs.find(o => o.id === orgId).stats.livePatients, 1); // cp2 landed under the unit
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/orgs')).status, 403); // org admin can't list orgs
  });
});

describe('admin console — flag OFF: new routes do not exist', () => {
  let srv, root;
  before(async () => {
    srv = await startServer({ multiTenant: false });
    root = (await login(srv.baseUrl)).json.token;
  });
  after(async () => { await srv.stop(); });

  test('all new routes 404; existing user list shape unchanged', async () => {
    for(const [path, method, body] of [
      ['/api/admin/orgs', 'POST', { name: 'X' }],
      ['/api/admin/orgs', 'GET'],
      ['/api/admin/org', 'GET'],
      ['/api/admin/hospitals', 'POST', { name: 'X' }],
      ['/api/admin/departments', 'POST', { hospitalId: 'h', name: 'X' }],
      ['/api/admin/wards', 'POST', { departmentId: 'd', name: 'X' }],
      ['/api/admin/units', 'POST', { wardId: 'w', name: 'X' }],
      ['/api/admin/users/u1/assign', 'POST', { nodeId: null }]
    ]){
      const r = await api(srv.baseUrl, root, path, { method, body });
      assert.equal(r.status, 404, `${method} ${path} must be 404 flag-off`);
    }
    const list = await api(srv.baseUrl, root, '/api/admin/users');
    assert.equal(list.status, 200);
    const keys = Object.keys(list.json.users[0]).sort();
    assert.deepEqual(keys, ['active', 'createdAt', 'id', 'role', 'username']); // no wardId/orgId leak flag-off
  });
});
