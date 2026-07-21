# Labs: Expanded Panel + Capture-Don't-Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the core lab panel from 11 to 15 fields (bone profile) and capture AI-read analytes outside the panel into a reviewable `labs.otherLabs` list instead of silently dropping them.

**Architecture:** The known-key whitelist moves to a single exported `KNOWN_LAB_KEYS` const in `clinical-normalize.js` (shared by server, tests, browser). A new `extractOtherLabs()` harvests unrecognized analytes from the AI photo-extraction response; the value flows `ai.js → server.js → app.js` and is held in modal-scoped pending state, rendered as removable chips, and persisted to `patient.labs.otherLabs` on Save. No new sync/merge machinery: `otherLabs` lives inside the existing `labs` object.

**Tech Stack:** Vanilla JS (ESM on server, script-global in browser), `node --test` + jsdom harness (`tests/helpers/frontend-env.js`).

**Spec:** `docs/superpowers/specs/2026-07-21-labs-capture-dont-drop-design.md`

## Global Constraints

- Purely additive patient-record changes; `/api/sync` v1 contract unchanged (POLICY.md).
- Worklist abnormal-lab surfacing and risk scoring keep their headline-four list `['hb','crp','wcc','creatinine']` — do NOT extend those two loops (app.js ~4392 and ~4472).
- `otherLabs` entries: name max 40 chars, value max 20 chars, max 12 entries, case-insensitive dedupe (first wins), no thresholds/abnormal coloring ever.
- `labsHistory` stores known keys only; `otherLabs` is current-state only.
- New LAB_SPEC entries (Indian report units): calcium mg/dL low 8.5 high 10.5; phosphate mg/dL low 2.5 high 4.5; alp U/L high 120; albumin g/dL low 3.5.
- Run tests with `npm test` (runs `node --no-warnings --test`). Full suite must stay green after every task.
- Frontend test files that drive the modal need `MODAL_FLOW_INIT_SCRIPT` (see `tests/frontend-lab-photo-extraction.test.js:16` for why — `const` bindings don't cross `window.eval()` calls in the harness).

---

### Task 1: `clinical-normalize.js` — KNOWN_LAB_KEYS, 15-key sanitizeLabs, extractOtherLabs, mergeLabs union

**Files:**
- Modify: `clinical-normalize.js:158-172`
- Test: `tests/clinical-normalize.test.js`

**Interfaces:**
- Produces: `KNOWN_LAB_KEYS: string[]` (15 keys, exported); `sanitizeLabs(raw) -> {[key]: string}` (unchanged signature, now 15 keys); `extractOtherLabs(raw) -> [{name, value}]` where `raw` is the whole AI response object (`{labs, otherLabs}`); `mergeLabs(primary, fallback)` (unchanged signature, now unions `otherLabs` arrays by name).

- [ ] **Step 1: Write the failing tests**

Append to `tests/clinical-normalize.test.js` (it already imports `sanitizeLabs` and `mergeLabs` from `../clinical-normalize.js` at line ~10; add `extractOtherLabs` and `KNOWN_LAB_KEYS` to that import):

```js
describe('sanitizeLabs — bone profile keys', () => {
  test('accepts calcium, phosphate, alp, albumin', () => {
    const out = sanitizeLabs({ calcium: '9.1', phosphate: '3.2', alp: '95', albumin: '3.9' });
    assert.deepEqual(out, { calcium: '9.1', phosphate: '3.2', alp: '95', albumin: '3.9' });
  });

  test('KNOWN_LAB_KEYS has exactly the 15 panel keys', () => {
    assert.deepEqual([...KNOWN_LAB_KEYS].sort(), [
      'albumin','alp','calcium','creatinine','crp','esr','hb','phosphate',
      'platelets','potassium','ptinr','rbs','sodium','urea','wcc'
    ]);
  });
});

describe('extractOtherLabs', () => {
  test('harvests unknown keys from labs object and explicit otherLabs array', () => {
    const out = extractOtherLabs({
      labs: { hb: '11', uricAcid: '8.2' },
      otherLabs: [{ name: 'HbA1c', value: '6.1' }]
    });
    assert.deepEqual(out, [
      { name: 'uricAcid', value: '8.2' },
      { name: 'HbA1c', value: '6.1' }
    ]);
  });

  test('caps lengths and entry count, dedupes case-insensitively, drops empties', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Lab${i}`, value: String(i) }));
    const out = extractOtherLabs({ otherLabs: many });
    assert.equal(out.length, 12);

    const capped = extractOtherLabs({ otherLabs: [{ name: 'X'.repeat(60), value: 'Y'.repeat(30) }] });
    assert.equal(capped[0].name.length, 40);
    assert.equal(capped[0].value.length, 20);

    const deduped = extractOtherLabs({ otherLabs: [
      { name: 'Uric Acid', value: '8' },
      { name: 'uric acid', value: '9' },
      { name: '', value: '5' },
      { name: 'Bilirubin', value: '' },
      { name: 'Bilirubin', value: 'null' }
    ]});
    assert.deepEqual(deduped, [{ name: 'Uric Acid', value: '8' }]);
  });

  test('returns [] for malformed input', () => {
    assert.deepEqual(extractOtherLabs(null), []);
    assert.deepEqual(extractOtherLabs('junk'), []);
    assert.deepEqual(extractOtherLabs({ otherLabs: 'junk', labs: 7 }), []);
    assert.deepEqual(extractOtherLabs({ otherLabs: [null, 'x', 42] }), []);
  });
});

