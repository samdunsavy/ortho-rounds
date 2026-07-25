# Spec 2: Admin Command Center UI — Design

**Date:** 2026-07-24
**Status:** Approved (design). Scope: replace the current single-column admin console with a desktop-first master-detail "command center" that drives the structural-operations backend (Spec 1) — rename, move, delete-empty — and unifies all user management (assign, bulk-assign, create, disable/enable, reset password) into one surface. Companion to **Spec 1: Structural Operations Backend** (shipped). Patient re-homing and ward/nurse scoping are deferred.

## Problem

The structural-operations backend shipped with **no UI at all**: rename, move, delete-empty, bulk-assign, and repair-ancestry are reachable only by curl. The production migration made that gap concrete — the live tree now carries 9 stale v1 units and 8 legacy ward docs that need deleting, auto-generated node names (`Default`, `Ortho`, `General`) that need renaming, and a user (`xavier1`) whose `orgId` disagrees with its assignment.

The existing console has three further defects:

- **The assignment picker has no Organization level.** All three members are assigned `org:bfv2-org`, so the picker finds no matching option and renders them as "— none —" — they look unassigned when they are not.
- **User management is split**: assignment lives in the console, while create/disable/enable/reset-password live in a separate legacy "Manage Users" modal.
- **No search, no bulk.** Assigning many users means one dropdown at a time.

## Decisions (settled with Xavier)

- **Full command-center redesign** (feel + function), not an incremental patch.
- **Desktop-first master-detail; mobile read-only.** Phones get a readable stacked view (stats + structure); editing controls are hidden with a "open on a larger screen to edit" note. Admin work is desk work.
- **Structure + users only.** Bulk patient re-homing is out of scope (patient-centric, needs its own picker/search — a natural second pass).
- **Layout: master-detail** (tree navigator + context detail panel), chosen over an enhanced accordion (operations scatter, degrades past a few dozen nodes) and a data-table (poor at conveying hierarchy).

## Non-negotiables

- **Flag off → byte-identical.** With `MULTI_TENANT` off the console is unreachable exactly as today; no new behavior. Existing suite + `tests/server-sync-golden.test.js` green.
- **No new backend routes.** This spec is UI-only; it consumes the Spec-1 routes as shipped. (If a gap is found, it is raised, not silently patched here.)
- **Server-authoritative ancestry preserved.** The UI never computes or caches ancestry: after any mutation it re-fetches and re-renders.
- **No new dependencies**; existing design tokens (`var(--card)`, `var(--line)`, `var(--ink)`, …) and AA contrast.

## Design

### 1. File structure

`public/app.js` is ~374 KB; the console is a self-contained surface, so it moves to a new **`public/admin-console.js`**, loaded alongside the existing `milestones.js` / `admission-bridge.js` / `clinical-normalize-bridge.js`. `app.js` retains only the entry points that open/close the view. The legacy "Manage Users" modal and its handlers are **deleted** from `app.js` (its functions are absorbed by the Users view).

### 2. Layout

**Desktop (≥ 900px)** — two panes inside the existing full-screen `#adminView`:

- **Left rail (~280px): tree navigator.** `Org → Hospital → Department → Unit → Ward`, collapsible, each row showing its live-patient count. Two fixed entries above the tree: **Users**, and **Organizations** (instance admin only). Selection is client-side state, restored after every data reload.
- **Right panel: context detail for the selection.**
  - **Node header:** name, type badge, and the three structural actions — **rename** (inline edit → `PATCH /api/admin/nodes/:type/:id`), **move** (`POST /api/admin/nodes/:type/:id/move`; the picker lists only same-org nodes of the correct parent type — hospital for a department, department for a unit, unit for a ward; org/hospital are not movable so the control is absent), **delete** (`DELETE /api/admin/nodes/:type/:id`; disabled when non-empty, labelled with the `409 blockedBy` counts, e.g. "Can't delete — 3 patients, 1 user").
  - **Stats:** live patients, status breakdown bar, users assigned, last activity (reusing `formatRelativeTime`).
  - **Children:** list of child nodes with an inline add-child form (`POST /api/admin/hospitals|departments|units|wards` with the parent id).
  - **Users assigned here:** list with quick reassign/unassign.

**Mobile (< 900px)** — single column: the tree becomes a breadcrumb drill-down; stats, structure, and user lists render read-only; all create/rename/move/delete/assign controls are hidden behind a short "open on a larger screen to edit" note.

### 3. Users view

Selected from the left rail; absorbs the legacy Manage Users modal so user management lives in one place.

- **Toolbar:** search box (username substring) + filter-by-node.
- **Create user** inline form (`POST /api/admin/users`), temp password shown once via the existing show-once pattern.
- **Row:** username, role badge, **assignment picker**, active toggle (`/disable`, `/enable`), reset-password (`/reset-password`, temp password shown once).
- **Assignment picker** groups by level: **Organizations**, Hospitals, Departments, Units, Wards; option values encode `"type:id"`. It **must** include the Organization level (today's omission is why org-assigned users render as "— none —"). An assignment whose node no longer exists renders explicitly as `Stale (<type>:<id>)` rather than blank, so orphaned references are visible.
- **Bulk assign:** row checkboxes; when ≥1 is selected a bar shows the count plus a node picker → one `POST /api/admin/users/assign-bulk`. Clearing the picker unassigns.

**Organizations tab** (instance admin only) keeps today's behavior: org cards with rollup stats, create-org, create-org-admin (temp password shown once), and "view" to load that org's tree.

### 4. Data flow

Deliberately simple. On open, fetch `GET /api/admin/org` + `GET /api/admin/users` (+ `GET /api/admin/orgs` for instance admins) into one client-side model. Selection is local state. **After any mutation: re-fetch, re-render, restore the selected node.** No optimistic updates and no client-side cache invalidation — at pilot scale the reload is instant, and it guarantees the UI can never disagree with the server about ancestry.

### 5. Error handling

- `409` from delete → the button stays disabled and shows the `blockedBy` counts as its reason.
- `403` → toast; no state change.
- `400` (validation, e.g. name > 80 chars) → inline message; the form keeps its input.
- Destructive actions (delete node, disable user) require a confirm step.
- A mutation referencing a node deleted by a concurrent admin → toast + reload.

### 6. Testing (jsdom, existing frontend pattern)

- Tree renders from a fixture tree and selects a node; selection survives a data reload.
- Detail panel renders correctly per node type (org/hospital/department/unit/ward), including the absence of the move control on org/hospital.
- Rename posts `PATCH` with the new name; a >80-char name shows the inline error and posts nothing.
- Delete is disabled with the `blockedBy` reason when non-empty; posts `DELETE` when empty.
- Move offers only valid same-org parents of the correct type and posts to `/move`.
- Add-child posts the right route/body per level.
- Users: search narrows rows; the assignment picker contains an **Organizations** optgroup and preselects an `org:`-assigned user; a stale assignment renders as `Stale (...)`; bulk-assign posts `{userIds, nodeType, nodeId}` for the checked rows; create/disable/reset call their routes.
- Mobile width (< 900px) hides editing controls and renders the read-only view.
- Flag off → the console entry points stay hidden and the view renders nothing.

## Out of scope

Bulk patient re-homing (next pass); drag-and-drop assignment; audit log of admin actions; ward-level ("nurse") scoping; new backend routes; promoting the app-layer patient scan to indexed queries.
