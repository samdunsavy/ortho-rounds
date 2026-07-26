# Admin Console Overhaul — Design

**Date:** 2026-07-26
**Status:** Approved (design).
**Supersedes the UI half of:** `docs/superpowers/specs/2026-07-24-admin-command-center-design.md` (its backend companion, `2026-07-23-structural-operations-design.md`, stands unchanged).

**Scope:** Replace the tree-rail-plus-generic-detail-pane admin console with four task-shaped sections that are fully editable on phone and desktop, and fix the defects that have accumulated in it — including one privilege-escalation bug. Adds exactly one backend route (user role change) and tightens one existing route (user creation).

## Problem

The console shipped 2026-07-24 as a desktop-first master-detail "command center". Two days of real use surfaced problems in three groups.

### 1. The mental model doesn't hold up

`renderAdminTreeHTML` (`public/admin-console.js:34`) renders **Users** and **Organizations** as rows in the same list as hospitals, departments, units and wards. They are not nodes: they have no children, no patient count, and no ancestry. Selecting one is handled by a special case in `selectAdminNode` (`:61`) that navigates to a different tab entirely, and `renderAdminDetailHTML` (`:118`) has to branch three ways before it can render anything. Every job — onboard a person, rename a ward, clean up migration debris — funnels through one generic node inspector, so the inspector can't be good at any of them.

### 2. Confirmed defects

Nine confirmed by use, plus six more found by a full code audit ([Audit admin console bugs](df21266a-0c55-44f6-a454-430f314a8242)). Full suite is green: 425 passed.

| # | Defect | Evidence |
|---|---|---|
| 1 | User search text and checkbox selection are wiped by every action | `renderAdminCommandCenter` (`:70`) reassigns the whole detail pane's `innerHTML` on any mutation; `#adminUserSearch` and `[data-user-check]` live inside it |
| 2 | As instance admin, the "Organization" tab is blank or stale until an org is picked | `switchAdminTab('org')` (`:526`) only toggles `display`; `loadAdminView` (`:496`) never paints `#adminOrgPane` while `adminViewOrgId` is null |
| 3 | Drilling into an org is a one-way trip, and the assignment picker collapses to that one org | `adminState.orgs = tree.org ? [tree.org] : []` (`:512`) overwrites the instance admin's full org list; no exit affordance exists |
| 4 | Rename uses `window.prompt`, passwords use `window.alert` | `:334`, `:385`, `:396` — unreliable in the installed PWA, and inconsistent with the app's `showConfirm` |
| 5 | Everything is read-only under 900px, and resizing never re-evaluates | `adminIsNarrow()` (`:189`) is read at render time only, with no `resize` listener; Organizations tab never consults it at all (`:476–491`) |
| 6 | Deleting a node dumps you on the Users panel | `adminState.selection = { type: 'users' }` (`:352`) |
| 7 | Assigned users render as `Stale (unit:7f3a…)` or "— none —" | `assignLabelFor` (`:453`) exposes a raw type:id; `buildAssignNodeGroups` can be missing the node after defect 3 |
| 8 | Node counts look wrong | Departments double-count users holding both a legacy `wardId` and an `assignmentType` (`admin.js:75-83`); hospitals and the org show no count at all (`admin-console.js:44`, `:47`); ward counts are a subset of their unit's with nothing saying so |
| 9 | It throws / goes blank in some states | `renderAdminOrgsTab` (`:478`) and `switchAdminTab` (`:527`) dereference `getElementById` results with no null guard; `renderAdminStatTiles` (`:409`) assumes `tree.totals` and `dep.stats.byStatus` exist |
| 10 | Instance admin "Add hospital" always 400s | `addChildRouteFor('org')` (`:81–86`) posts `{ name }` only; `requestedOrgId` requires an explicit `orgId` for instance admins (`server.js:476–480`). Comment at `:83–85` admits the case is uncovered; the frontend test locks in `{ name }` only |
| 11 | Leaving a drilled-in org does not clear `adminViewOrgId` | Selecting Organizations (rail or tab) calls `switchAdminTab('orgs')` but leaves `adminViewOrgId` set (`:61–67`, `app.js:3609`). `loadAdminView` then skips the orgs early-return, refreshes the *hidden* org tree, and never re-renders org cards — so create-org succeeds on the server while the list stays stale |
| 12 | Selection from org A survives into org B | `openAdminView` clears `adminViewOrgId` but not `selection` (`:540–542`); View org B with a unit from A still selected → "That item no longer exists" |
| 13 | 409 `blockedBy` never reaches the UI | `api()` surfaces only `j.error` (`app.js:363–366`); toast is `"Node is not empty"` and the `{ children, users, patients }` payload is dropped |
| 14 | Hospital delete looks allowed when users are assigned to it | `buildOrgTree` never counts `assignmentType === 'hospital'\|'org'` (`admin.js:75–83`), so `deleteBlockedReason` sees only children and enables Delete; the server still 409s |
| 15 | Ward patient stats ignore whether `wardId` belongs to the patient's `unitId` | A patient `{ unitId: uA, wardId: wB }` where `wB` is under a different unit is counted in both (`admin.js:86–96`) |

