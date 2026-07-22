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
    await store.createWard({ id: 'w1', hospitalId: 'h1', name: 'Ortho', specialty: 'ortho' });
    await store.createWard({ id: 'w2', hospitalId: 'h1', name: 'Surgery', specialty: 'surgery' });
    const mkUser = (id, orgId, wardId, role = 'member', active = true) => store.createUser({
      id, username: id, passwordHash: 'h', passwordSalt: 's', role, active,
      tokenVersion: 0, createdAt: Date.now(), orgId, wardId
    });
    await mkUser('u1', 'o1', 'w1');
    await mkUser('u2', 'o1', 'w1', 'member', false);
    await mkUser('u3', 'o1', null, 'admin');
    await mkUser('ux', 'o2', null, 'admin');
    const put = (id, wardId, status, updatedAt, deleted = 0) => store.upsertPatient(
      id, updatedAt, deleted, JSON.stringify({ id, wardId, status, updatedAt })
    );
    await put('p1', 'w1', 'postop', 1000);
    await put('p2', 'w1', 'postop', 3000);
    await put('p3', 'w1', 'preop', 2000);
    await put('p4', 'w2', 'conservative', 500);
    await put('p5', 'w1', 'postop', 4000, 1);          // deleted — excluded
    await put('p6', undefined, 'postop', 100);          // unassigned — org counts exclude it
    await put('p7', 'w1', 'weird-status', 50);          // counted live, no bucket
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('buildOrgTree computes totals, per-department stats, lastActivity', async () => {
    const tree = await buildOrgTree(store, 'o1');
    assert.deepEqual(tree.totals, {
      hospitals: 1, departments: 2, usersActive: 2, usersDisabled: 1, livePatients: 5
    });
    const w1 = tree.hospitals[0].wards.find(w => w.id === 'w1');
    assert.deepEqual(w1.stats, {
      livePatients: 4,
      byStatus: { postop: 2, preop: 1, conservative: 0, fordischarge: 0 },
      users: 2,
      lastActivity: 3000
    });
    const w2 = tree.hospitals[0].wards.find(w => w.id === 'w2');
    assert.equal(w2.stats.livePatients, 1);
    assert.equal(w2.stats.lastActivity, 500);
    assert.equal(w2.stats.users, 0);
  });

  test('empty org tree is well-formed', async () => {
    await store.createOrganization({ id: 'o3', name: 'Empty', plan: 'free' });
    const tree = await buildOrgTree(store, 'o3');
    assert.deepEqual(tree.totals, { hospitals: 0, departments: 0, usersActive: 0, usersDisabled: 0, livePatients: 0 });
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
