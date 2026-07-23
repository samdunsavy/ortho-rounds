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
