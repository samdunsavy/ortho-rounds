import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';
import { buildOrgTree, buildOrgRollups } from '../admin.js';

describe('admin tree/stats builders', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-admin-'));
    store = await createStore({ dataDir });
    await store.init();
    await store.createOrganization({ id: 'o1', name: 'Org One', plan: 'free' });
    await store.createOrganization({ id: 'o2', name: 'Org Two', plan: 'paid' });
    await store.createHospital({ id: 'h1', orgId: 'o1', name: 'City Hospital' });
    await store.createDepartment({ id: 'w1', hospitalId: 'h1', name: 'Ortho', specialty: 'ortho' });
    await store.createDepartment({ id: 'w2', hospitalId: 'h1', name: 'Surgery', specialty: 'surgery' });
    await store.createWard({ id: 'wA', departmentId: 'w1', name: 'Ward A' });
    await store.createWard({ id: 'wB', departmentId: 'w2', name: 'Ward B' });
    await store.createUnit({ id: 'uA1', wardId: 'wA', name: 'Bay 1' });
    await store.createUnit({ id: 'uB1', wardId: 'wB', name: 'Bay 2' });
    const mkUser = (id, orgId, wardId, role = 'member', active = true) => store.createUser({
      id, username: id, passwordHash: 'h', passwordSalt: 's', role, active,
      tokenVersion: 0, createdAt: Date.now(), orgId, wardId
    });
    await mkUser('u1', 'o1', 'w1');
    await mkUser('u2', 'o1', 'w1', 'member', false);
    await mkUser('u3', 'o1', null, 'admin');
    await mkUser('ux', 'o2', null, 'admin');
    const put = (id, unitId, status, updatedAt, deleted = 0) => store.upsertPatient(
      id, updatedAt, deleted, JSON.stringify({ id, unitId, status, updatedAt })
    );
    await put('p1', 'uA1', 'postop', 1000);
    await put('p2', 'uA1', 'postop', 3000);
    await put('p3', 'uA1', 'preop', 2000);
    await put('p4', 'uB1', 'conservative', 500);
    await put('p5', 'uA1', 'postop', 4000, 1);          // deleted — excluded
    await put('p6', undefined, 'postop', 100);           // unassigned — org counts exclude it
    await put('p7', 'uA1', 'weird-status', 50);          // counted live, no bucket
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('buildOrgTree computes totals, per-department/ward/unit stats, lastActivity', async () => {
    const tree = await buildOrgTree(store, 'o1');
    assert.deepEqual(tree.totals, {
      hospitals: 1, departments: 2, wards: 2, units: 2, usersActive: 2, usersDisabled: 1, livePatients: 5
    });

    const dep1 = tree.hospitals[0].departments.find(d => d.id === 'w1');
    assert.deepEqual(dep1.stats, {
      livePatients: 4,
      byStatus: { postop: 2, preop: 1, conservative: 0, fordischarge: 0 },
      users: 2,
      lastActivity: 3000
    });
    const dep2 = tree.hospitals[0].departments.find(d => d.id === 'w2');
    assert.equal(dep2.stats.livePatients, 1);
    assert.equal(dep2.stats.lastActivity, 500);
    assert.equal(dep2.stats.users, 0);

    const wardA = dep1.wards.find(w => w.id === 'wA');
    assert.deepEqual(wardA.stats, {
      livePatients: 4,
      byStatus: { postop: 2, preop: 1, conservative: 0, fordischarge: 0 },
      users: 0,
      lastActivity: 3000
    });
    const wardB = dep2.wards.find(w => w.id === 'wB');
    assert.equal(wardB.stats.livePatients, 1);
    assert.equal(wardB.stats.lastActivity, 500);

    const unitA1 = wardA.units.find(u => u.id === 'uA1');
    assert.deepEqual(unitA1.stats, {
      livePatients: 4,
      byStatus: { postop: 2, preop: 1, conservative: 0, fordischarge: 0 },
      users: 0,
      lastActivity: 3000
    });
    const unitB1 = wardB.units.find(u => u.id === 'uB1');
    assert.equal(unitB1.stats.livePatients, 1);
    assert.equal(unitB1.stats.lastActivity, 500);
  });

  test('empty org tree is well-formed', async () => {
    await store.createOrganization({ id: 'o3', name: 'Empty', plan: 'free' });
    const tree = await buildOrgTree(store, 'o3');
    assert.deepEqual(tree.totals, { hospitals: 0, departments: 0, wards: 0, units: 0, usersActive: 0, usersDisabled: 0, livePatients: 0 });
    assert.deepEqual(tree.hospitals, []);
  });

  test('buildOrgRollups summarizes every org', async () => {
    const rollups = await buildOrgRollups(store);
    const o1 = rollups.find(r => r.id === 'o1');
    assert.deepEqual(o1.stats, { hospitals: 1, departments: 2, users: 3, livePatients: 5 });
    assert.equal(o1.plan, 'free');
    const o2 = rollups.find(r => r.id === 'o2');
    assert.deepEqual(o2.stats, { hospitals: 0, departments: 0, users: 1, livePatients: 0 });
  });
});