describe('mergeLabs — otherLabs union', () => {
  test('unions otherLabs by name, primary wins', () => {
    const out = mergeLabs(
      { hb: '11', otherLabs: [{ name: 'Uric Acid', value: '8.2' }] },
      { crp: '5', otherLabs: [{ name: 'uric acid', value: '7.0' }, { name: 'HbA1c', value: '6.1' }] }
    );
    assert.equal(out.hb, '11');
    assert.equal(out.crp, '5');
    assert.deepEqual(out.otherLabs, [
      { name: 'Uric Acid', value: '8.2' },
      { name: 'HbA1c', value: '6.1' }
    ]);
  });

  test('no otherLabs key when neither side has entries', () => {
    const out = mergeLabs({ hb: '11' }, { crp: '5' });
    assert.equal('otherLabs' in out, false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/clinical-normalize.test.js`
Expected: FAIL — `KNOWN_LAB_KEYS`/`extractOtherLabs` not exported; bone-profile keys dropped by `sanitizeLabs`; `otherLabs` union missing.

- [ ] **Step 3: Implement in `clinical-normalize.js`**

Replace lines 158-172 (`sanitizeLabs` + `mergeLabs`) with:

```js
export const KNOWN_LAB_KEYS = [
  'hb', 'crp', 'wcc', 'creatinine', 'platelets', 'esr', 'urea',
  'sodium', 'potassium', 'ptinr', 'rbs',
  'calcium', 'phosphate', 'alp', 'albumin'
];

export function sanitizeLabs(raw){
  if(!raw || typeof raw !== 'object') return {};
  const out = {};
  for(const key of KNOWN_LAB_KEYS){
    const val = raw[key];
    if(val === undefined || val === null) continue;
    const str = String(val).trim();
    if(str && str.toLowerCase() !== 'null') out[key] = str;
  }
  return out;
}

const OTHER_LABS_MAX = 12;
const OTHER_LAB_NAME_MAX = 40;
const OTHER_LAB_VALUE_MAX = 20;

/** Harvest analytes the AI read that aren't in the known panel.
 *  `raw` is the whole AI response object: unknown keys inside raw.labs
 *  plus entries of raw.otherLabs ([{name, value}]). Capture-don't-drop. */
export function extractOtherLabs(raw){
  const out = [];
  const seen = new Set();
  const push = (name, value) => {
    const n = String(name ?? '').trim().slice(0, OTHER_LAB_NAME_MAX);
    const v = String(value ?? '').trim().slice(0, OTHER_LAB_VALUE_MAX);
    if(!n || !v || v.toLowerCase() === 'null') return;
    const dedupeKey = n.toLowerCase();
    if(seen.has(dedupeKey) || out.length >= OTHER_LABS_MAX) return;
    seen.add(dedupeKey);
    out.push({ name: n, value: v });
  };
  if(!raw || typeof raw !== 'object') return out;
  if(raw.labs && typeof raw.labs === 'object'){
    for(const [k, v] of Object.entries(raw.labs)){
      if(!KNOWN_LAB_KEYS.includes(k)) push(k, v);
    }
  }
  if(Array.isArray(raw.otherLabs)){
    for(const entry of raw.otherLabs){
      if(entry && typeof entry === 'object') push(entry.name, entry.value);
    }
  }
  return out;
}

export function mergeLabs(primary, fallback){
  const merged = Object.assign({}, fallback || {}, primary || {});
  const pOther = Array.isArray(primary?.otherLabs) ? primary.otherLabs : [];
  const fOther = Array.isArray(fallback?.otherLabs) ? fallback.otherLabs : [];
  if(pOther.length || fOther.length){
    const seen = new Set();
    const union = [];
    for(const e of [...pOther, ...fOther]){
      if(!e || !e.name) continue;
      const k = String(e.name).toLowerCase();
      if(seen.has(k)) continue;
      seen.add(k);
      union.push(e);
    }
    merged.otherLabs = union;
  }else{
    delete merged.otherLabs;
  }
  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/clinical-normalize.test.js`
Expected: PASS (all, including pre-existing sanitizeLabs/mergeLabs tests).

- [ ] **Step 5: Commit**

```bash
git add clinical-normalize.js tests/clinical-normalize.test.js
git commit -m "feat: 15-key lab panel + extractOtherLabs capture in clinical-normalize"
```

---

### Task 2: `ai.js` + `server.js` — prompt updates and otherLabs passthrough

**Files:**
- Modify: `ai.js` (`parseLabsFromImage` ~416-434, `parseAdmission` prompt ~371, import at line 6)
- Modify: `server.js:599-600`
- Test: `tests/ai-parse-labs-image.test.js`

**Interfaces:**
- Consumes: `extractOtherLabs(raw)`, `KNOWN_LAB_KEYS` from Task 1.
- Produces: `parseLabsFromImage(imageDataUrl) -> { labs, otherLabs, reportDate }` (new `otherLabs` key); `POST /api/ai/parse-labs-image` response gains `otherLabs`.

- [ ] **Step 1: Write the failing test**

Append to `tests/ai-parse-labs-image.test.js` inside the existing `describe('parseLabsFromImage')` (uses the file's existing `mockOpenAi` helper):

```js
  test('captures unrecognized analytes as otherLabs instead of dropping them', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          labs: { hb: '11.2', uricAcid: '8.2' },
          otherLabs: [{ name: 'HbA1c', value: '6.1' }],
          reportDate: null
        }) } }]
      })
    }));
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.equal(result.labs.hb, '11.2');
    assert.equal('uricAcid' in result.labs, false);
    assert.deepEqual(result.otherLabs, [
      { name: 'uricAcid', value: '8.2' },
      { name: 'HbA1c', value: '6.1' }
    ]);
  });

  test('accepts bone-profile keys as first-class labs', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          labs: { calcium: '9.1', phosphate: '3.2', alp: '95', albumin: '3.9' },
          reportDate: null
        }) } }]
      })
    }));
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.deepEqual(result.labs, { calcium: '9.1', phosphate: '3.2', alp: '95', albumin: '3.9' });
    assert.deepEqual(result.otherLabs, []);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ai-parse-labs-image.test.js`
Expected: FAIL — `result.otherLabs` is `undefined`; bone-profile test may already pass after Task 1 (fine).

- [ ] **Step 3: Implement**

In `ai.js` line 6 import block, add `extractOtherLabs` to the existing `from './clinical-normalize.js'` import.

In `parseLabsFromImage`, replace the system prompt's key list line ("labs": object with optional string keys — …) with:

```
"labs": object with optional string keys — hb, platelets, wcc, esr, crp, urea, creatinine, sodium, potassium, ptinr, rbs, calcium, phosphate, alp, albumin. Use the exact numeric value as printed (no units in the value). Omit any key not legible or not present on the report — never guess or invent a value.
"otherLabs": array of {name, value} for any other legible analyte printed on the report that does not fit a key above. name exactly as printed (max 30 chars), value as printed without units. Same rules: transcribe only, never guess, no patient-identifying text.
```

And after `const labs = sanitizeLabs(raw?.labs);` add:

```js
  const otherLabs = extractOtherLabs(raw);
