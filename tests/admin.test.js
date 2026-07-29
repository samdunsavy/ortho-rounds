import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';
import { buildOrgTree, buildOrgRollups, buildScopeTree } from '../admin.js';

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
    await store.createUnit({ id: 'uA1', departmentId: 'w1', name: 'Bay 1' });
    await store.createUnit({ id: 'uB1', departmentId: 'w2', name: 'Bay 2' });
    await store.createWard({ id: 'wA', unitId: 'uA1', name: 'Ward A' });
    await store.createWard({ id: 'wB', unitId: 'uB1', name: 'Ward B' });
    const mkUser = (id, orgId, wardId, role = 'member', active = true) => store.createUser({
      id, username: id, passwordHash: 'h', passwordSalt: 's', role, active,
      tokenVersion: 0, createdAt: Date.now(), orgId, wardId
    });
    await mkUser('u1', 'o1', 'w1');
    await mkUser('u2', 'o1', 'w1', 'member', false);
    await mkUser('u3', 'o1', null, 'admin');
    await mkUser('ux', 'o2', null, 'admin');
    const put = (id, unitId, status, updatedAt, opts = {}) => store.upsertPatient(
      id, updatedAt, opts.deleted || 0,
      JSON.stringify({ id, unitId, wardId: opts.wardId, status, updatedAt })
    );
    // p1, p2 carry the optional wardId (wA); p3/p7 are unit-scoped only, no ward.
    await put('p1', 'uA1', 'postop', 1000, { wardId: 'wA' });
    await put('p2', 'uA1', 'postop', 3000, { wardId: 'wA' });
    await put('p3', 'uA1', 'preop', 2000);
    await put('p4', 'uB1', 'conservative', 500, { wardId: 'wB' });
    await put('p5', 'uA1', 'postop', 4000, { deleted: 1 });   // deleted — excluded
    await put('p6', undefined, 'postop', 100);                // unassigned — org counts exclude it
    await put('p7', 'uA1', 'weird-status', 50);                // counted live, no bucket, no ward
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('buildOrgTree computes totals, per-department/unit/ward stats, lastActivity', async () => {
    const tree = await buildOrgTree(store, 'o1');
    assert.equal(tree.org.id, 'o1');
    assert.equal(tree.org.name, 'Org One');
    assert.equal(tree.org.stats.livePatients, 5); // every live patient in the org
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

    const unitA1 = dep1.units.find(u => u.id === 'uA1');
    assert.deepEqual(unitA1.stats, {
      livePatients: 4,
      byStatus: { postop: 2, preop: 1, conservative: 0, fordischarge: 0 },
      users: 0,
      lastActivity: 3000
    });
    const unitB1 = dep2.units.find(u => u.id === 'uB1');
    assert.equal(unitB1.stats.livePatients, 1);
    assert.equal(unitB1.stats.lastActivity, 500);

    // Ward stats only count patients carrying that optional wardId — a
    // strict subset of the unit's patients (p3/p7 sit under uA1 but have no
    // wardId, so wA's count is 2, not 4).
    const wardA = unitA1.wards.find(w => w.id === 'wA');
    assert.deepEqual(wardA.stats, {
      livePatients: 2,
      byStatus: { postop: 2, preop: 0, conservative: 0, fordischarge: 0 },
      users: 0,
      lastActivity: 3000
    });
    const wardB = unitB1.wards.find(w => w.id === 'wB');
    assert.equal(wardB.stats.livePatients, 1);
    assert.equal(wardB.stats.lastActivity, 500);
  });

  test('empty org tree is well-formed', async () => {
    await store.createOrganization({ id: 'o3', name: 'Empty', plan: 'free' });
    const tree = await buildOrgTree(store, 'o3');
    assert.equal(tree.org.id, 'o3');
    assert.equal(tree.org.name, 'Empty');
    assert.equal(tree.org.stats.livePatients, 0);
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

describe('buildOrgTree counting corrections', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-admin-counts-'));
    store = await createStore({ dataDir });
    await store.init();
    await store.createOrganization({ id: 'c-org', name: 'Counts Org', plan: 'free' });
    await store.createHospital({ id: 'c-h1', orgId: 'c-org', name: 'Hospital One' });
    await store.createDepartment({ id: 'c-d1', hospitalId: 'c-h1', name: 'Ortho', specialty: 'ortho' });
    await store.createUnit({ id: 'c-uA', departmentId: 'c-d1', name: 'Unit A' });
    await store.createUnit({ id: 'c-uB', departmentId: 'c-d1', name: 'Unit B' });
    await store.createWard({ id: 'c-wA', unitId: 'c-uA', name: 'Ward A' });
    await store.createWard({ id: 'c-wB', unitId: 'c-uB', name: 'Ward B' });

    const mkUser = (id, patch) => store.createUser(Object.assign({
      id, username: id, passwordHash: 'h', passwordSalt: 's', role: 'member',
      active: true, tokenVersion: 0, createdAt: Date.now(), orgId: 'c-org', wardId: null
    }, patch));
    // Carries BOTH the legacy department pin and a matching node assignment.
    await mkUser('c-dual', { wardId: 'c-d1', assignmentType: 'department', assignmentId: 'c-d1' });
    // Assigned above the department, at levels the old loop ignored entirely.
    await mkUser('c-hosp', { assignmentType: 'hospital', assignmentId: 'c-h1' });
    await mkUser('c-orgu', { assignmentType: 'org', assignmentId: 'c-org' });

    const put = (id, unitId, wardId, status, updatedAt) => store.upsertPatient(
      id, updatedAt, 0, JSON.stringify({ id, unitId, wardId, status, updatedAt })
    );
    await put('c-p1', 'c-uA', 'c-wA', 'postop', 1000);  // ward matches its unit
    await put('c-p2', 'c-uA', 'c-wB', 'preop', 2000);   // stale ward under a DIFFERENT unit
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('a user with both a legacy wardId and a matching assignment counts once', async () => {
    const tree = await buildOrgTree(store, 'c-org');
    const dep = tree.hospitals[0].departments[0];
    assert.equal(dep.stats.users, 1);
  });

  test('hospital- and org-level assignments are counted', async () => {
    const tree = await buildOrgTree(store, 'c-org');
    assert.equal(tree.hospitals[0].stats.users, 1);
    assert.equal(tree.org.stats.users, 1);
  });

  test('hospital and org carry rolled-up patient stats', async () => {
    const tree = await buildOrgTree(store, 'c-org');
    assert.equal(tree.hospitals[0].stats.livePatients, 2);
    assert.equal(tree.org.stats.livePatients, 2);
    assert.equal(tree.org.stats.byStatus.postop, 1);
    assert.equal(tree.org.stats.byStatus.preop, 1);
  });

  test('a wardId belonging to a different unit is not counted at that ward', async () => {
    const tree = await buildOrgTree(store, 'c-org');
    const units = tree.hospitals[0].departments[0].units;
    const wardA = units.find(u => u.id === 'c-uA').wards[0];
    const wardB = units.find(u => u.id === 'c-uB').wards[0];
    assert.equal(wardA.stats.livePatients, 1); // c-p1 only
    assert.equal(wardB.stats.livePatients, 0); // c-p2's wardId is stale, its unit is c-uA
  });
});

describe('buildScopeTree unit assignment', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-scope-'));
    store = await createStore({ dataDir });
    await store.init();
    await store.createOrganization({ id: 'o1', name: 'Org', plan: 'free' });
    await store.createHospital({ id: 'h1', orgId: 'o1', name: 'H' });
    await store.createDepartment({ id: 'dep1', hospitalId: 'h1', name: 'Orthopaedics' });
    await store.createUnit({ id: 'u2', departmentId: 'dep1', name: 'II' });
    await store.createWard({ id: 'w1', unitId: 'u2', name: 'Ward 1' });
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('unit assignment returns Orthopaedics › II for the patient-form picker', async () => {
    const tree = await buildScopeTree(store, { type: 'unit', id: 'u2' });
    assert.equal(tree.departments.length, 1);
    assert.equal(tree.departments[0].name, 'Orthopaedics');
    assert.deepEqual(tree.departments[0].units.map(u => ({ id: u.id, name: u.name })), [{ id: 'u2', name: 'II' }]);
  });

  test('unit assignment still returns the unit when listUnitsByDepartment is empty (must not drop II)', async () => {
    // Reproduces symptom C: department name shows, Unit select blank — caused when
    // buildScopeTree re-lists units and misses the already-fetched assignment unit.
    const wrapped = {
      getUnit: (id) => store.getUnit(id),
      getDepartment: (id) => store.getDepartment(id),
      getWard: (id) => store.getWard(id),
      listUnitsByDepartment: async () => [],
      listWardsByUnit: (id) => store.listWardsByUnit(id),
      listOrganizations: () => store.listOrganizations(),
      listHospitalsByOrg: (id) => store.listHospitalsByOrg(id),
      listDepartmentsByHospital: (id) => store.listDepartmentsByHospital(id)
    };
    const tree = await buildScopeTree(wrapped, { type: 'unit', id: 'u2' });
    assert.equal(tree.departments[0]?.name, 'Orthopaedics');
    assert.deepEqual(tree.departments[0]?.units.map(u => u.id), ['u2'],
      'assigned unit must appear even if listUnitsByDepartment returns nothing');
  });
});
