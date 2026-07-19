import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

/* This app is offline-first: each device keeps its own local cache and
   reconciles with the server on sync. These are the functions that decide
   what happens when the SAME patient record was edited on two devices (or
   a phone went offline mid-round and reconnects hours later) -- which
   fields win, which get merged item-by-item, and when the user is asked
   to pick a winner instead of silently merging. A bug here doesn't show up
   as a visual glitch; it shows up as a lost checklist tick or an overwritten
   plan, discovered days later. Zero coverage existed before this file,
   despite this being flagged in POLISH.md as the top remaining candidate
   after milestones.js.

   All functions under test are pure (no DOM, no network) -- they're loaded
   via the same jsdom harness as other frontend tests only because app.js
   is one script or app.js.

   Where "today" matters (mergePresentedToday), we ask the loaded app for
   its own todayISO() rather than reimplementing date math in the test --
   avoids the exact local-vs-UTC pitfall documented in
   frontend-milestones.test.js. */

describe('parseWardMetaFromRecord — reading a ward-meta record off the wire/cache', () => {
  test('missing record returns safe defaults, not null/throw', () => {
    const { window } = loadFrontendEnv();
    const parsed = window.parseWardMetaFromRecord(null);
    assert.equal(parsed.handoverNote, '');
    assert.equal(parsed.defaultUnit, '');
    assert.deepEqual([...parsed.defaultOtDoctors], ['DR MAHESH', 'DR BALAKRISHNA', 'DR JACOB', 'DR DEEPAK']);
    assert.deepEqual([...parsed.pgRoster], []);
    assert.equal(parsed.updatedAt, 0);
  });

  test('an empty/missing defaultOtDoctors list falls back to the default roster', () => {
    const { window } = loadFrontendEnv();
    const parsed = window.parseWardMetaFromRecord({ defaultOtDoctors: [] });
    assert.deepEqual([...parsed.defaultOtDoctors], ['DR MAHESH', 'DR BALAKRISHNA', 'DR JACOB', 'DR DEEPAK']);
  });

  test('a real custom doctor list is kept as-is, trimmed and filtered', () => {
    const { window } = loadFrontendEnv();
    const parsed = window.parseWardMetaFromRecord({ defaultOtDoctors: [' DR X ', '', 'DR Y'] });
    assert.deepEqual([...parsed.defaultOtDoctors], ['DR X', 'DR Y']);
  });
});

describe('mergePresentedToday — "presented in rounds today" ids, merged across devices', () => {
  test('union of ids from both sides when both are dated today', () => {
    const { window } = loadFrontendEnv();
    const today = window.todayISO();
    const a = { date: today, ids: ['p1', 'p2'] };
    const b = { date: today, ids: ['p2', 'p3'] };
    const merged = window.mergePresentedToday(a, b);
    assert.equal(merged.date, today);
    assert.deepEqual([...merged.ids].sort(), ['p1', 'p2', 'p3']);
  });

  test('a stale (not-today) side is treated as empty, not merged in', () => {
    const { window } = loadFrontendEnv();
    const today = window.todayISO();
    const stale = { date: '2000-01-01', ids: ['old1', 'old2'] };
    const fresh = { date: today, ids: ['p1'] };
    const merged = window.mergePresentedToday(stale, fresh);
    assert.deepEqual([...merged.ids], ['p1']);
  });

  test('both sides missing/null yields today with no ids', () => {
    const { window } = loadFrontendEnv();
    const merged = window.mergePresentedToday(null, undefined);
    assert.equal(merged.date, window.todayISO());
    assert.deepEqual([...merged.ids], []);
  });
});

