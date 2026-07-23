# Structural Operations Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the headless backend that lets an admin reshape the live hierarchy — rename, delete-empty, move (re-parent) nodes, bulk re-home patients, bulk-assign users — keeping denormalized patient ancestry server-authoritative and consistent.

**Architecture:** No schema changes. New storage update/delete methods per node type (both backends). A new `structure.js` module holds two idempotent re-stamp primitives (`restampUnits`, `restampPatient`) plus node helpers. New flag-gated, admin-guarded routes under `/api/admin/nodes/...`, `/api/admin/patients/rehome`, `/api/admin/users/assign-bulk`, `/api/admin/repair-ancestry` drive them, reusing `resolveAncestry`/`listUnitIdsUnder` (hierarchy.js), `resolveScope`/`canRead` (scope.js), and `isInstanceAdmin`/`nodeInOrg`/`cleanName` (server.js).

**Tech Stack:** Node.js (`node:sqlite` + MongoDB backends behind one store interface), `node:test`, existing server test harness `tests/helpers/server-harness.js`.

## Global Constraints

- **Flag off → byte-identical.** With `MULTI_TENANT` off: all new routes 404; `structure.js` unused; existing suite + `tests/server-sync-golden.test.js` green.
- **Storage methods in BOTH backends** (SQLite is the test harness; the feature runs on Mongo in prod).
- **Cross-org isolation.** Every node/patient/user reference is ownership-checked; any cross-org reference → `403`.
- **Server-authoritative ancestry.** Ancestry is re-derived from `tree + unitId`, never trusted from a client, never incremented. Idempotent.
- **Delete-empty-only.** A node deletes only with no children, no assigned users, no patients under it; else `409 {error, blockedBy}`.
- **Allowed moves:** `department → hospital`, `ward → department`, `unit → ward`, within the same org. `org`/`hospital` cannot move.
- **Names:** trimmed, required, ≤ 80 chars (reuse `cleanName`).
- **Node types:** `org, hospital, department, ward, unit`.
- Run `npm test` (from `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds`) at each task's final step.

---

### Task 1: Storage — node update + delete methods (both backends)

**Files:**
- Modify: `storage.js` (SQLite methods after `listUnitsByWard`; Mongo methods after `listUnitsByWard`)
- Test: `tests/storage.test.js`

**Interfaces:**
- Produces (both backends): `updateOrganization(id, patch)`, `updateHospital(id, patch)`, `updateDepartment(id, patch)`, `updateWard(id, patch)`, `updateUnit(id, patch)` (each `$set`s only whitelisted fields), and `deleteOrganization(id)`, `deleteHospital(id)`, `deleteDepartment(id)`, `deleteWard(id)`, `deleteUnit(id)`.
- Whitelists: org `{name, plan}`; hospital `{name, orgId}`; department `{name, specialty, hospitalId}`; ward `{name, departmentId}`; unit `{name, wardId}`.

- [ ] **Step 1: Write failing tests.** Append to the SQLite hierarchy describe in `tests/storage.test.js`:

