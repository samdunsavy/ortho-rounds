# Phase 1: Auth + Sync Scoping by Department/Org — Design

**Date:** 2026-07-22
**Status:** Approved. Scope: wire auth and sync to the multi-tenant hierarchy behind `MULTI_TENANT`. Admin console and migration tool are later passes (see DESIGN-multitenant.md).

## Problem

The hierarchy schema (organizations → hospitals → wards) shipped inert. `POST /api/login` and `/api/sync` still assume one flat instance: every authenticated user reads and writes every patient. Multi-tenant hosting is impossible until sync and auth respect scope — and this is the highest-risk change on the roadmap because `/api/sync` is the contract every existing client depends on.

## Non-negotiable

With `MULTI_TENANT` off (the default, and every existing install), behavior is byte-for-byte identical to today. Every new branch is gated by `isEnabled('MULTI_TENANT')`. The full existing test suite passes unchanged with the flag off.

## Naming: ward = department; units are metadata

The hierarchy entity stored in the `wards` table is the **department/team** (ortho, general surgery, medicine) — the access boundary. Its existing `specialty` field is what makes the system universal across departments; Phase 3 specialty templates hook there. Spec and UI copy say "department"; the `wards` table, CRUD names, and `users.wardId` column stay as shipped (renaming live schema buys nothing).

Within-department groupings — the patient's `unit` ("ortho unit - IV"), physical `ward` string, `wardType` (free/paid) — remain plain patient fields with **zero access semantics**, exactly as today. A member sees all units in their department (PGs cross-cover units on call). Unit filtering is a UI concern. If a department later wants structured unit lists, that is ward-metadata (like `defaultOtDoctors`) — additive, not a hierarchy change.

## Access model (flag on)

| Actor | Reads | Writes |
|---|---|---|
| member with `wardId` | patients of that department only | that department only |
| member with `wardId NULL` | nothing (strict deny) | nothing |
| admin with `orgId` | all departments under hospitals of their org | same set |
| admin with `orgId NULL` (instance admin) | everything | everything |

Patients whose JSON lacks `wardId` (pre-migration data) are visible to admins only. Strict semantics, documented; the future migration tool backfills `wardId`.

Cross-org isolation is the core guarantee: two orgs on one hosted instance can never read or write each other's patients.

## Design

### 1. Actor scoping (auth)

Token claims unchanged (`sub`, `username`, `tokenVersion`) — no token-contract change. The existing per-request user lookup that builds `actor = {id, username, role}` additionally carries `orgId` and `wardId` from the user row. Ward/org reassignment therefore takes effect on the user's next request with no token invalidation.

`POST /api/login` response additively gains `orgId` and `wardId` (null in single-tenant mode; existing clients ignore unknown keys).

A helper resolves the actor's readable department set once per request (flag on only):

- member → `[actor.wardId]` or `[]` if null
- org admin → all ward ids under `listHospitalsByOrg(actor.orgId)` → `listWardsByHospital(...)` (composed from existing storage CRUD; no new queries)
- instance admin (`orgId NULL`) → unrestricted sentinel

### 2. Sync read filter (app-layer)

Chosen approach: filter in the sync handler after `getChangedSince(since)`, which already parses rows via `rowToPatient`. Rationale: patient `wardId` lives inside the JSON `data` blob by design (no SQL column on patients); an app-layer filter is identical across SQLite and Mongo, needs no migration, and is the smallest possible diff to the riskiest endpoint. Rejected: `json_extract` (SQLite-only; Mongo stores `data` as a JSON string and cannot reach into it without restructuring patient documents) and a real `wardId` column (explicitly rejected in DESIGN-multitenant.md).

Scale note: delta-based sync over ward-sized data makes the post-filter discard negligible. If a hosted org ever makes this hot, promotion to a queryable field is a contained storage-layer change — noted, not built (YAGNI).

Filter semantics (flag on): keep a patient iff `patient.wardId` is in the actor's readable set; patients with no `wardId` only pass for admins; unrestricted sentinel passes everything.

### 3. Sync write enforcement (flag on)

For each incoming change in the sync POST body:

- **New patient** (no stored row): stamped `wardId = actor.wardId` before storing. A member with `wardId NULL` cannot create (change skipped). Admin-created patients take the incoming `wardId` if it is inside the admin's scope; an admin-created patient with no incoming `wardId` falls back to the admin's own `wardId` if set, else stores without `wardId` (admin-only visibility until assigned); an incoming `wardId` outside the admin's scope is skipped.
- **Existing patient**: change applied only if the stored patient's `wardId` is in the actor's readable set; otherwise skipped — same silent-skip shape as today's LWW losers, so no client-visible contract change.
- **No cross-department moves by members**: on merge, the stored `wardId` wins over any incoming value for members. Admins may change `wardId` within their scope.

Flag off: write path untouched, byte-identical.

### 4. Other patient-bearing endpoints (flag on)

`/api/backup`, `/api/import`, `/api/export` (whole-instance operations) become instance-admin-only when the flag is on; org admins and members get 403. Rationale: these are operator tools; scoped per-org export is a migration-tool concern, not this pass. Flag off: unchanged. Push notifications and AI endpoints operate on client-supplied payloads and need no server-side scoping change in this pass.

## Error handling

- Scope violations in sync writes are skipped, not errored — matching the endpoint's existing conflict semantics and avoiding a client-visible contract change.
- A flag-on instance with unassigned users fails closed (empty reads, no writes) rather than open.
- Resolution of the admin ward set tolerates empty org (no hospitals/wards yet → empty set, deny-by-default for org admins with nothing created).

## Testing

Matrix across both backends where applicable:

- **Flag off:** full existing suite unchanged — the byte-identical guarantee — plus a golden-response regression test: a fixed patient fixture synced through `/api/sync` with the flag off, response asserted field-for-field against today's shape (serverTime aside), so any accidental flag-off drift in the handler fails loudly.
- **Wrap-only rule for the sync handler:** new scoping logic wraps around existing statements (guards and additions only); existing lines are not moved or restructured. This is a review gate, not just a convention.
- **Flag on:** login response carries `orgId`/`wardId`; member reads only own department; null-ward member reads nothing and cannot write; admin reads all departments of own org; instance admin reads all; write stamping of new patients; skip of out-of-scope writes; stored `wardId` wins over member's incoming value; cross-org isolation (two orgs, bidirectional invisibility); pre-migration patients (no `wardId`) admin-only; backup/import/export 403 for non-instance-admins.

## Out of scope

Admin console UI, migration tool, hospital-wide member reads, cross-department consults/referrals, structured unit lists, per-department template scoping, org-scoped export.
