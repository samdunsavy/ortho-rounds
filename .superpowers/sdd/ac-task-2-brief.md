### Task 2: bootstrapAdmin self-heal (flag-on only)

**Files:**
- Modify: `auth.js` (`bootstrapAdmin`, ~line 76)
- Test: `tests/server-provisioning.test.js` (new, integration)

**Interfaces:**
- Consumes: `store.hasInstanceAdmin()` (Task 1); `isEnabled` from `flags.js`.
- Produces: flag-on boot self-heals a root admin when none exists; flag-off condition untouched.

- [ ] **Step 1: Write the failing test**

Create `tests/server-provisioning.test.js`:

```js
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
```

Harness change required (part of this task): in `tests/helpers/server-harness.js`, add a `seedRaw` option to `startServer` — identical to `seed` but WITHOUT the auto-instance-admin block. Implementation: extract the current seeding body into `if(seed || seedRaw){ ... run (seed || seedRaw)(store) ...; if(seed){ /* existing auto-admin block */ } }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server-provisioning.test.js`
Expected: first test FAILS (401 — no root admin created because users exist); second test passes already.

- [ ] **Step 3: Implement in `auth.js`**

Add to imports: `import { isEnabled } from './flags.js';`

In `bootstrapAdmin`, replace the single no-op check:

```js
  if(isEnabled('MULTI_TENANT')){
    if(await store.hasInstanceAdmin()) return { created: false };
  }else{
    if((await store.countUsers()) > 0) return { created: false };
  }
```

(The flag-off branch is the existing line verbatim — untouched semantics.)

Check `tests/auth.test.js`'s fakeStore: if `bootstrapAdmin` tests run flag-off they only need `countUsers` (already present). Do not add `hasInstanceAdmin` to the fake unless a test sets the flag env — don't add flag-on unit tests here; the integration test covers it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/server-provisioning.test.js tests/auth.test.js tests/server-sync-golden.test.js` → PASS.

- [ ] **Step 5: Full suite, commit**

```bash
git add auth.js tests/helpers/server-harness.js tests/server-provisioning.test.js
git commit -m "feat: bootstrapAdmin self-heals root admin when MULTI_TENANT on"
```

---