```

Change the return to:

```js
  return { labs, otherLabs, reportDate };
```

In `parseAdmission`'s system prompt (~line 371), change

```
labs: object with optional keys hb, crp, wcc, creatinine (string numbers only, Indian report units),
```

to

```
labs: object with optional keys hb, crp, wcc, creatinine, platelets, esr, urea, sodium, potassium, ptinr, rbs, calcium, phosphate, alp, albumin (string numbers only, Indian report units),
```

In `server.js` lines 599-600, replace:

```js
        const { labs, otherLabs, reportDate } = await parseLabsFromImage(body.image);
        return sendJSON(res, 200, { labs, otherLabs, reportDate });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/ai-parse-labs-image.test.js`
Expected: PASS (all, including the three pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add ai.js server.js tests/ai-parse-labs-image.test.js
git commit -m "feat: AI lab extraction returns otherLabs; prompts cover 15-key panel"
```

---

### Task 3: `public/app.js` — 15-field core panel (LAB_SPEC, form grid, save, trends)

**Files:**
- Modify: `public/app.js` — `LAB_SPEC` (~88-100), `applySmartPasteLabs` pairs (~1283-1295), `LAB_TREND_LABELS` (~2768-2772), form grid (~6338-6348), save collect + `hasAnyLabValue` + `upsertLabsHistoryEntry` patch (~7176-7199)
- Test: `tests/frontend-lab-photo-extraction.test.js`

