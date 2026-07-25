import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './helpers/server-harness.js';

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

describe('POST /api/wards — member self-service ward creation (flag on)', () => {
  let srv, root, boss, orgId, departmentId, unitId, otherUnitId, memberToken;
  before(async () => {
    srv = await startServer({ multiTenant: true, seed: async () => {} });
    root = (await login(srv.baseUrl)).json.token;

    const org = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Ward Org' } });
    orgId = org.json.id;
    const admin = await api(srv.baseUrl, root, `/api/admin/orgs/${orgId}/admin`, { method: 'POST', body: { username: 'wardboss' } });
    boss = (await login(srv.baseUrl, 'wardboss', admin.json.temporaryPassword)).json.token;

    const h = await api(srv.baseUrl, boss, '/api/admin/hospitals', { method: 'POST', body: { name: 'City Hospital' } });
    const d = await api(srv.baseUrl, boss, '/api/admin/departments', { method: 'POST', body: { hospitalId: h.json.id, name: 'Ortho' } });
    departmentId = d.json.id;
    const u = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { departmentId, name: 'Unit IV' } });
    unitId = u.json.id;
    const u2 = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { departmentId, name: 'Unit V' } });
    otherUnitId = u2.json.id;

    const m = await api(srv.baseUrl, boss, '/api/admin/users', { method: 'POST', body: { username: 'pgmember' } });
    await api(srv.baseUrl, boss, `/api/admin/users/${m.json.id}/assign`, { method: 'POST', body: { nodeType: 'unit', nodeId: unitId } });
    memberToken = (await login(srv.baseUrl, 'pgmember', m.json.temporaryPassword)).json.token;
  });
  after(async () => { await srv.stop(); });

  test('member creates a ward under their own unit → 200 with id', async () => {
    const r = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId, name: '7MOW' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.unitId, unitId);
    assert.equal(r.json.name, '7MOW');
    assert.ok(r.json.id, 'returns a ward id');
  });

  test('duplicate name (case-insensitive) returns the existing ward, no second row', async () => {
    const first = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId, name: 'Bay 12' } });
    const again = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId, name: '  bay 12 ' } });
    assert.equal(again.status, 200);
    assert.equal(again.json.id, first.json.id, 'dedupes to the same ward id');
  });

  test('member cannot create under a unit outside their scope → 403', async () => {
    const r = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId: otherUnitId, name: 'Sneaky' } });
    assert.equal(r.status, 403);
  });

  test('nonexistent unit → 404', async () => {
    const r = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId: 'nope', name: 'X' } });
    assert.equal(r.status, 404);
  });

  test('empty name → 400; over 80 chars → 400', async () => {
    const empty = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId, name: '   ' } });
    assert.equal(empty.status, 400);
    const long = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId, name: 'x'.repeat(81) } });
    assert.equal(long.status, 400);
  });

  test('instance admin (unrestricted) can create under any unit → 200', async () => {
    const r = await api(srv.baseUrl, root, '/api/wards', { method: 'POST', body: { unitId: otherUnitId, name: 'Admin Ward' } });
    assert.equal(r.status, 200);
  });
});

describe('POST /api/wards — flag OFF', () => {
  let srv;
  before(async () => { srv = await startServer({ multiTenant: false }); });
  after(async () => { await srv.stop(); });

  test('route 404s when MULTI_TENANT is off', async () => {
    const token = (await login(srv.baseUrl)).json.token;
    const r = await api(srv.baseUrl, token, '/api/wards', { method: 'POST', body: { unitId: 'u', name: 'W' } });
    assert.equal(r.status, 404);
  });
});
