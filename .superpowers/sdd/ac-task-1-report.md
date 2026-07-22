# AC Task 1 Report: Storage Additions — `listUsersByOrg` + `hasInstanceAdmin`

## Status
**DONE** — All tests passing, both backends implemented.

## Implementation Summary

### Changes Made

**Files modified:**
1. `/Users/apuravdhankhar/ortho-rounds/storage.js` — Added two new methods to both backends
2. `/Users/apuravdhankhar/ortho-rounds/tests/storage.test.js` — Added comprehensive test case

### SQLite Backend (lines 200–206)

```javascript
async listUsersByOrg(orgId){
  return db.prepare('SELECT * FROM users WHERE orgId = ? ORDER BY createdAt ASC').all(orgId);
},
async hasInstanceAdmin(){
  const row = db.prepare(
    "SELECT 1 AS ok FROM users WHERE role = 'admin' AND active = 1 AND orgId IS NULL LIMIT 1"
  ).get();
  return !!row;
},
```

### MongoDB Backend (lines 445–451)

```javascript
async listUsersByOrg(orgId){
  const arr = await users.find({ orgId }).sort({ createdAt: 1 }).toArray();
  return arr.map(mapUser);
},
async hasInstanceAdmin(){
  const row = await users.findOne({ role: 'admin', active: 1, $or: [{ orgId: null }, { orgId: { $exists: false } }] });
  return !!row;
},
```

Both implementations:
- Mirror existing conventions exactly (SQLite `db.prepare().all()`, Mongo `users.find()` with `mapUser`)
- Sort by `createdAt ASC` to match `getAllUsers` pattern
- Return consistent shapes: user row arrays and boolean for `hasInstanceAdmin`

### Test Implementation

Added test case `listUsersByOrg returns only that org, hasInstanceAdmin detects active root admins` (lines 72–103) that:

1. **Fixtures analysis**: Detected u1 (active admin, orgId: null) in prior tests, so test exercises both true/false outcomes by:
   - Disabling u1 to ensure false case
   - Creating root-x (active admin, no orgId) to trigger true case
   - Disabling root-x and verifying false case again

2. **Exercises `listUsersByOrg`**:
   - Creates org-specific users (orgA, orgB)
   - Verifies filtering by exact orgId match
   - Verifies empty result for non-existent org

3. **Exercises `hasInstanceAdmin`**:
   - False when no active instance admins exist
   - True when instance admin created
   - False when all instance admins disabled

## Test Results

### Focused Suite (tests/storage.test.js)
```
✓ All 20 tests pass in SQLite storage suite
✓ New test genuinely exercises both true and false outcomes
```

### Full Suite
```
# tests 249
# pass 249
# fail 0
```

## Git Commit

```
e359cf5 feat: storage listUsersByOrg + hasInstanceAdmin (both backends)
```

Files changed: 2 (storage.js, tests/storage.test.js)
Insertions: 48

## Self-Review

**Correctness:**
- ✅ SQL queries match brief specification exactly
- ✅ Mongo query handles both `null` and `$exists: false` (documents without field)
- ✅ Both backends use existing row-mapping conventions (`mapUser` for Mongo)
- ✅ Sorting by `createdAt ASC` consistent across both backends

**Test Coverage:**
- ✅ Both `listUsersByOrg` return values tested (single match, empty array)
- ✅ Both `hasInstanceAdmin` boolean outcomes tested (true and false)
- ✅ Test adapted to actual fixtures present in describe block
- ✅ No regression in 249-test suite

**Integration:**
- ✅ Interfaces match brief spec exactly
- ✅ Both backends produce identical behavior
- ✅ Methods ready for use in Phase 1 multi-tenant routing

## No Concerns

All requirements met, code follows existing patterns, comprehensive test coverage, full suite passes.
