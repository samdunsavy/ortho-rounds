import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';
import { resolveScope, canRead, decideWrite } from '../scope.js';

const member = (unitId, orgId = 'o1') => ({ id: 'u', username: 'pg', role: 'member', orgId, assignment: unitId ? { type: 'unit', id: unitId } : null });
const deptAdmin = (depId = 'd1', orgId = 'o1') => ({ id: 'a', username: 'boss', role: 'admin', orgId, assignment: { type: 'department', id: depId } });
const orgAdmin = (orgId = 'o1') => ({ id: 'oa', username: 'orgboss', role: 'admin', orgId, assignment: { type: 'org', id: orgId } });
const instanceAdmin = () => ({ id: 'root', username: 'root', role: 'admin', orgId: null, assignment: null });

describe('scope (unit-based subtree)', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-scope-'));
    store = await createStore({ dataDir });
    await store.init();
    // o1 -> h1 -> d1 -> u1
    //                -> u2
    await store.createOrganization({ id: 'o1', name: 'Org One', plan: 'free' });
    await store.createHospital({ id: 'h1', orgId: 'o1', name: 'H1' });
    await store.createDepartment({ id: 'd1', hospitalId: 'h1', name: 'Ortho' });
    await store.createUnit({ id: 'u1', departmentId: 'd1', name: 'U1' });
    await store.createUnit({ id: 'u2', departmentId: 'd1', name: 'U2' });

    // o2 -> hx -> dx -> ux (second org, fully isolated)
    await store.createOrganization({ id: 'o2', name: 'Org Two', plan: 'free' });
    await store.createHospital({ id: 'hx', orgId: 'o2', name: 'HX' });
    await store.createDepartment({ id: 'dx', hospitalId: 'hx', name: 'Other' });
    await store.createUnit({ id: 'ux', departmentId: 'dx', name: 'UX' });
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  describe('resolveScope', () => {
    test('member sees exactly their unit', async () => {
      const s = await resolveScope(member('u1'), store);
      assert.deepEqual([...s.unitIds], ['u1']);
      assert.equal(s.includeUnassigned, false);
      assert.equal(s.unrestricted, false);
    });

    test('member with no assignment: empty scope (strict deny)', async () => {
      const s = await resolveScope(member(null), store);
      assert.equal(s.unrestricted, false);
      assert.equal(s.unitIds.size, 0);
      assert.equal(s.includeUnassigned, false);
    });

    test('dept admin sees all units under the department', async () => {
      const s = await resolveScope(deptAdmin('d1'), store);
      assert.deepEqual([...s.unitIds].sort(), ['u1', 'u2']);
      assert.equal(s.includeUnassigned, false);
    });

    test('org admin sees all units under the org, never other orgs', async () => {
      const s = await resolveScope(orgAdmin('o1'), store);
      assert.deepEqual([...s.unitIds].sort(), ['u1', 'u2']);
    });

    test('instance admin unrestricted + unassigned', async () => {
      const s = await resolveScope(instanceAdmin(), store);
      assert.equal(s.unrestricted, true);
      assert.equal(s.includeUnassigned, true);
    });
  });

  describe('canRead', () => {
    test('canRead: patient in-scope by unitId', async () => {
      const s = await resolveScope(member('u1'), store);
      assert.equal(canRead({ unitId: 'u1' }, s), true);
      assert.equal(canRead({ unitId: 'u2' }, s), false);
      assert.equal(canRead({ }, s), false); // unassigned, member
    });

    test('canRead: instance admin reads everything incl. unassigned', async () => {
      const s = await resolveScope(instanceAdmin(), store);
      assert.equal(canRead({ unitId: 'u1' }, s), true);
      assert.equal(canRead({ }, s), true);
    });
  });

  describe('decideWrite', () => {
    test('decideWrite new patient: member inherits their unit ancestry', async () => {
      const s = await resolveScope(member('u1'), store);
      const d = await decideWrite({ incoming: {}, existing: null, actor: member('u1'), scope: s, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry.unitId, 'u1');
      assert.equal(d.ancestry.orgId, 'o1');
      assert.deepEqual(Object.keys(d.ancestry).sort(), ['departmentId', 'hospitalId', 'orgId', 'unitId']);
      assert.equal('wardId' in d.ancestry, false);
    });

    test('decideWrite new patient: member with no assignment is denied', async () => {
      const s = await resolveScope(member(null), store);
      const d = await decideWrite({ incoming: {}, existing: null, actor: member(null), scope: s, store });
      assert.equal(d.allow, false);
    });

    test('decideWrite new patient: multi-unit admin with no chosen unit is denied', async () => {
      const s = await resolveScope(deptAdmin('d1'), store);
      const d = await decideWrite({ incoming: {}, existing: null, actor: deptAdmin('d1'), scope: s, store });
      assert.equal(d.allow, false);
    });

    test('decideWrite new patient: admin choosing an in-scope unit is stamped', async () => {
      const s = await resolveScope(deptAdmin('d1'), store);
      const d = await decideWrite({ incoming: { unitId: 'u2' }, existing: null, actor: deptAdmin('d1'), scope: s, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry.unitId, 'u2');
    });

    test('decideWrite new patient: admin choosing an out-of-scope unit is denied', async () => {
      const s = await resolveScope(deptAdmin('d1'), store);
      const d = await decideWrite({ incoming: { unitId: 'ux' }, existing: null, actor: deptAdmin('d1'), scope: s, store });
      assert.equal(d.allow, false);
    });

    test('decideWrite new patient: instance admin with no unit stays unassigned', async () => {
      const s = await resolveScope(instanceAdmin(), store);
      const d = await decideWrite({ incoming: {}, existing: null, actor: instanceAdmin(), scope: s, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry, undefined);
    });

    test('decideWrite new patient: instance admin choosing a unit is stamped', async () => {
      const s = await resolveScope(instanceAdmin(), store);
      const d = await decideWrite({ incoming: { unitId: 'ux' }, existing: null, actor: instanceAdmin(), scope: s, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry.unitId, 'ux');
    });

    test('decideWrite update: unassigned patient stays unassigned (ancestry resolves to null, not undefined)', async () => {
      const s = await resolveScope(instanceAdmin(), store);
      const d = await decideWrite({ incoming: {}, existing: { unitId: null }, actor: instanceAdmin(), scope: s, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry, null);
    });

    test('decideWrite update: member cannot touch out-of-scope patient', async () => {
      const s = await resolveScope(member('u1'), store);
      const d = await decideWrite({ incoming: {}, existing: { unitId: 'u2' }, actor: member('u1'), scope: s, store });
      assert.equal(d.allow, false);
    });

    test('decideWrite update: member updates own-unit patient, server re-stamps existing unit ancestry', async () => {
      const s = await resolveScope(member('u1'), store);
      const d = await decideWrite({ incoming: {}, existing: { unitId: 'u1' }, actor: member('u1'), scope: s, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry.unitId, 'u1');
      assert.equal(d.ancestry.orgId, 'o1');
    });

    test('decideWrite update: non-admin sending a different unitId cannot relabel — server re-stamps the existing unit\'s ancestry, ignoring the incoming value', async () => {
      const s = await resolveScope(member('u1'), store);
      const d = await decideWrite({ incoming: { unitId: 'u2' }, existing: { unitId: 'u1' }, actor: member('u1'), scope: s, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry.unitId, 'u1');
      assert.notEqual(d.ancestry.unitId, 'u2');
    });

    test('decideWrite update: admin moving an in-scope patient to another in-scope unit is stamped', async () => {
      const s = await resolveScope(deptAdmin('d1'), store);
      const d = await decideWrite({ incoming: { unitId: 'u2' }, existing: { unitId: 'u1' }, actor: deptAdmin('d1'), scope: s, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry.unitId, 'u2');
    });

    test('decideWrite update: admin incoming out-of-scope unit is rejected — server re-stamps the existing unit\'s ancestry, ignoring the incoming value', async () => {
      const s = await resolveScope(deptAdmin('d1'), store);
      const d = await decideWrite({ incoming: { unitId: 'ux' }, existing: { unitId: 'u1' }, actor: deptAdmin('d1'), scope: s, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry.unitId, 'u1');
      assert.notEqual(d.ancestry.unitId, 'ux');
    });
  });

  describe('decideWrite — scope-derived move + org clamp', () => {
    let dataDir, store;
    before(async () => {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-move-'));
      store = await createStore({ dataDir });
      await store.init();
      // org1: dep1 -> unitA, unitB ; org2: depX -> unitX
      await store.createOrganization({ id: 'org1', name: 'O1', plan: 'free' });
      await store.createOrganization({ id: 'org2', name: 'O2', plan: 'free' });
      await store.createHospital({ id: 'h1', orgId: 'org1', name: 'H1' });
      await store.createHospital({ id: 'hx', orgId: 'org2', name: 'HX' });
      await store.createDepartment({ id: 'dep1', hospitalId: 'h1', name: 'D1' });
      await store.createDepartment({ id: 'depx', hospitalId: 'hx', name: 'DX' });
      await store.createUnit({ id: 'unitA', departmentId: 'dep1', name: 'A' });
      await store.createUnit({ id: 'unitB', departmentId: 'dep1', name: 'B' });
      await store.createUnit({ id: 'unitX', departmentId: 'depx', name: 'X' });
    });
    after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

    const deptMember = { id: 'u', username: 'pg', role: 'member', orgId: 'org1' };
    const deptScope = { unrestricted: false, unitIds: new Set(['unitA', 'unitB']), includeUnassigned: false };
    const unitScope = { unrestricted: false, unitIds: new Set(['unitA']), includeUnassigned: false };
    const rootScope = { unrestricted: true, unitIds: new Set(), includeUnassigned: true };

    test('a department-scoped member moves a patient between two in-scope units', async () => {
      const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitB' }, existing: { id: 'p', unitId: 'unitA', orgId: 'org1' }, actor: deptMember, scope: deptScope, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry.unitId, 'unitB');
      assert.deepEqual(d.moved, { from: 'unitA', to: 'unitB' });
    });

    test('a unit-pinned member cannot move a patient out (requested unit not in scope → force-stamp, no moved)', async () => {
      const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitB' }, existing: { id: 'p', unitId: 'unitA', orgId: 'org1' }, actor: deptMember, scope: unitScope, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry.unitId, 'unitA');
      assert.equal(d.moved, undefined);
    });

    test('org clamp: even an unrestricted scope cannot move a patient into another org', async () => {
      const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitX' }, existing: { id: 'p', unitId: 'unitA', orgId: 'org1' }, actor: { role: 'admin', orgId: null }, scope: rootScope, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry.unitId, 'unitA', 'target org2 unit ignored; stays put');
      assert.equal(d.moved, undefined);
    });

    test('same-org move under an unrestricted scope is allowed and recorded', async () => {
      const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitB' }, existing: { id: 'p', unitId: 'unitA', orgId: 'org1' }, actor: { role: 'admin', orgId: null }, scope: rootScope, store });
      assert.deepEqual(d.moved, { from: 'unitA', to: 'unitB' });
    });

    test('first placement of an unassigned patient (no orgId) is allowed', async () => {
      const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitA' }, existing: { id: 'p', unitId: null }, actor: { role: 'admin', orgId: null }, scope: rootScope, store });
      assert.equal(d.allow, true);
      assert.equal(d.ancestry.unitId, 'unitA');
      assert.deepEqual(d.moved, { from: null, to: 'unitA' });
    });

    test('re-sending the same unitId is not a move (no moved marker)', async () => {
      const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitA' }, existing: { id: 'p', unitId: 'unitA', orgId: 'org1' }, actor: deptMember, scope: deptScope, store });
      assert.equal(d.moved, undefined);
    });
  });
});

import { intersectScope } from '../scope.js';

describe('intersectScope — narrow-only active scope', () => {
  test('unrestricted collapses to exactly the active units', () => {
    const s = intersectScope({ unrestricted: true, unitIds: new Set(), includeUnassigned: true }, new Set(['u1', 'u2']));
    assert.equal(s.unrestricted, false);
    assert.deepEqual([...s.unitIds].sort(), ['u1', 'u2']);
    assert.equal(s.includeUnassigned, false);
  });
  test('restricted keeps only its own units that are also active (never widens)', () => {
    const s = intersectScope({ unrestricted: false, unitIds: new Set(['u1', 'u2']), includeUnassigned: false }, new Set(['u2', 'u3']));
    assert.deepEqual([...s.unitIds], ['u2']);
  });
  test('empty intersection yields an empty scope (fail closed)', () => {
    const s = intersectScope({ unrestricted: false, unitIds: new Set(['u1']), includeUnassigned: false }, new Set(['u9']));
    assert.equal(s.unitIds.size, 0);
  });
});
