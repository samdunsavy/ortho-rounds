# Phase 2: Deep Hierarchy (Ward + Unit) + Data Backfill — Design

**Date:** 2026-07-22
**Status:** Approved (design). Scope: extend the MULTI_TENANT tree two levels deeper (Ward, Unit), pin patients to a Unit with denormalized ancestry, generalize access scoping to any-node subtrees, and backfill existing production (Mongo) data ahead of enforcement. Mongo-first; SQLite frozen for the flag-off self-host path.

## Problem

Phase 1 shipped the org tier: `organizations → hospitals → departments` (the table is literally named `wards` in the DB but means *department*), user assignment at department level, and app-layer sync scoping. But the clinical app only knows two *free-text* labels on each patient — `ward` (e.g. "7FOW") and `unit` (e.g. "IV") — with no structural meaning. The business goal is a fully aligned hierarchy **Organization → Hospital → Department → Ward → Unit**, where patients and access flow through every level.

Two concrete gaps today:

- **No place for patients in the tree.** A patient carries `unitId`? No — it carries at most a `wardId` (= department) stamped on sync. Ward and Unit as real, assignable levels do not exist.
- **Multi-unit admins can't create patients.** `decideWrite` requires a target department for a new patient; an admin spanning multiple departments has no `wardId` and no picker, so creation returns `{allow:false}`. Deepening the tree makes an explicit patient placement mandatory and closes this gap.
- **Old data strands on enforcement.** Every existing patient has no `unitId`; the moment scoping enforces, `canRead` treats them as unassigned = instance-admin-only, so clinicians and org admins see empty lists.

## Non-negotiables

- **Flag off → byte-identical.** With `MULTI_TENANT` off: new routes 404, no ancestry stamping, no scope filtering, `bootstrapAdmin` untouched, existing suite + golden tests green. The SQLite self-host single-tenant path is unchanged.
- **Cross-org isolation preserved and extended.** Every new level reuses the shipped primitives (`isInstanceAdmin`, org-admin = `role==='admin' && orgId`). Every cross-org reference (any node id) → 403.
- **No patient ever vanishes.** Backfill completes and is verified *before* enforcement engages (backfill-before-enforce). There is never a stranded state.

## Decisions (settled with Xavier)

- **Tree shape: strict linear nesting** — `Department → Ward → Unit`. Each Unit belongs to exactly one Ward, each Ward to one Department.
- **Access model: subtree scoping.** A patient is pinned to a **Unit** (leaf) and inherits Ward → Department → Hospital → Org. A user is assigned to **any node**; their scope is that node's entire subtree (resolved to a set of unit ids). Instance admin = unrestricted; unassigned (no `unitId`) = instance-admin-only.
- **Data model: explicit table per level (Approach A).** Rename `wards` → `departments`; add real `wards` and `units` tables. Patient carries `unitId` plus a **denormalized ancestry** `{unitId, wardId, departmentId, hospitalId, orgId}` stamped server-side at write time.
- **Storage: Mongo-first, SQLite frozen.** The multi-tenant tree only exists in the hosted world; build it and the backfill in the Mongo backend only. SQLite keeps serving the flag-off single-tenant self-host/dev path unchanged — no SQLite parity required for the new tables.
- **Portability features, repositioned:** JSON `/api/export` + `/api/import` stay (data ownership / DR / instance-to-instance moves). Raw-SQLite-file `/api/backup` is self-host-only (meaningless on Mongo). Offline PWA cache + sync stay (core clinical UX, backend-independent). Peer "sneakernet" import is legacy self-host — no further investment.

## Design

### 1. Data model (Mongo)

Rename the `wards` collection/table to `departments` (fields unchanged: `id, hospitalId, name, specialty, createdAt`). Add:

- `wards`: `{ id, departmentId, name, createdAt }`
- `units`: `{ id, wardId, name, createdAt }`

Entity chain: `organizations → hospitals → departments → wards → units`, each row holding a parent FK.

