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

describe('PATCH /api/admin/nodes/:type/:id — rename (flag on)', () => {
  let srv, root, boss, orgId, hospitalId, departmentId, wardId, unitId;
  before(async () => {
    srv = await startServer({ multiTenant: true, seed: async () => {} });
    root = (await login(srv.baseUrl)).json.token;

    const org = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Rename Org' } });
    orgId = org.json.id;
    const admin = await api(srv.baseUrl, root, `/api/admin/orgs/${orgId}/admin`, { method: 'POST', body: { username: 'renameboss' } });
    boss = (await login(srv.baseUrl, 'renameboss', admin.json.temporaryPassword)).json.token;

    const h = await api(srv.baseUrl, boss, '/api/admin/hospitals', { method: 'POST', body: { name: 'City Hospital' } });
    hospitalId = h.json.id;
    const d = await api(srv.baseUrl, boss, '/api/admin/departments', { method: 'POST', body: { hospitalId, name: 'Ortho' } });
    departmentId = d.json.id;
    const w = await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { departmentId, name: 'Ward A' } });
    wardId = w.json.id;
    const u = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { wardId, name: 'Bay 1' } });
    unitId = u.json.id;
  });
  after(async () => { await srv.stop(); });

  test('instance admin renames a ward → 200, and a patient under it gets the new ward label', async () => {
    // Push a patient pinned to the unit under this ward (root is unrestricted).
    const push = await syncPost(srv.baseUrl, root, {
      since: 0,
      changes: [{ id: 'rp1', name: 'Rename Patient', status: 'postop', unitId, updatedAt: Date.now() }]
    });
    assert.equal(push.status, 200);
    const before1 = push.json.patients.find(p => p.id === 'rp1');
    assert.ok(before1, 'patient must round-trip on push');
    assert.equal(before1.ward, 'Ward A');

    const rename = await api(srv.baseUrl, root, `/api/admin/nodes/ward/${wardId}`, { method: 'PATCH', body: { name: 'Ward Renamed' } });
    assert.equal(rename.status, 200);
    assert.deepEqual(rename.json, { id: wardId, type: 'ward', name: 'Ward Renamed' });

    const pull = await syncPost(srv.baseUrl, root, { since: 0, changes: [] });
    const after1 = pull.json.patients.find(p => p.id === 'rp1');
    assert.ok(after1, 'patient must still exist after rename');
    assert.equal(after1.ward, 'Ward Renamed', 'patient ward label must be refreshed by the rename');
    assert.equal(after1.unit, 'Bay 1', 'unrelated unit label must be unchanged');
  });

  test('org admin renaming a node in another org → 403', async () => {
    const org2 = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Other Org' } });
    const a2 = await api(srv.baseUrl, root, `/api/admin/orgs/${org2.json.id}/admin`, { method: 'POST', body: { username: 'renameboss2' } });
    const boss2 = (await login(srv.baseUrl, 'renameboss2', a2.json.temporaryPassword)).json.token;

    const attempt = await api(srv.baseUrl, boss2, `/api/admin/nodes/ward/${wardId}`, { method: 'PATCH', body: { name: 'Sneaky Rename' } });
    assert.equal(attempt.status, 403);
  });

  test('empty name → 400', async () => {
    const attempt = await api(srv.baseUrl, boss, `/api/admin/nodes/ward/${wardId}`, { method: 'PATCH', body: { name: '' } });
    assert.equal(attempt.status, 400);
  });

  test('name over 80 chars → 400', async () => {
    const attempt = await api(srv.baseUrl, boss, `/api/admin/nodes/ward/${wardId}`, { method: 'PATCH', body: { name: 'x'.repeat(81) } });
    assert.equal(attempt.status, 400);
  });

  test('unknown node type → 400', async () => {
    const attempt = await api(srv.baseUrl, boss, `/api/admin/nodes/bogus/${wardId}`, { method: 'PATCH', body: { name: 'X' } });
    assert.equal(attempt.status, 400);
  });

  test('nonexistent node id → 404', async () => {
    const attempt = await api(srv.baseUrl, boss, '/api/admin/nodes/ward/nonexistent', { method: 'PATCH', body: { name: 'X' } });
    assert.equal(attempt.status, 404);
  });

  test('non-admin actor → 403', async () => {
    const u = await api(srv.baseUrl, boss, '/api/admin/users', { method: 'POST', body: { username: 'plainmember', wardId: departmentId } });
    const memberToken = (await login(srv.baseUrl, 'plainmember', u.json.temporaryPassword)).json.token;
    const attempt = await api(srv.baseUrl, memberToken, `/api/admin/nodes/ward/${wardId}`, { method: 'PATCH', body: { name: 'X' } });
    assert.equal(attempt.status, 403);
  });
});