### 3. A privilege-escalation bug

`POST /api/admin/users` (`server.js:699`) only sets `orgId` for an instance admin when the request body carries one (`:723`). The console's create-user form (`admin-console.js:395`) sends `{ username, role }` and nothing else. So an instance admin creating a user — even while drilled into a specific org — produces a user with **no `orgId` at all**.

`resolveScope` (`scope.js:9`) grants `unrestricted: true` to any admin without an `orgId`. Creating an "admin" from the console as an instance admin therefore mints a second unrestricted instance admin with read/write access to every organization's patients. Creating a "member" produces a user with an empty unit set who can see nothing, and who is then hidden from the list by the `u.orgId === adminViewOrgId` filter (`:514`).

### 4. Gaps against the previous spec

Promised in `2026-07-24-admin-command-center-design.md` but never built: the "users assigned here" list in the detail pane (§2), a collapsible tree (§2), the mobile breadcrumb drill-down (§2), filter-by-node in the Users toolbar (§3), and inline validation messages rather than toasts (§5). Separately, `POST /api/admin/repair-ancestry` (`server.js:675`) — the tool built specifically for migration cleanup — has no UI and is reachable only by curl.

## Constraints

- **Fully editable on phone and desktop.** The 2026-07-24 "mobile read-only, admin work is desk work" decision is reversed: admin work happens on the ward, on a phone, as often as at a desk. No viewport gates any write path.
- **Scale:** one hospital with several departments today, expanding. The design must be pleasant at today's size and hold up at hundreds of nodes without a rewrite.
- **Flag off → unchanged.** With `MULTI_TENANT` off, the console stays unreachable exactly as today. `tests/server-sync-golden.test.js` and the existing suite stay green.
- **No new dependencies.** Existing design tokens only (`--card`, `--line`, `--ink`, `--accent`, the status colours), and the result must work in dark mode.
- **Server stays authoritative on ancestry.** The UI never computes or caches ancestry; after any structural mutation it re-fetches.

## Design

### 1. Information architecture

Four named sections behind a segmented control under the title. Flat and visible, replacing the tree-as-navigation model.

- **Overview** — landing page. The four existing stat tiles, a row of quick actions, and a **Needs attention** list.
  - Quick actions: *Add person* opens People with the create form expanded; *Add ward* opens Structure with the tree filtered to units and the add-child form focused on the selected unit (or prompts you to pick one); *Fix an assignment* opens People with the *Unassigned* chip active.
  - Needs attention surfaces four categories, each entry linking to the thing that fixes it: people with `assignmentType`/`assignmentId` null; people whose assignment id is absent from the current tree; **empty units** — zero wards, zero live patients and zero assigned users, i.e. the migration debris; and disabled accounts. A category with no entries is omitted rather than shown empty.
- **People** — all user management in one place.
- **Structure** — the hospital → department → unit → ward tree. The only section that keeps a master-detail shape, because here it genuinely fits.
- **Organizations** — instance admin only.

**Language.** Schema words are removed from the interface. "Assignment" becomes **"Can see patients in"**. The type badge reads "Unit", not `unit`. `Stale (unit:7f3a…)` becomes **"Assigned to a place that no longer exists"** with a *Reassign* action. The word "node" does not appear in the UI.

### 2. People

**List.** A search box whose value survives every action, plus filter chips: *All / Unassigned / Disabled / Admins*. "Unassigned" is the direct answer to "why can't this person see any patients", the most common support question. The signed-in user's own row is marked **You**, and its disable control is disabled with an explanatory title rather than allowing a click that returns 400 (`server.js:744`).

