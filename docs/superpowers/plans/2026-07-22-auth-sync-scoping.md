# Phase 1: Auth + Sync Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire auth and `/api/sync` to the org→hospital→department hierarchy behind the `MULTI_TENANT` flag, with flag-off behavior byte-identical to today.

**Architecture:** All scoping decisions live in a new pure module `scope.js` (resolve actor scope, read filter, write decision), unit-tested exhaustively. `server.js` wiring is wrap-only: guards and additions around existing statements, never restructuring them. Route-level behavior is proven by a new integration harness that spawns the real server as a child process on a temp SQLite dir, seeded directly through `storage.js` before boot (there is no runtime ward-assignment endpoint yet — the admin console is a later pass).

**Tech Stack:** Node 22 (global `fetch`), `node --test`, better-sqlite3 via existing `storage.js`, child_process spawn.

**Spec:** `docs/superpowers/specs/2026-07-22-auth-sync-scoping-design.md`

## Global Constraints

- Flag off (`ORTHO_FLAG_MULTI_TENANT` unset): behavior byte-identical to today; full existing suite passes unchanged.
- **Wrap-only rule for the sync handler:** new logic wraps around existing statements (guards/additions only); existing lines are not moved or restructured. This is a review gate.
- Access model: member sees own department (`wardId`) only; member with `wardId NULL` sees/writes nothing; org admin (`role==='admin'`, `orgId` set) sees all wards under `listHospitalsByOrg(orgId)`→`listWardsByHospital(...)`; instance admin (`role==='admin'`, `orgId NULL`) unrestricted.
- Unassigned patients (no `wardId` in JSON) visible to instance admins ONLY (org admins would leak across orgs).
- Members can never change a stored patient's `wardId` (stored wins). Org admins may set it within scope; out-of-scope incoming `wardId` on create → skip; org admin creating with no incoming `wardId` falls back to own `wardId` else skip; instance admin may create unassigned.
- Out-of-scope sync writes are silently skipped (same shape as existing LWW losers) — no error, no contract change.
- Token claims unchanged (`sub`, `username`, `tokenVersion`). Login response additively gains `orgId`/`wardId` (null when unset) with the flag both on and off.
- `/api/backup`, `/api/import`, `/api/export`: flag on → instance-admin only (403 otherwise); flag off → unchanged.
- `SYNC_API_VERSION` is the number `1` (server.js:87); sync response top-level keys are exactly `serverTime`, `patients`, `apiVersion`.
- Tests: `npm test` (node --test). Integration tests spawn `node server.js` with env `PORT`, `ORTHO_DATA_DIR`, `ORTHO_ADMIN_USERNAME`, `ORTHO_ADMIN_PASSWORD`, optionally `ORTHO_FLAG_MULTI_TENANT=1`.
- Git quirk: stale `.git/*.lock` ("File exists") → `rm -f` that lock, retry once.

---

### Task 1: `scope.js` — pure scoping logic

**Files:**
- Create: `scope.js` (repo root, ESM, same style as `flags.js`/`merge.js`)
- Test: `tests/scope.test.js`

**Interfaces:**
- Consumes: `store.listHospitalsByOrg(orgId)`, `store.listWardsByHospital(hospitalId)` (existing storage CRUD; only called for org admins).
- Produces (later tasks rely on these exact signatures):
  - `resolveScope(actor, store) -> Promise<Scope>` where `actor = {id, username, role, orgId, wardId}` and `Scope = { unrestricted: boolean, wardIds: Set<string>, includeUnassigned: boolean }`
  - `canRead(patient, scope) -> boolean`
  - `decideWrite({ incoming, existing, actor, scope }) -> { allow: boolean, wardId?: string|null }` — `wardId === undefined` means "leave the merged record's wardId alone"; any other value (including `null`) is forced onto the stored record.

- [ ] **Step 1: Write the failing tests**

Create `tests/scope.test.js`:

