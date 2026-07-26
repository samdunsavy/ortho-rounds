# Unit Picker Visibility for the Instance Admin — Design

**Date:** 2026-07-26
**Status:** Task 1 (server) implemented 2026-07-26; Task 2 (client cache invalidation) pending; Task 3 (empty-state) optional.

## Problem

With `MULTI_TENANT` on, the add-patient form's unit selector is populated *only* from hierarchy Unit nodes in the caller's own scope tree (`GET /api/me/scope` → `buildScopeTree` in `admin.js`). The bootstrap **instance admin** (`role: 'admin'`, `orgId: null`, no assignment) resolves to a `null` scope node, and `buildScopeTree(null)` returns `{ departments: [] }` — an empty picker — even though the instance admin can read and write every patient and is the exact account used in the admin console to create orgs, departments, and units.

Reproduced against a real SQLite DB: with a Unit named "IV" present under a department, the instance admin's scope tree stayed `{departments:[]}`, while org-assigned and department-assigned accounts saw the unit immediately:

```
instance admin (node=null):  {departments:[]}     ← empty even with Unit IV present
org-assigned:                {…Ortho→units:[IV]}
dept-assigned:               {…Ortho→units:[IV]}
```

So the clinician creates Unit IV as the instance admin, switches to add-patient, and the selector is blank. Two independent defects:

1. **Server:** the instance admin gets an empty scope tree, so its picker can never list any unit.
2. **Client:** the scope tree is fetched once per page session (`cachedScopeTree`, `public/app.js`) and never invalidated, so a unit created in the command center does not appear in the picker until a full page reload — even for a correctly-scoped account.

## Non-negotiable

Flag off: `/api/me/scope` still 404s; the picker is the legacy free-text form. Unchanged. Scoped members and org admins keep exactly their current subtree — only the instance-admin (`null`-node) case changes on the server. The instance admin is already unrestricted for patient read/write, so exposing the full tree of node names/ids leaks nothing it couldn't already reach via `/api/sync`.

## Root cause

`/api/me/scope` mirrors `scope.js`'s node resolution: `actor.assignment` for members, the org node for org admins. The instance admin has neither an assignment nor an `orgId`, so it falls through to `null`, and `buildScopeTree` has no branch for "everything." The picker was built for scoped clinicians and the unrestricted operator account was never given a tree.

## Design

### 1. Server — instance-admin whole-instance tree (done)

`buildScopeTree(store, node)` gains an `instance` node case (handled before the `!node.id` guard, since the sentinel has no id): iterate `listOrganizations()` → `listHospitalsByOrg` → `listDepartmentsByHospital`, pushing each `departmentBranch(store, dep, null, null)`. Returns every department/unit/ward in the instance.

The `/api/me/scope` handler resolves an unassigned admin to `{ type: 'instance' }` instead of `null`:

```js
let node = actor.assignment || null;
if(!node && actor.role === 'admin'){
  node = actor.orgId ? { type: 'org', id: actor.orgId } : { type: 'instance' };
}
```

Assigned members and org admins are unaffected (their `node` resolves before the `instance` fallback). `assignment` in the response stays `null` for the instance admin (it genuinely has none).

### 2. Client — invalidate the cached scope tree on hierarchy change (pending)

`cachedScopeTree` is memoized for the page session (`loadScopeTree` returns it if set). It must be cleared whenever the hierarchy changes under the current session so the next picker open refetches:

- Add `invalidateScopeTree()` that sets `cachedScopeTree = null`.
- Call it after any admin node create/delete/move in the command center (unit creation is the concrete trigger for this bug; department/hospital/org edits for completeness).
- Inline **ward** creation already mutates the in-memory tree via `injectWardIntoScopeTree` and must keep doing so (no refetch needed there) — the invalidation targets changes made *outside* the picker.

This is the piece that lets a freshly-created Unit IV appear without a manual full-page reload.

### 3. Optional — empty-state hint (not required for the fix)

When a selected department has zero units, render a hint ("No units yet — create one in the command center") in place of a silent empty `<select>`, so the dead-end is visible rather than looking broken. Cosmetic; deferrable.

## Testing

- **Server (done):** instance admin (`root`) receives the whole-instance tree — every department and its units (`tests/server-scoping.test.js`, `GET /api/me/scope` describe). Assigned member and org admin trees unchanged (existing tests). Flag-off 404 (existing test).
- **Client (pending):** after `invalidateScopeTree()`, the next `loadScopeTree()` refetches rather than returning the stale cache — driven through the jsdom frontend harness with a `stubScopeFetch` that returns an updated tree on the second call, asserting the newly-added unit is now an option.

## Out of scope

Inline unit creation from the patient form (units stay a command-center action, unlike wards). Per-patient assignment (location scoping is sufficient — see `patient_scoping_direction`). Changing what scoped members/org admins see.
