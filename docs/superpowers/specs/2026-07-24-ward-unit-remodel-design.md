# Ward/Unit Re-model: Department → Unit → Ward — Design

**Date:** 2026-07-24
**Status:** Approved (design). Scope: invert the bottom two levels of the MULTI_TENANT tree so a **Unit** (clinical team) sits directly under a Department and a **Ward** (physical location) sits **optionally** under a Unit. Includes the data-model change, scoping adjustment, a v2 backfill migration for the live (flag-on) production data, and the admin/UI adaptation. Ward-level ("nurse") scoping is deferred but the model is positioned for it.

## Problem

The shipped tree is strict-nested `Organization → Hospital → Department → Ward → Unit`: a Unit belongs to exactly one Ward, and a patient pinned to a Unit inherits that one Ward. This does not match ortho reality, where a **Unit is a team/firm** (e.g. "Unit IV") whose patients are spread across **multiple physical Wards** (7MOW, 7FOW, 3SPW, 3MOW), and a Ward holds patients from several units. The current backfill even fragments a team into one Unit node per ward. We need a model where a unit's patients span wards.

## Decisions (settled with Xavier)

- **Invert to `Department → Unit → Ward`.** Unit is the team and the scoping leaf; Ward is an **optional** physical location under a unit.
- **Patient pinned to a Unit (required); Ward optional.** A patient's `wardId`, when set, must be a ward under that patient's unit.
- **Scoping stays on the Unit axis** for now. A user assigned to a Unit sees all its patients across all its wards. Ward-level scoping (the future **nurse** case — see everyone on a ward across teams) is **deferred**; the model leaves it reachable.
- **Migrate by re-deriving the tree from patients' free-text `ward`/`unit` labels** (a v2 backfill), consolidating the fragmented per-ward unit duplicates, rather than surgically inverting FKs in place.

## Non-negotiables

- **Flag off → byte-identical.** With `MULTI_TENANT` off: no scoping, no ancestry stamping; existing suite + `tests/server-sync-golden.test.js` green. SQLite self-host path unchanged.
- **Cross-org isolation preserved.** All scoping/structural guards keep rejecting cross-org references (403).
- **Server-authoritative ancestry.** Ancestry re-derived from `tree + unitId`, never trusted from a client. The optional `wardId` is validated server-side against the patient's unit.
- **No patient stranded on migration.** The v2 backfill completes and is verified before the flag is (re-)enforced.

## Design

### 1. Data model (both backends)

Two foreign keys flip:

