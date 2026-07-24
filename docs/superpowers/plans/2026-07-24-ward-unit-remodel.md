# Ward/Unit Re-model (Department → Unit → Ward) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert the bottom two hierarchy levels so a Unit (team) sits directly under a Department and a Ward (location) sits optionally under a Unit, with a v2 migration for live production data.

**Architecture:** Flip two FKs (`units.wardId`→`departmentId`, `wards.departmentId`→`unitId`) in both storage backends; shorten `resolveAncestry` to unit→department→hospital→org; keep unit-axis scoping; make the patient `wardId` optional and validated against its unit; flip the structural-ops parent maps; re-derive the tree from patients' free-text labels in a v2 backfill.

**Tech Stack:** Node.js (`node:sqlite` + MongoDB behind one store interface), `node:test`, existing harness `tests/helpers/server-harness.js`, vanilla PWA frontend, jsdom.

## Global Constraints

- **Flag off → byte-identical.** With `MULTI_TENANT` off: no scoping/stamping; existing suite + `tests/server-sync-golden.test.js` green.
- **Storage changes in BOTH backends** (SQLite is the test harness; prod is Mongo).
- **Cross-org isolation preserved** (structural-ops guards keep returning 403 on cross-org).
- **Server-authoritative ancestry:** re-derived from `tree + unitId`, never client-trusted. Ancestry is now `{unitId, departmentId, hospitalId, orgId}` (no ward).
- **Patient `unitId` required; `wardId` optional** and must reference a ward whose `unitId === patient.unitId`.
- **Ward-validation on writes:** the **sync** path server-clears an out-of-unit `wardId` (server-authoritative, non-fatal to the batch); the explicit **rehome** route returns `400` on an out-of-unit ward.
- **Names:** trimmed/required/≤80 (`cleanName`).
- Run `npm test` (from `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds`) at each task's final step.

---

### Task 1: Storage — flip unit/ward FKs (both backends)

**Files:**
- Modify: `storage.js` (SQLite schema ~158-174, migrations ~119-122, methods ~325-346; Mongo collections/indexes + methods ~617-644)
- Test: `tests/storage.test.js`

**Interfaces:**
- Produces (both backends): `createUnit({id, departmentId, name, createdAt})`, `getUnit(id)→{id, departmentId, name, createdAt}`, `listUnitsByDepartment(departmentId)`; `createWard({id, unitId, name, createdAt})`, `getWard(id)→{id, unitId, name, createdAt}`, `listWardsByUnit(unitId)`. `updateUnit` whitelist `['name','departmentId']`; `updateWard` whitelist `['name','unitId']`. (`listUnitsByWard`/`listWardsByDepartment` are removed.)

- [ ] **Step 1: Write the failing test.** Replace the ward/unit CRUD test in `tests/storage.test.js` (the one that used `wardId`/`departmentId` the old way) with the new shape:

