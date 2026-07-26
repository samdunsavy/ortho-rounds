# Admin Console Correctness & Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the admin console's security, correctness and org-context defects against the console's current layout, so the fixes ship before the visual makeover (Plan 2).

**Architecture:** Six independent tasks against the existing files. Two harden `/api/admin/*` routes, one adds the user-role route, one corrects the pure stats builder in `admin.js`, one threads the 409 `blockedBy` payload through the client's `api()` helper, and one repairs the instance-admin org-context lifecycle (moving those handlers out of `app.js` into `admin-console.js` so they are reachable in tests). **No layout, CSS, or section restructuring** — that is Plan 2.

**Tech Stack:** Vanilla JS (no framework, no build step), Node ≥ 22.5 HTTP server, `node:test` runner, jsdom for frontend tests, SQLite via `node:sqlite` (or MongoDB when `MONGODB_URI` is set).

**Source spec:** `docs/superpowers/specs/2026-07-26-admin-console-overhaul-design.md` (defect numbers below refer to its table in §Problem/2).

## Global Constraints

- **Node ≥ 22.5** — uses the built-in `node:sqlite` module.
- **No new dependencies.** Nothing may be added to `package.json`.
- **Flag off → unchanged.** With `MULTI_TENANT` off the console stays unreachable and every existing behaviour is byte-identical. `tests/server-sync-golden.test.js` must stay green.
- **Server stays authoritative on ancestry.** The UI never computes or caches ancestry; after any structural mutation it re-fetches.
- **`public/admin-console.js` is a plain script, not a module.** Function declarations must stay at top level so they become globals that `app.js` and the jsdom tests can call. `let`/`const` at the top level of that file are **not** reachable as `window.*` from tests (see `tests/helpers/frontend-env.js` header) — tests must observe module state through exported functions or the DOM.
- **Full suite baseline is green: 425 passing.** Run `npm test` before starting and after each task.
- **Names are capped at 80 characters**, usernames at 32 (`cleanName(raw, max = 80)` in `server.js:227`).
- Commit after every task using the repo's prefixes: `fix:`, `feat:`, `test:`, `refactor:`.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `server.js` | HTTP routes. Modify `POST /api/admin/users`; add `POST /api/admin/users/:id/role`. | 1, 3 |
| `admin.js` | Pure tree/stats builders. Correct user and patient counting; add hospital/org rollups. | 4 |
| `public/app.js` | Shared runtime. `api()` gains the error payload; the `#adminView` org-context handler block is removed (moves to `admin-console.js`). | 5, 6 |
| `public/admin-console.js` | The console UI. Sends `orgId` from context; renders hospital/org counts; formats `blockedBy`; owns the org-context lifecycle. | 2, 4, 5, 6 |
| `tests/server-admin-console.test.js` | Server tests for user creation and the role route. | 1, 3 |
| `tests/admin.test.js` | Unit tests for `buildOrgTree`. | 4 |
| `tests/frontend-admin-console.test.js` | jsdom tests for the console. | 2, 5, 6 |

---

### Task 1: Require `orgId` when an instance admin creates a user

Closes the privilege-escalation path: today `POST /api/admin/users` as an instance admin stores a user with **no** `orgId`, and `resolveScope` (`scope.js:9`) grants any admin without an `orgId` `unrestricted: true` — access to every organization's patients.

**Files:**
- Modify: `server.js:716-731`
- Test: `tests/server-admin-console.test.js`

**Interfaces:**
- Consumes: `isInstanceAdmin(actor)` (`server.js:223`), `departmentInOrg(wardId, orgId)` (`server.js:240`), `store.getOrganization(id)`.
- Produces: `POST /api/admin/users` returns `400 { error: 'orgId required' }` when `MULTI_TENANT` is on and an instance admin omits `orgId`. Org-admin behaviour and flag-off behaviour are unchanged.

**Note for the implementer:** no existing test creates a user as an instance admin without an `orgId` — every current call uses an org-admin token or passes `orgId` explicitly (verified across `tests/server-structure.test.js`, `tests/server-wards.test.js`, `tests/server-admin-console.test.js`). You should not need to modify any existing test.

- [ ] **Step 1: Write the failing test**

Add to `tests/server-admin-console.test.js`, inside the existing `describe('admin console — end-to-end provisioning flow (flag on)', ...)` block, immediately after the test named `'validation: bad names, foreign wardId, instance-admin org targeting'` (it ends at line 183; insert before the `});` on line 184). That describe already has `root` and `orgId` in scope from its earlier tests.

```js
  test('instance admin must name an org when creating a user (no org-less users)', async () => {
    const orphan = await api(srv.baseUrl, root, '/api/admin/users', { method: 'POST', body: { username: 'orphan1' } });
    assert.equal(orphan.status, 400);
    assert.equal(orphan.json.error, 'orgId required');

    // And the rejected user really was not created.
    const after = await api(srv.baseUrl, root, '/api/admin/users', { method: 'GET' });
    assert.equal(after.json.users.some(u => u.username === 'orphan1'), false);

    const placed = await api(srv.baseUrl, root, '/api/admin/users', { method: 'POST', body: { username: 'placed1', orgId } });
    assert.equal(placed.status, 200);
    const listed = (await api(srv.baseUrl, root, '/api/admin/users', { method: 'GET' })).json.users;
    assert.equal(listed.find(u => u.username === 'placed1').orgId, orgId);
  });

  test('instance admin naming an unknown org gets 404', async () => {
    const bad = await api(srv.baseUrl, root, '/api/admin/users', { method: 'POST', body: { username: 'nowhere1', orgId: 'no-such-org' } });
    assert.equal(bad.status, 404);
  });
```

Then prove flag-off is untouched. Do **not** boot another server for this — the file already has `describe('admin console — flag OFF: new routes do not exist', ...)` at line 186 with a `root` token in scope. Append this test to that describe, after its existing `'all new routes 404; existing user list shape unchanged'` test (appending matters: that test asserts the key shape of `users[0]`, so it must run before any user is added):

```js
  test('no orgId is required when MULTI_TENANT is off', async () => {
    const u = await api(srv.baseUrl, root, '/api/admin/users', { method: 'POST', body: { username: 'plainflagoff' } });
    assert.equal(u.status, 200);
    assert.ok(u.json.temporaryPassword);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="instance admin must name an org"`

Expected: FAIL — the assertion `assert.equal(orphan.status, 400)` reports `200 !== 400`, because the route currently accepts the request and stores the user with `orgId` undefined.

- [ ] **Step 3: Write the implementation**

In `server.js`, replace the `if(isEnabled('MULTI_TENANT')){ ... }` block at lines 716-731 with:

```js
    if(isEnabled('MULTI_TENANT')){
      if(!isInstanceAdmin(actor)){
        newUser.orgId = actor.orgId;
        if(body.wardId){
          if(!(await departmentInOrg(String(body.wardId), actor.orgId))) return sendJSON(res, 403, { error: 'Department is not in this organization' });
          newUser.wardId = String(body.wardId);
        }
      }else{
        // An instance admin has no org of their own to infer from. Without an
        // explicit target the user was stored with orgId undefined, and
        // resolveScope() grants any admin lacking an orgId unrestricted access
        // to every org's patients — so this must be a hard requirement, not a
        // client-side convention.
        if(!body.orgId) return sendJSON(res, 400, { error: 'orgId required' });
        if(!(await store.getOrganization(body.orgId))) return sendJSON(res, 404, { error: 'Organization not found' });
        newUser.orgId = body.orgId;
        if(body.wardId){
          if(!(await departmentInOrg(String(body.wardId), body.orgId))) return sendJSON(res, 403, { error: 'Department is not in this organization' });
          newUser.wardId = String(body.wardId);
        }
      }
    }
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`

