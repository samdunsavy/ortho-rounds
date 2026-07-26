# Task 3 report — client scope selector

## Status: DONE

## Files changed

### `public/app.js`
- Added `const LS_ACTIVE_SCOPE = 'ortho_active_scope';` next to the other `LS_*` constants (after `LS_LASTSYNC`, ~line 47-48).
- Added `getActiveScope()` and `setActiveScope(node)` immediately before `flatUnitsFromScopeTree`, next to `loadScopeTree`/`invalidateScopeTree` (~line 6151). Transcribed verbatim from the brief.
- Added `async function renderScopeSelector()` immediately before `flatUnitsFromScopeTree`, right above `getActiveScope`/`setActiveScope` (same neighborhood as the other scope helpers). Transcribed verbatim from the brief.
- In `syncNow`:
  - `const activeScope = getActiveScope() || undefined;` added before the first `api('/api/sync', ...)` call; body now `JSON.stringify({ since, changes, activeScope })`.
  - The full-reconcile snapshot POST body now `JSON.stringify({ since: 0, changes: [], activeScope })`.
- Wired `void renderScopeSelector();`:
  - Right after `updateAccountUI();` inside `attemptLogin` (post-login path, ~line 1990-1991).
  - Right after `updateAccountUI();` inside `refreshServerFlags()` (~line 7792-7793).

**Placement note on the two wiring sites — deviation from the brief's literal line numbers, but matches its intent:** The brief said "1988 is post-login inside attemptLogin; 7752 is initial startup," implying `updateAccountUI()` at old-line-3485 (inside `init()`) was the startup site. I traced it more carefully: `init()` calls `void refreshServerFlags()` (fire-and-forget, not awaited) *before* its own `updateAccountUI()` call, so at that point `serverFlags` is still `{}` and `scopePickerActive()` (which reads `serverFlags.MULTI_TENANT`) would report `false` — the selector would render hidden and never get a second chance to show for MULTI_TENANT admins on page load. `refreshServerFlags()` itself is called from *both* `init()` (true startup) and `attemptLogin()` (post-login), and its **own** internal `updateAccountUI()` call (after `serverFlags` is freshly populated from `/api/health`) is the point where `scopePickerActive()` is actually reliable. So I added `void renderScopeSelector();` there instead of at `init()`'s line, which covers both "initial startup" and "post-login" in one place, plus kept the second call directly in `attemptLogin` right after its own `updateAccountUI()` (redundant with the `refreshServerFlags` one that fires moments later, but harmless — it no-ops for non-admins and just re-renders the same list for admins). Net effect: selector is populated/shown correctly on both cold load and post-login, which is the brief's actual goal.

### `public/index.html`
- Added `<select id="scopeSelect" class="scope-select" hidden aria-label="Viewing scope"></select>` to the rounds view's `.search-row` (next to `#searchInput` and `#filterPillBtn`, the top toolbar row of the rounds list view), transcribed verbatim from the brief.

