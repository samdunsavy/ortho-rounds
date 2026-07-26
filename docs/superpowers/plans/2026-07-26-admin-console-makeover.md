# Admin Console Makeover — Plan 2: Task-First Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the admin console's tree-rail-plus-generic-detail-pane layout with four task-shaped sections — Overview, People, Structure, Organizations — that are fully editable at every viewport width, by splitting client state into server truth (`adminData`) and UI state (`adminUI`) so search text, filter chips, tree expansion, selection and checked rows survive every reload and mutation instead of being wiped by the next re-render.

**Architecture:** `public/admin-console.js` shrinks to a shared core (state, section shell, Overview) and three new focused files — `public/admin-people.js`, `public/admin-structure.js`, `public/admin-orgs.js` — each owning one section's rendering and click/change handlers, delegated to their own section container so the four files never need to coordinate through a shared listener. All four are plain (non-module) classic scripts loaded in this order in `index.html`: `admin-console.js` first (declares `let adminData` / `let adminUI`), then the three section files. Classic scripts share one Global Environment Record, so later scripts can read those `let` bindings by bare identifier — but they are **not** `window.*` properties (unlike `var` / function declarations). Cross-file calls therefore only happen from inside event-handler / function bodies after all scripts have loaded — never at a script's top level. The jsdom harness concatenates the four files into a single `window.eval()` so the same shared lexical bindings exist under one parse; tests must observe state through the DOM or through globals that are function declarations, **never** via `window.adminData` / `window.adminUI`. Twelve tasks build the shell first (preserving today's behaviour under the new container ids), then rework each section in turn, then do a responsive/accessibility pass — the console stays usable after every task.

**Tech Stack:** Vanilla JS (no framework, no build step), Node ≥ 22.5 HTTP server, `node:test` runner, jsdom for frontend tests, SQLite via `node:sqlite` (or MongoDB when `MONGODB_URI` is set). Every backend route this plan needs already exists — `POST /api/admin/users/:id/role`, `POST /api/admin/repair-ancestry`, the `blockedBy` 409 payload on node delete, `PATCH /api/admin/nodes/department/:id` (accepts `specialty`), and hospital/org rollup `stats` on `buildOrgTree` — all shipped in Plan 1. **This plan is frontend-only; no `server.js` or `admin.js` changes.**

**Source spec:** `docs/superpowers/specs/2026-07-26-admin-console-overhaul-design.md`. **Plan 1** (`docs/superpowers/plans/2026-07-26-admin-console-correctness.md`, already implemented — 7 commits, 455 tests passing) fixed the security/correctness defects against the *old* layout; this plan does not repeat any of its tasks.

## Global Constraints

- **Node ≥ 22.5** — uses the built-in `node:sqlite` module.
- **No new dependencies.** Nothing may be added to `package.json`.
- **Flag off → unchanged.** With `MULTI_TENANT` off the console stays unreachable exactly as today; `tests/server-sync-golden.test.js` must stay green.
- **Fully editable on phone and desktop.** No viewport gates any write path. `adminIsNarrow()` and the "Open on a larger screen to edit" gate are removed entirely (Task 11).
- **Scale:** one hospital with several departments today, expanding — the design must be pleasant at today's size and hold up at hundreds of nodes without a rewrite.
- **Server stays authoritative on ancestry.** The UI never computes or caches ancestry; after any structural mutation it re-fetches via `loadAdminView()`.
- **Existing design tokens only** — `--card`, `--line`, `--ink`, `--ink-soft`, `--accent`, `--accent-soft`, the `--status-*` colours — already defined for both light and `:root[data-theme="dark"]` / `prefers-color-scheme: dark` in `public/index.html`. No new colour literals.
- **Touch targets ≥44px.**
- **Names capped at 80 characters, usernames at 32** (`cleanName(raw, max = 80)` in `server.js:227`).
- **No backend changes.** Every route this plan calls already exists (see Architecture).
- **Full suite baseline is green: 455 passing, 133 suites.** Run `npm test` before starting and after each task.
- Commit after every task using the repo's prefixes: `feat:`, `fix:`, `refactor:`, `test:`.
- **Language:** schema words never appear in the interface. "Assignment" reads **"Can see patients in"**; a stale assignment reads **"Assigned to a place that no longer exists"** with a *Reassign* action; type badges are capitalized ("Unit", not `unit`); the word "node" never appears in a user-visible string. Internal identifiers (`assignmentType`, `nodeType`, `data-node`, etc.) are unaffected — this rule is about copy, not code.
- **Out of scope (do not build):** audit log, undo, drag-and-drop, live updates, manual node ordering, patient rehome UI beyond a navigation link into the existing Organize surface, per-node permission editing.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `public/admin-console.js` | Shared state (`adminData`, `adminUI`), the four-section tablist shell, Overview section, cross-section helpers (`buildAssignNodeGroups`, `renderAssignSelectOptionsHTML`, `assignLabelFor`, `describeDeleteBlock`, `invalidateHierarchyCaches`, `humanNodeType`), `openAdminView`/`closeAdminView`/`loadAdminView`. | 1, 2, 3, 11, 12 |
| `public/admin-people.js` | People section: list, search, filter chips, create person, role change, placement change, bulk assign, reset password, the show-once secret modal. | 1, 2, 4, 5, 6, 11, 12 |
| `public/admin-structure.js` | Structure section: tree, detail panel, rename, move, delete, specialty, phone drill-down. | 1, 7, 8, 9, 11, 12 |
| `public/admin-orgs.js` | Organizations section: cards, create org/org-admin, viewed-org chip, chooser, repair ancestry. | 1, 10, 11, 12 |
| `public/app.js` | One new cross-surface helper, `openOrganizeForUnit(unitId)`, that Structure's delete-blocker link calls. Nothing else here changes — session/account plumbing (`isAdmin`, `isInstanceAdminUser`, `adminUiVisible`, the nav button bindings) stays in `app.js` by design (Task 1 explains the boundary). | 9 |
| `public/index.html` | New four-section markup, the show-once secret modal markup, all new/updated `.admin-*` CSS. | 1–12 |
| `tests/helpers/frontend-env.js` | Loads the four `admin-*.js` files as one concatenated `eval()` so their `let`/`const` state is shared. | 1 |
| `tests/frontend-admin-console.test.js` | Rewritten: state model, section shell, Overview. | 1, 2, 3, 12 |
| `tests/frontend-admin-people.test.js` | New file: People section. | 1, 2, 4, 5, 6, 11, 12 |
| `tests/frontend-admin-structure.test.js` | New file: Structure section. | 1, 7, 8, 9, 11, 12 |
| `tests/frontend-admin-orgs.test.js` | New file: Organizations section. | 1, 10, 11, 12 |
| `tests/frontend-admin-view.test.js` | Deleted in Task 1 (fully superseded — its 2 remaining tests move into `tests/frontend-admin-console.test.js`, continuing the same porting this file's own header already documents once). | 1 |

---

### Task 1: State model, four-section shell, and the file split

This task is a **behaviour-preserving refactor**: after it, the console still does everything it does today (tree navigation, users table, org cards), just organized as four sections instead of a rail + two tabs, and backed by `adminData`/`adminUI` instead of the single `adminState` blob. Two real, spec-required behaviour changes ride along because the new state shape requires them: an instance admin's **People** section now lists every user across every org even before they pick one (there is no tree-shaped reason to gate it, and the server's `GET /api/admin/users` already returns the unfiltered list to an instance admin); **Overview** and **Structure** show a "choose an organization" prompt instead of the permanent "Loading…" a fresh instance admin saw before drilling in.

**Files:**
- Modify: `public/index.html:2014-2030` (admin view markup), `public/index.html:710-750` (`.admin-*` CSS)
- Modify (rewrite): `public/admin-console.js` (replace the whole file)
- Create: `public/admin-people.js`, `public/admin-structure.js`, `public/admin-orgs.js`
- Modify: `tests/helpers/frontend-env.js:74-79`
- Modify (rewrite): `tests/frontend-admin-console.test.js`
- Create: `tests/frontend-admin-people.test.js`, `tests/frontend-admin-structure.test.js`, `tests/frontend-admin-orgs.test.js`
- Delete: `tests/frontend-admin-view.test.js`

**Interfaces:**
- Consumes (unchanged, from `app.js`): `api(path, opts)`, `showToast(msg, opts)`, `showConfirm(title, message, opts)`, `escapeHTML(s)`, `formatRelativeTime(ts)`, `isInstanceAdminUser()`, `isAdmin()`, `adminUiVisible()`.
- Produces (module state, read via the DOM in tests, never as `window.*`):
  - `adminData = { tree, users, orgs }` — server truth, replaced wholesale by `loadAdminView()`.
  - `adminUI = { section, viewedOrgId, allOrgs, selectedNode, structureExpanded, structureFilter, structureMobileDrilled, peopleSearch, peopleFilter, peopleChecked }` — UI state, untouched by a reload.
- Produces (globals other tasks build on): `switchAdminSection(section)`, `renderAdminSection()`, `adminNeedsOrgChoice()`, `adminOrgChooserHTML()`, `humanNodeType(type)`, `openAdminView()`, `closeAdminView()`, `loadAdminView()`.
- Produces (ported, unchanged behaviour, now reading `adminData`/`adminUI`): `findAdminNode`, `ccRowHTML`, `renderAdminTreeHTML`, `childTypeOf`, `childListOf`, `addChildRouteFor`, `nodeStatsHTML`, `renderAdminDetailHTML`, `validMoveParents`, `deleteBlockedReason`, `adminIsNarrow`, `renderAdminNodeActionsHTML` (all in `admin-structure.js`); `renderAdminUsersPanelHTML`, `selectedAdminUserIds`, `refreshAdminBulkBar` (in `admin-people.js`); `renderAdminOrgsTab` → `renderAdminOrgsSection`, `exitAdminOrgContext`, `enterAdminOrgContext`, `showAdminOrgChooser` (in `admin-orgs.js`); `buildAssignNodeGroups`, `renderAssignSelectOptionsHTML`, `assignLabelFor`, `describeDeleteBlock`, `invalidateHierarchyCaches`, `renderAdminStatTiles`, `renderAdminStatTilesInto`, `renderAdminStatusBar` (in `admin-console.js`).

**Why `isAdmin`/`isInstanceAdminUser`/`adminUiVisible` stay in `app.js`:** they are session/account plumbing — `isAdmin()` and `adminUiVisible()` also drive `updateAccountUI()`'s nav-button visibility outside the admin view entirely, and moving them would risk breaking unrelated non-admin flows for no benefit. They are called (never redefined) by the admin files, exactly as `api`/`showToast`/`escapeHTML` already are.

- [ ] **Step 1: Write the failing test for the state model and section shell**

Create `tests/frontend-admin-console.test.js` (replacing its entire previous content):

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

export const TREE = {
  totals: { hospitals: 1, departments: 1, units: 2, wards: 1, usersActive: 2, usersDisabled: 0, livePatients: 5 },
  org: { id: 'bfv2-org', name: 'Default', stats: { livePatients: 5, byStatus: { postop: 3, preop: 1, conservative: 1, fordischarge: 0 }, users: 3, lastActivity: Date.now() - 60000 } },
  hospitals: [{ id: 'h1', name: 'City Hospital', stats: { livePatients: 5, byStatus: { postop: 3, preop: 1, conservative: 1, fordischarge: 0 }, users: 2, lastActivity: Date.now() - 60000 }, departments: [
    { id: 'd1', name: 'Ortho', specialty: 'ortho',
      stats: { livePatients: 5, byStatus: { postop: 3, preop: 1, conservative: 1, fordischarge: 0 }, users: 2, lastActivity: Date.now() - 60000 },
      units: [
        { id: 'u1', name: 'IV',
          stats: { livePatients: 4, byStatus: { postop: 3, preop: 1, conservative: 0, fordischarge: 0 }, users: 1, lastActivity: Date.now() - 60000 },
          wards: [{ id: 'w1', name: '7MOW', stats: { livePatients: 4, byStatus: { postop: 3, preop: 1, conservative: 0, fordischarge: 0 }, users: 0, lastActivity: null } }] },
        { id: 'u2', name: 'General',
          stats: { livePatients: 1, byStatus: { postop: 0, preop: 0, conservative: 1, fordischarge: 0 }, users: 1, lastActivity: null },
          wards: [] }
      ] }
  ]}]
};

function orgAdminEnv(){
  const env = loadFrontendEnv();
  const calls = [];
  env.window.api = async (path, opts) => {
    calls.push({ path, opts });
    if(path.startsWith('/api/admin/org')) return TREE;
    if(path === '/api/admin/users') return { users: [] };
    return {};
  };
  return Object.assign({ calls }, env);
}

describe('admin console shell: section tabs', () => {
  test('org admin sees 3 tabs (no Organizations); instance admin sees 4', () => {
    const { window, document } = orgAdminEnv();
    window.renderAdminSectionTabs();
    assert.deepEqual(
      [...document.querySelectorAll('[data-admin-section]')].map(b => b.dataset.adminSection),
      ['overview', 'people', 'structure']
    );
    window.localStorage.setItem('ortho_role', 'admin'); // admin + no org id => instance admin
    window.renderAdminSectionTabs();
    assert.deepEqual(
      [...document.querySelectorAll('[data-admin-section]')].map(b => b.dataset.adminSection),
      ['overview', 'people', 'structure', 'orgs']
    );
  });

  test('the active tab is marked aria-selected and is the only one with tabindex 0', () => {
    const { window, document } = orgAdminEnv();
    window.renderAdminSectionTabs();
    const overviewTab = document.querySelector('[data-admin-section="overview"]');
    assert.equal(overviewTab.getAttribute('aria-selected'), 'true');
    assert.equal(overviewTab.getAttribute('tabindex'), '0');
    const peopleTab = document.querySelector('[data-admin-section="people"]');
    assert.equal(peopleTab.getAttribute('aria-selected'), 'false');
    assert.equal(peopleTab.getAttribute('tabindex'), '-1');
  });

  test('switchAdminSection shows the target section and hides the others', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    window.switchAdminSection('people');
    assert.equal(document.getElementById('adminPeopleSection').hidden, false);
    assert.equal(document.getElementById('adminOverviewSection').hidden, true);
    assert.equal(document.getElementById('adminStructureSection').hidden, true);
    assert.equal(document.querySelector('[data-admin-section="people"]').getAttribute('aria-selected'), 'true');
  });

  test('clicking a tab switches sections', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    document.querySelector('[data-admin-section="structure"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminStructureSection').hidden, false);
  });

  test('ArrowRight moves to the next tab and activates it; Home jumps to the first', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    const tabs = document.getElementById('adminSectionTabs');
    tabs.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(document.getElementById('adminPeopleSection').hidden, false);
    tabs.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(document.getElementById('adminStructureSection').hidden, false);
    tabs.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assert.equal(document.getElementById('adminOverviewSection').hidden, false);
  });

  test('an unrecognised or unavailable section falls back to Overview on render', () => {
    const { window, document } = orgAdminEnv();
    window.switchAdminSection('orgs'); // org admin: 'orgs' is not visible to them
    window.renderAdminSectionTabs();
    assert.equal(document.getElementById('adminOverviewSection').hidden, false);
  });
});

describe('admin console shell: data load populates People even with no org chosen (instance admin)', () => {
  test('an instance admin with no viewed org still gets every user in adminData, and Structure/Overview show a chooser', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [{ id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 0, departments: 0, users: 1, livePatients: 0 } }] };
      if(path === '/api/admin/users') return { users: [{ id: 'u9', username: 'crossorg', role: 'member', active: true, orgId: 'o1', assignmentType: null, assignmentId: null }] };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    assert.ok(document.getElementById('adminPeopleSection').innerHTML.includes('crossorg'));
    window.switchAdminSection('structure');
    assert.ok(document.getElementById('adminStructureChooser').hidden === false);
    window.switchAdminSection('overview');
    assert.ok(document.getElementById('adminOverviewChooser').hidden === false);
  });
});

// Ported from the old tests/frontend-admin-view.test.js, which this file's
// predecessor already superseded once for the tree/detail/stat-tile
// coverage; these two are its last survivors.
describe('admin visibility (ported from frontend-admin-view.test.js)', () => {
  test('adminUiVisible: only admin + MULTI_TENANT flag', () => {
    const { window } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.serverFlags = { MULTI_TENANT: true };
    assert.equal(window.adminUiVisible(), true);
    window.serverFlags = { MULTI_TENANT: false };
    assert.equal(window.adminUiVisible(), false);
    window.localStorage.setItem('ortho_role', 'member');
    window.serverFlags = { MULTI_TENANT: true };
    assert.equal(window.adminUiVisible(), false);
  });

  test('flag off: admin entries stay hidden even for admins, and the view renders nothing', () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.serverFlags = {};
    window.updateAccountUI();
    const btn = document.getElementById('moreAdminBtn');
    assert.ok(btn, 'button exists in DOM');
    assert.equal(btn.style.display, 'none');
    assert.equal(document.getElementById('adminView').hidden, true);
  });
});

describe('Overview section', () => {
  test('renders the four stat tiles from the loaded tree', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    const tiles = [...document.querySelectorAll('#adminStatTiles .admin-stat-tile')];
    assert.equal(tiles.length, 4);
    assert.match(tiles.map(t => t.textContent).join(' '), /5/); // live patients
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="admin console shell"`

Expected: FAIL — `window.renderAdminSectionTabs`, `window.switchAdminSection` and the new container ids (`adminPeopleSection`, `adminStructureChooser`, etc.) don't exist yet.

- [ ] **Step 3: Replace the admin view markup in `index.html`**

Replace lines 2014-2030 of `public/index.html`:

```html
<!-- ADMIN CONSOLE (MULTI_TENANT admins only) -->
<div class="admin-view" id="adminView" hidden>
  <div class="admin-view-header">
    <button class="btn" id="adminViewClose">← Back</button>
    <h2 id="adminViewTitle">Admin console</h2>
  </div>
  <div class="admin-section-tabs" id="adminSectionTabs" role="tablist" aria-label="Admin console sections"></div>

  <div class="admin-section" id="adminOverviewSection">
    <div class="small-muted" id="adminOverviewChooser" hidden>Choose an organization on the Organizations tab first.</div>
    <div class="admin-stat-tiles" id="adminStatTiles"></div>
  </div>

  <div class="admin-section" id="adminPeopleSection" hidden></div>

  <div class="admin-section" id="adminStructureSection" hidden>
    <div class="small-muted" id="adminStructureChooser" hidden>Choose an organization on the Organizations tab first.</div>
    <div class="admin-cc" id="adminStructureBody">
      <aside class="admin-cc-rail" id="adminTreeRail"></aside>
      <section class="admin-cc-detail" id="adminDetailPane"></section>
    </div>
  </div>

  <div class="admin-section" id="adminOrgsSection" hidden></div>
</div>
```

- [ ] **Step 4: Add the tablist CSS**

In `public/index.html`, immediately after the `.admin-view-header{...}` rule (line 713), add:

```css
  .admin-section-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px;overflow-x:auto;}
  .admin-section-tab{background:none;border:0;border-bottom:2px solid transparent;padding:10px 14px;font:inherit;font-size:14px;color:var(--ink-soft);cursor:pointer;white-space:nowrap;min-height:44px;}
  .admin-section-tab:hover{color:var(--ink);}
  .admin-section-tab[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--accent);font-weight:700;}
  .admin-section-tab:focus-visible{outline:none;box-shadow:var(--focus-ring);border-radius:6px 6px 0 0;}
```

The rest of the existing `.admin-*` CSS (`.admin-stat-tiles`, `.admin-cc*`, `.admin-org-card`, etc.) is unchanged — it's layout for content, not for the old tab/pane containers, so it keeps working nested under the new section ids.

- [ ] **Step 5: Write the new `public/admin-console.js` (core)**

Replace the entire contents of `public/admin-console.js` with:

```js
/* Admin console — shared core: state, the four-section shell, and Overview.
   Plain script, not a module: function declarations must stay global so
   app.js's button handlers and the other three admin-*.js files can call
   them. Cross-file calls (e.g. this file calling renderAdminPeopleSection,
   defined in admin-people.js) only ever happen from inside a function body
   that runs later — never at this file's own top level — so the order the
   four admin-*.js files load in index.html does not matter. Runtime helpers
   (api, showToast, escapeHTML, formatRelativeTime, isInstanceAdminUser,
   isAdmin, adminUiVisible) come from app.js and are only *called* here. */

/** Server truth: the org tree, the user list, the org list. Replaced
    wholesale by loadAdminView(); nothing else in this file or the other
    admin-*.js files hand-edits it. */
let adminData = { tree: null, users: [], orgs: [] };

/** Everything about what the console is currently showing. Untouched by a
    reload — this is what makes search text, filter chips, tree expansion,
    selection and checked rows survive a mutation instead of being wiped by
    the next loadAdminView() (design spec defect 1). */
let adminUI = {
  section: 'overview',           // 'overview' | 'people' | 'structure' | 'orgs'
  viewedOrgId: null,             // instance admin: which org's tree is loaded
  allOrgs: [],                   // instance admin: every org, kept across a drill-in
  selectedNode: null,            // Structure: { type, id } | null
  structureExpanded: new Set(),  // Structure: "type:id" keys of expanded rows
  structureFilter: '',           // Structure: name filter text
  structureMobileDrilled: false, // Structure: phone drill-down flag
  peopleSearch: '',
  peopleFilter: 'all',           // 'all' | 'unassigned' | 'disabled' | 'admins' | 'stale' | 'node:<type>:<id>'
  peopleChecked: new Set()       // checked user ids, bulk assign
};

const ADMIN_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'structure', label: 'Structure' },
  { id: 'orgs', label: 'Organizations' }
];

function visibleAdminSections(){
  return isInstanceAdminUser() ? ADMIN_SECTIONS : ADMIN_SECTIONS.filter(s => s.id !== 'orgs');
}

function renderAdminSectionTabs(){
  const el = document.getElementById('adminSectionTabs');
  if(!el) return;
  const sections = visibleAdminSections();
  if(!sections.some(s => s.id === adminUI.section)) adminUI.section = 'overview';
  el.innerHTML = sections.map(s => `
    <button type="button" class="admin-section-tab" role="tab" id="adminTab-${s.id}"
      aria-selected="${s.id === adminUI.section}" tabindex="${s.id === adminUI.section ? '0' : '-1'}"
      data-admin-section="${s.id}">${escapeHTML(s.label)}</button>`).join('');
}

const ADMIN_SECTION_IDS = { overview: 'adminOverviewSection', people: 'adminPeopleSection', structure: 'adminStructureSection', orgs: 'adminOrgsSection' };

function renderAdminSection(){
  renderAdminSectionTabs();
  for(const [name, id] of Object.entries(ADMIN_SECTION_IDS)){
    const el = document.getElementById(id);
    if(el) el.hidden = adminUI.section !== name;
  }
  // Late-bound: renderAdminPeopleSection/renderAdminStructureSection/
  // renderAdminOrgsSection live in the other three admin-*.js files. This
  // call happens long after every <script> tag has run (it only fires from
  // an event handler or after an await), so it is safe regardless of the
  // order those files are listed in index.html.
  if(adminUI.section === 'people') renderAdminPeopleSection();
  else if(adminUI.section === 'structure') renderAdminStructureSection();
  else if(adminUI.section === 'orgs') renderAdminOrgsSection();
  else renderAdminOverviewSection();
}

function switchAdminSection(section){
  if(!visibleAdminSections().some(s => s.id === section)) return;
  adminUI.section = section;
  renderAdminSection();
  document.getElementById(`adminTab-${section}`)?.focus();
}

document.getElementById('adminSectionTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-admin-section]');
  if(btn) switchAdminSection(btn.dataset.adminSection);
});

