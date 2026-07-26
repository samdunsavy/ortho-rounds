### Task 1: Bulk "Move to unit" action (frontend only)

**Files:**
- Modify: `public/index.html:1859-1861` (bulk action bar — add a button)
- Modify: `public/app.js` — add `flatUnitsFromScopeTree`, `movePatientToUnit`, `bulkMoveToUnit`; wire the button (~`public/app.js:3859`); toggle button visibility in `updateBulkBar` (~`public/app.js:8340`)
- Test: `tests/frontend-bulk-move.test.js`

**Interfaces:**
- Consumes: `loadScopeTree()` → `{ assignment, tree }` where `tree.departments[] = { id, name, units: [{ id, name, wards }] }`; `bulkSelectedIds: Set<string>`; `patients: Array`; `savePatient(p)`; `isAdmin()`; `scopePickerActive()`; `showPromptFields(title, fields)` (supports `{ id, label, type: 'select', value, options: [{value,label}] }`, resolves to `{ [id]: value }` or null); `updateBulkBar()`; `renderAll()`; `showToast(msg)`.
- Produces: `flatUnitsFromScopeTree(tree) -> [{ id, name }]`; `movePatientToUnit(p, unitId) -> p` (sets `p.unitId`, deletes `p.wardId` and `p.ward`); `bulkMoveToUnit() -> Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/frontend-bulk-move.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

const INIT = [
  'Object.defineProperty(window, "patients", { get: function(){ return patients; }, set: function(v){ patients = v; }, configurable: true });',
  'Object.defineProperty(window, "bulkSelectedIds", { get: function(){ return bulkSelectedIds; }, configurable: true });'
].join('\n');

describe('flatUnitsFromScopeTree', () => {
  test('flattens departments -> units into id/name pairs, dept-qualified', () => {
    const { window } = loadFrontendEnv();
    const tree = { departments: [
      { id: 'dep1', name: 'Ortho', units: [{ id: 'u1', name: 'Unit One', wards: [] }, { id: 'u2', name: 'IV', wards: [] }] },
      { id: 'dep2', name: 'Surgery', units: [{ id: 'u3', name: 'Gen', wards: [] }] }
    ] };
    const out = window.flatUnitsFromScopeTree(tree);
    assert.deepEqual(out.map(u => u.id), ['u1', 'u2', 'u3']);
    assert.equal(out[0].name, 'Ortho · Unit One');
    assert.equal(out[2].name, 'Surgery · Gen');
  });

  test('empty / missing tree yields []', () => {
    const { window } = loadFrontendEnv();
    assert.deepEqual(window.flatUnitsFromScopeTree(null), []);
    assert.deepEqual(window.flatUnitsFromScopeTree({ departments: [] }), []);
  });
});

describe('movePatientToUnit', () => {
  test('sets unitId and clears stale ward fields (server re-derives ancestry on sync)', () => {
    const { window } = loadFrontendEnv();
    const p = { id: 'p1', unitId: 'u1', wardId: 'w1', ward: 'Ward One', unit: 'Unit One' };
    window.movePatientToUnit(p, 'u2');
    assert.equal(p.unitId, 'u2');
    assert.equal('wardId' in p, false);
    assert.equal('ward' in p, false);
  });
});

describe('bulkMoveToUnit', () => {
  test('moves every selected patient to the chosen unit and exits select mode', async () => {
    const { window } = loadFrontendEnv({ initScript: INIT });
    window.serverFlags = { MULTI_TENANT: true };
    localStorage.setItem('ortho_role', 'admin');
    window.fetch = async (url) => {
      if(String(url).includes('/api/me/scope')){
        return { ok: true, status: 200, json: async () => ({ assignment: null, tree: { departments: [
          { id: 'dep1', name: 'Ortho', units: [{ id: 'u1', name: 'One', wards: [] }, { id: 'u2', name: 'IV', wards: [] }] }
        ] } }) };
      }
      return { ok: true, status: 200, json: async () => ({ serverTime: 1, patients: [], apiVersion: 1, scoped: true, rejected: [] }) };
    };
    window.showPromptFields = async () => ({ unit: 'u2' });
    window.patients = [{ id: 'a', unitId: 'u1' }, { id: 'b', unitId: 'u1' }, { id: 'c', unitId: 'u1' }];
    window.bulkSelectedIds.add('a');
    window.bulkSelectedIds.add('b');

    await window.bulkMoveToUnit();

    assert.equal(window.patients.find(p => p.id === 'a').unitId, 'u2');
    assert.equal(window.patients.find(p => p.id === 'b').unitId, 'u2');
    assert.equal(window.patients.find(p => p.id === 'c').unitId, 'u1', 'unselected patient untouched');
    assert.equal(window.bulkSelectedIds.size, 0, 'selection cleared after move');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --no-warnings --test tests/frontend-bulk-move.test.js`