### `tests/frontend-scope-selector.test.js` (new)
Transcribed from the brief with two harness adaptations (per your instructions — these only fix cross-realm/environment mismatches, they don't weaken any assertion):
1. `localStorage.setItem('ortho_token', 't')` → `window.localStorage.setItem('ortho_token', 't')`. The brief's test file has no top-level `localStorage` global in this Node test-runner context (unlike a browser); every existing frontend test in this repo (`frontend-bulk-move.test.js`, `frontend-admin-console.test.js`, `frontend-worklist.test.js`, `frontend-admin-view.test.js`) uses `window.localStorage`, so this matches the established pattern.
2. `assert.deepEqual(window.getActiveScope(), { type: 'department', id: 'dep1' })` → `assert.deepEqual({ ...window.getActiveScope() }, { type: 'department', id: 'dep1' })`. Because the test file imports `assert` from `node:assert/strict`, `assert.deepEqual` in that module is aliased to `deepStrictEqual`, which does a reference-equal prototype check — the object returned by `getActiveScope()` was built by `JSON.parse` inside the jsdom realm and has jsdom's `Object.prototype`, not Node's, so a strict deep-equal against a Node-realm literal fails despite identical structure (confirmed via the actual failure: "Values have same structure but are not reference-equal"). Spreading into a fresh Node-realm object sidesteps this, exactly analogous to the array-spread pattern flagged as acceptable in your environment rules. The assertion still checks the exact same field values.

The second assertion in that test (`assert.equal(window.getActiveScope(), null)`) needed no change — it's a primitive comparison against `null`.

## Test commands and results

1. `node --no-warnings --test tests/frontend-scope-selector.test.js`
   - Before implementation (Step 2): FAIL as predicted — `window.setActiveScope is not a function`.
   - After Step 3 (persistence + sync wiring only, before Step 5's selector/renderer): 1 pass, 1 fail — the persistence test failed on the cross-realm `deepEqual` issue described above (not yet adapted). Adapted the test per above, then: 2/2 PASS.
   - After Step 5 (selector element + renderer + wiring): still 2/2 PASS (renderer isn't directly exercised by this file, but re-ran to confirm no regression).

2. `node --no-warnings --test tests/server-sync-golden.test.js tests/frontend-scope-selector.test.js tests/frontend-bulk-move.test.js tests/frontend-admin-console.test.js tests/frontend-admin-view.test.js tests/frontend-worklist.test.js`
   - 78/78 tests pass, 0 fail. `server-sync-golden.test.js` (flag-off golden sync contract) unaffected.

3. `npm test` (full suite, `node --no-warnings --test` — repo-wide discovery)
   - **412/412 tests pass, 0 fail**, 122 suites, ~37s.

## Concerns

- None blocking. The one deliberate deviation (placement of the two `renderScopeSelector()` wiring calls vs. the brief's literal line references) is explained above and is, I believe, strictly more correct than following the brief's literal old line numbers — it was flagged as a "placement note the brief leaves to you," and the brief itself says "Adding it after all of them is harmless... prefer adding it next to the post-login (1988) and startup (7752) calls at minimum," which is what I did once I identified where the real startup signal (`serverFlags` populated) lives.
- Did not add `renderScopeSelector()` calls at the other two `updateAccountUI()` sites (`init()`'s own call and `logout()`'s call) since the brief said "at minimum" two sites and adding it in `init()` before `serverFlags` is populated would be a no-op render anyway (superseded moments later by `refreshServerFlags`'s own call). Not adding it to `logout()` is intentional — logging out clears `LS_ROLE`/`LS_ORG_ID` and calls `updateAccountUI()`, which will naturally hide admin-only UI on next login-required render; the selector's `hidden` state doesn't need active management on logout since a subsequent login re-triggers `renderScopeSelector()` via `attemptLogin`.
- Only touched `public/index.html`, `public/app.js`, and `tests/frontend-scope-selector.test.js`, per the environment rules. No git commands were run — working tree left as-is for the controller.

## Post-implementation fixes (2026-07-26)

Code review identified two issues to fix:

### Fix 1: `logout()` does not clear `LS_ACTIVE_SCOPE` (critical)

**Problem:** On shared ward devices, after an admin logs out and a member logs in, the member's client keeps sending the stale `activeScope` on every sync, silently narrowing their patient list. The scope selector is admin-only, so a member has no way to reset it.

**Solution:** Added `localStorage.removeItem(LS_ACTIVE_SCOPE);` to the `logout()` function (line 2006, between `LS_ORG_ID` clear and `updateAccountUI()`).

### Fix 2: `LS_ACTIVE_SCOPE` constant uses single quotes (style)

**Problem:** The `LS_ACTIVE_SCOPE` declaration at line 48 used single quotes: `const LS_ACTIVE_SCOPE = 'ortho_active_scope';` while all sibling `LS_*` constants use double quotes.

**Solution:** Changed to double quotes: `const LS_ACTIVE_SCOPE = "ortho_active_scope";`

### Test added

In `tests/frontend-scope-selector.test.js`, added a new suite "logout clears activeScope" with a test:
- Set an active scope via `window.setActiveScope({ type: 'unit', id: 'u1' })`
- Assert `window.getActiveScope()` is non-null
- Call `window.logout()` (wrapped in try/catch to handle potential jsdom side effects)
- Assert `window.getActiveScope()` is `null`

The test confirms that after logout, the scope is cleared and the next user starts fresh.

### Test results

1. `node --no-warnings --test tests/frontend-scope-selector.test.js`
   - 3 suites, 3 tests, **3 PASS, 0 FAIL** (including the new logout test)

2. `npm test` (full suite)
   - 123 suites, 413 tests, **413 PASS, 0 FAIL** (up from 412 tests before)

All changes are backward compatible; no regressions.
