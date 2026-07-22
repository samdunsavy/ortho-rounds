### Task 4: server.js — console routes + org-scoping of existing user routes

**Files:**
- Modify: `server.js` — new flag-gated route block after the telemetry route (~line 320); existing user routes (`GET/POST /api/admin/users`, disable/enable/reset, ~322-375+)
- Test: `tests/server-admin-console.test.js` (new)

**Interfaces:**
- Consumes: `buildOrgTree`/`buildOrgRollups` (Task 3 shapes), `resolveScope` (scope.js — used for ward-set validation), `isInstanceAdmin` (server.js:220), `store.listUsersByOrg`, existing `generateReadablePassword`/`hashPassword`/`crypto`.
- Produces: routes exactly as spec §1. Flag off: none of the new routes exist (404); existing user routes byte-identical.

- [ ] **Step 1: Write the failing tests**

Create `tests/server-admin-console.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/server-admin-console.test.js`
Expected: flag-on describe FAILS (new routes 404); flag-off describe passes already.

- [ ] **Step 3: Implement in `server.js`**

Add imports: `import { buildOrgTree, buildOrgRollups } from './admin.js';` (and `resolveScope` is NOT needed here — ward validation goes through `getWard`/`getHospital` org checks below).

Helper next to `isInstanceAdmin`:

```js
function cleanName(raw, max = 80){
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s && s.length <= max ? s : null;
}

/** Which org is this admin request about? Org admins: their own.
 *  Instance admins must target explicitly (query on GET, body on POST). */
function requestedOrgId(actor, explicit){
  if(!isInstanceAdmin(actor)) return actor.orgId || null;
  return typeof explicit === 'string' && explicit ? explicit : null;
}

/** True iff wardId belongs to org orgId (looks up ward -> hospital -> org). */
async function wardInOrg(wardId, orgId){
  const ward = await store.getWard(wardId);
  if(!ward) return false;
  const hospital = await store.getHospital(ward.hospitalId);
  return !!hospital && hospital.orgId === orgId;
}
```

New route block, inserted immediately after the `/api/admin/telemetry` route, wrapped entirely in a flag guard so flag-off falls through to 404:

```js
  if(isEnabled('MULTI_TENANT') && pathname.startsWith('/api/admin/')){
    const orgAdminMatch = pathname.match(/^\/api\/admin\/orgs\/([^/]+)\/admin$/);

    if(pathname === '/api/admin/orgs' && req.method === 'POST'){
      if(!isInstanceAdmin(actor)) return sendJSON(res, 403, { error: 'Instance admin only' });
      const body = await readBody(req) || {};
      const name = cleanName(body.name);
      if(!name) return sendJSON(res, 400, { error: 'Organization name required (max 80 chars)' });
      const org = { id: crypto.randomUUID(), name, plan: body.plan === 'paid' ? 'paid' : 'free', createdAt: Date.now() };
      await store.createOrganization(org);
      return sendJSON(res, 200, { id: org.id, name: org.name, plan: org.plan });
    }

    if(pathname === '/api/admin/orgs' && req.method === 'GET'){
      if(!isInstanceAdmin(actor)) return sendJSON(res, 403, { error: 'Instance admin only' });
      return sendJSON(res, 200, { orgs: await buildOrgRollups(store) });
    }

    if(orgAdminMatch && req.method === 'POST'){
      if(!isInstanceAdmin(actor)) return sendJSON(res, 403, { error: 'Instance admin only' });
      const org = await store.getOrganization(orgAdminMatch[1]);
      if(!org) return sendJSON(res, 404, { error: 'Organization not found' });
      const body = await readBody(req) || {};
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      if(!username || username.length > 32) return sendJSON(res, 400, { error: 'Username required (max 32 chars)' });
      if(await store.getUserByUsername(username)) return sendJSON(res, 409, { error: 'That username is already taken' });
      const password = generateReadablePassword();
      const passwordSalt = crypto.randomBytes(16).toString('hex');
      const newUser = {
        id: crypto.randomUUID(), username, passwordHash: hashPassword(password, passwordSalt), passwordSalt,
        role: 'admin', active: true, tokenVersion: 0, createdAt: Date.now(), orgId: org.id, wardId: null
      };
      await store.createUser(newUser);
      return sendJSON(res, 200, { id: newUser.id, username, role: 'admin', orgId: org.id, temporaryPassword: password });
    }

    if(pathname === '/api/admin/org' && req.method === 'GET'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const qIdx = req.url.indexOf('?');
      const params = new URLSearchParams(qIdx >= 0 ? req.url.slice(qIdx + 1) : '');
      const orgId = requestedOrgId(actor, params.get('orgId'));
      if(!orgId) return sendJSON(res, 400, { error: 'orgId required' });
      if(!(await store.getOrganization(orgId))) return sendJSON(res, 404, { error: 'Organization not found' });
      if(!isInstanceAdmin(actor) && actor.orgId !== orgId) return sendJSON(res, 403, { error: 'Not your organization' });
      return sendJSON(res, 200, await buildOrgTree(store, orgId));
    }

    if(pathname === '/api/admin/hospitals' && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const body = await readBody(req) || {};
      const orgId = requestedOrgId(actor, body.orgId);
      if(!orgId) return sendJSON(res, 400, { error: 'orgId required' });
      if(!(await store.getOrganization(orgId))) return sendJSON(res, 404, { error: 'Organization not found' });
      const name = cleanName(body.name);
      if(!name) return sendJSON(res, 400, { error: 'Hospital name required (max 80 chars)' });
      const hospital = { id: crypto.randomUUID(), orgId, name, createdAt: Date.now() };
      await store.createHospital(hospital);
      return sendJSON(res, 200, { id: hospital.id, orgId, name });
    }

    if(pathname === '/api/admin/wards' && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const body = await readBody(req) || {};
      const hospital = body.hospitalId ? await store.getHospital(body.hospitalId) : null;
      if(!hospital) return sendJSON(res, 404, { error: 'Hospital not found' });
      if(!isInstanceAdmin(actor) && hospital.orgId !== actor.orgId) return sendJSON(res, 403, { error: 'Not your organization' });
      const name = cleanName(body.name);
      if(!name) return sendJSON(res, 400, { error: 'Department name required (max 80 chars)' });
      const specialty = cleanName(body.specialty, 40) || 'ortho';
      const ward = { id: crypto.randomUUID(), hospitalId: hospital.id, name, specialty, createdAt: Date.now() };
      await store.createWard(ward);
      return sendJSON(res, 200, { id: ward.id, hospitalId: hospital.id, name, specialty });
    }

    const assignMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/assign$/);
    if(assignMatch && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const target = await store.getUserById(assignMatch[1]);
      if(!target) return sendJSON(res, 404, { error: 'User not found' });
      if(!isInstanceAdmin(actor) && target.orgId !== actor.orgId) return sendJSON(res, 403, { error: 'Not your organization' });
      const body = await readBody(req) || {};
      const wardId = body.wardId === null || body.wardId === undefined ? null : String(body.wardId);
      if(wardId !== null){
        const targetOrg = isInstanceAdmin(actor) ? target.orgId : actor.orgId;
        if(!targetOrg || !(await wardInOrg(wardId, targetOrg))) return sendJSON(res, 403, { error: 'Department is not in this organization' });
      }
      await store.updateUser(target.id, { wardId });
      return sendJSON(res, 200, { ok: true, wardId });
    }
    // fall through: unmatched /api/admin/* paths continue to the routes below
  }
```