Expected: FAIL — `window.flatUnitsFromScopeTree is not a function`.

- [ ] **Step 3: Implement the three functions in `public/app.js`**

Add near the scope-picker helpers (after `invalidateScopeTree`, ~`public/app.js:6150`):

```js
function flatUnitsFromScopeTree(tree){
  const out = [];
  for(const dep of ((tree && tree.departments) || [])){
    for(const u of (dep.units || [])){
      out.push({ id: u.id, name: dep.name ? `${dep.name} · ${u.name}` : u.name });
    }
  }
  return out;
}

function movePatientToUnit(p, unitId){
  p.unitId = unitId;
  // Moving units invalidates any ward; the server re-derives ward + ancestry
  // labels from the new unitId on sync, so drop the stale ward locally.
  delete p.wardId;
  delete p.ward;
  return p;
}

async function bulkMoveToUnit(){
  if(!bulkSelectedIds.size){ showToast('Select patients first'); return; }
  const { tree } = await loadScopeTree();
  const units = flatUnitsFromScopeTree(tree);
  if(!units.length){ showToast('No units yet — create one in the console'); return; }
  const fields = await showPromptFields('Move to unit', [
    { id: 'unit', label: `Move ${bulkSelectedIds.size} patient(s) to`, type: 'select', value: '',
      options: [{ value: '', label: 'Select unit…' }].concat(units.map(u => ({ value: u.id, label: u.name }))) }
  ]);
  if(!fields || !fields.unit) return;
  const count = bulkSelectedIds.size;
  for(const id of bulkSelectedIds){
    const p = patients.find(x => x.id === id);
    if(!p) continue;
    movePatientToUnit(p, fields.unit);
    await savePatient(p);
  }
  bulkSelectMode = false;
  bulkSelectedIds.clear();
  document.getElementById('bulkPlanBtn')?.classList.remove('active');
  updateBulkBar();
  renderAll();
  showToast(`Moved ${count} patient(s)`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --no-warnings --test tests/frontend-bulk-move.test.js`
Expected: PASS (all).

- [ ] **Step 5: Add the button and wiring**

In `public/index.html`, add the button between apply and cancel (currently lines 1859-1861):

```html
<span><strong class="bulk-plan-count">0</strong> selected</span>
<button type="button" class="btn primary pressable" id="bulkBarApplyBtn">Apply plan</button>
<button type="button" class="btn pressable" id="bulkBarMoveBtn" hidden>Move to unit</button>
<button type="button" class="btn pressable" id="bulkBarCancelBtn">Cancel</button>
```

In `public/app.js`, next to the existing `bulkBarApplyBtn` listener (~line 3859):

```js
document.getElementById('bulkBarMoveBtn')?.addEventListener('click', ()=> void bulkMoveToUnit());
```

In `updateBulkBar()` (~line 8340), after the `.bulk-plan-count` update, gate the move button to admins in multi-tenant mode:

```js
  const moveBtn = document.getElementById('bulkBarMoveBtn');
  if(moveBtn) moveBtn.hidden = !(isAdmin() && scopePickerActive());
```

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — all pass (button/wiring are inert markup; the golden flag-off contract is untouched).

```bash
git add public/index.html public/app.js tests/frontend-bulk-move.test.js
git commit -m "feat: admin bulk 'Move to unit' to reorganize patients into real units"
```

---