```javascript
test('node update + delete', async () => {
  await store.createOrganization({ id: 'o9', name: 'O9', plan: 'free' });
  await store.createHospital({ id: 'h9', orgId: 'o9', name: 'H9' });
  await store.createDepartment({ id: 'd9', hospitalId: 'h9', name: 'D9' });
  await store.createWard({ id: 'w9', departmentId: 'd9', name: 'W9' });
  await store.createUnit({ id: 'un9', wardId: 'w9', name: 'U9' });

  await store.updateUnit('un9', { name: 'U9b', wardId: 'w9' });
  assert.equal((await store.getUnit('un9')).name, 'U9b');
  await store.updateWard('w9', { name: 'W9b' });
  assert.equal((await store.getWard('w9')).name, 'W9b');
  await store.updateDepartment('d9', { name: 'D9b', specialty: 'trauma' });
  assert.equal((await store.getDepartment('d9')).specialty, 'trauma');
  await store.updateHospital('h9', { name: 'H9b' });
  assert.equal((await store.getHospital('h9')).name, 'H9b');
  await store.updateOrganization('o9', { name: 'O9b' });
  assert.equal((await store.getOrganization('o9')).name, 'O9b');

  await store.deleteUnit('un9');
  assert.equal(await store.getUnit('un9'), null);
  await store.deleteWard('w9');
  assert.equal(await store.getWard('w9'), null);
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `node --test tests/storage.test.js`
Expected: FAIL — `store.updateUnit is not a function`.

- [ ] **Step 3: Implement SQLite.** In `storage.js`, after `listUnitsByWard` (SQLite), add a whitelist-driven updater + deletes:

```javascript
    async updateOrganization(id, patch){ updateRow(db, 'organizations', id, patch, ['name','plan']); },
    async updateHospital(id, patch){ updateRow(db, 'hospitals', id, patch, ['name','orgId']); },
    async updateDepartment(id, patch){ updateRow(db, 'departments', id, patch, ['name','specialty','hospitalId']); },
    async updateWard(id, patch){ updateRow(db, 'wards', id, patch, ['name','departmentId']); },
    async updateUnit(id, patch){ updateRow(db, 'units', id, patch, ['name','wardId']); },
    async deleteOrganization(id){ db.prepare('DELETE FROM organizations WHERE id = ?').run(id); },
    async deleteHospital(id){ db.prepare('DELETE FROM hospitals WHERE id = ?').run(id); },
    async deleteDepartment(id){ db.prepare('DELETE FROM departments WHERE id = ?').run(id); },
    async deleteWard(id){ db.prepare('DELETE FROM wards WHERE id = ?').run(id); },
    async deleteUnit(id){ db.prepare('DELETE FROM units WHERE id = ?').run(id); },
```

and add this module-level helper near the top of `storage.js` (after the imports / other helpers):

```javascript
function updateRow(db, table, id, patch, allowed){
  const fields = Object.keys(patch || {}).filter(k => allowed.includes(k));
  if(!fields.length) return;
  const set = fields.map(f => `${f} = ?`).join(', ');
  db.prepare(`UPDATE ${table} SET ${set} WHERE id = ?`).run(...fields.map(f => patch[f]), id);
}
```

- [ ] **Step 4: Implement Mongo.** In `createMongoStore`, after `listUnitsByWard` (Mongo), add:

```javascript
    async updateOrganization(id, patch){ await mongoUpdate(organizations, id, patch, ['name','plan']); },
    async updateHospital(id, patch){ await mongoUpdate(hospitals, id, patch, ['name','orgId']); },
    async updateDepartment(id, patch){ await mongoUpdate(departments, id, patch, ['name','specialty','hospitalId']); },
    async updateWard(id, patch){ await mongoUpdate(wards, id, patch, ['name','departmentId']); },
    async updateUnit(id, patch){ await mongoUpdate(units, id, patch, ['name','wardId']); },
    async deleteOrganization(id){ await organizations.deleteOne({ _id: id }); },
    async deleteHospital(id){ await hospitals.deleteOne({ _id: id }); },
    async deleteDepartment(id){ await departments.deleteOne({ _id: id }); },
    async deleteWard(id){ await wards.deleteOne({ _id: id }); },
    async deleteUnit(id){ await units.deleteOne({ _id: id }); },
