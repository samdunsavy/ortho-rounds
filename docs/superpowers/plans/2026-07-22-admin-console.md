# Admin Console + Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag-gated org/department admin console — API with stats, dedicated in-app Admin view, and bootstrapAdmin self-heal — per the approved spec.

**Architecture:** Tree/stats builders live in a new pure module `admin.js` (unit-testable without HTTP). Routes stay in `server.js` following its existing pattern, registered only when `MULTI_TENANT` is on (flag off → 404, zero new surface). UI is a full-screen view in the existing SPA (like presentation mode), rendered from existing design tokens; entry appears only flag-on + admin. Provisioning self-heal is a flag-on-only branch in `bootstrapAdmin`.

**Tech Stack:** Node 22, `node --test`, existing integration harness (`tests/helpers/server-harness.js`: `startServer({multiTenant, seed})` auto-seeds instance admin `admin`/`test-admin-pass` when `seed` given; `login`, `syncPost`), jsdom frontend harness (`tests/helpers/frontend-env.js`).

**Spec:** `docs/superpowers/specs/2026-07-22-admin-console-design.md`

## Global Constraints

- Flag off: byte-identical. New routes not registered (404); existing admin routes unchanged (goldens assert); `bootstrapAdmin` flag-off condition untouched; zero UI change (Admin entry absent).
- Access: instance admin = `isInstanceAdmin(actor)` (exists in server.js:220). Org admin = `role==='admin' && actor.orgId`. Org admins operate on own org only; instance admin targets orgs via `?orgId=` (GET) / `orgId` body field (POST); missing target for instance admin → 400; cross-org reference → 403.
- Onboarding: temp-password-shown-once (`generateReadablePassword()`), no email.
- Names trimmed, required, max 80 chars → else 400. Usernames: existing rules (max 32, globally unique, 409 on conflict).
- No deletes/renames of orgs/hospitals/departments this pass.
- Stats computed app-layer from `store.getActive()` + patient JSON (`wardId`, `status`); statuses bucketed exactly: `postop`, `preop`, `conservative`, `fordischarge` (any other/missing status counts in `livePatients` only).
- Tests: `npm test`. Git quirk: stale `.git/*.lock` → `rm -f`, retry once.
- Existing anchors: admin routes server.js:317-375+; `isInstanceAdmin` server.js:220; actor has `orgId`/`wardId`; login handler app.js:~1964 stores LS_ROLE; `api()` helper app.js:350; `formatRelativeTime` exists in app.js; account UI `updateAccountUI()` app.js:~3589.

---

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

### Task 3: `admin.js` — pure tree/stats builders

**Files:**
- Create: `admin.js` (repo root, ESM)
- Test: `tests/admin.test.js`

**Interfaces:**
- Consumes: store CRUD (`listHospitalsByOrg`, `listWardsByHospital`, `listUsersByOrg`, `listOrganizations`, `getActive`).
- Produces (Task 4 relies on exact shapes):
  - `buildOrgTree(store, orgId) -> Promise<{totals, hospitals}>` where `totals = {hospitals, departments, usersActive, usersDisabled, livePatients}` and `hospitals = [{id, name, wards: [{id, name, specialty, stats: {livePatients, byStatus: {postop, preop, conservative, fordischarge}, users, lastActivity}}]}]`; `lastActivity` = max `updatedAt` among the department's live patients else `null`.
  - `buildOrgRollups(store) -> Promise<[{id, name, plan, createdAt, stats: {hospitals, departments, users, livePatients}}]>`.
  - Patients parse: rows from `getActive()` are `{id, updatedAt, deleted, data}` — parse `data` JSON for `wardId`/`status` (malformed JSON → skip row).

- [ ] **Step 1: Write the failing tests**

Create `tests/admin.test.js`:

```js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';
import { buildOrgTree, buildOrgRollups } from '../admin.js';

describe('admin tree/stats builders', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-admin-'));
    store = await createStore({ dataDir });
    await store.init();
    await store.createOrganization({ id: 'o1', name: 'Org One', plan: 'free' });
    await store.createOrganization({ id: 'o2', name: 'Org Two', plan: 'paid' });
    await store.createHospital({ id: 'h1', orgId: 'o1', name: 'City Hospital' });
    await store.createWard({ id: 'w1', hospitalId: 'h1', name: 'Ortho', specialty: 'ortho' });
    await store.createWard({ id: 'w2', hospitalId: 'h1', name: 'Surgery', specialty: 'surgery' });
    const mkUser = (id, orgId, wardId, role = 'member', active = true) => store.createUser({
      id, username: id, passwordHash: 'h', passwordSalt: 's', role, active,
      tokenVersion: 0, createdAt: Date.now(), orgId, wardId
    });
    await mkUser('u1', 'o1', 'w1');
    await mkUser('u2', 'o1', 'w1', 'member', false);
    await mkUser('u3', 'o1', null, 'admin');
    await mkUser('ux', 'o2', null, 'admin');
    const put = (id, wardId, status, updatedAt, deleted = 0) => store.upsertPatient(
      id, updatedAt, deleted, JSON.stringify({ id, wardId, status, updatedAt })
    );
    await put('p1', 'w1', 'postop', 1000);
    await put('p2', 'w1', 'postop', 3000);
    await put('p3', 'w1', 'preop', 2000);
    await put('p4', 'w2', 'conservative', 500);
    await put('p5', 'w1', 'postop', 4000, 1);          // deleted — excluded
    await put('p6', undefined, 'postop', 100);          // unassigned — org counts exclude it
    await put('p7', 'w1', 'weird-status', 50);          // counted live, no bucket
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('buildOrgTree computes totals, per-department stats, lastActivity', async () => {
    const tree = await buildOrgTree(store, 'o1');
    assert.deepEqual(tree.totals, {
      hospitals: 1, departments: 2, usersActive: 2, usersDisabled: 1, livePatients: 5
    });
    const w1 = tree.hospitals[0].wards.find(w => w.id === 'w1');
    assert.deepEqual(w1.stats, {
      livePatients: 4,
      byStatus: { postop: 2, preop: 1, conservative: 0, fordischarge: 0 },
      users: 2,
      lastActivity: 3000
    });
    const w2 = tree.hospitals[0].wards.find(w => w.id === 'w2');
    assert.equal(w2.stats.livePatients, 1);
    assert.equal(w2.stats.lastActivity, 500);
    assert.equal(w2.stats.users, 0);
  });

  test('empty org tree is well-formed', async () => {
    await store.createOrganization({ id: 'o3', name: 'Empty', plan: 'free' });
    const tree = await buildOrgTree(store, 'o3');
    assert.deepEqual(tree.totals, { hospitals: 0, departments: 0, usersActive: 0, usersDisabled: 0, livePatients: 0 });
    assert.deepEqual(tree.hospitals, []);
  });

  test('buildOrgRollups summarizes every org', async () => {
    const rollups = await buildOrgRollups(store);
    const o1 = rollups.find(r => r.id === 'o1');
    assert.deepEqual(o1.stats, { hospitals: 1, departments: 2, users: 3, livePatients: 5 });
    assert.equal(o1.plan, 'free');
    const o2 = rollups.find(r => r.id === 'o2');
    assert.deepEqual(o2.stats, { hospitals: 0, departments: 0, users: 1, livePatients: 0 });
  });
});
```

Note on `usersDisabled`/`users` semantics: tree `totals.usersActive/usersDisabled` split by `active`; per-ward `stats.users` counts ALL users assigned to that ward (active or not — u1+u2 = 2); rollup `stats.users` counts all org users. `livePatients` (org totals and rollups) counts live patients in the org's wards ONLY (p6 unassigned is excluded; `w1:4 + w2:1 = 5`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/admin.test.js`
Expected: FAIL — `Cannot find module '../admin.js'`.

- [ ] **Step 3: Implement `admin.js`**

