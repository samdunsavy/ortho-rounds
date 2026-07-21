import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

// openPatientModal() -> bindModalDynamicLists() -> renderPostOpList() reads
// CHECKLIST_CATEGORIES, a `const` declared in milestones.js. Per
// frontend-env.js's own documented limitation, `const` bindings from one
// window.eval() call aren't visible to functions defined in a separate
// eval() call (only window properties — i.e. function declarations and
// `var` — persist across calls), so app.js's reference to the bare
// identifier throws ReferenceError in this harness even though it works
// fine in a real browser (single script load, one shared scope). Any test
// that drives the modal open/close flow needs this redefined in app.js's
// own eval via initScript, the same workaround already established in
// tests/frontend-worklist.test.js for the equivalent `patients` binding.
const MODAL_FLOW_INIT_SCRIPT = [
  'var CHECKLIST_CATEGORIES = ["nv","mobilization","imaging","antibiotics","drain","wound","other"];',
  'var CHECKLIST_STATUSES = ["pending","done","skipped","na"];',
  // `patients` is a top-level `let` in app.js, so (per frontend-env.js's
  // documented limitation) it never becomes a `window` property on its
  // own. This getter is defined inside the same window.eval() call as
  // app.js itself, so its closure captures the real top-level `patients`
  // binding live — letting save-flow tests read back `window.patients`
  // after calling savePatientFromModal(), the same trick already used
  // above for CHECKLIST_CATEGORIES/CHECKLIST_STATUSES.
  'Object.defineProperty(window, "patients", { get: function(){ return patients; }, configurable: true });'
].join('\n');

describe('labValueClass — expanded 11-field panel', () => {
  test('flags low platelets', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.labValueClass('platelets', '120000'), 'lab-low');
    assert.equal(window.labValueClass('platelets', '250000'), '');
  });

  test('flags high ESR, urea, and PT/INR', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.labValueClass('esr', '35'), 'lab-high');
    assert.equal(window.labValueClass('esr', '10'), '');
    assert.equal(window.labValueClass('urea', '55'), 'lab-high');
    assert.equal(window.labValueClass('ptinr', '1.8'), 'lab-high');
    assert.equal(window.labValueClass('ptinr', '1.0'), '');
  });

  test('flags both directions for sodium, potassium, and RBS', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.labValueClass('sodium', '128'), 'lab-low');
    assert.equal(window.labValueClass('sodium', '150'), 'lab-high');
    assert.equal(window.labValueClass('sodium', '140'), '');
    assert.equal(window.labValueClass('potassium', '2.9'), 'lab-low');
    assert.equal(window.labValueClass('potassium', '6.1'), 'lab-high');
    assert.equal(window.labValueClass('rbs', '55'), 'lab-low');
    assert.equal(window.labValueClass('rbs', '260'), 'lab-high');
  });

  test('unrecognized values and unknown keys stay unflagged', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.labValueClass('platelets', ''), '');
    assert.equal(window.labValueClass('platelets', 'not a number'), '');
    assert.equal(window.labValueClass('unknownKey', '100'), '');
  });
});

describe('save flow — expanded labs object', () => {
  test('modalLabReportDate starts null and resets on modal open/close', () => {
    const { window } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.openPatientModal(window.blankPatient());
    assert.equal(window.getModalLabReportDate(), null);
    window.setModalLabReportDate('2026-07-18');
    assert.equal(window.getModalLabReportDate(), '2026-07-18');
    window.closePatientModal({ force: true });
    assert.equal(window.getModalLabReportDate(), null);
  });
});

