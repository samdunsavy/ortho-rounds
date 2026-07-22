# Task 4 Report: MULTI_TENANT sync read filter + write enforcement

## Status: DONE

## Implemented
- `server.js`: extended existing `import { listFlags } from './flags.js'` to also import `isEnabled` (no duplicate import line); added `import { resolveScope, canRead, decideWrite } from './scope.js'`.
- Sync handler (`/api/sync` and `/api/sync/v1`):
  - After `const now = Date.now();`: `const scope = isEnabled('MULTI_TENANT') ? await resolveScope(actor, store) : null;`
  - Write loop: added `decision` guard (computed via `decideWrite`) before `stampAttribution`; `continue` on `!decision.allow`. After `stored` is computed, forces `stored.wardId` per `decision.wardId` (delete if `null`, set if a string, leave alone if `undefined`).
  - Read path: `rows.map(rowToPatient)` moved into `outPatients` (the one permitted touch of an existing line), then filtered with `canRead` when `scope` is truthy.
- `tests/server-scoping.test.js`: created verbatim from brief — 9 integration tests covering department-scoped reads, cross-org isolation, unassigned-patient handling, out-of-scope write rejection, and org-admin cross-department moves.

## TDD Evidence
- RED: `npm test -- tests/server-scoping.test.js` before implementation → 7/9 subtests failed (members saw every patient; no wardId stamping; hijacked writes succeeded; forced-department moves not enforced). 2 passed trivially (root/admin reads and org-admin-can-move, since those didn't yet depend on scoping being off).
- GREEN: same command after implementation → 9/9 pass.
- Golden guard: `npm test -- tests/server-sync-golden.test.js` → 2/2 pass (flag-off contract identical, no `wardId` invented).
- Full suite: `npm test` → 247/247 pass across 69 suites, 0 failures.

## Files Changed
- `/Users/apuravdhankhar/ortho-rounds/server.js`
- `/Users/apuravdhankhar/ortho-rounds/tests/server-scoping.test.js` (new)

## Commit
`9884f87` — "feat: MULTI_TENANT sync read filter + write enforcement (wrap-only)"
(staged only `server.js` and `tests/server-scoping.test.js`, per brief; unrelated pre-existing modified/untracked files from earlier tasks were left untouched)

## Self-Review
- **Wrap-only compliance**: diffed `git diff HEAD~1 HEAD -- server.js` — the only touched existing line is the `sendJSON(...)` line, whose `rows.map(rowToPatient)` expression now lives in `outPatients`. `stampAttribution(p, existingObj, actor)`, the `mergePatientRecords`/`Object.assign` merge line, `stored.updatedAt = now`, and `await store.upsertPatient(...)` are all verbatim/unchanged, with only new guard blocks wrapped around them.
- **`continue` vs. transaction**: the new `if(!decision.allow) continue;` sits inside the same `for(const p of changes)` loop as the pre-existing `if(!p || typeof p.id !== 'string') continue;`, which is itself inside the `try{ ... } catch(err){ rollback; throw; }` around `store.begin()`/`store.commit()`. `continue` only skips to the next loop iteration — it does not exit the `try` block, so `store.commit()` still runs after the loop for all other changes in the same batch. Behavior is consistent with the existing skip-and-continue pattern already used for malformed items.
- **Ordering**: `decision` is computed (and the `!decision.allow` bail happens) strictly before `stampAttribution` is called, exactly as the brief specifies — so a rejected write never mutates `p`'s attribution fields, and never touches `existingObj`.
- **Read/write flag symmetry**: `scope` is computed once per request via `isEnabled('MULTI_TENANT') ? await resolveScope(...) : null`, and both the write loop and the read filter key off the same `scope` variable, so a single flag check governs both directions per request (no risk of write allowed under one flag state and read filtered under another within the same call).
- **Flag-off path**: with the flag off, `scope` is `null`, so `decision` stays `null` for every item (write loop behaves exactly as before — no guard, no forced wardId) and `outPatients` is never filtered (identical to the old `rows.map(rowToPatient)` value). Golden test confirms no `wardId` key is invented flag-off.

## Concerns
- None blocking. Note for awareness: `decideWrite`'s admin-move branch only permits moving into wards the admin's own scope covers (`scope.wardIds.has(requested)`); an org admin cannot force a patient into a ward outside their org, and the instance admin (unrestricted scope) can move any patient anywhere — this matches scope.js semantics from Task 1 and is exercised by the "org admin can move a patient within org scope" test, but there's no test for an org admin attempting a cross-org move rejection specifically at the write layer (only the read-isolation test covers cross-org boundaries). Not required by the brief; flagging for Task 5/final review awareness only.