```javascript
test('unit under department, ward under unit', async () => {
  await store.createOrganization({ id: 'o1', name: 'O', plan: 'free' });
  await store.createHospital({ id: 'h1', orgId: 'o1', name: 'H' });
  await store.createDepartment({ id: 'd1', hospitalId: 'h1', name: 'Ortho' });
  await store.createUnit({ id: 'u1', departmentId: 'd1', name: 'IV' });
  await store.createWard({ id: 'w1', unitId: 'u1', name: '7FOW' });
  assert.equal((await store.getUnit('u1')).departmentId, 'd1');
  assert.equal((await store.getWard('w1')).unitId, 'u1');
  assert.deepEqual((await store.listUnitsByDepartment('d1')).map(u => u.id), ['u1']);
  assert.deepEqual((await store.listWardsByUnit('u1')).map(w => w.id), ['w1']);
  await store.updateUnit('u1', { name: 'IVb', departmentId: 'd1' });
  await store.updateWard('w1', { name: '7FOWb', unitId: 'u1' });
  assert.equal((await store.getUnit('u1')).name, 'IVb');
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `node --test tests/storage.test.js`
Expected: FAIL (`listUnitsByDepartment` not a function / wrong fields).

- [ ] **Step 3: SQLite.** In `storage.js` change the `wards` table to `(id TEXT PRIMARY KEY, unitId TEXT NOT NULL, name TEXT NOT NULL, createdAt INTEGER NOT NULL)` with index `idx_wards_unitId ON wards(unitId)`; change `units` to `(id, departmentId, name, createdAt)` with index `idx_units_departmentId ON units(departmentId)`. Add migrations for existing DBs near line 122: `addColumnIfMissing(db,'units','departmentId','TEXT'); addColumnIfMissing(db,'wards','unitId','TEXT');`. Replace the methods:

```javascript
    async createWard(ward){
      db.prepare(`INSERT INTO wards (id, unitId, name, createdAt) VALUES (?, ?, ?, ?)`)
        .run(ward.id, ward.unitId, ward.name, ward.createdAt || Date.now());
    },
    async getWard(id){ return db.prepare('SELECT * FROM wards WHERE id = ?').get(id) || null; },
    async listWardsByUnit(unitId){
      return db.prepare('SELECT * FROM wards WHERE unitId = ? ORDER BY createdAt ASC').all(unitId);
    },
    async createUnit(unit){
      db.prepare(`INSERT INTO units (id, departmentId, name, createdAt) VALUES (?, ?, ?, ?)`)
        .run(unit.id, unit.departmentId, unit.name, unit.createdAt || Date.now());
    },
    async getUnit(id){ return db.prepare('SELECT * FROM units WHERE id = ?').get(id) || null; },
    async listUnitsByDepartment(departmentId){
      return db.prepare('SELECT * FROM units WHERE departmentId = ? ORDER BY createdAt ASC').all(departmentId);
    },
    async updateWard(id, patch){ updateRow(db, 'wards', id, patch, ['name','unitId']); },
    async updateUnit(id, patch){ updateRow(db, 'units', id, patch, ['name','departmentId']); },
```

- [ ] **Step 4: Mongo.** In `createMongoStore` update the indexes to `wards.createIndex({ unitId: 1 })` and `units.createIndex({ departmentId: 1 })`, and replace the methods:

```javascript
    async createWard(ward){ await wards.insertOne({ _id: ward.id, unitId: ward.unitId, name: ward.name, createdAt: ward.createdAt || Date.now() }); },
    async getWard(id){ const d = await wards.findOne({ _id: id }); return d ? { id: d._id, unitId: d.unitId, name: d.name, createdAt: d.createdAt } : null; },
    async listWardsByUnit(unitId){ const a = await wards.find({ unitId }).sort({ createdAt: 1 }).toArray(); return a.map(d => ({ id: d._id, unitId: d.unitId, name: d.name, createdAt: d.createdAt })); },
    async createUnit(unit){ await units.insertOne({ _id: unit.id, departmentId: unit.departmentId, name: unit.name, createdAt: unit.createdAt || Date.now() }); },
    async getUnit(id){ const d = await units.findOne({ _id: id }); return d ? { id: d._id, departmentId: d.departmentId, name: d.name, createdAt: d.createdAt } : null; },
    async listUnitsByDepartment(departmentId){ const a = await units.find({ departmentId }).sort({ createdAt: 1 }).toArray(); return a.map(d => ({ id: d._id, departmentId: d.departmentId, name: d.name, createdAt: d.createdAt })); },
    async updateWard(id, patch){ await mongoUpdate(wards, id, patch, ['name','unitId']); },
    async updateUnit(id, patch){ await mongoUpdate(units, id, patch, ['name','departmentId']); },
