# P1 Task 3 Report: server.js actor carries org/ward; login response gains additive scope fields

## Status: Complete

Commit: `ed29dd1` — "feat: actor and login response carry orgId/wardId (additive)"

## Implemented

1. `tests/server-auth-scope.test.js` — created exactly per brief (3 tests, 2 describe blocks: multi-tenant seeded scope, flag-off additive-null contract).
2. `server.js`:
   - Login response line (~248): added `orgId: user.orgId ?? null, wardId: user.wardId ?? null`.
   - Actor construction line (~260): added `orgId: authedUser.orgId ?? null, wardId: authedUser.wardId ?? null`.
   Both are additive-only edits to exactly the two named lines; nothing else in server.js touched.
3. `storage.js` — `createUser` extended in both backends to persist `orgId`/`wardId` (SQLite: added two columns to INSERT; Mongo: added two fields to `insertOne`), matching brief Step 3 verbatim.

## TDD evidence

- RED: ran `npm test -- tests/server-auth-scope.test.js` before any implementation change — 3/3 tests failed (login response missing `orgId`/`wardId`; `Object.keys` mismatch on flag-off contract).
- GREEN (after the 3 changes above): 2/3 passed; 1 failed — `bootstrap admin gets null orgId/wardId` returned 401 instead of 200.

## Deviation found and fixed (flagging for review)

Root cause of the remaining failure: `bootstrapAdmin` in `auth.js` no-ops whenever `store.countUsers() > 0` — with *any* user row, not just an instance-level one. The brief's own test seeds a tenant-scoped user (`pg1`, `orgId: 'org1'`) before boot, then expects `admin`/`test-admin-pass` to still log in as the bootstrap instance admin. Task 4's brief has the identical pattern (seeds 5 org-scoped users, then expects `tok(baseUrl, 'admin', 'test-admin-pass')` to succeed as `tokens.root`) — so this is a shared latent defect, not specific to my two-line change.

Fix applied (not in Task 3's stated file list, but required for the brief's exact test and for Task 4 to work later): `bootstrapAdmin` now checks for an existing user with `orgId` null (instance-level) instead of any user at all — consistent with Task 5's own definition of "instance admin" (`role==='admin' && !orgId`). Also updated `tests/auth.test.js`'s `fakeStore` test double to add `getAllUsers()` (the pre-existing unit tests for `bootstrapAdmin` only stubbed `countUsers`, and broke once the implementation switched methods).

Files touched beyond the brief: `auth.js` (bootstrapAdmin), `tests/auth.test.js` (fakeStore double).

## Test results

- `tests/server-auth-scope.test.js`: 3/3 pass.
- `tests/server-sync-golden.test.js`: 2/2 pass (golden guard green).
- `tests/auth.test.js`: 14/14 pass (updated fakeStore).
- Full suite `npm test`: 238/238 pass, 0 fail.

## Files changed (committed)

- `/Users/apuravdhankhar/ortho-rounds/server.js`
- `/Users/apuravdhankhar/ortho-rounds/storage.js`
- `/Users/apuravdhankhar/ortho-rounds/auth.js`
- `/Users/apuravdhankhar/ortho-rounds/tests/server-auth-scope.test.js` (new)
- `/Users/apuravdhankhar/ortho-rounds/tests/auth.test.js`

Pre-existing uncommitted files from Task 2's fix round (`p1-task-2-report.md`, `progress.md`, `p1-task-2-review-package-2.txt`) were left untouched and unstaged — not part of this task.

## Self-review

- Wrap-only rule honored for server.js: exactly the two named lines changed, additively, nothing restructured.
- storage.js createUser extended in both SQLite and Mongo backends per exact brief code.
- Test file matches brief verbatim.
- Deviation (auth.js) is minimal (4 lines), additive in spirit (widens who counts as "already bootstrapped" rather than narrowing), and semantically anchored to Task 5's own instance-admin definition — but it is out-of-scope relative to Task 3's stated file list and was not pre-approved.
- No regressions: golden test and full suite green.

## Concerns for reviewer

- The `auth.js`/`bootstrapAdmin` fix is the one item that goes beyond the brief's stated scope. It was necessary to make the brief's own exact test pass and will also be needed for Task 4 (whose seed pattern hits the same no-op). Recommend explicit sign-off on this fix, or moving it into an amended Task 3/4 brief for traceability.
- Behavior change is narrow: only affects fresh installs where tenant-scoped (`orgId` set) users already exist before first boot — a scenario that only arises in multi-tenant pre-seeding, which didn't exist before this Phase 1 work.

## Fix note (2026-07-22, commit `09c02c6`)

Per the project's "flag-off byte-identical, production changes only where the plan names them" rule, the out-of-scope `auth.js` `bootstrapAdmin` change flagged above was reverted and the underlying test-login need was solved in the harness instead:

- `auth.js`: `bootstrapAdmin` restored to its pre-`ed29dd1` behavior — no-op based on `store.countUsers() > 0` (any user), no `getAllUsers`/orgId-null filtering.
- `tests/auth.test.js`: `fakeStore` test double reverted — removed the `getAllUsers()` method that existed only to support the reverted implementation.
- `tests/helpers/server-harness.js`: `startServer`'s `seed` path now also creates the instance admin directly (`id: 'root-admin'`, username/password from `ADMIN_USERNAME`/`ADMIN_PASSWORD`, `role: 'admin'`, `orgId: null`, `wardId: null`, `passwordHash`/`passwordSalt` via `hashPassword(ADMIN_PASSWORD, 'harness-salt')`) whenever no user with that username already exists (checked via `store.getUserByUsername`). A comment explains this exists because the server's real `bootstrapAdmin` no-ops once any user is seeded. Production `bootstrapAdmin` logic itself is untouched.
- `tests/server-auth-scope.test.js`: renamed the test `'bootstrap admin gets null orgId/wardId (instance admin)'` to `'instance admin gets null orgId/wardId'` since it now logs in as the harness-seeded instance admin rather than the server's own bootstrap path.

Test results:
- `npm test -- tests/server-auth-scope.test.js tests/server-sync-golden.test.js tests/auth.test.js`: 19/19 pass (7 suites).
- `npm test` (full suite): 238/238 pass, 0 fail.

Commit: `09c02c6` — "fix: revert bootstrapAdmin change; harness seeds instance admin for seeded boots".

No concerns; production `auth.js` is now byte-identical to pre-`ed29dd1` for `bootstrapAdmin`, and the flag-off/multi-tenant test behavior is unchanged (all previously-passing tests still pass).