```

and a module-level helper (near the top of `storage.js`, alongside `updateRow`):

```javascript
async function mongoUpdate(col, id, patch, allowed){
  const set = {};
  for(const k of Object.keys(patch || {})) if(allowed.includes(k)) set[k] = patch[k];
  if(Object.keys(set).length) await col.updateOne({ _id: id }, { $set: set });
}
```

- [ ] **Step 5: Run tests + full suite.**

Run: `node --test tests/storage.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add storage.js tests/storage.test.js
git commit -m "feat: node update + delete storage methods (both backends)"
```

---

### Task 2: `structure.js` — re-stamp primitives + node helpers

**Files:**
- Create: `structure.js`
- Test: `tests/structure.test.js`

**Interfaces:**
- Consumes: `resolveAncestry`, `listUnitIdsUnder` (hierarchy.js); store methods from Task 1 + existing getters.
- Produces:
  - `NODE_TYPES = ['org','hospital','department','ward','unit']`
  - `PARENT_TYPE = { department:'hospital', ward:'department', unit:'ward' }`
  - `async getNode(store, type, id)` → node object or null
  - `async nodeOrgId(store, type, id)` → orgId string or null
  - `async childrenOf(store, type, id)` → array of child nodes (unit → [])
  - `async unitIdsUnder(store, type, id)` → Set (delegates to `listUnitIdsUnder`)
  - `async restampUnits(store, unitIdSet)` → number of patients re-stamped
  - `async restampPatient(store, patientRow, unitId)` → boolean
  - `async updateNode(store, type, id, patch)` / `async deleteNode(store, type, id)` (dispatch to store)

- [ ] **Step 1: Write failing tests.** Create `tests/structure.test.js`:

```javascript
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createStore } from '../storage.js';
import { getNode, nodeOrgId, childrenOf, restampUnits, restampPatient } from '../structure.js';

