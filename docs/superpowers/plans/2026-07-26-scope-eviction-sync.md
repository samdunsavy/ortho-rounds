# Scope-Aware Sync Eviction — Implementation Plan

**Goal:** Stop out-of-scope cached patients from becoming permanent "pending" ghosts on scoped devices, by making the sync response signal rejections and scope state explicitly, and having the client evict rather than retry/resurrect. Flag-off behavior stays byte-identical.

**Architecture:** Two additive keys on the `/api/sync` response (`rejected`, `scoped`), set only when a scope is resolved (flag on). The client consumes them in `syncNow` (evict rejected ids) and `reconcileWithSnapshot` (evict instead of resurrect when scoped). All server changes are wrap-only around the existing sync handler.

**Spec:** `docs/superpowers/specs/2026-07-26-scope-eviction-sync-design.md`

**Status:** Implemented 2026-07-26. All tasks below are done; full suite green (398 tests). Steps retained as the record of what shipped and how to verify.

## Global Constraints

- Flag off (`ORTHO_FLAG_MULTI_TENANT` unset): `/api/sync` response keys stay exactly `serverTime`, `patients`, `apiVersion` — `rejected`/`scoped` are omitted, not empty. Guarded by the flag-off golden test (`tests/server-sync-golden.test.js`).
- `rejected` lists only scope refusals (`decideWrite → allow:false`), never LWW losers (those are legitimately stored).
- `scoped === !scope.unrestricted`: `true` for a scope-restricted member/org-admin, `false` for the unrestricted instance admin (so its reconcile still resurrects — the disaster-recovery path is preserved for the one actor that can legitimately repopulate a wiped server).
- Wrap-only in the sync handler: new logic is additions around existing statements, not restructuring.
- Client changes are no-ops against a flag-off server (keys absent → guards skip).
- Tests: `npm test` (node --test). Integration via `tests/helpers/server-harness.js`.

---

### Task 1: Server — `rejected[]` + `scoped` on the sync response ✅

**Files:** Modify `server.js` (sync handler); test `tests/server-scoping.test.js`.

- [x] **Step 1 — Collect refusals.** Before the write loop, `const rejected = [];`. In the scope guard, change `if(!decision.allow) continue;` to `if(!decision.allow){ rejected.push(p.id); continue; }`. No new query; the guard already runs only when `scope` is truthy.
- [x] **Step 2 — Emit keys.** Replace the single `sendJSON` with a `responseBody` object; when `scope` is truthy add `responseBody.rejected = rejected` and `responseBody.scoped = !scope.unrestricted`. Flag off (`scope === null`) → neither key.
- [x] **Step 3 — Tests.** In `tests/server-scoping.test.js` (MULTI_TENANT describe): `scoped` true for `pg1`, false for `root`; `rejected` lists a cross-org out-of-scope write id (`pat-wx` — never moved by another test, unlike `pat-w2`); an unassigned member's create is rejected; an in-scope stale LWW-loser write is **not** rejected.
- [x] **Step 4 — Verify.** `node --test tests/server-scoping.test.js tests/server-sync-golden.test.js` → pass. Golden test guarantees flag-off omission.

---

### Task 2: Client — evict rejected ids in `syncNow` ✅

**Files:** Modify `public/app.js`.

- [x] **Step 1.** After the dirty-clearing loop, before `localStorage.setItem(LS_LASTSYNC, ...)`: if `Array.isArray(res.rejected) && res.rejected.length`, `await cacheDelete(id)` for each, then a single `showToast` ("A patient left your access and was removed from this device" / pluralized). Eviction clears the stuck `_dirty` and removes the ghost from the local list in one pass. Guard on the key so a flag-off response changes nothing.
- [x] **Step 2 — One-time by construction.** Evicted ids are gone from cache, so they're never re-sent; `rejected` returns empty next sync and the toast doesn't repeat.

---

### Task 3: Client — scope-aware `reconcileWithSnapshot` ✅

**Files:** Modify `public/app.js`.

- [x] **Step 1 — Thread the flag.** `reconcileWithSnapshot(serverRecords, scoped)`; caller passes `snap.scoped` from the full-reconcile pull.
- [x] **Step 2 — Split the missing-row branch.** In `if(!serverRec)`: when `scoped`, `await cacheDelete(localRec.id); continue;` (out of scope, not data loss — a scoped device can't repopulate a wiped server). Otherwise the unchanged resurrect path (mark `_dirty`, re-upload) runs, preserving single-tenant recovery and the flag-off byte-identical guarantee. Dirty in-scope rows are still never evicted.

---

### Task 4: Docs — recovery note + suite ✅

**Files:** `README.md`, plus this plan and the spec.

- [x] **Step 1 — README.** Under "Rolling out the deep hierarchy," add a callout: with scoping on, "any device re-uploads its cache" covers only in-scope patients; full-DB-loss recovery requires an unrestricted instance-admin device; scoped devices evict out-of-scope rows rather than fighting recovery.
- [x] **Step 2 — Full suite.** `npm test` → 398 pass, 0 fail.

## Out of scope

Per-patient assignment (explicitly not wanted). A per-change ack protocol beyond `rejected`. Server push of "you lost access to id X" outside a sync round-trip (the next sync already carries it). Filtering the local list by `/api/me/scope` before reconcile — a visual-only follow-up polish; Tasks 2–3 already remove the rows on the next sync.