- `units` table: replace `wardId` with **`departmentId`** (Unit's parent is a Department). Storage methods: `createUnit({id, departmentId, name})`, `listUnitsByDepartment(departmentId)` (replaces `listUnitsByWard`), `updateUnit` whitelist gains `departmentId`, loses `wardId`.
- `wards` table: replace `departmentId` with **`unitId`** (Ward's parent is a Unit). Storage methods: `createWard({id, unitId, name})`, `listWardsByUnit(unitId)` (replaces `listWardsByDepartment`), `updateWard` whitelist gains `unitId`, loses `departmentId`.

SQLite: adjust the `CREATE TABLE`/index definitions and add `addColumnIfMissing` for the new columns; the old columns become unused (left in place, harmless) or dropped via table rebuild — leaving them is acceptable at pilot scale. Mongo: field rename is data-level (handled by the v2 backfill re-creating rows).

**Patient record (JSON, no patients-table schema change):** `unitId` required (scope). `wardId` optional — when present, must reference a ward whose `unitId === patient.unitId`. Denormalized ancestry becomes `{unitId, departmentId, hospitalId, orgId}` (no `wardId` in the required chain); `wardId` rides independently. Display labels `p.ward`/`p.unit` still derive from node names.

### 2. `hierarchy.js`

- `resolveAncestry(store, unitId)` walks unit → department (`unit.departmentId`) → hospital → org → `{unitId, departmentId, hospitalId, orgId}` (no ward level).
- `listUnitIdsUnder(store, node)`: `unit` → itself; `department` → `listUnitsByDepartment`; `hospital` → units under all its departments; `org` → all units in the org; `ward` → its parent unit id (so a future ward assignment still resolves — but see §3, not wired for scope now).
- New helper `wardUnitId(store, wardId)` → the ward's `unitId`, for validating a patient's optional ward.

### 3. `scope.js`

- `resolveScope` unchanged in shape: resolves the assignment node to a `unitIds` set via `listUnitIdsUnder`. `canRead(patient, scope)` unchanged (`patient.unitId ∈ scope.unitIds`, unassigned → instance-admin-only).
- `decideWrite` unchanged in stamping logic (ancestry from `unitId`), but `resolveAncestry` now returns the 4-key ancestry. **New:** after deciding the unit, validate the incoming optional `wardId` — allow only if the ward's `unitId` equals the resolved unit; a mismatched ward → reject the write (400, see §5), not silently coerced. Clearing ward (`wardId` absent/null) is always allowed.

### 4. Structural operations (`structure.js` + routes)

Carry over unchanged in behavior; only the parent maps flip:

- `PARENT_TYPE = { unit: 'department', ward: 'unit' }` (department still → hospital). `PARENT_FIELD = { unit: 'departmentId', ward: 'unitId' }` (department → hospitalId unchanged).
- `childrenOf`: department → units; unit → wards; ward → [].
- Move: `unit → department`, `ward → unit`, `department → hospital`, all within org. Re-stamp uses `listUnitIdsUnder` over the moved subtree as before.
- Delete-empty, rename (ward/unit rename still refreshes patient labels), re-home, bulk-assign, repair-ancestry — unchanged except they operate on the new parent relationships.

### 5. Error handling

- Optional `wardId` not under the patient's unit → `400 {error:'Ward is not under this unit'}` on the patient write / re-home; the operation is rejected (validate-before-write), not silently coerced.
- All existing 400/403/404/409 semantics from the structural-ops layer carry over.
- Names trimmed/required/≤80.

### 6. Migration — v2 backfill (flag-off cutover)

Production is live with `MULTI_TENANT` on in the old shape, so new code cannot read old rows. Cutover:

1. **Flag off** (`ORTHO_FLAG_MULTI_TENANT=0`) — single-tenant, everyone sees everything, safe (single org).
2. **Deploy** the v2 build (flag off → byte-identical).
3. **Run the v2 backfill** (`scripts/backfill-hierarchy-v2.js`, store-agnostic, idempotent) against Mongo:
   - Ensure default `Organization → Hospital → Department` (reuse the existing sentinel ids if present).
   - For each active patient: find-or-create its **Unit** under the department keyed on the normalized `unit` label (so "IV" collapses to one unit, not one-per-ward; blank → a `General` unit). Then, if the `ward` label is non-blank, find-or-create its **Ward** under that unit (normalized); blank → leave the patient ward-less.
   - Stamp `{unitId, departmentId, hospitalId, orgId}` + optional `wardId`; refresh `ward`/`unit` labels.
   - Re-point user assignments: map any assignment that referenced an old unit id (or an old ward node) to the consolidated new unit; if unmappable, fall back to the org/department root. Instance admin stays unrestricted.
   - Idempotent: deterministic ids; re-run creates nothing new.
4. **Verify** (inspect script): every active patient has a valid `unitId`; every non-null `wardId` sits under its unit; users have resolvable assignments.
5. **Flag on.** Rollback at any step: `flag=0`.

### 7. Admin console & UI

- Tree view: Department → **Unit** cards; each unit shows its optional child **Wards** and add-ward form; department shows add-unit form. (One level of nesting swaps places vs today.)
- Assignment picker groups: Organizations / Hospitals / Departments / **Units** / Wards (org level per the separate command-center work).
- Patient form cascading picker: **Department → Unit (required) → Ward (optional)**; a single-unit member gets the unit pre-filled; ward always optional.

### 8. Testing (Mongo-parity via SQLite harness)

- `hierarchy.test.js`: `resolveAncestry` walks unit→department→hospital→org (4 keys); `listUnitIdsUnder` resolves department→its units, unit→itself.
- `scope.test.js`: a patient with a unit and **no** ward reads/syncs; a member scoped to a unit sees its patients regardless of ward.
- Write validation: a `wardId` whose unit ≠ the patient's unit → 400; clearing ward allowed.
- Structural ops: move `unit→department` / `ward→unit`; wrong-type parent rejected; re-stamp correctness with the new walk.
- v2 backfill: duplicate-labeled units consolidate to one; blank-ward patients stay ward-less; idempotent re-run; no stranded patient; assignment re-pointing.
- Flag-off golden guards stay green.

## Out of scope

Ward-level (nurse) scoping (deferred; model supports adding it); dropping the now-unused old SQLite columns (left in place); the command-center UI redesign (its own spec); promoting the app-layer patient scan to indexed queries.
