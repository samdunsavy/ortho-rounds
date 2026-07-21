# Task 3 Report — public/app.js: 15-field core lab panel (LAB_SPEC, form grid, save, trends)

## Status: DONE

## What was implemented

Extended the browser-side lab panel from 11 to 15 fields, adding the bone-profile
quartet (calcium, phosphate, ALP, albumin) throughout `public/app.js`:

1. **`LAB_SPEC`** (~line 88-100→104): added `calcium` (low 8.5 / high 10.5 mg/dL),
   `phosphate` (low 2.5 / high 4.5 mg/dL), `alp` (high 120 U/L), `albumin`
   (low 3.5 g/dL).
2. **`applySmartPasteLabs` pairs array** (~line 1283-1299): added the four
   `[key, elementId]` pairs so AI photo-extraction and smart-paste fill the new
   inputs.
3. **`labValueClass`** (~line 2700-2733) — **not listed as a numbered edit in
   the brief, but required** (see Concerns below). Extended the existing
   per-key `if` branches (no generic fallback exists in this function) so the
   four new keys are actually flagged:
   - `albumin` joined the `platelets` branch (low-only).
   - `alp` joined the `esr`/`urea`/`ptinr` branch (high-only).
   - `calcium`, `phosphate` joined the `sodium`/`potassium`/`rbs` branch
     (both directions).
4. **`LAB_TREND_LABELS`** (~line 2776-2780): added
   `calcium: 'Ca', phosphate: 'PO4', alp: 'ALP', albumin: 'Albumin'`. Trend
   sparklines come for free since `renderLabsTrendPanel` iterates
   `Object.keys(LAB_TREND_LABELS)`.
5. **Form grid** (`renderModalForm`, ~line 6355-6362): added four `<div>`
   input rows after the RBS input, following the exact existing markup
   pattern (id, inputmode, placeholder, escaped value, `labValueClass` class).
6. **Save collect** (`savePatientFromModal`, `d.labs = {...}`, ~line
   7198-7202): added the four `document.getElementById(...).value.trim()`
   reads.
7. **`hasAnyLabValue`** (~line 7205): appended `'calcium', 'phosphate', 'alp',
   'albumin'` to the key list.
8. **`upsertLabsHistoryEntry` patch object** (~line 7207-7211): added
   `calcium: d.labs.calcium, phosphate: d.labs.phosphate, alp: d.labs.alp,
   albumin: d.labs.albumin`.

**Confirmed untouched**: the two headline-four loops stay `['hb','crp','wcc','creatinine']`
— `labAbnormalItems` at app.js:4401 and the risk-score loop at app.js:4481
(verified by re-reading both after the edits — no diff there).

## Tests

Appended to `tests/frontend-lab-photo-extraction.test.js`, exactly as specified
in the brief:
- `describe('labValueClass — bone profile fields', ...)` — 2 tests (both
  directions for calcium/phosphate; high ALP + low albumin).
- `describe('modal form — bone profile inputs', ...)` — 1 test: renders the
  four new inputs, saves values into `labs` and today's `labsHistory` entry.

### One deviation from the brief's test code (harness limitation, not a design change)

The brief's save-flow test reads `window.patients.find(...)` directly after
`await window.savePatientFromModal()`. `patients` in app.js is a top-level
`let` (module-scope), and per `tests/helpers/frontend-env.js`'s own documented
limitation, top-level `let`/`const` bindings do **not** become `window`
properties — only function declarations and `var` do. Existing tests
(`tests/frontend-worklist.test.js`) work around this by reading results
through a function that returns data (`collectWorklistData()`), not by
touching `window.patients` directly — but the brief's test needs the raw
array back after a mutating async save, and no such getter function exists.

Rather than deviate from the brief's literal test assertions, I extended
`MODAL_FLOW_INIT_SCRIPT` (shared by all modal-flow tests in this file) with
one additional statement, using the same "same-eval closure" trick already
used for `CHECKLIST_CATEGORIES`/`CHECKLIST_STATUSES` in that same const:

```js
'Object.defineProperty(window, "patients", { get: function(){ return patients; }, configurable: true });'
```