**Interfaces:**
- Consumes: nothing new (browser file; `sanitizeLabs` runs server-side).
- Produces: form inputs `f_lab_calcium`, `f_lab_phosphate`, `f_lab_alp`, `f_lab_albumin`; `LAB_SPEC`/`LAB_TREND_LABELS` entries for the 4 new keys (Task 4 renders chips next to this grid).

**Do NOT touch** the headline-four loops at ~4392 (`labAbnormalItems`) and ~4472 (risk score) — they stay `['hb','crp','wcc','creatinine']` by design.

- [ ] **Step 1: Write the failing tests**

Append to `tests/frontend-lab-photo-extraction.test.js`:

```js
describe('labValueClass — bone profile fields', () => {
  test('flags both directions for calcium and phosphate', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.labValueClass('calcium', '7.9'), 'lab-low');
    assert.equal(window.labValueClass('calcium', '11.2'), 'lab-high');
    assert.equal(window.labValueClass('calcium', '9.4'), '');
    assert.equal(window.labValueClass('phosphate', '2.1'), 'lab-low');
    assert.equal(window.labValueClass('phosphate', '5.0'), 'lab-high');
  });

  test('flags high ALP and low albumin', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.labValueClass('alp', '300'), 'lab-high');
    assert.equal(window.labValueClass('alp', '90'), '');
    assert.equal(window.labValueClass('albumin', '2.9'), 'lab-low');
    assert.equal(window.labValueClass('albumin', '4.1'), '');
  });
});

describe('modal form — bone profile inputs', () => {
  test('renders the four new inputs and saves them into labs + labsHistory', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.openPatientModal(window.blankPatient());
    for(const id of ['f_lab_calcium', 'f_lab_phosphate', 'f_lab_alp', 'f_lab_albumin']){
      assert.ok(document.getElementById(id), `${id} must exist in the modal form`);
    }
    document.getElementById('f_name').value = 'Test Patient';
    document.getElementById('f_lab_calcium').value = '9.1';
    document.getElementById('f_lab_albumin').value = '3.9';
    await window.savePatientFromModal();
    const saved = window.patients.find(p => p.name === 'Test Patient');
    assert.equal(saved.labs.calcium, '9.1');
    assert.equal(saved.labs.albumin, '3.9');
    const todayEntry = saved.labsHistory.find(h => h.date === saved.labs.updatedAt);
    assert.equal(todayEntry.calcium, '9.1');
    assert.equal(todayEntry.albumin, '3.9');
  });
});
```

`savePatientFromModal()` (public/app.js:7144, async) is the Save button's entry point — always `await` it in tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend-lab-photo-extraction.test.js`
Expected: FAIL — `labValueClass` returns `''` for unknown keys; new inputs absent.

- [ ] **Step 3: Implement in `public/app.js`**

1. `LAB_SPEC` — add before the closing brace:

```js
  calcium:    { unit: 'mg/dL',       low: 8.5,   high: 10.5 },
  phosphate:  { unit: 'mg/dL',       low: 2.5,   high: 4.5 },
  alp:        { unit: 'U/L',         high: 120 },
  albumin:    { unit: 'g/dL',        low: 3.5 }
```