```js
/* Pure builders for the MULTI_TENANT admin console: org tree + stats.
   Stats are computed app-layer from getActive() + patient JSON (wardId,
   status) — same pattern as the sync scope filter; no schema changes.
   See docs/superpowers/specs/2026-07-22-admin-console-design.md. */

const STATUS_BUCKETS = ['postop', 'preop', 'conservative', 'fordischarge'];

function parseLivePatients(rows){
  const out = [];
  for(const row of rows){
    try{
      const obj = JSON.parse(row.data);
      out.push({ wardId: obj?.wardId, status: obj?.status, updatedAt: row.updatedAt });
    }catch{ /* malformed row — skip */ }
  }
  return out;
}

function emptyWardStats(){
  const byStatus = {};
  for(const s of STATUS_BUCKETS) byStatus[s] = 0;
  return { livePatients: 0, byStatus, users: 0, lastActivity: null };
}

export async function buildOrgTree(store, orgId){
  const hospitals = await store.listHospitalsByOrg(orgId);
  const users = await store.listUsersByOrg(orgId);
  const patients = parseLivePatients(await store.getActive());

  const outHospitals = [];
  const wardStats = new Map(); // wardId -> stats object (shared with output)
  for(const h of hospitals){
    const wards = await store.listWardsByHospital(h.id);
    outHospitals.push({
      id: h.id, name: h.name,
      wards: wards.map(w => {
        const stats = emptyWardStats();
        wardStats.set(w.id, stats);
        return { id: w.id, name: w.name, specialty: w.specialty, stats };
      })
    });
  }

  for(const u of users){
    const stats = u.wardId ? wardStats.get(u.wardId) : null;
    if(stats) stats.users++;
  }

  let livePatients = 0;
  for(const p of patients){
    const stats = p.wardId ? wardStats.get(p.wardId) : null;
    if(!stats) continue; // other orgs' wards or unassigned
    livePatients++;
    stats.livePatients++;
    if(STATUS_BUCKETS.includes(p.status)) stats.byStatus[p.status]++;
    if(stats.lastActivity === null || p.updatedAt > stats.lastActivity) stats.lastActivity = p.updatedAt;
  }

  let departments = 0;
  for(const h of outHospitals) departments += h.wards.length;

  return {
    totals: {
      hospitals: outHospitals.length,
      departments,
      usersActive: users.filter(u => !!u.active).length,
      usersDisabled: users.filter(u => !u.active).length,
      livePatients
    },
    hospitals: outHospitals
  };
}

export async function buildOrgRollups(store){
  const orgs = await store.listOrganizations();
  const out = [];
  for(const org of orgs){
    const tree = await buildOrgTree(store, org.id);
    out.push({
      id: org.id, name: org.name, plan: org.plan, createdAt: org.createdAt,
      stats: {
        hospitals: tree.totals.hospitals,
        departments: tree.totals.departments,
        users: tree.totals.usersActive + tree.totals.usersDisabled,
        livePatients: tree.totals.livePatients
      }
    });
  }
  return out;
}
```

