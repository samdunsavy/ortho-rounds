import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createStore } from '../storage.js';
import { resolveAncestry, listUnitIdsUnder } from '../hierarchy.js';

describe('hierarchy', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-hier-'));
    store = await createStore({ dataDir }); await store.init();
    await store.createOrganization({ id: 'o1', name: 'O', plan: 'free' });
    await store.createHospital({ id: 'h1', orgId: 'o1', name: 'H' });
    await store.createDepartment({ id: 'd1', hospitalId: 'h1', name: 'Ortho' });
    await store.createWard({ id: 'w1', departmentId: 'd1', name: '7FOW' });
    await store.createWard({ id: 'w2', departmentId: 'd1', name: '8FOW' });
    await store.createUnit({ id: 'u1', wardId: 'w1', name: 'IV' });
    await store.createUnit({ id: 'u2', wardId: 'w2', name: 'II' });
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('resolveAncestry walks unit→org', async () => {
    assert.deepEqual(await resolveAncestry(store, 'u1'),
      { unitId: 'u1', wardId: 'w1', departmentId: 'd1', hospitalId: 'h1', orgId: 'o1' });
  });
  test('resolveAncestry returns null for unknown unit', async () => {
    assert.equal(await resolveAncestry(store, 'nope'), null);
  });
  test('listUnitIdsUnder department returns all descendant units', async () => {
    const s = await listUnitIdsUnder(store, { type: 'department', id: 'd1' });
    assert.deepEqual([...s].sort(), ['u1', 'u2']);
  });
  test('listUnitIdsUnder unit returns just that unit', async () => {
    const s = await listUnitIdsUnder(store, { type: 'unit', id: 'u1' });
    assert.deepEqual([...s], ['u1']);
  });
  test('listUnitIdsUnder org returns every unit in the org', async () => {
    const s = await listUnitIdsUnder(store, { type: 'org', id: 'o1' });
    assert.deepEqual([...s].sort(), ['u1', 'u2']);
  });
});
