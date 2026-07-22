import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';
import { resolveScope, canRead, decideWrite } from '../scope.js';

const member = (wardId, orgId = 'org1') => ({ id: 'u1', username: 'pg1', role: 'member', orgId, wardId });
const orgAdmin = (orgId = 'org1') => ({ id: 'a1', username: 'boss', role: 'admin', orgId, wardId: null });
const instanceAdmin = () => ({ id: 'root', username: 'root', role: 'admin', orgId: null, wardId: null });

describe('resolveScope', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-scope-'));
    store = await createStore({ dataDir });
    await store.init();
    await store.createOrganization({ id: 'org1', name: 'Org One', plan: 'free' });
    await store.createOrganization({ id: 'org2', name: 'Org Two', plan: 'free' });
    await store.createHospital({ id: 'h1', orgId: 'org1', name: 'H1' });
    await store.createHospital({ id: 'h2', orgId: 'org1', name: 'H2' });
    await store.createHospital({ id: 'hx', orgId: 'org2', name: 'HX' });
    await store.createWard({ id: 'w1', hospitalId: 'h1', name: 'Ortho' });
    await store.createWard({ id: 'w2', hospitalId: 'h2', name: 'Surgery' });
    await store.createWard({ id: 'wx', hospitalId: 'hx', name: 'Other-org ward' });
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('member with ward: exactly that ward, no unassigned', async () => {
    const s = await resolveScope(member('w1'), store);
    assert.equal(s.unrestricted, false);
    assert.deepEqual([...s.wardIds], ['w1']);
    assert.equal(s.includeUnassigned, false);
  });

  test('member with no ward: empty scope (strict deny)', async () => {
    const s = await resolveScope(member(null), store);
    assert.equal(s.unrestricted, false);
    assert.equal(s.wardIds.size, 0);
    assert.equal(s.includeUnassigned, false);
  });

  test('org admin: all wards under all org hospitals, never other orgs, no unassigned', async () => {
    const s = await resolveScope(orgAdmin(), store);
    assert.equal(s.unrestricted, false);
    assert.deepEqual([...s.wardIds].sort(), ['w1', 'w2']);
    assert.equal(s.includeUnassigned, false);
  });

  test('org admin of empty org: empty scope', async () => {
    await store.createOrganization({ id: 'org3', name: 'Empty', plan: 'free' });
    const s = await resolveScope(orgAdmin('org3'), store);
    assert.equal(s.wardIds.size, 0);
  });

  test('instance admin: unrestricted incl. unassigned', async () => {
    const s = await resolveScope(instanceAdmin(), store);
    assert.equal(s.unrestricted, true);
    assert.equal(s.includeUnassigned, true);
  });
});

describe('canRead', () => {
  const memberScope = { unrestricted: false, wardIds: new Set(['w1']), includeUnassigned: false };
  const rootScope = { unrestricted: true, wardIds: new Set(), includeUnassigned: true };

  test('member reads own-ward patient only', () => {
    assert.equal(canRead({ id: 'p1', wardId: 'w1' }, memberScope), true);
    assert.equal(canRead({ id: 'p2', wardId: 'w2' }, memberScope), false);
  });
  test('unassigned patient: instance admin only', () => {
    assert.equal(canRead({ id: 'p3' }, memberScope), false);
    assert.equal(canRead({ id: 'p3' }, rootScope), true);
  });
  test('unrestricted reads everything', () => {
    assert.equal(canRead({ id: 'p4', wardId: 'anything' }, rootScope), true);
  });
});

describe('decideWrite', () => {
  const mScope = { unrestricted: false, wardIds: new Set(['w1']), includeUnassigned: false };
  const oScope = { unrestricted: false, wardIds: new Set(['w1', 'w2']), includeUnassigned: false };
  const rScope = { unrestricted: true, wardIds: new Set(), includeUnassigned: true };

  test('member creates: stamped with own ward', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: null, actor: member('w1'), scope: mScope });
    assert.deepEqual(d, { allow: true, wardId: 'w1' });
  });
  test('member with no ward cannot create', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: null, actor: member(null), scope: { unrestricted: false, wardIds: new Set(), includeUnassigned: false } });
    assert.equal(d.allow, false);
  });
  test('member updates own-ward patient; stored wardId wins over incoming', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'w2' }, existing: { id: 'p', wardId: 'w1' }, actor: member('w1'), scope: mScope });
    assert.deepEqual(d, { allow: true, wardId: 'w1' });
  });
  test('member cannot touch out-of-scope patient', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: { id: 'p', wardId: 'w2' }, actor: member('w1'), scope: mScope });
    assert.equal(d.allow, false);
  });
  test('member cannot touch unassigned patient', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: { id: 'p' }, actor: member('w1'), scope: mScope });
    assert.equal(d.allow, false);
  });
  test('org admin creates with in-scope incoming ward', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'w2' }, existing: null, actor: orgAdmin(), scope: oScope });
    assert.deepEqual(d, { allow: true, wardId: 'w2' });
  });
  test('org admin create with out-of-scope ward is skipped', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'wx' }, existing: null, actor: orgAdmin(), scope: oScope });
    assert.equal(d.allow, false);
  });
  test('org admin create with no ward and no own ward is skipped', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: null, actor: orgAdmin(), scope: oScope });
    assert.equal(d.allow, false);
  });
  test('org admin create with no ward falls back to own ward', () => {
    const actor = { ...orgAdmin(), wardId: 'w1' };
    const d = decideWrite({ incoming: { id: 'p' }, existing: null, actor, scope: oScope });
    assert.deepEqual(d, { allow: true, wardId: 'w1' });
  });
  test('org admin may move patient within scope', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'w2' }, existing: { id: 'p', wardId: 'w1' }, actor: orgAdmin(), scope: oScope });
    assert.deepEqual(d, { allow: true, wardId: 'w2' });
  });
  test('org admin incoming out-of-scope ward on update keeps stored ward', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'wx' }, existing: { id: 'p', wardId: 'w1' }, actor: orgAdmin(), scope: oScope });
    assert.deepEqual(d, { allow: true, wardId: 'w1' });
  });
  test('instance admin creates unassigned', () => {
    const d = decideWrite({ incoming: { id: 'p' }, existing: null, actor: instanceAdmin(), scope: rScope });
    assert.deepEqual(d, { allow: true, wardId: null });
  });
  test('instance admin keeps incoming ward on create', () => {
    const d = decideWrite({ incoming: { id: 'p', wardId: 'wx' }, existing: null, actor: instanceAdmin(), scope: rScope });
    assert.deepEqual(d, { allow: true, wardId: 'wx' });
  });
});