Note: SQLite `active` column comes back as 0/1 — `!!u.active` / `!u.active` handles both backends.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/admin.test.js` → PASS.

- [ ] **Step 5: Full suite, commit**

```bash
git add admin.js tests/admin.test.js
git commit -m "feat: admin.js pure org tree + stats builders"
```

---

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

### Task 5: Admin view UI (flag-gated)

**Files:**
- Modify: `public/index.html` — Admin view container + styles + menu entries (next to Manage Users entries)
- Modify: `public/app.js` — flag fetch, login scope storage, Admin view render/wiring
- Test: `tests/frontend-admin-view.test.js` (new, jsdom)

**Interfaces:**
- Consumes: `GET /api/admin/org`, `GET /api/admin/users`, `POST` hospitals/wards/users/assign/orgs (Task 4 shapes); `api()` helper; `formatRelativeTime`, `escapeHTML`, `showToast`.
- Produces: window-visible functions for tests: `openAdminView()`, `closeAdminView()`, `renderAdminView(tree, users)`, `renderAdminOrgsTab(orgs)`, `adminUiVisible()`.

- [ ] **Step 1: Write the failing tests**

Create `tests/frontend-admin-view.test.js` (follow `loadFrontendEnv` patterns from tests/frontend-worklist.test.js):

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

const TREE = {
  totals: { hospitals: 1, departments: 2, usersActive: 3, usersDisabled: 1, livePatients: 7 },
  hospitals: [{ id: 'h1', name: 'City Hospital', wards: [
    { id: 'w1', name: 'Ortho', specialty: 'ortho',
      stats: { livePatients: 5, byStatus: { postop: 3, preop: 1, conservative: 1, fordischarge: 0 }, users: 2, lastActivity: Date.now() - 60000 } },
    { id: 'w2', name: 'Surgery', specialty: 'surgery',
      stats: { livePatients: 2, byStatus: { postop: 2, preop: 0, conservative: 0, fordischarge: 0 }, users: 1, lastActivity: null } }
  ]}]
};
const USERS = [
  { id: 'u1', username: 'boss', role: 'admin', active: true, createdAt: 1, wardId: null, orgId: 'o1' },
  { id: 'u2', username: 'pg9', role: 'member', active: true, createdAt: 2, wardId: 'w1', orgId: 'o1' }
];

describe('admin view rendering', () => {
  test('adminUiVisible: only admin + MULTI_TENANT flag', () => {
    const { window } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.serverFlags = { MULTI_TENANT: true };
    assert.equal(window.adminUiVisible(), true);
    window.serverFlags = { MULTI_TENANT: false };
    assert.equal(window.adminUiVisible(), false);
    window.localStorage.setItem('ortho_role', 'member');
    window.serverFlags = { MULTI_TENANT: true };
    assert.equal(window.adminUiVisible(), false);
  });

  test('renderAdminView paints stat tiles, department cards, user rows', () => {
    const { window, document } = loadFrontendEnv();
    window.renderAdminView(TREE, USERS);
    const tiles = [...document.querySelectorAll('#adminStatTiles .admin-stat-tile')];
    assert.equal(tiles.length, 4);
    const tileText = tiles.map(t => t.textContent).join(' ');
    assert.match(tileText, /2/);  // departments
    assert.match(tileText, /3/);  // active users
    assert.match(tileText, /7/);  // live patients
    assert.match(tileText, /5/);  // post-op (3+2)
    const cards = document.querySelectorAll('#adminOrgSection .admin-dept-card');
    assert.equal(cards.length, 2);
    assert.match(cards[0].textContent, /Ortho/);
    assert.ok(cards[0].querySelector('.admin-status-bar'), 'department card has a status bar');
    const rows = document.querySelectorAll('#adminUsersSection tbody tr');
    assert.equal(rows.length, 2);
    const sel = rows[1].querySelector('select[data-assign-user="u2"]');
    assert.ok(sel, 'member row has an assign select');
    assert.equal(sel.value, 'w1');
  });

  test('assign select fires the assign endpoint', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return { ok: true }; };
    window.renderAdminView(TREE, USERS);
    const sel = document.querySelector('select[data-assign-user="u2"]');
    sel.value = 'w2';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/admin/users/u2/assign');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { wardId: 'w2' });
  });

  test('orgs tab renders rollup cards (instance admin surface)', () => {
    const { window, document } = loadFrontendEnv();
    window.renderAdminOrgsTab([
      { id: 'o1', name: 'Pilot Org', plan: 'free', createdAt: 1, stats: { hospitals: 1, departments: 2, users: 4, livePatients: 7 } }
    ]);
    const cards = document.querySelectorAll('#adminOrgsTab .admin-org-card');
    assert.equal(cards.length, 1);
    assert.match(cards[0].textContent, /Pilot Org/);
    assert.match(cards[0].textContent, /7/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend-admin-view.test.js`
Expected: FAIL — `adminUiVisible` / containers undefined.

- [ ] **Step 3: Implement**

**`public/index.html`** — three additions:

1. Menu entries: next to `moreManageUsersBtn` add `<button class="menu-item" id="moreAdminBtn" style="display:none">🏥 Admin console</button>`; next to `desktopManageUsersBtn` add the same with id `desktopAdminBtn`.

