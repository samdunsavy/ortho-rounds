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