document.getElementById('adminSectionTabs')?.addEventListener('keydown', (e) => {
  if(!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const sections = visibleAdminSections();
  const i = sections.findIndex(s => s.id === adminUI.section);
  if(i === -1) return;
  e.preventDefault();
  let next;
  if(e.key === 'ArrowLeft') next = sections[(i - 1 + sections.length) % sections.length];
  else if(e.key === 'ArrowRight') next = sections[(i + 1) % sections.length];
  else if(e.key === 'Home') next = sections[0];
  else next = sections[sections.length - 1];
  switchAdminSection(next.id);
});

/** True once an instance admin needs to pick an org before Overview or
    Structure — both are meaningless without a specific org's tree. People
    and Organizations are not gated by this: an instance admin can browse
    every user cross-org, and Organizations IS the picker. */
function adminNeedsOrgChoice(){
  return isInstanceAdminUser() && !adminUI.viewedOrgId;
}

function adminOrgChooserHTML(){
  return 'Choose an organization on the Organizations tab first.';
}

function renderAdminOverviewSection(){
  const chooser = document.getElementById('adminOverviewChooser');
  const tiles = document.getElementById('adminStatTiles');
  const needsOrg = adminNeedsOrgChoice();
  if(chooser) chooser.hidden = !needsOrg;
  if(tiles) tiles.hidden = needsOrg;
  if(needsOrg){ if(tiles) tiles.innerHTML = ''; return; }
  renderAdminStatTilesInto(adminData.tree);
}

function renderAdminStatTiles(tree){
  const postop = tree.hospitals.flatMap(h => h.departments).reduce((n, dep) => n + (dep.stats.byStatus.postop || 0), 0);
  const tiles = [
    { n: tree.totals.departments, l: 'Departments' },
    { n: tree.totals.usersActive, l: 'Active users' },
    { n: tree.totals.livePatients, l: 'Live patients' },
    { n: postop, l: 'Post-op' }
  ];
  return tiles.map(t => `<div class="admin-stat-tile"><div class="n">${t.n}</div><div class="l">${t.l}</div></div>`).join('');
}

function renderAdminStatTilesInto(tree){
  const el = document.getElementById('adminStatTiles');
  if(el) el.innerHTML = renderAdminStatTiles(tree);
}

function renderAdminStatusBar(byStatus, total){
  if(!total) return '<div class="admin-status-bar"></div>';
  const seg = (n, color) => n ? `<span style="width:${(n / total) * 100}%;background:${color}"></span>` : '';
  return `<div class="admin-status-bar">${
    seg(byStatus.postop, 'var(--status-postop)')}${
    seg(byStatus.preop, 'var(--status-preop)')}${
    seg(byStatus.conservative, 'var(--status-conservative)')}${
    seg(byStatus.fordischarge, 'var(--status-fordischarge)')}</div>`;
}

/** "unit" -> "Unit", "org" -> "Organization" (the only irregular one). */
function humanNodeType(type){
  if(type === 'org') return 'Organization';
  return type ? type[0].toUpperCase() + type.slice(1) : '';
}

// Walks the tree (plus the org list) into per-level groups so an assignment
// <select> can render an <optgroup> per node type. Option values encode
// "type:id" — change handlers split on the first ":". Labels are full paths
// (department-relative — see renderAssignSelectOptionsHTML's test for the
// exact "Ortho › IV › 7MOW" shape) so two same-named wards are distinguishable.
function buildAssignNodeGroups(tree, orgs){
  const groups = { org: [], hospital: [], department: [], unit: [], ward: [] };
  for(const o of orgs || []) groups.org.push({ id: o.id, label: o.name });
  for(const h of (tree && tree.hospitals) || []){
    groups.hospital.push({ id: h.id, label: h.name });
    for(const dep of h.departments || []){
      groups.department.push({ id: dep.id, label: `${h.name} › ${dep.name}` });
      for(const u of dep.units || []){
        groups.unit.push({ id: u.id, label: `${dep.name} › ${u.name}` });
        for(const w of u.wards || []) groups.ward.push({ id: w.id, label: `${dep.name} › ${u.name} › ${w.name}` });
      }
    }
  }
  return groups;
}

// Looks up the display label for a "type:id" assignment. Returns null when
// the node isn't in the current tree/org list (a stale assignment) so
// callers can render the "Assigned to a place that no longer exists" copy.
function assignLabelFor(groups, type, id){
  if(!type || !id) return null;
  const hit = (groups[type] || []).find(x => x.id === id);
  return hit ? hit.label : null;
}

function renderAssignSelectOptionsHTML(groups, selType, selId){
  const optgroup = (label, type, items) => items.length ? `<optgroup label="${escapeHTML(label)}">${items.map(it =>
    `<option value="${type}:${escapeHTML(it.id)}"${type === selType && it.id === selId ? ' selected' : ''}>${escapeHTML(it.label)}</option>`
  ).join('')}</optgroup>` : '';
  const known = (groups[selType] || []).some(x => x.id === selId);
  const stale = selType && selId && !known
    ? `<option value="${escapeHTML(selType)}:${escapeHTML(selId)}" selected>Assigned to a place that no longer exists</option>`
    : '';
  return `<option value="">— none —</option>` + stale +
    optgroup('Organizations', 'org', groups.org) +
    optgroup('Hospitals', 'hospital', groups.hospital) +
    optgroup('Departments', 'department', groups.department) +
    optgroup('Units', 'unit', groups.unit) +
    optgroup('Wards', 'ward', groups.ward);
}

/** Turns a 409 `{ error, blockedBy: { children, users, patients } }` into a
    sentence naming what is actually in the way. Returns null for any error
    without a blockedBy payload so callers can fall back to err.message. */
function describeDeleteBlock(err){
  const b = err && err.payload && err.payload.blockedBy;
  if(!b) return null;
  const bits = [];
  if(b.children) bits.push(`${b.children} child item${b.children === 1 ? '' : 's'}`);
  if(b.patients) bits.push(`${b.patients} patient${b.patients === 1 ? '' : 's'}`);
  if(b.users) bits.push(`${b.users} user${b.users === 1 ? '' : 's'}`);
  return bits.length ? `Can't delete — still has ${bits.join(', ')}` : null;
}

// A hierarchy edit here changes what the patient-form unit picker should
// show. That picker (in app.js) memoizes the scope tree per page session, so
// drop its cache on any node create/rename/delete/move to force a refetch.
function invalidateHierarchyCaches(){
  if(typeof invalidateScopeTree === 'function') invalidateScopeTree();
}

async function loadAdminView(){
  const instAdmin = isInstanceAdminUser();
  const usersPromise = api('/api/admin/users');
  if(instAdmin){
    const [usersRes, orgsRes] = await Promise.all([usersPromise, api('/api/admin/orgs')]);
    adminUI.allOrgs = orgsRes.orgs;
    adminData.orgs = adminUI.allOrgs;
    adminData.users = adminUI.viewedOrgId ? usersRes.users.filter(u => u.orgId === adminUI.viewedOrgId) : usersRes.users;
    adminData.tree = adminUI.viewedOrgId ? await api(`/api/admin/org?orgId=${encodeURIComponent(adminUI.viewedOrgId)}`) : null;
  }else{
    const [usersRes, tree] = await Promise.all([usersPromise, api('/api/admin/org')]);
    adminData.users = usersRes.users;
    adminData.tree = tree;
    adminData.orgs = tree.org ? [tree.org] : [];
  }
  renderAdminSection();
}

function openAdminView(){
  document.getElementById('adminView').hidden = false;
  loadAdminView().catch(err => showToast(err.message || 'Could not load admin data'));
}

function closeAdminView(){
  document.getElementById('adminView').hidden = true;
}
```

- [ ] **Step 6: Write `public/admin-structure.js` (ported, unchanged behaviour)**

Create `public/admin-structure.js`:

```js
/* Admin console — Structure section: the hospital -> department -> unit ->
   ward tree and its detail panel. Plain script (see admin-console.js's
   header comment for why). This task ports the previous single-file
   command-center tree/detail code over unchanged in behaviour, reading
   adminData/adminUI instead of the old adminState/module adminViewOrgId. */

function findAdminNode(tree, type, id){
  if(!tree) return null;
  for(const h of tree.hospitals || []){
    if(type === 'hospital' && h.id === id) return { node: h, parentType: 'org', parentId: null };
    for(const dep of h.departments || []){
      if(type === 'department' && dep.id === id) return { node: dep, parentType: 'hospital', parentId: h.id };
      for(const u of dep.units || []){
        if(type === 'unit' && u.id === id) return { node: u, parentType: 'department', parentId: dep.id };
        for(const w of u.wards || []){
          if(type === 'ward' && w.id === id) return { node: w, parentType: 'unit', parentId: u.id };
        }
      }
    }
  }
  return null;
}

function ccRowHTML(type, id, label, count, depth, selection){
  const sel = selection && selection.type === type && selection.id === id ? ' is-selected' : '';
  const c = count === null || count === undefined ? '' : `<span class="cc-count">${count}</span>`;
  return `<button type="button" data-depth="${depth}" data-node="${escapeHTML(type)}:${escapeHTML(id)}" class="admin-cc-row${sel}">${escapeHTML(label)}${c}</button>`;
}

function renderAdminTreeHTML(tree, selection){
  let out = '';
  if(tree && tree.org){
    out += ccRowHTML('org', tree.org.id, tree.org.name || 'Organization', tree.org.stats ? tree.org.stats.livePatients : null, 0, selection);
  }
  for(const h of (tree && tree.hospitals) || []){
    out += ccRowHTML('hospital', h.id, h.name, h.stats ? h.stats.livePatients : null, 0, selection);
    for(const dep of h.departments || []){
      out += ccRowHTML('department', dep.id, dep.name, dep.stats.livePatients, 1, selection);
      for(const u of dep.units || []){
        out += ccRowHTML('unit', u.id, u.name, u.stats.livePatients, 2, selection);
        for(const w of u.wards || []){
          out += ccRowHTML('ward', w.id, w.name, w.stats.livePatients, 3, selection);
        }
      }
    }
  }
  return out;
}

function selectAdminNode(type, id){
  adminUI.selectedNode = id ? { type, id } : { type };
  renderAdminStructureBody();
}

function childTypeOf(type){
  return { org: 'hospital', hospital: 'department', department: 'unit', unit: 'ward' }[type] || null;
}

function addChildRouteFor(type){
  return {
    org: { path: '/api/admin/hospitals', parentKey: 'orgId' },
    hospital: { path: '/api/admin/departments', parentKey: 'hospitalId' },
    department: { path: '/api/admin/units', parentKey: 'departmentId' },
    unit: { path: '/api/admin/wards', parentKey: 'unitId' }
  }[type] || null;
}

function childListOf(type, node){
  if(type === 'org') return node.hospitals || [];
  if(type === 'hospital') return node.departments || [];
  if(type === 'department') return node.units || [];
  if(type === 'unit') return node.wards || [];
  return [];
}

function nodeStatsHTML(node){
  const s = node.stats;
  if(!s) return '';
  const plural = s.livePatients === 1 ? '' : 's';
  return `
    <div class="small-muted">${s.livePatients} live patient${plural} · ${s.users} user${s.users === 1 ? '' : 's'}</div>
    ${renderAdminStatusBar(s.byStatus, s.livePatients)}
    <div class="small-muted">${s.lastActivity ? 'Active ' + formatRelativeTime(s.lastActivity) : 'No activity yet'}</div>`;
}

function renderAdminDetailHTML(state){
  const sel = state.selection;
  if(!sel) return '<div class="small-muted">Select something on the left.</div>';
  let hit;
  if(sel.type === 'org'){
    if(!state.tree || !state.tree.org) return `<div class="small-muted">That item no longer exists.</div>`;
    hit = { node: { id: state.tree.org.id, name: state.tree.org.name || 'Organization', stats: state.tree.org.stats, hospitals: state.tree.hospitals || [] }, parentType: null, parentId: null };
  } else {
    hit = findAdminNode(state.tree, sel.type, sel.id);
    if(!hit) return `<div class="small-muted">That item no longer exists.</div>`;
  }
  const { node } = hit;
  const kids = childListOf(sel.type, node);
  const childType = childTypeOf(sel.type);
  const kidsHTML = kids.length
    ? kids.map(k => `<button type="button" class="admin-cc-row" data-node="${escapeHTML(childType)}:${escapeHTML(k.id)}">${escapeHTML(k.name)}<span class="cc-count">${k.stats ? k.stats.livePatients : ''}</span></button>`).join('')
    : (childType ? `<div class="small-muted">No ${childType}s yet.</div>` : `<div class="small-muted">No contents.</div>`);
  const addChild = (childType && !adminIsNarrow()) ? `
    <div class="admin-inline-form">
      <input placeholder="New ${escapeHTML(childType)} name" data-new-child-name="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">
      <button class="btn" data-add-child="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">Add ${escapeHTML(childType)}</button>
    </div>` : '';
  return `
    <div class="admin-detail-head">
      <h3>${escapeHTML(node.name)}</h3>
      <span class="spec-badge">${escapeHTML(humanNodeType(sel.type))}</span>
      ${renderAdminNodeActionsHTML(state, sel, hit)}
    </div>
    ${nodeStatsHTML(node)}
    <h4>${childType ? childType[0].toUpperCase() + childType.slice(1) + 's' : 'Contents'}</h4>
    <div class="admin-cc-children">${kidsHTML}</div>
    ${addChild}`;
}

const MOVE_PARENT_TYPE = { department: 'hospital', unit: 'department', ward: 'unit' };

function validMoveParents(tree, type, currentParentId){
  const parentType = MOVE_PARENT_TYPE[type];
  if(!parentType) return [];
  const out = [];
  for(const h of (tree && tree.hospitals) || []){
    if(parentType === 'hospital'){ if(h.id !== currentParentId) out.push({ id: h.id, name: h.name }); continue; }
    for(const dep of h.departments || []){
      if(parentType === 'department'){ if(dep.id !== currentParentId) out.push({ id: dep.id, name: dep.name }); continue; }
      for(const u of dep.units || []){
        if(parentType === 'unit' && u.id !== currentParentId) out.push({ id: u.id, name: u.name });
      }
    }
  }
  return out;
}

function deleteBlockedReason(node, type){
  const bits = [];
  const kids = childListOf(type, node).length;
  if(kids) bits.push(`${kids} ${childTypeOf(type)}${kids === 1 ? '' : 's'}`);
  if(node.stats && node.stats.livePatients) bits.push(`${node.stats.livePatients} patient${node.stats.livePatients === 1 ? '' : 's'}`);
  if(node.stats && node.stats.users) bits.push(`${node.stats.users} user${node.stats.users === 1 ? '' : 's'}`);
  return bits.join(', ');
}

function adminIsNarrow(){
  return typeof window !== 'undefined' && window.innerWidth < 900;
}

function renderAdminNodeActionsHTML(state, sel, hit){
  if(adminIsNarrow()) return '<span class="small-muted">Open on a larger screen to edit</span>';
  const key = `${sel.type}:${sel.id}`;
  if(sel.type === 'org'){
    return `<span class="admin-node-actions"><button class="btn" data-rename-node="${escapeHTML(key)}">Rename</button></span>`;
  }
  const blocked = deleteBlockedReason(hit.node, sel.type);
  const parents = validMoveParents(state.tree, sel.type, hit.parentId);
  const moveHTML = MOVE_PARENT_TYPE[sel.type] ? `
    <select data-move-node="${escapeHTML(key)}">
      <option value="">Move to…</option>
      ${parents.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}
    </select>` : '';
  const deleteLabel = blocked ? `Can't delete — ${escapeHTML(blocked)}` : 'Delete';
  return `
    <span class="admin-node-actions">
      <button class="btn" data-rename-node="${escapeHTML(key)}">Rename</button>
      ${moveHTML}
      <button class="btn" data-delete-node="${escapeHTML(key)}"${blocked ? ' disabled' : ''} title="${escapeHTML(deleteLabel)}">${escapeHTML(deleteLabel)}</button>
    </span>`;
}

function renderAdminStructureSection(){
  const needsOrg = adminNeedsOrgChoice();
  const chooser = document.getElementById('adminStructureChooser');
  const body = document.getElementById('adminStructureBody');
  if(chooser) chooser.hidden = !needsOrg;
  if(body) body.hidden = needsOrg;
  if(needsOrg) return;
  renderAdminStructureBody();
}

function renderAdminStructureBody(){
  const rail = document.getElementById('adminTreeRail');
  if(rail) rail.innerHTML = renderAdminTreeHTML(adminData.tree, adminUI.selectedNode);
  const detail = document.getElementById('adminDetailPane');
  if(detail) detail.innerHTML = renderAdminDetailHTML({ tree: adminData.tree, users: adminData.users, orgs: adminData.orgs, selection: adminUI.selectedNode });
}

document.getElementById('adminStructureSection')?.addEventListener('click', (e) => {
  const addBtn = e.target.closest('[data-add-child]');
  if(addBtn){
    e.stopPropagation();
    const raw = addBtn.dataset.addChild;
    const i = raw.indexOf(':');
    const parentType = raw.slice(0, i), parentId = raw.slice(i + 1);
    const input = document.querySelector(`[data-new-child-name="${raw}"]`);
    const name = (input && input.value || '').trim();
    if(!name){ showToast('Enter a name'); return; }
    const route = addChildRouteFor(parentType);
    if(!route) return;
    const body = route.parentKey ? { [route.parentKey]: parentId, name } : { name };
    api(route.path, { method: 'POST', body: JSON.stringify(body) })
      .then(() => { invalidateHierarchyCaches(); return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
  const renameBtn = e.target.closest('[data-rename-node]');
  if(renameBtn){
    e.stopPropagation();
    const raw = renameBtn.dataset.renameNode;
    const i = raw.indexOf(':');
    const type = raw.slice(0, i), id = raw.slice(i + 1);
    const hit = findAdminNode(adminData.tree, type, id);
    const next = window.prompt('New name', hit ? hit.node.name : '');
    if(next === null) return;
    const name = next.trim();
    if(!name || name.length > 80){ showToast('Name required (max 80 chars)'); return; }
    api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) })
      .then(() => { invalidateHierarchyCaches(); return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
  const delBtn = e.target.closest('[data-delete-node]');
  if(delBtn){
    e.stopPropagation();
    if(delBtn.disabled) return;
    const raw = delBtn.dataset.deleteNode;
    const i = raw.indexOf(':');
    const type = raw.slice(0, i), id = raw.slice(i + 1);
    if(!window.confirm(`Delete this ${humanNodeType(type)}? This cannot be undone.`)) return;
    api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(() => { invalidateHierarchyCaches(); adminUI.selectedNode = null; return loadAdminView(); })
      .catch(err => showToast(describeDeleteBlock(err) || err.message));
    return;
  }
  const row = e.target.closest('[data-node]');
  if(!row) return;
  const raw = row.dataset.node;
  const i = raw.indexOf(':');
  if(i === -1) selectAdminNode(raw, null);
  else selectAdminNode(raw.slice(0, i), raw.slice(i + 1));
});

document.getElementById('adminStructureSection')?.addEventListener('change', async (e) => {
  const moveSel = e.target.closest('[data-move-node]');
  if(moveSel){
    const newParentId = moveSel.value;
    if(!newParentId) return;
    const raw = moveSel.dataset.moveNode;
    const i = raw.indexOf(':');
    const type = raw.slice(0, i), id = raw.slice(i + 1);
    api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify({ newParentId }) })
      .then(() => { invalidateHierarchyCaches(); return loadAdminView(); })
      .catch(err => { showToast(err.message); loadAdminView(); });
  }
});
```

- [ ] **Step 7: Write `public/admin-people.js` (ported, unchanged behaviour)**

Create `public/admin-people.js`:

```js
/* Admin console — People section: user list, create, role, placement,
   bulk assign. Plain script (see admin-console.js's header comment). This
   task ports the old users-table code over unchanged in behaviour, reading
   adminData/adminUI instead of adminState. */

function renderAdminUsersPanelHTML(state){
  const narrow = adminIsNarrow();
  const groups = buildAssignNodeGroups(state.tree, state.orgs);
  const rows = (state.users || []).map(u => {
    const selType = u.assignmentType || null, selId = u.assignmentId || null;
    const prev = selType && selId ? `${selType}:${selId}` : '';
    const actions = narrow ? '' : `
          <button class="btn" data-user-toggle="${escapeHTML(u.id)}">${u.active ? 'Disable' : 'Enable'}</button>
          <button class="btn" data-user-reset="${escapeHTML(u.id)}">Reset password</button>`;
    const checkCell = narrow ? '<td></td>' : `<td><input type="checkbox" data-user-check="${escapeHTML(u.id)}"></td>`;
    const label = assignLabelFor(groups, selType, selId);
    const assignText = label || (selType && selId ? 'Assigned to a place that no longer exists' : '—');
    const assignCell = narrow
      ? `<td>${escapeHTML(assignText)}</td>`
      : `<td><select data-assign-user="${escapeHTML(u.id)}" data-prev="${escapeHTML(prev)}">${renderAssignSelectOptionsHTML(groups, selType, selId)}</select></td>`;
    return `
      <tr data-user-row="${escapeHTML(u.id)}" data-username="${escapeHTML((u.username || '').toLowerCase())}">
        ${checkCell}
        <td>${escapeHTML(u.username)}</td>
        <td>${u.role === 'admin' ? '<span class="spec-badge">admin</span>' : 'member'}</td>
        ${assignCell}
        <td>${u.active ? 'active' : 'disabled'}${actions}
        </td>
      </tr>`;
  }).join('');
  const narrowNote = narrow ? '<div class="small-muted">Open on a larger screen to edit</div>' : '';
  const createUserForm = narrow ? '' : `
    <div class="admin-inline-form">
      <input id="adminNewUsername" placeholder="New username">
      <label class="scribe-check"><input type="checkbox" id="adminNewUserAdmin"> Admin</label>
      <button class="btn" id="adminCreateUser">Create user</button>
    </div>`;
  return `
    <div class="admin-detail-head"><h3>People</h3></div>
    <div class="admin-inline-form">
      <input id="adminUserSearch" placeholder="Search users…">
    </div>
    ${narrowNote}
    ${createUserForm}
    <div id="adminBulkBar" class="admin-bulk-bar" hidden></div>
    <table class="admin-users-table">
      <thead><tr><th></th><th>User</th><th>Role</th><th>Can see patients in</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAdminPeopleSection(){
  const el = document.getElementById('adminPeopleSection');
  if(el) el.innerHTML = renderAdminUsersPanelHTML(adminData);
}

function selectedAdminUserIds(){
  return Array.from(document.querySelectorAll('[data-user-check]'))
    .filter(cb => cb.checked)
    .map(cb => cb.dataset.userCheck);
}

function refreshAdminBulkBar(){
  const bar = document.getElementById('adminBulkBar');
  if(!bar) return;
  if(adminIsNarrow()){ bar.hidden = true; bar.innerHTML = ''; return; }
  const ids = selectedAdminUserIds();
  if(!ids.length){ bar.hidden = true; bar.innerHTML = ''; return; }
  const groups = buildAssignNodeGroups(adminData.tree, adminData.orgs);
  bar.hidden = false;
  bar.innerHTML = `<strong>${ids.length} selected</strong>
    <select id="adminBulkNode">${renderAssignSelectOptionsHTML(groups, null, null)}</select>
    <button class="btn" id="adminBulkApply">Assign</button>`;
}

document.getElementById('adminPeopleSection')?.addEventListener('input', (e) => {
  if(e.target.id !== 'adminUserSearch') return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('[data-user-row]').forEach(tr => {
    tr.style.display = !q || tr.dataset.username.includes(q) ? '' : 'none';
  });
});

document.getElementById('adminPeopleSection')?.addEventListener('click', (e) => {
  if(e.target.id === 'adminBulkApply'){
    e.stopPropagation();
    const ids = selectedAdminUserIds();
    const raw = document.getElementById('adminBulkNode').value;
    const i = raw.indexOf(':');
    const nodeType = i === -1 ? null : raw.slice(0, i);
    const nodeId = i === -1 ? null : raw.slice(i + 1);
    api('/api/admin/users/assign-bulk', { method: 'POST', body: JSON.stringify({ userIds: ids, nodeType, nodeId }) })
      .then(() => { showToast(`Assigned ${ids.length} user${ids.length === 1 ? '' : 's'}`); return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
  const toggleBtn = e.target.closest('[data-user-toggle]');
  if(toggleBtn){
    e.stopPropagation();
    const id = toggleBtn.dataset.userToggle;
    const user = (adminData.users || []).find(u => u.id === id);
    const path = user && user.active ? 'disable' : 'enable';
    if(path === 'disable' && !window.confirm('Disable this user? They will be signed out.')) return;
    api(`/api/admin/users/${encodeURIComponent(id)}/${path}`, { method: 'POST' })
      .then(() => loadAdminView())
      .catch(err => showToast(err.message));
    return;
  }
  const resetBtn = e.target.closest('[data-user-reset]');
  if(resetBtn){
    e.stopPropagation();
    const id = resetBtn.dataset.userReset;
    api(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST' })
      .then(res => { window.alert(`Temporary password (shown once): ${res.temporaryPassword}`); })
      .catch(err => showToast(err.message));
    return;
  }
  if(e.target.id === 'adminCreateUser'){
    e.stopPropagation();
    const nameEl = document.getElementById('adminNewUsername');
    const username = (nameEl.value || '').trim();
    if(!username){ showToast('Enter a username'); return; }
    const role = document.getElementById('adminNewUserAdmin').checked ? 'admin' : 'member';
    const body = { username, role };
    const orgId = adminUI.viewedOrgId || (adminData.tree && adminData.tree.org && adminData.tree.org.id) || null;
    if(orgId) body.orgId = orgId;
    api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) })
      .then(res => { window.alert(`User created. Temporary password (shown once): ${res.temporaryPassword}`); nameEl.value = ''; return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
});

document.getElementById('adminPeopleSection')?.addEventListener('change', async (e) => {
  if(e.target.matches('[data-user-check]')){ refreshAdminBulkBar(); return; }
  const sel = e.target.closest('[data-assign-user]');
  if(!sel) return;
  const raw = sel.value;
  const sepIdx = raw.indexOf(':');
  const nodeType = sepIdx === -1 ? null : raw.slice(0, sepIdx);
  const nodeId = sepIdx === -1 ? null : raw.slice(sepIdx + 1);
  try{
    await api(`/api/admin/users/${sel.dataset.assignUser}/assign`, { method: 'POST', body: JSON.stringify({ nodeType, nodeId }) });
    sel.dataset.prev = raw;
    showToast('Assignment updated');
  }catch(err){
    sel.value = sel.dataset.prev || '';
    showToast(err.message);
  }
});
```

- [ ] **Step 8: Write `public/admin-orgs.js` (ported, unchanged behaviour)**

Create `public/admin-orgs.js`:

```js
/* Admin console — Organizations section: instance-admin only. Plain script
   (see admin-console.js's header comment). Ported from the old orgs-tab
   code, reading adminUI.viewedOrgId instead of the old module adminViewOrgId. */

function renderAdminOrgsSection(){
  const el = document.getElementById('adminOrgsSection');
  if(!el) return;
  el.innerHTML = `<h3>Organizations</h3>` + (adminData.orgs || []).map(o => `
    <div class="admin-org-card" data-org-id="${escapeHTML(o.id)}">
      <strong>${escapeHTML(o.name)}</strong> <span class="spec-badge">${escapeHTML(o.plan)}</span>
      <div class="small-muted">${o.stats.hospitals} hospitals · ${o.stats.departments} departments · ${o.stats.users} users · ${o.stats.livePatients} live patients</div>
      <div class="admin-inline-form">
        <input placeholder="New org admin username" data-new-org-admin="${escapeHTML(o.id)}">
        <button class="btn" data-create-org-admin="${escapeHTML(o.id)}">Create org admin</button>
        <button class="btn" data-view-org="${escapeHTML(o.id)}">View</button>
      </div>
    </div>`).join('') + `
    <div class="admin-inline-form">
      <input placeholder="New organization name" id="adminNewOrgName">
      <button class="btn" id="adminAddOrgBtn">Create organization</button>
    </div>`;
}

/** Leave a drilled-in org and go back to the all-orgs list. */
function exitAdminOrgContext(){
  adminUI.viewedOrgId = null;
  adminUI.selectedNode = null;
  switchAdminSection('orgs');
}

/** Enter an org's tree. Selection is dropped so a node picked in the
    previous org cannot render as "That item no longer exists" here. */
function enterAdminOrgContext(orgId){
  adminUI.viewedOrgId = orgId;
  adminUI.selectedNode = null;
  switchAdminSection('structure');
}

document.getElementById('adminOrgsSection')?.addEventListener('click', (e) => {
  const viewOrgBtn = e.target.closest('[data-view-org]');
  if(viewOrgBtn){
    e.stopPropagation();
    enterAdminOrgContext(viewOrgBtn.dataset.viewOrg);
    return;
  }
  if(e.target.id === 'adminAddOrgBtn'){
    e.stopPropagation();
    const input = document.getElementById('adminNewOrgName');
    const name = (input && input.value || '').trim();
    if(!name){ showToast('Enter an organization name'); return; }
    api('/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name }) })
      .then(() => { input.value = ''; return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
  const mkOrgAdmin = e.target.closest('[data-create-org-admin]');
  if(mkOrgAdmin){
    e.stopPropagation();
    const oid = mkOrgAdmin.dataset.createOrgAdmin;
    const input = document.querySelector(`[data-new-org-admin="${oid}"]`);
    const username = (input && input.value || '').trim();
    if(!username){ showToast('Enter a username'); return; }
    api(`/api/admin/orgs/${encodeURIComponent(oid)}/admin`, { method: 'POST', body: JSON.stringify({ username }) })
      .then(r => showConfirm('Org admin created', `Temporary password for ${r.username}: ${r.temporaryPassword}\nIt is not shown again.`, { confirmLabel: 'Done' }))
      .then(() => loadAdminView())
      .catch(err => showToast(err.message));
    return;
  }
});
```

- [ ] **Step 9: Update the jsdom test harness to share `let`/`const` across the four admin files**

In `tests/helpers/frontend-env.js`, replace lines 74-79:

```js
  const appJs = readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const milestonesJs = readFileSync(path.join(PUBLIC_DIR, 'milestones.js'), 'utf8');
  const adminConsoleJs = readFileSync(path.join(PUBLIC_DIR, 'admin-console.js'), 'utf8');
  window.eval(milestonesJs);
  window.eval(adminConsoleJs);
  window.eval(initScript ? `${appJs}\n${initScript}` : appJs);
```

with:

```js
  const appJs = readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const milestonesJs = readFileSync(path.join(PUBLIC_DIR, 'milestones.js'), 'utf8');
  // The four admin-*.js files are separate <script> tags in index.html, so
  // in a real browser they share one top-level lexical scope (the same
  // realm's global environment record covers let/const across every classic
  // script). This jsdom harness's separate window.eval() calls do NOT share
  // that scope with each other (see this file's own header note) — so they
  // must be joined into a single eval() to see each other's top-level
  // `adminData`/`adminUI`, exactly like appJs+initScript already are below.
  const adminFiles = ['admin-console.js', 'admin-people.js', 'admin-structure.js', 'admin-orgs.js']
    .map(f => readFileSync(path.join(PUBLIC_DIR, f), 'utf8'));
  window.eval(milestonesJs);
  window.eval(adminFiles.join('\n'));
  window.eval(initScript ? `${appJs}\n${initScript}` : appJs);
```

- [ ] **Step 10: Delete the superseded test file**

Delete `tests/frontend-admin-view.test.js` (both of its tests were ported into `tests/frontend-admin-console.test.js` in Step 1).

- [ ] **Step 11: Create the three new section test files, ported from the pre-Task-1 suite**

Create `tests/frontend-admin-structure.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';
import { TREE } from './frontend-admin-console.test.js';

function mockAdminApi(calls, overrides){
  return async (path, opts) => {
    calls.push({ path, opts });
    if(path.startsWith('/api/admin/org')) return { totals: { departments: 0, usersActive: 0, livePatients: 0 }, hospitals: [] };
    if(path === '/api/admin/users') return { users: [] };
    return (overrides && overrides(path, opts)) || {};
  };
}

describe('command center tree', () => {
  test('renders a row per node with live counts (no Users/Organizations rows anymore — those are sections now)', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, null);
    assert.ok(html.includes('data-node="hospital:h1"'));
    assert.ok(html.includes('data-node="department:d1"'));
    assert.ok(html.includes('data-node="unit:u1"'));
    assert.ok(html.includes('data-node="ward:w1"'));
    assert.ok(!html.includes('data-node="users"'));
    assert.ok(!html.includes('data-node="orgs"'));
  });
  test('marks the selected node', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, { type: 'unit', id: 'u1' });
    assert.match(html, /data-node="unit:u1"[^>]*class="[^"]*is-selected/);
  });
  test('findAdminNode locates a node and its parent', () => {
    const { window } = loadFrontendEnv();
    const hit = window.findAdminNode(TREE, 'ward', 'w1');
    assert.equal(hit.node.name, '7MOW');
    assert.equal(hit.parentType, 'unit');
    assert.equal(hit.parentId, 'u1');
    assert.equal(window.findAdminNode(TREE, 'unit', 'nope'), null);
  });
  test('the tree contains an org root row with the org name and count', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, null);
    assert.ok(html.includes('data-node="org:bfv2-org"'));
  });
});

describe('detail panel', () => {
  test('unit detail shows name, capitalized type badge, stats and its wards', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('IV'));
    assert.ok(html.includes('4 live patient'));
    assert.ok(html.includes('7MOW'));
    assert.ok(html.includes('data-add-child="unit:u1"'));
    assert.ok(html.includes('>Unit<'));
  });
  test('department detail lists its units and offers add-unit', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'department', id: 'd1' } });
    assert.ok(html.includes('IV'));
    assert.ok(html.includes('General'));
    assert.ok(html.includes('data-add-child="department:d1"'));
  });
  test('department detail includes the status bar', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'department', id: 'd1' } });
    assert.ok(html.includes('admin-status-bar'));
  });
  test('ward detail has no add-child control and no "childrens" typo', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'ward', id: 'w1' } });
    assert.ok(!html.includes('data-add-child='));
    assert.ok(!html.toLowerCase().includes('childrens'));
  });
  test('childTypeOf maps the hierarchy', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.childTypeOf('hospital'), 'department');
    assert.equal(window.childTypeOf('department'), 'unit');
    assert.equal(window.childTypeOf('unit'), 'ward');
    assert.equal(window.childTypeOf('ward'), null);
  });
  test('org detail panel lists hospitals, offers add-child, and has no move/delete control', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'org', id: 'bfv2-org' } });
    assert.ok(html.includes('City Hospital'));
    assert.ok(html.includes('data-add-child="org:bfv2-org"'));
    assert.ok(!html.includes('data-move-node='));
    assert.ok(!html.includes('data-delete-node='));
  });
});

describe('structural actions', () => {
  test('unit offers rename, move (to other departments) and delete', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('data-rename-node="unit:u1"'));
    assert.ok(html.includes('data-move-node="unit:u1"'));
    assert.ok(html.includes('data-delete-node="unit:u1"'));
  });
  test('hospital has no move control', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'hospital', id: 'h1' } });
    assert.ok(!html.includes('data-move-node='));
  });
  test('delete is disabled with a reason when the node is not empty', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.match(html, /data-delete-node="unit:u1"[^>]*disabled/);
    assert.ok(html.includes('4 patients'));
  });
  test('delete is enabled for an empty node', () => {
    const { window } = loadFrontendEnv();
    const empty = JSON.parse(JSON.stringify(TREE));
    empty.hospitals[0].departments[0].units[1].stats.livePatients = 0;
    empty.hospitals[0].departments[0].units[1].stats.users = 0;
    const html = window.renderAdminDetailHTML({ tree: empty, users: [], orgs: [], selection: { type: 'unit', id: 'u2' } });
    assert.ok(!/data-delete-node="unit:u2"[^>]*disabled/.test(html));
  });
  test('validMoveParents lists same-type-parent nodes excluding the current parent', () => {
    const { window } = loadFrontendEnv();
    const parents = window.validMoveParents(TREE, 'unit', 'd1');
    assert.deepEqual([...parents.map(p => p.id)], []); // only one department exists
    const wardParents = window.validMoveParents(TREE, 'ward', 'u1');
    assert.deepEqual([...wardParents.map(p => p.id)], ['u2']);
  });
  test('a hospital with assigned users cannot be deleted and says why', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const emptied = JSON.parse(JSON.stringify(TREE));
    emptied.hospitals[0].departments = [];
    emptied.hospitals[0].stats.livePatients = 0;
    emptied.hospitals[0].stats.users = 2;
    const html = window.renderAdminDetailHTML({ tree: emptied, users: [], orgs: [], selection: { type: 'hospital', id: 'h1' } });
    assert.match(html, /data-delete-node="hospital:h1"[^>]*disabled/);
    assert.ok(html.includes('2 users'));
  });
});

describe('request-level coverage: structural actions (wrong parentKey corrupts data)', () => {
  test('add-child posts to the correct route with the correct parentKey, per level', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = mockAdminApi(calls);
    const cases = [
      { selType: 'hospital', selId: 'h1', expectPath: '/api/admin/departments', expectBody: { hospitalId: 'h1', name: 'New Department' } },
      { selType: 'department', selId: 'd1', expectPath: '/api/admin/units', expectBody: { departmentId: 'd1', name: 'New Unit' } },
      { selType: 'unit', selId: 'u1', expectPath: '/api/admin/wards', expectBody: { unitId: 'u1', name: 'New Ward' } }
    ];
    for(const c of cases){
      document.getElementById('adminDetailPane').innerHTML =
        window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: c.selType, id: c.selId } });
      document.querySelector(`[data-new-child-name="${c.selType}:${c.selId}"]`).value = c.expectBody.name;
      document.querySelector(`[data-add-child="${c.selType}:${c.selId}"]`).dispatchEvent(new window.Event('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
      const call = calls.find(x => x.path === c.expectPath && JSON.parse(x.opts.body).name === c.expectBody.name);
      assert.ok(call, `expected a POST to ${c.expectPath} for ${c.selType}:${c.selId}`);
      assert.equal(call.opts.method, 'POST');
      assert.deepEqual(JSON.parse(call.opts.body), c.expectBody);
    }
  });

  test('org add-child (add hospital) posts {orgId, name} so an instance admin can target the org', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = mockAdminApi(calls);
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'org', id: 'bfv2-org' } });
    document.querySelector('[data-new-child-name="org:bfv2-org"]').value = 'New Hospital';
    document.querySelector('[data-add-child="org:bfv2-org"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/hospitals');
    assert.ok(call, 'expected a POST to /api/admin/hospitals');
    assert.deepEqual(JSON.parse(call.opts.body), { orgId: 'bfv2-org', name: 'New Hospital' });
  });

  test('rename posts PATCH with {name}', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = mockAdminApi(calls);
    window.prompt = () => 'Renamed Unit';
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    document.querySelector('[data-rename-node="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/nodes/unit/u1');
    assert.ok(call, 'expected a PATCH to /api/admin/nodes/unit/u1');
    assert.equal(call.opts.method, 'PATCH');
    assert.deepEqual(JSON.parse(call.opts.body), { name: 'Renamed Unit' });
  });

  test('delete posts DELETE to the node route and clears selection', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = mockAdminApi(calls);
    window.confirm = () => true;
    const empty = JSON.parse(JSON.stringify(TREE));
    empty.hospitals[0].departments[0].units[1].stats.livePatients = 0;
    empty.hospitals[0].departments[0].units[1].stats.users = 0;
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: empty, users: [], orgs: [], selection: { type: 'unit', id: 'u2' } });
    document.querySelector('[data-delete-node="unit:u2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/nodes/unit/u2');
    assert.ok(call, 'expected a DELETE to /api/admin/nodes/unit/u2');
    assert.equal(call.opts.method, 'DELETE');
  });
});

describe('mobile read-only (removed in Task 11 — still gates today)', () => {
  test('narrow viewport hides editing controls and shows a note', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(!html.includes('data-rename-node='));
    assert.ok(!html.includes('data-add-child='));
    assert.ok(html.includes('larger screen'));
  });
  test('wide viewport keeps the controls', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('data-rename-node='));
  });
});

describe('409 blockedBy reaches the UI', () => {
  test('describeDeleteBlock names what is in the way', () => {
    const { window } = loadFrontendEnv();
    const err = new window.Error('Node is not empty');
    err.payload = { blockedBy: { children: 0, users: 1, patients: 3 } };
    assert.equal(window.describeDeleteBlock(err), "Can't delete — still has 3 patients, 1 user");
  });
  test('describeDeleteBlock returns null for an unrelated error', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.describeDeleteBlock(new window.Error('boom')), null);
  });
  test('a blocked delete toasts the explained reason, not the bare server string', async () => {
    const { window, document } = loadFrontendEnv();
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.confirm = () => true;
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return { totals: { departments: 0, usersActive: 0, livePatients: 0 }, hospitals: [] };
      if(path === '/api/admin/users') return { users: [] };
      if(opts && opts.method === 'DELETE'){
        const err = new window.Error('Node is not empty');
        err.status = 409;
        err.payload = { error: 'Node is not empty', blockedBy: { children: 0, users: 0, patients: 2 } };
        throw err;
      }
      return {};
    };
    const empty = JSON.parse(JSON.stringify(TREE));
    empty.hospitals[0].departments[0].units[1].stats.livePatients = 0;
    empty.hospitals[0].departments[0].units[1].stats.users = 0;
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: empty, users: [], orgs: [], selection: { type: 'unit', id: 'u2' } });
    document.querySelector('[data-delete-node="unit:u2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual([...toasts], ["Can't delete — still has 2 patients"]);
  });
});

describe('instance-admin org context', () => {
  const ORGS = [
    { id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 1, departments: 1, users: 2, livePatients: 3 } },
    { id: 'o2', name: 'Org Two', plan: 'paid', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }
  ];
  const ORG_ONE_TREE = {
    org: { id: 'o1', name: 'Org One', stats: { livePatients: 3, byStatus: { postop: 3, preop: 0, conservative: 0, fordischarge: 0 }, users: 2, lastActivity: null } },
    totals: { departments: 0, usersActive: 2, livePatients: 3 },
    hospitals: []
  };

  function instanceAdminEnv(){
    const env = loadFrontendEnv();
    env.window.localStorage.setItem('ortho_role', 'admin');
    const paths = [];
    env.window.api = async (path) => {
      paths.push(path);
      if(path === '/api/admin/orgs') return { orgs: ORGS };
      if(path.startsWith('/api/admin/org')) return ORG_ONE_TREE;
      if(path === '/api/admin/users') return { users: [
        { id: 'usr2', username: 'Amit', role: 'member', active: true, orgId: 'o1', assignmentType: 'org', assignmentId: 'o1' }
      ] };
      return {};
    };
    return Object.assign({ paths }, env);
  }

  test('viewing an org loads that org tree; leaving it returns to the org cards', async () => {
    const { window, document, paths } = instanceAdminEnv();
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    assert.ok(document.getElementById('adminOrgsSection').innerHTML.includes('Org Two'));

    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(document.getElementById('adminStructureSection').hidden === false);
    assert.ok(paths.includes('/api/admin/org?orgId=o1'), 'expected the org tree to load for o1');

    window.exitAdminOrgContext();
    await new Promise(r => setTimeout(r, 0));
    assert.ok(document.getElementById('adminOrgsSection').innerHTML.includes('Org Two'));
  });

  test('the assignment picker still lists every org after drilling into one', async () => {
    const { window, document } = instanceAdminEnv();
    await window.loadAdminView();
    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    window.switchAdminSection('people');
    const html = document.getElementById('adminPeopleSection').innerHTML;
    assert.ok(html.includes('value="org:o1"'));
    assert.ok(html.includes('value="org:o2"'), 'the other org must remain assignable');
  });

  test('switching org drops the previous org selection', async () => {
    const { window, document } = instanceAdminEnv();
    await window.loadAdminView();
    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    window.selectAdminNode('unit', 'gone-in-the-next-org');
    assert.ok(document.getElementById('adminDetailPane').innerHTML.includes('no longer exists'));

    window.exitAdminOrgContext();
    document.querySelector('[data-view-org="o2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(!document.getElementById('adminDetailPane').innerHTML.includes('no longer exists'));
  });

  test('Structure prompts for an org instead of sitting on Loading', async () => {
    const { window, document } = instanceAdminEnv();
    await window.loadAdminView();
    window.switchAdminSection('structure');
    assert.equal(document.getElementById('adminStructureChooser').hidden, false);
    assert.equal(document.getElementById('adminStructureBody').hidden, true);
  });

  test('creating an organization with a blank name says so instead of doing nothing', async () => {
    const { window, document } = instanceAdminEnv();
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.getElementById('adminNewOrgName').value = '   ';
    document.getElementById('adminAddOrgBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual([...toasts], ['Enter an organization name']);
  });
});
```

Create `tests/frontend-admin-people.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';
import { TREE } from './frontend-admin-console.test.js';

const CC_USERS = [
  { id: 'usr1', username: 'xavier', role: 'admin', active: true, orgId: null, assignmentType: null, assignmentId: null },
  { id: 'usr2', username: 'Amit', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'org', assignmentId: 'bfv2-org' },
  { id: 'usr3', username: 'ghost', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'unit', assignmentId: 'gone-unit' }
];

describe('assign-select grouping', () => {
  test('buildAssignNodeGroups groups nodes by level with full-path labels', () => {
    const { window } = loadFrontendEnv();
    const groups = window.buildAssignNodeGroups(TREE, [{ id: 'bfv2-org', name: 'Default' }]);
    assert.deepEqual([...groups.hospital.map(g => g.id)], ['h1']);
    assert.deepEqual([...groups.department.map(g => g.id)], ['d1']);
    assert.deepEqual([...groups.unit.map(g => g.id)], ['u1', 'u2']);
    assert.deepEqual([...groups.ward.map(g => g.id)], ['w1']);
    assert.equal(groups.department[0].label, 'City Hospital › Ortho');
    assert.equal(groups.unit[0].label, 'Ortho › IV');
    assert.equal(groups.ward[0].label, 'Ortho › IV › 7MOW');
  });

  test('renderAssignSelectOptionsHTML marks the selected node and encodes type:id in option values', () => {
    const { window } = loadFrontendEnv();
    const groups = window.buildAssignNodeGroups(TREE, []);
    const html = window.renderAssignSelectOptionsHTML(groups, 'unit', 'u1');
    assert.ok(html.includes('<option value="">— none —</option>'));
    assert.match(html, /<option value="unit:u1" selected>/);
    assert.ok(html.includes('<optgroup label="Wards">'));
  });

  test('a stale selection reads "Assigned to a place that no longer exists", not a raw type:id', () => {
    const { window } = loadFrontendEnv();
    const groups = window.buildAssignNodeGroups(TREE, []);
    const html = window.renderAssignSelectOptionsHTML(groups, 'unit', 'gone-unit');
    assert.ok(html.includes('Assigned to a place that no longer exists'));
    assert.ok(!html.includes('Stale ('));
  });
});

describe('delegated assign-select change handler', () => {
  test('fires the assign endpoint with {nodeType, nodeId}', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return { ok: true }; };
    document.getElementById('adminPeopleSection').innerHTML =
      '<select data-assign-user="usr2" data-prev="ward:w1"><option value="">— none —</option><option value="unit:u1">Ortho › IV</option></select>';
    const sel = document.querySelector('select[data-assign-user="usr2"]');
    sel.value = 'unit:u1';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/admin/users/usr2/assign');
    assert.equal(calls[0].opts.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { nodeType: 'unit', nodeId: 'u1' });
  });

  test('blank option unassigns with nodeId:null', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return { ok: true }; };
    document.getElementById('adminPeopleSection').innerHTML =
      '<select data-assign-user="usr2" data-prev="ward:w1"><option value="">— none —</option><option value="unit:u1">Ortho › IV</option></select>';
    const sel = document.querySelector('select[data-assign-user="usr2"]');
    sel.value = '';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].opts.body).nodeId, null);
  });
});

describe('users panel', () => {
  test('assignment picker includes an Organizations group', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }] });
    assert.ok(html.includes('<optgroup label="Organizations"'));
    assert.ok(html.includes('value="org:bfv2-org"'));
  });
  test('an org-assigned user is preselected, not shown as none', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }] });
    assert.match(html, /value="org:bfv2-org"\s+selected/);
  });
  test('a stale assignment reads the plain-language warning, not the raw type:id', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [] });
    assert.ok(html.includes('Assigned to a place that no longer exists'));
  });
  test('rows carry a search key and a checkbox', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [] });
    assert.ok(html.includes('data-user-row="usr2"'));
    assert.ok(html.includes('data-user-check="usr2"'));
    assert.ok(html.includes('id="adminUserSearch"'));
  });
});

describe('bulk assign', () => {
  test('checking rows reveals the bulk bar and posts assign-bulk', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: CC_USERS };
      return { ok: true };
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const cb = document.querySelector('[data-user-check="usr2"]');
    cb.checked = true;
    cb.dispatchEvent(new window.Event('change', { bubbles: true }));
    const bar = document.getElementById('adminBulkBar');
    assert.equal(bar.hasAttribute('hidden'), false);
    assert.ok(bar.innerHTML.includes('1 selected'));
    assert.deepEqual([...window.selectedAdminUserIds()], ['usr2']);

    document.getElementById('adminBulkNode').value = 'unit:u1';
    document.getElementById('adminBulkApply').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const assignCall = calls.find(c => c.path === '/api/admin/users/assign-bulk');
    assert.ok(assignCall, 'expected a POST to /api/admin/users/assign-bulk');
    assert.deepEqual(JSON.parse(assignCall.opts.body), { userIds: ['usr2'], nodeType: 'unit', nodeId: 'u1' });
  });
});

describe('user lifecycle', () => {
  test('rows expose toggle and reset controls; create form present', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [] });
    assert.ok(html.includes('data-user-toggle="usr2"'));
    assert.ok(html.includes('data-user-reset="usr2"'));
    assert.ok(html.includes('id="adminCreateUser"'));
    assert.ok(html.includes('id="adminNewUsername"'));
  });
  test('a disabled user offers Enable', () => {
    const { window } = loadFrontendEnv();
    const users = [{ id: 'u9', username: 'off', role: 'member', active: false, orgId: null, assignmentType: null, assignmentId: null }];
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users, orgs: [] });
    assert.match(html, /data-user-toggle="u9"[^>]*>Enable</);
  });

  test('create user carries the org in context so the new user is not org-less', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return Object.assign({}, TREE, { org: { id: 'bfv2-org', name: 'Default' } });
      if(path === '/api/admin/users' && (!opts || opts.method !== 'POST')) return { users: [] };
      return { temporaryPassword: 'bone-plate-1234' };
    };
    window.alert = () => {};
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.getElementById('adminNewUsername').value = 'newpg';
    document.getElementById('adminCreateUser').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/users' && c.opts && c.opts.method === 'POST');
    assert.ok(call, 'expected a POST to /api/admin/users');
    assert.deepEqual(JSON.parse(call.opts.body), { username: 'newpg', role: 'member', orgId: 'bfv2-org' });
  });
});

describe('mobile read-only (removed in Task 11 — still gates today)', () => {
  test('narrow users panel has no live write path: no checkbox, no assign select, but still shows username and assignment as text', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }] });
    assert.ok(!html.includes('data-assign-user'));
    assert.ok(!html.includes('data-user-check'));
    assert.ok(html.includes('xavier'));
    assert.ok(html.includes('Amit'));
    assert.ok(html.includes('Default'));
    assert.ok(html.includes('Assigned to a place that no longer exists'));
    assert.ok(html.includes('—'));
  });
  test('narrow: refreshAdminBulkBar leaves the bulk bar hidden even if a checkbox is injected and checked', () => {
    const { window, document } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    document.getElementById('adminPeopleSection').innerHTML = '<div id="adminBulkBar" hidden></div><input type="checkbox" data-user-check="usr2">';
    const cb = document.querySelector('[data-user-check="usr2"]');
    cb.checked = true;
    window.refreshAdminBulkBar();
    const bar = document.getElementById('adminBulkBar');
    assert.equal(bar.hasAttribute('hidden'), true);
    assert.equal(bar.innerHTML, '');
  });
  test('wide users panel still renders the live assign select and checkbox (regression guard)', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }] });
    assert.ok(html.includes('data-assign-user="usr2"'));
    assert.ok(html.includes('data-user-check="usr2"'));
  });
});
```

Create `tests/frontend-admin-orgs.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

describe('orgs section rendering', () => {
  test('renders rollup cards after an instance-admin load', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin'); // instance admin
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [
        { id: 'o1', name: 'Pilot Org', plan: 'free', createdAt: 1, stats: { hospitals: 1, departments: 2, users: 4, livePatients: 7 } }
      ] };
      if(path === '/api/admin/users') return { users: [] };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    const cards = document.querySelectorAll('#adminOrgsSection .admin-org-card');
    assert.equal(cards.length, 1);
    assert.match(cards[0].textContent, /Pilot Org/);
    assert.match(cards[0].textContent, /7/);
  });
});
```

Do **not** reach into `window.adminData` / `window.adminUI` from tests — those are `let` bindings, not `window` properties. Drive state through `loadAdminView()` / `switchAdminSection()` / clicks and assert on the DOM (or on function-declaration globals such as `renderAdminOrgsSection`).

- [ ] **Step 12: Run all the new/rewritten tests to verify they pass**

Run: `npm test -- --test-name-pattern="admin console shell|admin visibility|Overview section|command center tree|detail panel|structural actions|request-level coverage|mobile read-only|409 blockedBy|instance-admin org context|assign-select grouping|delegated assign-select|users panel|bulk assign|user lifecycle|orgs section rendering"`

Expected: PASS, all tests green.

- [ ] **Step 13: Add the four new script tags to `index.html` and run the full suite**

In `public/index.html`, replace the single line `<script src="admin-console.js"></script>` (line 2216) with:

```html
<script src="admin-console.js"></script>
<script src="admin-people.js"></script>
<script src="admin-structure.js"></script>
<script src="admin-orgs.js"></script>
```

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 14: Commit**

```bash
git add public/admin-console.js public/admin-people.js public/admin-structure.js public/admin-orgs.js public/index.html tests/helpers/frontend-env.js tests/frontend-admin-console.test.js tests/frontend-admin-people.test.js tests/frontend-admin-structure.test.js tests/frontend-admin-orgs.test.js
git rm tests/frontend-admin-view.test.js
git commit -m "refactor: split admin-console.js into a four-section shell

adminState becomes adminData (server truth) + adminUI (UI state,
untouched by a reload). The single 697-line admin-console.js becomes a
shared core plus admin-people.js/admin-structure.js/admin-orgs.js, one
per section, each with its own delegated event listeners. Behaviour is
otherwise unchanged except that People now works for an instance
admin before they pick an org (there is no tree-shaped reason to gate
it), and Overview/Structure show a chooser instead of a permanent
Loading… in that state."
```

---

### Task 2: People state survives every mutation (targeted rendering foundation)

Fixes design spec defect 1 for the (still old-shaped) People list: search text and checked rows must survive any mutation. `adminUI.peopleSearch` and `adminUI.peopleChecked` become the source of truth; `renderAdminPeopleSection()` reapplies both after every repaint instead of relying on the DOM to remember them, and toggling/reset no longer force a full `loadAdminView()` round trip when only one row's status changed.

**Files:**
- Modify: `public/admin-people.js`
- Test: `tests/frontend-admin-people.test.js`

**Interfaces:**
- Consumes: `adminUI.peopleSearch` (string), `adminUI.peopleChecked` (`Set<string>`) — both already declared in `admin-console.js`'s `adminUI` object from Task 1.
- Produces: `renderAdminPeopleRow(userId)` — repaints exactly one `<tr data-user-row>` in place, used after disable/enable/reset instead of `loadAdminView()`. `applyAdminPeopleSearch()` — re-applies the current `adminUI.peopleSearch` value as row visibility, called after every full repaint.

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-people.test.js`:

```js
describe('search and selection survive a mutation (defect 1)', () => {
  test('typing a search term, then disabling a different user, keeps the search box value and the filtered rows', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: CC_USERS };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    window.showConfirm = () => Promise.resolve(true);
    await window.loadAdminView();
    window.switchAdminSection('people');

    const search = document.getElementById('adminUserSearch');
    search.value = 'amit';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.querySelector('[data-user-row="usr1"]').style.display, 'none');
    assert.equal(document.querySelector('[data-user-row="usr2"]').style.display, '');

    document.querySelector('[data-user-toggle="usr1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    assert.equal(document.getElementById('adminUserSearch').value, 'amit');
    assert.equal(document.querySelector('[data-user-row="usr1"]').style.display, 'none');
    assert.equal(document.querySelector('[data-user-row="usr2"]').style.display, '');
  });

  test('checking a row, then disabling a different user, keeps the checkbox checked', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: CC_USERS };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    window.showConfirm = () => Promise.resolve(true);
    await window.loadAdminView();
    window.switchAdminSection('people');

    document.querySelector('[data-user-check="usr2"]').checked = true;
    document.querySelector('[data-user-check="usr2"]').dispatchEvent(new window.Event('change', { bubbles: true }));

    document.querySelector('[data-user-toggle="usr1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    assert.equal(document.querySelector('[data-user-check="usr2"]').checked, true);
    assert.equal(document.getElementById('adminBulkBar').hasAttribute('hidden'), false);
  });

  test('disabling a user repaints only that row (other rows untouched)', async () => {
    const { window, document } = loadFrontendEnv();
    let users = CC_USERS.map(u => Object.assign({}, u));
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users };
      if(opts && opts.method === 'POST' && /\/disable$/.test(path)){
        users = users.map(u => u.id === 'usr2' ? Object.assign({}, u, { active: false }) : u);
        return { ok: true };
      }
      return {};
    };
    window.showConfirm = () => Promise.resolve(true);
    await window.loadAdminView();
    window.switchAdminSection('people');
    const otherRowBefore = document.querySelector('[data-user-row="usr1"]').outerHTML;

    document.querySelector('[data-user-toggle="usr2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    assert.equal(document.querySelector('[data-user-row="usr1"]').outerHTML, otherRowBefore);
    assert.match(document.querySelector('[data-user-row="usr2"]').innerHTML, /data-user-toggle="usr2"[^>]*>Enable</);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="search and selection survive a mutation"`

Expected: FAIL — the first test fails because `loadAdminView()` after the toggle click fully repaints `renderAdminUsersPanelHTML`, which rebuilds `#adminUserSearch` with an empty value and no rows hidden; the second fails the same way (a fresh checkbox, unchecked); the third fails because disable still rebuilds the whole panel (or still uses `window.confirm` instead of `showConfirm`).

- [ ] **Step 3: Track search and checked state in `adminUI`, and add row-level repaint**

In `public/admin-people.js`, replace the `document.getElementById('adminPeopleSection')?.addEventListener('input', ...)` block with:

```js
function applyAdminPeopleSearch(){
  const q = adminUI.peopleSearch.trim().toLowerCase();
  document.querySelectorAll('[data-user-row]').forEach(tr => {
    tr.style.display = !q || tr.dataset.username.includes(q) ? '' : 'none';
  });
}

function applyAdminPeopleChecked(){
  document.querySelectorAll('[data-user-check]').forEach(cb => {
    cb.checked = adminUI.peopleChecked.has(cb.dataset.userCheck);
  });
}

document.getElementById('adminPeopleSection')?.addEventListener('input', (e) => {
  if(e.target.id !== 'adminUserSearch') return;
  adminUI.peopleSearch = e.target.value;
  applyAdminPeopleSearch();
});
```

Replace `renderAdminPeopleSection` with:

```js
function renderAdminPeopleSection(){
  const el = document.getElementById('adminPeopleSection');
  if(!el) return;
  el.innerHTML = renderAdminUsersPanelHTML(adminData);
  const search = document.getElementById('adminUserSearch');
  if(search) search.value = adminUI.peopleSearch;
  applyAdminPeopleSearch();
  applyAdminPeopleChecked();
  refreshAdminBulkBar();
}
```

Add, immediately after `renderAdminUsersPanelHTML`:

```js
function renderAdminPeopleRowHTML(u){
  const narrow = adminIsNarrow();
  const groups = buildAssignNodeGroups(adminData.tree, adminData.orgs);
  const selType = u.assignmentType || null, selId = u.assignmentId || null;
  const prev = selType && selId ? `${selType}:${selId}` : '';
  const actions = narrow ? '' : `
        <button class="btn" data-user-toggle="${escapeHTML(u.id)}">${u.active ? 'Disable' : 'Enable'}</button>
        <button class="btn" data-user-reset="${escapeHTML(u.id)}">Reset password</button>`;
  const checkCell = narrow ? '<td></td>' : `<td><input type="checkbox" data-user-check="${escapeHTML(u.id)}"${adminUI.peopleChecked.has(u.id) ? ' checked' : ''}></td>`;
  const label = assignLabelFor(groups, selType, selId);
  const assignText = label || (selType && selId ? 'Assigned to a place that no longer exists' : '—');
  const assignCell = narrow
    ? `<td>${escapeHTML(assignText)}</td>`
    : `<td><select data-assign-user="${escapeHTML(u.id)}" data-prev="${escapeHTML(prev)}">${renderAssignSelectOptionsHTML(groups, selType, selId)}</select></td>`;
  return `${checkCell}
        <td>${escapeHTML(u.username)}</td>
        <td>${u.role === 'admin' ? '<span class="spec-badge">admin</span>' : 'member'}</td>
        ${assignCell}
        <td>${u.active ? 'active' : 'disabled'}${actions}
        </td>`;
}

/** Repaints exactly one row in place, so a status/placement change on one
    person doesn't wipe the search box or every other row's checkbox state
    the way a full loadAdminView() repaint would. */
function renderAdminPeopleRow(userId){
  const row = document.querySelector(`[data-user-row="${CSS.escape(userId)}"]`);
  const u = (adminData.users || []).find(x => x.id === userId);
  if(!row || !u) return;
  row.innerHTML = renderAdminPeopleRowHTML(u);
}
```

Now make `renderAdminUsersPanelHTML`'s row loop reuse `renderAdminPeopleRowHTML` instead of duplicating the markup. Replace the body of the `rows = (state.users || []).map(...)` block inside `renderAdminUsersPanelHTML` with:

```js
  const rows = (state.users || []).map(u =>
    `<tr data-user-row="${escapeHTML(u.id)}" data-username="${escapeHTML((u.username || '').toLowerCase())}">${renderAdminPeopleRowHTML(u)}</tr>`
  ).join('');
```

Update the `[data-user-check]` change listener and the toggle/reset click handlers to update `adminUI.peopleChecked` and repaint only the affected row. Replace the `document.getElementById('adminPeopleSection')?.addEventListener('change', ...)` block's `if(e.target.matches('[data-user-check]')){ refreshAdminBulkBar(); return; }` line with:

```js
  if(e.target.matches('[data-user-check]')){
    const id = e.target.dataset.userCheck;
    if(e.target.checked) adminUI.peopleChecked.add(id); else adminUI.peopleChecked.delete(id);
    refreshAdminBulkBar();
    return;
  }
```

Replace the `toggleBtn` branch in the click handler. Prefer `showConfirm` over `window.confirm` (same pattern as role change / delete):

```js
  const toggleBtn = e.target.closest('[data-user-toggle]');
  if(toggleBtn){
    e.stopPropagation();
    const id = toggleBtn.dataset.userToggle;
    const user = (adminData.users || []).find(u => u.id === id);
    const path = user && user.active ? 'disable' : 'enable';
    (async () => {
      if(path === 'disable' && !(await showConfirm('Disable this person?', 'They will be signed out.', { confirmLabel: 'Disable', danger: true }))) return;
      try{
        await api(`/api/admin/users/${encodeURIComponent(id)}/${path}`, { method: 'POST' });
        const usersRes = await api('/api/admin/users');
        adminData.users = isInstanceAdminUser() && adminUI.viewedOrgId
          ? usersRes.users.filter(u => u.orgId === adminUI.viewedOrgId)
          : usersRes.users;
        renderAdminPeopleRow(id);
      }catch(err){ showToast(err.message); }
    })();
    return;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="search and selection survive a mutation"`

Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add public/admin-people.js tests/frontend-admin-people.test.js
git commit -m "fix: keep People's search text and checked rows across a mutation

adminUI.peopleSearch/peopleChecked are now the source of truth, and
disabling/enabling/resetting a person repaints only that row instead
of refetching and repainting the whole panel."
```

---

### Task 3: Overview — quick actions and Needs attention

**Files:**
- Modify: `public/admin-console.js`
- Modify: `public/index.html` (CSS only)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `adminData.tree`, `adminData.users`, `switchAdminSection`, `assignLabelFor`/`buildAssignNodeGroups` (to detect a stale assignment).
- Produces: `computeAdminNeedsAttention(tree, users)` → `{ unassigned: User[], stale: User[], emptyUnits: {id,name}[], disabled: User[] }` (pure, tested standalone). `renderAdminNeedsAttentionHTML(categories)`. Globals `quickActionAddPerson()`, `quickActionAddWard()`, `quickActionFixAssignment()` wired to buttons with ids `adminQuickAddPerson`, `adminQuickAddWard`, `adminQuickFixAssignment`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-console.test.js`:

```js
describe('Overview: computeAdminNeedsAttention', () => {
  const users = [
    { id: 'u1', username: 'unassigned1', active: true, role: 'member', assignmentType: null, assignmentId: null },
    { id: 'u2', username: 'stale1', active: true, role: 'member', assignmentType: 'unit', assignmentId: 'gone' },
    { id: 'u3', username: 'fine1', active: true, role: 'member', assignmentType: 'unit', assignmentId: 'u1' },
    { id: 'u4', username: 'off1', active: false, role: 'member', assignmentType: 'unit', assignmentId: 'u1' }
  ];
  const withEmptyUnit = JSON.parse(JSON.stringify(TREE));
  withEmptyUnit.hospitals[0].departments[0].units.push({ id: 'u-empty', name: 'Empty Unit', stats: { livePatients: 0, byStatus: { postop: 0, preop: 0, conservative: 0, fordischarge: 0 }, users: 0, lastActivity: null }, wards: [] });

  test('categorizes unassigned, stale, empty-unit and disabled', () => {
    const { window } = loadFrontendEnv();
    const cats = window.computeAdminNeedsAttention(withEmptyUnit, users);
    assert.deepEqual(cats.unassigned.map(u => u.id), ['u1']);
    assert.deepEqual(cats.stale.map(u => u.id), ['u2']);
    assert.deepEqual(cats.emptyUnits.map(u => u.id), ['u-empty']);
    assert.deepEqual(cats.disabled.map(u => u.id), ['u4']);
  });

  test('a unit with wards, patients or users is not "empty"', () => {
    const { window } = loadFrontendEnv();
    const cats = window.computeAdminNeedsAttention(TREE, []);
    assert.deepEqual(cats.emptyUnits, []); // u1 has patients+wards, u2 has a user
  });

  test('renderAdminNeedsAttentionHTML omits a category with zero entries', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminNeedsAttentionHTML({ unassigned: [], stale: [], emptyUnits: [], disabled: [] });
    assert.equal(html, '');
  });

  test('renderAdminNeedsAttentionHTML lists a populated category', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminNeedsAttentionHTML({ unassigned: [{ id: 'u1', username: 'unassigned1' }], stale: [], emptyUnits: [], disabled: [] });
    assert.ok(html.includes('unassigned1'));
    assert.ok(html.includes('data-attention-people="unassigned"'));
  });
});

describe('Overview: quick actions', () => {
  test('Add person switches to People and focuses the create form', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    document.getElementById('adminQuickAddPerson').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminPeopleSection').hidden, false);
    assert.equal(document.activeElement.id, 'adminNewUsername');
  });

  test('Fix an assignment switches to People with the Unassigned filter active', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    document.getElementById('adminQuickFixAssignment').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminPeopleSection').hidden, false);
    assert.equal(window.adminUI.peopleFilter, 'unassigned');
  });

  test('Add ward switches to Structure and selects the first unit', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    document.getElementById('adminQuickAddWard').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminStructureSection').hidden, false);
    assert.equal(document.querySelector('[data-node="unit:u1"]').classList.contains('is-selected'), true);
    assert.ok(document.querySelector('[data-new-child-name="unit:u1"]'));
  });

  test('a category entry navigates and filters: an empty-unit entry selects that unit in Structure', async () => {
    const { window, document } = orgAdminEnv();
    const withEmptyUnit = JSON.parse(JSON.stringify(TREE));
    withEmptyUnit.hospitals[0].departments[0].units.push({ id: 'u-empty', name: 'Empty Unit', stats: { livePatients: 0, byStatus: { postop: 0, preop: 0, conservative: 0, fordischarge: 0 }, users: 0, lastActivity: null }, wards: [] });
    window.api = async (path) => path.startsWith('/api/admin/org') ? withEmptyUnit : { users: [] };
    await window.loadAdminView();
    document.querySelector('[data-attention-unit="u-empty"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminStructureSection').hidden, false);
    assert.equal(document.querySelector('[data-node="unit:u-empty"]').classList.contains('is-selected'), true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="Overview: computeAdminNeedsAttention|Overview: quick actions"`

Expected: FAIL — `window.computeAdminNeedsAttention`, `window.renderAdminNeedsAttentionHTML`, and the three `adminQuick*` buttons don't exist yet.

- [ ] **Step 3: Add the Overview markup**

In `public/index.html`, replace the `#adminOverviewSection` block from Task 1 with:

```html
  <div class="admin-section" id="adminOverviewSection">
    <div class="small-muted" id="adminOverviewChooser" hidden>Choose an organization on the Organizations tab first.</div>
    <div id="adminOverviewBody">
      <div class="admin-stat-tiles" id="adminStatTiles"></div>
      <div class="admin-quick-actions">
        <button class="btn" id="adminQuickAddPerson">Add person</button>
        <button class="btn" id="adminQuickAddWard">Add ward</button>
        <button class="btn" id="adminQuickFixAssignment">Fix an assignment</button>
      </div>
      <div id="adminNeedsAttention"></div>
    </div>
  </div>
```

Add CSS after the `.admin-stat-tile .l{...}` rule:

```css
  .admin-quick-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0;}
  .admin-attention-group{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px;}
  .admin-attention-group h4{margin:0 0 6px;font-size:13px;color:var(--ink-soft);}
  .admin-attention-row{display:block;width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--line-soft, var(--line));padding:8px 2px;color:var(--ink);cursor:pointer;font:inherit;min-height:44px;}
  .admin-attention-row:first-of-type{border-top:0;}
  .admin-attention-row:hover{background:var(--accent-soft);}
```

- [ ] **Step 4: Implement `computeAdminNeedsAttention` and `renderAdminNeedsAttentionHTML`**

In `public/admin-console.js`, add:

```js
/** Four Needs-attention categories. A unit is "empty" when it has no wards,
    no live patients and no assigned users — migration debris. */
function computeAdminNeedsAttention(tree, users){
  const groups = buildAssignNodeGroups(tree, []);
  const unassigned = [], stale = [], disabled = [];
  for(const u of users || []){
    if(!u.active){ disabled.push(u); continue; }
    if(!u.assignmentType || !u.assignmentId){ unassigned.push(u); continue; }
    if(!assignLabelFor(groups, u.assignmentType, u.assignmentId)) stale.push(u);
  }
  const emptyUnits = [];
  for(const h of (tree && tree.hospitals) || []){
    for(const dep of h.departments || []){
      for(const unit of dep.units || []){
        const noWards = !(unit.wards || []).length;
        const noPatients = !unit.stats || !unit.stats.livePatients;
        const noUsers = !unit.stats || !unit.stats.users;
        if(noWards && noPatients && noUsers) emptyUnits.push({ id: unit.id, name: unit.name });
      }
    }
  }
  return { unassigned, stale, emptyUnits, disabled };
}

function renderAdminNeedsAttentionHTML(cats){
  const groups = [];
  if(cats.unassigned.length) groups.push({ title: `${cats.unassigned.length} ${cats.unassigned.length === 1 ? 'person has' : 'people have'} no assignment`,
    rows: cats.unassigned.map(u => `<button type="button" class="admin-attention-row" data-attention-people="unassigned">${escapeHTML(u.username)} — no assignment</button>`).join('') });
  if(cats.stale.length) groups.push({ title: `${cats.stale.length} ${cats.stale.length === 1 ? 'person is' : 'people are'} assigned to a place that no longer exists`,
    rows: cats.stale.map(u => `<button type="button" class="admin-attention-row" data-attention-people="stale">${escapeHTML(u.username)} — assigned to a place that no longer exists</button>`).join('') });
  if(cats.emptyUnits.length) groups.push({ title: `${cats.emptyUnits.length} empty unit${cats.emptyUnits.length === 1 ? '' : 's'} (no wards, patients or staff)`,
    rows: cats.emptyUnits.map(u => `<button type="button" class="admin-attention-row" data-attention-unit="${escapeHTML(u.id)}">${escapeHTML(u.name)}</button>`).join('') });
  if(cats.disabled.length) groups.push({ title: `${cats.disabled.length} disabled account${cats.disabled.length === 1 ? '' : 's'}`,
    rows: cats.disabled.map(u => `<button type="button" class="admin-attention-row" data-attention-people="disabled">${escapeHTML(u.username)} — disabled</button>`).join('') });
  if(!groups.length) return '';
  return `<h3>Needs attention</h3>` + groups.map(g => `<div class="admin-attention-group"><h4>${escapeHTML(g.title)}</h4>${g.rows}</div>`).join('');
}
```

- [ ] **Step 5: Wire quick actions and Needs attention into `renderAdminOverviewSection`**

Replace `renderAdminOverviewSection` in `public/admin-console.js`:

```js
function renderAdminOverviewSection(){
  const chooser = document.getElementById('adminOverviewChooser');
  const body = document.getElementById('adminOverviewBody');
  const needsOrg = adminNeedsOrgChoice();
  if(chooser) chooser.hidden = !needsOrg;
  if(body) body.hidden = needsOrg;
  if(needsOrg) return;
  renderAdminStatTilesInto(adminData.tree);
  const attn = document.getElementById('adminNeedsAttention');
  if(attn) attn.innerHTML = renderAdminNeedsAttentionHTML(computeAdminNeedsAttention(adminData.tree, adminData.users));
}

/** Selects the first unit found in the tree and focuses its add-ward input.
    With no units anywhere yet, asks the admin to add a department first. */
function quickActionAddWard(){
  switchAdminSection('structure');
  const firstUnit = (adminData.tree && adminData.tree.hospitals || [])
    .flatMap(h => h.departments || []).flatMap(dep => dep.units || [])[0];
  if(!firstUnit){ showToast('Add a department first, then a unit'); return; }
  selectAdminNode('unit', firstUnit.id);
  document.querySelector(`[data-new-child-name="unit:${firstUnit.id}"]`)?.focus();
}

function quickActionAddPerson(){
  switchAdminSection('people');
  document.getElementById('adminNewUsername')?.focus();
}

function quickActionFixAssignment(){
  adminUI.peopleFilter = 'unassigned';
  switchAdminSection('people');
}

document.getElementById('adminOverviewBody')?.addEventListener('click', (e) => {
  if(e.target.id === 'adminQuickAddPerson') return quickActionAddPerson();
  if(e.target.id === 'adminQuickAddWard') return quickActionAddWard();
  if(e.target.id === 'adminQuickFixAssignment') return quickActionFixAssignment();
  const unitRow = e.target.closest('[data-attention-unit]');
  if(unitRow){ switchAdminSection('structure'); selectAdminNode('unit', unitRow.dataset.attentionUnit); return; }
  const peopleRow = e.target.closest('[data-attention-people]');
  if(peopleRow){ adminUI.peopleFilter = peopleRow.dataset.attentionPeople; switchAdminSection('people'); return; }
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="Overview: computeAdminNeedsAttention|Overview: quick actions"`

Expected: PASS, 8 tests. (`adminUI.peopleFilter` is read directly in the "Fix an assignment" test — this works because that test runs inside the same concatenated eval as the rest of the admin files, per Task 1's harness note; it is still not reachable as `window.adminUI` from `app.js`'s own eval.)

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add public/admin-console.js public/index.html tests/frontend-admin-console.test.js
git commit -m "feat: Overview quick actions and Needs attention

Add person/Add ward/Fix an assignment jump straight into the section
that fixes the problem. Needs attention surfaces unassigned, stale,
empty-unit and disabled people so migration debris and support
questions ('why can't this person see any patients') are visible on
the landing page instead of requiring a hunt through the tree."
```

---

### Task 4: People overhaul, part 1 — filter chips and the responsive list shape

**Files:**
- Modify: `public/admin-people.js`
- Modify: `public/index.html` (CSS only)
- Test: `tests/frontend-admin-people.test.js`

**Interfaces:**
- Consumes: `adminUI.peopleFilter` (Task 1/3), `isSelfUser(u)` (new), `isLastActiveAdmin(u, users)` (new).
- Produces: `matchesAdminPeopleFilter(user, filter, tree)`, `isSelfUser(u)`, `isLastActiveAdmin(u, users)`. Chip buttons `[data-people-filter="all|unassigned|disabled|admins"]`. Desktop table keeps `.admin-users-table`; a parallel `.admin-people-cards` renders the same rows as cards for narrow viewports (CSS decides which one is visible — no JS width branch for this).

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-people.test.js`:

```js
describe('filter chips', () => {
  const USERS = [
    { id: 'me', username: 'currentuser', role: 'admin', active: true, orgId: null, assignmentType: 'org', assignmentId: 'bfv2-org' },
    { id: 'a', username: 'alice', role: 'admin', active: true, orgId: null, assignmentType: null, assignmentId: null },
    { id: 'b', username: 'bob', role: 'member', active: true, orgId: null, assignmentType: null, assignmentId: null },
    { id: 'c', username: 'carol', role: 'member', active: false, orgId: null, assignmentType: 'unit', assignmentId: 'u1' }
  ];

  test('matchesAdminPeopleFilter: all/unassigned/disabled/admins', () => {
    const { window } = loadFrontendEnv();
    const m = window.matchesAdminPeopleFilter;
    assert.equal(m(USERS[1], 'all'), true);
    assert.equal(m(USERS[1], 'unassigned'), true);
    assert.equal(m(USERS[2], 'unassigned'), true);
    assert.equal(m(USERS[0], 'unassigned'), false);
    assert.equal(m(USERS[3], 'disabled'), true);
    assert.equal(m(USERS[0], 'disabled'), false);
    assert.equal(m(USERS[0], 'admins'), true);
    assert.equal(m(USERS[2], 'admins'), false);
  });

  test('clicking a chip filters the visible rows and marks it active', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: USERS };
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.querySelector('[data-people-filter="unassigned"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.querySelector('[data-people-filter="unassigned"]').classList.contains('is-active'), true);
    assert.equal(document.querySelector('[data-user-row="a"]').style.display, '');
    assert.equal(document.querySelector('[data-user-row="me"]').style.display, 'none');
  });

  test('the filter survives a mutation, same as search', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: USERS };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    window.showConfirm = () => Promise.resolve(true);
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.querySelector('[data-people-filter="admins"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    document.querySelector('[data-user-toggle="b"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.querySelector('[data-people-filter="admins"]').classList.contains('is-active'), true);
    assert.equal(document.querySelector('[data-user-row="b"]').style.display, 'none');
  });
});

describe('own-row and last-admin disabled states', () => {
  const SOLE_ADMIN = [
    { id: 'me', username: 'currentuser', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
    { id: 'x', username: 'member1', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null }
  ];

  test('isSelfUser matches the logged-in username', () => {
    const { window } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    assert.equal(window.isSelfUser(SOLE_ADMIN[0]), true);
    assert.equal(window.isSelfUser(SOLE_ADMIN[1]), false);
  });

  test('isLastActiveAdmin is true only for the sole active admin of its org bucket', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.isLastActiveAdmin(SOLE_ADMIN[0], SOLE_ADMIN), true);
    const twoAdmins = [SOLE_ADMIN[0], Object.assign({}, SOLE_ADMIN[1], { role: 'admin' })];
    assert.equal(window.isLastActiveAdmin(twoAdmins[0], twoAdmins), false);
  });

  test('your own row disables the Disable button with a reason', () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: SOLE_ADMIN, orgs: [] });
    assert.match(html, /data-user-toggle="me"[^>]*disabled[^>]*title="[^"]*own account[^"]*"/);
  });

  test('your own row is marked "You"', () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: SOLE_ADMIN, orgs: [] });
    assert.ok(html.includes('You'));
  });

  test('a non-self last active admin cannot be Disabled from the UI', async () => {
    const { window, document } = loadFrontendEnv();
    // Signed-in as a different admin so "last admin" is not the self-row case.
    window.localStorage.setItem('ortho_username', 'otheradmin');
    const users = [
      { id: 'me', username: 'otheradmin', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
      { id: 'only', username: 'soloadmin', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
      { id: 'x', username: 'member1', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null }
    ];
    // Make 'only' the sole active admin of the org bucket for this assertion.
    users[0].role = 'member';
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const btn = document.querySelector('[data-user-toggle="only"]');
    assert.equal(btn.disabled, true);
    assert.match(btn.title, /last active admin/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="filter chips|own-row and last-admin"`

Expected: FAIL — `window.matchesAdminPeopleFilter`, `window.isSelfUser`, `window.isLastActiveAdmin` don't exist; there are no `[data-people-filter]` chips; the own-row disable state and "You" marker aren't rendered; the non-self last-admin Disable button is still clickable.

- [ ] **Step 3: Implement the filter/self/last-admin helpers**

In `public/admin-people.js`, add near the top:

```js
function isSelfUser(u){
  return u.username === localStorage.getItem('ortho_username');
}

/** Mirrors the server's own last-admin check in POST .../role (server.js)
    so the client never offers a click that can only 400. */
function isLastActiveAdmin(user, users){
  if(user.role !== 'admin') return false;
  return !(users || []).some(u => u.id !== user.id && u.role === 'admin' && u.active && (u.orgId || null) === (user.orgId || null));
}

function matchesAdminPeopleFilter(u, filter){
  if(filter === 'unassigned') return !u.assignmentType || !u.assignmentId;
  if(filter === 'disabled') return !u.active;
  if(filter === 'admins') return u.role === 'admin';
  if(filter === 'stale') return !!(u.assignmentType && u.assignmentId && !assignLabelFor(buildAssignNodeGroups(adminData.tree, []), u.assignmentType, u.assignmentId));
  if(filter && filter.startsWith('node:')){
    const [, type, id] = filter.split(':');
    return u.assignmentType === type && u.assignmentId === id;
  }
  return true; // 'all'
}
```

- [ ] **Step 4: Add chips, "You", and the disabled own-row/last-admin state to the row markup**

Replace `renderAdminPeopleRowHTML` in `public/admin-people.js`:

```js
function renderAdminPeopleRowHTML(u){
  const narrow = adminIsNarrow();
  const groups = buildAssignNodeGroups(adminData.tree, adminData.orgs);
  const selType = u.assignmentType || null, selId = u.assignmentId || null;
  const prev = selType && selId ? `${selType}:${selId}` : '';
  const self = isSelfUser(u);
  const lastAdmin = isLastActiveAdmin(u, adminData.users);
  const disableTitle = self ? 'You cannot disable your own account' : (u.active && lastAdmin ? 'This is the last active admin — promote someone else first' : '');
  const disableAttrs = (self || (u.active && lastAdmin)) ? ` disabled title="${escapeHTML(disableTitle)}"` : '';
  const actions = narrow ? '' : `
        <button class="btn" data-user-toggle="${escapeHTML(u.id)}"${disableAttrs}>${u.active ? 'Disable' : 'Enable'}</button>
        <button class="btn" data-user-reset="${escapeHTML(u.id)}">Reset password</button>`;
  const checkCell = narrow ? '<td></td>' : `<td><input type="checkbox" data-user-check="${escapeHTML(u.id)}"${adminUI.peopleChecked.has(u.id) ? ' checked' : ''}></td>`;
  const label = assignLabelFor(groups, selType, selId);
  const assignText = label || (selType && selId ? 'Assigned to a place that no longer exists' : '—');
  const assignCell = narrow
    ? `<td>${escapeHTML(assignText)}</td>`
    : `<td><select data-assign-user="${escapeHTML(u.id)}" data-prev="${escapeHTML(prev)}">${renderAssignSelectOptionsHTML(groups, selType, selId)}</select></td>`;
  const nameCell = self ? `${escapeHTML(u.username)} <span class="spec-badge">You</span>` : escapeHTML(u.username);
  return `${checkCell}
        <td>${nameCell}</td>
        <td>${u.role === 'admin' ? '<span class="spec-badge">admin</span>' : 'member'}</td>
        ${assignCell}
        <td>${u.active ? 'active' : 'disabled'}${actions}
        </td>`;
}
```

Add the chip row and filter application. Replace the return statement of `renderAdminUsersPanelHTML`:

```js
  const chips = ['all', 'unassigned', 'disabled', 'admins'].map(f =>
    `<button type="button" class="admin-people-chip${f === adminUI.peopleFilter ? ' is-active' : ''}" data-people-filter="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`
  ).join('');
  return `
    <div class="admin-detail-head"><h3>People</h3></div>
    <div class="admin-inline-form">
      <label for="adminUserSearch" class="sr-only">Search people</label>
      <input id="adminUserSearch" placeholder="Search people…">
    </div>
    <div class="admin-people-chips">${chips}</div>
    ${narrowNote}
    ${createUserForm}
    <div id="adminBulkBar" class="admin-bulk-bar" hidden></div>
    <table class="admin-users-table">
      <thead><tr><th></th><th>Person</th><th>Role</th><th>Can see patients in</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
```

Add `applyAdminPeopleFilter` and fold it into `applyAdminPeopleSearch`'s caller. Replace `applyAdminPeopleSearch`:

```js
function applyAdminPeopleFilters(){
  const q = adminUI.peopleSearch.trim().toLowerCase();
  document.querySelectorAll('[data-user-row]').forEach(tr => {
    const u = (adminData.users || []).find(x => x.id === tr.dataset.userRow);
    const matchesSearch = !q || tr.dataset.username.includes(q);
    const matchesFilter = !u || matchesAdminPeopleFilter(u, adminUI.peopleFilter);
    tr.style.display = matchesSearch && matchesFilter ? '' : 'none';
  });
}
```

Replace the two call sites of `applyAdminPeopleSearch()` (inside `renderAdminPeopleSection`, and inside the `input` listener) with `applyAdminPeopleFilters()`, and delete the old `applyAdminPeopleSearch` function.

Add the chip click handler inside the existing `document.getElementById('adminPeopleSection')?.addEventListener('click', ...)` block, as its first branch:

```js
  const chip = e.target.closest('[data-people-filter]');
  if(chip){
    adminUI.peopleFilter = chip.dataset.peopleFilter;
    document.querySelectorAll('[data-people-filter]').forEach(b => b.classList.toggle('is-active', b === chip));
    applyAdminPeopleFilters();
    return;
  }
```

- [ ] **Step 5: Add chip and card CSS**

In `public/index.html`, add after `.admin-users-table th,.admin-users-table td{...}`:

```css
  .admin-people-chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;}
  .admin-people-chip{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 14px;font:inherit;font-size:13px;color:var(--ink-soft);cursor:pointer;min-height:36px;}
  .admin-people-chip.is-active{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600;}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="filter chips|own-row and last-admin"`

Expected: PASS, 7 tests.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add public/admin-people.js public/index.html tests/frontend-admin-people.test.js
git commit -m "feat: People filter chips, own-row and last-admin guards

All/Unassigned/Disabled/Admins chips answer 'why can't this person see
any patients' without a manual scan. Your own row is marked You and
its Disable control is disabled with a reason instead of allowing a
click that 400s; the same guard covers an org's last active admin."
```

---

### Task 5: People overhaul, part 2 — one-step create, show-once password modal, role change

**Files:**
- Modify: `public/admin-people.js`
- Modify: `public/index.html` (secret modal markup + CSS)
- Test: `tests/frontend-admin-people.test.js`

**Interfaces:**
- Consumes: `POST /api/admin/users/:id/role` (Plan 1, body `{ role }, → { ok, role }`), `showConfirm(title, message, opts)`.
- Produces: `showAdminSecret(title, secret)` → Promise\<void\> (opens `#adminSecretModal`, resolves when closed). Role `<select data-role-user="id">` posting to `/role`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-people.test.js`:

```js
describe('show-once secret modal', () => {
  test('showAdminSecret shows the secret and a copy button, and resolves on Done', async () => {
    const { window, document } = loadFrontendEnv();
    window.navigator.clipboard = { writeText: async () => {} };
    const p = window.showAdminSecret('User created', 'bone-plate-1234');
    assert.equal(document.getElementById('adminSecretModal').classList.contains('active'), true);
    assert.equal(document.getElementById('adminSecretValue').value, 'bone-plate-1234');
    document.getElementById('adminSecretDoneBtn').click();
    await p;
    assert.equal(document.getElementById('adminSecretModal').classList.contains('active'), false);
  });

  test('the copy button copies the secret to the clipboard', async () => {
    const { window, document } = loadFrontendEnv();
    const copied = [];
    window.navigator.clipboard = { writeText: async (t) => copied.push(t) };
    window.showAdminSecret('User created', 'bone-plate-1234');
    document.getElementById('adminSecretCopyBtn').click();
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(copied, ['bone-plate-1234']);
  });
});

describe('create person in one step', () => {
  test('create form has username, role and placement together, and no window.alert is used', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users' && (!opts || opts.method !== 'POST')) return { users: [] };
      return { id: 'new1', username: 'newperson', temporaryPassword: 'bone-plate-9999' };
    };
    let alerted = false;
    window.alert = () => { alerted = true; };
    await window.loadAdminView();
    window.switchAdminSection('people');
    assert.ok(document.getElementById('adminNewUserPlacement'), 'expected a placement picker in the create form');

    document.getElementById('adminNewUsername').value = 'newperson';
    document.getElementById('adminCreateUser').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    assert.equal(alerted, false);
    assert.equal(document.getElementById('adminSecretModal').classList.contains('active'), true);
    assert.equal(document.getElementById('adminSecretValue').value, 'bone-plate-9999');
  });

  test('a chosen placement creates the user then assigns them (two calls)', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users' && (!opts || opts.method !== 'POST')) return { users: [] };
      if(path === '/api/admin/users' && opts && opts.method === 'POST') return { id: 'new1', temporaryPassword: 'x' };
      return { ok: true };
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.getElementById('adminNewUsername').value = 'placed1';
    document.getElementById('adminNewUserPlacement').value = 'unit:u1';
    document.getElementById('adminCreateUser').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const createCall = calls.find(c => c.path === '/api/admin/users' && c.opts && c.opts.method === 'POST');
    assert.ok(createCall);
    // Create body carries only what POST /api/admin/users accepts — placement
    // is applied by a follow-up /assign (that route is the only write path for
    // assignmentType/assignmentId). Extra unrecognized keys must not be used
    // as a substitute for that second call.
    const createBody = JSON.parse(createCall.opts.body);
    assert.equal(createBody.username, 'placed1');
    assert.equal(createBody.role, 'member');
    assert.equal(createBody.nodeType, undefined);
    assert.equal(createBody.nodeId, undefined);
    const assignCall = calls.find(c => c.path === '/api/admin/users/new1/assign');
    assert.ok(assignCall, 'expected a follow-up POST to /assign');
    assert.deepEqual(JSON.parse(assignCall.opts.body), { nodeType: 'unit', nodeId: 'u1' });
  });
});

describe('role change', () => {
  const USERS = [
    { id: 'me', username: 'currentuser', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
    { id: 'x', username: 'member1', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null }
  ];

  test('the role select posts to /role after a confirmation naming the person and the new role', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    const calls = [];
    let confirmMessage = '';
    window.showConfirm = (title, message) => { confirmMessage = message; return Promise.resolve(true); };
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: USERS };
      return { ok: true, role: 'admin' };
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const sel = document.querySelector('[data-role-user="x"]');
    sel.value = 'admin';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.match(confirmMessage, /member1/);
    assert.match(confirmMessage, /admin/);
    const call = calls.find(c => c.path === '/api/admin/users/x/role');
    assert.ok(call);
    assert.deepEqual(JSON.parse(call.opts.body), { role: 'admin' });
  });

  test('declining the confirmation reverts the select and posts nothing', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    const calls = [];
    window.showConfirm = () => Promise.resolve(false);
    window.api = async (path, opts) => {
      calls.push({ path, opts });
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: USERS };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const sel = document.querySelector('[data-role-user="x"]');
    sel.value = 'admin';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(sel.value, 'member');
    assert.equal(calls.some(c => c.path === '/api/admin/users/x/role'), false);
  });

  test('the role select is disabled on your own row and for the last active admin of the org', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_username', 'currentuser');
    const users = [
      { id: 'me', username: 'currentuser', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null },
      { id: 'only', username: 'soloadmin', role: 'admin', active: true, orgId: 'bfv2-org', assignmentType: null, assignmentId: null }
    ];
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users };
    await window.loadAdminView();
    window.switchAdminSection('people');
    // Self-row is disabled even though this actor is only a member in the list
    // (the signed-in identity is still currentuser).
    assert.equal(document.querySelector('[data-role-user="me"]').disabled, true);
    assert.ok(document.querySelector('[data-role-user="me"]').title.length > 0);
    // The org's only active admin cannot be demoted from the UI.
    assert.equal(document.querySelector('[data-role-user="only"]').disabled, true);
    assert.match(document.querySelector('[data-role-user="only"]').title, /last active admin/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="show-once secret modal|create person in one step|role change"`

Expected: FAIL — `window.showAdminSecret` doesn't exist; there's no `#adminSecretModal`, no `#adminNewUserPlacement`, no `[data-role-user]`; create still calls `window.alert`.

- [ ] **Step 3: Add the secret modal markup and CSS**

In `public/index.html`, add immediately before the `<!-- APP DIALOG (confirm / prompt) -->` comment (before line 2156):

```html
<!-- ADMIN SECRET (temporary password, shown once) -->
<div class="modal-overlay" id="adminSecretModal">
  <div class="modal" style="max-width:420px;">
    <div class="modal-head">
      <h2 id="adminSecretTitle">Temporary password</h2>
    </div>
    <div class="modal-body">
      <p style="margin:0 0 10px;">Shown once — write it down or copy it now.</p>
      <input id="adminSecretValue" readonly style="font-family:monospace;font-size:16px;width:100%;">
    </div>
    <div class="modal-foot">
      <button type="button" class="btn primary" id="adminSecretCopyBtn">Copy</button>
      <button type="button" class="btn" id="adminSecretDoneBtn">Done</button>
    </div>
  </div>
</div>
```

No new CSS needed — `.modal-overlay`/`.modal`/`.modal-head`/`.modal-body`/`.modal-foot`/`.active` already exist and are used by `#aiResultModal`/`#appDialogModal`.

- [ ] **Step 4: Implement `showAdminSecret`**

In `public/admin-people.js`, add:

```js
let adminSecretResolver = null;

/** A show-once secret (temporary password) with a copy button — replaces
    window.alert(...), which the design spec forbids for this. Resolves
    when the admin dismisses it. */
function showAdminSecret(title, secret){
  return new Promise(resolve => {
    adminSecretResolver = resolve;
    document.getElementById('adminSecretTitle').textContent = title;
    document.getElementById('adminSecretValue').value = secret;
    document.getElementById('adminSecretModal').classList.add('active');
  });
}

function closeAdminSecret(){
  document.getElementById('adminSecretModal').classList.remove('active');
  const resolve = adminSecretResolver;
  adminSecretResolver = null;
  if(resolve) resolve();
}

document.getElementById('adminSecretDoneBtn')?.addEventListener('click', closeAdminSecret);
document.getElementById('adminSecretCopyBtn')?.addEventListener('click', async () => {
  const value = document.getElementById('adminSecretValue').value;
  try{
    await navigator.clipboard.writeText(value);
    showToast('Copied to clipboard');
  }catch{
    showToast('Could not copy — check clipboard permission');
  }
});
```

- [ ] **Step 5: One-step create with placement, using the secret modal**

Replace the `createUserForm` template literal inside `renderAdminUsersPanelHTML`:

```js
  const createUserForm = narrow ? '' : `
    <div class="admin-inline-form">
      <label for="adminNewUsername" class="sr-only">New username</label>
      <input id="adminNewUsername" placeholder="New username">
      <label class="scribe-check"><input type="checkbox" id="adminNewUserAdmin"> Admin</label>
      <label for="adminNewUserPlacement" class="sr-only">Can see patients in</label>
      <select id="adminNewUserPlacement">${renderAssignSelectOptionsHTML(groups, null, null)}</select>
      <button class="btn" id="adminCreateUser">Create person</button>
    </div>`;
```

Replace the `if(e.target.id === 'adminCreateUser'){ ... }` block. `POST /api/admin/users` accepts `{ username, role, orgId? }` only — placement is a separate `POST .../assign`. Do **not** put `nodeType`/`nodeId` on the create body:

```js
  if(e.target.id === 'adminCreateUser'){
    e.stopPropagation();
    const nameEl = document.getElementById('adminNewUsername');
    const username = (nameEl.value || '').trim();
    if(!username){ showToast('Enter a username'); return; }
    const role = document.getElementById('adminNewUserAdmin').checked ? 'admin' : 'member';
    const orgId = adminUI.viewedOrgId || (adminData.tree && adminData.tree.org && adminData.tree.org.id) || null;
    const placement = document.getElementById('adminNewUserPlacement').value;
    const body = { username, role };
    if(orgId) body.orgId = orgId;
    let nodeType = null, nodeId = null;
    if(placement){
      const i = placement.indexOf(':');
      nodeType = placement.slice(0, i);
      nodeId = placement.slice(i + 1);
    }
    api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) })
      .then(async res => {
        if(nodeType) await api(`/api/admin/users/${res.id}/assign`, { method: 'POST', body: JSON.stringify({ nodeType, nodeId }) });
        nameEl.value = '';
        document.getElementById('adminNewUserPlacement').value = '';
        await loadAdminView();
        await showAdminSecret('Person created', res.temporaryPassword);
      })
      .catch(err => showToast(err.message));
    return;
  }
```

Also replace the reset-password handler (still using `window.alert`) to use the same modal:

```js
  const resetBtn = e.target.closest('[data-user-reset]');
  if(resetBtn){
    e.stopPropagation();
    const id = resetBtn.dataset.userReset;
    api(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST' })
      .then(res => showAdminSecret('Password reset', res.temporaryPassword))
      .catch(err => showToast(err.message));
    return;
  }
```

- [ ] **Step 6: Add the role `<select>` and its handler**

In `renderAdminPeopleRowHTML`, replace the `actions` line (the one building the Disable/Reset buttons) to include a role select, and replace the whole function body's return with a role-aware version:

```js
function renderAdminPeopleRowHTML(u){
  const narrow = adminIsNarrow();
  const groups = buildAssignNodeGroups(adminData.tree, adminData.orgs);
  const selType = u.assignmentType || null, selId = u.assignmentId || null;
  const prev = selType && selId ? `${selType}:${selId}` : '';
  const self = isSelfUser(u);
  const lastAdmin = isLastActiveAdmin(u, adminData.users);
  const disableTitle = self ? 'You cannot disable your own account' : (u.active && lastAdmin ? 'This is the last active admin — promote someone else first' : '');
  const disableAttrs = (self || (u.active && lastAdmin)) ? ` disabled title="${escapeHTML(disableTitle)}"` : '';
  const roleTitle = self ? 'You cannot change your own role' : (lastAdmin ? 'This is the last active admin of the organization' : '');
  const roleDisabled = self || lastAdmin;
  const actions = narrow ? '' : `
        <button class="btn" data-user-toggle="${escapeHTML(u.id)}"${disableAttrs}>${u.active ? 'Disable' : 'Enable'}</button>
        <button class="btn" data-user-reset="${escapeHTML(u.id)}">Reset password</button>`;
  const checkCell = narrow ? '<td></td>' : `<td><input type="checkbox" data-user-check="${escapeHTML(u.id)}"${adminUI.peopleChecked.has(u.id) ? ' checked' : ''}></td>`;
  const label = assignLabelFor(groups, selType, selId);
  const assignText = label || (selType && selId ? 'Assigned to a place that no longer exists' : '—');
  const assignCell = narrow
    ? `<td>${escapeHTML(assignText)}</td>`
    : `<td><select data-assign-user="${escapeHTML(u.id)}" data-prev="${escapeHTML(prev)}">${renderAssignSelectOptionsHTML(groups, selType, selId)}</select></td>`;
  const nameCell = self ? `${escapeHTML(u.username)} <span class="spec-badge">You</span>` : escapeHTML(u.username);
  const roleCell = narrow
    ? `<td>${u.role === 'admin' ? '<span class="spec-badge">admin</span>' : 'member'}</td>`
    : `<td><select data-role-user="${escapeHTML(u.id)}"${roleDisabled ? ` disabled title="${escapeHTML(roleTitle)}"` : ''}>
        <option value="member"${u.role === 'member' ? ' selected' : ''}>Member</option>
        <option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin</option>
      </select></td>`;
  return `${checkCell}
        <td>${nameCell}</td>
        ${roleCell}
        ${assignCell}
        <td>${u.active ? 'active' : 'disabled'}${actions}
        </td>`;
}
```

Add the role-change handler. In `public/admin-people.js`, add to the `change` listener (before the `[data-assign-user]` branch):

```js
document.getElementById('adminPeopleSection')?.addEventListener('change', async (e) => {
  if(e.target.matches('[data-user-check]')){
    const id = e.target.dataset.userCheck;
    if(e.target.checked) adminUI.peopleChecked.add(id); else adminUI.peopleChecked.delete(id);
    refreshAdminBulkBar();
    return;
  }
  const roleSel = e.target.closest('[data-role-user]');
  if(roleSel){
    const id = roleSel.dataset.roleUser;
    const user = (adminData.users || []).find(u => u.id === id);
    const newRole = roleSel.value;
    const prevRole = user ? user.role : (newRole === 'admin' ? 'member' : 'admin');
    const ok = await showConfirm('Change role', `Make ${user ? user.username : 'this person'} ${newRole === 'admin' ? 'an admin' : 'a member'}?`, { confirmLabel: 'Change role' });
    if(!ok){ roleSel.value = prevRole; return; }
    try{
      await api(`/api/admin/users/${encodeURIComponent(id)}/role`, { method: 'POST', body: JSON.stringify({ role: newRole }) });
      showToast('Role updated');
      await loadAdminView();
    }catch(err){
      roleSel.value = prevRole;
      showToast(err.message);
    }
    return;
  }
  const sel = e.target.closest('[data-assign-user]');
  if(!sel) return;
  const raw = sel.value;
  const sepIdx = raw.indexOf(':');
  const nodeType = sepIdx === -1 ? null : raw.slice(0, sepIdx);
  const nodeId = sepIdx === -1 ? null : raw.slice(sepIdx + 1);
  try{
    await api(`/api/admin/users/${sel.dataset.assignUser}/assign`, { method: 'POST', body: JSON.stringify({ nodeType, nodeId }) });
    sel.dataset.prev = raw;
    showToast('Assignment updated');
  }catch(err){
    sel.value = sel.dataset.prev || '';
    showToast(err.message);
  }
});
```

(Delete the now-duplicated earlier `change` listener registration from Task 2/4 — there must be exactly one `addEventListener('change', ...)` call on `#adminPeopleSection`; fold the `[data-user-check]` branch shown above into this single listener and remove the old one.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="show-once secret modal|create person in one step|role change"`

Expected: PASS, 8 tests.

- [ ] **Step 8: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 9: Commit**

```bash
git add public/admin-people.js public/index.html tests/frontend-admin-people.test.js
git commit -m "feat: one-step create person, show-once password modal, role change

Create person now captures username, role and placement together and
shows the temporary password in a dismissable modal with a copy
button instead of window.alert. The role column becomes a Member/
Admin select posting to POST /api/admin/users/:id/role after a named
confirmation, disabled on your own row and an org's last admin."
```

---

### Task 6: People overhaul, part 3 — placement full-path picker, sticky bulk bar, mobile cards

**Files:**
- Modify: `public/admin-people.js`
- Modify: `public/index.html` (CSS: sticky bulk bar, mobile card layout)
- Test: `tests/frontend-admin-people.test.js`

**Interfaces:**
- Consumes: `buildAssignNodeGroups` (Task 1, full-path labels already landed), `POST /api/admin/users/:id/assign`.
- Produces: per-row placement change now shows an inline "Saved" / error state next to the `<select>` instead of only a toast (`renderAdminPeopleRow` already repaints the row after Task 2's helper); `.admin-people-cards` markup for narrow width (CSS-only visibility, both markups always render — Task 11 removes the last JS width branches, this task only adds the parallel markup and CSS).

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-people.test.js`:

```js
describe('placement change: inline confirmation and revert', () => {
  test('a successful change shows an inline "Saved" note next to that row only', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: CC_USERS };
      if(opts && opts.method === 'POST') return { ok: true };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const sel = document.querySelector('[data-assign-user="usr2"]');
    sel.value = 'unit:u1';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(document.querySelector('[data-user-row="usr2"]').textContent.includes('Saved'));
    assert.ok(!document.querySelector('[data-user-row="usr1"]').textContent.includes('Saved'));
  });

  test('a failed change reverts the select and shows the reason inline, not just a toast', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: CC_USERS };
      if(opts && opts.method === 'POST'){ const e = new window.Error('Node is not in this organization'); throw e; }
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    const sel = document.querySelector('[data-assign-user="usr2"]');
    const before = sel.value;
    sel.value = 'unit:u1';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(sel.value, before);
    assert.ok(document.querySelector('[data-user-row="usr2"]').textContent.includes('Node is not in this organization'));
  });
});

describe('sticky bulk bar reports what happened', () => {
  test('a successful bulk assign reports the count and target, and stays visible with the same selection', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: CC_USERS };
      if(opts && opts.method === 'POST') return { assigned: 1 };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('people');
    document.querySelector('[data-user-check="usr2"]').checked = true;
    document.querySelector('[data-user-check="usr2"]').dispatchEvent(new window.Event('change', { bubbles: true }));
    document.getElementById('adminBulkNode').value = 'unit:u1';
    document.getElementById('adminBulkApply').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(document.querySelector('[data-user-check="usr2"]').checked, 'selection stays visible');
    const bar = document.getElementById('adminBulkBar');
    assert.match(bar.textContent, /Assigned 1 person to Ortho › IV/);
  });
});

describe('mobile card markup for the People list', () => {
  test('every row also renders as a card, hidden by CSS on wide viewports', () => {
    const { window, document } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [] });
    assert.ok(html.includes('admin-people-cards'));
    assert.ok(html.includes('data-user-card="usr2"'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="placement change: inline confirmation|sticky bulk bar reports|mobile card markup"`

Expected: FAIL — no inline "Saved"/error text exists yet (only a toast); the bulk-assign success message doesn't name the count/target; there's no `.admin-people-cards`/`[data-user-card]` markup.

- [ ] **Step 3: Inline placement confirmation, per row**

Replace the `[data-assign-user]` branch of the `change` listener in `public/admin-people.js`:

```js
  const sel = e.target.closest('[data-assign-user]');
  if(sel){
    const raw = sel.value;
    const sepIdx = raw.indexOf(':');
    const nodeType = sepIdx === -1 ? null : raw.slice(0, sepIdx);
    const nodeId = sepIdx === -1 ? null : raw.slice(sepIdx + 1);
    const userId = sel.dataset.assignUser;
    try{
      await api(`/api/admin/users/${userId}/assign`, { method: 'POST', body: JSON.stringify({ nodeType, nodeId }) });
      sel.dataset.prev = raw;
      const u = (adminData.users || []).find(x => x.id === userId);
      if(u){ u.assignmentType = nodeType; u.assignmentId = nodeId; }
      renderAdminPeopleRow(userId);
      const row = document.querySelector(`[data-user-row="${CSS.escape(userId)}"]`);
      const note = document.createElement('span');
      note.className = 'admin-inline-note';
      note.textContent = 'Saved';
      row?.lastElementChild?.appendChild(note);
      setTimeout(() => note.remove(), 2500);
    }catch(err){
      sel.value = sel.dataset.prev || '';
      const row = document.querySelector(`[data-user-row="${CSS.escape(userId)}"]`);
      const note = document.createElement('span');
      note.className = 'admin-inline-note admin-inline-note-error';
      note.textContent = err.message;
      row?.lastElementChild?.appendChild(note);
    }
    return;
  }
```

Add CSS:

```css
  .admin-inline-note{margin-left:8px;font-size:12px;color:var(--status-fordischarge);}
  .admin-inline-note-error{color:#b23c3c;}
```

- [ ] **Step 4: Report what the bulk assign did**

Replace the `if(e.target.id === 'adminBulkApply'){ ... }` block:

```js
  if(e.target.id === 'adminBulkApply'){
    e.stopPropagation();
    const ids = selectedAdminUserIds();
    const raw = document.getElementById('adminBulkNode').value;
    const i = raw.indexOf(':');
    const nodeType = i === -1 ? null : raw.slice(0, i);
    const nodeId = i === -1 ? null : raw.slice(i + 1);
    const groups = buildAssignNodeGroups(adminData.tree, adminData.orgs);
    const targetLabel = nodeType ? (assignLabelFor(groups, nodeType, nodeId) || 'that place') : 'no placement';
    api('/api/admin/users/assign-bulk', { method: 'POST', body: JSON.stringify({ userIds: ids, nodeType, nodeId }) })
      .then(async res => {
        showToast(`Assigned ${res.assigned} ${res.assigned === 1 ? 'person' : 'people'} to ${targetLabel}`);
        await loadAdminView();
        applyAdminPeopleFilters();
      })
      .catch(err => showToast(err.message));
    return;
  }
```

- [ ] **Step 5: Make the bulk bar sticky and add mobile card markup**

Add CSS:

```css
  .admin-bulk-bar{position:sticky;top:0;z-index:5;}
  .admin-people-cards{display:none;}
  @media (max-width: 699px){
    .admin-users-table{display:none;}
    .admin-people-cards{display:block;}
  }
  .admin-people-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:8px;}
  .admin-people-card-head{display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;min-height:44px;}
  .admin-people-card-body{margin-top:8px;display:none;}
  .admin-people-card.is-expanded .admin-people-card-body{display:block;}
```

In `public/admin-people.js`, add a card-markup builder and call it from `renderAdminUsersPanelHTML`:

```js
function renderAdminPeopleCardHTML(u){
  const label = assignLabelFor(buildAssignNodeGroups(adminData.tree, adminData.orgs), u.assignmentType, u.assignmentId);
  const assignText = label || (u.assignmentType && u.assignmentId ? 'Assigned to a place that no longer exists' : 'Not assigned');
  return `<div class="admin-people-card" data-user-card="${escapeHTML(u.id)}">
    <div class="admin-people-card-head" data-card-toggle="${escapeHTML(u.id)}">
      <strong>${escapeHTML(u.username)}${isSelfUser(u) ? ' <span class="spec-badge">You</span>' : ''}</strong>
      <span>${u.active ? 'active' : 'disabled'}</span>
    </div>
    <div class="admin-people-card-body">
      <div class="small-muted">${escapeHTML(assignText)}</div>
      <div class="admin-inline-form">
        <button class="btn" data-user-toggle="${escapeHTML(u.id)}">${u.active ? 'Disable' : 'Enable'}</button>
        <button class="btn" data-user-reset="${escapeHTML(u.id)}">Reset password</button>
      </div>
    </div>
  </div>`;
}
```

In `renderAdminUsersPanelHTML`, after the `<table class="admin-users-table">...</table>` block, append:

```js
  const cards = (state.users || []).map(renderAdminPeopleCardHTML).join('');
```

and add `<div class="admin-people-cards">${cards}</div>` to the returned template, immediately after the closing `</table>`.

Add the card expand/collapse toggle to the click handler:

```js
  const cardToggle = e.target.closest('[data-card-toggle]');
  if(cardToggle){
    cardToggle.closest('.admin-people-card')?.classList.toggle('is-expanded');
    return;
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="placement change: inline confirmation|sticky bulk bar reports|mobile card markup"`

Expected: PASS, 4 tests.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add public/admin-people.js public/index.html tests/frontend-admin-people.test.js
git commit -m "feat: inline placement confirmation, bulk-assign summary, People cards

A placement change confirms or reverts inline on its own row instead
of only a toast. Bulk assign reports what happened ('Assigned 6 people
to Ortho › Unit 2') and keeps the selection visible. Every person also
renders as an expandable card, shown by CSS under ~700px (Task 11
removes the remaining JS width branches so both layouts are always
live, not just visually switched)."
```

---

### Task 7: Structure overhaul, part 1 — collapsible, searchable, persisted tree

**Files:**
- Modify: `public/admin-structure.js`
- Modify: `public/index.html` (CSS: chevrons, filter box)
- Test: `tests/frontend-admin-structure.test.js`

**Interfaces:**
- Consumes: `adminUI.structureExpanded` (`Set<string>`, Task 1), `adminUI.structureFilter` (Task 1).
- Produces: `isAdminNodeExpanded(key)`, `toggleAdminNodeExpanded(key)`, `defaultExpandStructure(tree)` (expands every hospital+department key), `nodeMatchesStructureFilter(node, query)`, `ancestorsOf(tree, type, id)` (returns the chain of "type:id" keys from the org down to a node, for auto-expand-to-match). Tree rows gain `aria-expanded` and a chevron button `[data-toggle-expand="type:id"]`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-structure.test.js`:

```js
describe('tree expansion', () => {
  test('isAdminNodeExpanded/toggleAdminNodeExpanded track a Set of "type:id" keys', () => {
    const { window } = loadFrontendEnv();
    window.adminUI.structureExpanded = new Set();
    assert.equal(window.isAdminNodeExpanded('department:d1'), false);
    window.toggleAdminNodeExpanded('department:d1');
    assert.equal(window.isAdminNodeExpanded('department:d1'), true);
    window.toggleAdminNodeExpanded('department:d1');
    assert.equal(window.isAdminNodeExpanded('department:d1'), false);
  });

  test('defaultExpandStructure expands every hospital and department, so one hospital is fully visible', () => {
    const { window } = loadFrontendEnv();
    const expanded = window.defaultExpandStructure(TREE);
    assert.equal(expanded.has('hospital:h1'), true);
    assert.equal(expanded.has('department:d1'), true);
    assert.equal(expanded.has('unit:u1'), false);
  });

  test('a collapsed hospital hides its departments; expanding it shows them; aria-expanded reflects state', () => {
    const { window } = loadFrontendEnv();
    const collapsedHtml = window.renderAdminTreeHTML(TREE, null, new Set());
    assert.ok(!collapsedHtml.includes('data-node="department:d1"'));
    assert.match(collapsedHtml, /data-toggle-expand="hospital:h1"[^>]*aria-expanded="false"/);

    const expandedHtml = window.renderAdminTreeHTML(TREE, null, new Set(['hospital:h1']));
    assert.ok(expandedHtml.includes('data-node="department:d1"'));
    assert.match(expandedHtml, /data-toggle-expand="hospital:h1"[^>]*aria-expanded="true"/);
  });

  test('clicking the chevron toggles expansion without selecting the row', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    document.querySelector('[data-toggle-expand="hospital:h1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.ok(!document.querySelector('[data-node="department:d1"]'));
    assert.equal(document.getElementById('adminDetailPane').innerHTML, ''); // unchanged, nothing selected
  });

  test('expansion state survives a reload', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    document.querySelector('[data-toggle-expand="hospital:h1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.ok(!document.querySelector('[data-node="department:d1"]'));
    await window.loadAdminView();
    assert.ok(!document.querySelector('[data-node="department:d1"]'), 'stayed collapsed across the reload');
  });

  test('counts are labelled, not bare numbers', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, null, new Set(['hospital:h1', 'department:d1']));
    assert.match(html, /IV[\s\S]{0,40}4 patients/);
  });
});

describe('tree filter', () => {
  test('nodeMatchesStructureFilter matches a case-insensitive substring of the name', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.nodeMatchesStructureFilter({ name: 'General' }, 'gen'), true);
    assert.equal(window.nodeMatchesStructureFilter({ name: 'General' }, 'xyz'), false);
    assert.equal(window.nodeMatchesStructureFilter({ name: 'General' }, ''), true);
  });

  test('ancestorsOf returns the chain of keys from the org down to a ward', () => {
    const { window } = loadFrontendEnv();
    assert.deepEqual(window.ancestorsOf(TREE, 'ward', 'w1'), ['org:bfv2-org', 'hospital:h1', 'department:d1', 'unit:u1']);
  });

  test('typing in the filter box narrows the tree to matches and auto-expands to reveal them', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    const filter = document.getElementById('adminStructureFilter');
    filter.value = 'general';
    filter.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.ok(document.querySelector('[data-node="unit:u2"]')); // "General" — matches, and its ancestors auto-expand
    assert.ok(!document.querySelector('[data-node="unit:u1"]')); // "IV" — does not match, hidden
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="tree expansion|tree filter"`

Expected: FAIL — `window.isAdminNodeExpanded`, `toggleAdminNodeExpanded`, `defaultExpandStructure`, `nodeMatchesStructureFilter`, `ancestorsOf` don't exist; `renderAdminTreeHTML` doesn't accept a third `expanded` argument and always renders everything flat with bare counts.

- [ ] **Step 3: Implement expansion state and the collapsible tree**

In `public/admin-structure.js`, add near the top:

```js
function isAdminNodeExpanded(key){
  return adminUI.structureExpanded.has(key);
}

function toggleAdminNodeExpanded(key){
  if(adminUI.structureExpanded.has(key)) adminUI.structureExpanded.delete(key);
  else adminUI.structureExpanded.add(key);
}

/** Opens to department level: every hospital and department key, so today's
    single hospital is fully visible without a click. */
function defaultExpandStructure(tree){
  const keys = new Set();
  for(const h of (tree && tree.hospitals) || []){
    keys.add(`hospital:${h.id}`);
    for(const dep of h.departments || []) keys.add(`department:${dep.id}`);
  }
  return keys;
}

function nodeMatchesStructureFilter(node, query){
  const q = (query || '').trim().toLowerCase();
  if(!q) return true;
  return (node.name || '').toLowerCase().includes(q);
}

/** The chain of "type:id" keys from the org down to (but not including) the
    given node — used to auto-expand every ancestor of a filter match. */
function ancestorsOf(tree, type, id){
  const chain = [];
  if(tree && tree.org) chain.push(`org:${tree.org.id}`);
  for(const h of (tree && tree.hospitals) || []){
    if(type === 'hospital' && h.id === id) return chain;
    const withHospital = [...chain, `hospital:${h.id}`];
    for(const dep of h.departments || []){
      if(type === 'department' && dep.id === id) return withHospital;
      const withDep = [...withHospital, `department:${dep.id}`];
      for(const u of dep.units || []){
        if(type === 'unit' && u.id === id) return withDep;
        const withUnit = [...withDep, `unit:${u.id}`];
        for(const w of u.wards || []){
          if(type === 'ward' && w.id === id) return withUnit;
        }
      }
    }
  }
  return [];
}
```

Replace `ccRowHTML` and `renderAdminTreeHTML`:

```js
function ccRowHTML(type, id, label, count, unitLabel, depth, selection, expandable, expanded){
  const sel = selection && selection.type === type && selection.id === id ? ' is-selected' : '';
  const countLabel = count === null || count === undefined ? '' : `${count} ${unitLabel}${count === 1 ? '' : 's'}`;
  const c = countLabel ? `<span class="cc-count">${escapeHTML(countLabel)}</span>` : '';
  const key = `${type}:${id}`;
  const chevron = expandable
    ? `<button type="button" class="admin-cc-chevron" data-toggle-expand="${escapeHTML(key)}" aria-expanded="${!!expanded}" aria-label="${expanded ? 'Collapse' : 'Expand'}">${expanded ? '▾' : '▸'}</button>`
    : '<span class="admin-cc-chevron-spacer"></span>';
  return `<span class="admin-cc-row-wrap" data-depth="${depth}">${chevron}<button type="button" data-node="${escapeHTML(key)}" class="admin-cc-row${sel}">${escapeHTML(label)}${c}</button></span>`;
}

function renderAdminTreeHTML(tree, selection, expanded){
  const exp = expanded || adminUI.structureExpanded;
  const q = adminUI.structureFilter || '';
  let out = '';
  if(tree && tree.org){
    out += ccRowHTML('org', tree.org.id, tree.org.name || 'Organization', tree.org.stats ? tree.org.stats.livePatients : null, 'patient', 0, selection, false, false);
  }
  for(const h of (tree && tree.hospitals) || []){
    const hExpanded = exp.has(`hospital:${h.id}`);
    const hasMatch = (h.departments || []).some(dep => nodeMatchesStructureFilter(dep, q) || (dep.units || []).some(u => nodeMatchesStructureFilter(u, q) || (u.wards || []).some(w => nodeMatchesStructureFilter(w, q))));
    if(q && !nodeMatchesStructureFilter(h, q) && !hasMatch) continue;
    out += ccRowHTML('hospital', h.id, h.name, h.stats ? h.stats.livePatients : null, 'patient', 0, selection, true, hExpanded || (q && hasMatch));
    if(!hExpanded && !(q && hasMatch)) continue;
    for(const dep of h.departments || []){
      const depExpanded = exp.has(`department:${dep.id}`);
      const depHasMatch = (dep.units || []).some(u => nodeMatchesStructureFilter(u, q) || (u.wards || []).some(w => nodeMatchesStructureFilter(w, q)));
      if(q && !nodeMatchesStructureFilter(dep, q) && !depHasMatch) continue;
      out += ccRowHTML('department', dep.id, dep.name, dep.stats.livePatients, 'patient', 1, selection, true, depExpanded || (q && depHasMatch));
      if(!depExpanded && !(q && depHasMatch)) continue;
      for(const u of dep.units || []){
        const uExpanded = exp.has(`unit:${u.id}`);
        const uHasMatch = (u.wards || []).some(w => nodeMatchesStructureFilter(w, q));
        if(q && !nodeMatchesStructureFilter(u, q) && !uHasMatch) continue;
        out += ccRowHTML('unit', u.id, u.name, u.stats.livePatients, 'patient', 2, selection, !!(u.wards || []).length, uExpanded || (q && uHasMatch));
        if((u.wards || []).length && !uExpanded && !(q && uHasMatch)) continue;
        for(const w of u.wards || []){
          if(q && !nodeMatchesStructureFilter(w, q)) continue;
          out += ccRowHTML('ward', w.id, w.name, w.stats.livePatients, 'pinned', 3, selection, false, false);
        }
      }
    }
  }
  return out;
}
```

Update `nodeStatsHTML` to use the same labelled-count language for the detail panel (unit: "N patients in this unit"; ward: "N pinned to this ward"; everything else keeps "N live patients"):

```js
function nodeStatsHTML(node, type){
  const s = node.stats;
  if(!s) return '';
  const label = type === 'unit' ? `${s.livePatients} patient${s.livePatients === 1 ? '' : 's'} in this unit`
    : type === 'ward' ? `${s.livePatients} pinned to this ward`
    : `${s.livePatients} live patient${s.livePatients === 1 ? '' : 's'}`;
  return `
    <div class="small-muted">${label} · ${s.users} user${s.users === 1 ? '' : 's'}</div>
    ${renderAdminStatusBar(s.byStatus, s.livePatients)}
    <div class="small-muted">${s.lastActivity ? 'Active ' + formatRelativeTime(s.lastActivity) : 'No activity yet'}</div>`;
}
```

Update the one call site inside `renderAdminDetailHTML` from `${nodeStatsHTML(node)}` to `${nodeStatsHTML(node, sel.type)}`.

Update `renderAdminStructureBody` to seed default expansion the first time a tree loads:

```js
function renderAdminStructureBody(){
  if(adminData.tree && !adminUI.structureExpanded.size) adminUI.structureExpanded = defaultExpandStructure(adminData.tree);
  const rail = document.getElementById('adminTreeRail');
  if(rail){
    rail.innerHTML = `
      <label for="adminStructureFilter" class="sr-only">Filter the tree by name</label>
      <input id="adminStructureFilter" placeholder="Filter…" value="${escapeHTML(adminUI.structureFilter)}">
      ${renderAdminTreeHTML(adminData.tree, adminUI.selectedNode)}`;
  }
  const detail = document.getElementById('adminDetailPane');
  if(detail) detail.innerHTML = renderAdminDetailHTML({ tree: adminData.tree, users: adminData.users, orgs: adminData.orgs, selection: adminUI.selectedNode });
}
```

Add the chevron-toggle and filter-input handlers. In the existing `document.getElementById('adminStructureSection')?.addEventListener('click', ...)` block, add as the first branch:

```js
  const chevron = e.target.closest('[data-toggle-expand]');
  if(chevron){
    e.stopPropagation();
    toggleAdminNodeExpanded(chevron.dataset.toggleExpand);
    renderAdminStructureBody();
    return;
  }
```

Add a new `input` listener:

```js
document.getElementById('adminStructureSection')?.addEventListener('input', (e) => {
  if(e.target.id !== 'adminStructureFilter') return;
  adminUI.structureFilter = e.target.value;
  if(adminUI.structureFilter.trim()){
    // Auto-expand every ancestor of every matching node so a match is
    // never hidden behind a collapsed row.
    const walk = (type, id, name) => {
      if(nodeMatchesStructureFilter({ name }, adminUI.structureFilter)){
        for(const key of ancestorsOf(adminData.tree, type, id)) adminUI.structureExpanded.add(key);
      }
    };
    for(const h of (adminData.tree && adminData.tree.hospitals) || []){
      walk('hospital', h.id, h.name);
      for(const dep of h.departments || []){
        walk('department', dep.id, dep.name);
        for(const u of dep.units || []){
          walk('unit', u.id, u.name);
          for(const w of u.wards || []) walk('ward', w.id, w.name);
        }
      }
    }
  }
  const rail = document.getElementById('adminTreeRail');
  const focused = document.activeElement === document.getElementById('adminStructureFilter');
  if(rail) rail.querySelector('.admin-cc-rows')?.remove();
  const rowsHTML = renderAdminTreeHTML(adminData.tree, adminUI.selectedNode);
  const wrap = document.createElement('div');
  wrap.className = 'admin-cc-rows';
  wrap.innerHTML = rowsHTML;
  rail.appendChild(wrap);
  if(focused) document.getElementById('adminStructureFilter').focus();
});
```

- [ ] **Step 4: Add chevron and labelled-count CSS**

In `public/index.html`, add after `.admin-cc-row .cc-count{...}`:

```css
  .admin-cc-row-wrap{display:flex;align-items:center;}
  .admin-cc-chevron{background:none;border:0;color:var(--ink-soft);cursor:pointer;width:28px;height:44px;font-size:12px;flex:none;}
  .admin-cc-chevron-spacer{display:inline-block;width:28px;flex:none;}
  #adminStructureFilter{width:100%;margin-bottom:8px;}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="tree expansion|tree filter"`

Expected: PASS, 9 tests.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures. (`renderAdminTreeHTML`'s new third parameter is optional and defaults to `adminUI.structureExpanded`, so the Task-1 call sites that still pass only two arguments keep working — verify no other test broke; if `tests/frontend-admin-structure.test.js`'s Task-1-era `renderAdminTreeHTML(TREE, null)` calls now render collapsed with no rows below the hospital, update those specific assertions to pass a fully-expanded `Set` as the third argument, e.g. `new Set(['hospital:h1', 'department:d1'])`, matching how Step 1's own tests do it.)

- [ ] **Step 7: Commit**

```bash
git add public/admin-structure.js public/index.html tests/frontend-admin-structure.test.js
git commit -m "feat: collapsible, searchable, persisted Structure tree

Rows get chevrons; expansion state lives in adminUI.structureExpanded
so it survives a reload. Opens to department level by default. A
filter box narrows to matching names and auto-expands every ancestor
of a match. Counts are labelled ('4 patients') instead of bare numbers."
```

---

### Task 8: Structure overhaul, part 2 — people assigned here, specialty, inline rename, add-child guard

**Files:**
- Modify: `public/admin-structure.js`
- Modify: `public/index.html` (CSS: inline rename input)
- Test: `tests/frontend-admin-structure.test.js`

**Interfaces:**
- Consumes: `PATCH /api/admin/nodes/department/:id` with `{ name, specialty }` (Plan 1, already supports `specialty`), `adminData.users`.
- Produces: `usersAssignedTo(type, id, users)` (pure). Inline rename replaces the `data-rename-node` button + `window.prompt` with a click-to-edit `<span data-rename-target>`/`<input>` pair. Department detail gains a specialty `<input data-specialty-node="id">`. Add-child form disables while its request is in flight.

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-structure.test.js`:

```js
describe('people assigned here', () => {
  const USERS = [
    { id: 'u1', username: 'alice', assignmentType: 'unit', assignmentId: 'u1' },
    { id: 'u2', username: 'bob', assignmentType: 'ward', assignmentId: 'w1' }
  ];

  test('usersAssignedTo returns exactly the users assigned to that node', () => {
    const { window } = loadFrontendEnv();
    assert.deepEqual(window.usersAssignedTo('unit', 'u1', USERS).map(u => u.username), ['alice']);
    assert.deepEqual(window.usersAssignedTo('ward', 'w1', USERS).map(u => u.username), ['bob']);
    assert.deepEqual(window.usersAssignedTo('unit', 'u2', USERS), []);
  });

  test('the detail panel lists people assigned here, linking into People', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: USERS, orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('alice'));
    assert.ok(html.includes('data-attention-people="node:unit:u1"'));
  });

  test('a node with nobody assigned says so', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('Nobody is assigned here yet'));
  });
});

describe('department specialty', () => {
  test('department detail shows a specialty field', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'department', id: 'd1' } });
    assert.match(html, /data-specialty-node="d1"[^>]*value="ortho"/);
  });

  test('changing the specialty field patches the department', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return {}; };
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'department', id: 'd1' } });
    const input = document.querySelector('[data-specialty-node="d1"]');
    input.value = 'trauma';
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const call = calls.find(c => c.path === '/api/admin/nodes/department/d1');
    assert.ok(call);
    assert.deepEqual(JSON.parse(call.opts.body), { name: 'Ortho', specialty: 'trauma' });
  });
});