describe('mergeWardMetaFields — ward-level settings merge (handover note, OT doctors, roster)', () => {
  test('the side with the newer updatedAt is the base; its own non-empty fields win outright', () => {
    const { window } = loadFrontendEnv();
    const local = { handoverNote: 'local note', defaultUnit: 'Unit A', defaultOtDoctors: ['DR A'], pgRoster: ['PG1'], updatedAt: 200 };
    const remote = { handoverNote: 'remote note', defaultUnit: 'Unit B', defaultOtDoctors: ['DR B'], pgRoster: ['PG2'], updatedAt: 100 };
    const merged = window.mergeWardMetaFields(local, remote);
    assert.equal(merged.handoverNote, 'local note', 'local is newer, so local wins');
    assert.equal(merged.defaultUnit, 'Unit A');
    assert.deepEqual([...merged.defaultOtDoctors], ['DR A']);
    assert.deepEqual([...merged.pgRoster], ['PG1']);
    assert.equal(merged.updatedAt, 200, 'updatedAt is the max of both sides');
  });

  test('a tie in updatedAt favors local (>= comparison), matching mergePatientRecords\' tie rule', () => {
    const { window } = loadFrontendEnv();
    const local = { handoverNote: 'local note', updatedAt: 100 };
    const remote = { handoverNote: 'remote note', updatedAt: 100 };
    const merged = window.mergeWardMetaFields(local, remote);
    assert.equal(merged.handoverNote, 'local note');
  });

  test('an empty field on the newer side falls back to the older side\'s value, instead of blanking it out', () => {
    const { window } = loadFrontendEnv();
    const local = { handoverNote: '', defaultUnit: '', defaultOtDoctors: [], pgRoster: [], updatedAt: 200 };
    const remote = { handoverNote: 'still here', defaultUnit: 'Unit B', defaultOtDoctors: ['DR B'], pgRoster: ['PG2'], updatedAt: 100 };
    const merged = window.mergeWardMetaFields(local, remote);
    assert.equal(merged.handoverNote, 'still here', 'newer side left it blank, so the older value should survive, not vanish');
    assert.equal(merged.defaultUnit, 'Unit B');
    assert.deepEqual([...merged.defaultOtDoctors], ['DR B']);
    assert.deepEqual([...merged.pgRoster], ['PG2']);
  });

  test('when both sides have no OT doctor list at all, falls back to the hardcoded default roster', () => {
    const { window } = loadFrontendEnv();
    const local = { defaultOtDoctors: [], updatedAt: 200 };
    const remote = { defaultOtDoctors: [], updatedAt: 100 };
    const merged = window.mergeWardMetaFields(local, remote);
    assert.deepEqual([...merged.defaultOtDoctors], ['DR MAHESH', 'DR BALAKRISHNA', 'DR JACOB', 'DR DEEPAK']);
  });
});

describe('mergeChecklistById — per-item checklist merge (post-op checks, discharge checks)', () => {
  test('an item present on only one side is kept as-is', () => {
    const { window } = loadFrontendEnv();
    const merged = window.mergeChecklistById(
      [{ id: 'c1', status: 'done', updatedAt: 10 }],
      [{ id: 'c2', status: 'pending', updatedAt: 5 }]
    );
    const byId = Object.fromEntries([...merged].map(c => [c.id, c]));
    assert.equal(byId.c1.status, 'done');
    assert.equal(byId.c2.status, 'pending');
  });

  test('when both sides have the same item id, the strictly newer updatedAt wins', () => {
    const { window } = loadFrontendEnv();
    const merged = window.mergeChecklistById(
      [{ id: 'c1', status: 'done', updatedAt: 20 }],
      [{ id: 'c1', status: 'pending', updatedAt: 10 }]
    );
    assert.equal([...merged][0].status, 'done', 'local (updatedAt 20) is newer than remote (10)');
  });

  test('a tie in updatedAt favors local (>= comparison)', () => {
    const { window } = loadFrontendEnv();
    const merged = window.mergeChecklistById(
      [{ id: 'c1', status: 'local-value', updatedAt: 10 }],
      [{ id: 'c1', status: 'remote-value', updatedAt: 10 }]
    );
    assert.equal([...merged][0].status, 'local-value');
  });

  test('remote wins when it is strictly newer', () => {
    const { window } = loadFrontendEnv();
    const merged = window.mergeChecklistById(
      [{ id: 'c1', status: 'stale-local', updatedAt: 5 }],
      [{ id: 'c1', status: 'fresh-remote', updatedAt: 50 }]
    );
    assert.equal([...merged][0].status, 'fresh-remote');
  });

  test('missing/malformed lists are treated as empty, not throwing', () => {
    const { window } = loadFrontendEnv();
    assert.deepEqual([...window.mergeChecklistById(null, undefined)], []);
    assert.deepEqual([...window.mergeChecklistById([{ noId: true }], [])], []);
  });
});

