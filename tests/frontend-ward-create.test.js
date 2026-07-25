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