Expected: PASS — 425 baseline plus 3 new tests, 0 failures. If any pre-existing test fails, it is creating a user as an instance admin without an org; add `orgId` to that call rather than weakening the guard.

- [ ] **Step 5: Commit**

```bash
git add server.js tests/server-admin-console.test.js
git commit -m "fix: require orgId when an instance admin creates a user

An instance admin creating a user sent no orgId, so the user was stored
with none. resolveScope() treats an admin without an orgId as
unrestricted, so creating an admin this way minted a second instance
admin with access to every organization's patients."
```

---

### Task 2: Send `orgId` from context on create-person and add-hospital

The client half of Task 1, plus defect 10: instance-admin "Add hospital" posts `{ name }` only and always fails with 400, because `requestedOrgId` (`server.js:234`) requires an explicit `orgId` from an instance admin.

The add-hospital fix is a one-word change. The tree row for the org is `data-node="org:<orgId>"`, so the "parent id" the add-child handler already extracts **is** the org id — it just needs to be sent under the key `orgId` instead of being dropped. Sending `orgId` is harmless for org admins: `requestedOrgId` ignores the explicit value for a non-instance admin and uses `actor.orgId`.

**Files:**
- Modify: `public/admin-console.js:81-91` (`addChildRouteFor`), `public/admin-console.js:389-399` (create-user click handler)
- Test: `tests/frontend-admin-console.test.js:298-312` (rewrite the existing assertion), plus one new test

**Interfaces:**
- Consumes: `adminState.tree.org.id`, module-scoped `adminViewOrgId` (both already in `admin-console.js`).
- Produces: `POST /api/admin/hospitals` body `{ orgId, name }`; `POST /api/admin/users` body `{ username, role, orgId }` when an org is in context, `{ username, role }` when it is not.

- [ ] **Step 1: Update the existing test that locks in the bug**

In `tests/frontend-admin-console.test.js`, the test at lines 298-312 currently asserts the broken body. Replace the whole test with:

```js
  test('org add-child (add hospital) posts {orgId, name} so an instance admin can target the org', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = mockAdminApi(calls);
    const orgTree = Object.assign({}, TREE, { org: { id: 'bfv2-org', name: 'Default' } });
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: orgTree, users: [], orgs: [], selection: { type: 'org', id: 'bfv2-org' } });
    document.querySelector('[data-new-child-name="org:bfv2-org"]').value = 'New Hospital';
    document.querySelector('[data-add-child="org:bfv2-org"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/hospitals');
    assert.ok(call, 'expected a POST to /api/admin/hospitals');
    assert.equal(call.opts.method, 'POST');
    assert.deepEqual(JSON.parse(call.opts.body), { orgId: 'bfv2-org', name: 'New Hospital' });
  });
```

- [ ] **Step 2: Write the new failing test for create-person**

Add this test to `tests/frontend-admin-console.test.js` inside the existing `describe('user lifecycle', ...)` block:

```js
  test('create user carries the org in context so the new user is not org-less', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return Object.assign({}, TREE, { org: { id: 'bfv2-org', name: 'Default' } });
      if(path === '/api/admin/users' && (!opts || opts.method !== 'POST')) return { users: [] };
      return { temporaryPassword: 'bone-plate-1234' };
    };
    window.alert = () => {};
    await window.loadAdminView();
    document.getElementById('adminNewUsername').value = 'newpg';
    document.getElementById('adminCreateUser').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/users' && c.opts && c.opts.method === 'POST');
    assert.ok(call, 'expected a POST to /api/admin/users');
    assert.deepEqual(JSON.parse(call.opts.body), { username: 'newpg', role: 'member', orgId: 'bfv2-org' });
  });
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npm test -- --test-name-pattern="org add-child|create user carries the org"`

Expected: FAIL on both — the first reports the body as `{ name: 'New Hospital' }` (missing `orgId`), the second as `{ username: 'newpg', role: 'member' }` (missing `orgId`).

- [ ] **Step 4: Fix `addChildRouteFor`**

In `public/admin-console.js`, replace the whole `addChildRouteFor` function (lines 81-91) with:

```js
function addChildRouteFor(type){
  return {
    // The org tree row is data-node="org:<orgId>", so the parent id the
    // add-child handler extracts is already the org id. An instance admin
    // MUST send it (requestedOrgId returns null without it → 400); for an
    // org admin the server ignores it and uses actor.orgId.
    org: { path: '/api/admin/hospitals', parentKey: 'orgId' },
    hospital: { path: '/api/admin/departments', parentKey: 'hospitalId' },
    department: { path: '/api/admin/units', parentKey: 'departmentId' },
    unit: { path: '/api/admin/wards', parentKey: 'unitId' }
  }[type] || null;
}
```

- [ ] **Step 5: Fix the create-user handler**

In `public/admin-console.js`, replace the `if(e.target.id === 'adminCreateUser'){ ... }` block (lines 389-399) with:

```js
  if(e.target.id === 'adminCreateUser'){
    e.stopPropagation();
    const nameEl = document.getElementById('adminNewUsername');
    const username = (nameEl.value || '').trim();
    if(!username){ showToast('Enter a username'); return; }
    const role = document.getElementById('adminNewUserAdmin').checked ? 'admin' : 'member';
    const body = { username, role };
    // An instance admin has no org of their own; without this the server
    // stores the new user with no orgId at all, which resolveScope() reads
    // as unrestricted access to every organization.
    const orgId = adminCurrentOrgId();
    if(orgId) body.orgId = orgId;
    api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) })
      .then(res => { window.alert(`User created. Temporary password (shown once): ${res.temporaryPassword}`); nameEl.value = ''; return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
```

- [ ] **Step 6: Add the `adminCurrentOrgId` helper**

In `public/admin-console.js`, add this function immediately after `adminIsNarrow()` (which ends at line 191):

```js
/** The org the console is currently looking at: the one an instance admin
    drilled into, else the org the loaded tree belongs to. Null before the
    first successful load. */
function adminCurrentOrgId(){
  if(adminViewOrgId) return adminViewOrgId;
  return (adminState.tree && adminState.tree.org && adminState.tree.org.id) || null;
}
```

`adminViewOrgId` is declared with `let` at line 494, below this point. That is fine: `let` is hoisted to the top of the script's scope and this function only reads it at call time, long after the declaration has been evaluated.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="org add-child|create user carries the org"`

Expected: PASS, 2 tests.

- [ ] **Step 8: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 9: Commit**

```bash
git add public/admin-console.js tests/frontend-admin-console.test.js
git commit -m "fix: send orgId from context on add-hospital and create-user

Add-hospital posted {name} only, so an instance admin's request always
failed requestedOrgId's explicit-target check with a 400. Create-user
had the same omission, which produced org-less (unrestricted) users."
```

---

### Task 3: Add `POST /api/admin/users/:id/role`

There is no route to change a user's role today — only create-with-role. Guards mirror the existing user routes.

