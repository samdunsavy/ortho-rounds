import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../auth.js';
import { startServer, login } from './helpers/server-harness.js';

function seedUser(store, { id, username, orgId = null, wardId = null, role = 'member' }){
  const salt = 'testsalt';
  return store.createUser({
    id, username, passwordSalt: salt, passwordHash: hashPassword('pw-' + username, salt),
    role, active: true, tokenVersion: 0, createdAt: Date.now(), orgId, wardId
  });
}

describe('login response scope fields', () => {
  let srv;
  before(async () => {
    srv = await startServer({
      multiTenant: true,
      seed: async (store) => {
        await store.createOrganization({ id: 'org1', name: 'Org', plan: 'free' });
        await store.createHospital({ id: 'h1', orgId: 'org1', name: 'H1' });
        await store.createDepartment({ id: 'w1', hospitalId: 'h1', name: 'Ortho' });
        await seedUser(store, { id: 'u1', username: 'pg1', orgId: 'org1', wardId: 'w1' });
      }
    });
  });
  after(async () => { await srv.stop(); });

  test('scoped user gets orgId/wardId in login response', async () => {
    const l = await login(srv.baseUrl, 'pg1', 'pw-pg1');
    assert.equal(l.status, 200);
    assert.equal(l.json.orgId, 'org1');
    assert.equal(l.json.wardId, 'w1');
    assert.equal(l.json.role, 'member');
  });

  test('instance admin gets null orgId/wardId', async () => {
    const l = await login(srv.baseUrl);
    assert.equal(l.status, 200);
    assert.equal(l.json.orgId, null);
    assert.equal(l.json.wardId, null);
  });
});

describe('login response scope fields — flag OFF (additive, null)', () => {
  let srv;
  before(async () => { srv = await startServer({ multiTenant: false }); });
  after(async () => { await srv.stop(); });

  test('admin login carries null orgId/wardId and unchanged existing keys', async () => {
    const l = await login(srv.baseUrl);
    assert.equal(l.status, 200);
    assert.deepEqual(Object.keys(l.json).sort(), ['orgId', 'role', 'token', 'username', 'wardId']);
    assert.equal(l.json.orgId, null);
    assert.equal(l.json.wardId, null);
  });
});
