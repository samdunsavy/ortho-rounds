import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../auth.js';
import { startServer, login, syncPost } from './helpers/server-harness.js';

function seedUser(store, { id, username, orgId = null, wardId = null, role = 'member' }){
  const salt = 'testsalt';
  return store.createUser({
    id, username, passwordSalt: salt, passwordHash: hashPassword('pw-' + username, salt),
    role, active: true, tokenVersion: 0, createdAt: Date.now(), orgId, wardId
  });
}

async function tok(baseUrl, username, password){
  const l = await login(baseUrl, username, password);
  assert.equal(l.status, 200, `login failed for ${username}`);
  return l.json.token;
}
const ids = (r) => r.json.patients.map(p => p.id).sort();

describe('MULTI_TENANT sync scoping', () => {
  let srv, tokens;
  before(async () => {
    srv = await startServer({
      multiTenant: true,
      seed: async (store) => {
        await store.createOrganization({ id: 'org1', name: 'Org1', plan: 'free' });
        await store.createOrganization({ id: 'org2', name: 'Org2', plan: 'free' });
        await store.createHospital({ id: 'h1', orgId: 'org1', name: 'H1' });
        await store.createHospital({ id: 'hx', orgId: 'org2', name: 'HX' });
        await store.createWard({ id: 'w1', hospitalId: 'h1', name: 'Ortho' });
        await store.createWard({ id: 'w2', hospitalId: 'h1', name: 'Surgery' });
        await store.createWard({ id: 'wx', hospitalId: 'hx', name: 'OtherOrg' });
        await seedUser(store, { id: 'u1', username: 'pg1', orgId: 'org1', wardId: 'w1' });
        await seedUser(store, { id: 'u2', username: 'pg2', orgId: 'org1', wardId: 'w2' });
        await seedUser(store, { id: 'u3', username: 'boss1', orgId: 'org1', role: 'admin' });
        await seedUser(store, { id: 'u4', username: 'lost', orgId: 'org1' });
        await seedUser(store, { id: 'u5', username: 'px', orgId: 'org2', wardId: 'wx' });
      }
    });
    tokens = {
      pg1: await tok(srv.baseUrl, 'pg1', 'pw-pg1'),
      pg2: await tok(srv.baseUrl, 'pg2', 'pw-pg2'),
      boss1: await tok(srv.baseUrl, 'boss1', 'pw-boss1'),
      lost: await tok(srv.baseUrl, 'lost', 'pw-lost'),
      px: await tok(srv.baseUrl, 'px', 'pw-px'),
      root: await tok(srv.baseUrl, 'admin', 'test-admin-pass')
    };
    // Each member creates one patient in their own department.
    for(const [who, id] of [['pg1', 'pat-w1'], ['pg2', 'pat-w2'], ['px', 'pat-wx']]){
      const r = await syncPost(srv.baseUrl, tokens[who], {
        since: 0, changes: [{ id, name: `Patient of ${who}`, updatedAt: Date.now() }]
      });
      assert.equal(r.status, 200);
    }
    // Instance admin creates an unassigned patient.
    const r = await syncPost(srv.baseUrl, tokens.root, {
      since: 0, changes: [{ id: 'pat-unassigned', name: 'Nobody', updatedAt: Date.now() }]
    });
    assert.equal(r.status, 200);
  });
  after(async () => { await srv.stop(); });

  test('new patients are stamped with the creator\'s department', async () => {
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    const p = r.json.patients.find(x => x.id === 'pat-w1');
    assert.equal(p.wardId, 'w1');
  });

  test('member reads only own department', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.pg1, { since: 0, changes: [] })), ['pat-w1']);
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.pg2, { since: 0, changes: [] })), ['pat-w2']);
  });

  test('unassigned member reads nothing and cannot create', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.lost, { since: 0, changes: [] })), []);
    await syncPost(srv.baseUrl, tokens.lost, { since: 0, changes: [{ id: 'pat-lost', name: 'X', updatedAt: Date.now() }] });
    const all = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    assert.equal(all.json.patients.some(p => p.id === 'pat-lost'), false);
  });

  test('org admin reads all org departments, not other orgs, not unassigned', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.boss1, { since: 0, changes: [] })), ['pat-w1', 'pat-w2']);
  });

  test('instance admin reads everything including unassigned', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] })), ['pat-unassigned', 'pat-w1', 'pat-w2', 'pat-wx']);
  });

  test('cross-org isolation is bidirectional', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.px, { since: 0, changes: [] })), ['pat-wx']);
    const boss = await syncPost(srv.baseUrl, tokens.boss1, { since: 0, changes: [] });
    assert.equal(boss.json.patients.some(p => p.id === 'pat-wx'), false);
  });

  test('out-of-scope write is silently skipped', async () => {
    const before = (await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] }))
      .json.patients.find(p => p.id === 'pat-w2');
    const r = await syncPost(srv.baseUrl, tokens.pg1, {
      since: 0, changes: [{ id: 'pat-w2', name: 'HIJACKED', updatedAt: Date.now() + 999999 }]
    });
    assert.equal(r.status, 200); // contract unchanged: no error
    const after = (await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] }))
      .json.patients.find(p => p.id === 'pat-w2');
    assert.equal(after.name, before.name);
  });

  test('member cannot move a patient across departments (stored wardId wins)', async () => {
    await syncPost(srv.baseUrl, tokens.pg1, {
      since: 0, changes: [{ id: 'pat-w1', name: 'Patient of pg1', wardId: 'w2', updatedAt: Date.now() + 5 }]
    });
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    assert.equal(r.json.patients.find(p => p.id === 'pat-w1').wardId, 'w1');
  });

  test('org admin can move a patient within org scope', async () => {
    await syncPost(srv.baseUrl, tokens.boss1, {
      since: 0, changes: [{ id: 'pat-w2', wardId: 'w1', name: 'Patient of pg2', updatedAt: Date.now() + 10 }]
    });
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    assert.equal(r.json.patients.find(p => p.id === 'pat-w2').wardId, 'w1');
  });
});
