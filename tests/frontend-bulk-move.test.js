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
    assert.deepEqual([...out.map(u => u.id)], ['u1', 'u2', 'u3']);
    assert.equal(out[0].name, 'Ortho · Unit One');
    assert.equal(out[2].name, 'Surgery · Gen');
  });

  test('empty / missing tree yields []', () => {
    const { window } = loadFrontendEnv();
    assert.deepEqual([...window.flatUnitsFromScopeTree(null)], []);
    assert.deepEqual([...window.flatUnitsFromScopeTree({ departments: [] })], []);
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
    window.localStorage.setItem('ortho_role', 'admin');
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
