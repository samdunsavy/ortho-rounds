# PG Inline Ward Creation — Design

**Date:** 2026-07-26
**Status:** Approved (design). Scope: let a scoped member (PG) create a ward under their own unit directly from the patient form, removing the admin-console bottleneck. Wards remain structured nodes; no new data access is granted.

## Problem

Ward creation is admin-only (`POST /api/admin/wards` → `403` for members). In the patient form, the ward `<select>` (`f_ward`) lists only wards that already exist under the chosen unit; it is optional. So when a PG admits a patient to a ward that isn't in the tree yet, they are blocked: an admin must open the console, create the ward under the unit, and only then can the PG assign the patient to it. This round-trip happens on every new ward and doesn't scale.

Ward is currently an **optional, non-scoping** location node under a unit (`Department → Unit → Ward`; patient pinned to unit, ward is a subset label). A member already sees every patient in their unit, so letting them create a ward under that unit grants no new visibility. Ward stays a structured node (not free text) because ward-based "nurse" scoping is a flagged future requirement and free text can't cleanly become a scoping axis.

## Non-negotiables

- **Flag off → byte-identical.** With `MULTI_TENANT` off: the new route 404s, the picker doesn't exist, existing suite + `tests/server-sync-golden.test.js` green.
- **Scope-bounded creation.** A member can create a ward **only** under a unit in their own scope (`scope.unitIds` from `resolveScope`). Any other unit, or any non-ward node type → `403`. Cross-org → `403`.
- **No new data access.** Creating a ward changes structure only; scoping still runs on the unit axis, so a PG gains no read access they didn't already have.
- **Server-authoritative, deduped.** Ward name is trimmed/validated server-side (`cleanName`, ≤ 80 chars) and deduped case-insensitively under the unit — an existing match is returned, never duplicated.
- **No schema changes.** Reuse the existing wards table/collection and `createWard`.

## Decisions (settled with Xavier)

- **Approach A — type-to-create in the ward picker.** The ward control lists existing wards first; typing a name with no match surfaces an explicit "Create '<name>'" row. Selecting it creates the ward and selects it. Chosen over a separate "+ Add ward" button (extra step/UI) and over free-text auto-create (invites typo-duplicates, no reuse visibility).
- **Any scoped member may create** — roles are just `admin`/`member`; a PG is a member assigned to a unit. Gating is by scope, not by a new sub-role.
- **Deliberate, not accidental** — creation is an explicit tap on the "Create '<name>'" row, not an implicit consequence of typing free text.
- **Eager create on selection** — the ward is created via API the moment the PG confirms it, then injected into the cached scope tree and selected; the patient save still posts only `wardId`. `decideWrite` is untouched.
- **Soft per-unit cap** — reject creation past a generous ceiling (50 wards/unit) with a clear error, guarding against runaway/accidental spam. Admins can rename or delete-empty via the existing console.

## Design

### 1. Route: `POST /api/wards` (flag-gated, member-accessible)

New member-accessible endpoint (distinct from the admin-only `POST /api/admin/wards`, which is unchanged).

- **Flag gate:** `MULTI_TENANT` off → 404 (consistent with the other multi-tenant routes).
- **Auth:** any authenticated actor (admin or member).
- **Body:** `{ unitId, name }`.
- **Validation & scope:**
  - Resolve the unit; missing → `404`.
  - Build the caller's scope via `resolveScope(actor, store)`. If not `unrestricted` and `unitId ∉ scope.unitIds` → `403 { error: 'Not in your scope' }`. (Admins: unrestricted instance admin passes; org admin passes via their org subtree, same as scope resolution today.)
  - `name = cleanName(body.name)`; empty/too-long → `400`.
- **Dedupe:** list wards under the unit; if one matches `name` case-insensitively (trimmed), return it (`200`, same shape as a create) instead of inserting.
- **Cap:** if the unit already has ≥ 50 wards → `409 { error: 'Ward limit reached for this unit' }`.
- **Create:** `{ id: randomUUID(), unitId, name, createdAt: Date.now() }` via `store.createWard`; return `{ id, unitId, name }`.

The dedupe + scope logic mirrors the admin ward route; the only differences are the member-accessible auth and scope-based (rather than org-admin-only) authorization.

### 2. Client: type-to-create in the ward picker (`public/app.js`)

Today `f_ward` is a plain `<select>` filled by `populateWardSelect` from the cached scope tree. Change:

- Render the ward control so a PG can type a new name and see a **"Create '<name>'"** action when the typed text matches no existing ward under the selected unit (case-insensitive). Existing wards still list first so reuse is the default.
- On confirming "Create '<name>'":
  1. `POST /api/wards { unitId, name }`.
  2. Inject the returned ward into `cachedScopeTree` (find the unit under its department, push `{ id, name }` into `unit.wards`) so the dropdown reflects it live without a full refetch.
  3. Select the new (or returned-existing) ward id.
- The rest of the flow is unchanged: `readModalFieldsToObject` still reads `f_ward`'s value into `d.wardId`, and the patient POST carries only `wardId`.
- Errors (`403`/`409`/`400`) surface inline in the form; on failure the ward stays unselected and the PG can proceed without a ward (ward is optional).

Creation is scoped to the unit currently chosen in `f_unit`; a PG can only create under a unit already offered by their own scope tree, so the client can't even request an out-of-scope unit.

### 3. Admin visibility

No new admin work needed: member-created wards are ordinary ward nodes and appear in the command center under their unit, with existing rename / delete-empty / stats behavior. `buildOrgTree` and `buildScopeTree` already enumerate all wards under a unit.

## Testing

- **Flag off:** `POST /api/wards` → 404; picker absent; golden sync + full suite green.
- **Scope enforcement:** member creating under an in-scope unit → `200`; under an out-of-scope unit → `403`; non-existent unit → `404`.
- **Dedupe:** creating "7MOW" then "7mow" under the same unit yields one ward; second call returns the first's id.
- **Validation:** empty/oversized name → `400`; ≥ 50 wards → `409`.
- **End-to-end:** member creates a ward inline, the patient saves with the new `wardId`, and the ward shows in the admin console under the correct unit.
- **Cross-org isolation:** a member of org A cannot create a ward under a unit in org B (unit not in scope → `403`).

## Out of scope

- Ward-based (nurse) scoping — still a future axis; this spec only makes ward creation self-service.
- Member-driven creation of any other node type (unit/department/hospital/org) — admin-only, unchanged.
- Editing/renaming/deleting wards by members — admin console only, unchanged.
