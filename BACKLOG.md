# Ortho Rounds — Feature Backlog

**The roadmap as tickets.** Strategic reasoning lives in `UPGRADE-PLAN.md`; market evidence in `MARKET-POSITION.md`. This file is the *what*, in dependency order, with acceptance criteria.

**Reading the table**

- **ID** — stable reference. Cite it in branch names, commits and specs (`feat(T1): audit log write path`).
- **Effort** — S ≤ 1 day · M 2–4 days · L 1–2 weeks · XL 3+ weeks (split before starting)
- **Dep** — hard prerequisite. Do not start an item whose deps are open.
- Stages 1–3 carry full acceptance criteria. Stages 4–8 are scoped one-liners; they get expanded into specs when their stage opens, not before.

**Status legend:** `[ ]` open · `[~]` in progress · `[x]` done · `[-]` dropped

---

## Stage 1 — Trust foundations (2 weeks) → 33.2%

Cheapest points on the board. Every item here is a standing finding in a hospital security questionnaire.

| ID | Status | Feature | Effort | Dep |
|---|---|---|---|---|
| **T1** | `[x]` | Audit log — write path | M | — |
| **T2** | `[ ]` | Audit log — read API + admin console view | M | T1 |
| **T3** | `[ ]` | HTTP security headers | S | — |
| **T4** | `[ ]` | Signed short-lived image URLs; remove `?token=` fallback | M | — |
| **T5** | `[ ]` | Access/refresh token split | M | T4 |
| **T6** | `[ ]` | Consent gate on lab-photo AI flow | M | — |
| **T7** | `[ ]` | Encryption at rest (hosted path) | L | — |
| **T8** | `[ ]` | Modularise `app.js` (9,073 lines) | L | — |
| **T9** | `[ ]` | Test-suite runtime under 2 minutes | M | — |
| **T10** | `[ ]` | Cross-tenant isolation test suite | M | — |

### T1 — Audit log, write path

Every read, write, export and structural change against a patient is recorded. Generalise the existing pattern: `merge.js` already stamps attribution, and per-patient `moveHistory` already exists — this is that idea applied to all access.

**Acceptance**

- New `audit` table/collection, mirrored across both storage backends in `storage.js`
- Record shape: `id`, `at`, `actorId`, `actorUsername`, `action`, `subjectType`, `subjectId`, `orgId`, `ip`, `userAgent`, `detail` (JSON)
- Actions covered: patient view, patient write via sync, patient move, export, import, backup download, login success, login failure, password reset, user create/disable/enable, structural CRUD, AI invocation
- Append-only — no update or delete path exists in the storage API
- Writes never block or fail the request they describe (failure to audit logs an error, does not 500 the caller)
- Works with `MULTI_TENANT` on and off
- Tests: one per action type asserting a row lands with the right actor and subject

### T2 — Audit log, read API + console view

**Acceptance**

- `GET /api/admin/audit` with filters: `actorId`, `subjectId`, `action`, `from`, `to`, `orgId`; paginated, newest first
- Scope-clamped — an org admin sees only their org's entries; instance admin sees all
- Admin console tab following the existing rail + detail-pane pattern (`public/admin-console.js`)
- Per-patient audit trail reachable from the patient record
- CSV export of a filtered result set
- Tests: pagination, every filter, and an explicit assertion that org A cannot read org B's entries

### T3 — HTTP security headers

Verified absent today.

**Acceptance**

