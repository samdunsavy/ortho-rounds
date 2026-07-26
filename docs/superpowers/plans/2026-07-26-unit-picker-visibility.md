# Unit Picker Visibility for the Instance Admin — Implementation Plan

**Goal:** Make the add-patient unit selector show units for the bootstrap instance admin, and make freshly-created units appear without a full page reload. Flag-off behavior unchanged.

**Architecture:** Server gives the unrestricted instance admin a whole-instance scope tree (new `instance` case in `buildScopeTree`); the `/api/me/scope` handler resolves an unassigned admin to that sentinel. Client clears its per-session scope-tree cache whenever the hierarchy changes so the picker refetches.

**Spec:** `docs/superpowers/specs/2026-07-26-unit-picker-visibility-design.md`

**Status:** Tasks 1–2 implemented + tested 2026-07-26 (full suite 400 pass). Task 3 (empty-state) optional, still pending.

## Global Constraints

- Flag off (`ORTHO_FLAG_MULTI_TENANT` unset): `/api/me/scope` still 404s; legacy free-text ward/unit inputs unchanged.
- Only the instance-admin (`role admin`, `orgId null`, no assignment) case changes server-side. Assigned members and org admins keep their exact current subtree — guarded by the existing `GET /api/me/scope` tests.
- Instance admin is already unrestricted for `/api/sync` read/write, so returning the full tree of node names/ids exposes nothing new.
- Tests: `npm test` (node --test). Server via `tests/helpers/server-harness.js`; client via the jsdom frontend harness.
- Git quirk: stale `.git/index.lock` ("Operation not permitted") currently blocks commits — clear it before committing.

---

### Task 1: Server — instance-admin whole-instance scope tree ✅

**Files:** `admin.js` (`buildScopeTree`), `server.js` (`/api/me/scope` handler); test `tests/server-scoping.test.js`.

- [x] **Step 1 — `buildScopeTree` instance case.** Before the `if(!node || !node.id) return empty;` guard, handle `node.type === 'instance'`: iterate `store.listOrganizations()` → `listHospitalsByOrg` → `listDepartmentsByHospital`, pushing `departmentBranch(store, dep, null, null)` for each; return `{ departments: out }`. (`listOrganizations` exists in both SQLite and Mongo backends.)
- [x] **Step 2 — Handler resolves unassigned admin to the sentinel.** Replace the single `const node = …` line with: `let node = actor.assignment || null; if(!node && actor.role === 'admin'){ node = actor.orgId ? { type:'org', id:actor.orgId } : { type:'instance' }; }`. Org admins and assigned members unchanged.
- [x] **Step 3 — Test.** In the `GET /api/me/scope` describe, add the `root` token and assert the instance admin gets every department (`['dep1','dep2']`) with their units. Existing member/org-admin/flag-off tests must stay green.
- [x] **Step 4 — Verify.** `npm test` → 399 pass, 0 fail.

---

### Task 2: Client — invalidate cached scope tree on hierarchy change ✅

**Files:** `public/app.js` (invalidator), `public/admin-console.js` (call sites); test `tests/frontend-unit-picker.test.js`.

- [x] **Step 1 — Add the invalidator.** `function invalidateScopeTree(){ cachedScopeTree = null; }` next to `loadScopeTree` in `app.js`.
- [x] **Step 2 — Call it after out-of-picker hierarchy edits.** Added a guarded `invalidateHierarchyCaches()` helper in `admin-console.js` (calls `invalidateScopeTree` if present) and invoked it in all four node-mutation success paths: add-child (create), rename (PATCH), delete, move. The inline-ward-creation path is left alone — it already updates the in-memory tree via `injectWardIntoScopeTree`.
- [x] **Step 3 — Test.** In `tests/frontend-unit-picker.test.js`: a `fetch` stub returns a tree without the new unit on call 1 and with it on call 2; first open shows `['u1']`, a reopen without invalidating stays a cache hit (`calls === 1`, still `['u1']`), then `invalidateScopeTree()` + reopen forces a refetch (`calls === 2`) and the new unit appears (`['u1','u2']`).
- [x] **Step 4 — Verify.** Targeted frontend test passes; full suite 400 pass.

---

### Task 3: Client — empty-state hint when a department has no units ⬜ (optional)

**Files:** `public/app.js` (`populateUnitSelect`); test in the frontend harness.

- [ ] **Step 1.** When the chosen department resolves to zero units, render a disabled hint option / inline message ("No units yet — create one in the command center") instead of a bare "Select unit" placeholder, so the empty selector doesn't look broken.
- [ ] **Step 2.** Test: a scope tree with a department but no units shows the hint and no selectable unit; a department with units is unaffected.

---

## Rollout

1. Ship Task 1 (server) — resolves the reported bug for the instance admin after a redeploy + one hard page reload (to bust the client's session cache).
2. Ship Task 2 — removes the manual-reload requirement for newly-created units.
3. Task 3 at leisure — pure polish.

## Out of scope

Inline unit creation from the patient form (units stay a command-center action). Per-patient assignment. Any change to scoped members' / org admins' trees.
