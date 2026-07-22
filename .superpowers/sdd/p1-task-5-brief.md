### Task 5: Instance-admin gate on backup/import/export + roadmap tick

**Files:**
- Modify: `server.js` — `/api/backup` (~429), `/api/export` (~474), `/api/import` (~609)
- Modify: `ROADMAP.md` (tick the auth+sync checkbox), `DESIGN-multitenant.md` (rollout status line)
- Test: `tests/server-scoping.test.js` (extend)

**Interfaces:**
- Consumes: harness/seed pattern from Task 4; actor from Task 3.
- Produces: flag-on 403 for non-instance-admins on the three whole-instance endpoints.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server-scoping.test.js` inside the existing `describe` (reusing `srv`/`tokens`):

```js
  test('backup/export/import are instance-admin-only when flag on', async () => {
    for(const [path, method] of [['/api/backup', 'GET'], ['/api/export', 'GET'], ['/api/import', 'POST']]){
      for(const who of ['pg1', 'boss1']){
        const res = await fetch(`${srv.baseUrl}${path}`, {
          method, headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' },
          body: method === 'POST' ? JSON.stringify({ patients: [] }) : undefined
        });
        assert.equal(res.status, 403, `${who} ${path} must be 403`);
      }
      const rootRes = await fetch(`${srv.baseUrl}${path}`, {
        method, headers: { Authorization: `Bearer ${tokens.root}`, 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ patients: [] }) : undefined
      });
      assert.notEqual(rootRes.status, 403, `instance admin ${path} must not be 403`);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server-scoping.test.js`
Expected: the new test FAILS (currently 200 for everyone authenticated, or admin-only without org distinction).

- [ ] **Step 3: Implement**

At the top of each of the three route handlers in `server.js` (first line inside the `if` block), add:

```js
    if(isEnabled('MULTI_TENANT') && !(actor.role === 'admin' && !actor.orgId)){
      return sendJSON(res, 403, { error: 'Instance admin only' });
    }
```

- [ ] **Step 4: Run tests, update docs**

Run: `npm test -- tests/server-scoping.test.js tests/server-sync-golden.test.js` → PASS.

In `ROADMAP.md` line 59, change `- [ ] Auth + sync scoping by ward/org...` to `- [x]` and append ` — shipped 2026-07-22: see docs/superpowers/specs/2026-07-22-auth-sync-scoping-design.md`.
In `DESIGN-multitenant.md` rollout plan, mark the "auth + sync scoping" bullet done (`✅ done — 2026-07-22`), leaving migration tool + admin console as remaining.

- [ ] **Step 5: Run full suite, then commit**

Run: `npm test` — all pass (flag-off suite untouched; integration files cover both flag states).

```bash
git add server.js tests/server-scoping.test.js ROADMAP.md DESIGN-multitenant.md
git commit -m "feat: instance-admin gate on backup/import/export; tick Phase 1 auth/sync scoping"
```