describe('inline rename', () => {
  test('clicking the name reveals an editable input with the current name', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    document.querySelector('[data-rename-target="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    const input = document.querySelector('[data-rename-input="unit:u1"]');
    assert.equal(input.value, 'IV');
  });

  test('Enter saves; Escape cancels without a request', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return path.startsWith('/api/admin/org') ? TREE : { users: [] }; };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    document.querySelector('[data-rename-target="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    let input = document.querySelector('[data-rename-input="unit:u1"]');
    input.value = 'IV Ward';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const patchCall = calls.find(c => c.path === '/api/admin/nodes/unit/u1' && c.opts.method === 'PATCH');
    assert.ok(patchCall);
    assert.deepEqual(JSON.parse(patchCall.opts.body), { name: 'IV Ward' });

    calls.length = 0;
    document.querySelector('[data-rename-target="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    input = document.querySelector('[data-rename-input="unit:u1"]');
    input.value = 'Should not save';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!document.querySelector('[data-rename-input="unit:u1"]'));
    assert.equal(calls.filter(c => c.opts && c.opts.method === 'PATCH').length, 0);
  });

  test('a name over 80 characters shows an inline message and does not save', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return {}; };
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    document.querySelector('[data-rename-target="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    const input = document.querySelector('[data-rename-input="unit:u1"]');
    input.value = 'x'.repeat(81);
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.filter(c => c.opts && c.opts.method === 'PATCH').length, 0);
    assert.ok(document.getElementById('adminDetailPane').textContent.includes('80'));
  });
});

