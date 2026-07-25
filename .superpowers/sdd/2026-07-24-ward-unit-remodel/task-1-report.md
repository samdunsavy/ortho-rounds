# Task 1 report — Storage: flip unit/ward FKs (both backends)

## Status: DONE

## What changed

**`storage.js`**
- SQLite `wards` table: `departmentId` → `unitId` (NOT NULL), index renamed `idx_wards_unitId`.
- SQLite `units` table: `wardId` → `departmentId` (NOT NULL), index renamed `idx_units_departmentId`.
- Added `addColumnIfMissing(db,'units','departmentId','TEXT')` / `addColumnIfMissing(db,'wards','unitId','TEXT')`, placed *after* the `wards`/`units` `CREATE TABLE IF NOT EXISTS` + index statements (not near the users-column migrations at the old line ~119-122, which run *before* those tables exist — placing them there threw `no such table: units` on a fresh DB; moved them to immediately after the `units` index creation instead).
- SQLite methods: `createWard`/`getWard`/`listWardsByUnit` (was `listWardsByDepartment`), `createUnit`/`getUnit`/`listUnitsByDepartment` (was `listUnitsByWard`), `updateWard` whitelist `['name','unitId']`, `updateUnit` whitelist `['name','departmentId']`.
- Mongo: indexes flipped to `wards.createIndex({unitId:1})` / `units.createIndex({departmentId:1})`; same method/whitelist changes as SQLite, verbatim from the brief.

**`tests/storage.test.js`**
- Replaced `'wards + units CRUD under a department'` with the brief's `'unit under department, ward under unit'` test (new shape, new method names).
- Also fixed `'node update + delete'` (an old-shape test not explicitly named in the brief but exercising the same removed shape) to create `createUnit({departmentId})` before `createWard({unitId})` and call `updateUnit`/`updateWard` with the new whitelisted fields — needed so the full `storage.test.js` file passes, per the "storage test MUST pass" requirement.

**Mechanical consumer renames (Step 5, load-bearing only, no logic rewrites):**
- `hierarchy.js`: `unitsUnderWard`/`unitsUnderDepartment` now call `listWardsByUnit`/`listUnitsByDepartment` (renamed 1:1 in place; the tree-walk logic itself still assumes the OLD ward-holds-units shape and is wrong post-flip — left a comment marking it as Task 2's job). `resolveAncestry`'s `unit.wardId`/`ward.departmentId` field reads were left untouched (same reason — Task 2 rewrites this function's shape entirely).
- `structure.js`: only `childrenOf` touched — `department` case now calls `listUnitsByDepartment`, `ward` case now calls `listWardsByUnit` (case labels/shape otherwise unchanged; correct re-derivation of parent/child types is Task 4's job).
- `admin.js`: three call sites swapped 1:1 (`buildOrgTree`'s ward/unit loop, `wardBranch`, `departmentBranch`) — `listWardsByDepartment`→`listUnitsByDepartment`, `listUnitsByWard`→`listWardsByUnit`. Nesting/labeling logic unchanged (Task 5's job).
- `scripts/backfill-hierarchy.js`: **left unchanged.** It calls neither `listUnitsByWard` nor `listWardsByDepartment` (grep confirms), so there was nothing to mechanically rename for module-load purposes. Its `ensureWard`→`ensureUnit` call order and field names (`createWard({departmentId})`, `createUnit({wardId})`) now target the wrong parent field on the flipped schema, but fixing this requires reordering two functions and reworking a `wardCache`/`unitCache` structure — a real flow change, not a 1:1 rename, so it's out of scope here (`if a consumer needs more than a rename, leave a failing test for that task rather than half-implementing`). The full plan (`docs/superpowers/plans/2026-07-24-ward-unit-remodel.md`) supersedes this script entirely with a new `scripts/backfill-hierarchy-v2.js` in Task 7 rather than assigning a fix-up task to the old one.

## Verification

`node --test tests/storage.test.js`: **22/22 pass, 0 fail.**

`npm test` (full suite, `node --no-warnings --test`): **260 pass / 25 fail / 45 cancelled / 330 total, across 94 suites.**

### Expected-failing suites (14 suites across 8 files) — all assert the OLD tree shape, each owned by a later task per the plan:

| File | Failing suite(s) | Owning task |
|---|---|---|
| `tests/admin.test.js` | `admin tree/stats builders` | Task 5 (`admin.js` — nest department→unit→ward) |
| `tests/backfill-hierarchy.test.js` | `backfill-hierarchy` | Superseded by Task 7's v2 script (old script not reassigned in the plan) |
| `tests/hierarchy.test.js` | `hierarchy` | Task 2 (`hierarchy.js` — shorten ancestry + unit-set walk) |
| `tests/scope.test.js` | `scope (unit-based subtree)` | Task 3 (`scope.js` + sync ward validation) |
| `tests/server-admin-console.test.js` | `admin console — end-to-end provisioning flow (flag on)` | Task 5 |
| `tests/server-scoping.test.js` | `MULTI_TENANT sync scoping (unit-based)`, `GET /api/me/scope` | Task 3 |
| `tests/server-structure.test.js` | rename, delete-empty-only, move+re-stamp, bulk re-home, assign-bulk, repair-ancestry (6 suites, all "(flag on)") | Task 4 (`structure.js` parent maps + rehome ward validation) |
| `tests/structure.test.js` | `structure` | Task 4 |

Confirmed **not** broken at this stage (contrary to my initial assumption from the brief's "hierarchy/scope/admin/structure/backfill/**frontend**" list): `tests/frontend-admin-view.test.js` and `tests/frontend-unit-picker.test.js` both pass — they exercise `public/app.js` against mocked fetch fixtures, not the real storage/admin.js chain, so they're unaffected until Task 6 changes `app.js` itself. `tests/server-sync-golden.test.js` (flag-off byte-identical guard) still passes, confirming the flag-off path is untouched.

## Concerns / notes for later tasks
- The brief's line-number pointer for the migration insertion ("near line 122") was for the pre-Task-1 file; the actual correct insertion point is *after* the `wards`/`units` table creation, not before — worth knowing if anyone re-reads the brief literally.
- `scripts/backfill-hierarchy.js` + its test are dead weight against the new schema starting now (will throw a SQLite NOT NULL constraint / TypeError on `unitId`/`departmentId` if actually run) until Task 7 lands its v2 replacement — flagging in case the plan intends to delete the old script rather than leave it broken.
