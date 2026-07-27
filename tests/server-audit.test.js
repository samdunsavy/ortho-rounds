import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../storage.js';
import { hashPassword } from '../auth.js';
import { startServer, login, syncPost, ADMIN_USERNAME, ADMIN_PASSWORD } from './helpers/server-harness.js';

async function authFetch(baseUrl, token, path, opts = {}){
  const headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
  if(opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(baseUrl + path, Object.assign({}, opts, { headers }));
  let json = null;
  const ct = res.headers.get('content-type') || '';
  if(ct.includes('application/json')){
    try{ json = await res.json(); }catch{ json = null; }
  }
  return { status: res.status, json };
}

describe('T1 audit write path (flag off)', () => {
  let srv, token, rows, adminId;
  const prevOpenAi = process.env.OPENAI_API_KEY;

  before(async () => {
    process.env.OPENAI_API_KEY = prevOpenAi || 'sk-test-audit-only';
    srv = await startServer({ multiTenant: false });
    const loginOk = await login(srv.baseUrl, ADMIN_USERNAME, ADMIN_PASSWORD);
    assert.equal(loginOk.status, 200);
    token = loginOk.json.token;

    // login.failure
    await login(srv.baseUrl, ADMIN_USERNAME, 'wrong-password');

    // patient.write
    const sync = await syncPost(srv.baseUrl, token, {
      since: 0,
      changes: [{ id: 'pat-audit-1', name: 'Audit Patient', updatedAt: Date.now() }]
    });
    assert.equal(sync.status, 200);

    // patient.view
    const view = await authFetch(srv.baseUrl, token, '/api/audit/patient-view', {
      method: 'POST', body: JSON.stringify({ patientId: 'pat-audit-1' })
    });
    assert.equal(view.status, 200);

    // user.create / disable / enable / password.reset
    const created = await authFetch(srv.baseUrl, token, '/api/admin/users', {
      method: 'POST', body: JSON.stringify({ username: 'auditmember', password: 'temp-pass-1' })
    });
    assert.equal(created.status, 200);
    const memberId = created.json.id;
    assert.equal((await authFetch(srv.baseUrl, token, `/api/admin/users/${memberId}/disable`, { method: 'POST' })).status, 200);
    assert.equal((await authFetch(srv.baseUrl, token, `/api/admin/users/${memberId}/enable`, { method: 'POST' })).status, 200);
    assert.equal((await authFetch(srv.baseUrl, token, `/api/admin/users/${memberId}/reset-password`, { method: 'POST' })).status, 200);

    // export + backup
    assert.equal((await authFetch(srv.baseUrl, token, '/api/export')).status, 200);
    assert.equal((await authFetch(srv.baseUrl, token, '/api/backup')).status, 200);

    // import
    const imp = await authFetch(srv.baseUrl, token, '/api/import', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'merge',
        patients: [{ id: 'pat-imported', name: 'Imported', updatedAt: Date.now() }]
      })
    });
    assert.equal(imp.status, 200);

    // ai.invoke (may 502 after audit if the key is fake — that is fine)
    await authFetch(srv.baseUrl, token, '/api/ai/draft-plan', {
      method: 'POST',
      body: JSON.stringify({ patient: { id: 'pat-audit-1', name: 'Audit Patient', diagnosis: 'fx' } })
    });

    const dataDir = srv.dataDir;
    await srv.stop({ keepData: true });
    const store = await createStore({ dataDir });
    await store.init();
    try{
      rows = await store.listAudit({ limit: 1000 });
      const admin = await store.getUserByUsername(ADMIN_USERNAME);
      adminId = admin.id;
    }finally{
      await store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  after(() => {
    if(prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAi;
  });

  function find(action){
    return rows.filter(r => r.action === action);
  }

  test('login.success lands with actor', () => {
    const hit = find('login.success').find(r => r.actorUsername === ADMIN_USERNAME);
    assert.ok(hit, 'login.success row missing');
    assert.equal(hit.actorId, adminId);
    assert.equal(hit.subjectType, 'session');
  });

  test('login.failure lands with attempted username', () => {
    const hit = find('login.failure').find(r => r.actorUsername === ADMIN_USERNAME);
    assert.ok(hit, 'login.failure row missing');
    assert.equal(hit.detail.reason, 'invalid_credentials');
  });

  test('patient.write lands with subject', () => {
    const hit = find('patient.write').find(r => r.subjectId === 'pat-audit-1');
    assert.ok(hit, 'patient.write row missing');
    assert.equal(hit.actorId, adminId);
    assert.equal(hit.subjectType, 'patient');
  });

  test('patient.view lands with subject', () => {
    const hit = find('patient.view').find(r => r.subjectId === 'pat-audit-1');
    assert.ok(hit, 'patient.view row missing');
    assert.equal(hit.actorId, adminId);
  });

  test('user.create / disable / enable / password.reset land', () => {
    assert.ok(find('user.create').some(r => r.detail && r.detail.username === 'auditmember'));
    assert.ok(find('user.disable').length >= 1);
    assert.ok(find('user.enable').length >= 1);
    assert.ok(find('password.reset').length >= 1);
  });

  test('export and backup.download land', () => {
    assert.ok(find('export').some(r => r.detail && r.detail.kind === 'json'));
    assert.ok(find('backup.download').length >= 1);
  });

  test('import lands with count', () => {
    const hit = find('import')[0];
    assert.ok(hit);
    assert.equal(hit.detail.count, 1);
  });

  test('ai.invoke lands with endpoint', () => {
    const hit = find('ai.invoke').find(r => r.detail && r.detail.endpoint === 'draft-plan');
    assert.ok(hit, 'ai.invoke row missing');
    assert.equal(hit.subjectId, 'pat-audit-1');
  });
});

describe('T1 audit write path — patient.move + structure (MULTI_TENANT)', () => {
  let srv, token, rows;

  before(async () => {
    srv = await startServer({
      multiTenant: true,
      seed: async (store) => {
        await store.createOrganization({ id: 'org1', name: 'Org1', plan: 'free' });
        await store.createHospital({ id: 'h1', orgId: 'org1', name: 'H1' });
        await store.createDepartment({ id: 'dep1', hospitalId: 'h1', name: 'Ortho' });
        await store.createUnit({ id: 'unit1', departmentId: 'dep1', name: 'Unit One' });
        await store.createUnit({ id: 'unit2', departmentId: 'dep1', name: 'Unit Two' });
        await store.createUser({
          id: 'u-dlead', username: 'dlead',
          passwordSalt: 'testsalt', passwordHash: hashPassword('pw-dlead', 'testsalt'),
          role: 'member', active: true, tokenVersion: 0, createdAt: Date.now(),
          orgId: 'org1', assignmentType: 'department', assignmentId: 'dep1'
        });
      }
    });
    const rootLogin = await login(srv.baseUrl, ADMIN_USERNAME, ADMIN_PASSWORD);
    assert.equal(rootLogin.status, 200);
    const rootTok = rootLogin.json.token;

    // structure.create via hospital create under org1 (instance admin)
    const hosp = await authFetch(srv.baseUrl, rootTok, '/api/admin/hospitals', {
      method: 'POST', body: JSON.stringify({ orgId: 'org1', name: 'Audit Hospital' })
    });
    assert.equal(hosp.status, 200);

    const dleadLogin = await login(srv.baseUrl, 'dlead', 'pw-dlead');
    assert.equal(dleadLogin.status, 200);
    token = dleadLogin.json.token;

    // create patient in unit1 then move to unit2
    const created = await syncPost(srv.baseUrl, token, {
      since: 0,
      changes: [{ id: 'pat-move-1', name: 'Mover', updatedAt: Date.now(), unitId: 'unit1' }]
    });
    assert.equal(created.status, 200);
    const moved = await syncPost(srv.baseUrl, token, {
      since: 0,
      changes: [{ id: 'pat-move-1', name: 'Mover', updatedAt: Date.now() + 1, unitId: 'unit2' }]
    });
    assert.equal(moved.status, 200);

    const dataDir = srv.dataDir;
    await srv.stop({ keepData: true });
    const store = await createStore({ dataDir });
    await store.init();
    try{
      rows = await store.listAudit({ limit: 1000 });
    }finally{
      await store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('patient.move lands with from/to', () => {
    const hit = rows.find(r => r.action === 'patient.move' && r.subjectId === 'pat-move-1');
    assert.ok(hit, 'patient.move row missing');
    assert.equal(hit.detail.from, 'unit1');
    assert.equal(hit.detail.to, 'unit2');
    assert.equal(hit.orgId, 'org1');
  });

  test('structure.create lands for hospital', () => {
    const hit = rows.find(r => r.action === 'structure.create' && r.subjectType === 'hospital');
    assert.ok(hit, 'structure.create row missing');
    assert.equal(hit.detail.name, 'Audit Hospital');
    assert.equal(hit.orgId, 'org1');
  });
});

describe('T1 audit patient-view — cross-tenant isolation', () => {
  let dataDir, viewsOfB, viewsOfA;

  before(async () => {
    const srv = await startServer({
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
          id: 'uA', username: 'pgA',
          passwordSalt: 'testsalt', passwordHash: hashPassword('pw-pgA', 'testsalt'),
          role: 'member', active: true, tokenVersion: 0, createdAt: Date.now(),
          orgId: 'orgA', assignmentType: 'unit', assignmentId: 'unitA'
        });
        await store.createUser({
          id: 'uB', username: 'pgB',
          passwordSalt: 'testsalt', passwordHash: hashPassword('pw-pgB', 'testsalt'),
          role: 'member', active: true, tokenVersion: 0, createdAt: Date.now(),
          orgId: 'orgB', assignmentType: 'unit', assignmentId: 'unitB'
        });
      }
    });
    dataDir = srv.dataDir;

    const tokB = (await login(srv.baseUrl, 'pgB', 'pw-pgB')).json.token;
    assert.equal((await syncPost(srv.baseUrl, tokB, {
      since: 0,
      changes: [{ id: 'pat-b-only', name: 'Secret B', updatedAt: Date.now() }]
    })).status, 200);

    const tokA = (await login(srv.baseUrl, 'pgA', 'pw-pgA')).json.token;
    const probe = await authFetch(srv.baseUrl, tokA, '/api/audit/patient-view', {
      method: 'POST', body: JSON.stringify({ patientId: 'pat-b-only' })
    });
    assert.equal(probe.status, 403);

    assert.equal((await syncPost(srv.baseUrl, tokA, {
      since: 0,
      changes: [{ id: 'pat-a-only', name: 'A Patient', updatedAt: Date.now() }]
    })).status, 200);
    assert.equal((await authFetch(srv.baseUrl, tokA, '/api/audit/patient-view', {
      method: 'POST', body: JSON.stringify({ patientId: 'pat-a-only' })
    })).status, 200);

    await srv.stop({ keepData: true });
    const store = await createStore({ dataDir });
    await store.init();
    try{
      viewsOfB = await store.listAudit({ action: 'patient.view', subjectId: 'pat-b-only' });
      viewsOfA = await store.listAudit({ action: 'patient.view', subjectId: 'pat-a-only' });
    }finally{
      await store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('org A cannot view org B patient; no audit row is written for the probe', () => {
    assert.equal(viewsOfB.length, 0, 'cross-tenant probe must not create a patient.view row');
  });

  test('own-org patient.view still audits', () => {
    assert.equal(viewsOfA.length, 1);
    assert.equal(viewsOfA[0].actorUsername, 'pgA');
  });
});
