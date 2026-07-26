# Admin Patient Reorganization + Scoped Viewing — Design

**Date:** 2026-07-26
**Status:** Approved (brainstorm). Two cohesive features behind `MULTI_TENANT`: a bulk move-to-unit action for reorganizing existing patients, and an `activeScope` seam + admin scope selector for viewing one slice at a time. Multi-org behavior is designed here but built later (Phase 2).

## Context

After `backfill-hierarchy-v2`, every active patient was re-homed into a single tree — `Default` org → `Default` hospital → `Ortho` department — and bucketed into a Unit derived from its old free-text `unit` label (or `General` when blank), with an optional Ward from the old `ward` label. So all patients sit in one org/hospital/department, split into units only by their prior unit text. There is no bulk or cross-org patient move today: an admin can repoint one patient at a time by editing it and choosing a unit in the patient-form picker (the server restamps ancestry via `decideWrite`). The command console shows structure plus live-patient *counts* per node, not a patient list; the actual list is the main screen, scoped by the caller's assignment via `/api/sync`. The unrestricted instance admin currently sees every patient in one flat list.

Roadmap inputs (Xavier, 2026-07-26): build for a single org now but phased for multi-org SaaS; a super admin views **detail, one organization at a time** (never a cross-org mixed list); the immediate need is **splitting the Default bucket into real departments/units**; scale is **under 50 live patients per hospital**, so simplicity beats cleverness and re-pull-on-switch cost is negligible.

## Non-negotiable

Flag off (`ORTHO_FLAG_MULTI_TENANT` unset): no scope picker, no `activeScope`, legacy behavior byte-identical. Flag on, single org: both features default to near-invisible (one org auto-selected; bulk-move admin-only). `activeScope` can only ever **narrow** a caller's existing permission scope — never widen it — so it introduces no privilege escalation for any role. The existing access model (assignment-based `resolveScope`) is unchanged; `activeScope` layers on top.

## Feature A — Bulk move-to-unit (frontend only)

The reorganization tool. Reuses the existing multi-select mode (`bulkSelectMode` / `bulkSelectedIds`, today used for "Apply plan").

- **Trigger:** a second bulk action button, "Move to unit…", rendered only for admins (`role === 'admin'`). A member never sees it — the server would ignore a member's unit reassignment anyway (`decideWrite` only honors `unitId` changes from admins), so gating it in the UI keeps the affordance honest.
- **Picker:** a modal listing units from the cached scope tree (`/api/me/scope`), the same source the patient form uses. The instance admin now gets the whole-instance tree, so every unit is selectable.
- **Apply:** for each selected patient, set `unitId` to the target, clear `wardId` (the server re-validates and drops a ward that isn't under the new unit — existing sync behavior), mark `_dirty`, and sync. The server's existing admin path in `decideWrite` restamps `{unitId, departmentId, hospitalId, orgId}` + `unit` label from server truth. **No server change.**
- **Guardrails:** target unit required; a "Move N patient(s) to <unit>?" confirm; the action is a no-op for a member if one somehow reaches it (server drops the change — surfaced via the existing `rejected`/eviction path only if out of scope).
- **Interaction with eviction:** moving a patient out of the admin's active scope evicts it from the local list on the next sync (the `rejected`/reconcile machinery already handles this) — correct and expected.

## Feature B — `activeScope` seam + admin scope selector

One mechanism for both today's drill-down and tomorrow's one-org-at-a-time isolation.

### B1. Server seam (built now, additive, flag-on only)

The sync request body may carry an optional `activeScope: { type, id }` (a hierarchy node). In the sync handler, after `resolveScope(actor)`:

- If `activeScope` is absent → effective scope = permission scope (today's behavior).
- If present → compute the node's unit set (`listUnitIdsUnder`) and **intersect** it with the permission scope's unit set. The result is the effective scope used for the read filter (`canRead`), write decisions (`decideWrite`), and the `scoped` / `rejected` signals. `unrestricted` collapses to the intersected set (an unrestricted admin with an `activeScope` becomes restricted to that subtree; `scoped` becomes `true`).
- Validation: a malformed or unknown `activeScope`, or one that intersects to empty, yields an empty effective scope (fail closed) — never an error, matching the endpoint's existing silent-skip contract. Because it is an intersection, a low-privilege caller can never widen their view.

This reuses `listUnitIdsUnder` and the eviction signals shipped in `2026-07-26-scope-eviction-sync`. Switching `activeScope` re-scopes the pull; the previous slice's patients fall outside the effective scope and are evicted from cache, then re-fetched on widen. Inert until a client sends the field — so flag-on single-org installs that never send it are unchanged.

### B2. Client scope selector (built now)

An admin-only scope dropdown sourced from `/api/me/scope`, letting the admin pick a department / unit (Phase 2: org) to view. Its default option is "All" — which sends **no** `activeScope`, i.e. the caller's full permission scope, which for a single org *is* that whole org. Picking a narrower node attaches `activeScope: {type,id}` to every sync request. The selection persists in `localStorage`; changing it clears the sync cursor and triggers a full re-pull (the eviction path clears the prior slice), so the local list only ever holds the active slice. For a single-org install the "All" default already shows exactly that org, so the selector reads purely as a department/unit drill-down.

### B3. Multi-org behavior (Phase 2 — designed, not built now)

When two or more organizations exist, three small additions on top of the same seam:

1. A super admin (unrestricted, no `activeScope`) sees an **empty list + "pick an organization" prompt** rather than a cross-org flat list — the literal enforcement of one-org-at-a-time.
2. The selector's top level becomes an **org switcher** (needs an org-list source — either extend `/api/me/scope` with org grouping or add `GET /api/me/orgs`).
3. Optionally a lightweight cross-org **rollup dashboard** (counts only, reusing `buildOrgRollups`) — counts are not PHI, so this does not violate the detail-one-org-at-a-time stance.

None of these change the B1 seam; they are additive UX. Explicitly out of scope for the first implementation.

## Error handling

- `activeScope` never errors: unknown/malformed/empty-intersection → empty effective scope (fail closed), consistent with sync's silent-skip losers.
- Bulk move of a patient the admin can't write (out of effective scope) is dropped server-side and evicted client-side via the existing `rejected` path — no partial-write corruption.
- Flag off: neither the request field nor the selector exists; golden flag-off sync contract unchanged.

## Testing

- **Server (`activeScope`):** an unrestricted admin with `activeScope` on a department sees only that department's patients and `scoped:true`; a member's forged `activeScope` pointing outside their assignment intersects to their own scope or empty (no escalation); absent `activeScope` reproduces today's per-role results (existing scoping tests stay green); flag-off ignores the field (golden contract unchanged).
- **Frontend (bulk move):** admin sees the "Move to unit…" action and a member does not; applying it sets `unitId` on each selected patient and marks them dirty; the ward is cleared on a cross-unit move.
- **Frontend (selector):** changing the active scope persists to `localStorage`, re-pulls, and narrows the rendered list; single-org default auto-selects the one org.

## Out of scope

Cross-org patient moves (not requested). A separate cross-org PHI dashboard. Per-patient assignment (location scoping is sufficient — see `patient_scoping_direction`). Any change to the assignment-based permission model. Phase 2 multi-org UX (org switcher, empty-state prompt, rollups) beyond the seam that enables it.