**Files:**
- Modify: `server.js` — insert after the `resetMatch` block (which begins at line 763)
- Test: `tests/server-admin-console.test.js`

**Interfaces:**
- Consumes: `isInstanceAdmin(actor)` (`server.js:223`), `store.getUserById(id)`, `store.getAllUsers()`, `store.updateUser(id, patch)`, `readBody(req)`, `sendJSON(res, status, body)`.
- Produces: `POST /api/admin/users/:id/role` with body `{ role: 'admin' | 'member' }` → `200 { ok: true, role }`. Errors: `403 'Admin only'`, `403 'Not your organization'`, `404 'User not found'`, `400 'You cannot change your own role'`, `400 'Role must be admin or member'`, `400 'This is the last active admin of the organization'` (or `...of the instance`). On success `tokenVersion` is incremented, which signs the target out.

- [ ] **Step 1: Write the failing tests**

Add this new top-level `describe` at the end of `tests/server-admin-console.test.js`:

```js
describe('user role changes (flag on)', () => {
  let srv, root, orgId, bossToken, bossId, memberId, memberToken;

  before(async () => {
    srv = await startServer({ multiTenant: true, seed: async () => {} });
    root = (await login(srv.baseUrl)).json.token;
    const org = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Role Org' } });
    orgId = org.json.id;
    const boss = await api(srv.baseUrl, root, `/api/admin/orgs/${orgId}/admin`, { method: 'POST', body: { username: 'roleboss' } });
    bossId = boss.json.id;
    bossToken = (await login(srv.baseUrl, 'roleboss', boss.json.temporaryPassword)).json.token;
    const m = await api(srv.baseUrl, bossToken, '/api/admin/users', { method: 'POST', body: { username: 'rolemember' } });
    memberId = m.json.id;
    memberToken = (await login(srv.baseUrl, 'rolemember', m.json.temporaryPassword)).json.token;
  });
  after(async () => { await srv.stop(); });

  test('an invalid role value is rejected', async () => {
    const bad = await api(srv.baseUrl, bossToken, `/api/admin/users/${memberId}/role`, { method: 'POST', body: { role: 'superuser' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'Role must be admin or member');
  });

  test('you cannot change your own role', async () => {
    const self = await api(srv.baseUrl, bossToken, `/api/admin/users/${bossId}/role`, { method: 'POST', body: { role: 'member' } });
    assert.equal(self.status, 400);
    assert.equal(self.json.error, 'You cannot change your own role');
  });

  test('demoting the last active admin of an org is refused', async () => {
    // rolemember is still a member, so roleboss is the org's only admin.
    const only = await api(srv.baseUrl, root, `/api/admin/users/${bossId}/role`, { method: 'POST', body: { role: 'member' } });
    assert.equal(only.status, 400);
    assert.equal(only.json.error, 'This is the last active admin of the organization');
  });

  test('promoting a member works and signs them out', async () => {
    const before = await syncPost(srv.baseUrl, memberToken, { since: 0, changes: [] });
    assert.equal(before.status, 200);

    const up = await api(srv.baseUrl, bossToken, `/api/admin/users/${memberId}/role`, { method: 'POST', body: { role: 'admin' } });
    assert.equal(up.status, 200);
    assert.deepEqual(up.json, { ok: true, role: 'admin' });

    const listed = (await api(srv.baseUrl, bossToken, '/api/admin/users', { method: 'GET' })).json.users;
    assert.equal(listed.find(u => u.id === memberId).role, 'admin');

    // tokenVersion was bumped, so the token issued before the change is dead.
    const after = await syncPost(srv.baseUrl, memberToken, { since: 0, changes: [] });
    assert.equal(after.status, 401);
  });

  test('demoting works once another admin exists', async () => {
    // rolemember is an admin now, so roleboss is no longer the only one.
    const down = await api(srv.baseUrl, bossToken, `/api/admin/users/${memberId}/role`, { method: 'POST', body: { role: 'member' } });
    assert.equal(down.status, 200);
    const listed = (await api(srv.baseUrl, bossToken, '/api/admin/users', { method: 'GET' })).json.users;
    assert.equal(listed.find(u => u.id === memberId).role, 'member');
  });

  test('an org admin cannot change a role in another org', async () => {
    const org2 = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Other Role Org' } });
    const boss2 = await api(srv.baseUrl, root, `/api/admin/orgs/${org2.json.id}/admin`, { method: 'POST', body: { username: 'roleboss2' } });
    const cross = await api(srv.baseUrl, bossToken, `/api/admin/users/${boss2.json.id}/role`, { method: 'POST', body: { role: 'member' } });
    assert.equal(cross.status, 403);
    assert.equal(cross.json.error, 'Not your organization');
  });

  test('an unknown user is a 404', async () => {
    const missing = await api(srv.baseUrl, bossToken, '/api/admin/users/no-such-user/role', { method: 'POST', body: { role: 'admin' } });
    assert.equal(missing.status, 404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="user role changes"`

Expected: FAIL — every test reports `404` (the path falls through to the catch-all), so e.g. `assert.equal(bad.status, 400)` reports `404 !== 400`.

- [ ] **Step 3: Write the route**

In `server.js`, find the `resetMatch` block that begins at line 763 with `const resetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);` and insert this **immediately after that block's closing brace**:

```js
  const roleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
  if(roleMatch && req.method === 'POST'){
    if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const target = await store.getUserById(roleMatch[1]);
    if(!target) return sendJSON(res, 404, { error: 'User not found' });
    if(isEnabled('MULTI_TENANT') && !isInstanceAdmin(actor) && target.orgId !== actor.orgId){
      return sendJSON(res, 403, { error: 'Not your organization' });
    }
    if(target.id === actor.id){
      return sendJSON(res, 400, { error: 'You cannot change your own role' });
    }
    const body = await readBody(req) || {};
    const role = body.role === 'admin' || body.role === 'member' ? body.role : null;
    if(!role) return sendJSON(res, 400, { error: 'Role must be admin or member' });
    if(role === 'member' && target.role === 'admin'){
      // Demoting the only remaining admin would leave the org (or, for an
      // org-less instance admin, the whole instance) with nobody able to
      // administer it. Peers are compared within the same org bucket, with
      // null orgId — the instance-admin bucket — treated as its own scope.
      const peers = (await store.getAllUsers()).filter(u =>
        u.id !== target.id && u.role === 'admin' && u.active && (u.orgId || null) === (target.orgId || null));
      if(!peers.length){
        const scopeLabel = target.orgId ? 'organization' : 'instance';
        return sendJSON(res, 400, { error: `This is the last active admin of the ${scopeLabel}` });
      }
    }
    // The token carries only sub/username/tokenVersion and the actor is
    // re-read per request, so the server side takes effect immediately — but
    // the client caches its role in localStorage at login. Bumping the
    // version signs the target out so their UI cannot disagree.
    await store.updateUser(target.id, { role, tokenVersion: (target.tokenVersion || 0) + 1 });
    return sendJSON(res, 200, { ok: true, role });
  }
```

This sits outside the `isEnabled('MULTI_TENANT')` block, alongside `/disable`, `/enable` and `/reset-password`, so it also works flag-off.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="user role changes"`

Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add server.js tests/server-admin-console.test.js
git commit -m "feat: add POST /api/admin/users/:id/role

Roles could only be set at creation. Guards mirror the other user
routes: same-org only, never your own account, and never the last
active admin of an org. Bumps tokenVersion so the target's cached
client-side role cannot disagree with the server."
```

