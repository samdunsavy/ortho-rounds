import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, syncPost } from './helpers/server-harness.js';
import { createStore } from '../storage.js';

/* Golden-response regression guard for the flag-OFF sync contract.
   Any accidental behavior drift in the /api/sync handler while wiring
   MULTI_TENANT scoping must fail here. */
describe('flag OFF — /api/sync golden response', () => {
  let srv, token;
  before(async () => {
    srv = await startServer({ multiTenant: false });
    const l = await login(srv.baseUrl);
    assert.equal(l.status, 200);
    token = l.json.token;
  });
  after(async () => { await srv.stop(); });

  test('push + pull round-trips a patient with the exact contract shape', async () => {
    const patient = {
      id: 'golden-p1', name: 'Golden Patient', diagnosis: 'Right femur shaft fracture',
      status: 'postop', unit: 'ortho unit - IV', ward: 'W-3', updatedAt: Date.now()
    };
    const push = await syncPost(srv.baseUrl, token, { since: 0, changes: [patient] });
    assert.equal(push.status, 200);
    assert.deepEqual(Object.keys(push.json).sort(), ['apiVersion', 'patients', 'serverTime']);
    assert.equal(push.json.apiVersion, 1);
    assert.equal(typeof push.json.serverTime, 'number');

    const pull = await syncPost(srv.baseUrl, token, { since: 0, changes: [] });
    assert.equal(pull.status, 200);
    const got = pull.json.patients.find(p => p.id === 'golden-p1');
    assert.ok(got, 'pushed patient must come back');
    assert.equal(got.name, 'Golden Patient');
    assert.equal(got.diagnosis, 'Right femur shaft fracture');
    assert.equal(got.unit, 'ortho unit - IV');
    assert.equal(got.ward, 'W-3');
    assert.equal(got.deleted, false);
    assert.equal(typeof got.updatedAt, 'number');
    // No scoping field is invented flag-off: the server must not add wardId.
    assert.equal('wardId' in got, false);

    // Byte-identical stored JSON: read the raw row straight off disk (not the
    // rehydrated /api/sync response, which always adds `id`/`deleted`) and
    // confirm the server stamped in no ancestry keys at all flag-off. The
    // only field the server is allowed to touch is `updatedAt` (server time).
    const store2 = await createStore({ dataDir: srv.dataDir });
    await store2.init();
    let storedObj;
    try{
      const raw = await store2.getPatientRaw('golden-p1');
      assert.ok(raw, 'patient must be persisted');
      storedObj = JSON.parse(raw.data);
    } finally { await store2.close(); }
    const { updatedAt: _omitStored, ...storedRest } = storedObj;
    const { updatedAt: _omitPushed, ...pushedRest } = patient;
    assert.deepEqual(storedRest, pushedRest, 'stored JSON must be byte-identical to what was pushed (aside from server-stamped updatedAt)');
    for(const field of ['unitId', 'wardId', 'departmentId', 'hospitalId', 'orgId']){
      assert.equal(field in storedObj, false, `${field} must not be added to stored JSON flag-off`);
    }
  });

  test('admin pull still includes the pushed patient (flat instance)', async () => {
    const pull = await syncPost(srv.baseUrl, token, { since: 0, changes: [] });
    assert.ok(pull.json.patients.some(p => p.id === 'golden-p1'));
  });
});

/* Flag-OFF guard for the Deep Hierarchy routes added in Tasks 6/8: with
   MULTI_TENANT unset, the new admin/scope endpoints must not exist at all.
   This locks the flag-gating in place as a golden assertion alongside the
   sync contract above — any regression that makes these routes reachable
   with the flag off is a real multi-tenant data leak, not a nit. */
describe('flag OFF — new hierarchy routes do not exist', () => {
  let srv, token;
  before(async () => {
    srv = await startServer({ multiTenant: false });
    const l = await login(srv.baseUrl);
    assert.equal(l.status, 200);
    token = l.json.token;
  });
  after(async () => { await srv.stop(); });

  test('POST /api/admin/wards is 404', async () => {
    const res = await fetch(`${srv.baseUrl}/api/admin/wards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ departmentId: 'd1', name: 'Ward X' })
    });
    assert.equal(res.status, 404);
  });

  test('POST /api/admin/units is 404', async () => {
    const res = await fetch(`${srv.baseUrl}/api/admin/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ wardId: 'w1', name: 'Unit X' })
    });
    assert.equal(res.status, 404);
  });

  test('GET /api/me/scope is 404', async () => {
    const res = await fetch(`${srv.baseUrl}/api/me/scope`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(res.status, 404);
  });
});