```

- [ ] **Step 5: Fix the compile-time consumers so the suite loads.** Grep `grep -rn "listUnitsByWard\|listWardsByDepartment" *.js scripts/*.js` — these break. Do NOT fully rewrite them here (Tasks 2/4/5/7 own them); just make them reference the new method names where a one-for-one swap is obvious (`hierarchy.js`, `structure.js childrenOf`, `admin.js`, `scripts/backfill-hierarchy.js`). Deeper logic changes belong to later tasks; if a consumer needs more than a rename, leave a failing test for that task rather than half-implementing here. The goal of this step is only that `node --test` can load modules.

- [ ] **Step 6: Run tests + full suite.**

Run: `node --test tests/storage.test.js && npm test`
Expected: storage test PASS. Other suites may fail where they assert the OLD tree shape — that is expected and owned by Tasks 2-5/7. Record which suites fail in the commit message; do not fix them here beyond the mechanical renames of Step 5.

- [ ] **Step 7: Commit.**

```bash
git add storage.js tests/storage.test.js hierarchy.js structure.js admin.js scripts/backfill-hierarchy.js
git commit -m "feat: flip unit/ward FKs — unit under department, ward under unit (storage)"
```

---

### Task 2: `hierarchy.js` — shorten ancestry + unit-set walk

**Files:**
- Modify: `hierarchy.js`
- Test: `tests/hierarchy.test.js`

**Interfaces:**
- Produces: `resolveAncestry(store, unitId) → {unitId, departmentId, hospitalId, orgId} | null` (unit→department→hospital→org, no ward). `listUnitIdsUnder(store, node)`: `unit`→itself; `department`→`listUnitsByDepartment`; `hospital`→units under its departments; `org`→all units in org; `ward`→its parent unit id. New `wardUnitId(store, wardId) → unitId | null`.

- [ ] **Step 1: Rewrite the tests.** Replace `tests/hierarchy.test.js` fixtures to the new shape (`o1→h1→d1→u1`, `u1→w1`, `u1→w2`, second unit `u2` under `d1`). Assert:

```javascript
test('resolveAncestry walks unit→department→hospital→org', async () => {
  assert.deepEqual(await resolveAncestry(store, 'u1'), { unitId: 'u1', departmentId: 'd1', hospitalId: 'h1', orgId: 'o1' });
});
test('listUnitIdsUnder department returns its units', async () => {
  assert.deepEqual([...await listUnitIdsUnder(store, { type: 'department', id: 'd1' })].sort(), ['u1', 'u2']);
});
test('listUnitIdsUnder unit returns itself; ward returns its parent unit', async () => {
  assert.deepEqual([...await listUnitIdsUnder(store, { type: 'unit', id: 'u1' })], ['u1']);
  assert.deepEqual([...await listUnitIdsUnder(store, { type: 'ward', id: 'w1' })], ['u1']);
});
test('wardUnitId returns the ward parent unit', async () => {
  assert.equal(await wardUnitId(store, 'w1'), 'u1');
});
```

- [ ] **Step 2: Run, verify fail.**

Run: `node --test tests/hierarchy.test.js`
Expected: FAIL.

- [ ] **Step 3: Rewrite `hierarchy.js`.**

```javascript
/* Tree walking for the MULTI_TENANT hierarchy:
   organizations → hospitals → departments → units → wards.
   Unit is the scoping leaf; ward is an optional location under a unit. */

export async function resolveAncestry(store, unitId){
  if(!unitId) return null;
  const unit = await store.getUnit(unitId);
  if(!unit) return null;
  const dep = await store.getDepartment(unit.departmentId);
  if(!dep) return null;
  const hospital = await store.getHospital(dep.hospitalId);
  if(!hospital) return null;
  return { unitId: unit.id, departmentId: dep.id, hospitalId: hospital.id, orgId: hospital.orgId };
}

export async function wardUnitId(store, wardId){
  if(!wardId) return null;
  const ward = await store.getWard(wardId);
  return ward ? ward.unitId : null;
}