```js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';
import { resolveScope, canRead, decideWrite } from '../scope.js';

const member = (wardId, orgId = 'org1') => ({ id: 'u1', username: 'pg1', role: 'member', orgId, wardId });
const orgAdmin = (orgId = 'org1') => ({ id: 'a1', username: 'boss', role: 'admin', orgId, wardId: null });
const instanceAdmin = () => ({ id: 'root', username: 'root', role: 'admin', orgId: null, wardId: null });

describe('resolveScope', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-scope-'));
    store = await createStore({ dataDir });
    await store.init();
    await store.createOrganization({ id: 'org1', name: 'Org One', plan: 'free' });
    await store.createOrganization({ id: 'org2', name: 'Org Two', plan: 'free' });
    await store.createHospital({ id: 'h1', orgId: 'org1', name: 'H1' });
    await store.createHospital({ id: 'h2', orgId: 'org1', name: 'H2' });
    await store.createHospital({ id: 'hx', orgId: 'org2', name: 'HX' });
    await store.createWard({ id: 'w1', hospitalId: 'h1', name: 'Ortho' });
    await store.createWard({ id: 'w2', hospitalId: 'h2', name: 'Surgery' });
    await store.createWard({ id: 'wx', hospitalId: 'hx', name: 'Other-org ward' });
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('member with ward: exactly that ward, no unassigned', async () => {
    const s = await resolveScope(member('w1'), store);
    assert.equal(s.unrestricted, false);
    assert.deepEqual([...s.wardIds], ['w1']);
    assert.equal(s.includeUnassigned, false);
  });

  test('member with no ward: empty scope (strict deny)', async () => {
    const s = await resolveScope(member(null), store);
    assert.equal(s.unrestricted, false);
    assert.equal(s.wardIds.size, 0);
    assert.equal(s.includeUnassigned, false);
  });

  test('org admin: all wards under all org hospitals, never other orgs, no unassigned', async () => {
    const s = await resolveScope(orgAdmin(), store);
    assert.equal(s.unrestricted, false);
    assert.deepEqual([...s.wardIds].sort(), ['w1', 'w2']);
    assert.equal(s.includeUnassigned, false);
  });

  test('org admin of empty org: empty scope', async () => {
    await store.createOrganization({ id: 'org3', name: 'Empty', plan: 'free' });
    const s = await resolveScope(orgAdmin('org3'), store);
    assert.equal(s.wardIds.size, 0);
  });

  test('instance admin: unrestricted incl. unassigned', async () => {
    const s = await resolveScope(instanceAdmin(), store);
    assert.equal(s.unrestricted, true);
    assert.equal(s.includeUnassigned, true);
  });
});

describe('canRead', () => {
  const memberScope = { unrestricted: false, wardIds: new Set(['w1']), includeUnassigned: false };
  const rootScope = { unrestricted: true, wardIds: new Set(), includeUnassigned: true };

  test('member reads own-ward patient only', () => {
    assert.equal(canRead({ id: 'p1', wardId: 'w1' }, memberScope), true);
    assert.equal(canRead({ id: 'p2', wardId: 'w2' }, memberScope), false);
  });
  test('unassigned patient: instance admin only', () => {
    assert.equal(canRead({ id: 'p3' }, memberScope), false);
    assert.equal(canRead({ id: 'p3' }, rootScope), true);
  });
  test('unrestricted reads everything', () => {
    assert.equal(canRead({ id: 'p4', wardId: 'anything' }, rootScope), true);
  });
});

describe('decideWrite', () => {
  const mScope = { unrestricted: false, wardIds: new Set(['w1']), includeUnassigned: false };
  const oScope = { unrestricted: false, wardIds: new Set(['w1', 'w2']), includeUnassigned: false };
  const rScope = { unrestricted: true, wardIds: new Set(), includeUnassigned: true };

  test('member creates: stamped with own ward', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: null, actor: member('w1'), scope: mScope });
    assert.deepEqual(d, { allow: true, wardId: 'w1' });
  });
  test('member with no ward cannot create', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: null, actor: member(null), scope: { unrestricted: false, wardIds: new Set(), includeUnassigned: false } });
    assert.equal(d.allow, false);
  });
  test('member updates own-ward patient; stored wardId wins over incoming', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'w2' }, existing: { id: 'p', wardId: 'w1' }, actor: member('w1'), scope: mScope });
    assert.deepEqual(d, { allow: true, wardId: 'w1' });
  });
  test('member cannot touch out-of-scope patient', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: { id: 'p', wardId: 'w2' }, actor: member('w1'), scope: mScope });
    assert.equal(d.allow, false);
  });
  test('member cannot touch unassigned patient', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: { id: 'p' }, actor: member('w1'), scope: mScope });
    assert.equal(d.allow, false);
  });
  test('org admin creates with in-scope incoming ward', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'w2' }, existing: null, actor: orgAdmin(), scope: oScope });
    assert.deepEqual(d, { allow: true, wardId: 'w2' });
  });
  test('org admin create with out-of-scope ward is skipped', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'wx' }, existing: null, actor: orgAdmin(), scope: oScope });
    assert.equal(d.allow, false);
  });
  test('org admin create with no ward and no own ward is skipped', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: null, actor: orgAdmin(), scope: oScope });
    assert.equal(d.allow, false);
  });
  test('org admin create with no ward falls back to own ward', () => {
    const actor = { ...orgAdmin(), wardId: 'w1' };
    const d = decideWrite({ incoming: { id: 'p' }, existing: null, actor, scope: oScope });
    assert.deepEqual(d, { allow: true, wardId: 'w1' });
  });
  test('org admin may move patient within scope', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'w2' }, existing: { id: 'p', wardId: 'w1' }, actor: orgAdmin(), scope: oScope });
    assert.deepEqual(d, { allow: true, wardId: 'w2' });
  });
  test('org admin incoming out-of-scope ward on update keeps stored ward', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'wx' }, existing: { id: 'p', wardId: 'w1' }, actor: orgAdmin(), scope: oScope });
    assert.deepEqual(d, { allow: true, wardId: 'w1' });
  });
  test('instance admin creates unassigned', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: null, actor: instanceAdmin(), scope: rScope });
    assert.deepEqual(d, { allow: true, wardId: null });
  });
  test('instance admin keeps incoming ward on create', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'wx' }, existing: null, actor: instanceAdmin(), scope: rScope });
    assert.deepEqual(d, { allow: true, wardId: 'wx' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/scope.test.js`
