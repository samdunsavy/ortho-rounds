import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../auth.js';
import { startServer, login, ADMIN_USERNAME, ADMIN_PASSWORD } from './helpers/server-harness.js';

/* The harness auto-seeds an instance admin whenever `seed` is provided —
   which would defeat this test. Seed ONLY org-scoped users, then delete the
   harness-seeded root admin... impossible; instead: this test needs a seed
   WITHOUT the harness's auto-admin. See Step 1 note below — the harness
   gains a `seedRaw` option that skips the auto-admin. */

describe('bootstrapAdmin self-heal (MULTI_TENANT on)', () => {
  test('boot with only org-scoped users creates the env root admin', async () => {
    const srv = await startServer({
      multiTenant: true,
      seedRaw: async (store) => {
        await store.createOrganization({ id: 'o1', name: 'O', plan: 'free' });
        await store.createUser({ id: 'ou1', username: 'orgadmin1', passwordSalt: 's',
          passwordHash: hashPassword('pw', 's'), role: 'admin', active: true,
          tokenVersion: 0, createdAt: Date.now(), orgId: 'o1', wardId: null });
      }
    });
    try{
      const l = await login(srv.baseUrl, ADMIN_USERNAME, ADMIN_PASSWORD);
      assert.equal(l.status, 200, 'root admin must have been self-healed from env credentials');
      assert.equal(l.json.orgId, null);
    }finally{ await srv.stop(); }
  });

  test('self-heal reactivates a disabled same-username admin instead of crashing', async () => {
    const srv = await startServer({
      multiTenant: true,
      seedRaw: async (store) => {
        await store.createUser({ id: 'old-root', username: ADMIN_USERNAME, passwordSalt: 's',
          passwordHash: hashPassword('old-forgotten-pw', 's'), role: 'admin', active: false,
          tokenVersion: 3, createdAt: Date.now(), orgId: null, wardId: null });
        await store.createUser({ id: 'ou2', username: 'orgadmin2', passwordSalt: 's',
          passwordHash: hashPassword('pw', 's'), role: 'admin', active: true,
          tokenVersion: 0, createdAt: Date.now(), orgId: 'oX', wardId: null });
      }
    });
    try{
      const l = await login(srv.baseUrl, ADMIN_USERNAME, ADMIN_PASSWORD);
      assert.equal(l.status, 200, 'reactivated env admin must log in with env password');
      assert.equal(l.json.orgId, null);
    }finally{ await srv.stop(); }
  });

  test('flag OFF: boot with existing users creates no admin (unchanged behavior)', async () => {
    const srv = await startServer({
      multiTenant: false,
      seedRaw: async (store) => {
        await store.createUser({ id: 'u9', username: 'someone', passwordSalt: 's',
          passwordHash: hashPassword('pw', 's'), role: 'member', active: true,
          tokenVersion: 0, createdAt: Date.now() });
      }
    });
    try{
      const l = await login(srv.baseUrl, ADMIN_USERNAME, ADMIN_PASSWORD);
      assert.equal(l.status, 401, 'flag off: bootstrapAdmin must still no-op when any user exists');
    }finally{ await srv.stop(); }
  });
});
