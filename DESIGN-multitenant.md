# Multi-Tenant Data Model — Design (Roadmap Phase 1)

Status: **schema scaffolded, not yet wired into the API.** This document is
the blueprint for the rearchitecture ROADMAP.md calls the highest-risk,
most-unblocking piece of Phase 1. What's shipped so far (this pass) is the
additive schema and storage-layer CRUD only — every query the running app
actually makes is unchanged. Wiring auth/sync/admin to *use* this hierarchy
is the next dedicated pass, described at the bottom.

## Hierarchy

```
organization (the paying customer / company account)
  └── hospital (a physical site — an org can have many)
        └── ward (a department/team — ortho, general surgery, medicine…)
              └── users (PGs/attendings, already scoped by role)
              └── patients (already exist; gain an optional wardId)
```

Today's single-tenant model is the degenerate case of this hierarchy: one
org, one hospital, one ward, implicit. Nothing about existing installs needs
to model that explicitly — `orgId`/`wardId` being `NULL` on every row *is*
"single-tenant mode."

## Schema (shipped this pass)

**New tables/collections** (SQLite: `organizations`, `hospitals`, `wards`;
Mongo: same three collections):

- `organizations`: `id`, `name`, `plan` (`free`/`paid`), `createdAt`
- `hospitals`: `id`, `orgId`, `name`, `createdAt`
- `wards`: `id`, `hospitalId`, `name`, `specialty` (default `'ortho'` — this
  is also the hook for Phase 3's specialty templates), `createdAt`

**Existing tables, additive columns:**

- `users` gains nullable `orgId`, `wardId`. Existing rows: both `NULL`.
  Added via `addColumnIfMissing()` in `storage.js`, so upgrading an existing
  `data/ortho.db` just works — no destructive migration, no downtime.
- `patients` gets **no new SQL column**. A patient's ward membership will
  live inside the existing JSON `data` blob (same place `diagnosis`, `plan`,
  etc. already live) as an optional `wardId` field, exactly like every other
  patient field today. This avoids a schema migration on the largest, most
  sensitive table in the system.

Storage-layer CRUD added for all three new entities (`createOrganization`,
`getOrganization`, `listOrganizations`, `createHospital`, `getHospital`,
`listHospitalsByOrg`, `createWard`, `getWard`, `listWardsByHospital`) —
mirrored identically across the SQLite and MongoDB backends, matching the
existing pattern in `storage.js`.

## Why this is safe to ship ahead of the rest of Phase 1

- Every new table/collection starts empty and stays empty until something
  calls the new CRUD methods — nothing does yet.
- `users.orgId`/`wardId` are `NULL` for every row that exists today and for
  every row `createUser()` creates until a caller explicitly sets them.
- No existing route, query, or test reads these fields. The full existing
  test suite (84 tests as of this pass) passes unchanged.
- Gated overall by the `MULTI_TENANT` flag (`flags.js`) for anything that
  *does* eventually read them — see rollout plan below.

## What "wiring it in" means (next pass, not done yet)

This is deliberately not bundled into the schema pass — it touches auth,
sync, and the admin console simultaneously, and deserves its own review:

1. **Auth scoping.** `POST /api/login` and every authenticated route currently
   assume one flat user list. Once `MULTI_TENANT` is on, a user's `orgId`
   needs to scope which patients/wards they can even query.
2. **Sync scoping.** `/api/sync` currently returns "everything changed since
   `since`" for the whole instance. Multi-tenant mode needs it scoped to the
   caller's ward (and possibly cross-ward for a hospital-wide admin view).
   This is the highest-risk change in the whole roadmap — it's the endpoint
   every existing client already depends on, hence why `/api/sync/v1` was
   versioned first (see Phase 0 work).
3. **Org/ward admin console.** CRUD UI for an org admin to create hospitals,
   wards, and invite users into them — net-new frontend surface.
4. **Self-host migration tool.** A one-way, customer-run script: take an
   existing single-tenant SQLite/Mongo instance, create one org/hospital/ward
   for it, backfill every existing user and patient into that ward, and
   optionally push the result into the hosted multi-tenant backend. Reversible
   via the existing export, per POLICY.md.

## Rollout plan

- Phase 1 (now → next pass): schema exists, inert. ✅ done this pass.
- Phase 1 (next pass): ✅ done — 2026-07-22: auth + sync scoping behind `MULTI_TENANT`, tested
  with the flag both on and off — off must remain byte-for-byte identical
  to today's behavior, which is the whole point of building it as a flag
  rather than a rewrite.
- Phase 1 (later): migration tool + admin console, first hosted pilot org.
