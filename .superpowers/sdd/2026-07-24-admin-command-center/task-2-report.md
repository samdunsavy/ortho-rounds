# Task 2 report — command center shell (tree navigator + selection)

## Summary

Replaced the single-column admin console (`renderAdminView` + department
cards / unit rows / ward chips / users table) with the command-center shell:
a two-pane layout inside `#adminOrgPane` (`.admin-cc-rail` tree navigator +
`.admin-cc-detail` stub panel) and client-side selection state
(`adminState`). Deleted the now-dead single-column renderers and the legacy
`data-add-department`/`data-add-unit`/`data-add-ward` click handlers in
`app.js` that only drove that deleted markup.

## Files changed

- `public/index.html` — swapped `#adminOrgPane` inner markup for the rail +
  detail shell; moved `#adminStatTiles` to be a sibling of the pane (still
  inside `#adminView`) since it's no longer nested under the old
  `adminOrgSection`/`adminUsersSection` structure; added `.admin-cc*` CSS
  block after `.admin-org-card`.
- `public/admin-console.js` — added `adminState`, `findAdminNode`,
  `ccRowHTML`, `renderAdminTreeHTML`, `selectAdminNode`,
  `renderAdminCommandCenter`, `renderAdminDetailHTML` (Task 3 stub),
  `renderAdminStatTilesInto`, and the delegated `[data-node]` click handler.
  Rewrote `loadAdminView()` to populate `adminState` and render the command
  center. Deleted `renderAdminView`, `renderAdminOrgSectionHTML`,
  `renderAdminUnitRowHTML`, `renderAdminUsersSectionHTML`. Kept
  `renderAdminOrgsTab`, `switchAdminTab`, `buildAssignNodeGroups`,
  `renderAssignSelectOptionsHTML`, `renderAdminStatusBar` (all still used —
  the last three by future tasks: Task 3/5 reintroduce assign UI and status
  bars in the detail panel).
- `public/app.js` — removed the `[data-add-department]`, `[data-add-unit]`,
  `[data-add-ward]` click-handler branches (~25 lines) that drove the
  deleted markup.
- `tests/frontend-admin-console.test.js` (new) — brief's 3 tests verbatim,
  plus ported coverage (see table below).
- `tests/frontend-admin-view.test.js` — trimmed to only what's still
  accurate: `adminUiVisible`, `renderAdminOrgsTab`, and the flag-off
  describe block. Added a header note pointing at where the rest moved.

## One deliberate deviation from the brief's literal code