- `Strict-Transport-Security` (hosted only — must not break plain-HTTP LAN self-host), `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
- CSP tight enough to be meaningful but compatible with the inline `<style>`/`<script>` in `index.html` — if that forces `unsafe-inline`, log a follow-up to extract them rather than shipping a useless policy
- Test asserting each header is present on both an API and a static-file response

### T4 — Signed short-lived image URLs

`server.js:183` accepts `?token=` because `<img>` cannot set an Authorization header. Tokens consequently reach access logs, proxy logs, browser history and `Referer`.

**Acceptance**

- `GET /api/images/:id/url` returns a URL bearing a single-purpose HMAC signature scoped to that image id, expiring in ≤ 5 minutes
- Image handler accepts the signature; the `?token=` bearer fallback is deleted
- Signature is not a bearer token and grants nothing but that one image
- `Referrer-Policy: no-referrer` (T3) covers the residual leak
- Tests: valid, expired, wrong-image, tampered signature; plus one asserting a bearer token in the query string is now rejected

### T5 — Access/refresh token split

Today: one 30-day bearer, no rotation.

**Acceptance**

- Access token ≤ 60 minutes; refresh token 30 days, rotated on use
- `POST /api/auth/refresh`; client refreshes transparently, including after an offline period
- `tokenVersion` revocation invalidates both (existing disable-user behaviour must be preserved exactly)
- **Offline is the hard case:** a device offline for a week must still work locally and recover cleanly on reconnect. Expiry must never wipe the local cache or force a re-login that loses unsynced edits.
- Existing 30-day tokens honoured until natural expiry — no forced logout on deploy (`POLICY.md` §3)
- Tests: refresh, rotation, reuse-detection, revocation, offline-then-reconnect

### T6 — Consent gate on the lab-photo AI flow

This flow sends identifiable patient images to a third-country processor. It alone fails a DPDP review. Do not let it reach a design partner ungated.

**Acceptance**

- Per-use consent dialog stating exactly what leaves the server and to whom; not a one-time global setting
- Consent recorded in the audit log (T1) with patient id, actor, timestamp
- `ORTHO_AI_IMAGE_UPLOAD=0` server-side kill switch that hides the feature entirely
- Written processor record in `docs/compliance/processors.md`
- README privacy section updated to describe the gate, not just the exception
- Tests: feature hidden when killed; no upload occurs without recorded consent

### T7 — Encryption at rest

**Acceptance**

- Hosted path: SQLite file-level encryption or Mongo CSFLE on patient `data`, X-ray blobs and the `users` table
- Key from environment, never on disk beside the data; documented rotation procedure
- Self-host default unchanged and documented honestly as unencrypted-at-rest
- Backup/restore verified against an encrypted store (`data/backups/`, `/api/backup`)
- Startup fails loudly on a missing key rather than silently writing plaintext

### T8 — Modularise `app.js`

Not cosmetic. 9,073 lines with ~7,300 untested is the precondition blocking a second engineer (C13) from being productive rather than dangerous.

**Acceptance**

- Extract ≥ 4 pure-logic modules following the `milestones.js` precedent: sync/merge, worklist/triage, presentation, labs
- Each extracted module has real tests; net new coverage, not moved coverage
- `app.js` under 7,000 lines
- No behaviour change — the existing 579 tests pass untouched
- Still no build step. Plain scripts plus the existing bridge-file pattern (`admission-bridge.js`, `clinical-normalize-bridge.js`)

### T9 — Test-suite runtime under 2 minutes

Full suite currently exceeds 5 minutes; the four `frontend-admin-*.test.js` jsdom suites dominate. A suite nobody waits for is a suite nobody runs.

**Acceptance**

- Full `npm test` under 2 minutes on CI hardware
- Shared jsdom environment per file rather than per test where semantics allow
- Runtime documented in `AGENT-GUIDE.md` so a regression is noticed

### T10 — Cross-tenant isolation test suite

Cheap now, and it is the safety net for S2.

**Acceptance**

- `tests/tenant-isolation.test.js`: two fully populated orgs, then an assertion at **every** authenticated endpoint that org A's actor cannot read, write, move, export or enumerate any org B resource
- Includes the negative case for unassigned patients and for the unrestricted instance admin
- Table-driven, so a new endpoint without an isolation case is an obvious omission

---

## Stage 2 — Proof (4 weeks) → 37.5%

Product work here exists only to make a design partner succeed and to measure them. Nothing else.

| ID | Status | Feature | Effort | Dep |
|---|---|---|---|---|
| **P1** | `[ ]` | Baseline + outcome measurement instrumentation | M | T1 |
| **P2** | `[ ]` | In-app feedback capture | S | — |
| **P3** | `[ ]` | Self-serve department onboarding | M | — |
| **P4** | `[ ]` | Demo/trial mode with synthetic patients | S | — |
| **P5** | `[ ]` | Case-study metrics export | S | P1 |

### P1 — Measurement instrumentation

You cannot claim an improvement you did not baseline. Extends `telemetry.js`, which is already local-only and double-opt-in.

**Acceptance**

- Metrics captured per department per day: time from first to last patient interaction in a rounds session; count and lateness of overdue milestones; handover-sheet generation time; OT-list assembly time; patients touched per session; sync conflict count
- All derived from the audit log (T1) — no new client instrumentation to drift
- `GET /api/admin/metrics?from=&to=&departmentId=` returns the series
- Stays local unless the operator explicitly opts in, per `POLICY.md` §5
- A documented one-week paper/WhatsApp baseline protocol in `docs/design-partner-protocol.md`

### P2 — In-app feedback capture

**Acceptance**

- Persistent low-profile "Report a problem" affordance on every view
- Captures free text plus automatic context: view, app version, storage backend, online/offline, last error
- Lands in an admin-visible queue; no external service dependency
- Works offline and syncs later

### P3 — Self-serve department onboarding

Site #2 must be configuration, not a founder visit.

**Acceptance**

- Guided first-run: create org → hospital → department → unit, invite users, pick specialty template
- Bulk user invite by paste or CSV, producing one-time passwords
- Written pre-flight checklist for a new site (network, device, backup, admin handover)
- A department reaches "first patient added" without any code change or shell access

### P4 — Demo/trial mode

**Acceptance**

- `ORTHO_DEMO=1` seeds ~20 synthetic patients spanning every clinical state (pre-op, post-op day range, pending fitness, abnormal labs, discharge-ready)
- Clearly watermarked; refuses to run against a store containing real patients
- Resettable in one action

### P5 — Case-study metrics export

**Acceptance**

- One command produces a before/after comparison from P1 data as a shareable one-pager
- Aggregate only; no patient-identifying content can appear in the output

---

## Stage 3 — Integration + scoping (8 weeks) → 45.6%

### 3A — Kill double data entry

Data-entry burden scores 2/10 and is the largest product gap. **The first integration matters more than the right integration** — ship the ugly one.

| ID | Status | Feature | Effort | Dep |
|---|---|---|---|---|
| **I1** | `[ ]` | Ingest adapter interface + pipeline | L | — |
| **I2** | `[ ]` | CSV/file-drop demographics + ADT adapter | M | I1 |
| **I3** | `[ ]` | HL7 v2 ADT adapter | L | I1 |
| **I4** | `[ ]` | Lab results ingest | L | I1 |
| **I5** | `[ ]` | Ingest admin UI — mapping, dry-run, reconciliation | L | I2 |
| **I6** | `[ ]` | Patient identity matching and dedupe | L | I1 |

**I1 — Adapter interface.** One documented interface (`fetch → normalise → match → apply`), one adapter per source, so site #2 is config not a fork. Idempotent and replayable; every ingest run recorded in the audit log with counts. Ingested fields are marked provenance-`external` and never silently overwrite a clinician edit — conflicts surface exactly like sync conflicts already do.

**I2 — CSV/file-drop.** Watched directory or upload. Column mapping is configuration, not code. Dry-run before apply. Malformed rows quarantine with a readable report rather than aborting the batch.

**I3 — HL7 v2 ADT.** A01/A02/A03/A08 (admit/transfer/discharge/update) minimum. Runs as a separate listener process so a malformed feed cannot take down the app. Transfers map onto the existing unit-move machinery including `moveHistory`.

**I4 — Labs.** Normalised into the existing labs history shape so the trend view works unchanged. Abnormal-flag thresholds configurable per site. Reduces the photo-extraction flow (T6) from a primary path to a fallback.

**I5 — Ingest admin UI.** Mapping editor, dry-run diff, per-run history with counts and errors, one-action rollback of the last run.

**I6 — Identity matching.** Match on UHID first, then a scored name + age + sex + admission-date fallback. Ambiguous matches go to a human review queue — never auto-merged. Merge is reversible and audited.

### 3B — Fix the multi-tenant scale wall

| ID | Status | Feature | Effort | Dep |
|---|---|---|---|---|
| **S1** | `[ ]` | Promote `orgId`/`unitId` to indexed columns | M | T10 |
| **S2** | `[ ]` | Database-level scoped sync query | L | S1 |
| **S3** | `[ ]` | Externalise rate-limit state | M | — |
| **S4** | `[ ]` | Load-test harness | M | S2 |

**S1.** `patients` is `(id, updatedAt, deleted, data TEXT)` — scoping keys live inside the JSON blob. Right call for one tenant; the direct cause of S2. Add indexed `orgId`/`unitId` columns, backfill from the blob (`scripts/backfill-hierarchy-v2.js` is the precedent), keep the blob authoritative during transition, verify an upgrade from a pre-change database. Composite index on `(orgId, updatedAt)` and `(unitId, updatedAt)`.

**S2.** `server.js:920–926` loads every changed row instance-wide, then filters tenants in application memory. Sync cost therefore scales with total customers, and isolation rests on a single `.filter()`. Push the predicate into SQL/Mongo. `canRead()` stays as a defence-in-depth assertion, not the primary control. T10 must be green before and after — unchanged.

**S3.** `auth.js:10` keeps rate-limit buckets in a process-local `Map`; two instances behind a load balancer means an inconsistent, effectively doubled limit. Pluggable store, in-memory default for self-host, shared store for hosted. Same treatment for the AI rate limiter in `ai.js`.

**S4.** Reproducible harness at 50 orgs × 200 patients: sync latency p50/p95/p99, memory ceiling, cold-start. Numbers committed to the repo so regressions are visible. Establish them before a customer does.

---

## Stage 4 — Commercial + DPDP + ops (10 weeks) → 58.6%

| ID | Feature |
|---|---|
| **C1** | Plan/entitlement model — tiers, limits, per-org enforcement behind the `BILLING` flag |
| **C2** | Stripe integration — subscribe, invoice, dunning, webhooks |
| **C3** | Usage metering — seats and AI calls per org, behind `AI_METERING` |
| **C4** | DPDP consent management — purpose-scoped consent capture, versioned notices, withdrawal |
| **C5** | Data-subject rights — access, correction, erasure request endpoints and workflow |
| **C6** | Retention policy engine + scheduled purge with audit trail |
| **C7** | Breach detection runbook + notification tooling (72-hour clock) |
| **C8** | Docker image + compose for one-command self-host |
| **C9** | IaC (Terraform), liveness/readiness probes, zero-downtime deploy |
| **C10** | Structured JSON logging, error tracking, uptime monitoring, alert routing |
| **C11** | Automated backup verification + rehearsed, timed restore drill |
| **C12** | Status page + support inbox with a stated response time |
| **C13** | Second engineer: PR-review workflow, `CONTRIBUTING.md`, onboarding path |
| **C14** | DPIA + data-processing record + retention schedule in `docs/compliance/` |
| **C15** | Grievance-officer contact and process, published (DPDP requirement) |

---

## Stage 5 — Certification + interop (22 weeks) → 71.5%

| ID | Feature |
|---|---|
| **X1** | FHIR R4 read client — Patient, Encounter, Observation, DiagnosticReport |
| **X2** | SMART on FHIR launch (EHR-embedded context) |
| **X3** | Epic Showroom Connection Hub listing (~$500/yr; App Orchard/App Market are retired) |
| **X4** | ABDM — ABHA linking, HIP/HIU flows, consent-manager integration |
| **X5** | SOC 2 Type II controls — access review, change management, vulnerability management, evidence collection |
| **X6** | Independent penetration test + remediation |
| **X7** | BAA-eligible AI path — Azure OpenAI or on-prem inference; self-host keeps bring-your-own-key |
| **X8** | HIPAA readiness pack + BAA template |
| **X9** | Reference-selling kit built from P5 case-study data |

---

## Stage 6 — Moat (26 weeks) → 78.0%

| ID | Feature |
|---|---|
| **M1** | Generalise the template engine — specialty templates on one substrate, never forks. Hook exists: `departments.specialty`, default `'ortho'` (`storage.js:152`) |
| **M2** | Template authoring UI — a department defines its own milestones, statuses, flags |
| **M3** | Template library — publish, discover, adopt across orgs. **The first genuine network effect** |
| **M4** | De-identification pipeline — opt-in per hospital, off by default, self-host never pooled |
| **M5** | Benchmarking service — LOS, milestone adherence, complication rates vs. a consented cohort |
| **M6** | Native mobile shell — biometric login, real device testing on the touch surfaces `POLISH.md` still flags |
| **M7** | Background sync + push-driven refresh |
| **M8** | E2E test layer (Playwright) in CI — none exists today |
| **M9** | Close remaining `app.js` coverage |
| **M10** | Worklist + OT-list responsive layouts (deferred from `POLISH.md` Priority 2) |

---

## Stage 7 — Enterprise (26 weeks) → 91.3%

| ID | Feature |
|---|---|
| **E1** | SSO — SAML 2.0 + OIDC |
| **E2** | SCIM provisioning and deprovisioning |
| **E3** | Full RBAC — attending, PG, **nurse (ward-scoped)**, read-only auditor, delegated org admin. Only `admin`/`member` exist today |
| **E4** | Postgres backend option; connection pooling; managed-service path |
| **E5** | High availability — multi-instance, tested failover, published RPO/RTO |
| **E6** | EHR write-back where permitted (notes, plans) |
| **E7** | Enterprise support tooling — SLA reporting, audit export, admin analytics |
| **E8** | Multi-region deployment + data-residency controls |
| **E9** | Compliance variants — HIPAA, GDPR alongside DPDP |
| **E10** | On-call rotation, named security officer, incident process |

---

## Stage 8 — Category leadership (26 weeks) → ~99%

| ID | Feature |
|---|---|
| **L1** | Outcome-study data pipeline for peer-reviewed publication |
| **L2** | Training-programme / accreditation-body integration and endorsement artifacts |
| **L3** | Public template + integration marketplace |
| **L4** | Multi-language and locale support |
| **L5** | Partner/reseller enablement |

---

## Explicitly not building

Kept here so it does not get re-proposed. Reasoning in `UPGRADE-PLAN.md` §stop-list.

| Item | Why not |
|---|---|
| More admin-console visual polish | Four consecutive passes. Done. Bug fixes only, user-reported. |
| New AI features beyond the existing nine | Abridge: ~$812M raised, $5.3B valuation, 250+ health systems, #1 Best in KLAS ambient two years running. Unwinnable lane; positioning there invites a losing comparison. |
| FHIR before any crude integration works | Standards-compliance before proof of value is a 9-month detour. I2 first, X1 later. |
| Framework/bundler rewrite | Three runtime dependencies is an asset. Nothing in Stages 1–8 requires React. |
| Vitals / MAR / order entry | That is being an EHR. Integrate (I1–I4), don't replace. |
| Hosted multi-tenant customer before S2 | The in-memory tenant filter is a PHI-leak vector; onboarding tenant #2 onto it converts a bug into a breach. |
