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

  let boss, member, orgId, hospitalId, wardId, ward2Id, memberId;

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
    const w1 = await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { hospitalId, name: 'Ortho' } });
    assert.equal(w1.status, 200);
    wardId = w1.json.id;
    assert.equal(w1.json.specialty, 'ortho');
    const w2 = await api(srv.baseUrl, boss, '/api/admin/wards', { method: 'POST', body: { hospitalId, name: 'Surgery', specialty: 'surgery' } });
    ward2Id = w2.json.id;
  });

  test('org admin creates a member into a department; member syncs scoped', async () => {
    const u = await api(srv.baseUrl, boss, '/api/admin/users', { method: 'POST', body: { username: 'pg9', wardId } });
    assert.equal(u.status, 200);
    memberId = u.json.id;
    member = (await login(srv.baseUrl, 'pg9', u.json.temporaryPassword)).json.token;
    const push = await syncPost(srv.baseUrl, member, { since: 0, changes: [{ id: 'cp1', name: 'Console Patient', status: 'postop', updatedAt: Date.now() }] });
    assert.equal(push.status, 200);
    const pull = await syncPost(srv.baseUrl, member, { since: 0, changes: [] });
    assert.deepEqual(pull.json.patients.map(p => p.id), ['cp1']);
  });

  test('org tree stats reflect the created world', async () => {
    const t = await api(srv.baseUrl, boss, '/api/admin/org');
    assert.equal(t.status, 200);
    assert.equal(t.json.totals.hospitals, 1);
    assert.equal(t.json.totals.departments, 2);
    assert.equal(t.json.totals.livePatients, 1);
    const w = t.json.hospitals[0].wards.find(x => x.id === wardId);
    assert.equal(w.stats.livePatients, 1);
    assert.equal(w.stats.byStatus.postop, 1);
    assert.equal(w.stats.users, 1);
    assert.equal(typeof w.stats.lastActivity, 'number');
  });

  test('org-scoped user list; assign takes effect on next request', async () => {
    const list = await api(srv.baseUrl, boss, '/api/admin/users');
    assert.equal(list.status, 200);
    const names = list.json.users.map(u => u.username).sort();
    assert.deepEqual(names, ['boss', 'pg9']); // no instance admin, no other orgs
    assert.equal(list.json.users.find(u => u.username === 'pg9').wardId, wardId);

    const mv = await api(srv.baseUrl, boss, `/api/admin/users/${memberId}/assign`, { method: 'POST', body: { wardId: ward2Id } });
    assert.equal(mv.status, 200);
    const pull = await syncPost(srv.baseUrl, member, { since: 0, changes: [] });
    assert.deepEqual(pull.json.patients, []); // now scoped to empty Surgery dept — no re-login needed
  });

  test('cross-org isolation on every console surface', async () => {
    const org2 = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Other Org' } });
    const a2 = await api(srv.baseUrl, root, `/api/admin/orgs/${org2.json.id}/admin`, { method: 'POST', body: { username: 'boss2' } });
    const boss2 = (await login(srv.baseUrl, 'boss2', a2.json.temporaryPassword)).json.token;

    assert.equal((await api(srv.baseUrl, boss2, '/api/admin/wards', { method: 'POST', body: { hospitalId, name: 'Sneaky' } })).status, 403);
    assert.equal((await api(srv.baseUrl, boss2, `/api/admin/users/${memberId}/assign`, { method: 'POST', body: { wardId: null } })).status, 403);
    assert.equal((await api(srv.baseUrl, boss2, `/api/admin/users/${memberId}/disable`, { method: 'POST' })).status, 403);
    const list2 = await api(srv.baseUrl, boss2, '/api/admin/users');
    assert.deepEqual(list2.json.users.map(u => u.username), ['boss2']);
    const t2 = await api(srv.baseUrl, boss2, '/api/admin/org');
    assert.equal(t2.json.totals.hospitals, 0);
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
    assert.equal(rollups.json.orgs.find(o => o.id === orgId).stats.livePatients, 1);
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
      ['/api/admin/wards', 'POST', { hospitalId: 'h', name: 'X' }],
      ['/api/admin/users/u1/assign', 'POST', { wardId: null }]
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
