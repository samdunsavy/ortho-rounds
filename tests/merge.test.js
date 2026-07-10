import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeChecklistById, mergePlanHistory, mergePatientRecords, stampAttribution } from '../merge.js';

describe('mergeChecklistById', () => {
  test('keeps the newer item per id', () => {
    const local = [{ id: 'a', status: 'done', updatedAt: 200 }];
    const remote = [{ id: 'a', status: 'pending', updatedAt: 100 }];
    const merged = mergeChecklistById(local, remote);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].status, 'done');
  });

  test('unions items that only exist on one side', () => {
    const local = [{ id: 'a', updatedAt: 1 }];
    const remote = [{ id: 'b', updatedAt: 1 }];
    const merged = mergeChecklistById(local, remote);
    assert.equal(merged.length, 2);
    assert.deepEqual(new Set(merged.map(m => m.id)), new Set(['a', 'b']));
  });

  test('ties prefer local', () => {
    const local = [{ id: 'a', status: 'local-wins', updatedAt: 50 }];
    const remote = [{ id: 'a', status: 'remote', updatedAt: 50 }];
    const merged = mergeChecklistById(local, remote);
    assert.equal(merged[0].status, 'local-wins');
  });
});

describe('mergePlanHistory', () => {
  test('unions by date and sorts ascending', () => {
    const local = [{ date: '2026-07-10', text: 'b' }];
    const remote = [{ date: '2026-07-08', text: 'a' }];
    const merged = mergePlanHistory(local, remote);
    assert.deepEqual(merged.map(m => m.date), ['2026-07-08', '2026-07-10']);
  });

  test('local overwrites remote on the same date', () => {
    const local = [{ date: '2026-07-10', text: 'local' }];
    const remote = [{ date: '2026-07-10', text: 'remote' }];
    const merged = mergePlanHistory(local, remote);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].text, 'local');
  });
});

describe('mergePatientRecords', () => {
  test('returns a copy of remote when local is missing', () => {
    const remote = { id: 'p1', name: 'X' };
    assert.deepEqual(mergePatientRecords(null, remote), remote);
  });

  test('returns a copy of local when remote is missing', () => {
    const local = { id: 'p1', name: 'X' };
    assert.deepEqual(mergePatientRecords(local, null), local);
  });

  test('newer plan wins and carries its own timestamp', () => {
    const local = { id: 'p1', dailyPlan: 'old', planUpdatedAt: 100, updatedAt: 100 };
    const remote = { id: 'p1', dailyPlan: 'new', planUpdatedAt: 200, updatedAt: 200 };
    const merged = mergePatientRecords(local, remote);
    assert.equal(merged.dailyPlan, 'new');
    assert.equal(merged.planUpdatedAt, 200);
  });

  test('newer status wins and carries statusUpdatedBy along with it', () => {
    const local = { id: 'p1', status: 'postop', statusUpdatedAt: 100, statusUpdatedBy: 'ppg', updatedAt: 100 };
    const remote = { id: 'p1', status: 'fordischarge', statusUpdatedAt: 200, statusUpdatedBy: 'chief', updatedAt: 200 };
    const merged = mergePatientRecords(local, remote);
    assert.equal(merged.status, 'fordischarge');
    assert.equal(merged.statusUpdatedBy, 'chief');
  });

  test('merges checklists field-by-field when local is not strictly newer', () => {
    const local = {
      id: 'p1', updatedAt: 100,
      postOpChecks: [{ id: 'c1', status: 'done', updatedAt: 50 }]
    };
    const remote = {
      id: 'p1', updatedAt: 200,
      postOpChecks: [{ id: 'c1', status: 'pending', updatedAt: 150 }, { id: 'c2', status: 'done', updatedAt: 150 }]
    };
    const merged = mergePatientRecords(local, remote);
    const c1 = merged.postOpChecks.find(c => c.id === 'c1');
    const c2 = merged.postOpChecks.find(c => c.id === 'c2');
    assert.equal(c1.status, 'pending'); // remote's c1 is newer than local's
    assert.ok(c2);
  });
});