Expected: FAIL — `Cannot find module '../scope.js'`.

- [ ] **Step 3: Implement `scope.js`**

```js
/* Pure scoping logic for MULTI_TENANT auth/sync (roadmap Phase 1).
   Terminology: the `wards` table entity is the DEPARTMENT (access boundary);
   patient `unit`/`ward` strings are metadata with no access semantics.
   See docs/superpowers/specs/2026-07-22-auth-sync-scoping-design.md. */

/** Resolve the set of departments an actor may read/write.
 *  Scope = { unrestricted, wardIds: Set, includeUnassigned }.
 *  Unassigned patients (no wardId) are instance-admin-only: an unassigned
 *  patient cannot be attributed to an org, so org admins never see them. */
export async function resolveScope(actor, store){
  const isAdmin = actor?.role === 'admin';
  if(isAdmin && !actor.orgId){
    return { unrestricted: true, wardIds: new Set(), includeUnassigned: true };
  }
  if(isAdmin){
    const wardIds = new Set();
    const hospitals = await store.listHospitalsByOrg(actor.orgId);
    for(const h of hospitals){
      for(const w of await store.listWardsByHospital(h.id)) wardIds.add(w.id);
    }
    return { unrestricted: false, wardIds, includeUnassigned: false };
  }
  const wardIds = new Set(actor?.wardId ? [actor.wardId] : []);
  return { unrestricted: false, wardIds, includeUnassigned: false };
}

export function canRead(patient, scope){
  if(scope.unrestricted) return true;
  if(!patient?.wardId) return scope.includeUnassigned;
  return scope.wardIds.has(patient.wardId);
}

/** Decide whether a sync write is allowed and which wardId the stored
 *  record must carry. wardId === undefined means "do not force a value". */
export function decideWrite({ incoming, existing, actor, scope }){
  const isAdmin = actor?.role === 'admin';

  if(existing){
    if(!canRead(existing, scope)) return { allow: false };
    if(!isAdmin) return { allow: true, wardId: existing.wardId ?? null };
    const requested = incoming?.wardId;
    if(requested && (scope.unrestricted || scope.wardIds.has(requested))){
      return { allow: true, wardId: requested };
    }
    return { allow: true, wardId: existing.wardId ?? null };
  }

  // New patient
  if(!isAdmin){
    if(!actor?.wardId) return { allow: false };
    return { allow: true, wardId: actor.wardId };
  }
  if(scope.unrestricted){
    return { allow: true, wardId: incoming?.wardId ?? null };
  }
  const requested = incoming?.wardId;
  if(requested) return scope.wardIds.has(requested) ? { allow: true, wardId: requested } : { allow: false };
  if(actor.wardId && scope.wardIds.has(actor.wardId)) return { allow: true, wardId: actor.wardId };
  return { allow: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/scope.test.js`
