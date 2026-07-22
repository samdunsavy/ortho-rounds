# AC Task 5 Report — Admin console view UI (flag-gated)

## Status: COMPLETE

## Summary

Implemented per brief:
- `public/index.html`: `moreAdminBtn`/`desktopAdminBtn` menu entries (both `display:none` default) next to the Manage Users entries; `#adminView` container (Organization pane: stat tiles, org tree, users table; Organizations tab for instance admins), `hidden` by default, inserted before the presentation overlay; admin CSS block added before the presentation-mode styles, using only existing tokens (`--bg`, `--card`, `--line`, `--ink`, `--muted` — the latter two are pre-existing undefined-but-referenced custom properties already used elsewhere in the file, e.g. line 397, so this matches existing codebase convention rather than introducing a new gap).
- `public/app.js`: full admin block (`serverFlags`, `LS_ORG_ID`, `adminUiVisible`, `isInstanceAdminUser`, `refreshServerFlags`, render functions, `loadAdminView`, `switchAdminTab`, `openAdminView`, `closeAdminView`) placed just before `openPresentationMode()`; wiring for the close/open buttons and the tabs/add-hospital/add-ward/add-org/create-org-admin/view-org delegated click handler added inside `bindEvents()`; login handler now also sets `LS_ORG_ID` and calls `refreshServerFlags()`; logout clears `LS_ORG_ID`; `updateAccountUI()` toggles both admin buttons via `adminUiVisible()`; `init()` calls `void refreshServerFlags()`.
- Status-bar segments use the app's real status tokens (`--status-postop`, `--status-preop`, `--status-conservative`, `--status-fordischarge`, found via grep) instead of the brief's generic `var(--ok, ...)` fallback style, since clean variables already exist.
- **One deliberate deviation from the brief's snippet layout**: the assign `<select>` `change` listener is registered as a module-scope statement immediately after `closeAdminView()`, not inside `bindEvents()`. Verified empirically that the brief's jsdom test dispatches a `change` event without ever calling `bindEvents()`/`init()` (autoinit is skipped in the harness) — with the listener inside `bindEvents()`, test 3 failed 0 calls vs 1 expected. Moving it to module scope (the `#adminView` element already exists in static HTML at script-eval time, in both real page load and the jsdom harness) fixed it with no other behavior change; commented in code explaining why, and confirming it's still not flag-gated as required.

## Process

1. Wrote `tests/frontend-admin-view.test.js` verbatim from brief. RED: 4/4 failed (`adminUiVisible`/`renderAdminView`/`renderAdminOrgsTab` undefined).
2. Implemented HTML + CSS + JS per brief steps 3.
3. First green run had 3/4 passing — assign-select test failed (listener never attached because it lived inside `bindEvents()`, which the harness never calls). Diagnosed via systematic-debugging, moved the change listener to module scope. Re-ran: 4/4 pass.
4. `tests/frontend-worklist.test.js tests/frontend-lab-photo-extraction.test.js` → 42/42 pass (no init regressions).
5. Full suite: `npm test` → 266/266 pass, 0 fail.
6. Committed `public/index.html`, `public/app.js`, `tests/frontend-admin-view.test.js` only.

## Commit

`44ebd0e` — "feat: flag-gated Admin console view (stats, org tree, users, orgs tab)" (3 files changed, 334 insertions)

## Self-review

- Flag-off, no visual change: `#moreAdminBtn`/`#desktopAdminBtn` both `style="display:none"` in markup; `#adminView` has the `hidden` attribute; `updateAccountUI()` only removes `display:none` when `adminUiVisible()` (admin role AND `serverFlags.MULTI_TENANT`) is true. Verified `.admin-view[hidden]{display:none;}` CSS rule matches the container.
- Wiring lives where page-init actually runs: `bindEvents()` (called from `init()`, itself called at real page load, guarded off only in the jsdom harness via `__ORTHO_SKIP_AUTOINIT__`) hosts the open/close buttons and the click-delegated admin actions. The one exception (assign `change` listener) is explained above and commented in the source.
- `escapeHTML` applied to every server-sourced string rendered into HTML: hospital/ward id+name+specialty, user username/id, ward option labels, org id/name/plan. Numeric fields (counts) and internally-controlled literals (`'admin'`/`'member'`, `'active'`/`'disabled'`) are not escaped, which is correct — they're never attacker-controlled strings.
- Full test suite green at 266/266, no regressions in worklist/lab-photo/init-dependent tests.

## Concerns

- Minor, inherited from the brief's own snippet (not introduced by me): `document.querySelector(`[data-new-ward-name="${hid}"]`)` builds an attribute-selector string from a `dataset` value without escaping for the selector syntax. Low risk since ids are server-generated (uuid-like), but flagging for awareness — same pattern appears for `data-new-org-admin`.
- `--bg`/`--muted` are referenced in styles but never actually `:root`-defined anywhere in `index.html` (checked via grep) — this is a pre-existing gap in the codebase (also true of the existing `.other-lab-chip` rule at line 397), not something this task introduced; flagging in case a future pass wants to tighten the design-token set.

## Report path

/Users/apuravdhankhar/ortho-rounds/.superpowers/sdd/ac-task-5-report.md

---

## Post-review fix (commit 536b4a3)

**Finding 1 (Important): Mobile More-sheet overlay left open over admin view**
- Fixed `public/app.js` line 3589: changed `moreAdminBtn` handler from direct `openAdminView` call to close sheet first: `closeSheet('moreSheetOverlay'); openAdminView();` (mirrors `moreLogoutBtn`/`morePushToggleBtn` pattern)

**Finding 2 (Minor, visual): Undefined CSS custom properties**
- Fixed `public/index.html` admin-view styles:
  - Line 710: `.admin-view{background:var(--bg);}` → `var(--paper)` (page background)
  - Line 717: `.admin-stat-tile .l{color:var(--muted);}` → `var(--ink-soft)` (muted text)
  - Line 722: `.admin-dept-card .spec-badge{color:var(--muted);}` → `var(--ink-soft)` (muted text)
- Real tokens used: `--paper` (from `:root` at line 27/1279/1306/1338), `--ink-soft` (from `:root` at line 1278/1305/1337)

**Tests**
- Covering test: `npm test -- tests/frontend-admin-view.test.js` → 4/4 pass
- Full suite: `npm test` → 266/266 pass, 0 fail

**Commit**: `536b4a3` — "fix: close More sheet before opening admin view; use real CSS tokens in admin styles"

**Concerns**: None—both fixes are minimal, isolated to the admin view, and all tests pass.
