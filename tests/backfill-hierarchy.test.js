import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';
import { backfill } from '../scripts/backfill-hierarchy.js';
import { resolveScope } from '../scope.js';

describe('backfill-hierarchy', () => {
  let dataDir;
  let store;
  let firstRunOrgId;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-'));
    store = await createStore({ dataDir });
    await store.init();

    await store.upsertPatient('p1', 100, 0, JSON.stringify({ name: 'Alice', ward: '7FOW', unit: 'IV' }));
    await store.upsertPatient('p2', 200, 0, JSON.stringify({ name: 'Bob', ward: '7 fow', unit: 'IV' }));
    await store.upsertPatient('p3', 300, 0, JSON.stringify({ name: 'Carol', ward: '', unit: '' }));
    // A deleted patient should never get stamped.
    await store.upsertPatient('p4', 400, 1, JSON.stringify({ name: 'Deleted', ward: '7FOW', unit: 'IV' }));

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
  });

  after(async () => {
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('stamps ancestry onto every active patient', async () => {
    const result = await backfill(store);
    assert.ok(result.orgId);
    assert.equal(result.stamped, 3); // p1, p2, p3 — not the deleted p4
    assert.equal(result.assignedUsers, 1); // member1 only — instance admin is skipped
    firstRunOrgId = result.orgId;

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

  test('assigns existing unassigned members to the default org root (no-stranding)', async () => {
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

  test('the instance admin is not given an assignment', async () => {
    const admin = await store.getUserById('instance-admin1');
    assert.equal(admin.assignmentId, null);
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
    assert.equal(result.assignedUsers, 0, 're-run must not assign any further users');

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
