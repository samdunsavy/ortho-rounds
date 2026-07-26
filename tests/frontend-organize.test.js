import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

describe('moveCapableFromTree', () => {
  test('true only when 2+ units are in scope', () => {
    const { window } = loadFrontendEnv();
    const one = { departments: [{ id: 'd', name: 'D', units: [{ id: 'u1', name: 'A', wards: [] }] }] };
    const two = { departments: [{ id: 'd', name: 'D', units: [{ id: 'u1', name: 'A', wards: [] }, { id: 'u2', name: 'B', wards: [] }] }] };
    assert.equal(window.moveCapableFromTree(one), false);
    assert.equal(window.moveCapableFromTree(two), true);
    assert.equal(window.moveCapableFromTree(null), false);
  });
});

describe('filterByUnit', () => {
  test('empty = all; a unit id = exact match; __unsorted__ = no unitId', () => {
    const { window } = loadFrontendEnv();
    const items = [{ id: 'a', unitId: 'u1' }, { id: 'b', unitId: 'u2' }, { id: 'c' }];
    assert.deepEqual(window.filterByUnit(items, '').map(p => p.id), ['a', 'b', 'c']);
    assert.deepEqual(window.filterByUnit(items, 'u1').map(p => p.id), ['a']);
    assert.deepEqual(window.filterByUnit(items, '__unsorted__').map(p => p.id), ['c']);
  });
});
