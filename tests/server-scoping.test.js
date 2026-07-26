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
        //   dep1 -> unit1 -> ward1 (optional ward under unit1)
        //   dep2 -> unit2 -> ward2 (optional ward under unit2)
        // org2: hospital hx -> department depx -> unitx -> wardx
        await store.createOrganization({ id: 'org1', name: 'Org1', plan: 'free' });
        await store.createOrganization({ id: 'org2', name: 'Org2', plan: 'free' });
        await store.createHospital({ id: 'h1', orgId: 'org1', name: 'H1' });
        await store.createHospital({ id: 'hx', orgId: 'org2', name: 'HX' });
        await store.createDepartment({ id: 'dep1', hospitalId: 'h1', name: 'Ortho' });
        await store.createDepartment({ id: 'dep2', hospitalId: 'h1', name: 'Surgery' });
        await store.createDepartment({ id: 'depx', hospitalId: 'hx', name: 'OtherOrg' });
        await store.createUnit({ id: 'unit1', departmentId: 'dep1', name: 'Unit One' });
        await store.createUnit({ id: 'unit1b', departmentId: 'dep1', name: 'Unit One-B' });
        await store.createUnit({ id: 'unit2', departmentId: 'dep2', name: 'Unit Two' });
        await store.createUnit({ id: 'unitx', departmentId: 'depx', name: 'Unit X' });
        await store.createWard({ id: 'ward1', unitId: 'unit1', name: 'Ward One' });
        await store.createWard({ id: 'ward2', unitId: 'unit2', name: 'Ward Two' });
        await store.createWard({ id: 'wardx', unitId: 'unitx', name: 'Ward X' });
        await seedUser(store, { id: 'u1', username: 'pg1', orgId: 'org1', assignment: { type: 'unit', id: 'unit1' } });
        await seedUser(store, { id: 'u2', username: 'pg2', orgId: 'org1', assignment: { type: 'unit', id: 'unit2' } });
        await seedUser(store, { id: 'u3', username: 'boss1', orgId: 'org1', role: 'admin' });
        await seedUser(store, { id: 'u4', username: 'lost', orgId: 'org1' });
        await seedUser(store, { id: 'u5', username: 'px', orgId: 'org2', assignment: { type: 'unit', id: 'unitx' } });
        await seedUser(store, { id: 'ud', username: 'dlead', orgId: 'org1', assignment: { type: 'department', id: 'dep1' } });
      }
    });
    tokens = {
      pg1: await tok(srv.baseUrl, 'pg1', 'pw-pg1'),
      pg2: await tok(srv.baseUrl, 'pg2', 'pw-pg2'),
      boss1: await tok(srv.baseUrl, 'boss1', 'pw-boss1'),
      lost: await tok(srv.baseUrl, 'lost', 'pw-lost'),
      px: await tok(srv.baseUrl, 'px', 'pw-px'),
      root: await tok(srv.baseUrl, 'admin', 'test-admin-pass'),
      dlead: await tok(srv.baseUrl, 'dlead', 'pw-dlead')
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
    assert.equal(p.departmentId, 'dep1');
    assert.equal(p.hospitalId, 'h1');
    assert.equal(p.orgId, 'org1');
    assert.equal(p.unit, 'Unit One');
    // No wardId was sent by the client, so the optional ward is never
    // invented from ancestry — the label only ever comes from the patient's
    // own wardId (see the ward-validation tests below).
    assert.equal('wardId' in p, false);
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

  test('member cannot relabel a patient\'s unit by sending unitId in the sync payload', async () => {
    // Security regression guard: a non-admin member is in-scope to edit their
    // own patient (pat-w1, unitId=unit1), but if their payload includes a
    // unitId pointing at a different unit — in scope (unit2, same org) or out
    // of scope (unitx, a different org entirely) — the server must ignore it
    // and keep stamping the server-resolved ancestry for the patient's
    // existing unit. The client can never relabel ancestry on an edit.
    await syncPost(srv.baseUrl, tokens.pg1, {
      since: 0, changes: [{ id: 'pat-w1', name: 'Renamed by pg1', unitId: 'unit2', updatedAt: Date.now() + 5 }]
    });
    let r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    let p = r.json.patients.find(x => x.id === 'pat-w1');
    assert.equal(p.unitId, 'unit1');
    assert.equal(p.departmentId, 'dep1');
    assert.equal(p.hospitalId, 'h1');
    assert.equal(p.orgId, 'org1');
    assert.equal(p.unit, 'Unit One');
    assert.equal(p.name, 'Renamed by pg1');

    // Same attempt but pointing at a unit in an entirely different org.
    await syncPost(srv.baseUrl, tokens.pg1, {
      since: 0, changes: [{ id: 'pat-w1', name: 'Renamed again', unitId: 'unitx', updatedAt: Date.now() + 10 }]
    });
    r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    p = r.json.patients.find(x => x.id === 'pat-w1');
    assert.equal(p.unitId, 'unit1');
    assert.equal(p.orgId, 'org1');
    assert.equal(p.unit, 'Unit One');
    assert.equal(p.name, 'Renamed again');
  });

  test('org admin can move a patient within org scope', async () => {
    await syncPost(srv.baseUrl, tokens.boss1, {
      since: 0, changes: [{ id: 'pat-w2', unitId: 'unit1', name: 'Patient of pg2', updatedAt: Date.now() + 10 }]
    });
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    const p = r.json.patients.find(x => x.id === 'pat-w2');
    assert.equal(p.unitId, 'unit1');
    assert.equal(p.departmentId, 'dep1');
    assert.equal(p.unit, 'Unit One');
    // Moving units never invents a ward — the optional wardId (unset here)
    // stays unset.
    assert.equal('wardId' in p, false);
  });

  test('sync ward validation: a valid wardId under the patient\'s unit is kept and labeled', async () => {
    const r = await syncPost(srv.baseUrl, tokens.pg1, {
      since: 0, changes: [{ id: 'pat-w1', wardId: 'ward1', name: 'Patient of pg1', updatedAt: Date.now() + 20 }]
    });
    assert.equal(r.status, 200);
    const pull = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    const p = pull.json.patients.find(x => x.id === 'pat-w1');
    assert.equal(p.unitId, 'unit1');
    assert.equal(p.wardId, 'ward1');
    assert.equal(p.ward, 'Ward One');
  });

  test('sync ward validation: a wardId belonging to a different unit is dropped (unitId still correct)', async () => {
    // ward2 sits under unit2, not unit1 — pg1's patient (pat-w1) is pinned to
    // unit1, so the server must clear the mismatched wardId rather than trust it.
    const r = await syncPost(srv.baseUrl, tokens.pg1, {
      since: 0, changes: [{ id: 'pat-w1', wardId: 'ward2', name: 'Patient of pg1', updatedAt: Date.now() + 25 }]
    });
    assert.equal(r.status, 200);
    const pull = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    const p = pull.json.patients.find(x => x.id === 'pat-w1');
    assert.equal(p.unitId, 'unit1');
    assert.equal('wardId' in p, false);
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

  test('scoped signal: a scope-restricted member is scoped, the instance admin is not', async () => {
    const m = await syncPost(srv.baseUrl, tokens.pg1, { since: 0, changes: [] });
    assert.equal(m.json.scoped, true);
    const a = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [] });
    assert.equal(a.json.scoped, false);
  });

  test('rejected echoes back out-of-scope write ids so the client can evict them', async () => {
    // pat-wx lives in a different org entirely and is never moved by any test,
    // so it is reliably outside pg1's scope.
    const r = await syncPost(srv.baseUrl, tokens.pg1, {
      since: 0, changes: [{ id: 'pat-wx', name: 'HIJACKED', updatedAt: Date.now() + 999999 }]
    });
    assert.equal(r.status, 200); // contract unchanged: no error
    assert.deepEqual(r.json.rejected, ['pat-wx']);
  });

  test('an unassigned member creating a patient gets it rejected (nowhere to pin it)', async () => {
    const r = await syncPost(srv.baseUrl, tokens.lost, {
      since: 0, changes: [{ id: 'pat-ghost', name: 'Ghost', updatedAt: Date.now() }]
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.rejected, ['pat-ghost']);
  });

  test('an in-scope write is never listed in rejected, even a stale last-write-wins loser', async () => {
    // pg1 owns pat-w1; a write with an ancient timestamp is a legitimate
    // in-scope change that simply loses LWW at storage — it is NOT a scope
    // refusal and must not be evicted from the client's cache.
    const r = await syncPost(srv.baseUrl, tokens.pg1, {
      since: 0, changes: [{ id: 'pat-w1', name: 'stale', updatedAt: 1 }]
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.rejected, []);
  });

  test('activeScope narrows an unrestricted admin to one department', async () => {
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [], activeScope: { type: 'department', id: 'dep1' } });
    assert.equal(r.json.scoped, true, 'narrowed admin is now scoped');
    for(const p of r.json.patients){ assert.equal(p.departmentId, 'dep1'); }
    assert.equal(r.json.patients.some(p => p.orgId === 'org2'), false, 'other org excluded');
  });

  test('activeScope cannot widen a member beyond their permission scope', async () => {
    // pg1 is pinned to unit1; pointing activeScope at unit2 (in-org but not theirs)
    // intersects to empty — no escalation, and definitely no cross to unit2.
    const r = await syncPost(srv.baseUrl, tokens.pg1, { since: 0, changes: [], activeScope: { type: 'unit', id: 'unit2' } });
    assert.equal(r.json.patients.some(p => p.unitId === 'unit2'), false);
  });

  test('absent activeScope reproduces the un-narrowed result', async () => {
    const a = await syncPost(srv.baseUrl, tokens.pg1, { since: 0, changes: [] });
    assert.ok(a.json.patients.every(p => p.unitId === 'unit1'));
  });

  test('a department-assigned member moves a patient between the department\'s units and it persists + audits', async () => {
    // dlead is assigned at dep1 (covers unit1 + unit1b). Create a patient in unit1, move to unit1b.
    await syncPost(srv.baseUrl, tokens.dlead, { since: 0, changes: [{ id: 'mv1', name: 'Mover', unitId: 'unit1', updatedAt: Date.now() }] });
    await syncPost(srv.baseUrl, tokens.dlead, { since: 0, changes: [{ id: 'mv1', name: 'Mover', unitId: 'unit1b', updatedAt: Date.now() + 5 }] });
    const pull = await syncPost(srv.baseUrl, tokens.dlead, { since: 0, changes: [] });
    const p = pull.json.patients.find(x => x.id === 'mv1');
    assert.equal(p.unitId, 'unit1b');
    assert.equal(Array.isArray(p.moveHistory), true);
    const last = p.moveHistory[p.moveHistory.length - 1];
    assert.equal(last.to, 'unit1b');
    assert.equal(last.by, 'dlead', 'by is the authenticated actor, server-stamped');
  });

  test('a client cannot forge moveHistory — server discards client-supplied entries', async () => {
    await syncPost(srv.baseUrl, tokens.dlead, {
      since: 0,
      changes: [{ id: 'mv1', name: 'Mover', unitId: 'unit1b', updatedAt: Date.now() + 10,
        moveHistory: [{ from: 'x', to: 'y', by: 'HACKER', at: 1 }] }]
    });
    const pull = await syncPost(srv.baseUrl, tokens.dlead, { since: 0, changes: [] });
    const p = pull.json.patients.find(x => x.id === 'mv1');
    assert.equal(p.moveHistory.some(h => h.by === 'HACKER'), false, 'forged entry rejected');
  });
});

