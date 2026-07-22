### Task 1: Storage additions — `listUsersByOrg`, `hasInstanceAdmin` (both backends)

**Files:**
- Modify: `storage.js` (SQLite backend near `getAllUsers`; Mongo backend near its `getAllUsers`)
- Test: `tests/storage.test.js`

**Interfaces:**
- Produces: `store.listUsersByOrg(orgId) -> Promise<userRow[]>` (all users with that exact `orgId`, any role/active state); `store.hasInstanceAdmin() -> Promise<boolean>` (true iff an ACTIVE user with `role='admin'` and `orgId` NULL exists). Both mirrored identically in SQLite and Mongo.

- [ ] **Step 1: Write the failing tests**

Append to the existing SQLite `describe` in `tests/storage.test.js` (it has `store` in scope; reuse its user-creation pattern):

```js
  test('listUsersByOrg returns only that org, hasInstanceAdmin detects active root admins', async () => {
    await store.createUser({ id: 'org-u1', username: 'orgu1', passwordHash: 'h', passwordSalt: 's',
      role: 'member', active: true, tokenVersion: 0, createdAt: Date.now(), orgId: 'orgA', wardId: 'w1' });
    await store.createUser({ id: 'org-u2', username: 'orgu2', passwordHash: 'h', passwordSalt: 's',
      role: 'admin', active: true, tokenVersion: 0, createdAt: Date.now(), orgId: 'orgB', wardId: null });
    const a = await store.listUsersByOrg('orgA');
    assert.deepEqual(a.map(u => u.id), ['org-u1']);
    assert.deepEqual((await store.listUsersByOrg('orgC')), []);

    // Users created earlier in this suite have no orgId; if any is an active admin,
    // hasInstanceAdmin must be true — create/disable our own to test both directions.
    await store.createUser({ id: 'root-x', username: 'rootx', passwordHash: 'h', passwordSalt: 's',
      role: 'admin', active: true, tokenVersion: 0, createdAt: Date.now() });
    assert.equal(await store.hasInstanceAdmin(), true);
    await store.updateUser('root-x', { active: false });
    // May still be true if earlier fixtures created an active instance admin;
    // assert the specific row no longer qualifies by checking via listUsersByOrg(null) shape instead:
    const rootx = (await store.getAllUsers()).find(u => u.id === 'root-x');
    assert.equal(!!rootx.active, false);
  });
```

Note to implementer: inspect the earlier fixtures in this describe — if none creates an active instance admin (admin + no orgId), strengthen the disabled-direction assertion to `assert.equal(await store.hasInstanceAdmin(), false)` after disabling `root-x` (and disabling any other qualifying fixture rows first). The test must genuinely exercise both true and false outcomes; adapt to the fixtures actually present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/storage.test.js`
Expected: FAIL — `store.listUsersByOrg is not a function`.

- [ ] **Step 3: Implement in `storage.js`**

SQLite backend (next to `getAllUsers`):

```js
    async listUsersByOrg(orgId){
      return db.prepare('SELECT * FROM users WHERE orgId = ? ORDER BY createdAt ASC').all(orgId);
    },
    async hasInstanceAdmin(){
      const row = db.prepare(
        "SELECT 1 AS ok FROM users WHERE role = 'admin' AND active = 1 AND orgId IS NULL LIMIT 1"
      ).get();
      return !!row;
    },
```

Mongo backend (next to its `getAllUsers`; users mapped via the backend's existing row-mapping conventions):

```js
    async listUsersByOrg(orgId){
      const arr = await users.find({ orgId }).sort({ createdAt: 1 }).toArray();
      return arr.map(mapUser);
    },
    async hasInstanceAdmin(){
      const row = await users.findOne({ role: 'admin', active: 1, $or: [{ orgId: null }, { orgId: { $exists: false } }] });
      return !!row;
    },
```

(If the Mongo backend's user helper is named differently than `mapUser`, follow whatever mapping its `getAllUsers` uses — mirror it exactly.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/storage.test.js` → PASS.

- [ ] **Step 5: Full suite, commit**

Run: `npm test` — all pass.

```bash
git add storage.js tests/storage.test.js
git commit -m "feat: storage listUsersByOrg + hasInstanceAdmin (both backends)"
```

---