async function unitsUnderDepartment(store, depId, out){
  for(const u of await store.listUnitsByDepartment(depId)) out.add(u.id);
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
    case 'ward': { const uid = await wardUnitId(store, node.id); if(uid) out.add(uid); break; }
    case 'department': await unitsUnderDepartment(store, node.id, out); break;
    case 'hospital': await unitsUnderHospital(store, node.id, out); break;
    case 'org': await unitsUnderOrg(store, node.id, out); break;
  }
  return out;
}
```

- [ ] **Step 4: Run tests, verify pass; full suite (expect other-suite fails owned by later tasks).**

Run: `node --test tests/hierarchy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add hierarchy.js tests/hierarchy.test.js
git commit -m "feat: hierarchy walks unit->department->hospital->org; wardUnitId helper"
```

---

### Task 3: `scope.js` + sync ward validation

**Files:**
- Modify: `scope.js` (no signature change; consumes 4-key ancestry), `server.js` (sync write loop — validate optional `wardId`)
- Test: `tests/scope.test.js`, `tests/server-scoping.test.js`

**Interfaces:**
- Consumes: `resolveAncestry` (4-key), `wardUnitId` (Task 2). `canRead`/`resolveScope`/`decideWrite` keep their signatures; `decideWrite`'s `ancestry` is now 4-key.
- Produces: the sync write path, after stamping ancestry, keeps `stored.wardId` only if `wardUnitId(stored.wardId) === stored.unitId`, else deletes it (server-authoritative clear).

- [ ] **Step 1: Update scope tests** to the new fixtures (unit under department; no ward in ancestry). Keep member/dept-admin/instance cases; assert `decideWrite` new-patient ancestry has no `wardId` key. Add a sync test in `tests/server-scoping.test.js`: a member syncs a patient with a valid `wardId` (a ward under their unit) → stored keeps it; a member syncs a patient whose `wardId` belongs to a DIFFERENT unit → stored drops `wardId` (unitId still correct).

- [ ] **Step 2: Run, verify fail.**

Run: `node --test tests/scope.test.js tests/server-scoping.test.js`
Expected: FAIL.

- [ ] **Step 3: Update `scope.js`.** Only the ancestry shape changes (fewer keys); the logic is unchanged. Ensure no code references `ancestry.wardId`. `canRead` still keys on `patient.unitId`.

- [ ] **Step 4: Add ward validation in the sync loop** (`server.js`, the block that stamps `decision.ancestry` onto `stored`). After the existing ancestry stamp + label derivation, add:

```javascript
          // Optional ward: keep only if it sits under the patient's unit; else clear (server-authoritative).
          if(stored.wardId){
            const wUnit = await wardUnitId(store, stored.wardId);
            if(wUnit !== stored.unitId){ delete stored.wardId; }
            else { const w = await store.getWard(stored.wardId); if(w) stored.ward = w.name; }
          }
```

Import `wardUnitId` from `./hierarchy.js` in `server.js`. Note: `restampUnits`/`restampPatient` in `structure.js` (Task 4) get the same treatment; ancestry no longer sets `stored.ward` from an ancestor ward — the ward label now comes from the patient's own optional `wardId`.

- [ ] **Step 5: Run tests, verify pass.**

Run: `node --test tests/scope.test.js tests/server-scoping.test.js`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add scope.js server.js tests/scope.test.js tests/server-scoping.test.js
git commit -m "feat: 4-key ancestry; sync keeps optional ward only if under the patient's unit"
```

---

### Task 4: `structure.js` parent maps + re-stamp + rehome ward validation

**Files:**
- Modify: `structure.js` (PARENT_TYPE/PARENT_FIELD, `childrenOf`, `nodeOrgId`, `restampUnits`/`restampPatient` ward handling), `server.js` (rehome route ward validation)
- Test: `tests/server-structure.test.js`

**Interfaces:**
- Produces: `PARENT_TYPE = { department:'hospital', unit:'department', ward:'unit' }`; `PARENT_FIELD = { department:'hospitalId', unit:'departmentId', ward:'unitId' }`; `childrenOf`: department→`listUnitsByDepartment`, unit→`listWardsByUnit`, ward→[]; `nodeOrgId`: unit→department, ward→unit. `restampUnits`/`restampPatient` derive `unit` label from the unit node and keep the patient's own optional `wardId`/`ward` label (validated), no ancestor ward.

- [ ] **Step 1: Update tests.** In `tests/server-structure.test.js`: move `unit → department` and `ward → unit` (the new parent types); wrong-type parent rejected; delete-empty of a unit blocked by its wards/patients; **rehome** to a unit accepts a patient and, if the request includes a `wardId` not under that unit, returns 400 (validate-before-write); a rehome with a valid ward under the target unit stores it.