**Patient record (JSON, no patients-table schema change):** gains `unitId` as source of truth plus denormalized ancestry `{ unitId, wardId, departmentId, hospitalId, orgId }`. The free-text `p.ward` / `p.unit` strings survive as **derived display labels** (set to the unit's ward name and unit name) so all clinical-display code paths (rounds grouping, OT-list, print templates, presentation — ~30 call sites reading these strings) are untouched.

**Why denormalized ancestry:** keeps the per-patient scope check O(1) (`scope.unitIds.has(patient.unitId)`), makes cross-level rollups flat filters (no joins), and is the promotion path for scaling (see §6).

### 2. Access scoping (`scope.js` generalization)

`resolveScope(actor, store)` today walks hospitals → wards to build a flat ward-id set for org admins. Generalize:

- Instance admin (`role==='admin'`, no `orgId`) → `{ unrestricted: true }`.
- Any assigned actor → resolve the **subtree rooted at their assignment node** down to a set of **unit ids** (walk the explicit tables once per request). Assignment at Department yields all units under it; assignment at Unit yields one.
- Member with a single unit → set of that one unit id.

`canRead(patient, scope)` becomes `scope.unrestricted || scope.unitIds.has(patient.unitId)` (unassigned → `includeUnassigned`, instance-admin-only). `decideWrite` stamps a new patient's full ancestry from the writer's assignment, or from a chosen unit for multi-unit admins; a member inherits their assigned unit automatically.

**Reused seam:** the sync write path already overrides `stored.wardId` from a server-computed `decision` after merge (server.js ~570). This widens to stamp the full ancestry object from `decision` — same server-authoritative seam, no new trust boundary. `mergePatientRecords` is field-permissive (`Object.assign({}, remote, local)`), so `unitId`/ancestry ride through and the post-merge override keeps them authoritative.

### 3. API — new routes (Mongo, flag-gated: off → 404)

Guards reuse Phase 1: org admins operate on their own `orgId`; an instance admin targets explicitly (`?orgId=` on GET, `orgId` in body on POST). Any cross-org reference → 403; malformed body → 400; names trimmed, required, ≤ 80 chars.

- `POST /api/admin/wards` `{ departmentId, name }` → ward under a department; validates department ∈ caller's org.
- `POST /api/admin/units` `{ wardId, name }` → unit under a ward; validates ward's department ∈ caller's org.
- `GET /api/admin/org` → org tree now nested to units, with stats rolled up (`buildOrgTree` recurses to units).
- `POST /api/admin/users/:id/assign` `{ nodeId, nodeType }` (or `null` to unassign) → assign a user to any node; validates node ∈ caller's org. Takes effect on the user's next request (actor looked up per request — no token invalidation).

Existing department route (`POST /api/admin/wards` in Phase 1, now department-level) is renamed to `POST /api/admin/departments` for clarity; the old path is not kept (flag-gated, minimal live data).

### 4. UI

**Admin console** (extends the Phase 1 view): Department cards gain an inline add-ward form; Ward rows gain an add-unit form. Stats roll up per level. User assignment becomes a node picker (org / hospital / dept / ward / unit) instead of a department `<select>`.

**Patient form:** the free-text "Ward group" + "Ortho unit" inputs become a **cascading picker** Department → Ward → Unit, populated from the caller's scope. A single-unit member gets it pre-filled + read-only (zero extra clicks). A multi-unit admin must pick a unit (closes the creation gap). On save the client sends `unitId`; the server stamps ancestry and derives the label strings. Rounds grouping stays keyed on the `ward` label, so the visible list is unchanged for existing users.

### 5. Migration — backfill-before-enforce (Mongo)

Two-phase rollout:

**Phase A — backfill while the flag is still OFF** (a pure data write; scoping isn't enforced, so it's harmless and re-runnable):

1. Snapshot first (JSON `/api/export`).
2. Reconstruct the tree from distinct **normalized** free-text values: one Ward per distinct `ward` string, one Unit per distinct `unit` under it, all under a default `Department → Hospital → Organization`. Blank/garbage → a **"General" unit** so nothing is orphaned.
3. Stamp every patient's `{unitId, wardId, departmentId, hospitalId, orgId}` from that mapping.
4. Assign existing users to nodes (default: org root, so they keep seeing everyone until narrowed).
5. Reviewable/editable in the admin console before enforcement. Idempotent (keyed on patient id → unit). **Single-bucket** (everything → one "General" unit) is the fallback if live data is too messy.

**Phase B — flip the flag.** Every patient now has a `unitId` and every user an assignment; enforcement engages with zero stranding.

### 6. Scaling note (documented, not built)

Stats and scoping load all active patients and filter app-layer (`store.getActive()` + JSON parse) — the Phase 1 spec already flagged this as a promotable hot spot. Deepening the tree does not worsen it, but at many-org/many-hospital scale the full-scan-per-sync is the ceiling. Because each record carries its own ancestry, the fix is set up: promote `orgId`/`unitId` to indexed columns/fields on the patients store and swap the app-layer filter for an indexed query — no model change. Not built now (YAGNI at pilot scale).

### 7. Error handling

- Every cross-org node reference → 403 `{error}`; malformed bodies → 400. Names trimmed, required, ≤ 80 chars. Duplicate names allowed across siblings; usernames stay globally unique.
- Concurrent edits: last-write-wins, no locking (pilot-scale single-org teams).
- Patient creation with no resolvable unit for a multi-unit admin → 400 (must pick a unit); a single-unit member always resolves automatically.
- UI failures leave forms populated so input isn't lost.

### 8. Testing (Mongo, existing harness)

- **Flag off:** new routes 404; `bootstrapAdmin` unchanged; existing suite + golden assertions green; SQLite path untouched.
- **Flag on:** tree CRUD at ward + unit; cross-org 403 at every level (bidirectional); subtree scoping (unit member sees one unit; dept head sees all units under the dept; instance admin sees all); ancestry stamping correctness + derived-label correctness; assign-then-next-request takes effect; multi-unit admin must pick a unit.
- **Backfill:** reconstruction from fixture free-text values (normalization, "General" fallback); idempotency (re-run = no duplicates); no-stranding (post-backfill every patient has a `unitId`); single-bucket fallback path.
- **UI (jsdom):** cascading picker populates from scope and pre-fills a single-unit member; admin node picker; ward/unit add forms render and fire the right calls.

## Out of scope

SQLite parity for the new tree; deleting/renaming orgs/hospitals/departments/wards/units (disable-users covers offboarding; deletes with attached patient data deserve their own design); billing; self-serve signup; email invites; audit log; promoting scope/stats to indexed queries (documented in §6 as the next scaling step).