The brief's `ccRowHTML` template puts `class="..."` before `data-node="...` `
in the button's attribute order. The brief's own test 2 (`marks the selected
node`) asserts
`/data-node="unit:u1"[^>]*class="[^"]*is-selected/` — which requires
`data-node` to appear *before* `class` in the same tag (since `[^>]*` can't
cross the tag's closing `>`). With `class` first, that regex cannot match
against the row for the selected node (the `>` closing the tag arrives
before `class=` is ever seen scanning forward from `data-node=`). I
reordered the attributes to `data-depth`, `data-node`, then `class` in both
`ccRowHTML` and the two hardcoded `users`/`orgs` rows in
`renderAdminTreeHTML`, which satisfies the regex and still meets every
named constraint (`data-node="<type>:<id>"` present, selected row has class
`is-selected`). Confirmed by running the brief's test file verbatim — all 3
pass with this ordering; I did not weaken or rewrite the test to work
around it.

## Assertion-porting table (`tests/frontend-admin-view.test.js` → new location)

| Old assertion (renderAdminView test) | Disposition | New location |
|---|---|---|
| `adminUiVisible()` flag/role gating | Unrelated to deleted renderers | **Kept as-is** in `frontend-admin-view.test.js` |
| Stat tiles: 4 tiles, dept/active-users/live-patients/post-op counts | Still-relevant, function (`renderAdminStatTiles`) unchanged, only the paint-site moved | **Ported** — `frontend-admin-console.test.js` › `stat tiles` › `renderAdminStatTilesInto paints stat tiles into #adminStatTiles` |
| Dept cards render (`.admin-dept-card`) + status bar (`.admin-status-bar`) present | Markup deleted; status bar in the tree/detail context doesn't exist until Task 3's detail panel | **Deferred, not ported here** — Task 3 owns `renderAdminDetailHTML` and will need to add an equivalent assertion when it renders `renderAdminStatusBar` output in the detail panel |
| One `.admin-unit-row` per unit, one `.admin-ward-chip` per ward | Markup deleted; equivalent structural claim ("one row per node") already covered | **Covered by existing brief test** — `frontend-admin-console.test.js` › `command center tree` › `renders a row per node with live counts` (asserts `data-node="unit:u1"`, `data-node="ward:w1"` present) |
| `[data-add-unit="d1"]`, `[data-add-ward="u1"]`, `[data-add-department="h1"]` present | Genuinely obsolete — these controls (and the `app.js` handlers driving them) were deleted; Task 3 introduces a differently-shaped `data-add-child` control per the plan | **Dropped** — Task 3 will add its own coverage for `data-add-child` |
| 2 user rows in `#adminUsersSection tbody`, assign `<select>` present with correct `.value` | Users table markup deleted; grouping/selection logic it depended on (`buildAssignNodeGroups`, `renderAssignSelectOptionsHTML`) is untouched and still used by future tasks | **Ported as direct unit tests** of the pure helper functions — `frontend-admin-console.test.js` › `assign-select grouping` › `buildAssignNodeGroups groups nodes by level...` and `renderAssignSelectOptionsHTML marks the selected node...` |
| `option[value="unit:u1"]` exists in the assign select | Same as above | **Ported** — covered by the `renderAssignSelectOptionsHTML` test (asserts `<option value="unit:u1" selected>`) |
| `assign select fires the assign endpoint with {nodeType, nodeId}` (full change-handler wiring test) | Delegated change handler (`#adminView` `change` listener) is untouched code, just no longer fed by `renderAdminView` | **Ported**, DOM rebuilt manually (`#adminDetailPane.innerHTML = '<select data-assign-user=...>'`) instead of via a deleted renderer — `frontend-admin-console.test.js` › `delegated assign-select change handler` › `fires the assign endpoint with {nodeType, nodeId}` |
| `assign select blank option unassigns with nodeId:null` | Same handler, same reasoning | **Ported** — `frontend-admin-console.test.js` › `delegated assign-select change handler` › `blank option unassigns with nodeId:null` |
| `orgs tab renders rollup cards (instance admin surface)` | `renderAdminOrgsTab` unchanged | **Kept as-is** in `frontend-admin-view.test.js` |
| Flag-off: admin UI stays hidden | Unrelated to deleted renderers | **Kept as-is** in `frontend-admin-view.test.js` |

No coverage was weakened: every assertion against code that still exists
was either kept in place or ported; assertions against deleted markup were
either subsumed by an existing/new test on the replacement markup, or
explicitly deferred to the task that introduces the replacement UI (Task 3),
noted above rather than silently dropped.

## Verification

- `node --test tests/frontend-admin-console.test.js` before implementation:
  3/3 fail (`window.renderAdminTreeHTML is not a function`).
- `node --test tests/frontend-admin-console.test.js`: 3/3 pass after the
  brief's Step 5 implementation (with the attribute-order fix above).
- `node --test tests/frontend-admin-console.test.js tests/frontend-admin-view.test.js`:
  11/11 pass after porting.
- `grep -n "data-add-department\|data-add-unit\|data-add-ward" public/*.js`:
  **no matches** (legacy handlers and their markup are fully gone; Task 3
  hasn't introduced `data-add-child` yet).
- Full suite run sharded (5 groups covering all 29 files in `tests/`, each
  under the 45s tool timeout):
  - Shard 1 (`admin`, `admission-format`, `ai-parse-labs-image`,
    `ai-risk-flags`, `auth`, `backfill-hierarchy-v2`, `clinical-normalize`):
    67/67 pass
  - Shard 2 (`frontend-admin-console`, `frontend-admin-view`,
    `frontend-icons-and-xray-viewer`, `frontend-lab-photo-extraction`,
    `frontend-milestones`, `frontend-sync-merge`): 90/90 pass
  - Shard 3 (`frontend-unit-picker`, `frontend-worklist`, `hierarchy`,
    `merge`, `notifications`, `ot-list`): 68/68 pass
  - Shard 4 (`scope`, `server-admin-console`, `server-auth-scope`,
    `server-provisioning`, `server-scoping`): 52/52 pass
  - Shard 5 (`server-structure`, `server-sync-golden`, `storage`,
    `structure`, `telemetry`): 72/72 pass
  - **Total: 349/349 pass, 0 fail**

## Commit

`feat: command center shell — tree navigator + selection` on branch
`admin-command-center`.