- [ ] **Step 2: Run, verify fail.**

Run: `node --test tests/server-structure.test.js`
Expected: FAIL.

- [ ] **Step 3: Update `structure.js`.** Set:

```javascript
export const PARENT_TYPE = { department: 'hospital', unit: 'department', ward: 'unit' };
const PARENT_FIELD = { department: 'hospitalId', unit: 'departmentId', ward: 'unitId' };
```

`nodeOrgId`: `case 'unit': return nodeOrgId(store, 'department', node.departmentId);` and `case 'ward': return nodeOrgId(store, 'unit', node.unitId);`. `childrenOf`: `case 'department': return await store.listUnitsByDepartment(id);` and `case 'unit': return await store.listWardsByUnit(id);` and `case 'ward': return [];`. In `restampUnits`/`restampPatient`, set `o.unit` from the unit node name; for the ward label, keep the patient's existing `o.wardId` only if `wardUnitId(o.wardId)===o.unitId` (else delete `o.wardId`/`o.ward`) and set `o.ward` from that ward's name (import `wardUnitId`). Ancestry object is the 4-key from `resolveAncestry`.

- [ ] **Step 4: Add rehome ward validation** in the `server.js` rehome route: accept optional `body.wardId`; after resolving the target unit, if `wardId` is provided and `wardUnitId(store, wardId) !== unitId`, return `400 {error:'Ward is not under this unit'}` before any write; on success set each patient's `wardId` (or clear if none).

- [ ] **Step 5: Run tests, verify pass; full suite.**

Run: `node --test tests/server-structure.test.js && npm test`
Expected: PASS (Tasks 1-4 together restore green except admin-tree shape in Task 5).

- [ ] **Step 6: Commit.**

```bash
git add structure.js server.js tests/server-structure.test.js
git commit -m "feat: flip structural parent maps; rehome validates optional ward under unit"
```

---

### Task 5: `admin.js` — nest department → unit → ward in the org tree

**Files:**
- Modify: `admin.js` (`buildOrgTree`)
- Test: `tests/admin.test.js`, `tests/server-admin-console.test.js`

**Interfaces:**
- Produces: `GET /api/admin/org` tree shape `hospitals:[{…, departments:[{…, units:[{id,name,stats, wards:[{id,name,stats}]}]}]}]` (units now hold wards, not the reverse), with per-unit `livePatients`/`byStatus` rolled up to department/hospital/org, and per-ward `livePatients` for patients carrying that `wardId`.

- [ ] **Step 1: Update tests** in `tests/admin.test.js` to build department→unit→ward and assert the tree nests units under departments and wards under units, with unit stats counting patients by `unitId` and ward stats counting patients by optional `wardId`. Update any `server-admin-console.test.js` assertion that walked `department.wards`.

- [ ] **Step 2: Run, verify fail.**

Run: `node --test tests/admin.test.js tests/server-admin-console.test.js`
Expected: FAIL.

- [ ] **Step 3: Rewrite the `buildOrgTree` nesting** so each department lists `units` via `listUnitsByDepartment`, and each unit lists `wards` via `listWardsByUnit`. Aggregate live-patient/byStatus per unit (patients whose `unitId` matches), roll up to department/hospital/org totals, and count per-ward patients by matching optional `wardId`. Keep the existing top-level `totals` keys working (add `units`/`wards` counts).

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `node --test tests/admin.test.js tests/server-admin-console.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add admin.js tests/admin.test.js tests/server-admin-console.test.js
git commit -m "feat: org tree nests department -> unit -> ward with rolled-up stats"
```

---

### Task 6: Frontend — admin tree + assignment picker + patient picker

**Files:**
- Modify: `public/app.js` (admin render `renderAdminOrgSectionHTML`/`renderAdminWardRowHTML` and the assignment `buildAssignNodeGroups`; the patient-form cascading picker), `public/index.html` (any `.admin-*` markup that assumes ward-holds-units)
- Test: `tests/frontend-admin-view.test.js`, `tests/frontend-unit-picker.test.js`

