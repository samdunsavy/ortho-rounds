# T1 — Audit log write path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or executing-plans) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append-only audit rows for every listed action, both storage backends, never failing the caller.

**Architecture:** `storage.appendAudit` / `listAudit` → `audit.recordAudit` fire-and-forget helper → call sites in `server.js` + one client fire-and-forget for patient view.

**Tech Stack:** Node ESM, `node:sqlite` + Mongo, existing `server-harness.js` for HTTP tests.

**Spec:** `docs/superpowers/specs/2026-07-27-audit-log-write-path-design.md`

---

### Task 1: Storage — append-only audit table/collection

**Files:**
- Modify: `storage.js`
- Test: `tests/storage-audit.test.js`

- [ ] **Step 1: Write failing storage tests**

```js
// tests/storage-audit.test.js — SQLite
test('appendAudit writes a row listable newest-first', async () => {
  await store.appendAudit({
    id: 'a1', at: 100, actorId: 'u1', actorUsername: 'pg1',
    action: 'patient.view', subjectType: 'patient', subjectId: 'p1',
    orgId: 'org1', ip: '1.2.3.4', userAgent: 'test', detail: { x: 1 }
  });
  await store.appendAudit({
    id: 'a2', at: 200, actorId: 'u1', actorUsername: 'pg1',
    action: 'patient.write', subjectType: 'patient', subjectId: 'p1',
    orgId: 'org1', ip: null, userAgent: null, detail: {}
  });
  const rows = await store.listAudit({ limit: 10 });
  assert.equal(rows[0].id, 'a2');
  assert.equal(rows[1].id, 'a1');
  assert.deepEqual(rows[0].detail, {});
});

test('listAudit filters by action, subjectId, actorId, orgId, from, to', async () => { /* … */ });

test('store has no updateAudit or deleteAudit', () => {
  assert.equal(typeof store.updateAudit, 'undefined');
  assert.equal(typeof store.deleteAudit, 'undefined');
});
```

- [ ] **Step 2: Run — expect FAIL** (`appendAudit` missing)
- [ ] **Step 3: Implement SQLite + Mongo `appendAudit` / `listAudit`** per design schema
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** `feat(T1): append-only audit storage for sqlite and mongo`

---

### Task 2: `audit.js` helper

**Files:**
- Create: `audit.js`
- Test: `tests/audit.test.js`

- [ ] **Step 1: Failing tests for happy path + swallow-on-throw**
- [ ] **Step 2: Implement `ACTIONS`, `recordAudit`**
- [ ] **Step 3: Commit** `feat(T1): fire-and-forget recordAudit helper`

---

### Task 3: Wire server call sites + patient-view endpoint

**Files:**
- Modify: `server.js`
- Modify: `public/app.js` (openPatientModal fire-and-forget)
- Test: `tests/server-audit.test.js`

- [ ] **Step 1: Write one integration test per action** (login success/failure, patient view/write/move, export, import, backup, password reset, user create/disable/enable, structure create, ai invoke). Reopen `srv.dataDir` via `createStore` after each HTTP action to `listAudit`.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Wire `recordAudit` at each site; add `POST /api/audit/patient-view`**
- [ ] **Step 4: Client: after opening an existing patient while online, `POST /api/audit/patient-view` (ignore errors)
- [ ] **Step 5: Run server-audit + golden sync — expect PASS**
- [ ] **Step 6: Commit** `feat(T1): audit write path for auth sync admin export ai`

---

### Task 4: Verify + backlog

- [ ] Full `npm test` green; note count
- [ ] Confirm golden sync untouched
- [ ] Mark T1 `[x]` in `BACKLOG.md`
- [ ] Commit `docs(T1): mark audit write path done`
