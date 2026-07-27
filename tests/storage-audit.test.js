import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';

function sample(overrides = {}){
  return {
    id: overrides.id || 'a1',
    at: overrides.at != null ? overrides.at : 100,
    actorId: 'u1',
    actorUsername: 'pg1',
    action: overrides.action || 'patient.view',
    subjectType: 'patient',
    subjectId: overrides.subjectId || 'p1',
    orgId: overrides.orgId != null ? overrides.orgId : 'org1',
    ip: '1.2.3.4',
    userAgent: 'test-ua',
    detail: overrides.detail != null ? overrides.detail : { x: 1 }
  };
}

async function runAuditSuite(label, makeStore){
  describe(label, () => {
    let store;
    let cleanup;

    before(async () => {
      ({ store, cleanup } = await makeStore());
      await store.init();
    });

    after(async () => {
      await store.close();
      if(cleanup) await cleanup();
    });

    test('appendAudit writes a row listable newest-first', async () => {
      await store.appendAudit(sample({ id: 'a1', at: 100 }));
      await store.appendAudit(sample({ id: 'a2', at: 200, action: 'patient.write', detail: {} }));
      const rows = await store.listAudit({ limit: 10 });
      assert.equal(rows[0].id, 'a2');
      assert.equal(rows[1].id, 'a1');
      assert.deepEqual(rows[0].detail, {});
      assert.deepEqual(rows[1].detail, { x: 1 });
      assert.equal(rows[0].actorUsername, 'pg1');
      assert.equal(rows[0].subjectId, 'p1');
    });

    test('listAudit filters by action, subjectId, actorId, orgId, from, to', async () => {
      await store.appendAudit(sample({ id: 'f1', at: 300, action: 'export', subjectId: 'batch', orgId: 'orgA' }));
      await store.appendAudit(sample({ id: 'f2', at: 400, action: 'import', subjectId: 'batch', orgId: 'orgB' }));
      await store.appendAudit(sample({
        id: 'f3', at: 500, action: 'export', subjectId: 'other', orgId: 'orgA'
      }));

      const byAction = await store.listAudit({ action: 'export' });
      assert.ok(byAction.every(r => r.action === 'export'));
      assert.ok(byAction.some(r => r.id === 'f1'));
      assert.ok(byAction.some(r => r.id === 'f3'));

      const bySubject = await store.listAudit({ subjectId: 'batch' });
      assert.deepEqual(bySubject.map(r => r.id).sort(), ['f1', 'f2']);

      const byOrg = await store.listAudit({ orgId: 'orgA', action: 'export' });
      assert.ok(byOrg.every(r => r.orgId === 'orgA' && r.action === 'export'));

      const byActor = await store.listAudit({ actorId: 'u1', from: 350, to: 450 });
      assert.ok(byActor.some(r => r.id === 'f2'));
      assert.ok(!byActor.some(r => r.id === 'f1'));
      assert.ok(!byActor.some(r => r.id === 'f3'));
    });

    test('store has no updateAudit or deleteAudit', () => {
      assert.equal(typeof store.updateAudit, 'undefined');
      assert.equal(typeof store.deleteAudit, 'undefined');
    });
  });
}

runAuditSuite('SQLite storage — audit', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-audit-'));
  const store = await createStore({ dataDir });
  return {
    store,
    cleanup: async () => { fs.rmSync(dataDir, { recursive: true, force: true }); }
  };
});

const mongoUri = process.env.MONGODB_URI;
if(mongoUri){
  runAuditSuite('Mongo storage — audit', async () => {
    const store = await createStore({ mongoUri });
    return { store, cleanup: async () => {} };
  });
}
