# Scope-Aware Sync Eviction — Design

**Date:** 2026-07-26
**Status:** Proposed. Scope: make the offline cache and sync reconcile respect `MULTI_TENANT` unit-scoping, so a device never gets stuck retrying — or resurrecting — patients its user can no longer see. Server + client, behind the existing flag.

## Problem

Unit-scoping (scope.js) gates `/api/sync` reads and writes correctly on the server, but three client behaviors predate scoping and collide with it. A patient that a device has cached but its user can no longer access — legacy pre-scoping data, or a patient reassigned to a unit outside the user's node — becomes a permanent "ghost":

1. **Silent write-drop.** In the sync handler, an out-of-scope change hits `decideWrite → { allow:false }` and the server does `continue` (server.js) — nothing stored, nothing acknowledged.
2. **Dirty never clears.** The client clears `_dirty` only for records that echo back in `res.patients` with a matching id or newer `updatedAt` (app.js `syncNow`). A dropped record never echoes, so `_dirty` stays `true` forever: a permanent "N pending" chip and a record re-pushed and re-rejected every cycle.
3. **Reconcile resurrects it.** `reconcileWithSnapshot` pulls a `since:0` snapshot — already `canRead`-filtered — and for any local row *missing* from it takes the `if(!serverRec)` branch, which assumes "missing from a full snapshot = server lost its database" and flips the clean row back to `_dirty` to re-upload. Under scoping, "missing" means "not yours," so the disaster-recovery heuristic manufactures the very ghost it then can't clear.

Compounding symptom: `reloadFromCache` loads every cache row regardless of scope, so the user keeps *seeing* stale out-of-scope patients locally the entire time.

There is **no read or write leak** — the server filter is correct. This is purely client-side churn, ghosting, and a broken disaster-recovery assumption.

## Non-negotiable

With `MULTI_TENANT` off (the default, every existing self-host), behavior is byte-for-byte identical to today — including the "resurrect on missing = repopulate the server" safety net, which is *correct* for an unscoped instance. Every new branch is gated by the flag (server) or by an explicit server-supplied signal the flag-off server never sends (client). The full existing suite passes unchanged with the flag off.

## Root cause

Two assumptions baked in before scoping:

- **Silence == success.** The sync contract has no per-change acknowledgement; a dropped change is indistinguishable from an accepted one. Fine under LWW (a losing write is genuinely stale); wrong under scoping (a rejected write must be *evicted*, not retried).
- **Missing == data loss.** The reconcile treats absence from a full snapshot as "the server was wiped." Correct for an unscoped instance; wrong for a scoped caller, where absence is the normal, expected result of the filter.

The fix makes both signals **explicit** so the client can tell "rejected/not-yours" apart from "stale" and "wiped."

## Design

### 1. Server: report rejections and scope state (flag on)

The sync response gains two additive keys. A flag-off server never sets them, so old and new clients are unaffected in single-tenant mode.

- `rejected: string[]` — ids from *this request's* `changes` that `decideWrite` refused for scope (the `allow:false` path). Collected in the existing push loop; no new query. Excludes LWW losers (those are legitimately stored, just not newest) — only scope refusals.
- `scoped: boolean` — `true` when the responding actor is scope-restricted (`!scope.unrestricted`). Lets the client interpret "missing from snapshot" correctly without hard-coding flag state it can't see.

Response shape becomes `{ serverTime, patients, apiVersion, rejected?, scoped? }`. `rejected`/`scoped` are omitted (not just empty) when the flag is off, keeping the flag-off golden-response regression byte-identical.

Wrap-only rule holds: the rejection list is accumulated by adding a `rejected.push(p.id)` beside the existing `continue`, not by restructuring the loop.

### 2. Client: evict rejected ids instead of retrying (flag on)

After `mergeServerRecords`, `syncNow` processes `res.rejected`: for each id, delete it from the cache outright (`cacheDelete`) — it is not the user's to hold. This clears the stuck `_dirty` and removes the ghost from the local list in the same pass. Guard on the key being present, so a flag-off response (no `rejected`) changes nothing.

Edge: a rejected id may also be one the user *legitimately* edited before losing access (e.g. reassigned mid-session). Eviction is still correct — the server is the authority on who may hold the record — but the client shows a one-time toast ("A patient left your access and was removed from this device") so the change isn't lost silently from the user's mental model.

### 3. Client: reconcile evicts, doesn't resurrect, when scoped (flag on)

In `reconcileWithSnapshot`, the `if(!serverRec)` branch splits on `res.scoped`:

- **`scoped === true`:** missing from the snapshot means out-of-scope. Evict the local row (`cacheDelete`) instead of marking it dirty. The data-loss safety net does **not** apply — a scoped caller can never be the authority that repopulates a wiped server.
- **`scoped === false` (or key absent):** unchanged — resurrect and re-upload, exactly as today. This preserves the flag-off byte-identical guarantee and the single-tenant recovery story.

Dirty local rows are still never evicted by reconcile (an unsynced in-scope edit must survive); only clean, out-of-scope, missing rows are dropped.

### 4. Disaster recovery under scoping (documentation, not code)

Consequence to record in README: with scoping on, "any device re-uploads its cache to repopulate the server" holds only for *in-scope* patients. Full-instance recovery after a DB loss requires an **unrestricted instance-admin device** (whose `scoped` is `false`, so its reconcile still resurrects everything it holds). Scoped devices correctly no longer fight the recovery by re-pushing fragments they can't own.

### 5. Optional: hide ghosts before reconcile (flag on, follow-up)

`reloadFromCache` / list rendering can filter to patients whose `unitId` is in the scope from `/api/me/scope`, so a stale out-of-scope row never shows even in the window before the next sync. This addresses only the *visual* symptom; items 2–3 already remove the rows from cache on the next sync. Treat as a follow-up polish, not part of the core fix.

## Error handling

- `rejected` is best-effort metadata: if the client ignores it (old client, flag-off server), behavior degrades to today's — no regression, just the pre-fix ghost, which item 3 still resolves on the next full reconcile.
- Eviction is idempotent: deleting an already-absent cache id is a no-op.
- A flag-on instance where a user's assignment is *widened* mid-session is unaffected — newly in-scope patients simply start arriving in the delta pull; nothing to evict.

## Testing

Matrix across both backends where applicable:

- **Flag off:** full existing suite unchanged; golden-response regression asserts `rejected`/`scoped` are **absent** from the flag-off sync response (byte-identical guarantee).
- **Server, flag on:** an out-of-scope change in a sync POST appears in `rejected` and is not stored; an in-scope LWW loser does **not** appear in `rejected`; `scoped` is `true` for a unit/department-assigned member and `false` for the instance admin.
- **Client, flag on:** a rejected id is deleted from cache and its `_dirty`/pending count drops to zero (no infinite retry); a clean out-of-scope row missing from a `scoped:true` snapshot is evicted, not resurrected; the same row under `scoped:false` is still resurrected and re-uploaded (recovery path intact); a dirty *in-scope* edit is never evicted by reconcile.
- **End-to-end:** reassign a patient from unit A to unit B; a device scoped to A shows the record disappear (via `rejected` on next push, or eviction on reconcile) with no lingering pending count; a device scoped to B receives it in the delta pull.

## Out of scope

Per-patient assignment (explicitly not wanted — location-based scoping is sufficient). A per-change ack protocol beyond `rejected` (YAGNI; the two signals cover the known failure). Server-driven push of "you lost access to id X" outside a sync round-trip (the next sync already carries it). Scoped per-org export/recovery tooling.