2. `applySmartPasteLabs` pairs array — add:

```js
    ['calcium', 'f_lab_calcium'],
    ['phosphate', 'f_lab_phosphate'],
    ['alp', 'f_lab_alp'],
    ['albumin', 'f_lab_albumin']
```

3. `LAB_TREND_LABELS` — add `calcium: 'Ca', phosphate: 'PO4', alp: 'ALP', albumin: 'Albumin'` (trend panel iterates these keys, so sparklines come free).

4. Form grid — after the RBS input div, add:

```html
        <div><span>Calcium (mg/dL)</span><input id="f_lab_calcium" inputmode="decimal" placeholder="e.g. 9.2" value="${escapeHTML((d.labs||{}).calcium||'')}" class="${labValueClass('calcium', (d.labs||{}).calcium)}"></div>
        <div><span>Phosphate (mg/dL)</span><input id="f_lab_phosphate" inputmode="decimal" placeholder="e.g. 3.4" value="${escapeHTML((d.labs||{}).phosphate||'')}" class="${labValueClass('phosphate', (d.labs||{}).phosphate)}"></div>
        <div><span>ALP (U/L)</span><input id="f_lab_alp" inputmode="decimal" placeholder="e.g. 90" value="${escapeHTML((d.labs||{}).alp||'')}" class="${labValueClass('alp', (d.labs||{}).alp)}"></div>
        <div><span>Albumin (g/dL)</span><input id="f_lab_albumin" inputmode="decimal" placeholder="e.g. 4.0" value="${escapeHTML((d.labs||{}).albumin||'')}" class="${labValueClass('albumin', (d.labs||{}).albumin)}"></div>
```

5. Save collect (`d.labs = {...}`) — add the four keys following the existing pattern:

```js
      calcium: document.getElementById('f_lab_calcium')?.value.trim() || '',
      phosphate: document.getElementById('f_lab_phosphate')?.value.trim() || '',
      alp: document.getElementById('f_lab_alp')?.value.trim() || '',
      albumin: document.getElementById('f_lab_albumin')?.value.trim() || '',
```

6. `hasAnyLabValue` key list — append `'calcium', 'phosphate', 'alp', 'albumin'`.

7. `upsertLabsHistoryEntry` patch object — add `calcium: d.labs.calcium, phosphate: d.labs.phosphate, alp: d.labs.alp, albumin: d.labs.albumin`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend-lab-photo-extraction.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/app.js tests/frontend-lab-photo-extraction.test.js
git commit -m "feat: bone profile (Ca/PO4/ALP/albumin) joins the core lab panel"
```

---

### Task 4: `public/app.js` — otherLabs pending state, chips UI, save persistence

**Files:**
- Modify: `public/app.js` — module state (~line 20), `openPatientModal` reset block (~6114-6118), `closePatientModal` reset block (~6185-6188), labs form-row markup (after `renderLabsTrendPanel(d)` insertion point ~6350), delegated click handler (near the `#labPhotoBtn` delegation at ~956), `handleLabPhotoSelected` (~1599-1612), save collect (~7188), `formatLabsLine` (~2733-2741)
- Modify: `public/index.html` — chip styles (near `.labs-grid` rules at ~392)
- Test: `tests/frontend-lab-photo-extraction.test.js`

