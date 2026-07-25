import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';
import { backfillV2 } from '../scripts/backfill-hierarchy-v2.js';
import { resolveScope } from '../scope.js';

describe('backfill-hierarchy-v2', () => {
  let dataDir;
  let store;
  let firstRunOrgId;
  let ivUnitId;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-v2-'));
    store = await createStore({ dataDir });
    await store.init();

    await store.upsertPatient('p1', 100, 0, JSON.stringify({ name: 'Alice', ward: '7FOW', unit: 'IV' }));
    await store.upsertPatient('p2', 200, 0, JSON.stringify({ name: 'Bob', ward: '7 fow', unit: 'IV' }));
    await store.upsertPatient('p3', 300, 0, JSON.stringify({ name: 'Carol', ward: '', unit: 'IV' }));
    await store.upsertPatient('p4', 400, 0, JSON.stringify({ name: 'Dave', ward: '3MOW', unit: '' }));
    // A deleted patient should never get stamped.
    await store.upsertPatient('p5', 500, 1, JSON.stringify({ name: 'Deleted', ward: '7FOW', unit: 'IV' }));

    // A pre-existing non-admin member with no assignment yet, plus the
    // unrestricted instance admin — both present before the migration runs.
    await store.createUser({
      id: 'member1', username: 'member1', passwordHash: 'h', passwordSalt: 's',
      role: 'member', orgId: null, active: true, tokenVersion: 0, createdAt: Date.now()
    });
    await store.createUser({
      id: 'instance-admin1', username: 'instance-admin1', passwordHash: 'h', passwordSalt: 's',
      role: 'admin', orgId: null, active: true, tokenVersion: 0, createdAt: Date.now()
    });

    // Simulate a stale v1-era unit row left behind by the old backfill: its
    // departmentId points nowhere under the new (post FK-flip) schema, but
    // its name still carries the original "IV" label.
    await store.createUnit({ id: 'old-unit-1', departmentId: 'nonexistent-dept', name: 'IV', createdAt: Date.now() });
    await store.createUser({
      id: 'member2', username: 'member2', passwordHash: 'h', passwordSalt: 's',
      role: 'member', orgId: null, active: true, tokenVersion: 0, createdAt: Date.now(),
      assignmentType: 'unit', assignmentId: 'old-unit-1'
    });

    // A user assigned to a node that never existed at all — no label to
    // recover, must fall back to the org root.
    await store.createUser({
      id: 'member3', username: 'member3', passwordHash: 'h', passwordSalt: 's',
      role: 'member', orgId: null, active: true, tokenVersion: 0, createdAt: Date.now(),
      assignmentType: 'unit', assignmentId: 'totally-missing-unit'
    });
  });

  after(async () => {
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('(a) every active patient gets a unitId; deleted patients are untouched', async () => {
    const result = await backfillV2(store);
    assert.ok(result.orgId);
    assert.equal(result.stamped, 4); // p1..p4 — not the deleted p5
    firstRunOrgId = result.orgId;

    for(const id of ['p1', 'p2', 'p3', 'p4']){
      const row = await store.getPatientRaw(id);
      const data = JSON.parse(row.data);
      assert.ok(data.unitId, `${id} should have a unitId`);
      assert.ok(data.departmentId);
      assert.ok(data.hospitalId);
      assert.ok(data.orgId);
    }

    const deletedRow = await store.getPatientRaw('p5');
    const deletedData = JSON.parse(deletedRow.data);
    assert.equal(deletedData.unitId, undefined, 'deleted patients are not stamped');
  });

  test('(b) all three IV patients consolidate into ONE unit; blank-unit patient lands under General', async () => {
    const p1 = JSON.parse((await store.getPatientRaw('p1')).data);
    const p2 = JSON.parse((await store.getPatientRaw('p2')).data);
    const p3 = JSON.parse((await store.getPatientRaw('p3')).data);
    const p4 = JSON.parse((await store.getPatientRaw('p4')).data);

    assert.equal(p1.unitId, p2.unitId);
    assert.equal(p2.unitId, p3.unitId);
    assert.equal(p1.unit, 'IV');
    ivUnitId = p1.unitId;

    assert.notEqual(p4.unitId, ivUnitId);
    assert.equal(p4.unit, 'General');
    const generalUnit = await store.getUnit(p4.unitId);
    assert.equal(generalUnit.name, 'General');
  });

  test('(c) a patient with a blank ward label gets no wardId (ward is optional)', async () => {
    const row = await store.getPatientRaw('p3');
    const p3 = JSON.parse(row.data);
    assert.equal('wardId' in p3, false, 'p3 should have no wardId key at all');
    assert.equal(p3.ward, '');
  });

  test('(d) normalized ward names ("7FOW" / "7 fow") collapse to one ward under the IV unit', async () => {
    const p1 = JSON.parse((await store.getPatientRaw('p1')).data);
    const p2 = JSON.parse((await store.getPatientRaw('p2')).data);
    assert.ok(p1.wardId);
    assert.equal(p1.wardId, p2.wardId);

    const ward = await store.getWard(p1.wardId);
    assert.equal(ward.unitId, ivUnitId);
    assert.equal(ward.name, '7FOW'); // first-seen label wins
  });

  test('re-points a pre-existing unassigned member to the org root (no-stranding)', async () => {
    const member = await store.getUserById('member1');
    assert.equal(member.assignmentType, 'org');
    assert.equal(member.assignmentId, firstRunOrgId);

    const actor = {
      id: member.id,
      role: 'member',
      orgId: member.orgId,
      assignment: { type: member.assignmentType, id: member.assignmentId }
    };
    const scope = await resolveScope(actor, store);
    assert.equal(scope.unrestricted, false);
    assert.ok(scope.unitIds.size > 0, 'migrated member must not be stranded with an empty unit set');

    const p1 = JSON.parse((await store.getPatientRaw('p1')).data);
    assert.ok(scope.unitIds.has(p1.unitId), 'migrated member should see units created by the backfill');
  });

  test('re-points a user whose old unit no longer resolves to the consolidated unit sharing its label', async () => {
    const member2 = await store.getUserById('member2');
    assert.equal(member2.assignmentType, 'unit');
    assert.equal(member2.assignmentId, ivUnitId, 'member2 should land on the consolidated IV unit, not the org root');
  });

  test('re-points a user whose assignment has no recoverable label to the org root', async () => {
    const member3 = await store.getUserById('member3');
    assert.equal(member3.assignmentType, 'org');
    assert.equal(member3.assignmentId, firstRunOrgId);
  });

  test('the instance admin is not given an assignment', async () => {
    const admin = await store.getUserById('instance-admin1');
    assert.equal(admin.assignmentId, null);
  });

  test('(e) re-running is idempotent: creates nothing new, re-stamps identically, assigns no one further', async () => {
    const before1 = JSON.parse((await store.getPatientRaw('p1')).data);

    const result = await backfillV2(store);
    assert.equal(result.created.hospitals, 0);
    assert.equal(result.created.departments, 0);
    assert.equal(result.created.units, 0);
    assert.equal(result.created.wards, 0);
    assert.equal(result.stamped, 4);
    assert.equal(result.assignedUsers, 0, 're-run must not assign any further users — everyone already resolves');

    const after1 = JSON.parse((await store.getPatientRaw('p1')).data);
    assert.deepEqual(after1, before1);
  });

  test('--single-bucket puts every active patient in one unit with no wards', async () => {
    const result = await backfillV2(store, { singleBucket: true });
    assert.equal(result.stamped, 4);

    const p1 = JSON.parse((await store.getPatientRaw('p1')).data);
    const p2 = JSON.parse((await store.getPatientRaw('p2')).data);
    const p3 = JSON.parse((await store.getPatientRaw('p3')).data);
    const p4 = JSON.parse((await store.getPatientRaw('p4')).data);
    assert.equal(p1.unitId, p2.unitId);
    assert.equal(p2.unitId, p3.unitId);
    assert.equal(p3.unitId, p4.unitId);
    assert.equal(p1.unit, 'General');
    assert.equal('wardId' in p1, false);
  });
});