2. View container (before the presentation overlay div):

```html
<!-- ADMIN CONSOLE (MULTI_TENANT admins only) -->
<div class="admin-view" id="adminView" hidden>
  <div class="admin-view-header">
    <button class="btn" id="adminViewClose">← Back</button>
    <h2 id="adminViewTitle">Admin console</h2>
    <div class="admin-tabs" id="adminTabs" style="display:none">
      <button class="btn admin-tab active" data-admin-tab="org">Organization</button>
      <button class="btn admin-tab" data-admin-tab="orgs">Organizations</button>
    </div>
  </div>
  <div id="adminOrgPane">
    <div class="admin-stat-tiles" id="adminStatTiles"></div>
    <div id="adminOrgSection"></div>
    <div id="adminUsersSection"></div>
  </div>
  <div id="adminOrgsTab" style="display:none"></div>
</div>
```

3. Styles (near the presentation styles, using existing tokens only):

```css
.admin-view{position:fixed;inset:0;z-index:60;background:var(--bg);overflow-y:auto;padding:16px;}
.admin-view[hidden]{display:none;}
.admin-view-header{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;}
.admin-stat-tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:18px;}
@media (min-width:720px){.admin-stat-tiles{grid-template-columns:repeat(4,1fr);}}
.admin-stat-tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center;}
.admin-stat-tile .n{font-size:28px;font-weight:700;color:var(--ink);}
.admin-stat-tile .l{font-size:12px;color:var(--muted);margin-top:2px;}
.admin-hospital-group{margin-bottom:18px;}
.admin-hospital-group h3{margin:0 0 8px;display:flex;align-items:center;gap:8px;}
.admin-dept-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;}
.admin-dept-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;}
.admin-dept-card .spec-badge{font-size:11px;border:1px solid var(--line);border-radius:10px;padding:1px 8px;color:var(--muted);}
.admin-status-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--line);margin:8px 0;}
.admin-status-bar span{display:block;height:100%;}
.admin-inline-form{display:flex;gap:6px;margin-top:8px;}
.admin-inline-form input{flex:1;min-width:0;}
.admin-users-table{width:100%;border-collapse:collapse;}
.admin-users-table th,.admin-users-table td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;font-size:14px;}
.admin-org-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:10px;}
```

Status-bar segment colors: reuse the app's existing status color variables (grep `postop` in index.html styles for the exact custom-property names and use those; if statuses are colored via classes, reuse those class colors with inline `background`).

**`public/app.js`** — additions (place the admin-view block near the presentation-mode code; helpers at top-level so jsdom sees them):

