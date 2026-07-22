# Deep Hierarchy (Ward + Unit) + Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the MULTI_TENANT tree two levels deeper (`Department → Ward → Unit`), pin patients to a Unit with denormalized ancestry, generalize access scoping to any-node subtrees, and backfill existing production data ahead of enforcement.

**Architecture:** Explicit table per level (rename `wards`→`departments`; add real `wards` + `units`). A patient carries `unitId` plus denormalized `{unitId, wardId, departmentId, hospitalId, orgId}` stamped server-side at write time, keeping the per-patient scope check O(1). Access = subtree of the user's assignment node resolved to a set of unit ids. Free-text `p.ward`/`p.unit` survive as derived display labels so clinical-display code is untouched.

**Tech Stack:** Node.js (`node:sqlite` + MongoDB backends behind one store interface), `node:test`, vanilla PWA frontend, jsdom for frontend tests.

## Global Constraints

- **Flag off → byte-identical.** With `MULTI_TENANT` off: new routes 404, no ancestry stamping, no scope filtering, `bootstrapAdmin` untouched. Existing suite + `server-sync-golden.test.js` stay green.
- **Cross-org isolation.** Every cross-org node reference (any id) → 403. Reuse `isInstanceAdmin(actor)` and org-admin = `role==='admin' && orgId`.
- **Storage stance.** New-table CRUD exists in **both** backends (SQLite is the test harness). All other feature work (routes, `admin.js`, `scope.js`, sync, UI, backfill) is written once against the store interface. Backfill runs on Mongo in production but is store-agnostic and tested on SQLite. No export/backup/import work for the new tables.
- **Names:** trimmed, required, ≤ 80 chars. Duplicate sibling names allowed. Usernames globally unique.
- **Vocabulary:** the table renamed to `departments` = clinical *department*; new `wards` = physical ward; new `units` = clinical team. Storage methods: `createDepartment/getDepartment/listDepartmentsByHospital`, `createWard/getWard/listWardsByDepartment`, `createUnit/getUnit/listUnitsByWard`.
- **Run the full suite** with `npm test` at each task's final step.

---

### Task 1: Rename `wards`→`departments` in the storage layer + consumers

**Files:**
- Modify: `storage.js` (SQLite: schema ~131-139, methods ~279-288; Mongo: collection ~372/378, methods ~534-547)
- Modify: `scope.js:17-19`
- Modify: `admin.js:33,60`
- Modify: `server.js` (`wardInOrg` ~238-243; routes calling `createWard`/`getWard`/`listWardsByHospital`)
- Modify tests: `tests/scope.test.js`, `tests/admin.test.js`, `tests/storage.test.js`, `tests/server-admin-console.test.js`, `tests/server-auth-scope.test.js`, `tests/server-scoping.test.js`

**Interfaces:**
- Produces: `store.createDepartment({id, hospitalId, name, specialty})`, `store.getDepartment(id)`, `store.listDepartmentsByHospital(hospitalId)` (identical shapes to the old ward methods). `departmentInOrg(departmentId, orgId)` in `server.js`.

- [ ] **Step 1: Update the SQLite schema + methods.** In `storage.js` rename the `CREATE TABLE IF NOT EXISTS wards` block to `departments`, the index to `idx_departments_hospitalId ON departments(hospitalId)`, and rename the three methods:

```javascript
    async createDepartment(dep){
      db.prepare(`INSERT INTO departments (id, hospitalId, name, specialty, createdAt) VALUES (?, ?, ?, ?, ?)`)
        .run(dep.id, dep.hospitalId, dep.name, dep.specialty || 'ortho', dep.createdAt || Date.now());
    },
    async getDepartment(id){
      return db.prepare('SELECT * FROM departments WHERE id = ?').get(id) || null;
    },
    async listDepartmentsByHospital(hospitalId){
      return db.prepare('SELECT * FROM departments WHERE hospitalId = ? ORDER BY createdAt ASC').all(hospitalId);
    },
```

- [ ] **Step 2: Update the Mongo methods.** In `createMongoStore` rename `const wards = database.collection('wards')` to `const departments = database.collection('departments')`, the index to `departments.createIndex({ hospitalId: 1 })`, and rename `createWard/getWard/listWardsByHospital` to `createDepartment/getDepartment/listDepartmentsByHospital`, mapping `{id, hospitalId, name, specialty, createdAt}` (same as before).

- [ ] **Step 3: Update consumers.** In `scope.js:17-19` change `listWardsByHospital` → `listDepartmentsByHospital` (variable still builds the id set — leave its local name for now; Task 4 rewrites this function). In `admin.js:33` change `store.listWardsByHospital(h.id)` → `store.listDepartmentsByHospital(h.id)`. In `server.js` rename `wardInOrg`→`departmentInOrg` and its `store.getWard`→`store.getDepartment`; update the route at ~413 to `store.createDepartment` and rename the route path `POST /api/admin/wards` → `POST /api/admin/departments` (and its `body`/error text to "Department").

- [ ] **Step 4: Update tests to the new names.** In each listed test file replace `store.createWard(` → `store.createDepartment(` and any `/api/admin/wards` POST that created a department → `/api/admin/departments`. Do NOT change assertions about scope yet.