**Interfaces:**
- Consumes: `GET /api/admin/org` new nesting (department→unit→ward). Produces: department cards render **unit** rows, each with an add-ward form + child wards; the assignment picker optgroups Departments / **Units** / Wards (+ Hospitals/Orgs as already present); the patient form cascading picker is **Department → Unit (required) → Ward (optional)** posting `unitId` (+ optional `wardId`).

- [ ] **Step 1: Update the failing jsdom tests.** In `tests/frontend-admin-view.test.js`: a fixture tree with department→unit→ward renders a per-unit row and per-ward chip; the add-ward form posts `/api/admin/wards {unitId, name}` and add-unit posts `/api/admin/units {departmentId, name}`. In `tests/frontend-unit-picker.test.js`: the patient picker offers Department→Unit→Ward; selecting a unit is required and a ward is optional; saving posts a payload with `unitId` and (if chosen) `wardId`; a single-unit member has the unit pre-filled and ward left optional.

- [ ] **Step 2: Run, verify fail.**

Run: `node --test tests/frontend-admin-view.test.js tests/frontend-unit-picker.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `public/app.js`: rename/rework `renderAdminWardRowHTML` → a unit-row renderer that lists the unit's child wards (chips) + an add-ward form (`POST /api/admin/wards {unitId, name}`); the department card lists units and has an add-unit form (`POST /api/admin/units {departmentId, name}`). Update `buildAssignNodeGroups` to walk department→unit→ward (units grouped under Departments, wards under Units). Update the patient-form cascading picker to Department→Unit(required)→Ward(optional): the Unit select is required; the Ward select includes a blank "— none —" and only lists wards under the chosen unit; on save set `d.unitId` (required) and `d.wardId` (or delete it if none). Keep the flag-off legacy free-text path unchanged.

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `node --test tests/frontend-admin-view.test.js tests/frontend-unit-picker.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add public/app.js public/index.html tests/frontend-admin-view.test.js tests/frontend-unit-picker.test.js
git commit -m "feat: admin tree + pickers for department -> unit -> ward"
```

---

### Task 7: v2 backfill migration script

**Files:**
- Create: `scripts/backfill-hierarchy-v2.js`
- Test: `tests/backfill-hierarchy-v2.test.js`

**Interfaces:**
- Produces: `async backfillV2(store, {singleBucket=false}) → {orgId, created:{hospitals,departments,units,wards}, stamped, assignedUsers}`. Store-agnostic, idempotent, with a `main` guard building the store from env like `scripts/backfill-hierarchy.js`.

- [ ] **Step 1: Write failing tests.** `tests/backfill-hierarchy-v2.test.js`: seed patients with JSON `{ward:'7FOW',unit:'IV'}`, `{ward:'7 fow',unit:'IV'}`, `{ward:'',unit:'IV'}`, `{ward:'3MOW',unit:''}` (no ancestry). Run `backfillV2(store)`; assert (a) every active patient has a `unitId`; (b) all three `IV` patients share ONE unit (consolidated), and the blank-unit patient is under a `General` unit; (c) the `{ward:'',...}` patient has **no** `wardId` (ward optional); (d) `7FOW`/`7 fow` collapse to one ward under the IV unit; (e) re-running creates zero new units/wards (idempotent); (f) a pre-seeded member with no assignment is assigned to the org root.

- [ ] **Step 2: Run, verify fail.**

Run: `node --test tests/backfill-hierarchy-v2.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `scripts/backfill-hierarchy-v2.js`.** Model it on `scripts/backfill-hierarchy.js` but with the inverted shape: ensure default `Organization('Default') → Hospital('Default') → Department('Ortho')` by fixed sentinel ids. `norm(s)=String(s||'').trim().toLowerCase().replace(/\s+/g,'')`. Per active patient: `unitKey = singleBucket ? 'general' : (norm(p.unit) || 'general')`; find-or-create the **Unit** under the department by deterministic id `bfv2-unit-<unitKey>` (name = original unit label or `'General'`). Then if `norm(p.ward)` is non-empty (and not singleBucket): `wardKey=norm(p.ward)`, find-or-create the **Ward** under that unit by id `bfv2-ward-<unitKey>-<wardKey>` (name = original ward label); else no ward. Stamp `{unitId, departmentId, hospitalId, orgId}` from `resolveAncestry(store, unitId)`, set `data.wardId` (or delete it if no ward), set `data.unit`=unit name and `data.ward`=ward name (or clear). Re-point users: build a map of old unit ids → their normalized unit label; for each user with an assignment whose node no longer resolves, re-point to the consolidated unit matching its label, else the org root; unassigned non-instance-admins → org root. Export `backfillV2`; add the `main` guard.

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `node --test tests/backfill-hierarchy-v2.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add scripts/backfill-hierarchy-v2.js tests/backfill-hierarchy-v2.test.js
git commit -m "feat: v2 backfill — department -> unit -> ward, consolidates unit duplicates"
```