Expected: PASS (all).

- [ ] **Step 5: Run full suite, then commit**

Run: `npm test` — expected all pass (scope.js is not imported anywhere yet).

```bash
git add scope.js tests/scope.test.js
git commit -m "feat: pure department-scoping module (resolveScope/canRead/decideWrite)"
```

---

### Task 2: Integration harness + flag-off golden-response test

**Files:**
- Create: `tests/helpers/server-harness.js`
- Test: `tests/server-sync-golden.test.js`

**Interfaces:**
- Produces: `startServer({ multiTenant = false, seed = null }) -> Promise<{ baseUrl, dataDir, stop() }>`; `seed(store)` runs against the temp SQLite dir BEFORE the server boots (this is how tests create orgs/wards/users — there is no runtime assignment endpoint in this pass). Admin credentials are always `admin` / `test-admin-pass`. Helper `login(baseUrl, username, password) -> Promise<responseJson>` and `syncPost(baseUrl, token, body) -> Promise<{status, json}>`.
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the harness**

Create `tests/helpers/server-harness.js`:

```js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../../storage.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'test-admin-pass';

async function waitForHealth(baseUrl, child, timeoutMs = 15000){
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while(Date.now() < deadline){
    if(child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode})`);
    try{
      const res = await fetch(`${baseUrl}/api/health`);
      if(res.ok) return;
    }catch(err){ lastErr = err; }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`server did not become healthy: ${lastErr?.message}`);
}