```js
/* ---------------- admin console (MULTI_TENANT) ---------------- */

var serverFlags = {}; // populated from /api/health at startup and login
const LS_ORG_ID = 'ortho_org_id';

function adminUiVisible(){
  return isAdmin() && !!(serverFlags && serverFlags.MULTI_TENANT);
}

function isInstanceAdminUser(){
  return isAdmin() && !localStorage.getItem(LS_ORG_ID);
}

async function refreshServerFlags(){
  try{
    const res = await fetch('/api/health');
    const data = await res.json();
    serverFlags = data.flags || {};
  }catch{ /* offline — leave as-is */ }
  updateAccountUI();
}

function renderAdminStatTiles(tree){
  const postop = tree.hospitals.flatMap(h => h.wards).reduce((n, w) => n + (w.stats.byStatus.postop || 0), 0);
  const tiles = [
    { n: tree.totals.departments, l: 'Departments' },
    { n: tree.totals.usersActive, l: 'Active users' },
    { n: tree.totals.livePatients, l: 'Live patients' },
    { n: postop, l: 'Post-op' }
  ];
  return tiles.map(t => `<div class="admin-stat-tile"><div class="n">${t.n}</div><div class="l">${t.l}</div></div>`).join('');
}

function renderAdminStatusBar(byStatus, total){
  if(!total) return '<div class="admin-status-bar"></div>';
  const seg = (n, color) => n ? `<span style="width:${(n / total) * 100}%;background:${color}"></span>` : '';
  return `<div class="admin-status-bar">${
    seg(byStatus.postop, 'var(--ok, #2e7d32)')}${
    seg(byStatus.preop, 'var(--warn, #f9a825)')}${
    seg(byStatus.conservative, 'var(--muted, #90a4ae)')}${
    seg(byStatus.fordischarge, 'var(--accent, #1565c0)')}</div>`;
}

function renderAdminOrgSectionHTML(tree){
  const groups = tree.hospitals.map(h => `
    <div class="admin-hospital-group" data-hospital-id="${escapeHTML(h.id)}">
      <h3>${escapeHTML(h.name)}</h3>
      <div class="admin-dept-grid">
        ${h.wards.map(w => `
          <div class="admin-dept-card" data-ward-id="${escapeHTML(w.id)}">
            <strong>${escapeHTML(w.name)}</strong> <span class="spec-badge">${escapeHTML(w.specialty || '')}</span>
            <div class="small-muted">${w.stats.livePatients} live patient${w.stats.livePatients === 1 ? '' : 's'} · ${w.stats.users} user${w.stats.users === 1 ? '' : 's'}</div>
            ${renderAdminStatusBar(w.stats.byStatus, w.stats.livePatients)}
            <div class="small-muted">${w.stats.lastActivity ? 'Active ' + formatRelativeTime(w.stats.lastActivity) : 'No activity yet'}</div>
          </div>`).join('')}
      </div>
      <div class="admin-inline-form">
        <input placeholder="New department name" data-new-ward-name="${escapeHTML(h.id)}">
        <button class="btn" data-add-ward="${escapeHTML(h.id)}">Add department</button>
      </div>
    </div>`).join('');
  return `<h3>Organization</h3>${groups || '<div class="small-muted">No hospitals yet — add the first one.</div>'}
    <div class="admin-inline-form">
      <input placeholder="New hospital name" id="adminNewHospitalName">
      <button class="btn" id="adminAddHospitalBtn">Add hospital</button>
    </div>`;
}

function renderAdminUsersSectionHTML(tree, users){
  const wardOptions = tree.hospitals.flatMap(h => h.wards.map(w => ({ id: w.id, label: `${w.name} (${h.name})` })));
  const opts = (sel) => `<option value="">— none —</option>` + wardOptions.map(w =>
    `<option value="${escapeHTML(w.id)}" ${w.id === sel ? 'selected' : ''}>${escapeHTML(w.label)}</option>`).join('');
  const rows = users.map(u => `
    <tr>
      <td>${escapeHTML(u.username)}</td>
      <td>${u.role === 'admin' ? '<span class="spec-badge">admin</span>' : 'member'}</td>
      <td><select data-assign-user="${escapeHTML(u.id)}">${opts(u.wardId)}</select></td>
      <td>${u.active ? 'active' : 'disabled'}</td>
    </tr>`).join('');
  return `<h3>Users</h3><table class="admin-users-table">
    <thead><tr><th>User</th><th>Role</th><th>Department</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderAdminView(tree, users){
  document.getElementById('adminStatTiles').innerHTML = renderAdminStatTiles(tree);
  document.getElementById('adminOrgSection').innerHTML = renderAdminOrgSectionHTML(tree);
  document.getElementById('adminUsersSection').innerHTML = renderAdminUsersSectionHTML(tree, users);
}

function renderAdminOrgsTab(orgs){
  const el = document.getElementById('adminOrgsTab');
  el.innerHTML = `<h3>Organizations</h3>` + orgs.map(o => `
    <div class="admin-org-card" data-org-id="${escapeHTML(o.id)}">
      <strong>${escapeHTML(o.name)}</strong> <span class="spec-badge">${escapeHTML(o.plan)}</span>
      <div class="small-muted">${o.stats.hospitals} hospitals · ${o.stats.departments} departments · ${o.stats.users} users · ${o.stats.livePatients} live patients</div>
      <div class="admin-inline-form">
        <input placeholder="New org admin username" data-new-org-admin="${escapeHTML(o.id)}">
        <button class="btn" data-create-org-admin="${escapeHTML(o.id)}">Create org admin</button>
        <button class="btn" data-view-org="${escapeHTML(o.id)}">View</button>
      </div>
    </div>`).join('') + `
    <div class="admin-inline-form">
      <input placeholder="New organization name" id="adminNewOrgName">
      <button class="btn" id="adminAddOrgBtn">Create organization</button>
    </div>`;
}