describe('labPhotoFileInput wiring', () => {
  // Regression test for a real bug: labPhotoFileInput is rendered inside
  // renderModalForm()'s output (part of #modalBody, rebuilt from scratch
  // every time the modal opens), not the static index.html shell. Binding
  // its 'change' listener once at page-init time (like the truly-static
  // #modalFileInput) silently no-ops, because the element doesn't exist
  // yet when init runs — the file picker still opens fine (button clicks
  // are handled via delegation), but selecting a photo does nothing. The
  // fix is binding inside bindModalDynamicLists(), which reruns on every
  // modal open. This test drives the real 'change' event end-to-end
  // instead of calling handleLabPhotoSelected() directly, so it would have
  // caught the original bug.
  test('selecting a file via the real input dispatches to handleLabPhotoSelected', () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.openPatientModal(window.blankPatient());

    let receivedFile = null;
    window.handleLabPhotoSelected = (file) => { receivedFile = file; };

    const input = document.getElementById('labPhotoFileInput');
    assert.ok(input, 'labPhotoFileInput must exist in the rendered modal');
    const fakeFile = new window.File(['fake-bytes'], 'report.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [fakeFile], configurable: true });
    input.dispatchEvent(new window.Event('change'));

    assert.equal(receivedFile, fakeFile);
  });

  test('re-opening the modal keeps the listener working (rebinds each open, not just the first)', () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.openPatientModal(window.blankPatient());
    window.closePatientModal({ force: true });
    window.openPatientModal(window.blankPatient());

    let calls = 0;
    window.handleLabPhotoSelected = () => { calls++; };

    const input = document.getElementById('labPhotoFileInput');
    const fakeFile = new window.File(['fake-bytes'], 'report.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [fakeFile], configurable: true });
    input.dispatchEvent(new window.Event('change'));

    assert.equal(calls, 1);
  });
});

describe('handleLabPhotoSelected', () => {
  test('fills the labs grid from the AI response and reports the fill count', async () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.openPatientModal(window.blankPatient());
    window.canUseAi = () => true; // aiAvailable is `let`-scoped (not a window
    // property in this harness, per the note above `MODAL_FLOW_INIT_SCRIPT`)
    // — override the function that reads it instead, which does resolve
    // through the shared global-object binding since canUseAi is a top-level
    // function declaration.
    window.compressImage = async (dataURL) => dataURL; // jsdom's Image never
    // fires onload/onerror for data URLs, so the real compressImage() would
    // hang forever waiting for a load event that jsdom never dispatches.
    window.callAi = async (endpoint, body) => {
      assert.equal(endpoint, 'parse-labs-image');
      assert.ok(body.image.startsWith('data:'));
      return { labs: { hb: '11.0', sodium: '138' }, reportDate: null };
    };
    window.showToast = () => {}; // no-op, just observing side effects below

    const fakeFile = new window.File(['fake-bytes'], 'report.jpg', { type: 'image/jpeg' });
    const filled = await window.handleLabPhotoSelected(fakeFile);

    assert.equal(filled, 2);
    assert.equal(document.getElementById('f_lab_hb').value, '11.0');
    assert.equal(document.getElementById('f_lab_sodium').value, '138');
    assert.equal(window.getModalLabReportDate(), null);
  });

  test('prompts for the report date when it differs from today, and stores it on confirm', async () => {
    const { window } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.openPatientModal(window.blankPatient());
    window.canUseAi = () => true;
    window.compressImage = async (dataURL) => dataURL;
    window.callAi = async () => ({ labs: { hb: '11.0' }, reportDate: '2026-07-10' });
    window.showToast = () => {};
    window.showConfirm = async () => true; // simulate PG confirming "use report date"

    const fakeFile = new window.File(['fake-bytes'], 'report.jpg', { type: 'image/jpeg' });
    await window.handleLabPhotoSelected(fakeFile);

    assert.equal(window.getModalLabReportDate(), '2026-07-10');
  });

  test('declining the report-date prompt leaves modalLabReportDate null', async () => {
    const { window } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.openPatientModal(window.blankPatient());
    window.canUseAi = () => true;
    window.compressImage = async (dataURL) => dataURL;
    window.callAi = async () => ({ labs: { hb: '11.0' }, reportDate: '2026-07-10' });
    window.showToast = () => {};
    window.showConfirm = async () => false; // PG declines — keep today's date

    const fakeFile = new window.File(['fake-bytes'], 'report.jpg', { type: 'image/jpeg' });
    await window.handleLabPhotoSelected(fakeFile);

    assert.equal(window.getModalLabReportDate(), null);
  });
});