describe('mergePlanHistory / mergeLabsHistory — date-keyed history merge', () => {
  test('entries on different dates from both sides are all kept, sorted ascending by date', () => {
    const { window } = loadFrontendEnv();
    const merged = window.mergePlanHistory(
      [{ date: '2026-01-03', text: 'local c' }],
      [{ date: '2026-01-01', text: 'remote a' }, { date: '2026-01-02', text: 'remote b' }]
    );
    assert.deepEqual([...merged].map(h => h.date), ['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  test('same-date entry on both sides: local always wins, regardless of any timestamp', () => {
    const { window } = loadFrontendEnv();
    // Unlike mergeChecklistById, plan/labs history has no per-entry updatedAt
    // to compare -- the merge order itself (remote inserted first, local
    // inserted second into the same Map key) is the tie-break rule, and it's
    // unconditional. Worth pinning down explicitly since it's easy to
    // assume this behaves like the timestamp-based merges elsewhere.
    const merged = window.mergePlanHistory(
      [{ date: '2026-01-01', text: 'local wins' }],
      [{ date: '2026-01-01', text: 'remote loses' }]
    );
    assert.equal([...merged][0].text, 'local wins');
  });

  test('plan history is capped to the most recent 14 entries after merge', () => {
    const { window } = loadFrontendEnv();
    const local = Array.from({ length: 10 }, (_, i) => ({ date: `2026-02-${String(i + 1).padStart(2, '0')}`, text: `d${i + 1}` }));
    const remote = Array.from({ length: 10 }, (_, i) => ({ date: `2026-02-${String(i + 11).padStart(2, '0')}`, text: `d${i + 11}` }));
    const merged = window.mergePlanHistory(local, remote);
    assert.equal([...merged].length, 14, 'PLAN_HISTORY_MAX is 14');
    assert.equal([...merged][0].date, '2026-02-07', 'oldest entries beyond the cap are dropped, newest kept');
    assert.equal([...merged][13].date, '2026-02-20');
  });

  test('labs history is capped to the most recent 60 entries after merge', () => {
    const { window } = loadFrontendEnv();
    const local = Array.from({ length: 40 }, (_, i) => ({ date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}-a${i}` }));
    // Use distinct sortable-but-unique date-like keys so all 40+40 entries are distinct map keys.
    const remote = Array.from({ length: 40 }, (_, i) => ({ date: `2026-02-${String((i % 28) + 1).padStart(2, '0')}-b${i}` }));
    const merged = window.mergeLabsHistory(local, remote);
    assert.equal([...merged].length, 60, 'LABS_HISTORY_MAX is 60');
  });
});

describe('mergePatientRecords — the top-level per-patient sync merge', () => {
  test('one side missing just returns a copy of the other, no merge logic invoked', () => {
    const { window } = loadFrontendEnv();
    const remote = { id: 'p1', updatedAt: 5 };
    // Spread into a plain Node-realm object before comparing: the merge
    // functions run inside the jsdom window, so their return values are
    // instances of *that* window's Object, not this test file's -- same
    // cross-realm reference-equality gotcha as the arrays elsewhere in this
    // suite and in frontend-milestones.test.js.
    assert.deepEqual({ ...window.mergePatientRecords(null, remote) }, { ...remote });
    const local = { id: 'p1', updatedAt: 5 };
    assert.deepEqual({ ...window.mergePatientRecords(local, null) }, { ...local });
  });

  test('when local is the newer overall snapshot, its full checklists win outright (so deletions persist)', () => {
    const { window } = loadFrontendEnv();
    const local = {
      id: 'p1', updatedAt: 200,
      postOpChecks: [{ id: 'c1', status: 'done', updatedAt: 200 }]
    };
    const remote = {
      id: 'p1', updatedAt: 100,
      postOpChecks: [{ id: 'c1', status: 'done', updatedAt: 100 }, { id: 'c2', status: 'pending', updatedAt: 100 }]
    };
    const merged = window.mergePatientRecords(local, remote);
    assert.equal(merged.postOpChecks.length, 1, 'c2 was deleted locally after remote was last seen -- the deletion must stick, not resurrect c2');
  });

  test('when remote is the strictly newer overall snapshot, checklists merge per-item instead', () => {
    const { window } = loadFrontendEnv();
    const local = {
      id: 'p1', updatedAt: 100,
      postOpChecks: [{ id: 'c1', status: 'local-done', updatedAt: 100 }]
    };
    const remote = {
      id: 'p1', updatedAt: 200,
      postOpChecks: [{ id: 'c1', status: 'local-done', updatedAt: 100 }, { id: 'c2', status: 'remote-added', updatedAt: 200 }]
    };
    const merged = window.mergePatientRecords(local, remote);
    const byId = Object.fromEntries(merged.postOpChecks.map(c => [c.id, c]));
    assert.equal(byId.c1.status, 'local-done', 'c1 unchanged either way since same updatedAt (tie favors local)');
    assert.equal(byId.c2.status, 'remote-added', 'c2 only existed remotely, must not be lost');
  });

  test('dailyPlan and status are resolved independently by their own *_updatedAt fields, not the record-level updatedAt', () => {
    const { window } = loadFrontendEnv();
    const local = {
      id: 'p1', updatedAt: 100,
      dailyPlan: 'local plan', planUpdatedAt: 50,
      status: 'local-status', statusUpdatedAt: 999
    };
    const remote = {
      id: 'p1', updatedAt: 200,
      dailyPlan: 'remote plan', planUpdatedAt: 150,
      status: 'remote-status', statusUpdatedAt: 10
    };
    const merged = window.mergePatientRecords(local, remote);
    assert.equal(merged.dailyPlan, 'remote plan', 'remote planUpdatedAt (150) beats local (50)');
    assert.equal(merged.status, 'local-status', 'local statusUpdatedAt (999) beats remote (10), even though remote is the newer record overall');
  });

  test('labs (current snapshot, not history) merge shallowly with local winning on key conflicts', () => {
    const { window } = loadFrontendEnv();
    const local = { id: 'p1', updatedAt: 100, labs: { hb: '11.2', na: '138' } };
    const remote = { id: 'p1', updatedAt: 100, labs: { hb: '10.9', k: '4.1' } };
    const merged = window.mergePatientRecords(local, remote);
    assert.equal(merged.labs.hb, '11.2', 'local overwrites remote on a shared key, regardless of timestamp');
    assert.equal(merged.labs.na, '138', 'local-only key kept');
    assert.equal(merged.labs.k, '4.1', 'remote-only key kept');
  });

  test('resulting updatedAt is the max of both sides, and any local _dirty flag is stripped', () => {
    const { window } = loadFrontendEnv();
    const local = { id: 'p1', updatedAt: 100, _dirty: true };
    const remote = { id: 'p1', updatedAt: 250 };
    const merged = window.mergePatientRecords(local, remote);
    assert.equal(merged.updatedAt, 250);
    assert.ok(!('_dirty' in merged));
  });
});

describe('detectPatientConflicts — flagging edits that need a human decision, not a silent merge', () => {
  test('no conflict when either side is missing', () => {
    const { window } = loadFrontendEnv();
    assert.deepEqual([...window.detectPatientConflicts(null, { id: 'p1' })], []);
    assert.deepEqual([...window.detectPatientConflicts({ id: 'p1' }, null)], []);
  });

  test('a genuine dailyPlan conflict: both sides stamped, timestamps differ, and text actually differs', () => {
    const { window } = loadFrontendEnv();
    const local = { dailyPlan: 'Plan A', planUpdatedAt: 100 };
    const remote = { dailyPlan: 'Plan B', planUpdatedAt: 200 };
    const conflicts = window.detectPatientConflicts(local, remote);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, 'dailyPlan');
  });

  test('not a conflict if the text ended up the same on both sides, even with different timestamps', () => {
    const { window } = loadFrontendEnv();
    const local = { dailyPlan: 'Same plan', planUpdatedAt: 100 };
    const remote = { dailyPlan: 'Same plan', planUpdatedAt: 200 };
    assert.deepEqual([...window.detectPatientConflicts(local, remote)], []);
  });

  test('not a conflict if one side never stamped planUpdatedAt at all (nothing to compare against)', () => {
    const { window } = loadFrontendEnv();
    const local = { dailyPlan: 'Plan A' };
    const remote = { dailyPlan: 'Plan B', planUpdatedAt: 200 };
    assert.deepEqual([...window.detectPatientConflicts(local, remote)], []);
  });

  test('a genuine status conflict is detected the same way', () => {
    const { window } = loadFrontendEnv();
    const local = { status: 'postop', statusUpdatedAt: 100 };
    const remote = { status: 'fordischarge', statusUpdatedAt: 200 };
    const conflicts = window.detectPatientConflicts(local, remote);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, 'status');
  });

  test('both a plan and a status conflict can be reported at once', () => {
    const { window } = loadFrontendEnv();
    const local = { dailyPlan: 'A', planUpdatedAt: 100, status: 'postop', statusUpdatedAt: 100 };
    const remote = { dailyPlan: 'B', planUpdatedAt: 200, status: 'fordischarge', statusUpdatedAt: 200 };
    const conflicts = window.detectPatientConflicts(local, remote);
    assert.equal(conflicts.length, 2);
    assert.deepEqual([...conflicts.map(c => c.field)].sort(), ['dailyPlan', 'status']);
  });
});
