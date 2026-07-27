import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recordAudit, ACTIONS } from '../audit.js';

describe('recordAudit', () => {
  test('writes a well-formed row via appendAudit', async () => {
    const rows = [];
    const store = {
      async appendAudit(entry){ rows.push(entry); }
    };
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.5, 1.1.1.1', 'user-agent': 'UnitTest/1.0' },
      socket: { remoteAddress: '127.0.0.1' }
    };
    await recordAudit(store, {
      actor: { id: 'u1', username: 'pg1' },
      action: ACTIONS.PATIENT_VIEW,
      subjectType: 'patient',
      subjectId: 'p1',
      orgId: 'org1',
      req,
      detail: { source: 'modal' }
    });
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(typeof row.id, 'string');
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.at, 'number');
    assert.equal(row.actorId, 'u1');
    assert.equal(row.actorUsername, 'pg1');
    assert.equal(row.action, 'patient.view');
    assert.equal(row.subjectType, 'patient');
    assert.equal(row.subjectId, 'p1');
    assert.equal(row.orgId, 'org1');
    assert.equal(row.ip, '10.0.0.5');
    assert.equal(row.userAgent, 'UnitTest/1.0');
    assert.deepEqual(row.detail, { source: 'modal' });
  });

  test('swallows appendAudit failures and does not throw', async () => {
    const store = {
      async appendAudit(){ throw new Error('disk full'); }
    };
    await assert.doesNotReject(() => recordAudit(store, {
      actor: { id: 'u1', username: 'pg1' },
      action: ACTIONS.LOGIN_SUCCESS,
      subjectType: 'session',
      subjectId: 'u1'
    }));
  });

  test('no-ops when action is missing', async () => {
    let called = false;
    const store = { async appendAudit(){ called = true; } };
    await recordAudit(store, { actor: { id: 'u1', username: 'x' } });
    assert.equal(called, false);
  });

  test('ACTIONS vocabulary covers the T1 verbs', () => {
    const expected = [
      'login.success', 'login.failure', 'patient.view', 'patient.write', 'patient.move',
      'export', 'import', 'backup.download', 'password.reset',
      'user.create', 'user.disable', 'user.enable',
      'structure.create', 'structure.update', 'structure.delete', 'structure.move',
      'ai.invoke'
    ];
    assert.deepEqual(Object.values(ACTIONS).sort(), expected.sort());
  });
});
