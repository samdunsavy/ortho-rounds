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

  test('org admin creates a unit under their department, then a ward under that unit', async () => {
    const unit = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { departmentId, name: 'Bay 1' } });
    assert.equal(unit.status, 200);
    assert.equal(unit.json.departmentId, departmentId);
    unitId = unit.json.id;

    const ward = await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { unitId, name: 'Ward A' } });
    assert.equal(ward.status, 200);
    assert.equal(ward.json.unitId, unitId);
    wardId = ward.json.id;
  });

  test('ward/unit validation: bad names, missing parents', async () => {
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { departmentId, name: '' } })).status, 400);
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { departmentId, name: 'x'.repeat(81) } })).status, 400);
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { departmentId: 'nonexistent', name: 'X' } })).status, 404);
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { unitId, name: '' } })).status, 400);
    assert.equal((await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { unitId: 'nonexistent', name: 'X' } })).status, 404);
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
    const unit = dep.units.find(u => u.id === unitId);
    assert.ok(unit, 'unit nested under its department');
    assert.equal(unit.name, 'Bay 1');
    assert.deepEqual(unit.stats.byStatus, { postop: 0, preop: 0, conservative: 0, fordischarge: 0 });
    const ward = unit.wards.find(w => w.id === wardId);
    assert.ok(ward, 'ward nested under its unit');
    assert.equal(ward.name, 'Ward A');
    assert.deepEqual(ward.stats.byStatus, { postop: 0, preop: 0, conservative: 0, fordischarge: 0 });
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
    assert.equal((await api(srv.baseUrl, boss2, '/api/admin/units', { method: 'POST', body: { departmentId, name: 'Sneaky Unit' } })).status, 403);
    assert.equal((await api(srv.baseUrl, boss2, '/api/admin/wards', { method: 'POST', body: { unitId, name: 'Sneaky Ward' } })).status, 403);
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

  test('instance admin must name an org when creating a user (no org-less users)', async () => {
    const orphan = await api(srv.baseUrl, root, '/api/admin/users', { method: 'POST', body: { username: 'orphan1' } });
    assert.equal(orphan.status, 400);
    assert.equal(orphan.json.error, 'orgId required');

    // And the rejected user really was not created.
    const after = await api(srv.baseUrl, root, '/api/admin/users', { method: 'GET' });
    assert.equal(after.json.users.some(u => u.username === 'orphan1'), false);

    const placed = await api(srv.baseUrl, root, '/api/admin/users', { method: 'POST', body: { username: 'placed1', orgId } });
    assert.equal(placed.status, 200);
    const listed = (await api(srv.baseUrl, root, '/api/admin/users', { method: 'GET' })).json.users;
    assert.equal(listed.find(u => u.username === 'placed1').orgId, orgId);
  });

  test('instance admin naming an unknown org gets 404', async () => {
    const bad = await api(srv.baseUrl, root, '/api/admin/users', { method: 'POST', body: { username: 'nowhere1', orgId: 'no-such-org' } });
    assert.equal(bad.status, 404);
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

  test('no orgId is required when MULTI_TENANT is off', async () => {
    const u = await api(srv.baseUrl, root, '/api/admin/users', { method: 'POST', body: { username: 'plainflagoff' } });
    assert.equal(u.status, 200);
    assert.ok(u.json.temporaryPassword);
  });
});

describe('user role changes (flag on)', () => {
  let srv, root, orgId, bossToken, bossId, memberId, memberToken;

  before(async () => {
    srv = await startServer({ multiTenant: true, seed: async () => {} });
    root = (await login(srv.baseUrl)).json.token;
    const org = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Role Org' } });
    orgId = org.json.id;
    const boss = await api(srv.baseUrl, root, `/api/admin/orgs/${orgId}/admin`, { method: 'POST', body: { username: 'roleboss' } });
    bossId = boss.json.id;
    bossToken = (await login(srv.baseUrl, 'roleboss', boss.json.temporaryPassword)).json.token;
    const m = await api(srv.baseUrl, bossToken, '/api/admin/users', { method: 'POST', body: { username: 'rolemember' } });
    memberId = m.json.id;
    memberToken = (await login(srv.baseUrl, 'rolemember', m.json.temporaryPassword)).json.token;
  });
  after(async () => { await srv.stop(); });

  test('an invalid role value is rejected', async () => {
    const bad = await api(srv.baseUrl, bossToken, `/api/admin/users/${memberId}/role`, { method: 'POST', body: { role: 'superuser' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'Role must be admin or member');
  });

  test('you cannot change your own role', async () => {
    const self = await api(srv.baseUrl, bossToken, `/api/admin/users/${bossId}/role`, { method: 'POST', body: { role: 'member' } });
    assert.equal(self.status, 400);
    assert.equal(self.json.error, 'You cannot change your own role');
  });

  test('demoting the last active admin of an org is refused', async () => {
    // rolemember is still a member, so roleboss is the org's only admin.
    const only = await api(srv.baseUrl, root, `/api/admin/users/${bossId}/role`, { method: 'POST', body: { role: 'member' } });
    assert.equal(only.status, 400);
    assert.equal(only.json.error, 'This is the last active admin of the organization');
  });

  test('promoting a member works and signs them out', async () => {
    const before = await syncPost(srv.baseUrl, memberToken, { since: 0, changes: [] });
    assert.equal(before.status, 200);

    const up = await api(srv.baseUrl, bossToken, `/api/admin/users/${memberId}/role`, { method: 'POST', body: { role: 'admin' } });
    assert.equal(up.status, 200);
    assert.deepEqual(up.json, { ok: true, role: 'admin' });

    const listed = (await api(srv.baseUrl, bossToken, '/api/admin/users', { method: 'GET' })).json.users;
    assert.equal(listed.find(u => u.id === memberId).role, 'admin');

    // tokenVersion was bumped, so the token issued before the change is dead.
    const after = await syncPost(srv.baseUrl, memberToken, { since: 0, changes: [] });
    assert.equal(after.status, 401);
  });

  test('demoting works once another admin exists', async () => {
    // rolemember is an admin now, so roleboss is no longer the only one.
    const down = await api(srv.baseUrl, bossToken, `/api/admin/users/${memberId}/role`, { method: 'POST', body: { role: 'member' } });
    assert.equal(down.status, 200);
    const listed = (await api(srv.baseUrl, bossToken, '/api/admin/users', { method: 'GET' })).json.users;
    assert.equal(listed.find(u => u.id === memberId).role, 'member');
  });

  test('an org admin cannot change a role in another org', async () => {
    const org2 = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Other Role Org' } });
    const boss2 = await api(srv.baseUrl, root, `/api/admin/orgs/${org2.json.id}/admin`, { method: 'POST', body: { username: 'roleboss2' } });
    const cross = await api(srv.baseUrl, bossToken, `/api/admin/users/${boss2.json.id}/role`, { method: 'POST', body: { role: 'member' } });
    assert.equal(cross.status, 403);
    assert.equal(cross.json.error, 'Not your organization');
  });

  test('an unknown user is a 404', async () => {
    const missing = await api(srv.baseUrl, bossToken, '/api/admin/users/no-such-user/role', { method: 'POST', body: { role: 'admin' } });
    assert.equal(missing.status, 404);
  });
});
