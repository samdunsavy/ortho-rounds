import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createStore } from '../storage.js';
import { getNode, nodeOrgId, childrenOf, restampUnits, restampPatient } from '../structure.js';

describe('structure', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-struct-'));
    store = await createStore({ dataDir }); await store.init();
    await store.createOrganization({ id: 'o1', name: 'O1', plan: 'free' });
    await store.createHospital({ id: 'h1', orgId: 'o1', name: 'H1' });
    await store.createDepartment({ id: 'd1', hospitalId: 'h1', name: 'Ortho' });
    await store.createUnit({ id: 'u1', departmentId: 'd1', name: 'IV' });
    await store.createWard({ id: 'w1', unitId: 'u1', name: '7FOW' });
    const now = Date.now();
    await store.upsertPatient('p1', now, 0, JSON.stringify({ id: 'p1', name: 'A', unitId: 'u1', wardId: 'w1', ward: 'stale', unit: 'stale' }));
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('getNode + nodeOrgId resolve every level', async () => {
    assert.equal((await getNode(store, 'unit', 'u1')).name, 'IV');
    assert.equal(await nodeOrgId(store, 'unit', 'u1'), 'o1');
    assert.equal(await nodeOrgId(store, 'department', 'd1'), 'o1');
    assert.equal(await nodeOrgId(store, 'org', 'o1'), 'o1');
  });
  test('childrenOf returns direct children; ward has none', async () => {
    assert.deepEqual((await childrenOf(store, 'department', 'd1')).map(n => n.id), ['u1']);
    assert.deepEqual((await childrenOf(store, 'unit', 'u1')).map(n => n.id), ['w1']);
    assert.deepEqual(await childrenOf(store, 'ward', 'w1'), []);
  });
  test('restampUnits refreshes ancestry + labels for patients in the set (keeps a ward that is still under the unit)', async () => {
    const n = await restampUnits(store, new Set(['u1']));
    assert.equal(n, 1);
    const o = JSON.parse((await store.getPatientRaw('p1')).data);
    assert.equal(o.orgId, 'o1'); assert.equal(o.wardId, 'w1');
    assert.equal(o.ward, '7FOW'); assert.equal(o.unit, 'IV'); // labels refreshed from node names
  });
  test('restampPatient repins a patient to a new unit and drops a ward that is no longer under it', async () => {
    await store.createUnit({ id: 'u2', departmentId: 'd1', name: 'II' });
    const row = await store.getPatientRaw('p1');
    const ok = await restampPatient(store, { id: 'p1', deleted: 0, data: row.data }, 'u2');
    assert.equal(ok, true);
    const o = JSON.parse((await store.getPatientRaw('p1')).data);
    assert.equal(o.unitId, 'u2'); assert.equal(o.unit, 'II');
    assert.equal(o.wardId, undefined, 'w1 is not under u2, so the optional ward must be dropped');
    assert.equal(o.ward, undefined);
  });
});