Because this line is appended to app.js's own source and evaluated in the
*same* `window.eval()` call, its closure captures the live top-level
`patients` binding — so `window.patients` after this reads the real,
currently-populated array. This is purely additive: no existing test in the
file referenced `window.patients` before, so nothing else could regress from
adding a getter for it. Confirmed by running the full file and full suite
(see below) — no other test's behavior changed.

I did not touch `savePatient`/`savePatientFromModal` or introduce a
`window.patients = patients` assignment inside `app.js` proper — that would
be an unnecessary, non-brief-sanctioned change to production code just to
satisfy a test-harness quirk. The fix lives entirely in the test file.

## TDD RED/GREEN evidence

**RED** — after Step 1 (tests written, before any app.js changes):
```
not ok 8 - labValueClass — bone profile fields (2 subtests failed: labValueClass returned '' instead of 'lab-low'/'lab-high' for calcium/phosphate/alp/albumin)
not ok 9 - modal form — bone profile inputs (f_lab_calcium must exist in the modal form — assertion failed, inputs absent)
# tests 19 / pass 16 / fail 3
```

**GREEN** — after all seven implementation edits + the `labValueClass`
extension:
```
ok 8 - labValueClass — bone profile fields
ok 9 - modal form — bone profile inputs
# tests 19 / pass 19 / fail 0
```

(Intermediate run after the 7 brief-listed edits but *before* extending
`labValueClass` still failed 2 subtests with `'' !== 'lab-low'` /
`'' !== 'lab-high'` — confirming `labValueClass`'s hardcoded per-key branches
were the missing piece, not a stale-state artifact.)

## Full suite

```
npm test
# tests 204 / suites 61 / pass 204 / fail 0 / cancelled 0
```

All 204 tests across the full suite pass, no regressions.

## Files changed

- `/Users/apuravdhankhar/ortho-rounds/public/app.js`
- `/Users/apuravdhankhar/ortho-rounds/tests/frontend-lab-photo-extraction.test.js`

## Commit

```
768ed1f feat: bone profile (Ca/PO4/ALP/albumin) joins the core lab panel
 2 files changed, 74 insertions(+), 9 deletions(-)
```

## Self-review

- Diffed the commit (`git show 768ed1f`) line by line against the brief's
  seven numbered edits — all present, all placed at the anchors specified
  (within a few lines of the brief's approximate line numbers, as expected
  since Tasks 1-2 already landed and shifted some offsets slightly).
- Re-verified both headline-four loops (`app.js:4401`, `app.js:4481`) are
  byte-for-byte unchanged from before this task — grepped and read
  surrounding context after all edits.
- Confirmed no `otherLabs` handling was added anywhere (that's Task 4's job;
  this task only touches the 15-key core panel).
- Ran the focused test file and the full suite, both clean.
- Checked `git status` — only `public/app.js` and the one test file are
  staged/committed; the untracked `.claude/` and `.superpowers/` directories
  in the repo (pre-existing, unrelated to this task) were left alone.

## Concerns

1. **`labValueClass` was not in the brief's seven numbered edits, but was
   required.** The brief's edit list (LAB_SPEC, applySmartPasteLabs pairs,
   LAB_TREND_LABELS, form grid, save collect, hasAnyLabValue,
   upsertLabsHistoryEntry) does not mention `labValueClass`, yet that
   function has no generic fallback — it dispatches on explicit `key ===`
   checks per field, so adding entries to `LAB_SPEC` alone doesn't make
   `labValueClass` flag them. Without this addition, the four new inputs
   would silently never get a `lab-low`/`lab-high` CSS class, i.e. abnormal
   bone-profile values would render with no visual flag — a real functional
   gap, not just a test-passing formality. I flagged this rather than
   silently expanding scope: the fix is a minimal, pattern-consistent
   3-line extension of existing branches, not a rewrite.
2. **Test-file `window.patients` getter** — a harness-only workaround (not
   app.js), explained in detail above. Flagging for visibility since it's a
   deviation from "use the brief's test code verbatim" in letter (I added
   one line to `MODAL_FLOW_INIT_SCRIPT`), though not in the spirit — the
   brief's own task description explicitly anticipated this exact failure
   mode and told me how to handle it.

No other concerns. Task 4 (otherLabs chips UI) and Task 5 (POLISH.md +
final full-suite check) are unaffected by this task's scope.