- [ ] **Step 5: Run the suite.**

Run: `npm test`
Expected: PASS (pure rename; behavior unchanged).

- [ ] **Step 6: Commit.**

```bash
git add storage.js scope.js admin.js server.js tests/
git commit -m "refactor: rename ward table/methods to department (Phase 2 prep)"
```

---

### Task 2: Add `wards` + `units` storage CRUD (both backends)

**Files:**
- Modify: `storage.js` (SQLite schema block after `departments`; SQLite methods after `listDepartmentsByHospital`; Mongo collections + indexes + methods)
- Test: `tests/storage.test.js`

**Interfaces:**
- Produces: `createWard({id, departmentId, name, createdAt})`, `getWard(id)→{id, departmentId, name, createdAt}`, `listWardsByDepartment(departmentId)`; `createUnit({id, wardId, name, createdAt})`, `getUnit(id)→{id, wardId, name, createdAt}`, `listUnitsByWard(wardId)`.

- [ ] **Step 1: Write failing storage tests.** Append to `tests/storage.test.js` (inside the existing SQLite describe that already has a `store`):

```javascript
test('wards + units CRUD under a department', async () => {
  await store.createDepartment({ id: 'd1', hospitalId: 'h1', name: 'Ortho' });
  await store.createWard({ id: 'wa', departmentId: 'd1', name: '7FOW' });
  await store.createUnit({ id: 'un', wardId: 'wa', name: 'IV' });
  assert.equal((await store.getWard('wa')).departmentId, 'd1');
  assert.equal((await store.getUnit('un')).wardId, 'wa');
  assert.deepEqual((await store.listWardsByDepartment('d1')).map(w => w.id), ['wa']);
  assert.deepEqual((await store.listUnitsByWard('wa')).map(u => u.id), ['un']);
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `node --test tests/storage.test.js`
Expected: FAIL — `store.createWard is not a function`.

- [ ] **Step 3: Implement SQLite.** In `storage.js`, after the `departments` table add:

```javascript
      db.exec(`
        CREATE TABLE IF NOT EXISTS wards (
          id           TEXT PRIMARY KEY,
          departmentId TEXT NOT NULL,
          name         TEXT NOT NULL,
          createdAt    INTEGER NOT NULL
        );
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_wards_departmentId ON wards(departmentId);');
      db.exec(`
        CREATE TABLE IF NOT EXISTS units (
          id        TEXT PRIMARY KEY,
          wardId    TEXT NOT NULL,
          name      TEXT NOT NULL,
          createdAt INTEGER NOT NULL
        );
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_units_wardId ON units(wardId);');
```

and after `listDepartmentsByHospital` add:

```javascript
    async createWard(ward){
      db.prepare(`INSERT INTO wards (id, departmentId, name, createdAt) VALUES (?, ?, ?, ?)`)
        .run(ward.id, ward.departmentId, ward.name, ward.createdAt || Date.now());
    },
    async getWard(id){ return db.prepare('SELECT * FROM wards WHERE id = ?').get(id) || null; },
    async listWardsByDepartment(departmentId){
      return db.prepare('SELECT * FROM wards WHERE departmentId = ? ORDER BY createdAt ASC').all(departmentId);
    },
    async createUnit(unit){
      db.prepare(`INSERT INTO units (id, wardId, name, createdAt) VALUES (?, ?, ?, ?)`)
        .run(unit.id, unit.wardId, unit.name, unit.createdAt || Date.now());
    },
    async getUnit(id){ return db.prepare('SELECT * FROM units WHERE id = ?').get(id) || null; },
    async listUnitsByWard(wardId){
      return db.prepare('SELECT * FROM units WHERE wardId = ? ORDER BY createdAt ASC').all(wardId);
    },
```

- [ ] **Step 4: Implement Mongo.** In `createMongoStore` add `const wards = database.collection('wards'); const units = database.collection('units');`, indexes `await wards.createIndex({ departmentId: 1 }); await units.createIndex({ wardId: 1 });`, and methods:

```javascript
    async createWard(ward){
      await wards.insertOne({ _id: ward.id, departmentId: ward.departmentId, name: ward.name, createdAt: ward.createdAt || Date.now() });
    },
    async getWard(id){
      const d = await wards.findOne({ _id: id });
      return d ? { id: d._id, departmentId: d.departmentId, name: d.name, createdAt: d.createdAt } : null;
    },
    async listWardsByDepartment(departmentId){
      const arr = await wards.find({ departmentId }).sort({ createdAt: 1 }).toArray();
      return arr.map(d => ({ id: d._id, departmentId: d.departmentId, name: d.name, createdAt: d.createdAt }));
    },
    async createUnit(unit){
      await units.insertOne({ _id: unit.id, wardId: unit.wardId, name: unit.name, createdAt: unit.createdAt || Date.now() });
    },
    async getUnit(id){
      const d = await units.findOne({ _id: id });
      return d ? { id: d._id, wardId: d.wardId, name: d.name, createdAt: d.createdAt } : null;
    },
    async listUnitsByWard(wardId){
      const arr = await units.find({ wardId }).sort({ createdAt: 1 }).toArray();
      return arr.map(d => ({ id: d._id, wardId: d.wardId, name: d.name, createdAt: d.createdAt }));
    },
```

- [ ] **Step 5: Run the test, verify pass; run full suite.**

Run: `node --test tests/storage.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add storage.js tests/storage.test.js
git commit -m "feat: ward + unit storage CRUD (both backends)"
```

---

### Task 3: Ancestry resolver — `unitId` → full ancestry

**Files:**
- Create: `hierarchy.js`
- Test: `tests/hierarchy.test.js`

**Interfaces:**
- Produces: `async resolveAncestry(store, unitId) → {unitId, wardId, departmentId, hospitalId, orgId} | null` (null if the unit or any parent is missing). `async listUnitIdsUnder(store, node) → Set<string>` where `node = {type, id}` and `type ∈ {org, hospital, department, ward, unit}`.

- [ ] **Step 1: Write failing tests.** Create `tests/hierarchy.test.js`:

```javascript
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createStore } from '../storage.js';
import { resolveAncestry, listUnitIdsUnder } from '../hierarchy.js';

