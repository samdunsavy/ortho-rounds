import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';
import { backfill } from '../scripts/backfill-hierarchy.js';

describe('backfill-hierarchy', () => {
  let dataDir;
  let store;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-'));
    store = await createStore({ dataDir });
    await store.init();

    await store.upsertPatient('p1', 100, 0, JSON.stringify({ name: 'Alice', ward: '7FOW', unit: 'IV' }));
    await store.upsertPatient('p2', 200, 0, JSON.stringify({ name: 'Bob', ward: '7 fow', unit: 'IV' }));
    await store.upsertPatient('p3', 300, 0, JSON.stringify({ name: 'Carol', ward: '', unit: '' }));
    // A deleted patient should never get stamped.
    await store.upsertPatient('p4', 400, 1, JSON.stringify({ name: 'Deleted', ward: '7FOW', unit: 'IV' }));
  });

  after(async () => {
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('stamps ancestry onto every active patient', async () => {
    const result = await backfill(store);
    assert.ok(result.orgId);
    assert.equal(result.stamped, 3); // p1, p2, p3 — not the deleted p4

    for(const id of ['p1', 'p2', 'p3']){
      const row = await store.getPatientRaw(id);
      const data = JSON.parse(row.data);
      assert.ok(data.unitId, `${id} should have a unitId`);
      assert.ok(data.wardId);
      assert.ok(data.departmentId);
      assert.ok(data.hospitalId);
      assert.ok(data.orgId);
    }

    const deletedRow = await store.getPatientRaw('p4');
    const deletedData = JSON.parse(deletedRow.data);
    assert.equal(deletedData.unitId, undefined, 'deleted patients are not stamped');
  });

  test('normalized ward names ("7FOW" / "7 fow") collapse to one ward', async () => {
    const p1 = JSON.parse((await store.getPatientRaw('p1')).data);
    const p2 = JSON.parse((await store.getPatientRaw('p2')).data);
    assert.equal(p1.wardId, p2.wardId);
    assert.equal(p1.unitId, p2.unitId);
  });

  test('blank ward/unit falls into a General bucket', async () => {
    const p3 = JSON.parse((await store.getPatientRaw('p3')).data);
    assert.equal(p3.ward, 'General');
    assert.equal(p3.unit, 'General');

    const ward = await store.getWard(p3.wardId);
    const unit = await store.getUnit(p3.unitId);
    assert.equal(ward.name, 'General');
    assert.equal(unit.name, 'General');
  });

  test('re-running backfill is idempotent: creates nothing new, re-stamps identically', async () => {
    const before1 = JSON.parse((await store.getPatientRaw('p1')).data);

    const result = await backfill(store);
    assert.equal(result.created.hospitals, 0);
    assert.equal(result.created.departments, 0);
    assert.equal(result.created.wards, 0);
    assert.equal(result.created.units, 0);
    assert.equal(result.stamped, 3);

    const after1 = JSON.parse((await store.getPatientRaw('p1')).data);
    assert.deepEqual(after1, before1);
  });

  test('--single-bucket puts every active patient in one unit', async () => {
    const result = await backfill(store, { singleBucket: true });
    assert.equal(result.stamped, 3);

    const p1 = JSON.parse((await store.getPatientRaw('p1')).data);
    const p2 = JSON.parse((await store.getPatientRaw('p2')).data);
    const p3 = JSON.parse((await store.getPatientRaw('p3')).data);
    assert.equal(p1.unitId, p2.unitId);
    assert.equal(p2.unitId, p3.unitId);
    assert.equal(p1.ward, 'General');
    assert.equal(p1.unit, 'General');
  });
});