---

### Task 4: Correct the counts in `admin.js` and surface them for hospital and org

Four separate counting problems (defects 8, 14, 15).

**Files:**
- Modify: `admin.js:31-115` (`buildOrgTree`)
- Modify: `public/admin-console.js:43-47` (org and hospital tree rows), `public/admin-console.js:126-131` (org detail node)
- Test: `tests/admin.test.js`, `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `store.listHospitalsByOrg`, `store.listDepartmentsByHospital`, `store.listUnitsByDepartment`, `store.listWardsByUnit`, `store.listUsersByOrg`, `store.getActive()`, and the file-local `emptyStats()` / `addPatientToStats(stats, p)`.
- Produces: `buildOrgTree(store, orgId)` now returns `org: { id, name, stats }` (previously `{ id, name }`) and each entry of `hospitals` gains `stats`. A `stats` object is always `{ livePatients, byStatus: { postop, preop, conservative, fordischarge }, users, lastActivity }`. `tree.totals` is unchanged.

**Warning:** adding `stats` to `tree.org` changes a shape that `tests/admin.test.js:49` and `:95` assert with `deepEqual`. Those two assertions are updated in Step 1. `buildOrgRollups` reads `tree.totals` only and is unaffected.

- [ ] **Step 1: Update the two existing assertions that pin the old `tree.org` shape**

In `tests/admin.test.js`, change line 49 from:

```js
    assert.deepEqual(tree.org, { id: 'o1', name: 'Org One' });
```

to:

```js
    assert.equal(tree.org.id, 'o1');
    assert.equal(tree.org.name, 'Org One');
    assert.equal(tree.org.stats.livePatients, 5); // every live patient in the org
```

and change line 95 from:

```js
    assert.deepEqual(tree.org, { id: 'o3', name: 'Empty' });
```

to:

```js
    assert.equal(tree.org.id, 'o3');
    assert.equal(tree.org.name, 'Empty');
    assert.equal(tree.org.stats.livePatients, 0);