describe('stampAttribution', () => {
  const actor = { username: 'ppg1' };

  test('stamps doneBy on a newly-completed checklist item (no prior record)', () => {
    const patient = { postOpChecks: [{ id: 'c1', status: 'done' }, { id: 'c2', status: 'pending' }] };
    stampAttribution(patient, null, actor);
    assert.equal(patient.postOpChecks[0].doneBy, 'ppg1');
    assert.equal(patient.postOpChecks[1].doneBy, undefined);
  });

  test('keeps original attribution for an item already done before this request', () => {
    const existing = { postOpChecks: [{ id: 'c1', status: 'done', doneBy: 'original-author' }] };
    const patient = { postOpChecks: [{ id: 'c1', status: 'done', doneBy: 'original-author' }] };
    stampAttribution(patient, existing, actor);
    assert.equal(patient.postOpChecks[0].doneBy, 'original-author');
  });

  test('a client cannot forge doneBy for an item it is completing right now', () => {
    // The item is transitioning from not-done to done in THIS request — the
    // server must attribute it to the authenticated actor, regardless of
    // what the client put in the field.
    const existing = { postOpChecks: [{ id: 'c1', status: 'pending' }] };
    const patient = { postOpChecks: [{ id: 'c1', status: 'done', doneBy: 'forged-name' }] };
    stampAttribution(patient, existing, { username: 'real-user' });
    assert.equal(patient.postOpChecks[0].doneBy, 'real-user');
  });

  test('a client cannot rewrite the attribution of an already-done item', () => {
    const existing = { postOpChecks: [{ id: 'c1', status: 'done', doneBy: 'original-author' }] };
    const patient = { postOpChecks: [{ id: 'c1', status: 'done', doneBy: 'attacker' }] };
    stampAttribution(patient, existing, { username: 'attacker' });
    assert.equal(patient.postOpChecks[0].doneBy, 'original-author');
  });

  test('stamps a newly-appended complication, keeps prior ones untouched', () => {
    const existing = { complications: [{ type: 'DVT', note: '', by: 'original-author' }] };
    const patient = { complications: [
      { type: 'DVT', note: '', by: 'attacker' },
      { type: 'wound gape', note: '', by: 'attacker' }
    ] };
    stampAttribution(patient, existing, actor);
    assert.equal(patient.complications[0].by, 'original-author');
    assert.equal(patient.complications[1].by, 'ppg1');
  });

  test('stamps a new planHistory date, keeps an existing date\'s attribution', () => {
    const existing = { planHistory: [{ date: '2026-07-09', text: 'yesterday', by: 'original-author' }] };
    const patient = { planHistory: [
      { date: '2026-07-09', text: 'yesterday', by: 'attacker' },
      { date: '2026-07-10', text: 'today', by: 'attacker' }
    ] };
    stampAttribution(patient, existing, actor);
    assert.equal(patient.planHistory[0].by, 'original-author');
    assert.equal(patient.planHistory[1].by, 'ppg1');
  });

  test('stamps statusUpdatedBy on a genuine status transition, ignoring the client value', () => {
    const existing = { status: 'postop' };
    const patient = { status: 'fordischarge', statusUpdatedAt: Date.now(), statusUpdatedBy: 'attacker' };
    stampAttribution(patient, existing, actor);
    assert.equal(patient.statusUpdatedBy, 'ppg1');
  });

  test('forces statusUpdatedBy back to the prior value when status did not actually change', () => {
    const existing = { status: 'postop', statusUpdatedBy: 'original-author' };
    const patient = { status: 'postop', statusUpdatedBy: 'attacker' };
    stampAttribution(patient, existing, actor);
    assert.equal(patient.statusUpdatedBy, 'original-author');
  });

  test('is a no-op without an actor', () => {
    const patient = { postOpChecks: [{ id: 'c1', status: 'done' }] };
    stampAttribution(patient, null, null);
    assert.equal(patient.postOpChecks[0].doneBy, undefined);
  });
});
