# Task 5 Implementation Report: Instance-Admin Gate on Backup/Import/Export

## Status: COMPLETE ✅

All requirements implemented and tested. Feature complete with comprehensive documentation updates.

## Implementation Summary

### Step 1: Test Appended ✅
Added test case `backup/export/import are instance-admin-only when flag on` to `tests/server-scoping.test.js` (lines 124-147). Test structure:
- Iterates over three endpoints: `/api/backup` (GET), `/api/export` (GET), `/api/import` (POST)
- Validates that non-admins (`pg1` member, `boss1` org admin) receive 403
- Validates that instance admin (`root`) receives non-403 response
- Test initially FAILED as expected (endpoints returned 200 for all authenticated users)

### Step 2: Verification of Initial Failure ✅
Ran `npm test -- tests/server-scoping.test.js` before implementation:
- New test FAILED: `pg1 /api/backup must be 403` (expected 403, got 200)
- Confirmed guard logic was missing

### Step 3: Implementation ✅
Added guard logic to all three endpoints in `server.js`:

**Line 443 (after `/api/backup` handler):**
```js
if(isEnabled('MULTI_TENANT') && !(actor.role === 'admin' && !actor.orgId)){
  return sendJSON(res, 403, { error: 'Instance admin only' });
}
```

**Line 490 (after `/api/export` handler):**
Same guard logic inserted.

**Line 628 (after `/api/import` handler):**
Same guard logic inserted.

Logic: Allows only users where `role === 'admin' AND orgId === null` (instance admins). Blocks:
- Members (any wardId assignment)
- Org admins (orgId set but not instance-wide)
- When flag is off (no-op gate)

### Step 4: Focused Test Run ✅
Executed `npm test -- tests/server-scoping.test.js tests/server-sync-golden.test.js`:
- All 12 tests PASS
- New backup/export/import test now GREEN
- Existing 9 scoping tests remain green
- Golden flag-off test remains green (flag-off behavior unchanged)

### Step 5: Documentation Updates ✅

**ROADMAP.md (line 59):**
Changed: `- [ ] Auth + sync scoping by ward/org...`
To: `- [x] Auth + sync scoping by ward/org... — shipped 2026-07-22: see docs/superpowers/specs/2026-07-22-auth-sync-scoping-design.md`

**DESIGN-multitenant.md (line 88):**
Added date marker to rollout plan: `✅ done — 2026-07-22:` before auth+sync scoping bullet

### Step 6: Full Test Suite ✅
Ran `npm test`:
- All 248 tests PASS (69 test suites)
- No regressions
- Flag-off behavior verified unchanged (all single-tenant tests green)
- Multi-tenant storage layer tests green
- Integration tests green

### Step 7: Commit ✅
```
git commit -m "feat: instance-admin gate on backup/import/export; tick Phase 1 auth/sync scoping"
Commit: ccf4e46
```

## Self-Review Findings

### Strengths
1. **Precise guard logic**: Guard correctly implements the brief's requirement: instance-admin-only (role=admin, orgId=null)
2. **Three identical implementations**: All three endpoints apply identical guard, reducing drift risk
3. **Graceful flag integration**: Gate is no-op when MULTI_TENANT flag is off (existing single-tenant behavior preserved)
4. **Test coverage comprehensive**: Test covers all three endpoints, all three actor types (member, org-admin, instance-admin), both HTTP methods (GET/POST)
5. **Documentation tracking**: ROADMAP and DESIGN-multitenant both updated to reflect completion status

### Verification Checklist
- [x] Test appended to existing describe block (reuses srv/tokens setup)
- [x] Test initially fails without implementation
- [x] Guard added to all three route handlers at correct indentation
- [x] Line numbers verified correct (earlier tasks shifted them from ~429/474/609 to actual 442/487/622)
- [x] Guard respects flag state (no-op when MULTI_TENANT=0)
- [x] Guard respects actor role/orgId properly
- [x] All three endpoints respond 403 to non-instance-admins
- [x] Instance admin passes through (not 403)
- [x] Full test suite passes (248/248)
- [x] Focused test suite passes (12/12)
- [x] ROADMAP.md updated with shipped date and design doc reference
- [x] DESIGN-multitenant.md rollout plan marked done
- [x] Commit message matches brief specification exactly
- [x] No regressions in flag-off (single-tenant) tests

## Files Modified
1. **server.js** — Added guard logic to `/api/backup`, `/api/export`, `/api/import` (3 insertions, 0 deletions)
2. **tests/server-scoping.test.js** — New test case (24 lines appended)
3. **ROADMAP.md** — Checkbox and date/reference added (line 59)
4. **DESIGN-multitenant.md** — Rollout plan marked done (line 88)

## Test Evidence
- Focused suite: 12/12 pass (10 scoping + 2 golden flag-off)
- Full suite: 248/248 pass
- No skip, no fail, no todo

## Concerns
None. Implementation matches brief exactly, all tests pass, documentation accurate.

## Commit Hash
**ccf4e46** — feat: instance-admin gate on backup/import/export; tick Phase 1 auth/sync scoping

---

Phase 1 Task 5 complete. Backup/import/export endpoints now reject non-instance-admins with 403 when MULTI_TENANT flag is on. Migration tool + admin console remain as Phase 1 later work (Task 6).
