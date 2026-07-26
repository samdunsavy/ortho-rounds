# Task 2 Report — Server `activeScope` narrowing on `/api/sync`

## Status
DONE — all TDD steps followed in order, full suite green.

## Files changed

- `scope.js` — added `intersectScope(scope, activeUnitIds)` (exported), inserted between `resolveScope` and `canRead`. Verbatim from the brief:
  - Unrestricted scope collapses to exactly `activeUnitIds` (`unrestricted: false`, `includeUnassigned: false`).
  - Restricted scope keeps only its own units that are also in `activeUnitIds` (never widens).
  - No matches → empty `unitIds` (fail closed).

- `server.js`:
  - Import line (was `import { resolveScope, canRead, decideWrite } from './scope.js';`) extended to add `intersectScope`.
  - Import line (was `import { wardUnitId } from './hierarchy.js';`) extended to add `listUnitIdsUnder`.
  - In the `/api/sync` handler, right after `const scope = isEnabled('MULTI_TENANT') ? await resolveScope(actor, store) : null;`, added:
    ```js
    let effScope = scope;
    if(scope && body.activeScope && body.activeScope.id){
      const activeUnitIds = await listUnitIdsUnder(store, { type: String(body.activeScope.type || ''), id: String(body.activeScope.id) });
      effScope = intersectScope(scope, activeUnitIds);
    }
    ```
  - Switched exactly the three specified `scope` references to `effScope` (guards left on `scope`, per the brief's clarification):
    1. `decision = await decideWrite({ incoming: p, existing: existingObj, actor, scope: effScope, store });` (guard remains `if(scope){...}`)
    2. `if(scope) outPatients = outPatients.filter(p => canRead(p, effScope));` (guard remains `if(scope)`)
    3. Inside `if(scope){ ... responseBody.scoped = !effScope.unrestricted; }` — guard remains `if(scope)`, `responseBody.rejected = rejected;` unchanged, `.unrestricted` check now reads `effScope.unrestricted`.
  - Left `if(scope && stored.wardId)` (ward-validation guard) untouched, referencing `scope` — as instructed, since it's only a multi-tenant-mode check, unaffected by narrowing.
  - No other handler restructuring.

- `tests/scope.test.js` — appended the brief's exact `describe('intersectScope — narrow-only active scope', ...)` block (3 tests) plus its own `import { intersectScope } from '../scope.js';` line, both placed at end of file exactly as specified in Step 1 (import statement mid-file is valid ES module syntax — hoisted).

- `tests/server-scoping.test.js` — appended the brief's exact 3 integration tests inside the existing `MULTI_TENANT sync scoping (unit-based)` describe block, right after the `'an in-scope write is never listed in rejected...'` test:
  - `activeScope narrows an unrestricted admin to one department`
  - `activeScope cannot widen a member beyond their permission scope`
  - `absent activeScope reproduces the un-narrowed result`

## Test commands run + results

1. `node --no-warnings --test tests/scope.test.js` (after Step 1, before implementing `intersectScope`)
   → FAIL as expected: `SyntaxError: The requested module '../scope.js' does not provide an export named 'intersectScope'`

2. `node --no-warnings --test tests/scope.test.js` (after implementing `intersectScope`)
   → PASS: 23/23 tests, 5 suites, 0 fail.

3. `node --no-warnings --test tests/server-scoping.test.js` (after Step 5, before wiring server.js)
   → FAIL as expected: 1 subtest failed (23 pass / 1 fail out of 24) — the new `activeScope narrows an unrestricted admin to one department` test failed because `activeScope` was not yet honored.

4. `node --no-warnings --test tests/scope.test.js tests/server-scoping.test.js tests/server-sync-golden.test.js` (after wiring server.js)
   → PASS: 58/58 tests, 11 suites, 0 fail. Golden flag-off contract unaffected (scope is null there, so `activeScope` is ignored).

5. `npm test` (full suite)
   → PASS: 410/410 tests, 120 suites, 0 fail, 0 cancelled, 0 skipped, 0 todo.

## Concerns

None. The implementation matches the brief verbatim; no deviations were needed. Only the four permitted files were touched (`scope.js`, `server.js`, `tests/scope.test.js`, `tests/server-scoping.test.js`). No git commands were run — working tree left as-is for the controller to commit.