---

### Task 8: Flag-off golden guards refresh + rollout runbook

**Files:**
- Modify: `tests/server-sync-golden.test.js` (confirm flag-off still 404s all admin/structural routes and sync adds no ancestry), `docs/DEPLOY-phase2.md` (append a "Re-model cutover" section)
- Test: as above

**Interfaces:** none (verification + docs).

- [ ] **Step 1: Confirm/extend golden guards.** Ensure `tests/server-sync-golden.test.js` still asserts, flag-off: the structural + admin routes 404 and a synced patient gets **no** `unitId`/`wardId`/ancestry added (byte-identical). Adjust any assertion that referenced the old tree.

- [ ] **Step 2: Run, verify pass.**

Run: `node --test tests/server-sync-golden.test.js`
Expected: PASS.

- [ ] **Step 3: Write the runbook section.** Append to `docs/DEPLOY-phase2.md` a "Re-model cutover (Department → Unit → Ward)" section: (1) `/api/export` backup; (2) set `ORTHO_FLAG_MULTI_TENANT=0`; (3) deploy the re-model build; (4) run `node scripts/backfill-hierarchy-v2.js` against Mongo; (5) verify with `scripts/inspect-prod.js` that every active patient has a `unitId`, each non-null `wardId` sits under its unit, units are consolidated (no per-ward duplicates), and users have resolvable assignments; (6) set `ORTHO_FLAG_MULTI_TENANT=1`; (7) confirm clinicians see their patients. Rollback = `flag=0`.

- [ ] **Step 4: Full suite green.**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/server-sync-golden.test.js docs/DEPLOY-phase2.md
git commit -m "test+docs: flag-off guards refresh + re-model cutover runbook"
```

---

## Self-Review

**Spec coverage:** §1 data model → Task 1; §2 hierarchy → Task 2; §3 scope + ward validation → Task 3 (sync clear) + Task 4 (rehome 400); §4 structural ops → Task 4; §5 error handling → Tasks 3/4; §6 migration → Task 7 + Task 8 runbook; §7 admin/UI → Tasks 5-6; §8 testing → each task TDD + Task 8 golden. No gaps.

**Placeholder scan:** backend tasks (1-5,7) carry complete code; frontend Task 6 names exact functions (`renderAdminWardRowHTML`, `buildAssignNodeGroups`, `renderAdminOrgSectionHTML`), routes, payload keys, and pre-fill rules rather than full HTML — consistent with the large existing render file and prior phases. Task 1 Step 5/6 deliberately leaves later-owned suites red with the reason recorded, rather than a placeholder fix.

**Type consistency:** `resolveAncestry` returns `{unitId, departmentId, hospitalId, orgId}` (no ward) in Task 2 and is consumed identically in Tasks 3/4/7. `wardUnitId(store, wardId)` defined in Task 2, used in Tasks 3/4. Storage method names (`listUnitsByDepartment`, `listWardsByUnit`, `createUnit({departmentId})`, `createWard({unitId})`) from Task 1 are used verbatim in Tasks 2/4/5/7. `PARENT_TYPE`/`PARENT_FIELD` flip in Task 4 matches the FK fields from Task 1. Route payloads (`/api/admin/units {departmentId,name}`, `/api/admin/wards {unitId,name}`) are consistent between Task 4/5 backend and Task 6 frontend.
