# T1 — Audit log write path — Design

**Date:** 2026-07-27
**Status:** Approved for implementation
**Backlog:** T1 (Stage 1). Unlocks T2 (read API + console) and P1 (metrics from audit).

## Problem

Every hospital security questionnaire asks for an audit trail of who accessed which patient record. Today the only durable trails are per-field attribution stamps (`doneBy`, `statusUpdatedBy`) and per-patient `moveHistory`. There is no instance-wide, append-only log of views, writes, exports, logins, admin mutations, or AI invocations. Without it, Stage 2 cannot measure a design partner, and DPDP/HIPAA conversations stop at the first question.

## Non-negotiables

- **Always on.** Audit is a trust foundation for every deployment mode, not a cloud feature. No flag. Self-host with no env vars must write the same rows.
- **Append-only.** Storage exposes `appendAudit` and `listAudit` only. No update, no delete.
- **Never fail the caller.** A failed audit write logs an error and returns; the request that triggered it still succeeds.
- **Both backends.** SQLite table + Mongo collection, identical row shape.
- **Sync contract untouched.** Flag-off (and always-on) `/api/sync` response shape stays byte-identical to the golden test. Audit is a side effect, not a response field.
- **No patient PHI in `detail` beyond identifiers already required.** Prefer ids and action metadata; never dump full patient JSON or passwords.

## Approach

### 1. Row shape

| Field | Type | Notes |
|---|---|---|
| `id` | string UUID | Primary key |
| `at` | number (epoch ms) | Server clock at write |
| `actorId` | string \| null | Null for failed login (no account) |
| `actorUsername` | string \| null | Attempted username on failed login |
| `action` | string | Stable vocabulary below |
| `subjectType` | string \| null | `patient` \| `user` \| `org` \| `hospital` \| `department` \| `unit` \| `ward` \| `session` \| `ai` \| `backup` \| `export` \| `import` |
| `subjectId` | string \| null | Id of the subject when applicable |
| `orgId` | string \| null | Tenant stamp when known; null when single-tenant or unknown |
| `ip` | string \| null | From `x-forwarded-for` / socket |
| `userAgent` | string \| null | Truncated to 300 chars |
| `detail` | object | Action-specific JSON; empty object default |

### 2. Action vocabulary

| Action | When |
|---|---|
| `login.success` | Successful `POST /api/login` |
| `login.failure` | Failed/rate-limited login attempt |
| `patient.view` | `POST /api/audit/patient-view` (client reports opening a record; server verifies read scope) |
| `patient.write` | Each patient upserted via `/api/sync` |
| `patient.move` | Sync write that also appended `moveHistory` |
| `export` | `GET /api/export` (and OT-list docx as `export` with `detail.kind: 'ot-list'`) |
| `import` | Successful `POST /api/import` |
| `backup.download` | `GET /api/backup` that returns a file |
| `password.reset` | Admin `…/reset-password` |
| `user.create` | Admin user create (including org-admin bootstrap) |
| `user.disable` | Admin disable |
| `user.enable` | Admin enable |
| `structure.create` | Org/hospital/department/unit/ward create |
| `structure.update` | Node rename/patch |
| `structure.delete` | Node delete |
| `structure.move` | Node reparent / patient rehome |
| `ai.invoke` | Any `/api/ai/*` that proceeds past rate-limit (detail includes endpoint name) |

### 3. Module: `audit.js`

```js
recordAudit(store, { actor, action, subjectType, subjectId, orgId, req, detail })
```

- Builds the row, calls `store.appendAudit(entry)`.
- Catches every error → `logError('audit_write_failed', err, { action })`.
- Never throws. Never awaits from a critical path in a way that can reject — callers may `void recordAudit(...)` or `await` safely.
- Exports `ACTIONS` constants used by server and tests.

### 4. Storage

SQLite:

```sql
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actorId TEXT,
  actorUsername TEXT,
  action TEXT NOT NULL,
  subjectType TEXT,
  subjectId TEXT,
  orgId TEXT,
  ip TEXT,
  userAgent TEXT,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit(action);
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit(subjectType, subjectId);
CREATE INDEX IF NOT EXISTS idx_audit_orgId ON audit(orgId);
```

Mongo: collection `audit` with the same indexes. `detail` stored as a document (not a string).

`listAudit({ action, subjectId, actorId, orgId, from, to, limit, offset })` — newest first. Used by T1 tests and by T2's read API. Filter semantics match T2 acceptance so T2 does not reshape storage.

### 5. Patient view endpoint

There is no server round-trip today when a clinician opens a patient (data is already in the offline cache). Add:

`POST /api/audit/patient-view` `{ patientId }`

- Auth required.
- Load patient; if missing → 404.
- If `MULTI_TENANT` and `!canRead(patient, scope)` → 403 (and do **not** write an audit row — probing another tenant must not create a trail of their ids in the probee's log under the probee's org).
- Else append `patient.view` and return `{ ok: true }`.

Client: fire-and-forget from `openPatientModal` when online and `patientId` is set. Offline: skip (view will not be logged until T2/offline queue — accepted for T1; note in plan).

### 6. Sync write / move

Inside the existing upsert loop, after a successful `upsertPatient`:

- Always `recordAudit(… patient.write …)` with `orgId` from the stored ancestry when present.
- Additionally `recordAudit(… patient.move …)` when `decision.moved` was set (detail: `{ from, to }`).

One sync batch with N writes → N write rows (and M move rows). Acceptable; T2 pagination handles volume.

### 7. Flag-off / MULTI_TENANT

Works in both modes. `orgId` is null when the patient/user has none (classic single-tenant). No response-shape change. Golden sync test must stay green.

## Alternatives rejected

- **Reuse `moveHistory` only.** Covers moves, not views/exports/logins/AI. Insufficient for questionnaires.
- **Gate behind a flag.** Would leave self-host without an audit trail; defeats Stage 1 purpose.
- **Audit every sync pull (`getChangedSince`).** Too noisy and not a "view." Explicit view endpoint is the honest signal.
- **Block the request on audit failure.** Violates acceptance; a full disk must not take down rounds.

## Test strategy

1. Storage unit tests (SQLite + Mongo when URI set): append, list filters, assert no update/delete methods on the store API surface.
2. Integration (`tests/server-audit.test.js`): one case per action verb, reopen `dataDir` store after the HTTP call, assert actor + subject + action.
3. Failure isolation: `recordAudit` against a store whose `appendAudit` throws — caller promise resolves, `logError` path exercised.
4. Golden sync flag-off still passes unchanged.

## Rollback

Delete `audit.js`, drop call sites, leave the empty `audit` table/collection (additive schema; harmless). No data migration required.

## Sync write ordering

Audit jobs for `patient.write` / `patient.move` are queued during the sync transaction and flushed **after** `commit`. A rolled-back batch therefore never leaves audit rows for writes that did not land, and audit I/O never holds the patient write lock.

## Out of scope (T2)

Admin read API, console tab, per-patient trail UI, CSV export, scope-clamped listing. `listAudit` is built now so T2 is API-only.
