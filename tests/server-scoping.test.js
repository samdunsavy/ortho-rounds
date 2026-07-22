import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../auth.js';
import { startServer, login, syncPost } from './helpers/server-harness.js';

function seedUser(store, { id, username, orgId = null, assignment = null, role = 'member' }){
  const salt = 'testsalt';
  return store.createUser({
    id, username, passwordSalt: salt, passwordHash: hashPassword('pw-' + username, salt),
    role, active: true, tokenVersion: 0, createdAt: Date.now(), orgId,
    assignmentType: assignment ? assignment.type : null,
    assignmentId: assignment ? assignment.id : null
  });
}

async function tok(baseUrl, username, password){
  const l = await login(baseUrl, username, password);
  assert.equal(l.status, 200, `login failed for ${username}`);
  return l.json.token;
}
const ids = (r) => r.json.patients.map(p => p.id).sort();

describe('MULTI_TENANT sync scoping (unit-based)', () => {
  let srv, tokens;
  before(async () => {
    srv = await startServer({
      multiTenant: true,
      seed: async (store) => {
        // org1: hospital h1 -> departments dep1 (Ortho), dep2 (Surgery)
        //   dep1 -> ward1 -> unit1
        //   dep2 -> ward2 -> unit2
        // org2: hospital hx -> department depx -> wardx -> unitx
        await store.createOrganization({ id: 'org1', name: 'Org1', plan: 'free' });
        await store.createOrganization({ id: 'org2', name: 'Org2', plan: 'free' });
        await store.createHospital({ id: 'h1', orgId: 'org1', name: 'H1' });
        await store.createHospital({ id: 'hx', orgId: 'org2', name: 'HX' });
        await store.createDepartment({ id: 'dep1', hospitalId: 'h1', name: 'Ortho' });
        await store.createDepartment({ id: 'dep2', hospitalId: 'h1', name: 'Surgery' });
        await store.createDepartment({ id: 'depx', hospitalId: 'hx', name: 'OtherOrg' });
        await store.createWard({ id: 'ward1', departmentId: 'dep1', name: 'Ward One' });
        await store.createWard({ id: 'ward2', departmentId: 'dep2', name: 'Ward Two' });
        await store.createWard({ id: 'wardx', departmentId: 'depx', name: 'Ward X' });
        await store.createUnit({ id: 'unit1', wardId: 'ward1', name: 'Unit One' });
        await store.createUnit({ id: 'unit2', wardId: 'ward2', name: 'Unit Two' });
        await store.createUnit({ id: 'unitx', wardId: 'wardx', name: 'Unit X' });
        await seedUser(store, { id: 'u1', username: 'pg1', orgId: 'org1', assignment: { type: 'unit', id: 'unit1' } });
        await seedUser(store, { id: 'u2', username: 'pg2', orgId: 'org1', assignment: { type: 'unit', id: 'unit2' } });
        await seedUser(store, { id: 'u3', username: 'boss1', orgId: 'org1', role: 'admin' });
        await seedUser(store, { id: 'u4', username: 'lost', orgId: 'org1' });
        await seedUser(store, { id: 'u5', username: 'px', orgId: 'org2', assignment: { type: 'unit', id: 'unitx' } });
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
    // Each member creates one patient with no unitId — auto-resolved to their
    // single assigned unit.
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

  test('new patients are stamped with the creator\'s full ancestry + derived labels', async () => {
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    const p = r.json.patients.find(x => x.id === 'pat-w1');
    assert.equal(p.unitId, 'unit1');
    assert.equal(p.wardId, 'ward1');
    assert.equal(p.departmentId, 'dep1');
    assert.equal(p.hospitalId, 'h1');
    assert.equal(p.orgId, 'org1');
    assert.equal(p.ward, 'Ward One');
    assert.equal(p.unit, 'Unit One');
  });

  test('member reads only own unit', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.pg1, { since: 0, changes: [] })), ['pat-w1']);
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.pg2, { since: 0, changes: [] })), ['pat-w2']);
  });

  test('unassigned member reads nothing and cannot create', async () => {
    assert.deepEqual(ids(await syncPost(srv.baseUrl, tokens.lost, { since: 0, changes: [] })), []);
    await syncPost(srv.baseUrl, tokens.lost, { since: 0, changes: [{ id: 'pat-lost', name: 'X', updatedAt: Date.now() }] });
    const all = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    assert.equal(all.json.patients.some(p => p.id === 'pat-lost'), false);
  });

  test('org admin reads all org units, not other orgs, not unassigned', async () => {
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

  test('member editing their own patient does not disturb stored ancestry', async () => {
    // Real clients never send ancestry fields (unitId/wardId/...) — those are
    // server-derived. A non-admin's decideWrite result omits `ancestry`
    // entirely ("keep existing ancestry"), so the sync loop leaves the
    // previously-stamped ancestry on the stored record untouched.
    await syncPost(srv.baseUrl, tokens.pg1, {
      since: 0, changes: [{ id: 'pat-w1', name: 'Renamed by pg1', updatedAt: Date.now() + 5 }]
    });
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    const p = r.json.patients.find(x => x.id === 'pat-w1');
    assert.equal(p.unitId, 'unit1');
    assert.equal(p.name, 'Renamed by pg1');
  });

  test('org admin can move a patient within org scope', async () => {
    await syncPost(srv.baseUrl, tokens.boss1, {
      since: 0, changes: [{ id: 'pat-w2', unitId: 'unit1', name: 'Patient of pg2', updatedAt: Date.now() + 10 }]
    });
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    const p = r.json.patients.find(x => x.id === 'pat-w2');
    assert.equal(p.unitId, 'unit1');
    assert.equal(p.wardId, 'ward1');
    assert.equal(p.departmentId, 'dep1');
    assert.equal(p.ward, 'Ward One');
    assert.equal(p.unit, 'Unit One');
  });

  test('backup/export/import/diag are instance-admin-only when flag on', async () => {
    for(const [path, method] of [['/api/backup', 'GET'], ['/api/export', 'GET'], ['/api/import', 'POST'], ['/api/diag', 'GET']]){
      for(const who of ['pg1', 'boss1']){
        const res = await fetch(`${srv.baseUrl}${path}`, {
          method, headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' },
          body: method === 'POST' ? JSON.stringify({ patients: [] }) : undefined
        });
        assert.equal(res.status, 403, `${who} ${path} must be 403`);
      }
      const rootRes = await fetch(`${srv.baseUrl}${path}`, {
        method, headers: { Authorization: `Bearer ${tokens.root}`, 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ patients: [] }) : undefined
      });
      assert.notEqual(rootRes.status, 403, `instance admin ${path} must not be 403`);
    }
  });
});
