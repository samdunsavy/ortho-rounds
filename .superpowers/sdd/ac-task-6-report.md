# AC Task 6: Flag-off UI golden test + docs tick — Report

**Date:** 2026-07-22  
**Status:** ✅ COMPLETE

## Summary

Task 6 (final admin-console task) completed successfully. Appended flag-off UI golden test, updated roadmap and design docs per brief, all 267 tests pass including sync and admin-console goldens.

## Work Completed

### Step 1: Flag-off UI Test ✅
- **File:** `tests/frontend-admin-view.test.js`
- **Added:** `describe('flag OFF — zero admin UI')` with test verifying admin UI remains hidden even for admins when `serverFlags` is empty
- **Result:** Test passes (verified with `npm test -- tests/frontend-admin-view.test.js`)

### Step 2: Documentation Updates ✅
- **ROADMAP.md (Phase 1 checklist):** Added line after auth/sync scoping:
  ```
  - [x] Org/department admin console + provisioning (shipped 2026-07-22 — see docs/superpowers/specs/2026-07-22-admin-console-design.md)
  ```
- **DESIGN-multitenant.md:** 
  - Marked "Org/ward admin console" item 3 as `✅ done — 2026-07-22`
  - Updated rollout plan to note bootstrapAdmin self-heal ensures single-tenant mode always has valid admin

### Step 3: Full Test Suite ✅
- `npm test`: **267 tests pass**, 0 fail, 75 suites
- Confirmed golden tests:
  - `tests/server-sync-golden.test.js`: 2 pass (flag OFF — /api/sync golden response)
  - `tests/server-admin-console.test.js`: 8 pass (including "flag OFF: new routes do not exist")

### Step 4: Git Commit ✅
```bash
Commit: 04fb794
Message: chore: flag-off admin-UI golden, roadmap tick for admin console
Files: tests/frontend-admin-view.test.js, ROADMAP.md, DESIGN-multitenant.md
```

## Test Summary

- **Frontend admin view tests:** 5 pass (4 existing + 1 new flag-off golden)
- **Sync golden (flag OFF):** 2 pass — byte-identical contract verified
- **Admin console goldens (flag OFF):** 1 pass — new routes 404, existing shape unchanged
- **Full suite:** 267 pass, 0 fail

## Key Files Modified

1. `/Users/apuravdhankhar/ortho-rounds/tests/frontend-admin-view.test.js` — flag-off UI test appended
2. `/Users/apuravdhankhar/ortho-rounds/ROADMAP.md` — Phase 1 checklist updated
3. `/Users/apuravdhankhar/ortho-rounds/DESIGN-multitenant.md` — item 3 marked done, rollout plan noted

## Concerns

None. All requirements met, all tests passing, documentation consistent.

---

**Report Path:** `/Users/apuravdhankhar/ortho-rounds/.superpowers/sdd/ac-task-6-report.md`

---

## Final-review fix note (2026-07-22)

Two findings from final whole-branch review were fixed:

**Finding 1 (Important) — bootstrapAdmin self-heal collided with an existing disabled same-username row.**
`auth.js` `bootstrapAdmin`, MULTI_TENANT-on branch only: before creating the env admin, now looks up `store.getUserByUsername(username)`. If a row exists (e.g. a disabled leftover `admin` from prior offboarding), it upserts via `store.updateUser` — reactivates (`active: true`), resets password to the env/generated credential, forces instance-level (`orgId: null`, `wardId: null`, `role: 'admin'`), and bumps `tokenVersion` to invalidate any old sessions — instead of calling `createUser`, which previously threw on the UNIQUE username constraint and crashed the server at boot (uncaught in `server.js` `main()`). Flag-off path is byte-identical (untouched). `USER_PATCH_FIELDS` in `storage.js` already covered all patched fields (`passwordHash`, `passwordSalt`, `active`, `role`, `tokenVersion`, `orgId`, `wardId`) — no storage change needed.
Added regression test `self-heal reactivates a disabled same-username admin instead of crashing` to `tests/server-provisioning.test.js` (TDD: confirmed RED — server never became healthy/login hung — before the fix, GREEN after).

**Finding 2 (Minor) — assign select didn't revert on failed API call.**
`public/app.js`: `renderAdminUsersSectionHTML` now stamps `data-prev="${escapeHTML(u.wardId || '')}"` on the `[data-assign-user]` select at render time. The delegated `change` handler updates `sel.dataset.prev = sel.value` on success, and on catch resets `sel.value = sel.dataset.prev || ''` before showing the existing toast — so a failed assign no longer leaves the UI showing a department change that didn't actually happen.

**Verification:** `npm test -- tests/server-provisioning.test.js tests/auth.test.js tests/frontend-admin-view.test.js` — 22/22 pass. Full suite `npm test` — 268/268 pass, 0 fail.

**Commit:** `fix: idempotent bootstrapAdmin self-heal; revert assign select on failure`
Files: `auth.js`, `public/app.js`, `tests/server-provisioning.test.js`, `.superpowers/sdd/ac-task-6-report.md`
