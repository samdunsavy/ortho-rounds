# Patient Move — Scope-Derived Permission, Org Clamp, and Audit — Design (Spec A)

**Date:** 2026-07-26
**Status:** Approved (brainstorm). Behind `MULTI_TENANT`. This is Spec A of two: A = the move *logic* (who may move, the org boundary, the audit trail) plus the main-list Organize surface. Spec B (admin-console patient view + multi-level search) builds on this and is written separately.

## Context

A patient is pinned to a `unitId` carrying denormalized ancestry (`orgId/hospitalId/departmentId`). "Moving" a patient means changing `unitId`; the server re-stamps ancestry from the new unit (`decideWrite` in `scope.js` → `resolveAncestry`). Today only the `admin` role may reassign a unit: `decideWrite`'s existing-patient branch honors an incoming `unitId` **only when** `isAdmin && (scope.unrestricted || scope.unitIds.has(requested))`; any non-admin's `unitId` is ignored and the stored ancestry is force-stamped. The only roles are `admin` and `member`. There is **no audit trail** of moves — the app stamps per-field attribution (milestone `doneBy`, `statusUpdatedBy`, complication `by`) but records nothing about unit reassignment.

Two consequences at scale: (1) sorting patients is bottlenecked on full admins even though the natural "unit lead" is a senior PG who oversees a department; (2) the unrestricted instance admin can move a patient into a *different organization* (its scope includes every org's units, and its move picker now lists them all), silently relabeling a patient across tenants.

Decisions from the review (Xavier, 2026-07-26): **Option B (scope-derived move)** — permission falls out of the tree, no new role yet; **org clamp** — moves never cross organizations, for anyone including the super admin; **audit required now**. Scaling pressures: more patients per ward, more units/departments, more users. Cross-org "re-home" is explicitly not built. A named `lead`/registrar role is a later refinement.

## Non-negotiable

Flag off: no scope, no `activeScope`, moves behave exactly as today (member `unitId` ignored, admin reassigns; no `moveHistory`). Every change is gated by `MULTI_TENANT`. The permission change can only ever let an actor move a patient *among units already in that actor's scope* — never read or write outside `resolveScope(actor)`. `moveHistory` is server-owned: the client can never forge or rewrite an entry.

## Design

### 1. Scope-derived move permission (`scope.js` `decideWrite`, flag on)

Replace the `isAdmin`-gated reassignment in the existing-patient branch with a scope-and-org test that applies to every role:

```js
if(existing){
  if(!canRead(existing, scope)) return { allow: false };
  const requested = incoming?.unitId;
  if(requested && requested !== existing.unitId
     && (scope.unrestricted || scope.unitIds.has(requested))){
    const target = await resolveAncestry(store, requested);
    // Org clamp: a move never crosses organizations. First placement of an
    // as-yet-unassigned patient (no orgId) is allowed — it is placement, not
    // a cross-org move.
    const sameOrgOrUnassigned = !existing.orgId || (target && target.orgId === existing.orgId);
    if(target && sameOrgOrUnassigned){
      return { allow: true, ancestry: target, moved: { from: existing.unitId || null, to: requested } };
    }
  }
  // Not a legitimate reassignment (out of scope, or would cross orgs):
  // force-stamp the stored ancestry so a client-supplied unitId is ignored.
  return { allow: true, ancestry: await resolveAncestry(store, existing.unitId) };
}
```

Consequences, all falling out of scope arithmetic:

- A member pinned to **one** unit has `scope.unitIds = {that unit}` — `requested` can only equal their own unit, so they can't move anyone out. Correct: a bedside PG can't relocate patients.
- A member assigned at a **department** has every unit under it in scope — they can move patients among those units. This person *is* the "unit lead"; no new role.
- An **org admin** moves within their org (their scope is the org).
- The **super admin** (`unrestricted`) can move, but the org clamp restricts targets to the patient's own org — cross-org moves are impossible in the normal path.
- New-patient creation is unchanged (this branch is existing-patient only).

The `moved` field on the decision is the signal the sync handler uses to write an audit entry.

### 2. Move audit — server-owned `moveHistory` (`server.js` sync handler + `merge.js`, flag on)

`moveHistory` is an append-only array on the patient JSON: `{ from, to, fromLabel, toLabel, by, at }`. It is **server-owned** — the sync handler rebuilds it from stored truth and ignores any client-supplied `moveHistory`, so a client can neither forge nor rewrite entries (stronger than the position-based trust used for complications):

- When `decision.moved` is set and the write is applied, the handler sets `stored.moveHistory = (existingObj.moveHistory || []).concat([{ from, to, fromLabel, toLabel, by: actor.username, at: now }])`, where `from/to` are unit ids, `fromLabel/toLabel` are the unit names resolved server-side, `by` is the authenticated actor, `at` is server `now`.
- When no move occurs, `stored.moveHistory = existingObj.moveHistory || []` (carried forward untouched). Client-supplied `moveHistory` on the incoming payload is always discarded before this.
- `merge.js` `mergePatientRecords` unions `moveHistory` deduped by the signature `${at}|${from}|${to}` and sorted by `at` — matching the append-only treatment of `planHistory`/`complications`, and safe because only the server appends.

The patient detail view renders the history as a timeline line: "Moved from <fromLabel> to <toLabel> by <by> on <date>." (Read-only.)

### 3. Move UX — surface it, gate it to who can actually move (`public/app.js`, `public/index.html`, flag on)

Two jobs, kept separate:

- **One-off placement** stays in the patient edit screen's department/unit picker. No new UI — the picker already renders whenever `scopePickerActive()` and is unlocked for multi-unit scopes; a department-scoped PG can already change the unit there, and after §1 the server now accepts it. (Previously their change was silently ignored.)
- **Bulk move** stops hiding behind "Bulk plan." The existing bulk "Move to unit" button's visibility gate changes from `isAdmin() && scopePickerActive()` to **`scopePickerActive() && flatUnitsFromScopeTree(tree).length >= 2`** — i.e. it shows exactly when the actor has somewhere to move patients, which matches the new server permission (single-unit PGs and flag-off users never see it). Add a **More → "Organize patients"** entry that toggles bulk-select mode and shows the existing hint, so the reorg flow is discoverable rather than incidental.
- **Unit filter:** add a lightweight client-side filter (visible under the same "can move" condition) that filters the rendered list by `unitId`, including an "Unsorted / General" option, so a lead can pull up "everyone still in the General bucket" and verify a unit's roster before and after moving. Client-side over already-loaded patients (Spec B adds server-side, level-bounded search for scale).

## Error handling

- An out-of-scope or cross-org `unitId` in a sync payload is not an error — the stored ancestry is force-stamped (the change is ignored), matching the endpoint's existing silent-skip contract. No audit entry is written for an ignored change.
- A `requested` unit that doesn't resolve (`resolveAncestry` null) falls through to force-stamping the existing unit.
- Flag off: `decideWrite` is not invoked with a scope; the whole path is inert and `moveHistory` is never added.

## Testing

- **`decideWrite` (pure, `tests/scope.test.js`):** a department-scoped member moves a patient between two in-scope units (allowed, `moved` set); a unit-pinned member's cross-unit `unitId` is ignored (force-stamp); a move whose target is another org is rejected even for an unrestricted scope (org clamp), while same-org is allowed; first placement of an unassigned patient (no `orgId`) is allowed; an out-of-scope target is ignored.
- **Sync integration (`tests/server-scoping.test.js`):** a department-assigned PG moves a patient across the department's units and it persists; a unit PG cannot; the super admin cannot move a patient into org2; each accepted move appends one `moveHistory` entry with `by` = the authenticated user and server-resolved labels; a client that sends a forged `moveHistory` (fake `by`) has it discarded — stored history reflects only server-stamped entries.
- **Merge (`tests/frontend-sync-merge.test.js` / `tests/merge.test.js`):** `moveHistory` unions without duplicates across two devices and stays sorted by `at`.
- **Frontend (`tests/frontend-*`):** the bulk-move button shows for a 2+-unit scope and hides for a single-unit scope and flag-off; the unit filter narrows the rendered list including the Unsorted option.

## Out of scope (this spec)

Admin-console patient view and multi-level patient search (Spec B). A named `lead`/registrar role (later refinement — Option B delivers the capability via tree assignment for now). Cross-org "re-home" of a patient (deliberately not built). Any change to new-patient creation or to the viewing/`activeScope` model shipped earlier.