let adminViewOrgId = null; // instance admin: which org's tree is loaded

async function loadAdminView(){
  const qs = isInstanceAdminUser() && adminViewOrgId ? `?orgId=${encodeURIComponent(adminViewOrgId)}` : '';
  if(isInstanceAdminUser() && !adminViewOrgId){
    document.getElementById('adminTabs').style.display = '';
    switchAdminTab('orgs');
    renderAdminOrgsTab((await api('/api/admin/orgs')).orgs);
    return;
  }
  const [tree, usersRes] = await Promise.all([api('/api/admin/org' + qs), api('/api/admin/users')]);
  let users = usersRes.users;
  if(isInstanceAdminUser() && adminViewOrgId) users = users.filter(u => u.orgId === adminViewOrgId);
  renderAdminView(tree, users);
}

function switchAdminTab(tab){
  document.getElementById('adminOrgPane').style.display = tab === 'org' ? '' : 'none';
  document.getElementById('adminOrgsTab').style.display = tab === 'orgs' ? '' : 'none';
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.toggle('active', b.dataset.adminTab === tab));
}

function openAdminView(){
  document.getElementById('adminView').hidden = false;
  adminViewOrgId = null;
  for(const id of ['adminStatTiles', 'adminOrgSection', 'adminUsersSection']){
    const el = document.getElementById(id);
    if(el) el.innerHTML = '<div class="small-muted">Loading…</div>';
  }
  loadAdminView().catch(err => showToast(err.message || 'Could not load admin data'));
}

function closeAdminView(){
  document.getElementById('adminView').hidden = true;
}
```

Wiring (inside the existing page-init / static-bindings function, plus one delegated handler):

```js
  document.getElementById('adminViewClose')?.addEventListener('click', closeAdminView);
  document.getElementById('moreAdminBtn')?.addEventListener('click', openAdminView);
  document.getElementById('desktopAdminBtn')?.addEventListener('click', openAdminView);
  document.getElementById('adminView')?.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-admin-tab]');
    if(tab){ switchAdminTab(tab.dataset.adminTab); return; }
    const addHosp = e.target.closest('#adminAddHospitalBtn');
    if(addHosp){
      const name = document.getElementById('adminNewHospitalName')?.value.trim();
      if(!name) return;
      const body = isInstanceAdminUser() && adminViewOrgId ? { name, orgId: adminViewOrgId } : { name };
      try{ await api('/api/admin/hospitals', { method: 'POST', body: JSON.stringify(body) }); await loadAdminView(); }
      catch(err){ showToast(err.message); }
      return;
    }
    const addWard = e.target.closest('[data-add-ward]');
    if(addWard){
      const hid = addWard.dataset.addWard;
      const input = document.querySelector(`[data-new-ward-name="${hid}"]`);
      const name = input?.value.trim();
      if(!name) return;
      try{ await api('/api/admin/wards', { method: 'POST', body: JSON.stringify({ hospitalId: hid, name }) }); await loadAdminView(); }
      catch(err){ showToast(err.message); }
      return;
    }
    const addOrg = e.target.closest('#adminAddOrgBtn');
    if(addOrg){
      const name = document.getElementById('adminNewOrgName')?.value.trim();
      if(!name) return;
      try{ await api('/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name }) }); await loadAdminView(); }
      catch(err){ showToast(err.message); }
      return;
    }
    const mkAdmin = e.target.closest('[data-create-org-admin]');
    if(mkAdmin){
      const oid = mkAdmin.dataset.createOrgAdmin;
      const input = document.querySelector(`[data-new-org-admin="${oid}"]`);
      const username = input?.value.trim();
      if(!username) return;
      try{
        const r = await api(`/api/admin/orgs/${oid}/admin`, { method: 'POST', body: JSON.stringify({ username }) });
        await showConfirm('Org admin created', `Temporary password for ${r.username}: ${r.temporaryPassword}\nIt is not shown again.`, { confirmLabel: 'Done' });
        await loadAdminView();
      }catch(err){ showToast(err.message); }
      return;
    }
    const viewOrg = e.target.closest('[data-view-org]');
    if(viewOrg){ adminViewOrgId = viewOrg.dataset.viewOrg; switchAdminTab('org'); loadAdminView().catch(err => showToast(err.message)); return; }
  });
  document.getElementById('adminView')?.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-assign-user]');
    if(!sel) return;
    try{
      await api(`/api/admin/users/${sel.dataset.assignUser}/assign`, { method: 'POST', body: JSON.stringify({ wardId: sel.value || null }) });
      showToast('Department updated');
    }catch(err){ showToast(err.message); }
  });
