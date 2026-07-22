import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

/* Same workaround documented in frontend-lab-photo-extraction.test.js:
   openPatientModal() -> bindModalDynamicLists() -> renderPostOpList() reads
   CHECKLIST_CATEGORIES, a `const` in milestones.js that (per frontend-env.js)
   doesn't survive a separate window.eval() call, so any test driving the
   modal open/close flow needs it redefined inside app.js's own eval via
   initScript. */
const MODAL_FLOW_INIT_SCRIPT = [
  'var CHECKLIST_CATEGORIES = ["nv","mobilization","imaging","antibiotics","drain","wound","other"];',
  'var CHECKLIST_STATUSES = ["pending","done","skipped","na"];',
  'Object.defineProperty(window, "patients", { get: function(){ return patients; }, configurable: true });',
  'bindAiEvents();'
].join('\n');

const SCOPE_TREE_ONE_UNIT = {
  departments: [{
    id: 'dep1', name: 'Ortho',
    wards: [{ id: 'ward1', name: 'Ward One', units: [{ id: 'u1', name: 'Unit One' }] }]
  }]
};

const SCOPE_TREE_TWO_UNITS = {
  departments: [{
    id: 'dep1', name: 'Ortho',
    wards: [{ id: 'ward1', name: 'Ward One', units: [
      { id: 'u1', name: 'Unit One' }, { id: 'u2', name: 'Unit Two' }
    ] }]
  }]
};

function stubScopeFetch(tree, assignment = null){
  return async (url) => {
    if(String(url).includes('/api/me/scope')){
      return { ok: true, status: 200, json: async () => ({ assignment, tree }) };
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not mocked' }) };
  };
}

describe('patient form dept/ward/unit picker (MULTI_TENANT on)', () => {
  test('a single-unit scope pre-selects and disables the whole chain; saving persists unitId', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.serverFlags = { MULTI_TENANT: true };
    window.fetch = stubScopeFetch(SCOPE_TREE_ONE_UNIT, { type: 'unit', id: 'u1' });

    const p = window.blankPatient();
    p.name = 'One Unit Patient';
    await window.openPatientModal(p);

    const depEl = document.getElementById('f_department');
    const wardEl = document.getElementById('f_ward');
    const unitEl = document.getElementById('f_unit');
    assert.ok(depEl && wardEl && unitEl, 'department/ward/unit selects must be rendered when MULTI_TENANT is on');
    assert.equal(depEl.tagName, 'SELECT');
    assert.equal(wardEl.tagName, 'SELECT');
    assert.equal(unitEl.tagName, 'SELECT');

    assert.equal(depEl.value, 'dep1');
    assert.equal(wardEl.value, 'ward1');
    assert.equal(unitEl.value, 'u1');
    assert.equal(depEl.disabled, true, 'a single-unit scope locks the department select');
    assert.equal(wardEl.disabled, true, 'a single-unit scope locks the ward select');
    assert.equal(unitEl.disabled, true, 'a single-unit scope locks the unit select');

    await window.savePatientFromModal();
    const saved = window.patients.find(x => x.name === 'One Unit Patient');
    assert.ok(saved, 'patient must have been saved');
    assert.equal(saved.unitId, 'u1');
  });

  test('a multi-unit scope leaves the picker enabled and unselected by default; saving without a choice surfaces the validation toast', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.serverFlags = { MULTI_TENANT: true };
    window.fetch = stubScopeFetch(SCOPE_TREE_TWO_UNITS, null);

    const p = window.blankPatient();
    p.name = 'Two Unit Patient';
    await window.openPatientModal(p);

    const depEl = document.getElementById('f_department');
    const wardEl = document.getElementById('f_ward');
    const unitEl = document.getElementById('f_unit');
    assert.equal(depEl.disabled, false);
    assert.equal(wardEl.disabled, false);
    assert.equal(unitEl.disabled, false);
    assert.equal(unitEl.value, '', 'no unit is pre-selected when scope has more than one unit');
    // Both units must be offered once a ward is picked.
    assert.deepEqual([...unitEl.options].map(o => o.value).filter(Boolean).sort(), ['u1', 'u2']);

    let toastMsg = null;
    window.showToast = (msg) => { toastMsg = msg; };
    await window.savePatientFromModal();

    assert.match(toastMsg || '', /select a unit/i, 'the existing toast validation path must fire');
    assert.equal(window.patients.find(x => x.name === 'Two Unit Patient'), undefined, 'save must be blocked, not silently persisted without a unit');

    // Now actually choose a unit and confirm save succeeds with the right id.
    unitEl.value = 'u2';
    await window.savePatientFromModal();
    const saved = window.patients.find(x => x.name === 'Two Unit Patient');
    assert.ok(saved);
    assert.equal(saved.unitId, 'u2');
  });
});

describe('patient form dept/ward/unit picker (MULTI_TENANT off — legacy behavior unchanged)', () => {
  test('renders the legacy free-text ward/unit inputs, not selects', () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.serverFlags = { MULTI_TENANT: false };
    window.openPatientModal(window.blankPatient());

    assert.equal(document.getElementById('f_department'), null, 'no department select flag-off');
    const wardEl = document.getElementById('f_ward');
    const unitEl = document.getElementById('f_unit');
    assert.equal(wardEl.tagName, 'INPUT');
    assert.equal(unitEl.tagName, 'INPUT');
  });

  test('saving still writes ward/unit free text and does not require a unitId', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.serverFlags = { MULTI_TENANT: false };
    window.openPatientModal(window.blankPatient());
    document.getElementById('f_name').value = 'Legacy Patient';
    document.getElementById('f_ward').value = '7FOW';
    document.getElementById('f_unit').value = 'IV';

    await window.savePatientFromModal();
    const saved = window.patients.find(x => x.name === 'Legacy Patient');
    assert.ok(saved);
    assert.equal(saved.ward, '7FOW');
    assert.equal(saved.unit, 'IV');
    assert.equal('unitId' in saved, false);
  });
});
