# T2 — Audit log read API + console view — Design

**Date:** 2026-07-27
**Status:** Approved (brainstorm)
**Backlog:** T2 (Stage 1). Depends on T1 (write path + `listAudit`).
**Approach:** Thin dual API + two surfaces (admin Audit section + patient-modal Activity).

## Problem

T1 records who viewed, wrote, moved, exported, and administered what. Without a read path, that log cannot answer a security questionnaire, support an incident review, or show a clinician “who touched this chart.” Stage 1 exit criteria require audit queryable per patient and per user.

## Decisions (brainstorm)

1. **Per-patient trail audience:** any clinician who can open the patient (not admin-only).
2. **Modal content:** patient-scoped actions only — `patient.view`, `patient.write`, `patient.move`, and `ai.invoke` when `subjectId` is that patient.
3. **API shape:** admin list stays under `/api/admin/audit`; clinicians use `GET /api/patients/:id/audit` gated by `canRead`.
4. **UI approach:** dual surface — admin console Audit section (filters + detail + CSV) and a compact Activity block in the patient modal.

## Non-negotiables

- Reuse T1 `store.listAudit` / append-only contract — no update/delete.
- Org clamp on admin reads: org admin sees only their `orgId`; instance admin sees all (optional `orgId` filter).
- Cross-tenant probe on the patient endpoint returns 403 and writes **no** audit row (same rule as T1 `patient-view`).
- `/api/sync` response shape unchanged (golden flag-off test untouched).
- No admin-console visual polish — match existing Overview/People/Structure patterns only (`AGENT-GUIDE` stop-list).
- `escapeHTML` on every client-interpolated audit field.
- No new runtime dependencies.

## Design

### 1. Admin read API

`GET /api/admin/audit` — `actor.role === 'admin'` only.

| Query | Behaviour |
|---|---|
| `actorId` | exact match |
| `subjectId` | exact match |
| `action` | exact match (T1 vocabulary) |
| `from`, `to` | epoch ms inclusive bounds on `at` |
| `orgId` | instance admin optional filter; org admin **forced** to `actor.orgId` — requesting another org → **403** |
| `limit` | default 50, max 200 |
| `offset` | default 0 |

Response: `{ entries, limit, offset }` (no `total` in v1 — YAGNI; UI uses load-more). Each entry is the T1 row shape.

`GET /api/admin/audit.csv` — same auth, filters, and clamp; `Content-Type: text/csv` attachment. Columns: `id,at,actorId,actorUsername,action,subjectType,subjectId,orgId,ip,userAgent,detail` (`detail` as JSON string). Single response capped at **5000** newest matching rows (documented in the 200 response via the number of lines); no cursor protocol in T2.

Flag-off (no `MULTI_TENANT`): no org clamp; any admin may list all rows.

### 2. Patient read API

`GET /api/patients/:id/audit` — any authenticated user.

1. Load patient; missing → 404.
2. If `MULTI_TENANT` and `!canRead(patient, scope)` → 403 (no audit write).
3. Query storage with `subjectId = id` and `actions` ∈ `{ patient.view, patient.write, patient.move, ai.invoke }` so `limit`/`offset` apply **after** the allowlist (not a post-filter that under-fills pages).
4. Query params: `limit` (default 20, max 100), `offset` only.

**Storage tweak (additive):** extend `listAudit` with optional `actions: string[]` → SQL/Mongo `action IN (...)`. Omit or empty → no action filter (admin path unchanged).

Response: `{ entries, limit, offset }`.

### 3. Admin console — Audit section

- Add `{ id: 'audit', label: 'Audit' }` to `ADMIN_SECTIONS` (visible to all admins; not instance-only).
- New file `public/admin-audit.js` (same plain-script pattern as `admin-people.js`) to avoid growing `admin-console.js` further.
- Filter strip + results list + detail pane on row select (mirror People master-detail language: tokens, list/detail, no new chrome).
- Filters bound to admin API query params; “Export CSV” hits `/api/admin/audit.csv` with the same params.
- Phone: follow People/Structure list→detail drill behaviour already in the console.

### 4. Patient modal — Activity

- Collapsible “Activity” block for **existing** patients only (hidden while adding).
- On expand: `GET /api/patients/:id/audit?limit=20`; load-more bumps `offset`.
- Row copy: relative time, actor username, humanised action (e.g. Viewed / Updated / Moved / AI: draft-plan from `detail.endpoint`).
- Offline or error: one short non-blocking message; save/close still work.

### 5. Error handling

| Case | Status |
|---|---|
| Non-admin → admin audit/CSV | 403 |
| Org admin → other orgId | 403 |
| Bad from/to/limit | 400 |
| Patient missing | 404 |
| Patient out of scope | 403 |
| Unauthenticated | 401 |

UI: toast or inline error; never block patient save.

### 6. Testing

`tests/server-audit-read.test.js`:

- Pagination (`limit`/`offset`)
- Each admin filter
- Org A cannot read org B (JSON + CSV)
- Member `canRead` → 200, allowlisted actions only
- Member out of scope → 403
- Non-admin → `/api/admin/audit` 403
- Flag-off: admin list works; patient endpoint works for a logged-in user

Optional light jsdom check that Activity markup escapes usernames — only if cheap under existing frontend harness; not a blocker.

### 7. Out of scope

- Auditing audit-reads
- Member CSV
- Charts / live push refresh
- `countAudit` / total hit counts
- T3+ security headers, token changes
- Admin visual polish

## Rollback

Remove the two routes, `admin-audit.js` + nav entry, and the modal Activity block. Audit table/data from T1 remains.

## Implementation order (for the plan)

1. Admin JSON + CSV handlers + isolation/filter tests  
2. Patient audit handler + member allowlist/403 tests  
3. `admin-audit.js` + nav wiring  
4. Patient modal Activity  
5. Mark T2 done in `BACKLOG.md`
