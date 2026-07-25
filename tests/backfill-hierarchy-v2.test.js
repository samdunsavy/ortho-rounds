import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';
import { backfillV2 } from '../scripts/backfill-hierarchy-v2.js';
import { resolveScope } from '../scope.js';
import { nodeOrgId } from '../structure.js';

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

// FINDING 1 regression: a user assigned {assignmentType:'org', assignmentId:
// 'backfill-org'} (the v1 sentinel) must not be skipped just because
// 'backfill-org' still exists. Its subtree yields zero units after the FK
// flip, so mere existence is not enough — the assignment must resolve AND
// live under the org this run just (re)built (bfv2-org).
describe('Finding 1 regression: dead v1 org sentinel does not strand users', () => {
  let dataDir;
  let store;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-v2-orgaware-'));
    store = await createStore({ dataDir });
    await store.init();

    // A v1-shaped org that still exists (so a pure existence check would
    // pass) but is otherwise dead: v2 builds a completely separate
    // 'bfv2-org' tree and never touches this one.
    await store.createOrganization({ id: 'backfill-org', name: 'V1 Legacy Org', plan: 'free', createdAt: Date.now() });

    await store.upsertPatient('op1', 100, 0, JSON.stringify({ name: 'Orgtest Patient', unit: 'IV', ward: '' }));

    await store.createUser({
      id: 'v1user', username: 'v1user', passwordHash: 'h', passwordSalt: 's',
      role: 'member', orgId: null, active: true, tokenVersion: 0, createdAt: Date.now(),
      assignmentType: 'org', assignmentId: 'backfill-org'
    });
  });

  after(async () => {
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('the user is re-pointed into the bfv2-org tree, and resolveScope yields a non-empty unit set', async () => {
    const result = await backfillV2(store);

    const user = await store.getUserById('v1user');
    assert.notEqual(user.assignmentId, 'backfill-org', 'must be moved off the dead v1 org sentinel');

    const resolvedOrgId = await nodeOrgId(store, user.assignmentType, user.assignmentId);
    assert.equal(resolvedOrgId, result.orgId, 'must be re-pointed under the NEW bfv2-org tree');

    const actor = {
      id: user.id,
      role: 'member',
      orgId: user.orgId,
      assignment: { type: user.assignmentType, id: user.assignmentId }
    };
    const scope = await resolveScope(actor, store);
    assert.equal(scope.unrestricted, false);
    assert.ok(scope.unitIds.size > 0, 'user must not be stranded with an empty unit set');

    const op1 = JSON.parse((await store.getPatientRaw('op1')).data);
    assert.ok(scope.unitIds.has(op1.unitId), 'scope must include the unit the backfill just created');
  });
});

// FINDING 5(a)/(b) hardening: the single-org abort guard and the malformed-
// patient-row skip.
describe('Finding 5: single-org guard and malformed-row skip', () => {
  test('refuses to run when a patient carries a foreign orgId, unless --force', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-v2-guard-patient-'));
    const store = await createStore({ dataDir });
    await store.init();
    try {
      await store.upsertPatient('gp1', 100, 0, JSON.stringify({ name: 'Guard Patient', unit: 'IV', orgId: 'some-other-org' }));

      await assert.rejects(() => backfillV2(store), /refused to run/);

      const result = await backfillV2(store, { force: true });
      assert.ok(result.orgId);
      assert.equal(result.stamped, 1);
    } finally {
      await store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('refuses to run when a second organization row already exists, unless --force', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-v2-guard-org-'));
    const store = await createStore({ dataDir });
    await store.init();
    try {
      await store.createOrganization({ id: 'another-org', name: 'Another Org', plan: 'free', createdAt: Date.now() });

      await assert.rejects(() => backfillV2(store), /refused to run/);

      const result = await backfillV2(store, { force: true });
      assert.ok(result.orgId);
    } finally {
      await store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('a malformed patient row is skipped (not fatal) and counted in the summary', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-v2-malformed-'));
    const store = await createStore({ dataDir });
    await store.init();
    try {
      await store.upsertPatient('good1', 100, 0, JSON.stringify({ name: 'Good Patient', unit: 'IV' }));
      await store.upsertPatient('bad1', 200, 0, '{not valid json');

      const result = await backfillV2(store);
      assert.equal(result.stamped, 1);
      assert.equal(result.skipped, 1);

      const good = JSON.parse((await store.getPatientRaw('good1')).data);
      assert.ok(good.unitId, 'the well-formed row must still be stamped');
    } finally {
      await store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
