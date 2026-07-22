# Task 2: Integration Harness + Flag-OFF Golden Sync Test

## Status: DONE

## Implementation Summary

Successfully created the integration test harness and golden-response regression test for the flag-OFF `/api/sync` contract.

### Files Created

1. **tests/helpers/server-harness.js** (73 lines)
   - Exports `startServer()` function that spawns the real server as a child process on a temp SQLite directory
   - Implements `waitForHealth()` to poll `/api/health` until server is ready (15s timeout)
   - Exports `login()` helper for authentication
   - Exports `syncPost()` helper for `/api/sync/v1` requests
   - Admin credentials fixed: `admin` / `test-admin-pass`
   - Supports optional `seed()` function to populate test data before server boot
   - Supports `multiTenant` flag control via env var deletion/setting

2. **tests/server-sync-golden.test.js** (48 lines)
   - Golden-response regression guard for flag-OFF sync contract
   - Test suite validates that no accidental behavior drift occurs during MULTI_TENANT wiring
   - Test 1: Validates push + pull round-trip with exact contract shape
     - Verifies response keys: `['apiVersion', 'patients', 'serverTime']`
     - Confirms pushed patient returns with correct fields
     - **Critical assertion**: Flag-OFF must NOT add `wardId` field
   - Test 2: Validates flat instance visibility (every user sees every patient)

### Test Results

**Golden Test (tests/server-sync-golden.test.js)**
- Status: PASS (both tests pass)
- 2 tests / 2 pass / 0 fail
- Duration: ~577ms
- Server boot time: ~437ms, request execution: ~15ms total

**Full Test Suite (npm test)**
- Status: PASS (all tests pass)
- 235 tests / 235 pass / 0 fail
- 66 test suites
- Duration: ~13.4s
- No regressions introduced

### Self-Review

**Strengths:**
- Harness correctly spawns real server in isolation with temp SQLite
- Port randomization (3100-5599) prevents collisions
- Health polling with 150ms intervals ensures server readiness
- Golden test locked the EXACT flag-OFF contract before any server changes
- No modifications to server.js (as required)
- Test passes on current unmodified server (golden test's purpose validated)

**Contract Validation:**
- Response structure matches spec: `{apiVersion: 1, patients: [...], serverTime: number}`
- Patient round-trip preserves all fields: id, name, diagnosis, status, unit, ward, deleted, updatedAt
- Flag-OFF verification: wardId field NOT present (correctly scoped feature)
- Flat instance visibility: all users see all patients when flag is OFF

**Concerns:** None. The harness is robust and the golden test successfully locks the current behavior.

### Commit

```
commit d8a54bb
Author: (agent)
Date:   Today

    test: integration harness + flag-off golden sync contract
    
    - Create tests/helpers/server-harness.js: spawn real server on temp SQLite
    - Create tests/server-sync-golden.test.js: golden contract for flag-OFF /api/sync
    - Harness: startServer(), login(), syncPost() helpers with admin credentials
    - Golden test: validates push/pull round-trip, contract shape, no wardId invention
    - All 235 tests pass (66 suites), golden test locked against current server
```

Files changed: 2 files, 121 insertions
- tests/helpers/server-harness.js (new)
- tests/server-sync-golden.test.js (new)

---

**Ready for Task 3**: The integration harness is now available for all downstream tasks. The golden test establishes the baseline for flag-OFF behavior before any server-side scoping changes land.