describe('GET /api/me/scope', () => {
  let srv, tokens;
  before(async () => {
    srv = await startServer({
      multiTenant: true,
      seed: async (store) => {
        // org1: hospital h1 -> dep1 (unit1 -> ward1, unit1b), dep2 (unit2 -> ward2)
        await store.createOrganization({ id: 'org1', name: 'Org1', plan: 'free' });
        await store.createHospital({ id: 'h1', orgId: 'org1', name: 'H1' });
        await store.createDepartment({ id: 'dep1', hospitalId: 'h1', name: 'Ortho' });
        await store.createDepartment({ id: 'dep2', hospitalId: 'h1', name: 'Surgery' });
        await store.createUnit({ id: 'unit1', departmentId: 'dep1', name: 'Unit One' });
        await store.createUnit({ id: 'unit1b', departmentId: 'dep1', name: 'Unit One-B' });
        await store.createUnit({ id: 'unit2', departmentId: 'dep2', name: 'Unit Two' });
        await store.createWard({ id: 'ward1', unitId: 'unit1', name: 'Ward One' });
        await store.createWard({ id: 'ward2', unitId: 'unit2', name: 'Ward Two' });
        await seedUser(store, { id: 'u1', username: 'pg1', orgId: 'org1', assignment: { type: 'unit', id: 'unit1' } });
        await seedUser(store, { id: 'u3', username: 'boss1', orgId: 'org1', role: 'admin' });
        await seedUser(store, { id: 'u4', username: 'lost', orgId: 'org1' });
      }
    });
    tokens = {
      pg1: await tok(srv.baseUrl, 'pg1', 'pw-pg1'),
      boss1: await tok(srv.baseUrl, 'boss1', 'pw-boss1'),
      lost: await tok(srv.baseUrl, 'lost', 'pw-lost'),
      root: await tok(srv.baseUrl, 'admin', 'test-admin-pass')
    };
  });
  after(async () => { await srv.stop(); });

  test('the unrestricted instance admin gets the whole instance tree, so its patient-form unit picker is not empty', async () => {
    const res = await fetch(`${srv.baseUrl}/api/me/scope`, { headers: { Authorization: `Bearer ${tokens.root}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.assignment, null);
    // Every department + unit in the instance is offered (this is the fix for
    // the empty add-patient unit selector when logged in as the bootstrap admin).
    assert.deepEqual(body.tree.departments.map(d => d.id).sort(), ['dep1', 'dep2']);
    const dep1 = body.tree.departments.find(d => d.id === 'dep1');
    assert.deepEqual(dep1.units.map(u => u.id).sort(), ['unit1', 'unit1b']);
    const dep2 = body.tree.departments.find(d => d.id === 'dep2');
    assert.deepEqual(dep2.units.map(u => u.id), ['unit2']);
  });

  test('a single-unit member gets exactly their one-unit branch; sibling/out-of-scope units absent', async () => {
    const res = await fetch(`${srv.baseUrl}/api/me/scope`, { headers: { Authorization: `Bearer ${tokens.pg1}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.assignment, { type: 'unit', id: 'unit1' });
    assert.equal(body.tree.departments.length, 1);
    const dep = body.tree.departments[0];
    assert.equal(dep.id, 'dep1');
    // unit1b is a sibling unit under the same department but out of this
    // member's scope (they're pinned to unit1 specifically) — it must not appear.
    assert.deepEqual(dep.units.map(u => u.id), ['unit1']);
    assert.deepEqual(dep.units[0].wards.map(w => w.id), ['ward1']);
    // dep2/unit2/ward2 (a different department entirely) must not appear.
    assert.equal(body.tree.departments.some(d => d.id === 'dep2'), false);
  });

  test('an org admin gets their full org subtree, nested department->unit->ward', async () => {
    const res = await fetch(`${srv.baseUrl}/api/me/scope`, { headers: { Authorization: `Bearer ${tokens.boss1}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.assignment, null);
    const depIds = body.tree.departments.map(d => d.id).sort();
    assert.deepEqual(depIds, ['dep1', 'dep2']);
    const dep1 = body.tree.departments.find(d => d.id === 'dep1');
    assert.deepEqual(dep1.units.map(u => u.id).sort(), ['unit1', 'unit1b']);
    const unit1 = dep1.units.find(u => u.id === 'unit1');
    assert.deepEqual(unit1.wards.map(w => w.id), ['ward1']);
    const unit1b = dep1.units.find(u => u.id === 'unit1b');
    assert.deepEqual(unit1b.wards, []);
    const dep2 = body.tree.departments.find(d => d.id === 'dep2');
    assert.deepEqual(dep2.units.map(u => u.id), ['unit2']);
    assert.deepEqual(dep2.units[0].wards.map(w => w.id), ['ward2']);
  });

  test('an unassigned member gets an empty tree, not an error', async () => {
    const res = await fetch(`${srv.baseUrl}/api/me/scope`, { headers: { Authorization: `Bearer ${tokens.lost}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.tree.departments, []);
  });
});

describe('GET /api/me/scope — flag off', () => {
  let srv;
  before(async () => { srv = await startServer({ multiTenant: false }); });
  after(async () => { await srv.stop(); });

  test('404 when MULTI_TENANT is disabled', async () => {
    const l = await login(srv.baseUrl);
    assert.equal(l.status, 200);
    const res = await fetch(`${srv.baseUrl}/api/me/scope`, { headers: { Authorization: `Bearer ${l.json.token}` } });
    assert.equal(res.status, 404);
  });
});
