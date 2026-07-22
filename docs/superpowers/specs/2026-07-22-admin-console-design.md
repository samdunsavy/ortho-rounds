# Phase 1: Org/Department Admin Console + Provisioning — Design

**Date:** 2026-07-22
**Status:** Approved. Scope: flag-gated admin console (API + dedicated in-app view with stats) and root-admin provisioning fix. Migration tool, billing, self-serve signup are later passes.

## Problem

Sync/auth scoping shipped, but orgs, departments, and user assignments can only be created by seeding the database directly. A hosted pilot is inoperable: the operator cannot create a customer org at runtime, an org admin cannot build their hospital/department structure or onboard users, and a hosted instance whose users are all org-scoped can never regain a root admin (`bootstrapAdmin` no-ops when any user exists).

## Non-negotiables

- Flag off: behavior byte-identical to today. New routes are not registered (404); existing admin routes unchanged; `bootstrapAdmin` condition untouched. Existing suite + golden tests pass unchanged.
- All new access control reuses the shipped primitives: `isInstanceAdmin(actor)`, org admin = `role==='admin' && orgId` set. Cross-org isolation remains the core guarantee.

## Decisions (settled with Xavier)

- **Org creation: instance admin only.** Ops-driven pilot; no self-serve signup.
- **Onboarding: temp-password pattern**, as today — created user's temporary password shown once, shared out-of-band. No email infrastructure.
- **Console: extend the in-app admin surface (option A)** as a dedicated, flag-gated Admin view with stats — not a separate SPA, not script-only.

## Design

### 1. API — all new routes flag-gated (`MULTI_TENANT` off → not registered, 404)

**Instance admin only** (guard: `isInstanceAdmin(actor)`, else 403):

- `POST /api/admin/orgs` `{name, plan?}` → creates org; returns `{id, name, plan}`. `plan` defaults `'free'`.
- `GET /api/admin/orgs` → all orgs with rollups: `{id, name, plan, createdAt, stats: {hospitals, departments, users, livePatients}}`.
- `POST /api/admin/orgs/:id/admin` `{username}` → creates the org's first/next org admin (`role:'admin'`, `orgId:=:id`, `wardId:null`), returns `{id, username, temporaryPassword}` — the practical customer-onboarding unit.

**Org admin or instance admin** (org admins operate on their own `orgId`; an instance admin targets an org explicitly — `?orgId=` on GET, `orgId` in the body on POST; missing target for an instance admin → 400; any cross-org reference → 403):

- `GET /api/admin/org` → the org tree + stats:
  - org totals: `{hospitals, departments, usersActive, usersDisabled, livePatients}`
  - `hospitals: [{id, name, wards: [{id, name, specialty, stats: {livePatients, byStatus: {postop, preop, conservative, fordischarge}, users, lastActivity}}]}]`
  - `lastActivity` = max `updatedAt` over the department's live patients, else null.
- `POST /api/admin/hospitals` `{name}` → hospital in caller's org.
- `POST /api/admin/wards` `{hospitalId, name, specialty?}` → department; validates `hospitalId` belongs to caller's org; `specialty` defaults `'ortho'`.
- `POST /api/admin/users/:id/assign` `{wardId}` (string or null) → reassigns department. Validates target user is in caller's org and `wardId` (when non-null) belongs to it. Takes effect on the user's next request (actor is looked up per request — no token invalidation).

**Existing user routes, org-scoped when flag on** (unchanged flag off):

- `GET /api/admin/users` → org admin sees only own-org users (rows gain `wardId`, `orgId`); instance admin sees all.
- `POST /api/admin/users` → gains optional `wardId`; flag on, created user inherits caller's `orgId`, `wardId` validated against it. Org admins may create members and org admins (same org); only instance admins create instance-level users.
- `disable`/`enable`/`reset-password` → org admin may only target own-org users (403 otherwise).

