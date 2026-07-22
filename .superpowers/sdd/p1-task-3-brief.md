### Task 3: server.js — actor carries org/ward; login response additive fields

**Files:**
- Modify: `server.js` — actor construction (~line 260), login response (~line 248)
- Test: `tests/server-auth-scope.test.js`

**Interfaces:**
- Consumes: harness from Task 2 (`startServer`, `login`).
- Produces: `actor = { id, username, role, orgId, wardId }` (Task 4 relies on `orgId`/`wardId` being present); login response `{ token, username, role, orgId, wardId }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/server-auth-scope.test.js`:

```js
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
        await store.createWard({ id: 'w1', hospitalId: 'h1', name: 'Ortho' });
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

  test('bootstrap admin gets null orgId/wardId (instance admin)', async () => {
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
```

Note: `seedUser` requires `createUser` to persist `orgId`/`wardId`, and today it does NOT — both backends must be extended (additive; `USER_PATCH_FIELDS` already allows these via `updateUser`). Exact changes in Step 3.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/server-auth-scope.test.js`
Expected: FAIL — login response lacks `orgId`/`wardId`.

- [ ] **Step 3: Implement (wrap-only)**

In `server.js` login handler, change the response line (~248) to:

```js
    return sendJSON(res, 200, { token, username: user.username, role: user.role, orgId: user.orgId ?? null, wardId: user.wardId ?? null });
```

Change the actor line (~260) to:

```js
  const actor = { id: authedUser.id, username: authedUser.username, role: authedUser.role, orgId: authedUser.orgId ?? null, wardId: authedUser.wardId ?? null };
```

In `storage.js`, extend `createUser` in BOTH backends. SQLite (~line 201) becomes:

```js
    async createUser(user){
      db.prepare(`
        INSERT INTO users (id, username, passwordHash, passwordSalt, role, active, tokenVersion, createdAt, orgId, wardId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.id, user.username, user.passwordHash, user.passwordSalt,
        user.role || 'member', user.active === false ? 0 : 1,
        user.tokenVersion || 0, user.createdAt || Date.now(),
        user.orgId ?? null, user.wardId ?? null
      );
    },
```

Mongo (~line 437): add `orgId: user.orgId ?? null, wardId: user.wardId ?? null` to the `insertOne` document (after `createdAt`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/server-auth-scope.test.js` → PASS.
Run: `npm test -- tests/server-sync-golden.test.js` → PASS (golden guard).

- [ ] **Step 5: Run full suite, then commit**

Run: `npm test` — all pass.

```bash
git add server.js storage.js tests/server-auth-scope.test.js
git commit -m "feat: actor and login response carry orgId/wardId (additive)"
```

---