describe('add-child in-flight guard', () => {
  test('the add button and input disable while the request is in flight, and clear on success', async () => {
    const { window, document } = loadFrontendEnv();
    let resolveApi;
    window.api = () => new Promise(r => { resolveApi = r; });
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    document.querySelector('[data-new-child-name="unit:u1"]').value = 'New Ward';
    document.querySelector('[data-add-child="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.querySelector('[data-add-child="unit:u1"]').disabled, true);
    assert.equal(document.querySelector('[data-new-child-name="unit:u1"]').disabled, true);
    resolveApi({ id: 'w9', unitId: 'u1', name: 'New Ward' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="people assigned here|department specialty|inline rename|add-child in-flight guard"`

Expected: FAIL — `window.usersAssignedTo` doesn't exist; the detail panel has no assigned-people list, no specialty field, no `[data-rename-target]`/`[data-rename-input]`; the add-child button never disables.

- [ ] **Step 3: `usersAssignedTo` and the "People assigned here" block**

In `public/admin-structure.js`, add:

```js
function usersAssignedTo(type, id, users){
  return (users || []).filter(u => u.assignmentType === type && u.assignmentId === id);
}
```

Replace the body of `renderAdminDetailHTML` to append the assigned-people block and the specialty field. Replace the function entirely:

```js
function renderAdminDetailHTML(state){
  const sel = state.selection;
  if(!sel) return '<div class="small-muted">Select something on the left.</div>';
  let hit;
  if(sel.type === 'org'){
    if(!state.tree || !state.tree.org) return `<div class="small-muted">That item no longer exists.</div>`;
    hit = { node: { id: state.tree.org.id, name: state.tree.org.name || 'Organization', stats: state.tree.org.stats, hospitals: state.tree.hospitals || [] }, parentType: null, parentId: null };
  } else {
    hit = findAdminNode(state.tree, sel.type, sel.id);
    if(!hit) return `<div class="small-muted">That item no longer exists.</div>`;
  }
  const { node } = hit;
  const kids = childListOf(sel.type, node);
  const childType = childTypeOf(sel.type);
  const kidsHTML = kids.length
    ? kids.map(k => `<button type="button" class="admin-cc-row" data-node="${escapeHTML(childType)}:${escapeHTML(k.id)}">${escapeHTML(k.name)}<span class="cc-count">${k.stats ? k.stats.livePatients : ''}</span></button>`).join('')
    : (childType ? `<div class="small-muted">No ${childType}s yet.</div>` : `<div class="small-muted">No contents.</div>`);
  const addChild = childType ? `
    <div class="admin-inline-form">
      <label for="adminNewChildName-${escapeHTML(sel.id)}" class="sr-only">New ${escapeHTML(childType)} name</label>
      <input id="adminNewChildName-${escapeHTML(sel.id)}" placeholder="New ${escapeHTML(childType)} name" data-new-child-name="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">
      <button class="btn" data-add-child="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">Add ${escapeHTML(childType)}</button>
    </div>` : '';
  const specialtyHTML = sel.type === 'department' ? `
    <div class="admin-inline-form">
      <label for="adminSpecialty-${escapeHTML(sel.id)}">Specialty</label>
      <input id="adminSpecialty-${escapeHTML(sel.id)}" data-specialty-node="${escapeHTML(sel.id)}" value="${escapeHTML(node.specialty || '')}">
    </div>` : '';
  const assignedUsers = sel.type === 'org' ? [] : usersAssignedTo(sel.type, sel.id, state.users);
  const peopleHTML = sel.type === 'org' ? '' : `
    <h4>People assigned here</h4>
    ${assignedUsers.length
      ? `<div class="admin-cc-children">${assignedUsers.map(u => `<button type="button" class="admin-attention-row" data-attention-people="node:${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">${escapeHTML(u.username)}</button>`).join('')}</div>`
      : '<div class="small-muted">Nobody is assigned here yet.</div>'}`;
  return `
    <div class="admin-detail-head">
      <h3><span data-rename-target="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">${escapeHTML(node.name)}</span></h3>
      <span class="spec-badge">${escapeHTML(humanNodeType(sel.type))}</span>
      ${renderAdminNodeActionsHTML(state, sel, hit)}
    </div>
    ${specialtyHTML}
    ${nodeStatsHTML(node, sel.type)}
    ${peopleHTML}
    <h4>${childType ? childType[0].toUpperCase() + childType.slice(1) + 's' : 'Contents'}</h4>
    <div class="admin-cc-children">${kidsHTML}</div>
    ${addChild}`;
}
```

Note this removes the old `adminIsNarrow()`-gated rename/add-child hiding from `renderAdminDetailHTML` itself (Task 11 formally retires the gate; `renderAdminNodeActionsHTML` still gates Move/Delete for now, addressed in Task 9) — the rename control and add-child form are now always present, which is what lets the inline-rename and add-child tests above run without first faking a wide `window.innerWidth`.

Update `renderAdminNodeActionsHTML`'s narrow branch to no longer hide Rename (only Move/Delete stay narrow-gated until Task 9 removes that gate too):

```js
function renderAdminNodeActionsHTML(state, sel, hit){
  const key = `${sel.type}:${sel.id}`;
  if(sel.type === 'org') return '';
  if(adminIsNarrow()) return '<span class="small-muted">Open on a larger screen to move or delete</span>';
  const blocked = deleteBlockedReason(hit.node, sel.type);
  const parents = validMoveParents(state.tree, sel.type, hit.parentId);
  const moveHTML = MOVE_PARENT_TYPE[sel.type] ? `
    <select data-move-node="${escapeHTML(key)}">
      <option value="">Move to…</option>
      ${parents.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}
    </select>` : '';
  const deleteLabel = blocked ? `Can't delete — ${escapeHTML(blocked)}` : 'Delete';
  return `
    <span class="admin-node-actions">
      ${moveHTML}
      <button class="btn" data-delete-node="${escapeHTML(key)}"${blocked ? ' disabled' : ''} title="${escapeHTML(deleteLabel)}">${escapeHTML(deleteLabel)}</button>
    </span>`;
}
```

(This is Rename moving permanently into the `<h3>` as a click target rather than a button in the actions row — remove the old rename `<button>` markup entirely, since Step 3/4 below replace it.)

- [ ] **Step 4: Inline click-to-edit rename**

Replace the `data-rename-node` click handler and add a click-to-edit handler and its keydown handler. In `public/admin-structure.js`, remove the old `const renameBtn = e.target.closest('[data-rename-node]'); ...` block from the click listener, and add these in its place:

```js
  const renameTarget = e.target.closest('[data-rename-target]');
  if(renameTarget){
    e.stopPropagation();
    const key = renameTarget.dataset.renameTarget;
    const i = key.indexOf(':');
    const type = key.slice(0, i), id = key.slice(i + 1);
    const hitNode = type === 'org' ? adminData.tree.org : (findAdminNode(adminData.tree, type, id) || {}).node;
    if(!hitNode) return;
    const input = document.createElement('input');
    input.value = hitNode.name;
    input.dataset.renameInput = key;
    input.maxLength = 80;
    renameTarget.replaceWith(input);
    input.focus();
    input.select();
    return;
  }
```

Add the keydown handler for the rename input:

```js
document.getElementById('adminStructureSection')?.addEventListener('keydown', (e) => {
  const input = e.target.closest('[data-rename-input]');
  if(!input) return;
  const key = input.dataset.renameInput;
  const i = key.indexOf(':');
  const type = key.slice(0, i), id = key.slice(i + 1);
  if(e.key === 'Escape'){
    renderAdminStructureBody();
    return;
  }
  if(e.key !== 'Enter') return;
  const name = input.value.trim();
  if(!name || name.length > 80){
    const msg = document.createElement('div');
    msg.className = 'small-muted admin-rename-error';
    msg.textContent = 'Name required (max 80 characters)';
    input.after(msg);
    return;
  }
  api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) })
    .then(() => { invalidateHierarchyCaches(); return loadAdminView(); })
    .catch(err => showToast(err.message));
});
```

Add the `<h3>` rename-target focus style:

```css
  .admin-detail-head h3 span[data-rename-target]{cursor:text;border-bottom:1px dashed transparent;}
  .admin-detail-head h3 span[data-rename-target]:hover{border-bottom-color:var(--line);}
  .admin-detail-head input[data-rename-input]{font-size:inherit;font-weight:700;width:100%;}
  .admin-rename-error{color:#b23c3c;}
```

- [ ] **Step 5: Specialty field and add-child in-flight guard**

Add a `change` handler for the specialty field, inside the existing `document.getElementById('adminStructureSection')?.addEventListener('change', ...)` listener:

```js
  const specialty = e.target.closest('[data-specialty-node]');
  if(specialty){
    const id = specialty.dataset.specialtyNode;
    const hit = findAdminNode(adminData.tree, 'department', id);
    if(!hit) return;
    api(`/api/admin/nodes/department/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name: hit.node.name, specialty: specialty.value.trim() || 'ortho' }) })
      .then(() => loadAdminView())
      .catch(err => showToast(err.message));
    return;
  }
```

Guard the add-child form against double submission. Replace the `addBtn` branch:

```js
  const addBtn = e.target.closest('[data-add-child]');
  if(addBtn){
    e.stopPropagation();
    if(addBtn.disabled) return;
    const raw = addBtn.dataset.addChild;
    const i = raw.indexOf(':');
    const parentType = raw.slice(0, i), parentId = raw.slice(i + 1);
    const input = document.querySelector(`[data-new-child-name="${raw}"]`);
    const name = (input && input.value || '').trim();
    if(!name){ showToast('Enter a name'); return; }
    const route = addChildRouteFor(parentType);
    if(!route) return;
    const body = route.parentKey ? { [route.parentKey]: parentId, name } : { name };
    addBtn.disabled = true;
    if(input) input.disabled = true;
    api(route.path, { method: 'POST', body: JSON.stringify(body) })
      .then(() => { invalidateHierarchyCaches(); return loadAdminView(); })
      .catch(err => {
        showToast(err.message);
        addBtn.disabled = false;
        if(input) input.disabled = false;
      });
    return;
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="people assigned here|department specialty|inline rename|add-child in-flight guard"`

Expected: PASS, 9 tests.

- [ ] **Step 7: Run the full suite, fixing any test that assumed the old rename button**

Run: `npm test`

Expected: PASS, 0 failures. Any earlier test (Task 1's `tests/frontend-admin-structure.test.js`) asserting `data-rename-node="unit:u1"` must be updated to assert `data-rename-target="unit:u1"` instead — find and fix those assertions in this step.

- [ ] **Step 8: Commit**

```bash
git add public/admin-structure.js public/index.html tests/frontend-admin-structure.test.js
git commit -m "feat: people-assigned-here, department specialty, inline rename

The detail panel gains the 'people assigned here' list the previous
spec promised, and exposes department specialty (already supported by
PATCH .../department/:id, never wired up). Rename becomes click-to-
edit with Enter/Escape and an inline 80-char message, replacing
window.prompt. Add-child disables while its request is in flight."
```

---

### Task 9: Structure overhaul, part 3 — explicit Move, actionable delete blockers, delete-selects-parent, phone drill-down

**Files:**
- Modify: `public/admin-structure.js`
- Modify: `public/app.js` (new helper `openOrganizeForUnit`)
- Modify: `public/index.html` (CSS: mobile drill-down)
- Test: `tests/frontend-admin-structure.test.js`

**Interfaces:**
- Consumes: `currentUnitFilter`, `switchView('rounds')`, `toggleBulkSelectMode()`, `bulkSelectMode` (all existing in `app.js`).
- Produces: `openOrganizeForUnit(unitId)` (in `app.js`). Move gains an explicit `[data-move-confirm]` button (the `<select>` alone no longer posts). `describeDeleteBlockersHTML(err, node, type)` renders clickable blocker links. Delete selects the parent (`adminUI.selectedNode = hit.parentType ? { type: hit.parentType, id: hit.parentId } : null`). `adminUI.structureMobileDrilled` (Task 1) gates a `.is-drilled` class for the phone layout; `[data-back-to-tree]` clears it.

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-structure.test.js`:

```js
describe('explicit Move with confirmation', () => {
  test('changing the picker alone posts nothing; the Move button is required', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return {}; };
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    const sel = document.querySelector('[data-move-node="unit:u1"]');
    sel.value = sel.querySelector('option:not([value=""])').value;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.some(c => c.opts && c.opts.method === 'POST'), false);
    assert.ok(document.querySelector('[data-move-confirm="unit:u1"]'), 'expected an explicit Move button');
  });

  test('the Move button confirms naming both ends before posting', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    let confirmMessage = '';
    window.showConfirm = (title, message) => { confirmMessage = message; return Promise.resolve(true); };
    window.api = async (path, opts) => { calls.push({ path, opts }); return path.startsWith('/api/admin/org') ? TREE : { users: [] }; };
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'ward', id: 'w1' } });
    // A ward is movable between units; TREE has u1 (current) and u2 (target).
    const sel = document.querySelector('[data-move-node="ward:w1"]');
    sel.value = 'u2';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    document.querySelector('[data-move-confirm="ward:w1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.match(confirmMessage, /7MOW/);
    assert.match(confirmMessage, /IV/);
    assert.match(confirmMessage, /General/);
    const call = calls.find(c => c.path === '/api/admin/nodes/ward/w1/move');
    assert.ok(call);
    assert.deepEqual(JSON.parse(call.opts.body), { newParentId: 'u2' });
  });

  test('declining the confirmation posts nothing', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.showConfirm = () => Promise.resolve(false);
    window.api = async (path, opts) => { calls.push({ path, opts }); return {}; };
    document.getElementById('adminDetailPane').innerHTML =
      window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'ward', id: 'w1' } });
    document.querySelector('[data-move-node="ward:w1"]').value = 'u2';
    document.querySelector('[data-move-node="ward:w1"]').dispatchEvent(new window.Event('change', { bubbles: true }));
    document.querySelector('[data-move-confirm="ward:w1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.some(c => c.opts && c.opts.method === 'POST'), false);
  });
});