```

- [ ] **Step 2: Write the failing tests**

Add this new top-level `describe` at the end of `tests/admin.test.js`:

```js
describe('buildOrgTree counting corrections', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-admin-counts-'));
    store = await createStore({ dataDir });
    await store.init();
    await store.createOrganization({ id: 'c-org', name: 'Counts Org', plan: 'free' });
    await store.createHospital({ id: 'c-h1', orgId: 'c-org', name: 'Hospital One' });
    await store.createDepartment({ id: 'c-d1', hospitalId: 'c-h1', name: 'Ortho', specialty: 'ortho' });
    await store.createUnit({ id: 'c-uA', departmentId: 'c-d1', name: 'Unit A' });
    await store.createUnit({ id: 'c-uB', departmentId: 'c-d1', name: 'Unit B' });
    await store.createWard({ id: 'c-wA', unitId: 'c-uA', name: 'Ward A' });
    await store.createWard({ id: 'c-wB', unitId: 'c-uB', name: 'Ward B' });

    const mkUser = (id, patch) => store.createUser(Object.assign({
      id, username: id, passwordHash: 'h', passwordSalt: 's', role: 'member',
      active: true, tokenVersion: 0, createdAt: Date.now(), orgId: 'c-org', wardId: null
    }, patch));
    // Carries BOTH the legacy department pin and a matching node assignment.
    await mkUser('c-dual', { wardId: 'c-d1', assignmentType: 'department', assignmentId: 'c-d1' });
    // Assigned above the department, at levels the old loop ignored entirely.
    await mkUser('c-hosp', { assignmentType: 'hospital', assignmentId: 'c-h1' });
    await mkUser('c-orgu', { assignmentType: 'org', assignmentId: 'c-org' });

    const put = (id, unitId, wardId, status, updatedAt) => store.upsertPatient(
      id, updatedAt, 0, JSON.stringify({ id, unitId, wardId, status, updatedAt })
    );
    await put('c-p1', 'c-uA', 'c-wA', 'postop', 1000);  // ward matches its unit
    await put('c-p2', 'c-uA', 'c-wB', 'preop', 2000);   // stale ward under a DIFFERENT unit
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('a user with both a legacy wardId and a matching assignment counts once', async () => {
    const tree = await buildOrgTree(store, 'c-org');
    const dep = tree.hospitals[0].departments[0];
    assert.equal(dep.stats.users, 1);
  });

  test('hospital- and org-level assignments are counted', async () => {
    const tree = await buildOrgTree(store, 'c-org');
    assert.equal(tree.hospitals[0].stats.users, 1);
    assert.equal(tree.org.stats.users, 1);
  });

  test('hospital and org carry rolled-up patient stats', async () => {
    const tree = await buildOrgTree(store, 'c-org');
    assert.equal(tree.hospitals[0].stats.livePatients, 2);
    assert.equal(tree.org.stats.livePatients, 2);
    assert.equal(tree.org.stats.byStatus.postop, 1);
    assert.equal(tree.org.stats.byStatus.preop, 1);
  });

  test('a wardId belonging to a different unit is not counted at that ward', async () => {
    const tree = await buildOrgTree(store, 'c-org');
    const units = tree.hospitals[0].departments[0].units;
    const wardA = units.find(u => u.id === 'c-uA').wards[0];
    const wardB = units.find(u => u.id === 'c-uB').wards[0];
    assert.equal(wardA.stats.livePatients, 1); // c-p1 only
    assert.equal(wardB.stats.livePatients, 0); // c-p2's wardId is stale, its unit is c-uA
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="buildOrgTree counting corrections"`

Expected: FAIL on all four — `dep.stats.users` reports `2` instead of `1`; `tree.hospitals[0].stats` is `undefined` so reading `.users` throws `TypeError: Cannot read properties of undefined`; `tree.org.stats` is likewise `undefined`; and `wardB.stats.livePatients` reports `1` instead of `0`.

- [ ] **Step 4: Rewrite `buildOrgTree`**

In `admin.js`, replace the entire `buildOrgTree` function (lines 31-115) with:

```js
export async function buildOrgTree(store, orgId){
  const org = await store.getOrganization(orgId);
  const hospitals = await store.listHospitalsByOrg(orgId);
  const users = await store.listUsersByOrg(orgId);
  const patients = parseLivePatients(await store.getActive());

  const outHospitals = [];
  const orgStats = emptyStats();
  const hospitalStats = new Map();   // hospitalId -> stats object (shared with output)
  const departmentStats = new Map(); // departmentId -> stats object
  const unitStats = new Map();       // unitId -> stats object
  const wardStats = new Map();       // wardId -> stats object
  const unitToDepartment = new Map();
  const unitToHospital = new Map();
  const wardToUnit = new Map();

  let unitCount = 0, wardCount = 0;

  for(const h of hospitals){
    const hStats = emptyStats();
    hospitalStats.set(h.id, hStats);

    const departments = await store.listDepartmentsByHospital(h.id);
    const outDepartments = [];
    for(const dep of departments){
      const depStats = emptyStats();
      departmentStats.set(dep.id, depStats);

      const units = await store.listUnitsByDepartment(dep.id);
      const outUnits = [];
      for(const unit of units){
        unitCount++;
        const uStats = emptyStats();
        unitStats.set(unit.id, uStats);
        unitToDepartment.set(unit.id, dep.id);
        unitToHospital.set(unit.id, h.id);

        const wards = await store.listWardsByUnit(unit.id);
        const outWards = [];
        for(const ward of wards){
          wardCount++;
          const wStats = emptyStats();
          wardStats.set(ward.id, wStats);
          wardToUnit.set(ward.id, unit.id);
          outWards.push({ id: ward.id, name: ward.name, stats: wStats });
        }
        outUnits.push({ id: unit.id, name: unit.name, stats: uStats, wards: outWards });
      }
      outDepartments.push({ id: dep.id, name: dep.name, specialty: dep.specialty, stats: depStats, units: outUnits });
    }
    outHospitals.push({ id: h.id, name: h.name, stats: hStats, departments: outDepartments });
  }

  for(const u of users){
    // Node-based assignment is authoritative and counts at exactly one level.
    // Counting the legacy per-department `wardId` as well double-counted any
    // user carrying both, so the legacy field is now only a fallback for
    // users whose assignment is missing or points outside this tree.
    if(u.assignmentType && u.assignmentId){
      const bucket =
        u.assignmentType === 'ward' ? wardStats.get(u.assignmentId) :
        u.assignmentType === 'unit' ? unitStats.get(u.assignmentId) :
        u.assignmentType === 'department' ? departmentStats.get(u.assignmentId) :
        u.assignmentType === 'hospital' ? hospitalStats.get(u.assignmentId) :
        u.assignmentType === 'org' && u.assignmentId === orgId ? orgStats :
        null;
      if(bucket){ bucket.users++; continue; }
    }
    const depStats = u.wardId ? departmentStats.get(u.wardId) : null;
    if(depStats) depStats.users++;
  }

  let livePatients = 0;
  for(const p of patients){
    const uStats = p.unitId ? unitStats.get(p.unitId) : null;
    if(!uStats) continue; // other orgs' units, or unassigned
    livePatients++;
    addPatientToStats(uStats, p);
    const depId = unitToDepartment.get(p.unitId);
    if(depId) addPatientToStats(departmentStats.get(depId), p);
    const hospId = unitToHospital.get(p.unitId);
    if(hospId) addPatientToStats(hospitalStats.get(hospId), p);
    addPatientToStats(orgStats, p);
    // Ward is an optional location under the unit — only patients carrying
    // that specific wardId count at the ward level, and only when the ward
    // actually belongs to the patient's unit. A wardId left behind by a move
    // would otherwise be counted under a ward in an unrelated unit.
    if(p.wardId && wardToUnit.get(p.wardId) === p.unitId) addPatientToStats(wardStats.get(p.wardId), p);
  }

  let departments = 0;
  for(const h of outHospitals) departments += h.departments.length;

  return {
    org: org ? { id: org.id, name: org.name, stats: orgStats } : null,
    totals: {
      hospitals: outHospitals.length,
      departments,
      wards: wardCount,
      units: unitCount,
      usersActive: users.filter(u => !!u.active).length,
      usersDisabled: users.filter(u => !u.active).length,
      livePatients
    },
    hospitals: outHospitals
  };
}
```

- [ ] **Step 5: Run the `admin.js` tests to verify they pass**

Run: `npm test -- --test-name-pattern="buildOrgTree|admin tree/stats builders"`

Expected: PASS. The pre-existing `admin tree/stats builders` tests must still pass unchanged apart from the two `tree.org` assertions edited in Step 1 — in that fixture `u1`/`u2` have a legacy `wardId` and no assignment, so they still count via the fallback and `dep1.stats.users` stays `2`.

- [ ] **Step 6: Write the failing frontend test for the new counts**

Add this new top-level `describe` at the end of `tests/frontend-admin-console.test.js`:

```js
describe('hospital and org rows show their counts', () => {
  const STATS = (n) => ({ livePatients: n, byStatus: { postop: n, preop: 0, conservative: 0, fordischarge: 0 }, users: 1, lastActivity: null });
  const ROLLED = Object.assign({}, TREE, {
    org: { id: 'bfv2-org', name: 'Default', stats: STATS(5) },
    hospitals: [Object.assign({}, TREE.hospitals[0], { stats: STATS(5) })]
  });

  test('the tree rail renders a count on the org and hospital rows', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(ROLLED, null);
    assert.match(html, /data-node="org:bfv2-org"[^>]*>[^<]*<span class="cc-count">5<\/span>/);
    assert.match(html, /data-node="hospital:h1"[^>]*>[^<]*<span class="cc-count">5<\/span>/);
  });

  test('the org detail panel renders its stats block', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: ROLLED, users: [], orgs: [], selection: { type: 'org', id: 'bfv2-org' } });
    assert.ok(html.includes('5 live patient'));
    assert.ok(html.includes('admin-status-bar'));
  });

  test('a hospital with assigned users cannot be deleted and says why', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const emptied = JSON.parse(JSON.stringify(ROLLED));
    emptied.hospitals[0].departments = [];
    emptied.hospitals[0].stats.livePatients = 0;
    emptied.hospitals[0].stats.users = 2;
    const html = window.renderAdminDetailHTML({ tree: emptied, users: [], orgs: [], selection: { type: 'hospital', id: 'h1' } });
    assert.match(html, /data-delete-node="hospital:h1"[^>]*disabled/);
    assert.ok(html.includes('2 users'));
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm test -- --test-name-pattern="hospital and org rows show their counts"`

Expected: FAIL on all three — the rail passes `null` as the count for both rows so no `cc-count` span is emitted; the org detail synthesises its node without `stats` so `nodeStatsHTML` returns `''`; and `deleteBlockedReason` sees no stats on the hospital so Delete renders enabled.

- [ ] **Step 8: Pass the counts through in the client**

In `public/admin-console.js`, replace lines 43-47 (inside `renderAdminTreeHTML`) with:

```js
  if(tree && tree.org){
    out += ccRowHTML('org', tree.org.id, tree.org.name || 'Organization', tree.org.stats ? tree.org.stats.livePatients : null, 0, selection);
  }
  for(const h of (tree && tree.hospitals) || []){
    out += ccRowHTML('hospital', h.id, h.name, h.stats ? h.stats.livePatients : null, 0, selection);
```

and replace line 131 (inside `renderAdminDetailHTML`'s `sel.type === 'org'` branch) with:

```js
    hit = { node: { id: state.tree.org.id, name: state.tree.org.name || 'Organization', stats: state.tree.org.stats, hospitals: state.tree.hospitals || [] }, parentType: null, parentId: null };
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="hospital and org rows show their counts"`

Expected: PASS, 3 tests.

- [ ] **Step 10: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 11: Commit**

```bash
git add admin.js public/admin-console.js tests/admin.test.js tests/frontend-admin-console.test.js
git commit -m "fix: correct admin tree counts and roll them up to hospital and org

Users holding both a legacy wardId and a matching node assignment were
counted twice; hospital- and org-level assignments were not counted at
all, so a hospital's Delete button looked enabled until the server
409'd; hospitals and the org carried no stats; and a patient's stale
wardId was counted under a ward belonging to a different unit."
```

---

### Task 5: Thread the 409 `blockedBy` payload through `api()`

`api()` throws away everything but `error`, so the delete handler can only toast the bare string `"Node is not empty"` (defect 13).

**Files:**
- Modify: `public/app.js:363-367` (`api`)
- Modify: `public/admin-console.js:343-355` (delete click handler), plus a new helper
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `api()` rejects with an `Error` carrying `err.status` (number) and `err.payload` (the parsed JSON body, or absent when the body was not JSON). New global `describeDeleteBlock(err)` in `admin-console.js` returns a sentence like `Can't delete — still has 3 patients, 1 user`, or `null` when the error carries no `blockedBy`.

- [ ] **Step 1: Write the failing tests**

Add this new top-level `describe` at the end of `tests/frontend-admin-console.test.js`:

```js
describe('409 blockedBy reaches the UI', () => {
  test('api() attaches the status and parsed body to the thrown error', async () => {
    const { window } = loadFrontendEnv();
    window.fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Node is not empty', blockedBy: { children: 0, users: 1, patients: 3 } })
    });
    await assert.rejects(
      () => window.api('/api/admin/nodes/unit/u1', { method: 'DELETE' }),
      (err) => {
        assert.equal(err.message, 'Node is not empty');
        assert.equal(err.status, 409);
        assert.equal(err.payload.blockedBy.patients, 3);
        return true;
      }
    );
  });

  test('describeDeleteBlock names what is in the way', () => {
    const { window } = loadFrontendEnv();
    const err = new window.Error('Node is not empty');
    err.payload = { blockedBy: { children: 0, users: 1, patients: 3 } };
    assert.equal(window.describeDeleteBlock(err), "Can't delete — still has 3 patients, 1 user");
  });

  test('describeDeleteBlock returns null for an unrelated error', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.describeDeleteBlock(new window.Error('boom')), null);
  });

  test('a blocked delete toasts the explained reason, not the bare server string', async () => {
    const { window, document } = loadFrontendEnv();
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.confirm = () => true;
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return { totals: { departments: 0, usersActive: 0, livePatients: 0 }, hospitals: [] };
      if(path === '/api/admin/users') return { users: [] };
      if(opts && opts.method === 'DELETE'){
        const err = new window.Error('Node is not empty');
        err.status = 409;
        err.payload = { error: 'Node is not empty', blockedBy: { children: 0, users: 0, patients: 2 } };
        throw err;
      }
      return {};
    };
    const empty = JSON.parse(JSON.stringify(TREE));
    empty.hospitals[0].departments[0].units[1].stats.livePatients = 0;
    empty.hospitals[0].departments[0].units[1].stats.users = 0;
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: empty, users: [], orgs: [], selection: { type: 'unit', id: 'u2' } });
    document.querySelector('[data-delete-node="unit:u2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual([...toasts], ["Can't delete — still has 2 patients"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="409 blockedBy reaches the UI"`

Expected: FAIL — `err.status` and `err.payload` are `undefined`, and `window.describeDeleteBlock` is not a function (`TypeError`).

- [ ] **Step 3: Attach the payload in `api()`**

In `public/app.js`, replace lines 363-367 with:

```js
  if(!res.ok){
    let msg = 'Request failed (' + res.status + ')';
    let payload = null;
    try{ payload = await res.json(); }catch{ /* non-JSON body — keep the generic message */ }
    if(payload && payload.error) msg = payload.error;
    const err = new Error(msg);
    // Callers that need more than a message — the admin console's delete
    // handler reads the 409 `blockedBy` counts — would otherwise have no way
    // to see the rest of the response body.
    err.status = res.status;
    if(payload) err.payload = payload;
    throw err;
  }
```

- [ ] **Step 4: Add `describeDeleteBlock` and use it**

In `public/admin-console.js`, add this function immediately after `deleteBlockedReason` (which ends at line 187):

```js
/** Turns a 409 `{ error, blockedBy: { children, users, patients } }` into a
    sentence naming what is actually in the way. Returns null for any error
    without a blockedBy payload so callers can fall back to err.message. */
function describeDeleteBlock(err){
  const b = err && err.payload && err.payload.blockedBy;
  if(!b) return null;
  const bits = [];
  if(b.children) bits.push(`${b.children} child item${b.children === 1 ? '' : 's'}`);
  if(b.patients) bits.push(`${b.patients} patient${b.patients === 1 ? '' : 's'}`);
  if(b.users) bits.push(`${b.users} user${b.users === 1 ? '' : 's'}`);
  return bits.length ? `Can't delete — still has ${bits.join(', ')}` : null;
}
```

Then, in the delete click handler, replace the `.catch(...)` on line 353:

```js
      .catch(err => showToast(err.message));
```

with:

```js
      .catch(err => showToast(describeDeleteBlock(err) || err.message));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="409 blockedBy reaches the UI"`

Expected: PASS, 4 tests.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/admin-console.js tests/frontend-admin-console.test.js
git commit -m "fix: surface the 409 blockedBy counts on a refused delete

api() discarded everything but the error string, so a blocked delete
toasted a bare \"Node is not empty\" with no indication of what was in
the way. The thrown error now carries status and the parsed body."
```

---

### Task 6: Repair the instance-admin org-context lifecycle

Defects 2, 3, 9, 11 and 12. Leaving a drilled-in org never clears `adminViewOrgId`, so every later reload refreshes the *hidden* org tree instead of the org cards; the full org list is overwritten by the single viewed org; selection from one org leaks into the next; and the "Organization" tab shows a permanent "Loading…" before an org is chosen.

The four org-context handlers currently live in `app.js`'s `bindAuthEvents()`, which never runs in the jsdom test environment (`__ORTHO_SKIP_AUTOINIT__`), so they are untestable where they are. This task moves them into `admin-console.js`'s existing module-scope `#adminView` click listener — the first slice of the file consolidation the spec calls for in §6.

**Files:**
- Modify: `public/admin-console.js` — `selectAdminNode` (line 61), `renderAdminOrgsTab` (line 476), `loadAdminView` (line 496), `switchAdminTab` (line 526), `openAdminView` (line 540), the module-scope click listener (line 309); add `exitAdminOrgContext`, `enterAdminOrgContext`, `showAdminOrgChooser`
- Modify: `public/app.js:3607-3633` — delete the `#adminView` click listener block
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `isInstanceAdminUser()` (`app.js:7823`), `api`, `showToast`, `showConfirm(title, message, opts)` (`app.js:2258`, resolves to a boolean).
- Produces: new globals `exitAdminOrgContext()` (clears the viewed org, resets selection and tree, returns to the org cards) and `showAdminOrgChooser()` (paints the "pick an org first" message into the detail pane). Module-scoped `adminAllOrgs` holds the instance admin's full org list across a drill-in.

- [ ] **Step 1: Write the failing tests**

Add this new top-level `describe` at the end of `tests/frontend-admin-console.test.js`:

```js
describe('instance-admin org context', () => {
  const ORGS = [
    { id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 1, departments: 1, users: 2, livePatients: 3 } },
    { id: 'o2', name: 'Org Two', plan: 'paid', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }
  ];
  const ORG_ONE_TREE = {
    org: { id: 'o1', name: 'Org One', stats: { livePatients: 3, byStatus: { postop: 3, preop: 0, conservative: 0, fordischarge: 0 }, users: 2, lastActivity: null } },
    totals: { departments: 0, usersActive: 2, livePatients: 3 },
    hospitals: []
  };

  function instanceAdminEnv(){
    const env = loadFrontendEnv();
    env.window.localStorage.setItem('ortho_role', 'admin'); // isAdmin() && no org id => instance admin
    const paths = [];
    env.window.api = async (path) => {
      paths.push(path);
      if(path === '/api/admin/orgs') return { orgs: ORGS };
      if(path.startsWith('/api/admin/org')) return ORG_ONE_TREE;
      if(path === '/api/admin/users') return { users: [
        { id: 'usr2', username: 'Amit', role: 'member', active: true, orgId: 'o1', assignmentType: 'org', assignmentId: 'o1' }
      ] };
      return {};
    };
    return Object.assign({ paths }, env);
  }

  test('viewing an org loads that org tree; leaving it returns to the org cards', async () => {
    const { window, document, paths } = instanceAdminEnv();
    await window.loadAdminView();
    assert.ok(document.getElementById('adminOrgsTab').innerHTML.includes('Org Two'));

    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(paths.includes('/api/admin/org?orgId=o1'), 'expected the org tree to load for o1');

    paths.length = 0;
    document.getElementById('adminOrgsTab').innerHTML = ''; // prove it gets repainted
    window.exitAdminOrgContext();
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual([...paths], ['/api/admin/orgs'], 'leaving must refetch the org list, not the hidden org tree');
    assert.ok(document.getElementById('adminOrgsTab').innerHTML.includes('Org Two'));
  });

  test('the assignment picker still lists every org after drilling into one', async () => {
    const { window, document } = instanceAdminEnv();
    await window.loadAdminView();
    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const html = document.getElementById('adminDetailPane').innerHTML;
    assert.ok(html.includes('value="org:o1"'));
    assert.ok(html.includes('value="org:o2"'), 'the other org must remain assignable');
  });

  test('switching org drops the previous org selection', async () => {
    const { window, document } = instanceAdminEnv();
    await window.loadAdminView();
    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    window.selectAdminNode('unit', 'gone-in-the-next-org');
    assert.ok(document.getElementById('adminDetailPane').innerHTML.includes('no longer exists'));

    window.exitAdminOrgContext();
    await new Promise(r => setTimeout(r, 0));
    document.querySelector('[data-view-org="o2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(!document.getElementById('adminDetailPane').innerHTML.includes('no longer exists'));
  });

  test('the Organization tab prompts for an org instead of sitting on Loading', async () => {
    const { window, document } = instanceAdminEnv();
    await window.loadAdminView();
    document.getElementById('adminDetailPane').innerHTML = '<div class="small-muted">Loading…</div>';
    document.querySelector('.admin-tab[data-admin-tab="org"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const html = document.getElementById('adminDetailPane').innerHTML;
    assert.ok(!html.includes('Loading'));
    assert.ok(html.includes('Choose an organization'));
  });

  test('creating an organization with a blank name says so instead of doing nothing', async () => {
    const { window, document } = instanceAdminEnv();
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    await window.loadAdminView();
    document.getElementById('adminNewOrgName').value = '   ';
    document.getElementById('adminAddOrgBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual([...toasts], ['Enter an organization name']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="instance-admin org context"`

Expected: FAIL — `window.exitAdminOrgContext` is not a function, and the `[data-view-org]` / `[data-admin-tab]` / `#adminAddOrgBtn` clicks do nothing at all because their handler lives in `app.js`'s `bindAuthEvents()`, which never runs under `__ORTHO_SKIP_AUTOINIT__`.

- [ ] **Step 3: Add the org-context state and helpers**

In `public/admin-console.js`, replace line 494 (`let adminViewOrgId = null; // instance admin: which org's tree is loaded`) with:

```js
let adminViewOrgId = null;  // instance admin: which org's tree is loaded
let adminAllOrgs = [];      // instance admin: every org, kept across a drill-in

/** Leave a drilled-in org and go back to the all-orgs list. Clearing the id
    is what makes the next loadAdminView() take the orgs branch — without it
    every later reload silently refreshed the hidden org tree instead. */
function exitAdminOrgContext(){
  adminViewOrgId = null;
  adminState.tree = null;
  adminState.selection = null;
  switchAdminTab('orgs');
  loadAdminView().catch(err => showToast(err.message || 'Could not load admin data'));
}

/** Enter an org's tree. Selection and tree are dropped so a node picked in
    the previous org cannot render as "That item no longer exists" here. */
function enterAdminOrgContext(orgId){
  adminViewOrgId = orgId;
  adminState.tree = null;
  adminState.selection = null;
  switchAdminTab('org');
  loadAdminView().catch(err => showToast(err.message || 'Could not load admin data'));
}

/** The Organization tab is meaningless for an instance admin until they pick
    an org; without this it kept whatever was last painted, which on a fresh
    open is the "Loading…" placeholder. */
function showAdminOrgChooser(){
  const rail = document.getElementById('adminTreeRail');
  if(rail) rail.innerHTML = '';
  const detail = document.getElementById('adminDetailPane');
  if(detail) detail.innerHTML = '<div class="small-muted">Choose an organization on the Organizations tab first.</div>';
  const tiles = document.getElementById('adminStatTiles');
  if(tiles) tiles.innerHTML = '';
}
```

- [ ] **Step 4: Keep the full org list across a drill-in**

In `public/admin-console.js`, replace `loadAdminView` (lines 496-519) with:

```js
async function loadAdminView(){
  const qs = isInstanceAdminUser() && adminViewOrgId ? `?orgId=${encodeURIComponent(adminViewOrgId)}` : '';
  if(isInstanceAdminUser() && !adminViewOrgId){
    const tabs = document.getElementById('adminTabs');
    if(tabs) tabs.style.display = '';
    switchAdminTab('orgs');
    adminAllOrgs = (await api('/api/admin/orgs')).orgs;
    adminState.orgs = adminAllOrgs;
    renderAdminOrgsTab(adminAllOrgs);
    return;
  }
  const [tree, usersRes] = await Promise.all([api('/api/admin/org' + qs), api('/api/admin/users')]);
  adminState.tree = tree;
  // An instance admin keeps the full list they already fetched, so drilling
  // into one org doesn't strip every other org out of the assignment picker.
  // An org admin has exactly one org in scope: the one buildOrgTree resolved
  // (GET /api/admin/orgs is instance-admin-only, so there is no other source).
  adminState.orgs = adminAllOrgs.length ? adminAllOrgs : (tree.org ? [tree.org] : []);
  adminState.users = isInstanceAdminUser() && adminViewOrgId
    ? usersRes.users.filter(u => u.orgId === adminViewOrgId)
    : usersRes.users;
  if(!adminState.selection) adminState.selection = { type: 'users' };
  renderAdminStatTilesInto(tree);
  renderAdminCommandCenter();
}
```

- [ ] **Step 5: Reset all state on open, and guard the orgs render**

In `public/admin-console.js`, replace `openAdminView` (lines 540-548) with:

```js
function openAdminView(){
  document.getElementById('adminView').hidden = false;
  adminViewOrgId = null;
  adminAllOrgs = [];
  // A stale selection or tree from the previous session would render as
  // "That item no longer exists" before the first fetch resolves.
  adminState = { tree: null, users: [], orgs: [], selection: null };
  for(const id of ['adminStatTiles', 'adminTreeRail', 'adminDetailPane']){
    const el = document.getElementById(id);
    if(el) el.innerHTML = '<div class="small-muted">Loading…</div>';
  }
  loadAdminView().catch(err => showToast(err.message || 'Could not load admin data'));
}
```

and change the first line of `renderAdminOrgsTab` (line 477) from:

```js
  const el = document.getElementById('adminOrgsTab');
  el.innerHTML = `<h3>Organizations</h3>` + orgs.map(o => `
```

to:

```js
  const el = document.getElementById('adminOrgsTab');
  if(!el) return;
  el.innerHTML = `<h3>Organizations</h3>` + orgs.map(o => `
```

Finally, close the other half of defect 9 — `switchAdminTab` dereferences two `getElementById` results with no guard, which throws if either pane is absent. Replace `switchAdminTab` (lines 526-538) with:

```js
function switchAdminTab(tab){
  const orgPane = document.getElementById('adminOrgPane');
  if(orgPane) orgPane.style.display = tab === 'org' ? '' : 'none';
  const orgsPane = document.getElementById('adminOrgsTab');
  if(orgsPane) orgsPane.style.display = tab === 'orgs' ? '' : 'none';
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.toggle('active', b.dataset.adminTab === tab));
  // The stat tiles are only ever painted by the 'org' branch of
  // loadAdminView(); leaving them showing a stale "Loading…" (or a stale
  // prior org's numbers) once the view has navigated away from that tab
  // would be misleading, so clear them whenever 'org' isn't the active tab.
  if(tab !== 'org'){
    const tiles = document.getElementById('adminStatTiles');
    if(tiles) tiles.innerHTML = '';
  }
}
```

- [ ] **Step 6: Route the Organizations rail row through the exit path**

In `public/admin-console.js`, replace `selectAdminNode` (lines 61-68) with:

```js
function selectAdminNode(type, id){
  // The Organizations row isn't part of the org tree/detail pane — selecting
  // it leaves any drilled-in org entirely and returns to the all-orgs list,
  // rather than rendering a detail panel for a "node" that doesn't exist.
  if(type === 'orgs'){
    adminState.selection = { type };
    exitAdminOrgContext();
    return;
  }
  adminState.selection = id ? { type, id } : { type };
  renderAdminCommandCenter();
}
```

- [ ] **Step 7: Move the org handlers into `admin-console.js`**

In `public/admin-console.js`, inside the module-scope click listener that begins at line 309 (`document.getElementById('adminView')?.addEventListener('click', (e) => {`), insert this block at the very top of the callback, before the existing `const addBtn = e.target.closest('[data-add-child]');` line:

```js
  const tabBtn = e.target.closest('[data-admin-tab]');
  if(tabBtn){
    e.stopPropagation();
    if(tabBtn.dataset.adminTab === 'orgs'){ exitAdminOrgContext(); return; }
    switchAdminTab('org');
    if(isInstanceAdminUser() && !adminViewOrgId) showAdminOrgChooser();
    return;
  }
  const viewOrgBtn = e.target.closest('[data-view-org]');
  if(viewOrgBtn){
    e.stopPropagation();
    enterAdminOrgContext(viewOrgBtn.dataset.viewOrg);
    return;
  }
  if(e.target.id === 'adminAddOrgBtn'){
    e.stopPropagation();
    const input = document.getElementById('adminNewOrgName');
    const name = (input && input.value || '').trim();
    if(!name){ showToast('Enter an organization name'); return; }
    api('/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name }) })
      .then(() => { input.value = ''; return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
  const mkOrgAdmin = e.target.closest('[data-create-org-admin]');
  if(mkOrgAdmin){
    e.stopPropagation();
    const oid = mkOrgAdmin.dataset.createOrgAdmin;
    const input = document.querySelector(`[data-new-org-admin="${oid}"]`);
    const username = (input && input.value || '').trim();
    if(!username){ showToast('Enter a username'); return; }
    api(`/api/admin/orgs/${encodeURIComponent(oid)}/admin`, { method: 'POST', body: JSON.stringify({ username }) })
      .then(r => showConfirm('Org admin created', `Temporary password for ${r.username}: ${r.temporaryPassword}\nIt is not shown again.`, { confirmLabel: 'Done' }))
      .then(() => loadAdminView())
      .catch(err => showToast(err.message));
    return;
  }
```

- [ ] **Step 8: Delete the duplicated handler from `app.js`**

In `public/app.js`, delete the entire block at lines 3607-3633 — from `document.getElementById('adminView')?.addEventListener('click', async (e) => {` through its closing `});`. Leave line 3606 (`document.getElementById('desktopAdminBtn')?.addEventListener('click', openAdminView);`) and the closing brace of `bindAuthEvents()` intact.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="instance-admin org context"`

Expected: PASS, 5 tests.

- [ ] **Step 10: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures. Pay attention to `tests/frontend-admin-view.test.js` and the existing `Organizations row navigates (Finding 4 fix)` test in `tests/frontend-admin-console.test.js:489-497` — that test calls `window.selectAdminNode('orgs', null)` and asserts the tab switch. It still passes, because `exitAdminOrgContext` calls `switchAdminTab('orgs')`; its `loadAdminView()` rejects (no `window.api` mock in that test) but the rejection is caught by the `.catch` and only reaches `showToast`.

- [ ] **Step 11: Commit**

```bash
git add public/admin-console.js public/app.js tests/frontend-admin-console.test.js
git commit -m "fix: repair the instance-admin org-context lifecycle

Leaving a drilled-in org never cleared adminViewOrgId, so every later
reload refreshed the hidden org tree and the org cards went stale; the
full org list was overwritten by the single viewed org, emptying the
assignment picker; selection leaked between orgs; and the Organization
tab sat on Loading before an org was chosen. Moves the four org
handlers out of app.js's bindAuthEvents (unreachable in jsdom tests)
into the admin-console click listener."
```

---

## Verification

- [ ] **Run the whole suite one final time**

Run: `npm test`

Expected: PASS, 0 failures, and 452 tests (425 baseline + 27 new: 3 in Task 1, 1 in Task 2, 7 in Task 3, 7 in Task 4, 4 in Task 5, 5 in Task 6).

- [ ] **Manual smoke test as an instance admin**

```bash
ORTHO_FLAG_MULTI_TENANT=1 ORTHO_ADMIN_PASSWORD=smoke-test-pass npm start
```

Sign in as `admin`, then confirm each of these, which were all broken before:

1. Organizations → **Create organization** with a blank name shows "Enter an organization name".
2. Create an org, create its org admin, then **View** it. The header switches to the org tree.
3. Select the org root → **Add hospital** succeeds (this returned a 400 before).
4. Users → **Create user** succeeds, and the new user stays visible in the list after the reload.
5. The assignment picker's Organizations group still lists *every* org, not just the one being viewed.
6. Click the **Organizations** tab → the org cards reappear, and creating another org updates the list immediately.
7. Click **Organization** before choosing an org → "Choose an organization on the Organizations tab first", not a stuck "Loading…".
8. The org and hospital rows in the tree show live-patient counts.
9. Try to delete a hospital that still has a user assigned → the button is disabled and names the user count.

---

## Not in this plan

Everything in Plan 2 (the makeover): the state/rendering split, the four-section shell, People, Structure, Organizations as redesigned surfaces, plain-language copy, the mobile editing gate removal, the collapsible tree, inline rename, explicit-confirm move, the "people assigned here" list, the repair-ancestry button, department specialty editing, and the visual and accessibility pass. This plan deliberately leaves the current layout alone.