describe('structure', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-struct-'));
    store = await createStore({ dataDir }); await store.init();
    await store.createOrganization({ id: 'o1', name: 'O1', plan: 'free' });
    await store.createHospital({ id: 'h1', orgId: 'o1', name: 'H1' });
    await store.createDepartment({ id: 'd1', hospitalId: 'h1', name: 'Ortho' });
    await store.createWard({ id: 'w1', departmentId: 'd1', name: '7FOW' });
    await store.createUnit({ id: 'u1', wardId: 'w1', name: 'IV' });
    const now = Date.now();
    await store.upsertPatient('p1', now, 0, JSON.stringify({ id: 'p1', name: 'A', unitId: 'u1', ward: 'stale', unit: 'stale' }));
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('getNode + nodeOrgId resolve every level', async () => {
    assert.equal((await getNode(store, 'unit', 'u1')).name, 'IV');
    assert.equal(await nodeOrgId(store, 'unit', 'u1'), 'o1');
    assert.equal(await nodeOrgId(store, 'department', 'd1'), 'o1');
    assert.equal(await nodeOrgId(store, 'org', 'o1'), 'o1');
  });
  test('childrenOf returns direct children; unit has none', async () => {
    assert.deepEqual((await childrenOf(store, 'department', 'd1')).map(n => n.id), ['w1']);
    assert.deepEqual(await childrenOf(store, 'unit', 'u1'), []);
  });
  test('restampUnits refreshes ancestry + labels for patients in the set', async () => {
    const n = await restampUnits(store, new Set(['u1']));
    assert.equal(n, 1);
    const o = JSON.parse((await store.getPatientRaw('p1')).data);
    assert.equal(o.orgId, 'o1'); assert.equal(o.wardId, 'w1');
    assert.equal(o.ward, '7FOW'); assert.equal(o.unit, 'IV'); // labels refreshed from node names
  });
  test('restampPatient repins a patient to a new unit', async () => {
    await store.createUnit({ id: 'u2', wardId: 'w1', name: 'II' });
    const row = await store.getPatientRaw('p1');
    const ok = await restampPatient(store, { id: 'p1', deleted: 0, data: row.data }, 'u2');
    assert.equal(ok, true);
    const o = JSON.parse((await store.getPatientRaw('p1')).data);
    assert.equal(o.unitId, 'u2'); assert.equal(o.unit, 'II');
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `node --test tests/structure.test.js`
Expected: FAIL — cannot find module `../structure.js`.

- [ ] **Step 3: Implement `structure.js`.**

```javascript
/* Structural operations for the MULTI_TENANT hierarchy: node resolution,
   emptiness checks, and idempotent server-authoritative re-stamping of
   patient ancestry. Pure store-interface consumers.
   See docs/superpowers/specs/2026-07-23-structural-operations-design.md. */
import { resolveAncestry, listUnitIdsUnder } from './hierarchy.js';

export const NODE_TYPES = ['org','hospital','department','ward','unit'];
export const PARENT_TYPE = { department: 'hospital', ward: 'department', unit: 'ward' };
const PARENT_FIELD = { department: 'hospitalId', ward: 'departmentId', unit: 'wardId' };

export async function getNode(store, type, id){
  switch(type){
    case 'org': return await store.getOrganization(id);
    case 'hospital': return await store.getHospital(id);
    case 'department': return await store.getDepartment(id);
    case 'ward': return await store.getWard(id);
    case 'unit': return await store.getUnit(id);
    default: return null;
  }
}

export async function nodeOrgId(store, type, id){
  const node = await getNode(store, type, id);
  if(!node) return null;
  switch(type){
    case 'org': return node.id;
    case 'hospital': return node.orgId;
    case 'department': return nodeOrgId(store, 'hospital', node.hospitalId);
    case 'ward': return nodeOrgId(store, 'department', node.departmentId);
    case 'unit': return nodeOrgId(store, 'ward', node.wardId);
    default: return null;
  }
}

export async function childrenOf(store, type, id){
  switch(type){
    case 'org': return await store.listHospitalsByOrg(id);
    case 'hospital': return await store.listDepartmentsByHospital(id);
    case 'department': return await store.listWardsByDepartment(id);
    case 'ward': return await store.listUnitsByWard(id);
    case 'unit': return [];
    default: return [];
  }
}

export async function unitIdsUnder(store, type, id){
  return await listUnitIdsUnder(store, { type, id });
}

async function labelStamp(store, o, a){
  Object.assign(o, a);
  const unit = await store.getUnit(a.unitId);
  const ward = await store.getWard(a.wardId);
  if(unit) o.unit = unit.name;
  if(ward) o.ward = ward.name;
  return o;
}

export async function restampUnits(store, unitIdSet){
  if(!unitIdSet || unitIdSet.size === 0) return 0;
  const rows = await store.getActive();
  let n = 0;
  for(const row of rows){
    let o; try{ o = JSON.parse(row.data); }catch{ continue; }
    if(!o.unitId || !unitIdSet.has(o.unitId)) continue;
    const a = await resolveAncestry(store, o.unitId);
    if(!a) continue;
    await labelStamp(store, o, a);
    const now = Date.now();
    o.updatedAt = now;
    await store.upsertPatient(row.id, now, row.deleted ? 1 : 0, JSON.stringify(o));
    n++;
  }
  return n;
}

export async function restampPatient(store, patientRow, unitId){
  let o; try{ o = JSON.parse(patientRow.data); }catch{ return false; }
  const a = await resolveAncestry(store, unitId);
  if(!a) return false;
  await labelStamp(store, o, a);
  const now = Date.now();
  o.updatedAt = now;
  await store.upsertPatient(patientRow.id, now, patientRow.deleted ? 1 : 0, JSON.stringify(o));
  return true;
}

export async function updateNode(store, type, id, patch){
  const m = { org: 'updateOrganization', hospital: 'updateHospital', department: 'updateDepartment', ward: 'updateWard', unit: 'updateUnit' }[type];
  if(m) await store[m](id, patch);
}
export async function deleteNode(store, type, id){
  const m = { org: 'deleteOrganization', hospital: 'deleteHospital', department: 'deleteDepartment', ward: 'deleteWard', unit: 'deleteUnit' }[type];
  if(m) await store[m](id);
}
export { PARENT_FIELD };
```

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `node --test tests/structure.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add structure.js tests/structure.test.js
git commit -m "feat: structure.js re-stamp primitives + node helpers"
```

---

### Task 3: Rename route — `PATCH /api/admin/nodes/:type/:id`

**Files:**
- Modify: `server.js` (inside the `if(isEnabled('MULTI_TENANT') && pathname.startsWith('/api/admin/'))` block, ~385; add imports from `structure.js`)
- Test: `tests/server-structure.test.js`

**Interfaces:**
- Consumes: `getNode`, `nodeOrgId`, `unitIdsUnder`, `restampUnits`, `updateNode`, `NODE_TYPES` (structure.js); `isInstanceAdmin`, `cleanName`, `readBody`, `sendJSON` (server.js).
- Produces: `PATCH /api/admin/nodes/:type/:id` `{name, specialty?}` → `200 {id, type, name}`. Ward/unit rename refreshes affected patients' labels. Adds a reusable `resolveAdminNode(actor, type, id)` guard returning `{node, orgId}` or an error code.

- [ ] **Step 1: Write failing test.** Create `tests/server-structure.test.js`. Use the harness like the other `server-*` tests (read `tests/helpers/server-harness.js` and `tests/server-admin-console.test.js` first). Cover: instance admin renames a ward → 200 and a patient under it gets the new `ward` label; org admin renaming a node in another org → 403; empty name → 400.

- [ ] **Step 2: Run it, verify it fails.**

Run: `node --test tests/server-structure.test.js`
Expected: FAIL (route not present → 404).

- [ ] **Step 3: Add imports + guard + route.** At the top of `server.js` add:

```javascript
import { NODE_TYPES, PARENT_TYPE, getNode, nodeOrgId, childrenOf, unitIdsUnder, restampUnits, restampPatient, updateNode, deleteNode } from './structure.js';
```

Add a guard helper next to `nodeInOrg` (~247):

```javascript
/** Resolve a node for an admin request, enforcing existence + org ownership.
 *  Returns {ok:true, node, orgId} or {ok:false, status, error}. */
async function resolveAdminNode(actor, type, id){
  if(!NODE_TYPES.includes(type)) return { ok: false, status: 400, error: 'Unknown node type' };
  const node = await getNode(store, type, id);
  if(!node) return { ok: false, status: 404, error: 'Node not found' };
  const orgId = await nodeOrgId(store, type, id);
  if(!isInstanceAdmin(actor) && orgId !== actor.orgId) return { ok: false, status: 403, error: 'Not your organization' };
  return { ok: true, node, orgId };
}
```

Inside the flag-gated admin block, add:

```javascript
    const nodeMatch = pathname.match(/^\/api\/admin\/nodes\/([^/]+)\/([^/]+)$/);
    if(nodeMatch && req.method === 'PATCH'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const [ , type, id ] = nodeMatch;
      const g = await resolveAdminNode(actor, type, id);
      if(!g.ok) return sendJSON(res, g.status, { error: g.error });
      const body = await readBody(req) || {};
      const name = cleanName(body.name);
      if(!name) return sendJSON(res, 400, { error: 'Name required (max 80 chars)' });
      const patch = { name };
      if(type === 'department' && typeof body.specialty === 'string') patch.specialty = cleanName(body.specialty, 40) || 'ortho';
      await updateNode(store, type, id, patch);
      if(type === 'ward' || type === 'unit') await restampUnits(store, await unitIdsUnder(store, type, id));
      return sendJSON(res, 200, { id, type, name });
    }
```

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `node --test tests/server-structure.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server.js tests/server-structure.test.js
git commit -m "feat: rename node route (+ label refresh on ward/unit rename)"
```

---

### Task 4: Delete route — `DELETE /api/admin/nodes/:type/:id` (delete-empty-only)

**Files:**
- Modify: `server.js` (flag-gated admin block)
- Test: `tests/server-structure.test.js`

**Interfaces:**
- Consumes: `resolveAdminNode`, `childrenOf`, `unitIdsUnder`, `deleteNode`; `store.getActive`, `store.getAllUsers`.
- Produces: `DELETE /api/admin/nodes/:type/:id` → `200 {deleted:true}` or `409 {error, blockedBy:{children, users, patients}}`.

- [ ] **Step 1: Write failing tests.** Add to `tests/server-structure.test.js`: deleting a ward that still has a unit → 409 with `blockedBy.children >= 1`; deleting a unit that has a patient → 409 with `blockedBy.patients >= 1`; deleting a truly empty unit → 200 and `getUnit` returns null; cross-org delete → 403.

- [ ] **Step 2: Run, verify fail.**

Run: `node --test tests/server-structure.test.js`
Expected: FAIL (DELETE not handled).

- [ ] **Step 3: Add the route** (inside the flag-gated block, after the PATCH route):

```javascript
    if(nodeMatch && req.method === 'DELETE'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const [ , type, id ] = nodeMatch;
      const g = await resolveAdminNode(actor, type, id);
      if(!g.ok) return sendJSON(res, g.status, { error: g.error });
      const children = (await childrenOf(store, type, id)).length;
      const users = (await store.getAllUsers()).filter(u => u.assignmentType === type && u.assignmentId === id).length;
      const unitSet = await unitIdsUnder(store, type, id);
      let patients = 0;
      for(const row of await store.getActive()){
        let o; try{ o = JSON.parse(row.data); }catch{ continue; }
        if(o.unitId && unitSet.has(o.unitId)) patients++;
      }
      if(children || users || patients){
        return sendJSON(res, 409, { error: 'Node is not empty', blockedBy: { children, users, patients } });
      }
      await deleteNode(store, type, id);
      return sendJSON(res, 200, { deleted: true });
    }
```

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `node --test tests/server-structure.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server.js tests/server-structure.test.js
git commit -m "feat: delete-empty-only node route"
```

---

### Task 5: Move route — `POST /api/admin/nodes/:type/:id/move`

**Files:**
- Modify: `server.js` (flag-gated admin block)
- Test: `tests/server-structure.test.js`

**Interfaces:**
- Consumes: `resolveAdminNode`, `nodeOrgId`, `unitIdsUnder`, `restampUnits`, `updateNode`, `PARENT_TYPE`, `PARENT_FIELD` (import `PARENT_FIELD` too).
- Produces: `POST /api/admin/nodes/:type/:id/move` `{newParentId}` → `200 {id, type, newParentId}`. Re-parents within the same org and re-stamps the moved subtree's patients.

- [ ] **Step 1: Write failing tests.** Add to `tests/server-structure.test.js`: build org `o1` with two departments `d1`,`d2` (same hospital), a ward `w1` under `d1` with unit `u1` and a patient pinned to `u1`; move `ward w1` to `d2` → 200 and the patient's `departmentId` becomes `d2`; moving a `unit` to a ward in another org → 403; moving an `org` → 400; wrong-type parent (ward → a hospital) → 400.

- [ ] **Step 2: Run, verify fail.**

Run: `node --test tests/server-structure.test.js`
Expected: FAIL (move route absent).

- [ ] **Step 3: Add the route** (after the DELETE route). Ensure `PARENT_FIELD` is included in the `structure.js` import line from Task 3:

```javascript
    const moveMatch = pathname.match(/^\/api\/admin\/nodes\/([^/]+)\/([^/]+)\/move$/);
    if(moveMatch && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const [ , type, id ] = moveMatch;
      const parentType = PARENT_TYPE[type];
      if(!parentType) return sendJSON(res, 400, { error: 'This node type cannot be moved' });
      const g = await resolveAdminNode(actor, type, id);
      if(!g.ok) return sendJSON(res, g.status, { error: g.error });
      const body = await readBody(req) || {};
      const newParentId = typeof body.newParentId === 'string' ? body.newParentId : '';
      const parent = newParentId ? await getNode(store, parentType, newParentId) : null;
      if(!parent) return sendJSON(res, 404, { error: `Parent ${parentType} not found` });
      const parentOrg = await nodeOrgId(store, parentType, newParentId);
      if(parentOrg !== g.orgId) return sendJSON(res, 403, { error: 'Parent is in a different organization' });
      await updateNode(store, type, id, { [PARENT_FIELD[type]]: newParentId });
      await restampUnits(store, await unitIdsUnder(store, type, id));
      return sendJSON(res, 200, { id, type, newParentId });
    }
```

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `node --test tests/server-structure.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server.js tests/server-structure.test.js
git commit -m "feat: move node route with subtree ancestry re-stamp"
```

---

### Task 6: Bulk routes — patient re-home + user assign-bulk

**Files:**
- Modify: `server.js` (flag-gated admin block)
- Test: `tests/server-structure.test.js`

**Interfaces:**
- Consumes: `resolveScope`, `canRead` (scope.js — already imported); `nodeOrgId`, `restampPatient`; `nodeInOrg` (server.js); `store.getPatientRaw`, `store.getUserById`, `store.updateUser`.
- Produces: `POST /api/admin/patients/rehome` `{patientIds, unitId}` → `200 {moved:n}`; `POST /api/admin/users/assign-bulk` `{userIds, nodeType, nodeId}` → `200 {assigned:n}`. Both validate-all-before-write.

- [ ] **Step 1: Write failing tests.** Add to `tests/server-structure.test.js`: instance admin re-homes 2 patients to `u2` → 200 `{moved:2}` and both patients' `unitId==='u2'`; re-home with a target unit in another org → 403 and neither patient changed (validate-all-before-write); assign-bulk 2 users to a department → 200 `{assigned:2}` and both users' `assignmentType==='department'`; assign-bulk where one user is in another org → 403 and neither user changed.

- [ ] **Step 2: Run, verify fail.**

Run: `node --test tests/server-structure.test.js`
Expected: FAIL (routes absent).

- [ ] **Step 3: Add both routes** (after the move route):

```javascript
    if(pathname === '/api/admin/patients/rehome' && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const body = await readBody(req) || {};
      const ids = Array.isArray(body.patientIds) ? body.patientIds : [];
      const unitId = typeof body.unitId === 'string' ? body.unitId : '';
      const targetOrg = await nodeOrgId(store, 'unit', unitId);
      if(!targetOrg) return sendJSON(res, 404, { error: 'Target unit not found' });
      if(!isInstanceAdmin(actor) && targetOrg !== actor.orgId) return sendJSON(res, 403, { error: 'Target unit is not in your organization' });
      const scope = await resolveScope(actor, store);
      // validate-all-before-write
      const rows = [];
      for(const id of ids){
        const raw = await store.getPatientRaw(id);
        if(!raw) return sendJSON(res, 404, { error: `Patient ${id} not found` });
        let o; try{ o = JSON.parse(raw.data); }catch{ o = {}; }
        if(!canRead(o, scope)) return sendJSON(res, 403, { error: 'A patient is outside your scope' });
        rows.push({ id, deleted: raw.deleted ? 1 : 0, data: raw.data });
      }
      let moved = 0;
      for(const row of rows){ if(await restampPatient(store, row, unitId)) moved++; }
      return sendJSON(res, 200, { moved });
    }

    if(pathname === '/api/admin/users/assign-bulk' && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const body = await readBody(req) || {};
      const userIds = Array.isArray(body.userIds) ? body.userIds : [];
      const nodeType = body.nodeId === null || body.nodeId === undefined ? null : String(body.nodeType || '');
      const nodeId = body.nodeId === null || body.nodeId === undefined ? null : String(body.nodeId);
      if(nodeId !== null){
        const orgId = isInstanceAdmin(actor) ? await nodeOrgId(store, nodeType, nodeId) : actor.orgId;
        if(!orgId || !(await nodeInOrg(store, nodeType, nodeId, orgId))) return sendJSON(res, 403, { error: 'Node is not in this organization' });
      }
      const targets = [];
      for(const uid of userIds){
        const u = await store.getUserById(uid);
        if(!u) return sendJSON(res, 404, { error: `User ${uid} not found` });
        if(!isInstanceAdmin(actor) && u.orgId !== actor.orgId) return sendJSON(res, 403, { error: 'A user is not in your organization' });
        targets.push(u);
      }
      for(const u of targets) await store.updateUser(u.id, { assignmentType: nodeType, assignmentId: nodeId });
      return sendJSON(res, 200, { assigned: targets.length });
    }
```

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `node --test tests/server-structure.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server.js tests/server-structure.test.js
git commit -m "feat: bulk patient re-home + bulk user assign routes"
```

---

### Task 7: Repair-ancestry route + flag-off golden guards

**Files:**
- Modify: `server.js` (flag-gated admin block)
- Modify: `tests/server-sync-golden.test.js`
- Test: `tests/server-structure.test.js`

**Interfaces:**
- Consumes: `unitIdsUnder`/`listUnitIdsUnder`, `restampUnits`; `isInstanceAdmin`.
- Produces: `POST /api/admin/repair-ancestry` (instance-admin) → `200 {restamped:n}`.

- [ ] **Step 1: Write failing tests.** In `tests/server-structure.test.js`: deliberately corrupt a patient's stored ancestry (write JSON with `unitId:'u1'` but wrong `orgId`/labels), call `POST /api/admin/repair-ancestry` as instance admin, assert the patient's `orgId`/labels are corrected and `restamped >= 1`; a non-instance admin calling it → 403. In `tests/server-sync-golden.test.js` add flag-OFF assertions: `PATCH /api/admin/nodes/unit/x`, `DELETE /api/admin/nodes/unit/x`, `POST /api/admin/nodes/unit/x/move`, `POST /api/admin/patients/rehome`, `POST /api/admin/users/assign-bulk`, `POST /api/admin/repair-ancestry` all return 404 when `MULTI_TENANT` is off.

- [ ] **Step 2: Run, verify fail.**

Run: `node --test tests/server-structure.test.js tests/server-sync-golden.test.js`
Expected: FAIL (repair route absent; golden guards fail if any route leaks flag-off).

- [ ] **Step 3: Add the route** (after the bulk routes). It re-stamps every active patient by collecting all unit ids across all orgs:

```javascript
    if(pathname === '/api/admin/repair-ancestry' && req.method === 'POST'){
      if(!isInstanceAdmin(actor)) return sendJSON(res, 403, { error: 'Instance admin only' });
      const allUnits = new Set();
      for(const org of await store.listOrganizations()){
        for(const uid of await unitIdsUnder(store, 'org', org.id)) allUnits.add(uid);
      }
      const restamped = await restampUnits(store, allUnits);
      return sendJSON(res, 200, { restamped });
    }
```

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `node --test tests/server-structure.test.js tests/server-sync-golden.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server.js tests/server-structure.test.js tests/server-sync-golden.test.js
git commit -m "feat: repair-ancestry route + flag-off golden guards for structural ops"
```

---

## Self-Review

**Spec coverage:** §1 `structure.js` primitives → Task 2; §2 routes — rename Task 3, delete Task 4, move Task 5, rehome + assign-bulk Task 6, repair-ancestry Task 7; §3 guards → `resolveAdminNode` (Task 3) + per-route checks; §4 integrity/idempotency → `restampUnits`/`restampPatient` derive-from-tree (Task 2), validate-all-before-write (Tasks 6); §5 error handling → 400/403/404/409 across Tasks 3-6; §6 testing → each task is TDD + Task 7 golden; storage support (implicit in §"no schema changes" but needed) → Task 1. No gaps.

**Placeholder scan:** every code step carries complete code; test steps that lean on the existing harness (Tasks 3-7) name the exact scenarios, assertions, and the reference files to copy the harness pattern from (`tests/helpers/server-harness.js`, `tests/server-admin-console.test.js`) rather than full harness boilerplate, consistent with how the Phase-2 server tests were specified.

**Type consistency:** `restampUnits(store, Set)` and `restampPatient(store, patientRow, unitId)` are defined in Task 2 and consumed unchanged in Tasks 3/5/6/7. `resolveAdminNode(actor, type, id) → {ok, node, orgId, status?, error?}` defined in Task 3, reused in Tasks 4/5. `PARENT_TYPE`/`PARENT_FIELD` from Task 2 used in Task 5. Node update/delete method names (`updateWard`, `deleteUnit`, …) match Task 1 exactly. Route path shapes (`/api/admin/nodes/:type/:id`, `/move`, `/patients/rehome`, `/users/assign-bulk`, `/repair-ancestry`) are consistent across tasks.
