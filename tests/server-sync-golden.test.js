import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, syncPost } from './helpers/server-harness.js';

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
  });

  test('every user sees every patient (flat instance)', async () => {
    const pull = await syncPost(srv.baseUrl, token, { since: 0, changes: [] });
    assert.ok(pull.json.patients.some(p => p.id === 'golden-p1'));
  });
});