describe('DELETE /api/admin/nodes/:type/:id — delete-empty-only (flag on)', () => {
  let srv, root, boss, orgId, hospitalId, departmentId, wardId, unitId;
  before(async () => {
    srv = await startServer({ multiTenant: true, seed: async () => {} });
    root = (await login(srv.baseUrl)).json.token;

    const org = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Delete Org' } });
    orgId = org.json.id;
    const admin = await api(srv.baseUrl, root, `/api/admin/orgs/${orgId}/admin`, { method: 'POST', body: { username: 'deleteboss' } });
    boss = (await login(srv.baseUrl, 'deleteboss', admin.json.temporaryPassword)).json.token;

    const h = await api(srv.baseUrl, boss, '/api/admin/hospitals', { method: 'POST', body: { name: 'City Hospital' } });
    hospitalId = h.json.id;
    const d = await api(srv.baseUrl, boss, '/api/admin/departments', { method: 'POST', body: { hospitalId, name: 'Ortho' } });
    departmentId = d.json.id;
    const w = await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { departmentId, name: 'Ward A' } });
    wardId = w.json.id;
    const u = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { wardId, name: 'Bay 1' } });
    unitId = u.json.id;
  });
  after(async () => { await srv.stop(); });

  test('deleting a ward that still has a unit → 409, blockedBy.children >= 1', async () => {
    const del = await api(srv.baseUrl, boss, `/api/admin/nodes/ward/${wardId}`, { method: 'DELETE' });
    assert.equal(del.status, 409);
    assert.ok(del.json.blockedBy.children >= 1, 'ward has a unit under it, so children must be counted');
    assert.equal(del.json.blockedBy.users, 0);
    assert.equal(del.json.blockedBy.patients, 0);
  });

  test('deleting a unit that has a patient → 409, blockedBy.patients >= 1', async () => {
    const push = await syncPost(srv.baseUrl, root, {
      since: 0,
      changes: [{ id: 'dp1', name: 'Delete Patient', status: 'postop', unitId, updatedAt: Date.now() }]
    });
    assert.equal(push.status, 200);
    assert.ok(push.json.patients.find(p => p.id === 'dp1'), 'patient must round-trip on push');

    const del = await api(srv.baseUrl, boss, `/api/admin/nodes/unit/${unitId}`, { method: 'DELETE' });
    assert.equal(del.status, 409);
    assert.equal(del.json.blockedBy.children, 0);
    assert.equal(del.json.blockedBy.users, 0);
    assert.ok(del.json.blockedBy.patients >= 1, 'unit has a patient under it, so patients must be counted');
  });

  test('deleting a truly empty unit → 200, and the node no longer resolves', async () => {
    const u2 = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { wardId, name: 'Empty Bay' } });
    const emptyUnitId = u2.json.id;

    const del = await api(srv.baseUrl, boss, `/api/admin/nodes/unit/${emptyUnitId}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.deepEqual(del.json, { deleted: true });

    // getUnit returns null after deletion: PATCH re-resolves the node via getNode/getUnit and should now 404.
    const after1 = await api(srv.baseUrl, boss, `/api/admin/nodes/unit/${emptyUnitId}`, { method: 'PATCH', body: { name: 'X' } });
    assert.equal(after1.status, 404);
  });

  test('org admin deleting a node in another org → 403', async () => {
    const org2 = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Other Delete Org' } });
    const a2 = await api(srv.baseUrl, root, `/api/admin/orgs/${org2.json.id}/admin`, { method: 'POST', body: { username: 'deleteboss2' } });
    const boss2 = (await login(srv.baseUrl, 'deleteboss2', a2.json.temporaryPassword)).json.token;

    const u3 = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { wardId, name: 'Cross Org Bay' } });
    const attempt = await api(srv.baseUrl, boss2, `/api/admin/nodes/unit/${u3.json.id}`, { method: 'DELETE' });
    assert.equal(attempt.status, 403);
  });
});

describe('POST /api/admin/nodes/:type/:id/move — re-parent + subtree re-stamp (flag on)', () => {
  let srv, root, boss, orgId, hospitalId, d1, d2, w1, u1;
  before(async () => {
    srv = await startServer({ multiTenant: true, seed: async () => {} });
    root = (await login(srv.baseUrl)).json.token;

    const org = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Move Org' } });
    orgId = org.json.id;
    const admin = await api(srv.baseUrl, root, `/api/admin/orgs/${orgId}/admin`, { method: 'POST', body: { username: 'moveboss' } });
    boss = (await login(srv.baseUrl, 'moveboss', admin.json.temporaryPassword)).json.token;

    const h = await api(srv.baseUrl, boss, '/api/admin/hospitals', { method: 'POST', body: { name: 'City Hospital' } });
    hospitalId = h.json.id;
    const dep1 = await api(srv.baseUrl, boss, '/api/admin/departments', { method: 'POST', body: { hospitalId, name: 'Ortho' } });
    d1 = dep1.json.id;
    const dep2 = await api(srv.baseUrl, boss, '/api/admin/departments', { method: 'POST', body: { hospitalId, name: 'Cardio' } });
    d2 = dep2.json.id;
    const w = await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { departmentId: d1, name: 'Ward A' } });
    w1 = w.json.id;
    const u = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { wardId: w1, name: 'Bay 1' } });
    u1 = u.json.id;
  });
  after(async () => { await srv.stop(); });

  test('moving ward w1 to department d2 → 200, and the pinned patient re-stamps to d2', async () => {
    const push = await syncPost(srv.baseUrl, root, {
      since: 0,
      changes: [{ id: 'mp1', name: 'Move Patient', status: 'postop', unitId: u1, updatedAt: Date.now() }]
    });
    assert.equal(push.status, 200);
    assert.ok(push.json.patients.find(p => p.id === 'mp1'), 'patient must round-trip on push');

    const move = await api(srv.baseUrl, boss, `/api/admin/nodes/ward/${w1}/move`, { method: 'POST', body: { newParentId: d2 } });
    assert.equal(move.status, 200);
    assert.deepEqual(move.json, { id: w1, type: 'ward', newParentId: d2 });

    const pull = await syncPost(srv.baseUrl, root, { since: 0, changes: [] });
    const after1 = pull.json.patients.find(p => p.id === 'mp1');
    assert.ok(after1, 'patient must still exist after move');
    assert.equal(after1.departmentId, d2, 'patient ancestry must be re-stamped to the new department');
  });

  test('moving a unit to a ward in another org → 403', async () => {
    const org2 = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Other Move Org' } });
    const a2 = await api(srv.baseUrl, root, `/api/admin/orgs/${org2.json.id}/admin`, { method: 'POST', body: { username: 'moveboss2' } });
    const boss2 = (await login(srv.baseUrl, 'moveboss2', a2.json.temporaryPassword)).json.token;
    const h2 = await api(srv.baseUrl, boss2, '/api/admin/hospitals', { method: 'POST', body: { name: 'Other Hospital' } });
    const dep2b = await api(srv.baseUrl, boss2, '/api/admin/departments', { method: 'POST', body: { hospitalId: h2.json.id, name: 'Other Dept' } });
    const w2 = await api(srv.baseUrl, boss2, '/api/admin/wards', { method: 'POST', body: { departmentId: dep2b.json.id, name: 'Other Ward' } });

    const attempt = await api(srv.baseUrl, boss, `/api/admin/nodes/unit/${u1}/move`, { method: 'POST', body: { newParentId: w2.json.id } });
    assert.equal(attempt.status, 403);
  });

  test('moving an org → 400', async () => {
    const attempt = await api(srv.baseUrl, boss, `/api/admin/nodes/org/${orgId}/move`, { method: 'POST', body: { newParentId: 'whatever' } });
    assert.equal(attempt.status, 400);
  });

  test('wrong-type parent (ward → a hospital id, not a department) → 404, no silent re-parent', async () => {
    // A ward's required parent type is 'department'; passing a hospital's id looks up
    // getNode(store,'department', hospitalId), which never matches a department row.
    const attempt = await api(srv.baseUrl, boss, `/api/admin/nodes/ward/${w1}/move`, { method: 'POST', body: { newParentId: hospitalId } });
    assert.equal(attempt.status, 404);
  });
});

describe('POST /api/admin/patients/rehome — bulk re-home (flag on)', () => {
  let srv, root, boss, orgId, hospitalId, d1, w1, u1, u2;
  before(async () => {
    srv = await startServer({ multiTenant: true, seed: async () => {} });
    root = (await login(srv.baseUrl)).json.token;

    const org = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Rehome Org' } });
    orgId = org.json.id;
    const admin = await api(srv.baseUrl, root, `/api/admin/orgs/${orgId}/admin`, { method: 'POST', body: { username: 'rehomeboss' } });
    boss = (await login(srv.baseUrl, 'rehomeboss', admin.json.temporaryPassword)).json.token;

    const h = await api(srv.baseUrl, boss, '/api/admin/hospitals', { method: 'POST', body: { name: 'City Hospital' } });
    hospitalId = h.json.id;
    const dep = await api(srv.baseUrl, boss, '/api/admin/departments', { method: 'POST', body: { hospitalId, name: 'Ortho' } });
    d1 = dep.json.id;
    const w = await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { departmentId: d1, name: 'Ward A' } });
    w1 = w.json.id;
    const un1 = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { wardId: w1, name: 'Bay 1' } });
    u1 = un1.json.id;
    const un2 = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { wardId: w1, name: 'Bay 2' } });
    u2 = un2.json.id;
  });
  after(async () => { await srv.stop(); });

  test('instance admin re-homes 2 patients to u2 → 200 {moved:2}, both patients unitId===u2', async () => {
    const push = await syncPost(srv.baseUrl, root, {
      since: 0,
      changes: [
        { id: 'rhp1', name: 'Rehome Patient 1', status: 'postop', unitId: u1, updatedAt: Date.now() },
        { id: 'rhp2', name: 'Rehome Patient 2', status: 'postop', unitId: u1, updatedAt: Date.now() }
      ]
    });
    assert.equal(push.status, 200);

    const rehome = await api(srv.baseUrl, root, '/api/admin/patients/rehome', { method: 'POST', body: { patientIds: ['rhp1', 'rhp2'], unitId: u2 } });
    assert.equal(rehome.status, 200);
    assert.deepEqual(rehome.json, { moved: 2 });

    const pull = await syncPost(srv.baseUrl, root, { since: 0, changes: [] });
    const p1 = pull.json.patients.find(p => p.id === 'rhp1');
    const p2 = pull.json.patients.find(p => p.id === 'rhp2');
    assert.equal(p1.unitId, u2);
    assert.equal(p2.unitId, u2);
  });

  test('re-home with a target unit in another org → 403, neither patient changed', async () => {
    const push = await syncPost(srv.baseUrl, root, {
      since: 0,
      changes: [
        { id: 'rhp3', name: 'Rehome Patient 3', status: 'postop', unitId: u1, updatedAt: Date.now() },
        { id: 'rhp4', name: 'Rehome Patient 4', status: 'postop', unitId: u1, updatedAt: Date.now() }
      ]
    });
    assert.equal(push.status, 200);

    const org2 = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Other Rehome Org' } });
    const a2 = await api(srv.baseUrl, root, `/api/admin/orgs/${org2.json.id}/admin`, { method: 'POST', body: { username: 'rehomeboss2' } });
    const boss2 = (await login(srv.baseUrl, 'rehomeboss2', a2.json.temporaryPassword)).json.token;
    const h2 = await api(srv.baseUrl, boss2, '/api/admin/hospitals', { method: 'POST', body: { name: 'Other Hospital' } });
    const dep2 = await api(srv.baseUrl, boss2, '/api/admin/departments', { method: 'POST', body: { hospitalId: h2.json.id, name: 'Other Dept' } });
    const w2 = await api(srv.baseUrl, boss2, '/api/admin/wards', { method: 'POST', body: { departmentId: dep2.json.id, name: 'Other Ward' } });
    const otherUnit = await api(srv.baseUrl, boss2, '/api/admin/units', { method: 'POST', body: { wardId: w2.json.id, name: 'Other Bay' } });

    const attempt = await api(srv.baseUrl, boss, '/api/admin/patients/rehome', { method: 'POST', body: { patientIds: ['rhp3', 'rhp4'], unitId: otherUnit.json.id } });
    assert.equal(attempt.status, 403);

    const pull = await syncPost(srv.baseUrl, root, { since: 0, changes: [] });
    const p3 = pull.json.patients.find(p => p.id === 'rhp3');
    const p4 = pull.json.patients.find(p => p.id === 'rhp4');
    assert.equal(p3.unitId, u1, 'patient must be unchanged after a validate-all-before-write failure');
    assert.equal(p4.unitId, u1, 'patient must be unchanged after a validate-all-before-write failure');
  });
});

describe('POST /api/admin/users/assign-bulk — bulk user assign (flag on)', () => {
  let srv, root, boss, orgId, hospitalId, departmentId;
  before(async () => {
    srv = await startServer({ multiTenant: true, seed: async () => {} });
    root = (await login(srv.baseUrl)).json.token;

    const org = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'AssignBulk Org' } });
    orgId = org.json.id;
    const admin = await api(srv.baseUrl, root, `/api/admin/orgs/${orgId}/admin`, { method: 'POST', body: { username: 'assignbulkboss' } });
    boss = (await login(srv.baseUrl, 'assignbulkboss', admin.json.temporaryPassword)).json.token;

    const h = await api(srv.baseUrl, boss, '/api/admin/hospitals', { method: 'POST', body: { name: 'City Hospital' } });
    hospitalId = h.json.id;
    const d = await api(srv.baseUrl, boss, '/api/admin/departments', { method: 'POST', body: { hospitalId, name: 'Ortho' } });
    departmentId = d.json.id;
  });
  after(async () => { await srv.stop(); });

  test('assign-bulk 2 users to a department → 200 {assigned:2}, both users assignmentType===department', async () => {
    const u1 = await api(srv.baseUrl, boss, '/api/admin/users', { method: 'POST', body: { username: 'bulkuser1' } });
    const u2 = await api(srv.baseUrl, boss, '/api/admin/users', { method: 'POST', body: { username: 'bulkuser2' } });

    const assign = await api(srv.baseUrl, boss, '/api/admin/users/assign-bulk', { method: 'POST', body: { userIds: [u1.json.id, u2.json.id], nodeType: 'department', nodeId: departmentId } });
    assert.equal(assign.status, 200);
    assert.deepEqual(assign.json, { assigned: 2 });

    const users = await api(srv.baseUrl, boss, '/api/admin/users', { method: 'GET' });
    const a1 = users.json.users.find(u => u.id === u1.json.id);
    const a2 = users.json.users.find(u => u.id === u2.json.id);
    assert.equal(a1.assignmentType, 'department');
    assert.equal(a1.assignmentId, departmentId);
    assert.equal(a2.assignmentType, 'department');
    assert.equal(a2.assignmentId, departmentId);
  });

  test('assign-bulk where one user is in another org → 403, neither user changed', async () => {
    const u3 = await api(srv.baseUrl, boss, '/api/admin/users', { method: 'POST', body: { username: 'bulkuser3' } });

    const org2 = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Other AssignBulk Org' } });
    const a2admin = await api(srv.baseUrl, root, `/api/admin/orgs/${org2.json.id}/admin`, { method: 'POST', body: { username: 'assignbulkboss2' } });
    const boss2 = (await login(srv.baseUrl, 'assignbulkboss2', a2admin.json.temporaryPassword)).json.token;
    const u4 = await api(srv.baseUrl, boss2, '/api/admin/users', { method: 'POST', body: { username: 'bulkuser4' } });

    const attempt = await api(srv.baseUrl, boss, '/api/admin/users/assign-bulk', { method: 'POST', body: { userIds: [u3.json.id, u4.json.id], nodeType: 'department', nodeId: departmentId } });
    assert.equal(attempt.status, 403);

    const users = await api(srv.baseUrl, boss, '/api/admin/users', { method: 'GET' });
    const c3 = users.json.users.find(u => u.id === u3.json.id);
    assert.equal(c3.assignmentType ?? null, null, 'user must be unchanged after a validate-all-before-write failure');
  });
});

describe('POST /api/admin/nodes/:type/:id/move — flag OFF: route does not exist', () => {
  let srv, root;
  before(async () => {
    srv = await startServer({ multiTenant: false });
    root = (await login(srv.baseUrl)).json.token;
  });
  after(async () => { await srv.stop(); });

  test('404 with flag off', async () => {
    const res = await api(srv.baseUrl, root, '/api/admin/nodes/ward/w1/move', { method: 'POST', body: { newParentId: 'x' } });
    assert.equal(res.status, 404);
  });
});

describe('DELETE /api/admin/nodes/:type/:id — flag OFF: route does not exist', () => {
  let srv, root;
  before(async () => {
    srv = await startServer({ multiTenant: false });
    root = (await login(srv.baseUrl)).json.token;
  });
  after(async () => { await srv.stop(); });

  test('404 with flag off', async () => {
    const res = await api(srv.baseUrl, root, '/api/admin/nodes/ward/w1', { method: 'DELETE' });
    assert.equal(res.status, 404);
  });
});

describe('PATCH /api/admin/nodes/:type/:id — flag OFF: route does not exist', () => {
  let srv, root;
  before(async () => {
    srv = await startServer({ multiTenant: false });
    root = (await login(srv.baseUrl)).json.token;
  });
  after(async () => { await srv.stop(); });

  test('404 with flag off', async () => {
    const res = await api(srv.baseUrl, root, '/api/admin/nodes/ward/w1', { method: 'PATCH', body: { name: 'X' } });
    assert.equal(res.status, 404);
  });
});