describe('actionable delete blockers', () => {
  test('a 409 with blockedBy.patients renders a link into Organize; blockedBy.users renders a link into People', async () => {
    const { window, document } = loadFrontendEnv();
    window.showConfirm = () => Promise.resolve(true);
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: [] };
      if(opts && opts.method === 'DELETE'){
        const err = new window.Error('Node is not empty');
        err.status = 409;
        err.payload = { error: 'Node is not empty', blockedBy: { children: 0, users: 1, patients: 2 } };
        throw err;
      }
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    document.querySelector('[data-delete-node="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const detail = document.getElementById('adminDetailPane');
    assert.ok(detail.querySelector('[data-organize-unit="u1"]'));
    assert.ok(detail.querySelector('[data-attention-people="node:unit:u1"]'));
  });

  test('clicking the patients blocker link calls openOrganizeForUnit', async () => {
    const { window, document } = loadFrontendEnv();
    window.showConfirm = () => Promise.resolve(true);
    let organizedUnit = null;
    window.openOrganizeForUnit = (id) => { organizedUnit = id; };
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: [] };
      if(opts && opts.method === 'DELETE'){
        const err = new window.Error('Node is not empty');
        err.status = 409;
        err.payload = { error: 'Node is not empty', blockedBy: { children: 0, users: 0, patients: 2 } };
        throw err;
      }
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    document.querySelector('[data-delete-node="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    document.querySelector('[data-organize-unit="u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(organizedUnit, 'u1');
  });
});

describe('delete selects the parent', () => {
  test('deleting a unit selects its department, not the People section', async () => {
    const { window, document } = loadFrontendEnv();
    window.showConfirm = () => Promise.resolve(true);
    const empty = JSON.parse(JSON.stringify(TREE));
    empty.hospitals[0].departments[0].units[1].stats.livePatients = 0;
    empty.hospitals[0].departments[0].units[1].stats.users = 0;
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return empty;
      if(path === '/api/admin/users') return { users: [] };
      if(opts && opts.method === 'DELETE') return { deleted: true };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u2');
    document.querySelector('[data-delete-node="unit:u2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(document.getElementById('adminDetailPane').innerHTML.includes('Ortho'));
    assert.equal(document.getElementById('adminPeopleSection').hidden, true);
  });
});

describe('phone drill-down', () => {
  test('selecting a row marks the structure body as drilled; Back clears it without losing the selection', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => path.startsWith('/api/admin/org') ? TREE : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    assert.equal(document.getElementById('adminStructureBody').classList.contains('is-drilled'), true);
    document.querySelector('[data-back-to-tree]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(document.getElementById('adminStructureBody').classList.contains('is-drilled'), false);
    assert.ok(document.getElementById('adminDetailPane').innerHTML.includes('IV'), 'selection itself is preserved');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="explicit Move with confirmation|actionable delete blockers|delete selects the parent|phone drill-down"`

Expected: FAIL — the `<select>` still posts on `change`; there's no `[data-move-confirm]`; delete blockers render as a disabled button with a text title, not links; deleting selects `{ type: 'users' }`-equivalent (nothing, since that selection no longer exists) instead of the parent; there's no `.is-drilled` class or `[data-back-to-tree]`.

- [ ] **Step 3: Explicit Move button + confirmation**

In `public/admin-structure.js`, replace the `moveHTML` line inside `renderAdminNodeActionsHTML`:

```js
  const moveHTML = MOVE_PARENT_TYPE[sel.type] ? `
    <span class="admin-move-group">
      <select data-move-node="${escapeHTML(key)}">
        <option value="">Move to…</option>
        ${parents.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}
      </select>
      <button class="btn" data-move-confirm="${escapeHTML(key)}" disabled>Move</button>
    </span>` : '';
```

Replace the whole `document.getElementById('adminStructureSection')?.addEventListener('change', ...)` listener body's move handling — it no longer posts on `change`, it just enables the Move button:

```js
document.getElementById('adminStructureSection')?.addEventListener('change', async (e) => {
  const moveSel = e.target.closest('[data-move-node]');
  if(moveSel){
    const btn = document.querySelector(`[data-move-confirm="${moveSel.dataset.moveNode}"]`);
    if(btn) btn.disabled = !moveSel.value;
    return;
  }
  const specialty = e.target.closest('[data-specialty-node]');
  if(specialty){
    const id = specialty.dataset.specialtyNode;
    const hit = findAdminNode(adminData.tree, 'department', id);
    if(!hit) return;
    api(`/api/admin/nodes/department/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name: hit.node.name, specialty: specialty.value.trim() || 'ortho' }) })
      .then(() => loadAdminView())
      .catch(err => showToast(err.message));
  }
});
```

Add the Move-button click handler (in the click listener, alongside the other branches). **First change that listener from `(e) =>` to `async (e) =>`** so the `await showConfirm` below (and the delete branch in Step 4) is legal:

```js
  const moveConfirmBtn = e.target.closest('[data-move-confirm]');
  if(moveConfirmBtn){
    e.stopPropagation();
    const key = moveConfirmBtn.dataset.moveConfirm;
    const i = key.indexOf(':');
    const type = key.slice(0, i), id = key.slice(i + 1);
    const sel = document.querySelector(`[data-move-node="${key}"]`);
    const newParentId = sel && sel.value;
    if(!newParentId) return;
    const hit = findAdminNode(adminData.tree, type, id);
    const parentType = MOVE_PARENT_TYPE[type];
    const parentOption = sel.querySelector(`option[value="${CSS.escape(newParentId)}"]`);
    const fromName = hit && hit.parentId ? (findAdminNode(adminData.tree, parentType, hit.parentId) || {}).node?.name || 'its current place' : 'its current place';
    const toName = parentOption ? parentOption.textContent : 'the new place';
    const ok = await showConfirm('Move', `Move ${hit ? hit.node.name : 'this'} from ${fromName} to ${toName}?`);
    if(!ok) return;
    api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify({ newParentId }) })
      .then(() => { invalidateHierarchyCaches(); return loadAdminView(); })
      .catch(err => { showToast(err.message); loadAdminView(); });
    return;
  }
```

- [ ] **Step 4: Actionable delete blockers**

Add `openOrganizeForUnit` to `public/app.js`, immediately after `toggleBulkSelectMode` (search for its definition — it is defined around line 8460 in the current file):

```js
/** Structure's delete-blocker link for "still has N patients": closes the
    admin view, switches to the main patient list filtered to this unit, and
    turns on bulk-select so the admin can move them straight away. Only
    meaningful at unit granularity — filterByUnit() has no ward-level or
    multi-unit (department/hospital) filter, so this is only ever called for
    a unit or a ward's owning unit. */
function openOrganizeForUnit(unitId){
  closeAdminView();
  switchView('rounds');
  currentUnitFilter = unitId || '';
  // Keep the rounds unit-filter control in sync — renderRounds reads
  // currentUnitFilter, but the <select> is only rewritten by renderUnitFilter.
  const el = document.getElementById('unitFilter');
  if(el && !el.hidden) el.value = currentUnitFilter;
  renderRounds();
  if(!bulkSelectMode) toggleBulkSelectMode();
  showToast('Showing this unit\'s patients — select some, then tap Move to unit');
}
```

In `public/admin-structure.js`, replace the `delBtn` branch of the click handler:

```js
  const delBtn = e.target.closest('[data-delete-node]');
  if(delBtn){
    e.stopPropagation();
    if(delBtn.disabled) return;
    const raw = delBtn.dataset.deleteNode;
    const i = raw.indexOf(':');
    const type = raw.slice(0, i), id = raw.slice(i + 1);
    if(!(await showConfirm(`Delete this ${humanNodeType(type)}?`, 'This cannot be undone.', { confirmLabel: 'Delete', danger: true }))) return;
    const hitBeforeDelete = findAdminNode(adminData.tree, type, id);
    api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(() => {
        invalidateHierarchyCaches();
        adminUI.selectedNode = hitBeforeDelete && hitBeforeDelete.parentType && hitBeforeDelete.parentId
          ? { type: hitBeforeDelete.parentType, id: hitBeforeDelete.parentId }
          : null;
        return loadAdminView();
      })
      .catch(err => {
        const el = document.getElementById('adminDeleteBlockers');
        if(el) el.innerHTML = describeDeleteBlockersHTML(err, type, id);
        else showToast(describeDeleteBlock(err) || err.message);
      });
    return;
  }
  const organizeBtn = e.target.closest('[data-organize-unit]');
  if(organizeBtn){ e.stopPropagation(); openOrganizeForUnit(organizeBtn.dataset.organizeUnit); return; }
```

Add `describeDeleteBlockersHTML` and a container for it. In `renderAdminNodeActionsHTML`, add an empty `<div id="adminDeleteBlockers">` right after the actions `<span>` so the delete handler above has somewhere to render into:

```js
  return `
    <span class="admin-node-actions">
      ${moveHTML}
      <button class="btn" data-delete-node="${escapeHTML(key)}"${blocked ? ' disabled' : ''} title="${escapeHTML(deleteLabel)}">${escapeHTML(deleteLabel)}</button>
    </span>
    <div id="adminDeleteBlockers"></div>`;
```

Add `describeDeleteBlockersHTML`, near `deleteBlockedReason`:

```js
/** Renders a 409's blockedBy counts as clickable, actionable links: the
    patients count opens Organize filtered to that unit (only meaningful at
    unit granularity — a department/hospital/org spans multiple units, so
    that count renders as plain text there instead of a broken link), and
    the users count opens People filtered to this node. */
function describeDeleteBlockersHTML(err, type, id){
  const b = err && err.payload && err.payload.blockedBy;
  if(!b) return `<div class="small-muted">${escapeHTML(err.message)}</div>`;
  const bits = [];
  if(b.children) bits.push(`${b.children} child item${b.children === 1 ? '' : 's'}`);
  if(b.patients){
    bits.push(type === 'unit'
      ? `<button type="button" class="admin-attention-row" data-organize-unit="${escapeHTML(id)}">${b.patients} patient${b.patients === 1 ? '' : 's'} — Organize</button>`
      : `${b.patients} patient${b.patients === 1 ? '' : 's'}`);
  }
  if(b.users) bits.push(`<button type="button" class="admin-attention-row" data-attention-people="node:${escapeHTML(type)}:${escapeHTML(id)}">${b.users} user${b.users === 1 ? '' : 's'} — People</button>`);
  return `<div class="small-muted">Can't delete — still has:</div>${bits.map(b => `<div>${b}</div>`).join('')}`;
}
```

- [ ] **Step 5: Phone drill-down**

Replace `selectAdminNode`:

```js
function selectAdminNode(type, id){
  adminUI.selectedNode = id ? { type, id } : { type };
  adminUI.structureMobileDrilled = true;
  renderAdminStructureBody();
}

function backToAdminTree(){
  adminUI.structureMobileDrilled = false;
  renderAdminStructureBody();
}
```

In `renderAdminStructureBody`, toggle the class and add the breadcrumb. Replace the function:

```js
function renderAdminStructureBody(){
  if(adminData.tree && !adminUI.structureExpanded.size) adminUI.structureExpanded = defaultExpandStructure(adminData.tree);
  const bodyEl = document.getElementById('adminStructureBody');
  if(bodyEl) bodyEl.classList.toggle('is-drilled', adminUI.structureMobileDrilled);
  const rail = document.getElementById('adminTreeRail');
  if(rail){
    rail.innerHTML = `
      <label for="adminStructureFilter" class="sr-only">Filter the tree by name</label>
      <input id="adminStructureFilter" placeholder="Filter…" value="${escapeHTML(adminUI.structureFilter)}">
      ${renderAdminTreeHTML(adminData.tree, adminUI.selectedNode)}`;
  }
  const detail = document.getElementById('adminDetailPane');
  if(detail){
    detail.innerHTML = `<button type="button" class="btn admin-back-to-tree" data-back-to-tree>‹ Back to tree</button>` +
      renderAdminDetailHTML({ tree: adminData.tree, users: adminData.users, orgs: adminData.orgs, selection: adminUI.selectedNode });
  }
}
```

Add the click handler:

```js
  if(e.target.closest('[data-back-to-tree]')){ e.stopPropagation(); backToAdminTree(); return; }
```

Add CSS:

```css
  .admin-back-to-tree{display:none;margin-bottom:10px;}
  @media (max-width: 899px){
    #adminStructureBody.is-drilled .admin-cc-rail{display:none;}
    #adminStructureBody:not(.is-drilled) .admin-cc-detail{display:none;}
    #adminStructureBody.is-drilled .admin-back-to-tree{display:inline-block;}
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="explicit Move with confirmation|actionable delete blockers|delete selects the parent|phone drill-down"`

Expected: PASS, 8 tests.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add public/admin-structure.js public/app.js public/index.html tests/frontend-admin-structure.test.js
git commit -m "feat: explicit Move+confirm, actionable delete blockers, phone drill-down

Move requires the button and a confirmation naming both ends — the
picker firing on change alone could silently reparent a department.
A blocked delete's patients/users counts render as links into Organize
and People instead of a disabled button's title text. Deleting a node
selects its parent, not nothing. Selecting a tree row drills into the
detail full-screen on a phone, with a Back breadcrumb that keeps the
selection."
```

---

### Task 10: Organizations overhaul — validation, state split, chooser, repair ancestry

**Files:**
- Modify: `public/admin-orgs.js`
- Modify: `public/index.html` (CSS: org chip)
- Test: `tests/frontend-admin-orgs.test.js`

Task 1 already fixed the state-collapse defects (3, 11, 12) as a side effect of moving `adminViewOrgId`/org list into `adminUI`/`adminData`. This task adds the remaining spec items: create-org-admin blank-name validation, the persistent "Viewing: ‹org› ✕" chip, and the repair-ancestry button.

**Files:**
- Modify: `public/admin-orgs.js`
- Test: `tests/frontend-admin-orgs.test.js`

**Interfaces:**
- Consumes: `POST /api/admin/repair-ancestry` (Plan 1, `→ { restamped }`).
- Produces: `[data-org-chip-close]` clears `adminUI.viewedOrgId` (delegates to `exitAdminOrgContext`). `[data-repair-ancestry]` button on the Organizations section.

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-orgs.test.js`:

```js
describe('create-org-admin validation', () => {
  test('a blank org-admin username shows an inline message instead of no-oping', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.api = async (path) => path === '/api/admin/orgs' ? { orgs: [{ id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }] } : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.querySelector('[data-new-org-admin="o1"]').value = '   ';
    document.querySelector('[data-create-org-admin="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual([...toasts], ['Enter a username']);
  });
});

describe('viewed-org chip', () => {
  test('viewing an org shows a persistent chip naming it, visible from any section', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [{ id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }] };
      if(path.startsWith('/api/admin/org')) return { org: { id: 'o1', name: 'Org One', stats: { livePatients: 0, byStatus: { postop: 0, preop: 0, conservative: 0, fordischarge: 0 }, users: 0, lastActivity: null } }, totals: { departments: 0, usersActive: 0, livePatients: 0 }, hospitals: [] };
      return { users: [] };
    };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const chip = document.getElementById('adminOrgChip');
    assert.ok(chip.textContent.includes('Org One'));
    assert.equal(chip.hidden, false);

    window.switchAdminSection('people');
    assert.equal(document.getElementById('adminOrgChip').hidden, false, 'the chip stays visible outside Structure/Organizations too');
  });

  test('clicking the chip\'s close button exits the org context', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [{ id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }] };
      if(path.startsWith('/api/admin/org')) return { org: { id: 'o1', name: 'Org One', stats: { livePatients: 0, byStatus: { postop: 0, preop: 0, conservative: 0, fordischarge: 0 }, users: 0, lastActivity: null } }, totals: { departments: 0, usersActive: 0, livePatients: 0 }, hospitals: [] };
      return { users: [] };
    };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    document.querySelector('[data-org-chip-close]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.getElementById('adminOrgChip').hidden, true);
    assert.equal(document.getElementById('adminOrgsSection').hidden, false);
  });
});

describe('repair ancestry', () => {
  test('the button is instance-admin only', () => {
    const { window, document } = loadFrontendEnv();
    window.renderAdminOrgsSection();
    assert.ok(!document.querySelector('[data-repair-ancestry]'));
    window.localStorage.setItem('ortho_role', 'admin');
    window.renderAdminOrgsSection();
    assert.ok(document.querySelector('[data-repair-ancestry]'));
  });

  test('clicking it confirms, then posts and reports the restamped count', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    let confirmed = '';
    window.showConfirm = (title, message) => { confirmed = message; return Promise.resolve(true); };
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.api = async (path, opts) => {
      if(path === '/api/admin/orgs') return { orgs: [] };
      if(path === '/api/admin/repair-ancestry' && opts && opts.method === 'POST') return { restamped: 4 };
      return { users: [] };
    };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.querySelector('[data-repair-ancestry]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(confirmed.length > 0);
    assert.deepEqual([...toasts], ['Fixed ancestry for 4 patients']);
  });

  test('declining the confirmation posts nothing', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.showConfirm = () => Promise.resolve(false);
    const calls = [];
    window.api = async (path, opts) => { calls.push(path); return path === '/api/admin/orgs' ? { orgs: [] } : { users: [] }; };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.querySelector('[data-repair-ancestry]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.includes('/api/admin/repair-ancestry'), false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="create-org-admin validation|viewed-org chip|repair ancestry"`

Expected: FAIL — create-org-admin currently posts a request with an empty-string username instead of validating; there's no `#adminOrgChip`/`[data-org-chip-close]`; there's no `[data-repair-ancestry]` button.

- [ ] **Step 3: Add the chip markup and CSS**

In `public/index.html`, add the chip inside `.admin-view-header`, after the `<h2 id="adminViewTitle">` line:

```html
    <span class="admin-org-chip" id="adminOrgChip" hidden>
      Viewing: <strong id="adminOrgChipName"></strong>
      <button type="button" class="admin-org-chip-close" data-org-chip-close aria-label="Stop viewing this organization">✕</button>
    </span>
```

Add CSS:

```css
  .admin-org-chip{display:inline-flex;align-items:center;gap:6px;background:var(--accent-soft);color:var(--accent);border-radius:999px;padding:6px 12px;font-size:13px;}
  .admin-org-chip-close{background:none;border:0;color:inherit;cursor:pointer;font-size:14px;min-width:24px;min-height:24px;}
```

- [ ] **Step 4: Render the chip whenever an org is viewed, from any section**

In `public/admin-console.js`, call a chip-render function from `renderAdminSection` (so it updates regardless of which section is active):

```js
function renderAdminOrgChip(){
  const chip = document.getElementById('adminOrgChip');
  if(!chip) return;
  if(!adminUI.viewedOrgId){ chip.hidden = true; return; }
  const org = (adminUI.allOrgs || []).find(o => o.id === adminUI.viewedOrgId) || (adminData.tree && adminData.tree.org);
  document.getElementById('adminOrgChipName').textContent = org ? org.name : 'Organization';
  chip.hidden = false;
}
```

Call it at the top of `renderAdminSection`, right after `renderAdminSectionTabs();`:

```js
function renderAdminSection(){
  renderAdminSectionTabs();
  renderAdminOrgChip();
  ...
```

Wire the close button — add at module scope in `public/admin-console.js`:

```js
document.getElementById('adminOrgChip')?.addEventListener('click', (e) => {
  if(e.target.closest('[data-org-chip-close]')) exitAdminOrgContext();
});
```

- [ ] **Step 5: Validate create-org-admin's blank username, and add repair-ancestry**

In `public/admin-orgs.js`, the create-org-admin click handler already checks `if(!username){ showToast('Enter a username'); return; }` (ported in Task 1) — confirm this by re-running Step 2's first test; if it still fails, the input's value of `'   '` is not being trimmed before the check. Fix by ensuring the check reads the trimmed value (it already does via `const username = (input && input.value || '').trim();` from Task 1's port) — this test should already pass after Task 1. Skip re-implementing it; only the chip and repair-ancestry pieces are new in this task.

Add the repair-ancestry button and instance-admin gate to `renderAdminOrgsSection`:

```js
function renderAdminOrgsSection(){
  const el = document.getElementById('adminOrgsSection');
  if(!el) return;
  const repairHTML = isInstanceAdminUser()
    ? `<div class="admin-inline-form"><button class="btn" data-repair-ancestry>Repair ancestry</button></div>`
    : '';
  el.innerHTML = `<h3>Organizations</h3>` + (adminData.orgs || []).map(o => `
    <div class="admin-org-card" data-org-id="${escapeHTML(o.id)}">
      <strong>${escapeHTML(o.name)}</strong> <span class="spec-badge">${escapeHTML(o.plan)}</span>
      <div class="small-muted">${o.stats.hospitals} hospitals · ${o.stats.departments} departments · ${o.stats.users} users · ${o.stats.livePatients} live patients</div>
      <div class="admin-inline-form">
        <label for="adminNewOrgAdmin-${escapeHTML(o.id)}" class="sr-only">New org admin username</label>
        <input id="adminNewOrgAdmin-${escapeHTML(o.id)}" placeholder="New org admin username" data-new-org-admin="${escapeHTML(o.id)}">
        <button class="btn" data-create-org-admin="${escapeHTML(o.id)}">Create org admin</button>
        <button class="btn" data-view-org="${escapeHTML(o.id)}">View</button>
      </div>
    </div>`).join('') + `
    <div class="admin-inline-form">
      <label for="adminNewOrgName" class="sr-only">New organization name</label>
      <input placeholder="New organization name" id="adminNewOrgName">
      <button class="btn" id="adminAddOrgBtn">Create organization</button>
    </div>
    ${repairHTML}`;
}
```

Add the click handler:

```js
  if(e.target.closest('[data-repair-ancestry]')){
    e.stopPropagation();
    showConfirm('Repair ancestry', 'Re-derives every patient\'s hospital/department/unit/ward labels and stats from their current unit assignment. Safe to run any time; only fixes migration debris, does not move anyone.', { confirmLabel: 'Repair' })
      .then(ok => {
        if(!ok) return;
        return api('/api/admin/repair-ancestry', { method: 'POST' })
          .then(res => showToast(`Fixed ancestry for ${res.restamped} patients`))
          .catch(err => showToast(err.message));
      });
    return;
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="create-org-admin validation|viewed-org chip|repair ancestry"`

Expected: PASS, 6 tests.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add public/admin-console.js public/admin-orgs.js public/index.html tests/frontend-admin-orgs.test.js
git commit -m "feat: viewed-org chip and repair-ancestry button

A persistent 'Viewing: <org> ✕' chip stays visible in every section
while an instance admin has drilled into an org; its ✕ exits back to
the org cards through the same exitAdminOrgContext() path Task 1
already fixed. POST /api/admin/repair-ancestry — previously curl-only
— gets a button with a plain explanation and a confirmation."
```

---

### Task 11: Remove the mobile read-only gate; responsive CSS pass

**Files:**
- Modify: `public/admin-structure.js`, `public/admin-people.js`
- Modify: `public/index.html` (CSS)
- Test: `tests/frontend-admin-structure.test.js`, `tests/frontend-admin-people.test.js`

**Interfaces:**
- Removes: `adminIsNarrow()` and every call site that branches rendering on it. Structure's Move/Delete controls and People's desktop table controls become unconditional; CSS media queries (already in place from Tasks 6 and 9 for People cards and the phone drill-down) take over all narrow-vs-wide layout decisions.

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-structure.test.js`:

```js
describe('no mobile read-only gate (Task 11)', () => {
  test('a narrow viewport still renders Move and Delete controls', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('data-move-node='));
    assert.ok(html.includes('data-delete-node='));
    assert.ok(!html.includes('larger screen'));
  });

  test('adminIsNarrow no longer exists as a rendering gate', () => {
    const { window } = loadFrontendEnv();
    assert.equal(typeof window.adminIsNarrow, 'undefined');
  });
});
```

Add to `tests/frontend-admin-people.test.js`:

```js
describe('no mobile read-only gate (Task 11)', () => {
  test('a narrow viewport still renders the assign select, checkbox and create form', () => {
    const { window } = loadFrontendEnv();
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }] });
    assert.ok(html.includes('data-assign-user'));
    assert.ok(html.includes('data-user-check'));
    assert.ok(html.includes('id="adminCreateUser"'));
  });
});
```

Remove the two now-superseded "mobile read-only" describe blocks (titled `mobile read-only (removed in Task 11 — still gates today)`) from both `tests/frontend-admin-structure.test.js` and `tests/frontend-admin-people.test.js` — their assertions are the exact opposite of the new behaviour.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="no mobile read-only gate"`

Expected: FAIL — the old `adminIsNarrow()` checks still hide Move/Delete/assign/checkbox/create-form under 900px/narrow widths, and `adminIsNarrow` is still defined.

- [ ] **Step 3: Remove `adminIsNarrow` and every call site**

In `public/admin-structure.js`, delete the `adminIsNarrow` function entirely, and replace `renderAdminNodeActionsHTML`'s first two lines:

```js
function renderAdminNodeActionsHTML(state, sel, hit){
  const key = `${sel.type}:${sel.id}`;
  if(sel.type === 'org') return '';
```

(removing the `if(adminIsNarrow()) return '<span class="small-muted">Open on a larger screen to move or delete</span>';` line).

In `public/admin-people.js`, remove every `const narrow = adminIsNarrow();` declaration and the `narrow ? ... : ...` branches in `renderAdminUsersPanelHTML` and `renderAdminPeopleRowHTML`, keeping only the "wide" (unconditional) branch of each. Replace `renderAdminPeopleRowHTML`'s top and `actions`/`checkCell`/`assignCell` lines:

```js
function renderAdminPeopleRowHTML(u){
  const groups = buildAssignNodeGroups(adminData.tree, adminData.orgs);
  const selType = u.assignmentType || null, selId = u.assignmentId || null;
  const prev = selType && selId ? `${selType}:${selId}` : '';
  const self = isSelfUser(u);
  const lastAdmin = isLastActiveAdmin(u, adminData.users);
  const disableTitle = self ? 'You cannot disable your own account' : (u.active && lastAdmin ? 'This is the last active admin — promote someone else first' : '');
  const disableAttrs = (self || (u.active && lastAdmin)) ? ` disabled title="${escapeHTML(disableTitle)}"` : '';
  const roleTitle = self ? 'You cannot change your own role' : (lastAdmin ? 'This is the last active admin of the organization' : '');
  const roleDisabled = self || lastAdmin;
  const actions = `
        <button class="btn" data-user-toggle="${escapeHTML(u.id)}"${disableAttrs}>${u.active ? 'Disable' : 'Enable'}</button>
        <button class="btn" data-user-reset="${escapeHTML(u.id)}">Reset password</button>`;
  const checkCell = `<td><input type="checkbox" data-user-check="${escapeHTML(u.id)}"${adminUI.peopleChecked.has(u.id) ? ' checked' : ''}></td>`;
  const label = assignLabelFor(groups, selType, selId);
  const assignCell = `<td><select data-assign-user="${escapeHTML(u.id)}" data-prev="${escapeHTML(prev)}">${renderAssignSelectOptionsHTML(groups, selType, selId)}</select></td>`;
  const nameCell = self ? `${escapeHTML(u.username)} <span class="spec-badge">You</span>` : escapeHTML(u.username);
  const roleCell = `<td><select data-role-user="${escapeHTML(u.id)}"${roleDisabled ? ` disabled title="${escapeHTML(roleTitle)}"` : ''}>
        <option value="member"${u.role === 'member' ? ' selected' : ''}>Member</option>
        <option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin</option>
      </select></td>`;
  return `${checkCell}
        <td>${nameCell}</td>
        ${roleCell}
        ${assignCell}
        <td>${u.active ? 'active' : 'disabled'}${actions}
        </td>`;
}
```

In `renderAdminUsersPanelHTML`, remove `const narrow = adminIsNarrow();` and the `narrowNote`/`createUserForm` ternaries, replacing them with the unconditional (previously "wide") version each already had. `refreshAdminBulkBar` loses its `if(adminIsNarrow()){ ... }` early return — delete that line, keeping the rest of the function.

Also remove the now-obsolete `<td></td>`/text-only branches referencing `narrow` in the assign cell and the People card builder (the cards from Task 6 stay — they are a CSS-driven parallel layout now, not a narrow/wide JS branch).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="no mobile read-only gate"`

Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full suite, updating any test that referenced the removed narrow behaviour**

Run: `npm test`

Expected: PASS, 0 failures. Delete any remaining test (in either file, from earlier tasks) whose name or body specifically asserts the old narrow-hides-controls behaviour — Step 1 already listed the two known describe blocks; search both files for `adminIsNarrow` and `innerWidth` to confirm none remain outside the CSS media query itself (which stays, since CSS drives layout now, not JS gating).

- [ ] **Step 6: Sticky header and 44px audit**

In `public/index.html`, make the admin header sticky so Back and the org chip stay reachable while scrolling a long People list or Structure tree:

```css
  .admin-view-header{position:sticky;top:0;background:var(--paper);z-index:10;padding-top:4px;padding-bottom:8px;}
```

Audit every new interactive element added in Tasks 1–10 for a 44px minimum touch target; the ones not already covered are the tree chevrons (`.admin-cc-chevron{...height:44px...}` — already set in Task 7) and the people chips (`.admin-people-chip{...min-height:36px...}` from Task 4 — bump to 44px):

```css
  .admin-people-chip{min-height:44px;}
```

- [ ] **Step 7: Run the full suite one more time**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add public/admin-structure.js public/admin-people.js public/index.html tests/frontend-admin-structure.test.js tests/frontend-admin-people.test.js
git commit -m "fix: remove the mobile read-only gate; sticky header; 44px targets

adminIsNarrow() no longer hides any control. Move/Delete on Structure
and the assign select/checkbox/create form on People render the same
way at every width now — the People-cards (Task 6) and phone
drill-down (Task 9) CSS media queries already handle the narrow
layout, so the JS gate was the last thing standing between 'admin work
happens on a phone' and reality. Header is sticky; chips meet 44px."
```

---

### Task 12: Accessibility, dark mode, and final regression pass

**Files:**
- Modify: `public/admin-console.js`, `public/admin-people.js`, `public/admin-structure.js`, `public/admin-orgs.js`
- Modify: `public/index.html` (CSS: focus-visible, dark-mode spot check)
- Test: `tests/frontend-admin-console.test.js`, `tests/frontend-admin-people.test.js`, `tests/frontend-admin-structure.test.js`

**Interfaces:**
- Produces: `restoreAdminFocus(save, restore)` helper pattern applied to the three re-render points most likely to destroy focus (rename input, filter box, search box) — captures the focused element's identifying data attribute before a full-section repaint and refocuses the equivalent element after.

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-structure.test.js`:

```js
describe('focus restoration', () => {
  test('renaming a node keeps focus on the (now read-only) name after the reload-triggered repaint', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path, opts) => {
      if(path.startsWith('/api/admin/org')) return TREE;
      if(path === '/api/admin/users') return { users: [] };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    document.querySelector('[data-rename-target="unit:u1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    const input = document.querySelector('[data-rename-input="unit:u1"]');
    input.value = 'IV Ward';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.activeElement.closest('[data-rename-target]')?.dataset.renameTarget, 'unit:u1');
  });
});

describe('aria-expanded and labels audit', () => {
  test('every expandable tree row has aria-expanded, and the filter/search inputs have labels', () => {
    const { window, document } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, null, new Set(['hospital:h1']));
    assert.match(html, /aria-expanded="(true|false)"/);
  });
});

describe('no schema words in the interface', () => {
  test('the People panel never says "assignment" or shows a raw lowercase type badge', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [] });
    assert.ok(!/\bassignment\b/i.test(html));
  });
  test('the Structure detail badge is capitalized, never a raw lowercase type', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(!html.includes('>unit<'));
    assert.ok(html.includes('>Unit<'));
  });
  test('no visible copy contains the word "node"', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(!/\bnode\b/i.test(html.replace(/data-[a-z-]*node[a-z-]*="[^"]*"/gi, '')));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="focus restoration|aria-expanded and labels audit|no schema words in the interface"`

Expected: FAIL — after a rename's `loadAdminView()` repaint, focus lands on `document.body` (jsdom's default) rather than back on the renamed node's name span; the schema-word checks may already pass from earlier tasks (if so, this step's failure is only the focus-restoration test — run it standalone to confirm which).

- [ ] **Step 3: Restore focus after a rename-triggered reload**

In `public/admin-structure.js`, change the rename-input `keydown` handler's success path to save/restore the selection (which already drives what `renderAdminStructureBody` paints), and explicitly refocus the name span after the repaint:

```js
document.getElementById('adminStructureSection')?.addEventListener('keydown', (e) => {
  const input = e.target.closest('[data-rename-input]');
  if(!input) return;
  const key = input.dataset.renameInput;
  const i = key.indexOf(':');
  const type = key.slice(0, i), id = key.slice(i + 1);
  if(e.key === 'Escape'){
    renderAdminStructureBody();
    return;
  }
  if(e.key !== 'Enter') return;
  const name = input.value.trim();
  if(!name || name.length > 80){
    const msg = document.createElement('div');
    msg.className = 'small-muted admin-rename-error';
    msg.textContent = 'Name required (max 80 characters)';
    input.after(msg);
    return;
  }
  api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) })
    .then(() => {
      invalidateHierarchyCaches();
      return loadAdminView();
    })
    .then(() => {
      document.querySelector(`[data-rename-target="${key}"]`)?.focus();
    })
    .catch(err => showToast(err.message));
});
```

`<span data-rename-target>` needs `tabindex="0"` to be focusable — update the `<h3>` line in `renderAdminDetailHTML`:

```js
    <div class="admin-detail-head">
      <h3><span data-rename-target="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}" tabindex="0">${escapeHTML(node.name)}</span></h3>
```

- [ ] **Step 4: Confirm labels and `aria-expanded` are already complete; fix any gap the audit test finds**

Grep both `public/admin-people.js` and `public/admin-structure.js` for every `<input` and `<select` in a rendered template; each must have a preceding `<label for="...">` (visible or `.sr-only`) with a matching `id`. Tasks 4–10 already added these (`adminUserSearch`, `adminNewUsername`, `adminNewUserPlacement`, `adminStructureFilter`, `adminSpecialty-*`, `adminNewChildName-*`, `adminNewOrgAdmin-*`); if this grep finds any input introduced by an earlier task without a matching label (there should be none), add the missing `<label for="id" class="sr-only">Description</label>` immediately before it and re-run the full suite.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="focus restoration|aria-expanded and labels audit|no schema words in the interface"`

Expected: PASS, 5 tests.

- [ ] **Step 6: Dark-mode spot check**

Grep `public/index.html`'s admin CSS additions from Tasks 1–11 for any hex/rgb colour literal that isn't inside an existing `--status-*`/`--accent`/etc. `var()` call:

Run: `grep -n "admin-" public/index.html | grep -E "#[0-9a-fA-F]{3,6}|rgb\("`

Expected: the only matches are the two `.admin-inline-note`/`.admin-inline-note-error`/`admin-rename-error` colours added in Tasks 6/8/9 (`var(--status-fordischarge)` is a `var()` already; `#b23c3c` is a literal). Replace those two literals with the existing error convention used elsewhere in the app — grep for the pattern first:

Run: `grep -n "b23c3c\|#c0392b\|--danger" public/index.html | head -5`

Replace every `#b23c3c` introduced in Tasks 6, 8 and 9 with whatever existing danger/error token that grep surfaces (if the codebase has no dedicated danger token, define one alongside the others in both the light and dark `:root[data-theme]` blocks: `--danger:#b23c3c;` light, `--danger:#e07a7a;` dark, then reference `var(--danger)` from all three call sites instead of the literal).

- [ ] **Step 7: Full regression run**

Run: `npm test`

Expected: PASS, 0 failures, and the count is the Task-1 baseline (455) plus every test added in Tasks 1–12.

- [ ] **Step 8: Manual smoke test**

```bash
ORTHO_FLAG_MULTI_TENANT=1 ORTHO_ADMIN_PASSWORD=smoke-test-pass npm start
```

Sign in as `admin`, then confirm each of these:

1. Overview shows four stat tiles, three quick actions, and (if any exist) Needs attention categories.
2. People: search text and a checked row both survive disabling a different user. Create a person with a placement in one step; the temporary password modal has a working Copy button and only closes on Done.
3. People: the role select on your own row and on the org's last admin is disabled with a title explaining why; changing another admin's role confirms first.
4. Structure: the tree opens with departments expanded; a filter narrows and auto-expands to matches; renaming a unit is click-to-edit; Move requires the button and a confirmation; deleting a node selects its parent.
5. Delete a unit with patients in it — the blocker renders "N patients — Organize" as a clickable link that opens the main patient list filtered to that unit with bulk-select on.
6. Organizations: the "Viewing: ‹org› ✕" chip stays visible while browsing People, and its ✕ returns to the org cards. Click Repair ancestry — it confirms, then reports a restamped count.
7. Resize the browser below 700px: People renders as cards; below 900px: Structure drills into a full-screen detail view with a working Back breadcrumb. Every control is still clickable/tappable at every width (no "Open on a larger screen" message appears anywhere).
8. Toggle dark mode (existing `darkModeBtn`) and re-check steps 1–6 for any illegible or invisible element.

- [ ] **Step 9: Commit**

```bash
git add public/admin-console.js public/admin-people.js public/admin-structure.js public/admin-orgs.js public/index.html tests/frontend-admin-console.test.js tests/frontend-admin-people.test.js tests/frontend-admin-structure.test.js
git commit -m "fix: focus restoration after rename, dark-mode token audit, final pass

Renaming a node returns focus to its name instead of the top of the
page. Two error-text colour literals introduced across Tasks 6/8/9
move onto a shared --danger token so they follow dark mode like every
other admin console colour. Full suite green; manual smoke checklist
covers every section at three viewport widths and both themes."
```

---

## Verification

- [ ] **Full suite, one final time**

Run: `npm test`

Expected: PASS, 0 failures, 133+ suites, and the total test count is the Task-1 baseline (455) plus every test added across Tasks 1–12 (no test was removed without an equal-or-better replacement in the same task — Task 11's two deletions each removed a test that asserted the *opposite* of the new required behaviour, replaced by that task's own new tests).

- [ ] **Flag-off regression**

Run: `npm test -- --test-name-pattern="flag OFF|sync-golden"`

Expected: PASS — with `MULTI_TENANT` off, `adminUiVisible()` is false, `#adminView` stays `hidden`, and `tests/server-sync-golden.test.js` is untouched by this plan (frontend-only).

- [ ] **Manual smoke test** — see Task 12, Step 8.

---

## Not in this plan

Everything Plan 1 already shipped (the `orgId` escalation fix, the role route's guards, `admin.js`'s count corrections, the `blockedBy` payload threading through `api()`, and the org-context lifecycle repair). Also out of scope per the design spec: an admin audit log, undo, drag-and-drop reparenting, live/real-time updates, manual node ordering, per-node permission editing, bulk patient re-homing beyond the one-click link into the existing Organize surface, promoting `admin.js`'s app-layer patient scan to indexed queries, and reconciling the legacy per-department `user.wardId` field with node-based assignment.