**Org-scoping of existing user routes** (each edit is a flag-gated wrap; flag-off code path identical):

`GET /api/admin/users` — replace the two body lines with:

```js
    let users = await store.getAllUsers();
    if(isEnabled('MULTI_TENANT') && !isInstanceAdmin(actor)){
      users = users.filter(u => u.orgId === actor.orgId);
    }
    const extra = isEnabled('MULTI_TENANT') ? (u) => ({ wardId: u.wardId ?? null, orgId: u.orgId ?? null }) : () => ({});
    return sendJSON(res, 200, {
      users: users.map(u => ({ id: u.id, username: u.username, role: u.role, active: !!u.active, createdAt: u.createdAt, ...extra(u) }))
    });
```

`POST /api/admin/users` — after the `newUser` object literal and before `createUser`, add:

```js
    if(isEnabled('MULTI_TENANT')){
      if(!isInstanceAdmin(actor)){
        newUser.orgId = actor.orgId;
        if(body.wardId){
          if(!(await wardInOrg(String(body.wardId), actor.orgId))) return sendJSON(res, 403, { error: 'Department is not in this organization' });
          newUser.wardId = String(body.wardId);
        }
      }else if(body.orgId){
        if(!(await store.getOrganization(body.orgId))) return sendJSON(res, 404, { error: 'Organization not found' });
        newUser.orgId = body.orgId;
        if(body.wardId){
          if(!(await wardInOrg(String(body.wardId), body.orgId))) return sendJSON(res, 403, { error: 'Department is not in this organization' });
          newUser.wardId = String(body.wardId);
        }
      }
    }
```

`disable` / `enable` / `reset-password` — after each route's `if(!target) return 404` line, add the same guard:

```js
    if(isEnabled('MULTI_TENANT') && !isInstanceAdmin(actor) && target.orgId !== actor.orgId){
      return sendJSON(res, 403, { error: 'Not your organization' });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/server-admin-console.test.js tests/server-scoping.test.js tests/server-sync-golden.test.js` → PASS.

- [ ] **Step 5: Full suite, commit**

```bash
git add server.js tests/server-admin-console.test.js
git commit -m "feat: MULTI_TENANT admin console API + org-scoped user routes"
```

---