/** Boot the real server on a temp SQLite dir. `seed(store)` runs before boot. */
export async function startServer({ multiTenant = false, seed = null } = {}){
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-it-'));
  if(seed){
    const store = await createStore({ dataDir });
    await store.init();
    try{ await seed(store); }
    finally{ await store.close(); }
  }
  const port = 3100 + Math.floor(Math.random() * 2500);
  const env = {
    ...process.env,
    PORT: String(port),
    ORTHO_DATA_DIR: dataDir,
    ORTHO_ADMIN_USERNAME: ADMIN_USERNAME,
    ORTHO_ADMIN_PASSWORD: ADMIN_PASSWORD
  };
  delete env.ORTHO_FLAG_MULTI_TENANT;
  if(multiTenant) env.ORTHO_FLAG_MULTI_TENANT = '1';
  const child = spawn(process.execPath, ['server.js'], { cwd: REPO_ROOT, env, stdio: 'ignore' });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);
  return {
    baseUrl,
    dataDir,
    async stop(){
      child.kill('SIGTERM');
      await new Promise(r => { child.once('exit', r); setTimeout(r, 2000).unref?.(); });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

export async function login(baseUrl, username = ADMIN_USERNAME, password = ADMIN_PASSWORD){
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return { status: res.status, json: await res.json() };
}

export async function syncPost(baseUrl, token, body){
  const res = await fetch(`${baseUrl}/api/sync/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}
```

- [ ] **Step 2: Write the golden-response test**

Create `tests/server-sync-golden.test.js`:

```js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, syncPost } from './helpers/server-harness.js';

/* Golden-response regression guard for the flag-OFF sync contract.
   Any accidental behavior drift in the /api/sync handler while wiring
   MULTI_TENANT scoping must fail here. */
describe('flag OFF — /api/sync golden response', () => {
  let srv, token;
  before(async () => {
    srv = await startServer({ multiTenant: false });
    const l = await login(srv.baseUrl);
    assert.equal(l.status, 200);
    token = l.json.token;
  });
  after(async () => { await srv.stop(); });

  test('push + pull round-trips a patient with the exact contract shape', async () => {
    const patient = {
      id: 'golden-p1', name: 'Golden Patient', diagnosis: 'Right femur shaft fracture',
      status: 'postop', unit: 'ortho unit - IV', ward: 'W-3', updatedAt: Date.now()
    };
    const push = await syncPost(srv.baseUrl, token, { since: 0, changes: [patient] });
    assert.equal(push.status, 200);
    assert.deepEqual(Object.keys(push.json).sort(), ['apiVersion', 'patients', 'serverTime']);
    assert.equal(push.json.apiVersion, 1);
    assert.equal(typeof push.json.serverTime, 'number');

    const pull = await syncPost(srv.baseUrl, token, { since: 0, changes: [] });
    assert.equal(pull.status, 200);
    const got = pull.json.patients.find(p => p.id === 'golden-p1');
    assert.ok(got, 'pushed patient must come back');
    assert.equal(got.name, 'Golden Patient');
    assert.equal(got.diagnosis, 'Right femur shaft fracture');
    assert.equal(got.unit, 'ortho unit - IV');
    assert.equal(got.ward, 'W-3');
    assert.equal(got.deleted, false);
    assert.equal(typeof got.updatedAt, 'number');
    // No scoping field is invented flag-off: the server must not add wardId.
    assert.equal('wardId' in got, false);
  });

  test('every user sees every patient (flat instance)', async () => {
    const pull = await syncPost(srv.baseUrl, token, { since: 0, changes: [] });
    assert.ok(pull.json.patients.some(p => p.id === 'golden-p1'));
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npm test -- tests/server-sync-golden.test.js`
Expected: PASS against the CURRENT server (this is the point — it locks today's behavior BEFORE any server.js edits; the harness and golden test must be green pre-wiring). If it fails, fix the harness, not the server.

- [ ] **Step 4: Run full suite, then commit**

Run: `npm test` — all pass.

```bash
git add tests/helpers/server-harness.js tests/server-sync-golden.test.js
git commit -m "test: integration harness + flag-off golden sync contract"
```

---

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

### Task 4: server.js — sync read filter + write enforcement (flag-gated, wrap-only)

**Files:**
- Modify: `server.js` — imports (~line 62 area), sync handler (~lines 389-427)
- Test: `tests/server-scoping.test.js`

**Interfaces:**
- Consumes: `resolveScope`, `canRead`, `decideWrite` from `scope.js` (Task 1 signatures); actor with `orgId`/`wardId` (Task 3); harness + `seedUser` pattern (Tasks 2-3).
- Produces: scoped `/api/sync` behavior per the Global Constraints table.

- [ ] **Step 1: Write the failing tests**

Create `tests/server-scoping.test.js`. Seed: two orgs — org1 (h1 → w1 ortho, w2 surgery) with member `pg1`@w1, member `pg2`@w2, org admin `boss1`, unassigned member `lost` (wardId null); org2 (hx → wx) with member `px`@wx. Copy the `seedUser` helper from Task 3's test verbatim (tests may be read out of order):

```js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../auth.js';
import { startServer, login, syncPost } from './helpers/server-harness.js';

function seedUser(store, { id, username, orgId = null, wardId = null, role = 'member' }){
  const salt = 'testsalt';
  return store.createUser({
    id, username, passwordSalt: salt, passwordHash: hashPassword('pw-' + username, salt),
    role, active: true, tokenVersion: 0, createdAt: Date.now(), orgId, wardId
  });
}

async function tok(baseUrl, username, password){
  const l = await login(baseUrl, username, password);
  assert.equal(l.status, 200, `login failed for ${username}`);
  return l.json.token;
}
const ids = (r) => r.json.patients.map(p => p.id).sort();

describe('MULTI_TENANT sync scoping', () => {
  let srv, tokens;
  before(async () => {
    srv = await startServer({
      multiTenant: true,
      seed: async (store) => {
        await store.createOrganization({ id: 'org1', name: 'Org1', plan: 'free' });
        await store.createOrganization({ id: 'org2', name: 'Org2', plan: 'free' });
        await store.createHospital({ id: 'h1', orgId: 'org1', name: 'H1' });
        await store.createHospital({ id: 'hx', orgId: 'org2', name: 'HX' });
        await store.createWard({ id: 'w1', hospitalId: 'h1', name: 'Ortho' });
        await store.createWard({ id: 'w2', hospitalId: 'h1', name: 'Surgery' });
        await store.createWard({ id: 'wx', hospitalId: 'hx', name: 'OtherOrg' });
        await seedUser(store, { id: 'u1', username: 'pg1', orgId: 'org1', wardId: 'w1' });
        await seedUser(store, { id: 'u2', username: 'pg2', orgId: 'org1', wardId: 'w2' });
        await seedUser(store, { id: 'u3', username: 'boss1', orgId: 'org1', role: 'admin' });
        await seedUser(store, { id: 'u4', username: 'lost', orgId: 'org1' });
        await seedUser(store, { id: 'u5', username: 'px', orgId: 'org2', wardId: 'wx' });
      }
    });
    tokens = {
      pg1: await tok(srv.baseUrl, 'pg1', 'pw-pg1'),
      pg2: await tok(srv.baseUrl, 'pg2', 'pw-pg2'),
      boss1: await tok(srv.baseUrl, 'boss1', 'pw-boss1'),
      lost: await tok(srv.baseUrl, 'lost', 'pw-lost'),
      px: await tok(srv.baseUrl, 'px', 'pw-px'),
      root: await tok(srv.baseUrl, 'admin', 'test-admin-pass')
    };
    // Each member creates one patient in their own department.
    for(const [who, id] of [['pg1', 'pat-w1'], ['pg2', 'pat-w2'], ['px', 'pat-wx']]){
      const r = await syncPost(srv.baseUrl, tokens[who], {
        since: 0, changes: [{ id, name: `Patient of ${who}`, updatedAt: Date.now() }]
      });
      assert.equal(r.status, 200);
    }
    // Instance admin creates an unassigned patient.
    const r = await syncPost(srv.baseUrl, tokens.root, {
      since: 0, changes: [{ id: 'pat-unassigned', name: 'Nobody', updatedAt: Date.now() }]
    });
    assert.equal(r.status, 200);
  });
  after(async () => { await srv.stop(); });

  test('new patients are stamped with the creator\'s department', async () => {
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    const p = r.json.patients.find(x => x.id === 'pat-w1');
    assert.equal(p.wardId, 'w1');
  });

  test('member reads only own department', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.pg1, { since: 0, changes: [] })), ['pat-w1']);
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.pg2, { since: 0, changes: [] })), ['pat-w2']);
  });

  test('unassigned member reads nothing and cannot create', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.lost, { since: 0, changes: [] })), []);
    await syncPost(srv.baseUrl, tokens.lost, { since: 0, changes: [{ id: 'pat-lost', name: 'X', updatedAt: Date.now() }] });
    const all = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    assert.equal(all.json.patients.some(p => p.id === 'pat-lost'), false);
  });

  test('org admin reads all org departments, not other orgs, not unassigned', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.boss1, { since: 0, changes: [] })), ['pat-w1', 'pat-w2']);
  });

  test('instance admin reads everything including unassigned', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] })), ['pat-unassigned', 'pat-w1', 'pat-w2', 'pat-wx']);
  });

  test('cross-org isolation is bidirectional', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.px, { since: 0, changes: [] })), ['pat-wx']);
    const boss = await syncPost(srv.baseUrl, tokens.boss1, { since: 0, changes: [] });
    assert.equal(boss.json.patients.some(p => p.id === 'pat-wx'), false);
  });

  test('out-of-scope write is silently skipped', async () => {
    const before = (await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] }))
      .json.patients.find(p => p.id === 'pat-w2');
    const r = await syncPost(srv.baseUrl, tokens.pg1, {
      since: 0, changes: [{ id: 'pat-w2', name: 'HIJACKED', updatedAt: Date.now() + 999999 }]
    });
    assert.equal(r.status, 200); // contract unchanged: no error
    const after = (await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] }))
      .json.patients.find(p => p.id === 'pat-w2');
    assert.equal(after.name, before.name);
  });

  test('member cannot move a patient across departments (stored wardId wins)', async () => {
    await syncPost(srv.baseUrl, tokens.pg1, {
      since: 0, changes: [{ id: 'pat-w1', name: 'Patient of pg1', wardId: 'w2', updatedAt: Date.now() + 5 }]
    });
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    assert.equal(r.json.patients.find(p => p.id === 'pat-w1').wardId, 'w1');
  });

  test('org admin can move a patient within org scope', async () => {
    await syncPost(srv.baseUrl, tokens.boss1, {
      since: 0, changes: [{ id: 'pat-w2', wardId: 'w1', name: 'Patient of pg2', updatedAt: Date.now() + 10 }]
    });
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    assert.equal(r.json.patients.find(p => p.id === 'pat-w2').wardId, 'w1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/server-scoping.test.js`
Expected: FAIL — members currently see every patient; no stamping happens.

- [ ] **Step 3: Implement (wrap-only) in `server.js`**

Add imports near the existing merge.js import:

```js
import { resolveScope, canRead, decideWrite } from './scope.js';
import { isEnabled } from './flags.js';
```

(If `isEnabled`/`listFlags` is already imported from flags.js at the top — it is, for `/api/health` — extend that existing import instead of adding a new line.)

In the sync handler, after `const now = Date.now();` add:

```js
    const scope = isEnabled('MULTI_TENANT') ? await resolveScope(actor, store) : null;
```

Inside the write loop, wrap around the existing statements. The existing body stays verbatim; additions are the `decision` guard before `stampAttribution` and the forced-`wardId` line after `stored` is computed:

```js
        let decision = null;
        if(scope){
          decision = decideWrite({ incoming: p, existing: existingObj, actor, scope });
          if(!decision.allow) continue;
        }
        stampAttribution(p, existingObj, actor);
        if(!existing || incomingUpdated >= existing.updatedAt){
          const stored = existingObj ? mergePatientRecords(p, existingObj) : Object.assign({}, p);
          if(decision && decision.wardId !== undefined){
            if(decision.wardId === null) delete stored.wardId;
            else stored.wardId = decision.wardId;
          }
          stored.updatedAt = now;
          await store.upsertPatient(p.id, now, p.deleted ? 1 : 0, JSON.stringify(stored));
        }
```

After `const rows = await store.getChangedSince(since);` add the read filter (wrapping the existing `rows.map(rowToPatient)` value, not replacing the map):

```js
    let outPatients = rows.map(rowToPatient);
    if(scope) outPatients = outPatients.filter(p => canRead(p, scope));
    return sendJSON(res, 200, { serverTime: now, patients: outPatients, apiVersion: SYNC_API_VERSION });
```

(The existing `return sendJSON(...)` line's `rows.map(rowToPatient)` expression moves into `outPatients` — this is the single permitted touch of an existing line, and the flag-off output is the identical value.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/server-scoping.test.js` → PASS.
Run: `npm test -- tests/server-sync-golden.test.js` → PASS (golden guard — flag-off unchanged).

- [ ] **Step 5: Run full suite, then commit**

Run: `npm test` — all pass.

```bash
git add server.js tests/server-scoping.test.js
git commit -m "feat: MULTI_TENANT sync read filter + write enforcement (wrap-only)"
```

---

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
