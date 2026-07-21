# Task 2 Report: `ai.js` + `server.js` — Prompt Updates and otherLabs Passthrough

## Summary
Successfully implemented otherLabs passthrough for AI lab extraction. All prompts updated to cover the 15-key panel (bone profile + 11 existing keys). TDD approach: wrote failing tests first, implemented changes, verified all tests pass.

## Implementation Details

### 1. Tests Added ✅
Appended two new tests to `tests/ai-parse-labs-image.test.js`:

- **Test: "captures unrecognized analytes as otherLabs instead of dropping them"**
  - Verifies that unrecognized lab keys (e.g., `uricAcid`) are extracted from `raw.labs` and included in `otherLabs` array
  - Verifies that recognized keys like `hb` remain in the `labs` object
  - Verifies that entries from AI's `otherLabs` array are also included in the result

- **Test: "accepts bone-profile keys as first-class labs"**
  - Verifies that bone profile keys (calcium, phosphate, alp, albumin) are accepted as first-class lab keys
  - Verifies that these keys return in the `labs` object, not in `otherLabs`
  - Verifies that `otherLabs` is an empty array when no unrecognized analytes exist

### 2. RED Phase ✅
Both new tests failed initially as expected:
- `result.otherLabs` was `undefined` (not yet in return shape)
- Bone-profile keys not yet in the known lab list

### 3. Implementation Changes

#### ai.js Line 6 (Import)
Added `extractOtherLabs` to the existing import from `./clinical-normalize.js`:
```js
import {
  normalizePatientClinicalFields,
  extractLabsFromText,
  sanitizeLabs,
  extractOtherLabs,  // NEW
  sanitizeAntibioticCourses,
  mergeLabs
} from './clinical-normalize.js';
```

#### ai.js `parseLabsFromImage` System Prompt (~line 419)
Updated the key list to include all 15 keys (11 existing + 4 bone-profile):
```
"labs": object with optional string keys — hb, platelets, wcc, esr, crp, urea, creatinine, sodium, potassium, ptinr, rbs, calcium, phosphate, alp, albumin. Use the exact numeric value as printed (no units in the value). Omit any key not legible or not present on the report — never guess or invent a value.
"otherLabs": array of {name, value} for any other legible analyte printed on the report that does not fit a key above. name exactly as printed (max 30 chars), value as printed without units. Same rules: transcribe only, never guess, no patient-identifying text.
```

#### ai.js `parseLabsFromImage` Implementation (~line 428)
Added the `extractOtherLabs` call and updated return shape:
```js
const labs = sanitizeLabs(raw?.labs);
const otherLabs = extractOtherLabs(raw);  // NEW
let reportDate = null;
if(typeof raw?.reportDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.reportDate.trim())){
  reportDate = raw.reportDate.trim();
}
return { labs, otherLabs, reportDate };  // CHANGED
```

#### ai.js `parseAdmission` System Prompt (~line 371)
Expanded the labs object description to include all 15 keys:
```
labs: object with optional keys hb, crp, wcc, creatinine, platelets, esr, urea, sodium, potassium, ptinr, rbs, calcium, phosphate, alp, albumin (string numbers only, Indian report units),
```

#### server.js Lines 599-600
Updated the endpoint to destructure and return `otherLabs`:
```js
const { labs, otherLabs, reportDate } = await parseLabsFromImage(body.image);
return sendJSON(res, 200, { labs, otherLabs, reportDate });
```

### 4. GREEN Phase ✅
All tests pass after implementation:
- Focused test file: 5/5 tests pass (includes 2 new + 3 existing)
- Full suite: 201/201 tests pass (59 suites)

### 5. Commit ✅
```
c9fafb3 feat: AI lab extraction returns otherLabs; prompts cover 15-key panel
```

Files changed:
- `ai.js` — import + 2 prompt updates + return shape
- `server.js` — endpoint passthrough
- `tests/ai-parse-labs-image.test.js` — 2 new tests

## TDD Evidence

### RED → GREEN Flow
1. **RED (Before Implementation)**
   - Test 4: `AssertionError: undefined !== [...]` (otherLabs not in result)
   - Test 5: `AssertionError: undefined !== []` (otherLabs missing)
   - 2 failures, 3 passes

2. **GREEN (After Implementation)**
   - All 5 tests pass
   - All 201 full-suite tests pass

## Self-Review Findings

### Correctness ✅
- Prompts correctly document all 15 keys
- `extractOtherLabs` is imported and called correctly
- Return shape matches interface spec: `{ labs, otherLabs, reportDate }`
- Server endpoint correctly passes through all three fields
- Bone-profile keys (calcium, phosphate, alp, albumin) are now first-class

### Integration ✅
- `extractOtherLabs` from Task 1 is correctly integrated
- Existing tests still pass (no regressions)
- Focused test file exercises both new and pre-existing functionality
- Full suite (201 tests) passes without issues

### Prompt Quality ✅
- `parseLabsFromImage`: Prompt clearly describes all 15 keys + otherLabs behavior
- `parseAdmission`: Prompt updated with the same 15-key list for consistency
- Consistency: Both prompts now have identical lab key lists
- Context preserved: otherLabs guidance clearly explains transcription-only, no guessing

### No Concerns
- All code is minimal and focused
- No scope creep (server passthrough was exactly one line)
- Tests verify both positive (bone-profile keys work) and negative (otherLabs captures unknown keys) paths
- Default otherLabs behavior: empty array when nothing unrecognized (verified by test)

## Files Changed

- `/Users/apuravdhankhar/ortho-rounds/ai.js` — import, 2 prompts, return shape
- `/Users/apuravdhankhar/ortho-rounds/server.js` — endpoint response
- `/Users/apuravdhankhar/ortho-rounds/tests/ai-parse-labs-image.test.js` — 2 new tests

## Verification

```bash
npm test -- tests/ai-parse-labs-image.test.js  # 5/5 pass
npm test                                        # 201/201 pass (59 suites)
git log --oneline -1                            # c9fafb3 feat: AI lab extraction returns otherLabs; prompts cover 15-key panel
```
