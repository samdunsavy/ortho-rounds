import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

const TREE = () => ({
  departments: [
    { id: 'd1', name: 'Ortho', units: [
      { id: 'u1', name: 'Unit IV', wards: [{ id: 'w1', name: '7MOW' }] },
      { id: 'u2', name: 'Unit V', wards: [] }
    ]}
  ]
});

describe('ward combobox pure helpers', () => {
  test('wardsForUnit returns the unit\'s wards, or [] for unknown unit', () => {
    const { window } = loadFrontendEnv();
    // JSON-compare to stay agnostic to jsdom's cross-realm array/object prototypes.
    assert.equal(JSON.stringify(window.wardsForUnit(TREE(), 'u1')), JSON.stringify([{ id: 'w1', name: '7MOW' }]));
    assert.equal(window.wardsForUnit(TREE(), 'u2').length, 0);
    assert.equal(window.wardsForUnit(TREE(), 'nope').length, 0);
  });

  test('matchWardByName matches case-insensitively and trims, else null', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.matchWardByName(TREE(), 'u1', '  7mow ').id, 'w1');
    assert.equal(window.matchWardByName(TREE(), 'u1', '7FOW'), null);
    assert.equal(window.matchWardByName(TREE(), 'u1', ''), null);
  });

  test('injectWardIntoScopeTree adds once and is idempotent by id', () => {
    const { window } = loadFrontendEnv();
    const tree = TREE();
    assert.equal(window.injectWardIntoScopeTree(tree, 'u2', { id: 'w9', name: '3SPW' }), true);
    assert.equal(JSON.stringify(window.wardsForUnit(tree, 'u2')), JSON.stringify([{ id: 'w9', name: '3SPW' }]));
    window.injectWardIntoScopeTree(tree, 'u2', { id: 'w9', name: '3SPW' });
    assert.equal(window.wardsForUnit(tree, 'u2').length, 1, 'no duplicate on re-inject');
    assert.equal(window.injectWardIntoScopeTree(tree, 'nope', { id: 'wX', name: 'X' }), false);
  });
});

describe('ward combobox DOM wiring', () => {
  // Build the combobox sub-form the patient modal renders for the scoped picker.
  function mountWardForm(window){
    const { document } = window;
    document.body.innerHTML = `
      <input id="f_ward_name" list="f_ward_list" autocomplete="off">
      <datalist id="f_ward_list"></datalist>
      <input type="hidden" id="f_ward">
      <button type="button" id="f_ward_create" style="display:none;"></button>
      <div id="f_ward_msg" style="display:none;"></div>`;
    return document;
  }

  test('populateWardSelect lists existing wards and pins a preselected wardId', () => {
    const { window } = loadFrontendEnv();
    const document = mountWardForm(window);
    window.populateWardSelect(TREE(), 'd1', 'u1', 'w1');
    assert.match(document.getElementById('f_ward_list').innerHTML, /7MOW/);
    assert.equal(document.getElementById('f_ward').value, 'w1', 'hidden id carries the selected ward');
    assert.equal(document.getElementById('f_ward_name').value, '7MOW');
    assert.equal(document.getElementById('f_ward_create').style.display, 'none', 'existing ward → no create button');
  });

  test('typing a novel name reveals Create and clears the hidden id; a match hides it', () => {
    const { window } = loadFrontendEnv();
    const document = mountWardForm(window);
    const tree = TREE();
    window.populateWardSelect(tree, 'd1', 'u1', '');

    const nameEl = document.getElementById('f_ward_name');
    nameEl.value = '3 South';
    window.updateWardCreateAffordance(tree);
    assert.equal(document.getElementById('f_ward').value, '', 'novel name → no wardId yet');
    assert.equal(document.getElementById('f_ward_create').style.display, 'inline-block');
    assert.match(document.getElementById('f_ward_create').textContent, /3 South/);

    nameEl.value = '7mow'; // existing, different case
    window.updateWardCreateAffordance(tree);
    assert.equal(document.getElementById('f_ward').value, 'w1', 'case-insensitive match pins the id');
    assert.equal(document.getElementById('f_ward_create').style.display, 'none');
  });
});
