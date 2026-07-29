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
    units: [{ id: 'u1', name: 'Unit One', wards: [{ id: 'ward1', name: 'Ward One' }] }]
  }]
};

const SCOPE_TREE_TWO_UNITS = {
  departments: [{
    id: 'dep1', name: 'Ortho',
    units: [
      { id: 'u1', name: 'Unit One', wards: [{ id: 'ward1', name: 'Ward One' }] },
      { id: 'u2', name: 'Unit Two', wards: [] }
    ]
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

describe('patient form dept/unit/ward picker (MULTI_TENANT on)', () => {
  test('a single-unit scope pre-fills+locks department/unit; ward combobox stays optional and unlocked; saving persists unitId only', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.serverFlags = { MULTI_TENANT: true };
    window.fetch = stubScopeFetch(SCOPE_TREE_ONE_UNIT, { type: 'unit', id: 'u1' });

    const p = window.blankPatient();
    p.name = 'One Unit Patient';
    await window.openPatientModal(p);

    const depEl = document.getElementById('f_department');
    const unitEl = document.getElementById('f_unit');
    const wardNameEl = document.getElementById('f_ward_name'); // visible combobox
    const wardIdEl = document.getElementById('f_ward');        // hidden id carrier
    const wardListEl = document.getElementById('f_ward_list');
    assert.ok(depEl && unitEl && wardNameEl && wardIdEl, 'department/unit selects + ward combobox must be rendered when MULTI_TENANT is on');
    assert.equal(depEl.tagName, 'SELECT');
    assert.equal(unitEl.tagName, 'SELECT');
    assert.equal(wardNameEl.tagName, 'INPUT', 'ward is now a type-to-create combobox, not a select');

    assert.equal(depEl.value, 'dep1');
    assert.equal(unitEl.value, 'u1');
    assert.equal(wardNameEl.value, '', 'ward is left blank even in a single-unit scope — it stays optional');
    assert.equal(wardIdEl.value, '', 'no ward chosen → hidden wardId is empty');
    assert.equal(depEl.disabled, true, 'a single-unit scope locks the department select');
    assert.equal(unitEl.disabled, true, 'a single-unit scope locks the unit select');
    assert.equal(wardNameEl.disabled, false, 'ward stays optional/unlocked even when the unit is pre-filled');
    assert.deepEqual([...wardListEl.querySelectorAll('option')].map(o => o.value), ['Ward One'], 'datalist is scoped to the chosen unit\'s wards');

    await window.savePatientFromModal();
    const saved = window.patients.find(x => x.name === 'One Unit Patient');
    assert.ok(saved, 'patient must have been saved');
    assert.equal(saved.unitId, 'u1');
    assert.equal('wardId' in saved, false, 'no ward was chosen — wardId key must be absent, not empty-string');
  });

  test('a multi-unit scope leaves department/unit enabled and unselected; unit is required to save; a chosen ward persists as wardId', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.serverFlags = { MULTI_TENANT: true };
    window.fetch = stubScopeFetch(SCOPE_TREE_TWO_UNITS, null);

    const p = window.blankPatient();
    p.name = 'Two Unit Patient';
    await window.openPatientModal(p);

    const depEl = document.getElementById('f_department');
    const unitEl = document.getElementById('f_unit');
    const wardNameEl = document.getElementById('f_ward_name');
    const wardIdEl = document.getElementById('f_ward');
    const wardListEl = document.getElementById('f_ward_list');
    assert.equal(depEl.disabled, false);
    assert.equal(unitEl.disabled, false);
    assert.equal(wardNameEl.disabled, false);
    assert.equal(unitEl.value, '', 'no unit is pre-selected when scope has more than one unit');
    // Both units must be offered.
    assert.deepEqual([...unitEl.options].map(o => o.value).filter(Boolean).sort(), ['u1', 'u2']);

    let toastMsg = null;
    window.showToast = (msg) => { toastMsg = msg; };
    await window.savePatientFromModal();

    assert.match(toastMsg || '', /select a unit/i, 'the existing toast validation path must fire');
    assert.equal(window.patients.find(x => x.name === 'Two Unit Patient'), undefined, 'save must be blocked, not silently persisted without a unit');

    // Now choose a unit — the ward datalist repopulates to that unit's wards, still optional.
    unitEl.value = 'u1';
    unitEl.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.deepEqual([...wardListEl.querySelectorAll('option')].map(o => o.value), ['Ward One']);

    // Pick an existing ward by typing its name — the input handler pins its id.
    wardNameEl.value = 'Ward One';
    wardNameEl.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(wardIdEl.value, 'ward1', 'typing a matching ward name pins its wardId');

    await window.savePatientFromModal();
    const saved = window.patients.find(x => x.name === 'Two Unit Patient');
    assert.ok(saved);
    assert.equal(saved.unitId, 'u1');
    assert.equal(saved.wardId, 'ward1');
  });

  test('opening the patient form always refetches scope, so a reassignment to a unit appears without a page reload', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.serverFlags = { MULTI_TENANT: true };
    let calls = 0;
    // First response: department visible but no units (stale / pre-assignment cache shape).
    // Second: unit-assigned Orthopaedics › II — what /api/me/scope returns after People assign.
    const treeEmptyUnits = { departments: [{ id: 'dep1', name: 'Orthopaedics', units: [] }] };
    const treeWithUnit = { departments: [{ id: 'dep1', name: 'Orthopaedics', units: [{ id: 'u2', name: 'II', wards: [] }] }] };
    window.fetch = async (url) => {
      if(String(url).includes('/api/me/scope')){
        calls++;
        return {
          ok: true, status: 200,
          json: async () => ({
            assignment: calls === 1 ? { type: 'department', id: 'dep1' } : { type: 'unit', id: 'u2' },
            tree: calls === 1 ? treeEmptyUnits : treeWithUnit
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'not mocked' }) };
    };

    await window.openPatientModal(window.blankPatient());
    assert.equal(calls, 1);
    assert.equal(document.getElementById('f_department').value, 'dep1');
    assert.deepEqual([...document.getElementById('f_unit').options].map(o => o.value).filter(Boolean), [],
      'pre-assignment: department shows, unit list empty');

    // Reopen after admin assigned Orthopaedics › II — must refetch, not serve the empty-units cache.
    await window.openPatientModal(window.blankPatient());
    assert.equal(calls, 2, 'patient form open must refetch scope (assignment can change while the app stays open)');
    const unitEl = document.getElementById('f_unit');
    assert.deepEqual([...unitEl.options].map(o => o.value).filter(Boolean), ['u2']);
    assert.equal(unitEl.value, 'u2', 'single-unit scope must pre-fill Unit II');
  });

  test('a failed scope fetch must not poison the cache — the next open retries', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.serverFlags = { MULTI_TENANT: true };
    let calls = 0;
    window.fetch = async (url) => {
      if(String(url).includes('/api/me/scope')){
        calls++;
        if(calls === 1) throw new Error('network');
        return {
          ok: true, status: 200,
          json: async () => ({
            assignment: { type: 'unit', id: 'u2' },
            tree: { departments: [{ id: 'dep1', name: 'Orthopaedics', units: [{ id: 'u2', name: 'II', wards: [] }] }] }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'not mocked' }) };
    };

    await window.openPatientModal(window.blankPatient());
    assert.equal(calls, 1);
    assert.deepEqual([...document.getElementById('f_unit').options].map(o => o.value).filter(Boolean), []);

    await window.openPatientModal(window.blankPatient());
    assert.equal(calls, 2, 'failed fetch must not stick an empty tree in the session cache');
    assert.equal(document.getElementById('f_unit').value, 'u2');
  });

  test('after a good scope load, a cold-start fetch failure keeps last-good Orthopaedics › II', async () => {
    // Render free-tier wake: sync may recover while /api/me/scope still fails once.
    // Clearing cache before every open would blank Department/Unit even though we
    // already knew the assignment tree from earlier in the session.
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.serverFlags = { MULTI_TENANT: true };
    let calls = 0;
    const good = {
      assignment: { type: 'unit', id: 'u2' },
      tree: { departments: [{ id: 'dep1', name: 'Orthopaedics', units: [{ id: 'u2', name: 'II', wards: [] }] }] }
    };
    window.fetch = async (url) => {
      if(String(url).includes('/api/me/scope')){
        calls++;
        if(calls === 1){
          return { ok: true, status: 200, json: async () => good };
        }
        throw new Error('server waking');
      }
      return { ok: false, status: 404, json: async () => ({ error: 'not mocked' }) };
    };

    await window.openPatientModal(window.blankPatient());
    assert.equal(document.getElementById('f_unit').value, 'u2');

    await window.openPatientModal(window.blankPatient());
    assert.ok(calls >= 2, 'second open must attempt a refresh');
    assert.equal(document.getElementById('f_department').value, 'dep1');
    assert.equal(document.getElementById('f_unit').value, 'u2', 'must keep last-good unit while server wakes');
  });

  test('refreshScopeAfterWake refills an open patient form after sync recovers', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.localStorage.setItem('ortho_token', 't');
    window.serverFlags = { MULTI_TENANT: true };
    let calls = 0;
    window.fetch = async (url) => {
      if(String(url).includes('/api/health')){
        // Wake: health may still be flaky — must not wipe MULTI_TENANT.
        return { ok: false, status: 503, json: async () => ({ error: 'waking' }) };
      }
      if(String(url).includes('/api/me/scope')){
        calls++;
        if(calls === 1) throw new Error('server sleeping');
        return {
          ok: true, status: 200,
          json: async () => ({
            assignment: { type: 'unit', id: 'u2' },
            tree: { departments: [{ id: 'dep1', name: 'Orthopaedics', units: [{ id: 'u2', name: 'II', wards: [] }] }] }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'not mocked' }) };
    };

    await window.openPatientModal(window.blankPatient());
    assert.deepEqual([...document.getElementById('f_unit').options].map(o => o.value).filter(Boolean), []);

    await window.refreshScopeAfterWake();
    assert.ok(calls >= 2, 'wake refresh must refetch scope after the failed open');
    assert.equal(window.serverFlags.MULTI_TENANT, true, 'failed health must not clear MULTI_TENANT');
    assert.equal(document.getElementById('f_unit').value, 'u2');
  });
});

describe('patient form dept/unit/ward picker (MULTI_TENANT off — legacy behavior unchanged)', () => {
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