```

Integration points (each is a small addition to an existing function — find by the anchors given):

- Login success handler (~app.js:1964, where LS_ROLE is set): also `localStorage.setItem(LS_ORG_ID, data.orgId || '');` (empty string for null) and call `refreshServerFlags()`.
- Logout (~app.js:1979): `localStorage.removeItem(LS_ORG_ID);`
- `updateAccountUI()` (~app.js:3589): alongside each Manage-Users button toggle, add `const adminBtn = document.getElementById('moreAdminBtn'); if(adminBtn) adminBtn.style.display = adminUiVisible() ? '' : 'none';` (and the desktop twin).
- Page init: call `refreshServerFlags()` once (non-blocking, `void`).
- The assign `change` listener above must NOT be inside a flag check — the whole view is unreachable flag-off (buttons hidden, view `hidden`), keeping wiring simple.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend-admin-view.test.js` → PASS. Also `npm test -- tests/frontend-worklist.test.js tests/frontend-lab-photo-extraction.test.js` (no init regressions).

- [ ] **Step 5: Full suite, commit**

```bash
git add public/index.html public/app.js tests/frontend-admin-view.test.js
git commit -m "feat: flag-gated Admin console view (stats, org tree, users, orgs tab)"
```

---

### Task 6: Flag-off UI/route goldens + docs tick + full verification

**Files:**
- Modify: `tests/frontend-admin-view.test.js` (flag-off UI assertions), `ROADMAP.md`, `DESIGN-multitenant.md`
- Test: full suite

- [ ] **Step 1: Add flag-off UI test**

Append to `tests/frontend-admin-view.test.js`:

```js
describe('flag OFF — zero admin UI', () => {
  test('admin entries stay hidden even for admins', () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.serverFlags = {};
    window.updateAccountUI();
    const btn = document.getElementById('moreAdminBtn');
    assert.ok(btn, 'button exists in DOM');
    assert.equal(btn.style.display, 'none');
    assert.equal(document.getElementById('adminView').hidden, true);
  });
});
```

Run: `npm test -- tests/frontend-admin-view.test.js` → PASS (if it fails, fix the `updateAccountUI` wiring, not the test).

- [ ] **Step 2: Docs**

- `ROADMAP.md` Phase 1 checklist: add `- [x] Org/department admin console + provisioning (shipped 2026-07-22 — see docs/superpowers/specs/2026-07-22-admin-console-design.md)` after the auth/sync scoping line.
- `DESIGN-multitenant.md`: mark "Org/ward admin console" item 3 done (`✅ done — 2026-07-22`); note the bootstrapAdmin self-heal under the rollout plan.

- [ ] **Step 3: Full suite + flag-off goldens**

Run: `npm test` — all pass. Confirm `tests/server-sync-golden.test.js` and the flag-off describe in `tests/server-admin-console.test.js` are green (these are the byte-identical guards).

- [ ] **Step 4: Commit**

```bash
git add tests/frontend-admin-view.test.js ROADMAP.md DESIGN-multitenant.md
git commit -m "chore: flag-off admin-UI golden, roadmap tick for admin console"
```
