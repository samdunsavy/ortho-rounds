import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../auth.js';
import { startServer, login, ADMIN_USERNAME, ADMIN_PASSWORD } from './helpers/server-harness.js';

async function authFetch(baseUrl, token, path, opts = {}){
  const headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
  if(opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(baseUrl + path, Object.assign({}, opts, { headers }));
  let json = null;
  const ct = res.headers.get('content-type') || '';
  if(ct.includes('application/json')){
    try{ json = await res.json(); }catch{ json = null; }
  }
  return { status: res.status, json, headers: res.headers };
}

describe('T2 admin audit read (MULTI_TENANT)', () => {
  let srv;

  before(async () => {
    srv = await startServer({
      multiTenant: true,
      seed: async (store) => {
        await store.createOrganization({ id: 'orgA', name: 'OrgA', plan: 'free' });
        await store.createOrganization({ id: 'orgB', name: 'OrgB', plan: 'free' });
        await store.createHospital({ id: 'hA', orgId: 'orgA', name: 'HA' });
        await store.createHospital({ id: 'hB', orgId: 'orgB', name: 'HB' });
        await store.createDepartment({ id: 'depA', hospitalId: 'hA', name: 'OrthoA' });
        await store.createDepartment({ id: 'depB', hospitalId: 'hB', name: 'OrthoB' });
        await store.createUnit({ id: 'unitA', departmentId: 'depA', name: 'UnitA' });
        await store.createUnit({ id: 'unitB', departmentId: 'depB', name: 'UnitB' });
        await store.createUser({
          id: 'adminA', username: 'adminA',
          passwordSalt: 'testsalt', passwordHash: hashPassword('pw-adminA', 'testsalt'),
          role: 'admin', active: true, tokenVersion: 0, createdAt: Date.now(),
          orgId: 'orgA', assignmentType: 'org', assignmentId: 'orgA'
        });
        await store.createUser({
          id: 'adminB', username: 'adminB',
          passwordSalt: 'testsalt', passwordHash: hashPassword('pw-adminB', 'testsalt'),
          role: 'admin', active: true, tokenVersion: 0, createdAt: Date.now(),
          orgId: 'orgB', assignmentType: 'org', assignmentId: 'orgB'
        });
        await store.createUser({
          id: 'pgA', username: 'pgA',
          passwordSalt: 'testsalt', passwordHash: hashPassword('pw-pgA', 'testsalt'),
          role: 'member', active: true, tokenVersion: 0, createdAt: Date.now(),
          orgId: 'orgA', assignmentType: 'unit', assignmentId: 'unitA'
        });
        const now = Date.now();
        await store.upsertPatient('patA', now, 0, JSON.stringify({
          id: 'patA', name: 'A', orgId: 'orgA', unitId: 'unitA', hospitalId: 'hA', departmentId: 'depA'
        }));
        await store.upsertPatient('patB', now, 0, JSON.stringify({
          id: 'patB', name: 'B', orgId: 'orgB', unitId: 'unitB', hospitalId: 'hB', departmentId: 'depB'
        }));
        await store.appendAudit({
          id: 'row-a1', at: 1000, actorId: 'adminA', actorUsername: 'adminA',
          action: 'patient.write', subjectType: 'patient', subjectId: 'patA',
          orgId: 'orgA', ip: null, userAgent: null, detail: {}
        });
        await store.appendAudit({
          id: 'row-b1', at: 2000, actorId: 'adminB', actorUsername: 'adminB',
          action: 'patient.write', subjectType: 'patient', subjectId: 'patB',
          orgId: 'orgB', ip: null, userAgent: null, detail: {}
        });
        await store.appendAudit({
          id: 'row-a2', at: 1500, actorId: 'adminA', actorUsername: 'adminA',
          action: 'patient.view', subjectType: 'patient', subjectId: 'patA',
          orgId: 'orgA', ip: null, userAgent: null, detail: {}
        });
        await store.appendAudit({
          id: 'row-a-export', at: 1600, actorId: 'adminA', actorUsername: 'adminA',
          action: 'export', subjectType: 'export', subjectId: 'patA',
          orgId: 'orgA', ip: null, userAgent: null, detail: {}
        });
      }
    });
  });

  after(async () => {
    if(srv) await srv.stop();
  });

  test('non-admin gets 403 on /api/admin/audit', async () => {
    const tok = (await login(srv.baseUrl, 'pgA', 'pw-pgA')).json.token;
    assert.equal((await authFetch(srv.baseUrl, tok, '/api/admin/audit')).status, 403);
  });

  test('org A admin cannot read org B entries (JSON)', async () => {
    const tok = (await login(srv.baseUrl, 'adminA', 'pw-adminA')).json.token;
    const r = await authFetch(srv.baseUrl, tok, '/api/admin/audit?limit=50');
    assert.equal(r.status, 200);
    assert.ok(r.json.entries.every(e => e.orgId === 'orgA'));
    assert.ok(!r.json.entries.some(e => e.subjectId === 'patB'));
  });

  test('org A admin requesting orgId=orgB gets 403', async () => {
    const tok = (await login(srv.baseUrl, 'adminA', 'pw-adminA')).json.token;
    assert.equal((await authFetch(srv.baseUrl, tok, '/api/admin/audit?orgId=orgB')).status, 403);
  });

  test('filters: action, subjectId, actorId, from, to', async () => {
    const tok = (await login(srv.baseUrl, 'adminA', 'pw-adminA')).json.token;

    const byAction = await authFetch(srv.baseUrl, tok, '/api/admin/audit?action=patient.write&limit=50');
    assert.equal(byAction.status, 200);
    assert.ok(byAction.json.entries.length >= 1);
    assert.ok(byAction.json.entries.every(e => e.action === 'patient.write'));
    assert.ok(byAction.json.entries.some(e => e.id === 'row-a1'));
    assert.ok(!byAction.json.entries.some(e => e.id === 'row-a2'));

    const bySubject = await authFetch(srv.baseUrl, tok, '/api/admin/audit?subjectId=patA&limit=50');
    assert.equal(bySubject.status, 200);
    assert.ok(bySubject.json.entries.every(e => e.subjectId === 'patA'));
    assert.ok(bySubject.json.entries.some(e => e.id === 'row-a1'));
    assert.ok(bySubject.json.entries.some(e => e.id === 'row-a2'));

    const byActor = await authFetch(srv.baseUrl, tok, '/api/admin/audit?actorId=adminA&limit=50');
    assert.equal(byActor.status, 200);
    assert.ok(byActor.json.entries.every(e => e.actorId === 'adminA'));
    assert.ok(byActor.json.entries.some(e => e.id === 'row-a1'));

    const byFrom = await authFetch(srv.baseUrl, tok, '/api/admin/audit?from=1400&to=1600&limit=50');
    assert.equal(byFrom.status, 200);
    assert.ok(byFrom.json.entries.every(e => e.at >= 1400 && e.at <= 1600));
    assert.ok(byFrom.json.entries.some(e => e.id === 'row-a2'));
    assert.ok(!byFrom.json.entries.some(e => e.id === 'row-a1'));
  });

  test('pagination limit/offset', async () => {
    const tok = (await login(srv.baseUrl, 'adminA', 'pw-adminA')).json.token;
    const page1 = await authFetch(srv.baseUrl, tok, '/api/admin/audit?limit=1&offset=0');
    const page2 = await authFetch(srv.baseUrl, tok, '/api/admin/audit?limit=1&offset=1');
    assert.equal(page1.status, 200);
    assert.equal(page2.status, 200);
    assert.equal(page1.json.entries.length, 1);
    assert.equal(page2.json.entries.length, 1);
    assert.equal(page1.json.limit, 1);
    assert.equal(page1.json.offset, 0);
    assert.equal(page2.json.offset, 1);
    assert.notEqual(page1.json.entries[0].id, page2.json.entries[0].id);
  });

  test('CSV is org-clamped and includes header', async () => {
    const tok = (await login(srv.baseUrl, 'adminA', 'pw-adminA')).json.token;
    const res = await fetch(srv.baseUrl + '/api/admin/audit.csv', {
      headers: { Authorization: 'Bearer ' + tok }
    });
    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type') || '';
    assert.ok(ct.includes('text/csv'));
    const text = await res.text();
    assert.ok(text.startsWith('id,at,actorId,'));
    assert.ok(text.includes('patA'));
    assert.ok(!text.includes('patB'));
  });

  test('member can read own patient audit allowlist only', async () => {
    const tok = (await login(srv.baseUrl, 'pgA', 'pw-pgA')).json.token;
    const r = await authFetch(srv.baseUrl, tok, '/api/patients/patA/audit?limit=50');
    assert.equal(r.status, 200);
    assert.ok(r.json.entries.length >= 1);
    assert.ok(r.json.entries.every(e =>
      ['patient.view', 'patient.write', 'patient.move', 'ai.invoke'].includes(e.action)
    ));
    assert.ok(r.json.entries.some(e => e.id === 'row-a1'));
    assert.ok(r.json.entries.some(e => e.id === 'row-a2'));
    assert.ok(!r.json.entries.some(e => e.id === 'row-a-export'));
  });

  test('member cannot read other org patient audit', async () => {
    const tok = (await login(srv.baseUrl, 'pgA', 'pw-pgA')).json.token;
    assert.equal((await authFetch(srv.baseUrl, tok, '/api/patients/patB/audit')).status, 403);
  });

  test('missing patient is 404', async () => {
    const tok = (await login(srv.baseUrl, 'pgA', 'pw-pgA')).json.token;
    assert.equal((await authFetch(srv.baseUrl, tok, '/api/patients/no-such/audit')).status, 404);
  });
});

describe('T2 admin audit read (flag off)', () => {
  let srv;

  before(async () => {
    srv = await startServer({
      multiTenant: false,
      seed: async (store) => {
        await store.appendAudit({
          id: 'row-off-1', at: 1000, actorId: 'u1', actorUsername: 'admin',
          action: 'patient.write', subjectType: 'patient', subjectId: 'patX',
          orgId: 'orgX', ip: null, userAgent: null, detail: {}
        });
        await store.appendAudit({
          id: 'row-off-2', at: 2000, actorId: 'u2', actorUsername: 'other',
          action: 'patient.view', subjectType: 'patient', subjectId: 'patY',
          orgId: 'orgY', ip: null, userAgent: null, detail: {}
        });
      }
    });
  });

  after(async () => {
    if(srv) await srv.stop();
  });

  test('admin can list without org clamp', async () => {
    const tok = (await login(srv.baseUrl, ADMIN_USERNAME, ADMIN_PASSWORD)).json.token;
    const r = await authFetch(srv.baseUrl, tok, '/api/admin/audit?limit=50');
    assert.equal(r.status, 200);
    const ids = r.json.entries.map(e => e.id);
    assert.ok(ids.includes('row-off-1'));
    assert.ok(ids.includes('row-off-2'));
    assert.ok(r.json.entries.some(e => e.orgId === 'orgX'));
    assert.ok(r.json.entries.some(e => e.orgId === 'orgY'));
  });
});