describe('hierarchy', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-hier-'));
    store = await createStore({ dataDir }); await store.init();
    await store.createOrganization({ id: 'o1', name: 'O', plan: 'free' });
    await store.createHospital({ id: 'h1', orgId: 'o1', name: 'H' });
    await store.createDepartment({ id: 'd1', hospitalId: 'h1', name: 'Ortho' });
    await store.createWard({ id: 'w1', departmentId: 'd1', name: '7FOW' });
    await store.createWard({ id: 'w2', departmentId: 'd1', name: '8FOW' });
    await store.createUnit({ id: 'u1', wardId: 'w1', name: 'IV' });
    await store.createUnit({ id: 'u2', wardId: 'w2', name: 'II' });
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('resolveAncestry walks unit→org', async () => {
    assert.deepEqual(await resolveAncestry(store, 'u1'),
      { unitId: 'u1', wardId: 'w1', departmentId: 'd1', hospitalId: 'h1', orgId: 'o1' });
  });
  test('resolveAncestry returns null for unknown unit', async () => {
    assert.equal(await resolveAncestry(store, 'nope'), null);
  });
  test('listUnitIdsUnder department returns all descendant units', async () => {
    const s = await listUnitIdsUnder(store, { type: 'department', id: 'd1' });
    assert.deepEqual([...s].sort(), ['u1', 'u2']);
  });
  test('listUnitIdsUnder unit returns just that unit', async () => {
    const s = await listUnitIdsUnder(store, { type: 'unit', id: 'u1' });
    assert.deepEqual([...s], ['u1']);
  });
  test('listUnitIdsUnder org returns every unit in the org', async () => {
    const s = await listUnitIdsUnder(store, { type: 'org', id: 'o1' });
    assert.deepEqual([...s].sort(), ['u1', 'u2']);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `node --test tests/hierarchy.test.js`
Expected: FAIL — cannot find module `../hierarchy.js`.

- [ ] **Step 3: Implement `hierarchy.js`.**

```javascript
/* Tree walking for the MULTI_TENANT hierarchy:
   organizations → hospitals → departments → wards → units.
   Pure store-interface consumers; no backend specifics. */

export async function resolveAncestry(store, unitId){
  if(!unitId) return null;
  const unit = await store.getUnit(unitId);
  if(!unit) return null;
  const ward = await store.getWard(unit.wardId);
  if(!ward) return null;
  const dep = await store.getDepartment(ward.departmentId);
  if(!dep) return null;
  const hospital = await store.getHospital(dep.hospitalId);
  if(!hospital) return null;
  return { unitId: unit.id, wardId: ward.id, departmentId: dep.id, hospitalId: hospital.id, orgId: hospital.orgId };
}

async function unitsUnderWard(store, wardId, out){
  for(const u of await store.listUnitsByWard(wardId)) out.add(u.id);
}
async function unitsUnderDepartment(store, depId, out){
  for(const w of await store.listWardsByDepartment(depId)) await unitsUnderWard(store, w.id, out);
}
async function unitsUnderHospital(store, hospitalId, out){
  for(const d of await store.listDepartmentsByHospital(hospitalId)) await unitsUnderDepartment(store, d.id, out);
}
async function unitsUnderOrg(store, orgId, out){
  for(const h of await store.listHospitalsByOrg(orgId)) await unitsUnderHospital(store, h.id, out);
}

export async function listUnitIdsUnder(store, node){
  const out = new Set();
  if(!node || !node.id) return out;
  switch(node.type){
    case 'unit': out.add(node.id); break;
    case 'ward': await unitsUnderWard(store, node.id, out); break;
    case 'department': await unitsUnderDepartment(store, node.id, out); break;
    case 'hospital': await unitsUnderHospital(store, node.id, out); break;
    case 'org': await unitsUnderOrg(store, node.id, out); break;
  }
  return out;
}
```

- [ ] **Step 4: Run tests, verify pass.**

Run: `node --test tests/hierarchy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add hierarchy.js tests/hierarchy.test.js
git commit -m "feat: hierarchy ancestry + subtree unit resolver"
```

---

### Task 4: Generalize `scope.js` to unit-based subtree scoping

**Files:**
- Modify: `scope.js` (whole file)
- Modify: `tests/scope.test.js` (rewrite to units; keep member/admin/instance cases)

**Interfaces:**
- Consumes: `listUnitIdsUnder`, `resolveAncestry` (Task 3). Actor gains optional `assignment = {type, id}`; retains `wardId` only for back-compat reads (unused here).
- Produces: `resolveScope(actor, store) → {unrestricted, unitIds:Set, includeUnassigned}`; `canRead(patient, scope)` keyed on `patient.unitId`; `decideWrite({incoming, existing, actor, scope}) → {allow, ancestry?}` where `ancestry` is the full object to stamp (or `undefined` to leave as-is).

- [ ] **Step 1: Rewrite the scope tests.** Replace `tests/scope.test.js` fixtures to build `o1→h1→d1→w1→u1` and `w2→u2`, plus a second org `o2→…→ux`. Actors:

```javascript
const member = (unitId, orgId = 'o1') => ({ id: 'u', username: 'pg', role: 'member', orgId, assignment: unitId ? { type: 'unit', id: unitId } : null });
const deptAdmin = (depId = 'd1', orgId = 'o1') => ({ id: 'a', username: 'boss', role: 'admin', orgId, assignment: { type: 'department', id: depId } });
const instanceAdmin = () => ({ id: 'root', username: 'root', role: 'admin', orgId: null, assignment: null });
```

Key cases:

```javascript
test('member sees exactly their unit', async () => {
  const s = await resolveScope(member('u1'), store);
  assert.deepEqual([...s.unitIds], ['u1']); assert.equal(s.includeUnassigned, false);
});
test('dept admin sees all units under the department', async () => {
  const s = await resolveScope(deptAdmin('d1'), store);
  assert.deepEqual([...s.unitIds].sort(), ['u1', 'u2']);
});
test('instance admin unrestricted + unassigned', async () => {
  const s = await resolveScope(instanceAdmin(), store);
  assert.equal(s.unrestricted, true); assert.equal(s.includeUnassigned, true);
});
test('canRead: patient in-scope by unitId', async () => {
  const s = await resolveScope(member('u1'), store);
  assert.equal(canRead({ unitId: 'u1' }, s), true);
  assert.equal(canRead({ unitId: 'u2' }, s), false);
  assert.equal(canRead({ }, s), false); // unassigned, member
});
test('decideWrite new patient: member inherits their unit ancestry', async () => {
  const s = await resolveScope(member('u1'), store);
  const d = await decideWrite({ incoming: {}, existing: null, actor: member('u1'), scope: s, store });
  assert.equal(d.allow, true); assert.equal(d.ancestry.unitId, 'u1'); assert.equal(d.ancestry.orgId, 'o1');
});
test('decideWrite new patient: multi-unit admin with no chosen unit is denied', async () => {
  const s = await resolveScope(deptAdmin('d1'), store);
  const d = await decideWrite({ incoming: {}, existing: null, actor: deptAdmin('d1'), scope: s, store });
  assert.equal(d.allow, false);
});
test('decideWrite new patient: admin choosing an in-scope unit is stamped', async () => {
  const s = await resolveScope(deptAdmin('d1'), store);
  const d = await decideWrite({ incoming: { unitId: 'u2' }, existing: null, actor: deptAdmin('d1'), scope: s, store });
  assert.equal(d.allow, true); assert.equal(d.ancestry.unitId, 'u2');
});
```

- [ ] **Step 2: Run, verify failure.**

Run: `node --test tests/scope.test.js`
Expected: FAIL (old signature returns `wardIds`, no `store` arg on `decideWrite`).

- [ ] **Step 3: Rewrite `scope.js`.** Note `decideWrite` becomes `async` and takes `store` to resolve ancestry:

```javascript
/* Unit-based subtree scoping for MULTI_TENANT. A patient is pinned to a Unit
   (leaf) carrying denormalized ancestry; a user is assigned to any node and
   scoped to that node's subtree of units. See
   docs/superpowers/specs/2026-07-22-hierarchy-expansion-design.md. */
import { listUnitIdsUnder, resolveAncestry } from './hierarchy.js';

export async function resolveScope(actor, store){
  const isAdmin = actor?.role === 'admin';
  if(isAdmin && !actor.orgId){
    return { unrestricted: true, unitIds: new Set(), includeUnassigned: true };
  }
  const node = actor?.assignment || (isAdmin && actor.orgId ? { type: 'org', id: actor.orgId } : null);
  const unitIds = node ? await listUnitIdsUnder(store, node) : new Set();
  return { unrestricted: false, unitIds, includeUnassigned: false };
}

export function canRead(patient, scope){
  if(scope.unrestricted) return true;
  if(!patient?.unitId) return scope.includeUnassigned;
  return scope.unitIds.has(patient.unitId);
}

/** Decide whether a write is allowed and the ancestry to stamp.
 *  ancestry === undefined means "leave stored ancestry as-is". */
export async function decideWrite({ incoming, existing, actor, scope, store }){
  const isAdmin = actor?.role === 'admin';

  if(existing){
    if(!canRead(existing, scope)) return { allow: false };
    const requested = incoming?.unitId;
    if(isAdmin && requested && (scope.unrestricted || scope.unitIds.has(requested))){
      return { allow: true, ancestry: await resolveAncestry(store, requested) };
    }
    return { allow: true }; // keep existing ancestry
  }

  // New patient
  const requested = incoming?.unitId;
  if(scope.unrestricted){
    return requested ? { allow: true, ancestry: await resolveAncestry(store, requested) }
                     : { allow: true, ancestry: undefined };
  }
  if(requested){
    return scope.unitIds.has(requested)
      ? { allow: true, ancestry: await resolveAncestry(store, requested) }
      : { allow: false };
  }
  // No explicit unit: only auto-resolvable when the actor is scoped to exactly one unit.
  if(scope.unitIds.size === 1){
    const only = [...scope.unitIds][0];
    return { allow: true, ancestry: await resolveAncestry(store, only) };
  }
  return { allow: false };
}
```

- [ ] **Step 4: Run scope tests, verify pass.**

Run: `node --test tests/scope.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add scope.js tests/scope.test.js
git commit -m "feat: unit-based subtree scoping (resolveScope/canRead/decideWrite)"
```

---

### Task 5: Build the actor's `assignment` + wire sync write path

**Files:**
- Modify: `server.js` (actor construction ~288; sync write loop ~547-590)
- Modify: `storage.js` — extend `USER_PATCH_FIELDS` and user mapping to persist `assignment` (store as `assignmentType` + `assignmentId`)
- Test: `tests/server-scoping.test.js`

**Interfaces:**
- Consumes: `resolveScope`, `decideWrite` (now async, needs `store`), `resolveAncestry`.
- Produces: `actor.assignment = {type, id} | null` derived from the user's `assignmentType`/`assignmentId`. Sync stamps `stored.{unitId,wardId,departmentId,hospitalId,orgId}` from `decision.ancestry`.

- [ ] **Step 1: Write a failing integration test.** In `tests/server-scoping.test.js` add a case: instance admin creates `org→hospital→dept→ward→unit`, creates a member assigned to the unit; the member syncs a new patient with no `unitId`; on read-back the stored patient has `unitId` set and `ward`/`unit` label strings equal to the ward/unit names. (Use the existing harness in `tests/helpers/server-harness.js` for boot + request helpers; follow the pattern already in this file.)

- [ ] **Step 2: Run, verify failure.**

Run: `node --test tests/server-scoping.test.js`
Expected: FAIL (no `unitId` stamped).

- [ ] **Step 3: Persist assignment.** In `storage.js`, add `'assignmentType', 'assignmentId'` to `USER_PATCH_FIELDS`; extend `createUser` (both backends) and both `mapUser`/SQLite user SELECT to carry `assignmentType`/`assignmentId` (nullable, like `orgId`). For SQLite, `addColumnIfMissing(db, 'users', 'assignmentType', 'TEXT')` and `assignmentId` next to the existing `orgId`/`wardId` migration calls (~105).

- [ ] **Step 4: Build the actor + stamp ancestry.** In `server.js` where `actor` is built (~288), add:

```javascript
  const actor = {
    id: authedUser.id, username: authedUser.username, role: authedUser.role,
    orgId: authedUser.orgId ?? null, wardId: authedUser.wardId ?? null,
    assignment: authedUser.assignmentId ? { type: authedUser.assignmentType, id: authedUser.assignmentId } : null
  };
```

In the sync loop replace the `decideWrite` call + `decision.wardId` block (~564-573) with:

```javascript
        let decision = null;
        if(scope){
          decision = await decideWrite({ incoming: p, existing: existingObj, actor, scope, store });
          if(!decision.allow) continue;
        }
        stampAttribution(p, existingObj, actor);
        if(!existing || incomingUpdated >= existing.updatedAt){
          const stored = existingObj ? mergePatientRecords(p, existingObj) : Object.assign({}, p);
          if(decision && decision.ancestry !== undefined){
            const a = decision.ancestry;
            if(a === null){
              delete stored.unitId; delete stored.wardId; delete stored.departmentId;
              delete stored.hospitalId; delete stored.orgId;
            }else{
              Object.assign(stored, a);
              const ward = await store.getWard(a.wardId); const unit = await store.getUnit(a.unitId);
              if(ward) stored.ward = ward.name;
              if(unit) stored.unit = unit.name;
            }
          }
          stored.updatedAt = now;
          await store.upsertPatient(p.id, now, p.deleted ? 1 : 0, JSON.stringify(stored));
        }
```

- [ ] **Step 5: Run scoping + full suite.**

Run: `node --test tests/server-scoping.test.js && npm test`
Expected: PASS. (If `server-auth-scope.test.js` or `server-admin-console.test.js` assert old `wardId` scoping, update them to the unit model here.)

- [ ] **Step 6: Commit.**

```bash
git add server.js storage.js tests/
git commit -m "feat: stamp patient ancestry + derived labels on sync; actor assignment"
```

---

### Task 6: Admin API — ward/unit routes, nested tree, node assign

**Files:**
- Modify: `server.js` (the `if(isEnabled('MULTI_TENANT') && pathname.startsWith('/api/admin/'))` block ~343-432)
- Modify: `admin.js` (`buildOrgTree` recurse to units)
- Test: `tests/server-admin-console.test.js`, `tests/admin.test.js`

**Interfaces:**
- Consumes: `departmentInOrg` (Task 1), `store.createWard/createUnit/getWard/getUnit`, `listUnitIdsUnder`.
- Produces routes: `POST /api/admin/wards {departmentId,name}`, `POST /api/admin/units {wardId,name}`, `POST /api/admin/users/:id/assign {nodeId,nodeType}`; `GET /api/admin/org` returns hospitals→departments→wards→units nested. `buildOrgTree` returns `hospitals:[{…, departments:[{…, wards:[{…, units:[{id,name,stats}]}]}]}]`.

- [ ] **Step 1: Write failing route tests.** In `tests/server-admin-console.test.js`: org admin creates a ward under their department (200) and a unit under that ward (200); creating a ward under another org's department → 403; `GET /api/admin/org` returns the nested unit; `POST /api/admin/users/:id/assign {nodeType:'unit',nodeId}` sets the user's assignment and a cross-org node → 403.

- [ ] **Step 2: Run, verify failure.**

Run: `node --test tests/server-admin-console.test.js`
Expected: FAIL (routes 404 / not present).

- [ ] **Step 3: Add the routes.** Inside the flag-gated admin block add (mirroring the existing `departmentInOrg` validation style):

```javascript
    if(pathname === '/api/admin/wards' && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const body = await readBody(req) || {};
      const dep = body.departmentId ? await store.getDepartment(body.departmentId) : null;
      if(!dep) return sendJSON(res, 404, { error: 'Department not found' });
      if(!isInstanceAdmin(actor) && !(await departmentInOrg(dep.id, actor.orgId))) return sendJSON(res, 403, { error: 'Not your organization' });
      const name = cleanName(body.name);
      if(!name) return sendJSON(res, 400, { error: 'Ward name required (max 80 chars)' });
      const ward = { id: crypto.randomUUID(), departmentId: dep.id, name, createdAt: Date.now() };
      await store.createWard(ward);
      return sendJSON(res, 200, { id: ward.id, departmentId: dep.id, name });
    }

    if(pathname === '/api/admin/units' && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const body = await readBody(req) || {};
      const ward = body.wardId ? await store.getWard(body.wardId) : null;
      if(!ward) return sendJSON(res, 404, { error: 'Ward not found' });
      if(!isInstanceAdmin(actor) && !(await departmentInOrg(ward.departmentId, actor.orgId))) return sendJSON(res, 403, { error: 'Not your organization' });
      const name = cleanName(body.name);
      if(!name) return sendJSON(res, 400, { error: 'Unit name required (max 80 chars)' });
      const unit = { id: crypto.randomUUID(), wardId: ward.id, name, createdAt: Date.now() };
      await store.createUnit(unit);
      return sendJSON(res, 200, { id: unit.id, wardId: ward.id, name });
    }
```

Replace the old `assign` route (~417-431) with a node-based one:

```javascript
    const assignMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/assign$/);
    if(assignMatch && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const target = await store.getUserById(assignMatch[1]);
      if(!target) return sendJSON(res, 404, { error: 'User not found' });
      if(!isInstanceAdmin(actor) && target.orgId !== actor.orgId) return sendJSON(res, 403, { error: 'Not your organization' });
      const body = await readBody(req) || {};
      if(body.nodeId === null || body.nodeId === undefined){
        await store.updateUser(target.id, { assignmentType: null, assignmentId: null });
        return sendJSON(res, 200, { ok: true, assignment: null });
      }
      const nodeType = String(body.nodeType || '');
      const orgId = isInstanceAdmin(actor) ? target.orgId : actor.orgId;
      if(!orgId || !(await nodeInOrg(store, nodeType, String(body.nodeId), orgId))) return sendJSON(res, 403, { error: 'Node is not in this organization' });
      await store.updateUser(target.id, { assignmentType: nodeType, assignmentId: String(body.nodeId) });
      return sendJSON(res, 200, { ok: true, assignment: { type: nodeType, id: String(body.nodeId) } });
    }
```

Add a `nodeInOrg(store, type, id, orgId)` helper next to `departmentInOrg` that resolves the node's org via its parents (unit→ward→dept→hospital.orgId; ward→dept→hospital.orgId; department→hospital.orgId; hospital.orgId; org===id).

- [ ] **Step 4: Recurse `buildOrgTree`.** In `admin.js`, after building each department, populate `wards` via `listWardsByDepartment` and each ward's `units` via `listUnitsByWard`; aggregate `livePatients`/`byStatus` per unit (parse patient JSON `unitId`), rolling counts up ward→department→hospital→org totals. Keep the existing top-level `totals` shape and add `departments`/`wards`/`units` counts.

- [ ] **Step 5: Run admin tests + full suite.**

Run: `node --test tests/server-admin-console.test.js tests/admin.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add server.js admin.js tests/
git commit -m "feat: ward/unit admin routes, nested org tree, node-based assign"
```

---

### Task 7: Frontend — admin console ward/unit forms + node picker

**Files:**
- Modify: `public/index.html` (admin view markup ~2023-2038; `.admin-*` styles ~709-729 for nested cards)
- Modify: `public/app.js` (admin render + assign select ~7627/7703; the `renderAdminOrg`/dept-card rendering functions)
- Test: `tests/frontend-admin-view.test.js`

**Interfaces:**
- Consumes: `GET /api/admin/org` nested tree; `POST /api/admin/wards`, `/api/admin/units`, `/api/admin/users/:id/assign {nodeType,nodeId}`.
- Produces: department cards render child wards; ward rows render an add-unit form and child units; the user-row assignment control is a node `<select>` whose option `value` encodes `type:id`.

- [ ] **Step 1: Write the failing jsdom test.** In `tests/frontend-admin-view.test.js` add: given a fixture tree with one unit, rendering the admin org pane produces an element per ward and per unit (assert by class/text); the assignment `<select>` for a user contains an option with value `unit:u1`; selecting it and firing `change` calls `fetch('/api/admin/users/<id>/assign', {method:'POST', body: JSON stringifying {nodeType:'unit', nodeId:'u1'}})`. Follow the existing mocking pattern already in this file.

- [ ] **Step 2: Run, verify failure.**

Run: `node --test tests/frontend-admin-view.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement rendering.** In `app.js`, extend the department-card renderer to iterate `dep.wards`, render each ward with an inline add-unit form (`POST /api/admin/units {wardId, name}`) and its `ward.units`. Add an add-ward form per department (`POST /api/admin/wards {departmentId, name}`). Change the user-row assignment control (currently `data-assign-user` / posts `{wardId}`) to a `<select>` built by walking the tree into `optgroup`s, option `value="${type}:${id}"`; the `change` handler splits on `:` and posts `{nodeType, nodeId}` (null when the blank option is chosen). Reuse existing `.admin-dept-grid`/`.admin-dept-card` styles; add `.admin-ward-row`/`.admin-unit-chip` following the same token palette (`var(--card)`, `var(--line)`).

- [ ] **Step 4: Run the test + full suite.**

Run: `node --test tests/frontend-admin-view.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add public/index.html public/app.js tests/frontend-admin-view.test.js
git commit -m "feat: admin console ward/unit forms + node-based assignment"
```

---

### Task 8: Frontend — cascading Department→Ward→Unit picker on the patient form

**Files:**
- Modify: `public/index.html` (patient form fields ~6388/6392 replace `f_ward`/`f_unit` inputs with selects `f_department`/`f_ward`/`f_unit`)
- Modify: `public/app.js` (patient-form build ~6259-6260 and save ~7277-7278; add scope-tree fetch/cache)
- Test: `tests/frontend-worklist.test.js` (or the frontend test that already mounts the patient modal)

**Interfaces:**
- Consumes: the caller's scope tree (fetch once from `GET /api/admin/org` when the user is an admin, else a lightweight `GET /api/me/scope` returning the actor's subtree — add this small authed route in this task). Persists `unitId` on the patient payload; the server derives labels.
- Produces: the patient modal collects `unitId`; when the caller is scoped to exactly one unit the three selects are pre-filled and disabled.

- [ ] **Step 1: Add `GET /api/me/scope`.** In `server.js` (authed, flag-on only): return `{ assignment, tree }` where `tree` is the subtree of the actor's scope as nested department→ward→unit (instance/dept admins get their subtree; a single-unit member gets the one-unit branch). Flag off → 404. Write a server test asserting a member gets exactly their unit branch and an out-of-scope unit is absent.

- [ ] **Step 2: Run, verify failure.**

Run: `node --test tests/server-scoping.test.js`
Expected: FAIL (route absent).

- [ ] **Step 3: Implement the route** using `listUnitIdsUnder` + `resolveAncestry` to assemble the nested branch; verify pass.

Run: `node --test tests/server-scoping.test.js`
Expected: PASS.

- [ ] **Step 4: Write the failing frontend test.** Mount the patient modal with a stubbed scope tree of one unit; assert `f_unit` is pre-selected + disabled and that saving posts a patient whose payload includes `unitId:'u1'`. With a two-unit stub, assert the selects are enabled and saving without a choice surfaces the existing validation toast.

- [ ] **Step 5: Run, verify failure, then implement.** Replace the `f_ward`/`f_unit` text inputs with three dependent `<select>`s populated from the cached scope tree (Department fills Ward fills Unit). On modal open, if scope has exactly one unit, pre-select the whole chain and set `disabled`. In the save path (~7277) set `d.unitId` from `f_unit.value` (drop direct `d.ward`/`d.unit` string writes — the server derives them; keep reading server-returned labels for display). When flag is off (health reports `MULTI_TENANT:false`), keep the legacy free-text inputs unchanged.

Run: `node --test tests/frontend-worklist.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add public/index.html public/app.js server.js tests/
git commit -m "feat: cascading dept/ward/unit picker on patient form + /api/me/scope"
```

---

### Task 9: Backfill — reconstruct tree + stamp ancestry (store-agnostic)

**Files:**
- Create: `scripts/backfill-hierarchy.js`
- Test: `tests/backfill-hierarchy.test.js`

**Interfaces:**
- Consumes: the store interface + `resolveAncestry`. Runs standalone: `node scripts/backfill-hierarchy.js [--single-bucket]` (reads `MONGODB_URI`/`dataDir` the same way `server.js` builds its store).
- Produces: `async backfill(store, {singleBucket=false}) → {orgId, created:{hospitals,departments,wards,units}, stamped}`. Idempotent: re-run creates nothing new and re-stamps identically.

- [ ] **Step 1: Write failing tests.** Create `tests/backfill-hierarchy.test.js`: seed patients (via `upsertPatient` with JSON `{ward:'7FOW',unit:'IV'}`, `{ward:'7 fow',unit:'IV'}`, `{ward:'',unit:''}`) with no `unitId`; run `backfill(store)`; assert (a) every active patient now has a `unitId`; (b) normalized `7FOW`/`7 fow` collapse to one ward; (c) blank falls into a `General` ward/unit; (d) re-running `backfill` adds zero new wards/units (idempotent); (e) `--single-bucket` puts every patient in one unit.

- [ ] **Step 2: Run, verify failure.**

Run: `node --test tests/backfill-hierarchy.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `scripts/backfill-hierarchy.js`.** Logic: ensure a default `Organization('Default')`→`Hospital('Default')`→`Department('Ortho')` (find-or-create by a fixed sentinel id, e.g. `backfill-org`/`backfill-hosp`/`backfill-dep`, so re-runs are idempotent). Build a normalization key `norm(s)=s.trim().toLowerCase().replace(/\s+/g,'')`. For each active patient: derive `wardKey = norm(p.ward)||'general'`, `unitKey = norm(p.unit)||'general'`; find-or-create the ward (deterministic id `backfill-ward-<wardKey>`) and unit (`backfill-unit-<wardKey>-<unitKey>`); stamp `resolveAncestry(store, unitId)` onto the patient JSON, set `ward`/`unit` labels to the created node names, and `upsertPatient`. `--single-bucket` forces `wardKey='general', unitKey='general'`. Export `backfill` and run it under `if(import.meta.url === ...)` main guard building the store from env.

- [ ] **Step 4: Run tests, verify pass.**

Run: `node --test tests/backfill-hierarchy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add scripts/backfill-hierarchy.js tests/backfill-hierarchy.test.js
git commit -m "feat: idempotent hierarchy backfill (reconstruct tree + stamp ancestry)"
```

---

### Task 10: Flag-off golden guard + docs

**Files:**
- Modify: `tests/server-sync-golden.test.js` (add flag-off assertions for the new routes)
- Modify: `README.md` (rollout runbook: backfill → verify → flip flag)

**Interfaces:** none (verification + docs).

- [ ] **Step 1: Add flag-off assertions.** With `MULTI_TENANT` unset: `POST /api/admin/wards`, `/api/admin/units`, `GET /api/me/scope` all return 404; a sync round-trips a patient with **no** `unitId` added (byte-identical stored JSON). Follow the golden pattern already in the file.

- [ ] **Step 2: Run, verify pass** (routes are already flag-gated from Tasks 6/8).

Run: `node --test tests/server-sync-golden.test.js`
Expected: PASS.

- [ ] **Step 3: Write the runbook.** Add a "Rolling out the deep hierarchy" section to `README.md`: (1) back up via `/api/export`; (2) run `node scripts/backfill-hierarchy.js` against the Mongo instance with the flag still off; (3) review the tree in the admin console; (4) set `ORTHO_FLAG_MULTI_TENANT=1` and redeploy; (5) confirm clinicians see their patients.

- [ ] **Step 4: Full suite green.**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/server-sync-golden.test.js README.md
git commit -m "test+docs: flag-off golden guards + hierarchy rollout runbook"
```

---

## Self-Review

**Spec coverage:** §1 data model → Tasks 1–2; §2 scoping → Tasks 3–5; §3 API → Task 6 (+ `/api/me/scope` in Task 8); §4 UI → Tasks 7–8; §5 migration → Task 9; §6 scaling → documented (no task, by design); §7 error handling → covered in Tasks 4/6 (deny paths, 400/403); §8 testing → each task is TDD + Task 10 golden. No gaps.

**Placeholder scan:** backend/scope/migration steps carry complete code. Frontend Tasks 7–8 specify exact files, selectors (`f_department`/`f_ward`/`f_unit`, `data-assign-user`), routes, and encodings (`value="type:id"`) rather than full HTML strings, since they extend large existing render functions — this matches the "follow established patterns in large files" guidance and names every interface concretely.

**Type consistency:** `resolveAncestry` returns `{unitId,wardId,departmentId,hospitalId,orgId}` used identically by `decideWrite` (Task 4) and the sync loop (Task 5). `decideWrite` returns `{allow, ancestry}` (not the old `{allow, wardId}`) — the sync loop reads `decision.ancestry`. `assignment = {type,id}` is produced in Task 5's actor and consumed by `resolveScope` (Task 4) and the assign route (Task 6). Store methods use the Task-1/2 names throughout.
