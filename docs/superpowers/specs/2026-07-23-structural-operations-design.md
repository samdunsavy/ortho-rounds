# Spec 1: Structural Operations Backend — Design

**Date:** 2026-07-23
**Status:** Approved (design). Scope: the headless backend that lets an admin reshape the live hierarchy — rename, delete-empty, move (re-parent) nodes, bulk re-home patients between units, and bulk-assign users — with server-authoritative ancestry kept consistent. This is the foundation for **Spec 2: the command-center admin UI** (separate spec), which drives these operations. Build this first.

## Problem

Phase 2 shipped the `Organization → Hospital → Department → Ward → Unit` tree, unit-based scoping, and node creation + per-user assignment. But the tree can only *grow*: there is no way to rename a node (so the backfill's auto-generated `Default`/`Ortho`/`General` are permanent), delete an empty node, move a node under a different parent, or move patients between units. A "master control" admin experience is impossible without these operations, and they must preserve the core guarantee: every patient's denormalized ancestry (`orgId, hospitalId, departmentId, wardId, unitId` + derived `ward`/`unit` labels) stays server-authoritative and cross-org isolation holds.

## Non-negotiables

- **Flag off → byte-identical.** With `MULTI_TENANT` off: all new routes 404; `structure.js` unused; existing suite + `tests/server-sync-golden.test.js` green.
- **Cross-org isolation.** Every node/patient/user reference is ownership-checked with the shipped primitives (`isInstanceAdmin`, `nodeInOrg`, `target.orgId === actor.orgId`); any cross-org reference → `403`. A move never silently re-parents across orgs.
- **Server-authoritative ancestry.** Ancestry is always re-derived from `tree + unitId`, never trusted from a client and never incremented. Every operation leaves affected patients with ancestry consistent with the tree.
- **No schema changes.** Reuse the existing tables/collections and the denormalized ancestry.

## Decisions (settled with Xavier)

- **Full structural control:** rename + delete + move nodes, plus bulk re-home patients and bulk user-assign.
- **Delete-empty-only:** a node deletes only when it has no children, no assigned users, and no patients; otherwise `409`. (Cascade delete is explicitly out of scope.)
- **Eager, idempotent re-stamp** for any operation that changes a patient's ancestry (move-node, re-home): recompute and write the new ancestry + labels for every affected patient in the request, derived purely from the updated tree. Idempotent, so a retry or `repair-ancestry` heals a partial failure (Mongo has no multi-doc transactions here).
- **Org-level assignment is already supported** by the backend (`nodeType:'org'` in assign + `resolveScope`); that gap is purely Spec-2 UI and is out of scope here.

## Design

### 1. Shared module `structure.js`

Two idempotent primitives, pure store-interface consumers, reused across routes:

- `async restampUnits(store, unitIdSet)` — for every **active** patient whose `unitId ∈ unitIdSet`, recompute `resolveAncestry(store, unitId)` and set `ward`/`unit` labels from the ward/unit node names, then `upsertPatient` (preserving `deleted`, bumping `updatedAt`). Used by move-node and repair.
- `async restampPatient(store, patient, unitId)` — pin a patient to `unitId`, then stamp ancestry + labels as above. Used by re-home.

Both derive everything from the tree; running them repeatedly yields identical state.

### 2. Routes (all flag-gated: `MULTI_TENANT` off → 404; admin-guarded; org-scoped)

`:type ∈ {org, hospital, department, ward, unit}`. Names trimmed/required/≤ 80 chars.

- **`PATCH /api/admin/nodes/:type/:id`** `{name, specialty?}` → rename a node (specialty applies to departments only). Validate node ∈ caller's org (instance admin: any). On a **ward or unit** rename, eagerly refresh the derived `ward`/`unit` labels of affected patients via `restampUnits` over that node's units (name change only — ancestry/scope unchanged). Returns the updated node.
- **`DELETE /api/admin/nodes/:type/:id`** → delete-empty-only. Compute non-emptiness: any child nodes, any users assigned to this node, or any active patients under its subtree. If non-empty → `409 {error, blockedBy: {children, users, patients}}` (counts). Else delete the row. Cross-org → 403.
- **`POST /api/admin/nodes/:type/:id/move`** `{newParentId}` → re-parent within the **same org**. Allowed: `department` → another hospital, `ward` → another department, `unit` → another ward. `org`/`hospital` cannot move (→ `400`). `newParentId` must exist, be the correct parent type, and be in the same org as the node (else `403`). Update the node's parent FK, then `restampUnits` over the moved subtree's unit set. Returns the moved node.
- **`POST /api/admin/patients/rehome`** `{patientIds, unitId}` → validate-all-before-write: every `patientId` must be readable in the caller's scope and the target `unitId` in the caller's org; any failure → `403` and **no writes**. Then `restampPatient(store, patient, unitId)` for each. Returns `{moved: n}`.
- **`POST /api/admin/users/assign-bulk`** `{userIds, nodeType, nodeId}` → validate-all-before-write: all `userIds` and the target node ∈ caller's org; `nodeId:null` unassigns. Then `updateUser` each with `assignmentType`/`assignmentId`. Returns `{assigned: n}`.
- **`POST /api/admin/repair-ancestry`** (instance-admin only) → `restampUnits` over *all* units in the tree (i.e. re-stamp every active patient from the tree). The idempotent safety net if a bulk op partially failed. Returns `{restamped: n}`.

### 3. Guards & helpers

Reuse `isInstanceAdmin`, `nodeInOrg`, `departmentInOrg`. Add small helpers as needed:

- `nodeChildren(store, type, id)` / `nodeHasPatients(store, type, id)` / `usersAssignedTo(store, type, id)` for the delete-empty check.
- Parent-type validation for move (unit→ward, ward→department, department→hospital).
- Bulk ops validate every reference before the first write.

### 4. Integrity & concurrency

Mongo has no multi-doc transactions here (`begin/commit/rollback` are no-ops), so correctness rests on **idempotency + validate-before-write**, not locking:

- Ancestry is re-derived from `tree + unitId`, never incremented — a re-run (or `repair-ancestry`) produces identical state, healing any partial failure.
- Bulk ops authorize every reference before any write, so an authorization failure never leaves a half-applied batch. (A mid-write infra failure can still leave a batch partially applied; `repair-ancestry` and re-running the op are the recovery, consistent with the app's last-write-wins model.)
- Concurrency is last-write-wins (pilot-scale single-org admin teams; batches are tens of patients). Renames refresh labels only; moves/re-homes re-stamp full ancestry.

### 5. Error handling

- Cross-org node/patient/user reference → `403 {error}`. Malformed body → `400`. Delete non-empty → `409 {error, blockedBy}`. Move of org/hospital or wrong-type parent → `400`. Unknown id → `404`.
- Bulk ops: validate-all-before-write; on any rejection, return the error and perform no writes.
- Names: trimmed, required, ≤ 80 chars.

### 6. Testing (Mongo-parity via the SQLite harness, existing pattern)

- **Rename:** node renamed; ward/unit rename refreshes affected patients' `ward`/`unit` labels; cross-org → 403; name validation.
- **Delete:** empty node deletes; non-empty → 409 with correct `blockedBy` counts; cross-org → 403.
- **Move:** re-parent within org re-stamps every descendant patient's full ancestry (assert all five keys + labels); wrong-type parent → 400; cross-org parent → 403; org/hospital move → 400.
- **Re-home:** patients repinned + re-stamped; an out-of-scope patient or target unit → 403 with **no** partial write.
- **Bulk-assign:** multiple users assigned; one cross-org id rejects the whole batch (no writes).
- **Idempotency:** running each bulk op twice yields identical state; `repair-ancestry` re-stamps all active patients from a deliberately corrupted fixture back to tree-consistent.
- **Flag-off:** all new routes 404; golden sync round-trip unchanged.

## Out of scope

All UI (Spec 2: the command center); cascade delete; moving org/hospital across orgs; promoting the app-layer patient scan to indexed queries (documented scaling step); audit log of structural changes.