**Interfaces:**
- Consumes: `f_lab_*` grid from Task 3; server response `{ labs, otherLabs, reportDate }` from Task 2.
- Produces: `modalPendingOtherLabs: [{name, value}]` (module state); `renderOtherLabsChips()` (window function, jsdom-visible); persisted `patient.labs.otherLabs`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/frontend-lab-photo-extraction.test.js`:

```js
describe('otherLabs — capture-don\'t-drop chips', () => {
  test('modal seeds pending otherLabs from the patient and renders removable chips', () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    const p = window.blankPatient();
    p.labs = { hb: '11', updatedAt: '2026-07-20', otherLabs: [
      { name: 'Uric Acid', value: '8.2' },
      { name: 'HbA1c', value: '6.1' }
    ]};
    window.openPatientModal(p);
    const chips = document.querySelectorAll('#otherLabsChips .other-lab-chip');
    assert.equal(chips.length, 2);
    assert.match(chips[0].textContent, /Uric Acid/);
    assert.match(chips[0].textContent, /8\.2/);
    assert.ok(chips[0].querySelector('.other-lab-remove'), 'chip must have a remove control');
  });

  test('removing a chip drops it from pending state and the next save', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    const p = window.blankPatient();
    p.name = 'Chip Patient';
    p.labs = { hb: '11', updatedAt: '2026-07-20', otherLabs: [
      { name: 'Uric Acid', value: '8.2' },
      { name: 'HbA1c', value: '6.1' }
    ]};
    window.openPatientModal(p);
    document.querySelector('#otherLabsChips .other-lab-chip .other-lab-remove').click();
    assert.equal(document.querySelectorAll('#otherLabsChips .other-lab-chip').length, 1);
    await window.savePatientFromModal();
    const saved = window.patients.find(x => x.name === 'Chip Patient');
    assert.deepEqual(saved.labs.otherLabs, [{ name: 'HbA1c', value: '6.1' }]);
  });

  test('empty otherLabs renders no chips container content and saves no key', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    const p = window.blankPatient();
    p.name = 'Plain Patient';
    window.openPatientModal(p);
    assert.equal(document.querySelectorAll('#otherLabsChips .other-lab-chip').length, 0);
    await window.savePatientFromModal();
    const saved = window.patients.find(x => x.name === 'Plain Patient');
    assert.equal('otherLabs' in (saved.labs || {}), false);
  });

  test('photo extraction merges new extras into pending chips (dedupe by name, new value wins)', () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    const p = window.blankPatient();
    p.labs = { hb: '11', updatedAt: '2026-07-20', otherLabs: [{ name: 'Uric Acid', value: '7.0' }] };
    window.openPatientModal(p);
    window.mergePendingOtherLabs([{ name: 'uric acid', value: '8.2' }, { name: 'HbA1c', value: '6.1' }]);
    const chips = [...document.querySelectorAll('#otherLabsChips .other-lab-chip')].map(c => c.textContent);
    assert.equal(chips.length, 2);
    assert.match(chips[0], /8\.2/);
    assert.match(chips[1], /HbA1c/);
  });

  test('formatLabsLine appends otherLabs plainly after headline labs', () => {
    const { window } = loadFrontendEnv();
    const line = window.formatLabsLine({ labs: {
      hb: '11', otherLabs: [{ name: 'Uric Acid', value: '8.2' }]
    }});
    assert.match(line, /Hb 11 g\/dL/);
    assert.match(line, /Uric Acid 8\.2/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend-lab-photo-extraction.test.js`
Expected: FAIL — `#otherLabsChips` absent, `mergePendingOtherLabs` undefined.

- [ ] **Step 3: Implement in `public/app.js` and `public/index.html`**

1. Module state, next to `modalLabReportDate` (~line 20):

```js
let modalPendingOtherLabs = []; // AI-read analytes outside the known panel, pending doctor review
```

2. `openPatientModal` reset block: after `modalLabReportDate = null;` add

```js
  modalPendingOtherLabs = Array.isArray(modalWorkingData?.labs?.otherLabs)
    ? modalWorkingData.labs.otherLabs.map(e => ({ name: e.name, value: e.value }))
    : [];
```

(Place it after the `modalWorkingData = ...` assignment — check ordering when editing.)

3. `closePatientModal` reset block: after `modalLabReportDate = null;` add `modalPendingOtherLabs = [];`

4. Markup — in the labs form-row, immediately before `${renderLabsTrendPanel(d)}`:

```html
      <div id="otherLabsChips">${renderOtherLabsChipsHTML()}</div>
```

5. Render + merge functions (near `applySmartPasteLabs`):

```js
function renderOtherLabsChipsHTML(){
  if(!modalPendingOtherLabs.length) return '';
  const chips = modalPendingOtherLabs.map((e, i) =>
    `<span class="other-lab-chip">${escapeHTML(e.name)} ${escapeHTML(e.value)}` +
    `<button type="button" class="other-lab-remove" data-other-lab-idx="${i}" aria-label="Remove ${escapeHTML(e.name)}">×</button></span>`
  ).join('');
  return `<div class="form-hint">Also on report (not trended):</div>${chips}`;
}

function renderOtherLabsChips(){
  const el = document.getElementById('otherLabsChips');
  if(el) el.innerHTML = renderOtherLabsChipsHTML();
}

/** Merge AI-read extras into pending state; case-insensitive by name, incoming value wins. */
function mergePendingOtherLabs(incoming){
  if(!Array.isArray(incoming)) return;
  for(const e of incoming){
    if(!e || !e.name || !e.value) continue;
    const idx = modalPendingOtherLabs.findIndex(x => x.name.toLowerCase() === String(e.name).toLowerCase());
    if(idx >= 0) modalPendingOtherLabs[idx] = { name: modalPendingOtherLabs[idx].name, value: String(e.value) };
    else if(modalPendingOtherLabs.length < 12) modalPendingOtherLabs.push({ name: String(e.name), value: String(e.value) });
  }
  renderOtherLabsChips();
}
```

6. Delegated click handler — in the same document-level click delegation that handles `#labPhotoBtn` (~956), add:

```js
    const otherLabRemove = e.target.closest('.other-lab-remove');
    if(otherLabRemove){
      const idx = Number(otherLabRemove.dataset.otherLabIdx);
      if(!Number.isNaN(idx)){
        modalPendingOtherLabs.splice(idx, 1);
        renderOtherLabsChips();
      }
      return;
    }
```

7. `handleLabPhotoSelected` — destructure and merge:

```js
    const { labs, otherLabs, reportDate } = await callAi('parse-labs-image', { image: compressed });
    const filled = applySmartPasteLabs(labs);
    mergePendingOtherLabs(otherLabs);
```

And extend the toast so extras aren't invisible: after computing `filled`, use

```js
    const extraCount = Array.isArray(otherLabs) ? otherLabs.length : 0;
    showToast(filled || extraCount
      ? `Filled ${filled} field${filled === 1 ? '' : 's'}${extraCount ? ` + ${extraCount} other lab${extraCount === 1 ? '' : 's'}` : ''} — review before saving`
      : 'Nothing recognisable in that photo');
```

8. Save collect — after the `d.labs = {...}` assignment (~7188):

```js
    if(modalPendingOtherLabs.length) d.labs.otherLabs = modalPendingOtherLabs.slice();
```

(When the pending list is empty, no `otherLabs` key is written — removing the last chip removes the data.)

9. `formatLabsLine` — before `return parts.join(' · ');` add:

```js
  for(const e of (labs.otherLabs || [])){
    if(e && e.name && e.value) parts.push(`${e.name} ${e.value}`);
  }
```

10. `public/index.html` — after the `.labs-grid input.lab-high` rule add:

```css
  .other-lab-chip{display:inline-flex;align-items:center;gap:4px;margin:4px 6px 0 0;padding:2px 8px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font-size:12px;}
  .other-lab-chip .other-lab-remove{border:none;background:none;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;padding:0 2px;}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend-lab-photo-extraction.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/index.html tests/frontend-lab-photo-extraction.test.js
git commit -m "feat: capture-don't-drop otherLabs chips in patient modal"
```

---

### Task 5: POLISH.md backlog note + full-suite verification

**Files:**
- Modify: `POLISH.md`
- Modify (if needed): none — this task is verification.

**Interfaces:** none.

- [ ] **Step 1: Add the deferred-milestones backlog note**

Append to the backlog section of `POLISH.md`:

```markdown
- Voice-round scribe: surface spoken-but-unmatched milestone actions as one-tap
  suggested checklist additions (deferred 2026-07-21 — labs capture-don't-drop
  prioritized; the ward template library already covers milestone customization).
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — every test file green, no regressions in sync-merge, worklist, milestones, admission-format, or storage tests.

- [ ] **Step 3: Verify old-client compatibility claim from the spec**

Run: `npm test -- tests/frontend-sync-merge.test.js tests/merge.test.js`
Expected: PASS. Then confirm by inspection (`grep -n "labs" merge.js`) that the labs object merges as a unit (newer `updatedAt` wins whole-object) — meaning `otherLabs` rides along and an older client's labs write replaces it wholesale, the documented-acceptable behavior for any new lab key. If merge.js instead merges labs per-key, add a regression test asserting `otherLabs` survives a merge where the other side lacks it.

- [ ] **Step 4: Commit**

```bash
git add POLISH.md
git commit -m "chore: log deferred milestone voice-suggestions in POLISH backlog"
```

