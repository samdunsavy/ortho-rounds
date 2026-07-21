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