Desktop renders a table (person, role, "Can see patients in", status, actions). Below ~700px each person is a card that expands on tap to reveal the same controls. No read-only gate at any width.

**Add person** captures username, role, and placement in one step, then shows the temporary password in a `showConfirm` modal with a copy button and a shown-once warning. When an instance admin is viewing a specific org, the request carries that org's id — the client half of the escalation fix.

**Change role** (new capability). The role cell becomes a two-option `<select>` (Member / Admin) that posts to the new `POST /api/admin/users/:id/role` after a confirmation naming the person and the new role. It is rendered disabled, with the reason in its title, on your own row and on the last active admin of an organization. A successful change signs that person out (see §5).

**Change placement.** The picker is grouped by level as today, but option labels show the full path — "Ortho › Unit 2 › Ward A" — so two wards with the same name are distinguishable. A change saves that one row and confirms inline on the row. On failure the control reverts and the reason appears in place; search, scroll and other selections are untouched.

**Bulk assign.** Checkbox state survives re-renders. The count-plus-picker bar is sticky so it stays reachable in a long list. On success it reports what happened ("Assigned 6 people to Unit 2") and keeps the selection visible.

**Passwords.** Reset uses the same show-once modal with a copy button. No `window.alert` anywhere.

### 3. Structure

**Tree.** Collapsible with chevrons; expansion state is UI state and survives reloads. Opens expanded to department level, so today's single hospital is fully visible without clicking. A filter box narrows to matching names and auto-expands to reveal matches. Row counts are labelled ("12 patients") rather than a bare number.

**Detail panel.** Name, type badge, stats and status bar as today, plus:

- **People assigned here** — the list the previous spec promised. This is the link between the two halves of the console and makes "who can see this ward" answerable. Each entry links into People.
- **Specialty** for departments — already supported by `PATCH /api/admin/nodes/department/:id` (`server.js:557`) and simply never exposed.
- **Children** with an inline add-child form that disables while in flight (so a double-tap cannot create two wards), clears on success, and keeps focus for adding several in a row. When an instance admin is viewing a specific org and adds a hospital under that org, the request carries that org's `orgId` — the same from-context rule as create-person (defect 10). Org admins continue to rely on the server inferring `orgId` from the actor.

**Rename** is an inline edit: click the name, type, Enter to save, Escape to cancel, 80-character limit enforced in place with an inline message. No `window.prompt`.

**Move** becomes a picker plus an explicit **Move** button and a confirmation naming both ends ("Move Unit 2 from Ortho to Trauma?"). Today's bare `<select>` fires on `change` (`:558`), so one mis-tap silently reparents a department with no undo.

**Delete** explains itself and helps you act. The 409 `blockedBy` counts (`server.js:588`) render as links: the patients count opens Organize filtered to that unit, the people count opens People filtered to that node. That turns cleanup from "why won't this delete" into a two-click path to clearing it. After a successful delete, selection moves to the **parent**, not the user list.

**Phone.** Tapping a tree row drills into the detail full-screen with a breadcrumb back to the tree. Same controls, no read-only gate.

### 4. Organizations

Org cards with rollup stats, create-org, and create-org-admin, as today. Empty create-org / create-org-admin input shows an inline message rather than silently no-oping (`app.js:3611–3623`). What changes:

- The all-orgs list and the currently-viewed org's tree are **separate pieces of state**, so drilling in no longer collapses the assignment picker to one org.
- Drilling in sets a persistent **"Viewing: ‹org› ✕"** chip in the header. Clearing the chip (or switching to the Organizations section) **clears `adminViewOrgId`** and re-renders the org cards — defect 11's root cause, where leaving a drilled-in org left the id set and every subsequent reload refreshed the hidden tree instead of the cards.
- Switching the viewed org **resets selection** to Overview (or People), so a unit selected in org A cannot linger into org B as "That item no longer exists" (defect 12).
- Selecting Structure / Overview before an org is chosen shows a *choose an organization* prompt instead of a blank pane / permanent "Loading…".
- **Repair ancestry** gets a button here (instance admin only), with a plain explanation of what it does and a confirmation, wired to the existing `POST /api/admin/repair-ancestry`.

### 5. Backend changes

Two route changes, plus one correction to the pure stats builder in `admin.js`.