describe('applySmartPasteLabs — expanded panel', () => {
  test('fills all 11 fields when present and counts them', () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.openPatientModal(window.blankPatient());
    const filled = window.applySmartPasteLabs({
      hb: '11.2', crp: '8', wcc: '9000', creatinine: '0.9',
      platelets: '210000', esr: '18', urea: '32',
      sodium: '138', potassium: '4.1', ptinr: '1.1', rbs: '110'
    });
    assert.equal(filled, 11);
    assert.equal(document.getElementById('f_lab_platelets').value, '210000');
    assert.equal(document.getElementById('f_lab_ptinr').value, '1.1');
  });

  test('only fills fields present in the input, ignoring the rest', () => {
    const { window, document } = loadFrontendEnv({ initScript: MODAL_FLOW_INIT_SCRIPT });
    window.openPatientModal(window.blankPatient());
    const filled = window.applySmartPasteLabs({ sodium: '129' });
    assert.equal(filled, 1);
    assert.equal(document.getElementById('f_lab_sodium').value, '129');
    assert.equal(document.getElementById('f_lab_potassium').value, '');
  });
});

describe('renderModalForm — expanded labs grid and photo button', () => {
  test('renders inputs for all 11 lab fields', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderModalForm(window.blankPatient());
    for(const id of ['f_lab_hb', 'f_lab_crp', 'f_lab_wcc', 'f_lab_creatinine', 'f_lab_platelets', 'f_lab_esr', 'f_lab_urea', 'f_lab_sodium', 'f_lab_potassium', 'f_lab_ptinr', 'f_lab_rbs']){
      assert.ok(html.includes(`id="${id}"`), `missing input ${id}`);
    }
  });

  test('renders the lab photo attach button and a hidden file input', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderModalForm(window.blankPatient());
    assert.ok(html.includes('id="labPhotoBtn"'));
    assert.ok(html.includes('id="labPhotoFileInput"'));
    assert.match(html, /<input[^>]*type="file"[^>]*id="labPhotoFileInput"/);
  });

  test('pre-fills existing values for the new fields when editing', () => {
    const { window } = loadFrontendEnv();
    const patient = window.blankPatient();
    patient.labs = { platelets: '410000', sodium: '129' };
    const html = window.renderModalForm(patient);
    assert.ok(html.includes('value="410000"'));
    assert.ok(html.includes('value="129"'));
  });
});

describe('LAB_TREND_LABELS — expanded panel', () => {
  // LAB_TREND_LABELS is declared with `const`, so (per frontend-env.js) it
  // never becomes a `window` property the way function declarations do —
  // exercise it indirectly through renderLabsTrendPanel, a function that
  // reads Object.keys(LAB_TREND_LABELS) internally, instead of reaching
  // for the binding directly.
  test('renders a trend sparkline label for every one of the 11 fields once history exists', () => {
    const { window } = loadFrontendEnv();
    const history = [
      { date: '2026-07-17', hb: '10', crp: '5', wcc: '9000', creatinine: '0.8', platelets: '200000', esr: '15', urea: '30', sodium: '138', potassium: '4.0', ptinr: '1.0', rbs: '100' },
      { date: '2026-07-18', hb: '11', crp: '6', wcc: '9500', creatinine: '0.9', platelets: '210000', esr: '16', urea: '32', sodium: '139', potassium: '4.1', ptinr: '1.1', rbs: '105' }
    ];
    const html = window.renderLabsTrendPanel({ labsHistory: history });
    for(const label of ['Hb', 'CRP', 'TLC', 'Creatinine', 'Platelets', 'ESR', 'Urea', 'Na', 'K', 'PT/INR', 'RBS']){
      assert.ok(html.includes(`>${label}<`), `missing trend sparkline label for ${label}`);
    }
  });
});

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