Stats are computed app-layer from `store.getActive()` + parsed patient JSON (`wardId`, `status`), the same pattern the sync filter uses — no schema change. At pilot scale this is negligible; noted as a promotable hot spot alongside the sync-filter note.

**Storage additions (additive, both backends):** `listUsersByOrg(orgId)`, `hasInstanceAdmin()` (any active user with `role='admin'` and `orgId` null).

### 2. Provisioning — bootstrapAdmin self-heal (flag-on only)

Flag on: `bootstrapAdmin`'s no-op condition becomes "an active instance admin exists" (`hasInstanceAdmin()`), so a hosted instance whose users are all org-scoped recreates the root admin from `ORTHO_ADMIN_USERNAME`/`ORTHO_ADMIN_PASSWORD` on boot. Flag off: the current "any user exists" condition runs untouched — byte-identical, and an operator who deliberately deleted extra admins on self-host is never surprised.

### 3. UI — dedicated Admin view (flag-gated)

Entry: an "Admin" item next to the existing Manage Users entry, rendered only when `/api/health` reports `MULTI_TENANT: true` AND the logged-in user is an admin (role from login response). Flag off: nothing renders — zero UI change.

A full-screen view inside the SPA (same pattern as presentation mode), styled entirely with the app's existing design tokens and AA-contrast standards. No new dependencies; the status breakdown is a plain CSS proportional bar.

- **Stat tiles** (top row, 2-up mobile / 4-up desktop): Departments, Active users, Live patients, Post-op — computed from `GET /api/admin/org`. Tapping Users/Departments scrolls to that section.
- **Organization section**: hospitals as group headers with an add-hospital form; departments as cards in a grid — name, specialty badge, live-patient count, status breakdown bar (postop/preop/conservative/fordischarge in the app's existing status colors), user count, last-activity relative time (reuses `formatRelativeTime`), inline add-department form per hospital.
- **Users section**: search input + department filter chips; table rows: username, role badge, department `<select>` (inline assign → `POST .../assign`), active toggle (disable/enable), reset-password button. Temp passwords surface through the existing show-once pattern.
- **Instance-admin tab** ("Organizations"): visible only to instance admins; org cards with rollup stats, create-org form, and per-org "create org admin" action showing the temp password once. Selecting an org loads its tree view via `GET /api/admin/org?orgId=`.

States: loading skeletons per section; empty states with the add-form inline ("No departments yet — add the first one"); errors surface via the existing toast.

### 4. Error handling

- Every cross-org reference (hospitalId, wardId, target user) → 403 `{error}`; malformed bodies → 400. Names: trimmed, required, max 80 chars.
- Duplicate names allowed (hospitals/departments — real hospitals have duplicate ward names across sites); usernames stay globally unique (existing constraint, acceptable for pilot; revisit at scale).
- Concurrent edits: last-write-wins, no locking (single-org admin teams at pilot scale).
- UI failures leave forms populated so input isn't lost.

### 5. Testing

- **Flag off:** new routes 404; `GET/POST /api/admin/users` responses byte-identical to today (golden-style assertions); `bootstrapAdmin` behavior unchanged; full existing suite green.
- **Flag on (integration, existing harness):** instance admin creates org → org admin → hospitals → departments → users end-to-end, then that user logs in and syncs only their department (ties console to scoping); org admin cannot list/create/assign/disable across orgs (bidirectional); ward-ownership validation; assign-then-next-request takes effect; stats accuracy against seeded fixtures (counts, byStatus, lastActivity); `bootstrapAdmin` self-heal (boot with only org-scoped users → root admin exists; boot with root present → no duplicate).
- **UI (jsdom, existing frontend pattern):** admin entry hidden flag-off/for members; stat tiles and department cards render from a fixture tree; assign dropdown fires the right call; org-tab visibility by role.

## Out of scope

Self-serve signup, email invites, deleting/renaming orgs/hospitals/departments (disable-users covers offboarding; deletes with attached patient data deserve their own design), billing, migration tool, audit log, per-department template scoping.