**New: `POST /api/admin/users/:id/role`**

- Body `{ role: 'admin' | 'member' }`; any other value → 400.
- `actor.role === 'admin'` required, and the same-org guard used by `/disable`, `/enable` and `/reset-password` (`server.js:741`): a non-instance admin may only touch users in its own org.
- **You cannot change your own role** → 400, mirroring the self-disable guard.
- **You cannot demote the last active admin of an organization** → 400. Otherwise the org becomes unadministrable. Counted over active users with that `orgId`.
- An org admin may never create or promote a user without an `orgId`; since the target already has one, promotion preserves it.
- On success, `tokenVersion` is incremented. Tokens carry only `sub`/`username`/`tokenVersion` (`auth.js:32`) and the actor is re-read from storage per request, so the server-side effect is immediate — but the client caches the role in `localStorage` at login, so a demoted admin would keep seeing admin controls that 403. Bumping the version signs them out, exactly as disabling does.

**Tightened: `POST /api/admin/users`**

When `MULTI_TENANT` is enabled and the actor is an instance admin, `orgId` becomes **required** → 400 `"orgId required"`. Org admins are unaffected; their `orgId` continues to be inferred from the actor (`server.js:718`). Creating an additional *instance* admin is not something the console offers — org admins are created via `POST /api/admin/orgs/:id/admin` and the first instance admin via `bootstrapAdmin` — so requiring an org here closes the escalation path without removing a capability. Existing server tests that create users as an instance admin without an org are updated to pass one.

**Corrected: user and patient counts in `admin.js` (defects 8, 14, 15)**

Five separate problems produce the counts that look wrong:

- **Users are double-counted at department level.** `buildOrgTree` (`admin.js:75-83`) increments a department's `users` for a legacy `wardId` *and* again for `assignmentType === 'department'` with the same id, so a user carrying both is counted twice. Each user is counted exactly once: node-based assignment wins, and the legacy `wardId` is used only when the user has no assignment.
- **`assignmentType` of `hospital` or `org` is never counted.** The same loop only increments department / unit / ward stats, so a user assigned to a hospital leaves that hospital's delete preview empty even though the server will 409 (defect 14). The loop gains hospital and org buckets.
- **Hospitals and the org show no count at all.** `ccRowHTML` is called with `null` for both (`admin-console.js:47`, `:44`), so the two levels you'd most want a total for are blank. `buildOrgTree` gains rolled-up `stats` on each hospital and on the org (patients summed from their departments; users from the buckets above).
- **Ward patient stats ignore whether `wardId` belongs to the patient's `unitId`.** A patient `{ unitId: uA, wardId: wB }` where `wB` lives under a different unit is counted in both (defect 15). Count a patient toward a ward only when that ward belongs to the patient's unit.
- **Ward counts read as inconsistent with the unit above them.** The arithmetic above is otherwise correct — a unit's count is every patient in that unit, while a ward's is only the subset pinned to that ward — so the wards under a unit legitimately don't sum to it. The residual fix is labelling: the unit row reads "12 patients in this unit" and the ward row "3 pinned to this ward".

No other route or builder changes. Every other defect above is fixable in the frontend against the routes as they already exist. The client-side delete preview (`deleteBlockedReason`) then sees the same hospital/org user counts the server uses, so Delete is disabled before the click rather than after a 409.

### 6. State and rendering

The root cause of defects 1, 3, 5 and 6 is a single state blob plus whole-pane `innerHTML` assignment. State splits in two:

- **`adminData`** — server truth: the org tree, the user list, the org list. Replaced wholesale on reload.
- **`adminUI`** — active section, search text, active filter chips, expanded tree node ids, selected node, checked user ids, and the viewed org. Never touched by a reload.

Rendering is per-section, and within People per-row: changing one person's placement repaints that row only. Search filtering toggles a class on rows rather than re-rendering them. `adminIsNarrow()` is replaced by CSS-driven layout wherever possible; where JS must know the width, a debounced `resize` listener re-renders.

`app.js`'s `#adminView` click handler (`app.js:3607-3633` — org tab, add-org, create-org-admin, view-org) moves into `admin-console.js`, so all console behaviour lives in one file.

### 7. Error handling

Three tiers, chosen by where the user can act on the error:

- **Inline at the control** — validation and per-row failures (name too long, placement rejected, role change blocked). The form keeps its input.
- **Section banner with Retry** — the section failed to load.
- **Toast** — only for failures with no obvious home.

Specific cases: a 409 on delete reads `blockedBy` from the response body (defect 13 — today `api()` drops it and toasts only `"Node is not empty"`) and renders the explained, clickable blockers from §3. A 404 caused by a concurrent admin renders "Someone else changed this — refreshed" and reloads. A 403 renders the server's message in plain language. Every destructive action (delete node, disable user, change role, move node, repair ancestry) confirms through `showConfirm`, naming exactly what will happen. Every mutating control disables while its request is in flight. Focus is restored after any re-render that destroys the previously focused control.

### 8. Visual and accessibility

Built on the existing tokens (`--card`, `--line`, `--ink`, `--ink-soft`, `--accent`, `--accent-soft`, the `--status-*` colours), so dark mode works — the console has never been verified against it. Touch targets ≥44px. The users table becomes cards below ~700px. The header is sticky so Back and the org chip stay reachable while scrolling. Section rhythm matches the rest of the app.

Accessibility work that overlaps the bug fixes: real labels on the search and placement controls, the section switcher as a keyboard-navigable tablist, focus restored after re-render instead of jumping to the top, and `aria-expanded` on tree rows.

### 9. Testing

Frontend, jsdom, following `tests/frontend-admin-console.test.js`:

- Section switching renders the right section; the switcher is keyboard-operable.
- Search text survives a mutation; checkbox selection survives a mutation.
- Tree expansion state persists across a reload; the filter box auto-expands to matches.
- Deleting a node selects the parent.
- Move requires the explicit button and a confirmation; changing the picker alone posts nothing.
- The org chip returns to the all-orgs list, and the placement picker still lists every org after drilling into one.
- Instance-admin create-person and add-hospital both send the viewed org's `orgId`.
- Leaving a drilled-in org (chip ✕ or Organizations section) clears the viewed-org id and re-renders the org cards; switching orgs resets selection.
- Role control is disabled on your own row and for an org's last active admin.
- A 409 delete response surfaces `blockedBy` counts as clickable blockers, not a bare `"Node is not empty"` toast.
- A stale placement renders the plain-language warning with a Reassign action.
- A narrow viewport (< 900px) exposes editing controls; resizing between widths re-renders correctly.
- Flag off → the entry points stay hidden and the view renders nothing.

Server, following `tests/server-admin-console.test.js`:

- `POST /api/admin/users/:id/role` — happy path both directions; 403 cross-org for an org admin; 400 on self; 400 on last active admin of an org; `tokenVersion` incremented; 400 on an invalid role value.
- `POST /api/admin/users` as an instance admin without `orgId` → 400; with `orgId` → user created in that org.
- `buildOrgTree` counts a user holding both a legacy `wardId` and a matching `assignmentType: 'department'` exactly once; counts `assignmentType` of `hospital` / `org`; returns rolled-up `stats` on each hospital and on the org; and counts a patient toward a ward only when that ward belongs to the patient's unit.
- `MULTI_TENANT` off → both behaviours unchanged.

## Suggested sequencing

The console must stay usable throughout, so the work lands in an order where each step is independently shippable:

1. **Security and instance-admin org context first** — tighten `POST /api/admin/users`, fix the client to send `orgId` on create-person *and* add-hospital, and update the affected server/frontend tests. These are the escalation and always-400 bugs and shouldn't wait behind a UI rewrite.
2. **State and rendering split** (§6) with the current visual design intact. This alone kills defects 1, 5 and 6.
3. **Section shell** (§1) — the segmented control, Overview, and moving the `app.js` handler in.
4. **People** (§2), then the role route (§5) it depends on.
5. **Structure** (§3) and the `admin.js` stats correction.
6. **Organizations** (§4), org context chip, and repair-ancestry.
7. **Visual and accessibility pass** (§8) across all four sections.

## Out of scope

Drag-and-drop reparenting; an admin audit log of console actions; undo; live/real-time updates; manual ordering of nodes; per-node permission editing; bulk patient re-homing (already served by the separate Organize surface); promoting `admin.js`'s app-layer patient scan to indexed queries; reconciling the legacy per-department `user.wardId` field with node-based assignment (defect 8's double-count is fixed in the count itself, not by a data migration).
