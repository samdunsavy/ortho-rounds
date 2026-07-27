# Admin Console Redesign (Approach B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the MULTI_TENANT admin console into a sidebar-navigated, icon-led, master-detail interface that visually belongs to Ortho Rounds — frontend-only, no new dependencies, no behavior regressions.

**Architecture:** Pure client-side change across `public/index.html` (admin CSS, one inline SVG `<symbol>` sprite, shell markup) and the four `public/admin-*.js` builders. Navigation moves from a horizontal `role="tablist"` to a persistent left `<nav>` sidebar; Structure and Organizations become CSS-grid master-detail; an `icon()` helper injects sprite glyphs. All data-`*` hooks, element ids, delegated handlers, and mutation flows are preserved.

**Tech Stack:** Vanilla ES (classic non-module scripts sharing top-level `let`), CSS custom-property token system (light + dark), inline SVG sprite, `node:test` + `jsdom` (`tests/helpers/frontend-env.js`).

## Global Constraints

- Files touched ONLY: `public/index.html`, `public/admin-console.js`, `public/admin-people.js`, `public/admin-structure.js`, `public/admin-orgs.js`, and their test files under `tests/`. No `server.js`, no `admin.js`, no API changes.
- Existing design tokens only: `--paper`, `--card`, `--line`, `--line-soft`, `--ink`, `--ink-soft`, `--accent`, `--accent-soft`, `--on-accent`, `--accent-hover`, `--warn`, `--warn-bg`, `--bad`, `--bad-bg`, `--shadow-sm/md/lg`, `--radius`, `--radius-sm`, `--radius-chip`, status colours (`--status-postop/preop/conservative/fordischarge`). No new colour literals. No new fonts (DM Sans + JetBrains Mono already loaded).
- New asset allowed: ONE inline SVG sprite. No icon font, no component library, no npm dependency.
- Dark mode must work via BOTH `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]`. Icons use `fill="none" stroke="currentColor"` so they follow text colour automatically.
- Preserve every `data-*` attribute, element `id`, and delegated click/keydown handler. Keep the new sidebar buttons carrying `data-admin-section="<id>"` so existing `switchAdminSection` tests survive.
- Preserve the `adminLoadSeq` race guard and the shipped busy state (`is-busy` / `aria-busy` / `#adminBusyStatus`). The spinner relocates into the context bar but keeps its lifecycle.
- Touch targets ≥44px stay ≥44px. `MULTI_TENANT` off keeps the console unreachable; sync-golden stays green.
- Test runner: `npm test` == `node --no-warnings --test` (all tests). Single file: `node --no-warnings --test tests/<file>`. Filter by name: append `--test-name-pattern="<regex>"`.
- Sentence case for all UI copy. Commit after every task.

## File Structure

- `public/index.html` — `<!-- admin console -->` CSS block (~lines 710-829), the admin markup (`#adminView`, ~lines 2107-2146), and a new inline SVG sprite placed once near the top of `<body>`. Responsible for: layout shell CSS, sprite definitions, static shell markup.
- `public/admin-console.js` — shared core: `adminUI` state, sidebar nav renderer (replaces `renderAdminSectionTabs`), context bar, `icon()` helper, Overview builders, `loadAdminView`. Responsible for: shell + Overview.
- `public/admin-structure.js` — Structure master-detail (rail + detail). Responsible for: two-pane Structure.
- `public/admin-people.js` — People table/cards restyle (icons, status chips, avatars). Responsible for: People.
- `public/admin-orgs.js` — Organizations master-detail. Responsible for: Orgs rail + detail.
- Tests: `tests/frontend-admin-console.test.js`, `tests/frontend-admin-structure.test.js`, `tests/frontend-admin-people.test.js`, `tests/frontend-admin-orgs.test.js`.

---

### Task 1: Icon sprite + `icon()` helper

**Files:**
- Modify: `public/index.html` (add inline SVG sprite once inside `<body>`)
- Modify: `public/admin-console.js` (add global `icon()` helper near top, after the `adminUI` declaration)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Produces: `icon(name, cls?)` → string `'<svg class="ic ..." aria-hidden="true"><use href="#ic-<name>"/></svg>'`. Consumed by every later task.

- [ ] **Step 1: Write the failing test**

Add to `tests/frontend-admin-console.test.js`:

```javascript
describe('admin icon system', () => {
  test('icon() returns an svg use reference to the sprite', () => {
    const { window } = orgAdminEnv();
    const html = window.icon('users');
    assert.match(html, /<svg class="ic[^"]*" aria-hidden="true"><use href="#ic-users"\/><\/svg>/);
  });
  test('icon() applies an extra class', () => {
    const { window } = orgAdminEnv();
    assert.match(window.icon('trash', 'ic-lg'), /class="ic ic-lg"/);
  });
  test('the sprite defines every glyph icon() will be asked for', () => {
    const { document } = orgAdminEnv();
    for(const id of ['ic-dashboard','ic-users','ic-sitemap','ic-hospital','ic-arrow-left',
      'ic-stethoscope','ic-user-check','ic-bed','ic-activity','ic-alert-triangle',
      'ic-chevron-right','ic-chevron-down','ic-plus','ic-edit','ic-trash',
      'ic-map-pin-off','ic-box-off','ic-search']){
      assert.ok(document.getElementById(id), `missing sprite symbol ${id}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js --test-name-pattern="icon"`
Expected: FAIL — `window.icon is not a function` / missing symbols.

- [ ] **Step 3: Add the sprite to `index.html`**

Immediately after the opening `<body>` tag (before the first visible markup), add ONE hidden sprite. Each symbol uses `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`. Use simple, recognizable outline paths (Feather-style geometry is fine — hand-written paths, no external file). Example structure:

```html
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <symbol id="ic-dashboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></symbol>
  <symbol id="ic-users" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></symbol>
  <symbol id="ic-sitemap" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="5"/><rect x="3" y="16" width="6" height="5"/><rect x="15" y="16" width="6" height="5"/><path d="M12 8v4M6 16v-2h12v2"/></symbol>
  <symbol id="ic-hospital" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16"/><path d="M2 21h20M12 7v6M9 10h6"/></symbol>
  <symbol id="ic-arrow-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></symbol>
  <symbol id="ic-stethoscope" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v6a5 5 0 0 0 10 0V3"/><path d="M4 3H2M14 3h-2M9 14v3a4 4 0 0 0 8 0v-2"/><circle cx="19" cy="13" r="2"/></symbol>
  <symbol id="ic-user-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M16 11l2 2 4-4"/></symbol>
  <symbol id="ic-bed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20"/><circle cx="7" cy="11" r="1.5"/></symbol>
  <symbol id="ic-activity" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></symbol>
  <symbol id="ic-alert-triangle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></symbol>
  <symbol id="ic-chevron-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></symbol>
  <symbol id="ic-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></symbol>
  <symbol id="ic-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></symbol>
  <symbol id="ic-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></symbol>
  <symbol id="ic-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></symbol>
  <symbol id="ic-map-pin-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.43 5.43A8 8 0 0 0 4 10c0 6 8 12 8 12a30 30 0 0 0 3.5-3.5"/><path d="M19.18 13.52A8 8 0 0 0 20 10a8 8 0 0 0-13.5-5.8"/><path d="M2 2l20 20"/></symbol>
  <symbol id="ic-box-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73"/><path d="M3.27 6.96 12 12l8.73-5.04M12 22V12"/><path d="M2 2l20 20"/></symbol>
  <symbol id="ic-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></symbol>
</svg>
```

- [ ] **Step 4: Add the `icon()` helper and `.ic` CSS**

In `public/admin-console.js`, after the `adminUI` object declaration, add:

```javascript
/** Sprite glyph as inline svg. name maps to a <symbol id="ic-<name>">.
    Decorative only — always aria-hidden; callers keep the accessible name. */
function icon(name, cls){
  return `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#ic-${name}"/></svg>`;
}
```

In `public/index.html`, inside the admin CSS block, add:

```css
.ic{width:1em;height:1em;flex:none;vertical-align:-0.15em;stroke-width:2;}
.ic-lg{width:1.25em;height:1.25em;}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js --test-name-pattern="icon"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/admin-console.js tests/frontend-admin-console.test.js
git commit -m "feat: admin console inline svg icon sprite + icon() helper"
```

---

### Task 2: Sidebar shell + context bar

**Files:**
- Modify: `public/index.html` (admin CSS block; `#adminView` markup)
- Modify: `public/admin-console.js` (`renderAdminSidebarNav`, `renderAdminSection`, keyboard handler, `loadAdminView` stamp)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `visibleAdminSections()`, `switchAdminSection(id)`, `icon()`, `adminUI`.
- Produces: `renderAdminSidebarNav()` renders `<button data-admin-section="<id>" aria-current>` items into `#adminSidebarNav`; `adminUI.lastLoadedAt` (number|null); context-bar title in `#adminContextTitle`.

- [ ] **Step 1: Write the failing tests**

Replace the two shell tests that assert `role="tab"`/`aria-selected`/`tabindex` with sidebar equivalents, and add nav tests:

```javascript
describe('admin console shell: sidebar nav', () => {
  test('org admin sees 3 nav items (no Organizations); instance admin sees 4', () => {
    const { window, document } = orgAdminEnv();
    window.renderAdminSidebarNav();
    assert.deepEqual(
      [...document.querySelectorAll('#adminSidebarNav [data-admin-section]')].map(b => b.dataset.adminSection),
      ['overview', 'people', 'structure']
    );
    window.localStorage.setItem('ortho_role', 'admin');
    window.renderAdminSidebarNav();
    assert.deepEqual(
      [...document.querySelectorAll('#adminSidebarNav [data-admin-section]')].map(b => b.dataset.adminSection),
      ['overview', 'people', 'structure', 'orgs']
    );
  });
  test('the active nav item has aria-current=page and no other does', () => {
    const { window, document } = orgAdminEnv();
    window.renderAdminSidebarNav();
    const current = document.querySelectorAll('#adminSidebarNav [aria-current="page"]');
    assert.equal(current.length, 1);
    assert.equal(current[0].dataset.adminSection, 'overview');
  });
  test('each nav item carries an icon svg', () => {
    const { window, document } = orgAdminEnv();
    window.renderAdminSidebarNav();
    const overview = document.querySelector('#adminSidebarNav [data-admin-section="overview"]');
    assert.ok(overview.querySelector('svg.ic use'));
  });
  test('loadAdminView stamps lastLoadedAt', async () => {
    const { window } = orgAdminEnv();
    await window.loadAdminView();
    assert.equal(typeof window.adminUI.lastLoadedAt, 'number');
  });
});
```

Keep the existing `switchAdminSection` test (it queries `[data-admin-section="people"]`, which still exists on the sidebar button) but drop its `aria-selected` assertion line, replacing with:

```javascript
assert.equal(document.querySelector('[data-admin-section="people"]').getAttribute('aria-current'), 'page');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js --test-name-pattern="sidebar|lastLoadedAt"`
Expected: FAIL — `renderAdminSidebarNav is not a function`; `#adminSidebarNav` missing.

- [ ] **Step 3: Rework the shell markup in `index.html`**

Replace the `#adminView` inner header + tabs (`.admin-view-header` and `.admin-section-tabs`) with the sidebar shell. Keep every id (`adminViewClose`, `adminViewTitle`, `adminBusyStatus`, `adminBusyStatus`'s spinner, `adminOrgChip`, `adminOrgChipName`) — just relocate them:

```html
<div class="admin-view" id="adminView" hidden>
  <nav class="admin-sidebar" aria-label="Admin console">
    <div class="admin-sidebar-brand">${'' /* filled by JS or static */}<span>Admin</span></div>
    <div class="admin-sidebar-nav" id="adminSidebarNav"></div>
    <button class="btn admin-sidebar-back" id="adminViewClose">← Back to rounds</button>
  </nav>
  <div class="admin-main">
    <div class="admin-context-bar">
      <h2 id="adminContextTitle" class="admin-view-title">Overview</h2>
      <span id="adminBusyStatus" class="admin-busy-status" hidden aria-live="polite">
        <span class="admin-busy-spinner" aria-hidden="true"></span> Updating…
      </span>
      <span class="admin-org-chip" id="adminOrgChip" hidden>
        Viewing: <strong id="adminOrgChipName"></strong>
        <button type="button" class="admin-org-chip-close" data-org-chip-close aria-label="Stop viewing this organization">✕</button>
      </span>
      <span class="admin-updated" id="adminUpdatedStamp" hidden></span>
    </div>
    <div class="admin-section" id="adminOverviewSection"> ... unchanged inner ... </div>
    <div class="admin-section" id="adminPeopleSection" hidden></div>
    <div class="admin-section" id="adminStructureSection" hidden> ... unchanged inner ... </div>
    <div class="admin-section" id="adminOrgsSection" hidden></div>
  </div>
</div>
```

Leave the four `.admin-section` inner contents exactly as they are today (Overview chooser/body, Structure `.admin-cc`, etc.).

- [ ] **Step 4: Replace tab CSS with sidebar CSS**

In the admin CSS block, replace `.admin-section-tabs` / `.admin-section-tab*` rules with:

```css
.admin-view{position:fixed;inset:0;z-index:60;background:var(--paper);display:flex;overflow:hidden;}
.admin-view[hidden]{display:none;}
.admin-sidebar{width:200px;flex:none;background:var(--card);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:14px 10px;gap:2px;overflow-y:auto;}
.admin-sidebar-brand{display:flex;align-items:center;gap:8px;font-weight:700;color:var(--ink);padding:4px 8px 12px;font-size:15px;}
.admin-sidebar-nav{display:flex;flex-direction:column;gap:2px;}
.admin-nav-item{display:flex;align-items:center;gap:10px;padding:10px;border:0;border-radius:var(--radius-sm);background:none;color:var(--ink-soft);font:inherit;font-size:14px;cursor:pointer;text-align:left;min-height:44px;}
.admin-nav-item:hover{color:var(--ink);background:var(--accent-soft);}
.admin-nav-item[aria-current="page"]{color:var(--accent);background:var(--accent-soft);font-weight:700;box-shadow:inset 3px 0 0 var(--accent);}
.admin-nav-item .ic{font-size:18px;color:inherit;}
.admin-nav-item:focus-visible{outline:none;box-shadow:var(--focus-ring);}
.admin-sidebar-back{margin-top:auto;justify-content:flex-start;min-height:44px;background:transparent;border:1px solid var(--line);color:var(--ink-soft);}
.admin-main{flex:1;min-width:0;overflow-y:auto;padding:16px 20px;max-width:1120px;margin:0 auto;width:100%;}
.admin-context-bar{position:sticky;top:0;background:var(--paper);z-index:10;display:flex;align-items:center;gap:12px;padding:4px 0 12px;flex-wrap:wrap;}
.admin-updated{margin-left:auto;font-size:12px;color:var(--ink-soft);font-family:var(--mono);}
.admin-updated[hidden]{display:none;}
@media (max-width:699px){
  .admin-view{flex-direction:column;}
  .admin-sidebar{width:auto;flex-direction:row;border-right:0;border-bottom:1px solid var(--line);overflow-x:auto;padding:8px;}
  .admin-sidebar-brand{display:none;}
  .admin-sidebar-nav{flex-direction:row;}
  .admin-nav-item{white-space:nowrap;}
  .admin-sidebar-back{margin-top:0;margin-left:auto;}
}
```

Keep `.admin-busy-status` moving into the context bar (its `margin-left:auto` no longer needed — the `.admin-updated` element takes that; set `.admin-busy-status{margin-left:0}`). Keep `.admin-view.is-busy .admin-section:not([hidden]){opacity:.55;pointer-events:none;}`.

- [ ] **Step 5: Implement `renderAdminSidebarNav` and wire it up**

In `public/admin-console.js`, replace `renderAdminSectionTabs` with:

```javascript
const ADMIN_SECTION_ICONS = { overview: 'dashboard', people: 'users', structure: 'sitemap', orgs: 'hospital' };

function renderAdminSidebarNav(){
  const el = document.getElementById('adminSidebarNav');
  if(!el) return;
  const sections = visibleAdminSections();
  if(!sections.some(s => s.id === adminUI.section)) adminUI.section = 'overview';
  el.innerHTML = sections.map(s => `
    <button type="button" class="admin-nav-item" data-admin-section="${s.id}"
      ${s.id === adminUI.section ? 'aria-current="page"' : ''}>
      ${icon(ADMIN_SECTION_ICONS[s.id])}<span>${escapeHTML(s.label)}</span>
    </button>`).join('');
}
```

Update `renderAdminSection()` to call `renderAdminSidebarNav()` (instead of `renderAdminSectionTabs()`) and to set the context title:

```javascript
function renderAdminSection(){
  renderAdminSidebarNav();
  renderAdminOrgChip();
  const titleEl = document.getElementById('adminContextTitle');
  if(titleEl){ const s = ADMIN_SECTIONS.find(x => x.id === adminUI.section); titleEl.textContent = s ? s.label : 'Admin'; }
  // ... existing per-section hide/show + late-bound render calls unchanged ...
}
```

Update the delegated listener + keyboard handler: change the container id from `adminSectionTabs` to `adminSidebarNav`, and replace the Left/Right/Home/End roving-tabindex handler with vertical arrows:

```javascript
document.getElementById('adminSidebarNav')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-admin-section]');
  if(btn) switchAdminSection(btn.dataset.adminSection);
});
document.getElementById('adminSidebarNav')?.addEventListener('keydown', (e) => {
  if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key)) return;
  const sections = visibleAdminSections();
  const i = sections.findIndex(s => s.id === adminUI.section);
  if(i === -1) return;
  e.preventDefault();
  let next;
  if(e.key === 'ArrowUp') next = sections[(i - 1 + sections.length) % sections.length];
  else if(e.key === 'ArrowDown') next = sections[(i + 1) % sections.length];
  else if(e.key === 'Home') next = sections[0];
  else next = sections[sections.length - 1];
  switchAdminSection(next.id);
});
```

In `loadAdminView()`, on the successful (latest-token) path just before `renderAdminSection()`, add:

```javascript
adminUI.lastLoadedAt = Date.now();
```

And add a helper + call to paint the stamp inside `renderAdminSection()` (after title):

```javascript
const stamp = document.getElementById('adminUpdatedStamp');
if(stamp){
  if(adminUI.lastLoadedAt){ stamp.hidden = false; stamp.textContent = 'updated ' + new Date(adminUI.lastLoadedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
  else stamp.hidden = true;
}
```

Add `lastLoadedAt: null` to the `adminUI` initializer. Update the `#adminOrgChip` click listener id reference only if it changed (it did not — chip keeps its id).

- [ ] **Step 6: Run the full admin-console suite**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js`
Expected: PASS. Fix any remaining test that referenced `#adminSectionTabs`, `role="tab"`, `aria-selected`, or `tabindex` by switching to `#adminSidebarNav` / `aria-current`.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/admin-console.js tests/frontend-admin-console.test.js
git commit -m "feat: replace admin tab strip with sidebar shell + context bar"
```

---

### Task 3: Overview dashboard (metric icons, status bar, grouped attention)

**Files:**
- Modify: `public/admin-console.js` (`renderAdminStatTiles`, `renderAdminNeedsAttentionHTML`, `renderAdminOverviewSection`, quick-action markup)
- Modify: `public/index.html` (stat-tile, attention, status-bar CSS tweaks)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `icon()`, `computeAdminNeedsAttention()` (unchanged), `renderAdminStatusBar()` (unchanged), `adminData.tree`.
- Produces: same DOM ids/hooks (`#adminStatTiles`, `#adminNeedsAttention`, `data-attention-*`, `#adminQuick*`), now with icons + a `#adminOverviewStatusBar` element.

- [ ] **Step 1: Write the failing tests**

```javascript
describe('admin overview dashboard', () => {
  test('each stat tile has an icon', () => {
    const { window, document } = orgAdminEnv();
    document.getElementById('adminStatTiles').innerHTML = window.renderAdminStatTiles(TREE);
    assert.equal(document.querySelectorAll('#adminStatTiles .admin-stat-tile svg.ic').length, 4);
  });
  test('overview renders an org-level status bar', async () => {
    const { window, document } = orgAdminEnv();
    await window.loadAdminView();
    window.switchAdminSection('overview');
    assert.ok(document.querySelector('#adminOverviewStatusBar .admin-status-bar'));
  });
  test('needs-attention rows keep their data hooks and gain icons', () => {
    const { window } = orgAdminEnv();
    const cats = { unassigned: [{ username: 'x' }], stale: [], emptyUnits: [], disabled: [] };
    const html = window.renderAdminNeedsAttentionHTML(cats);
    assert.match(html, /data-attention-people="unassigned"/);
    assert.match(html, /<svg class="ic/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js --test-name-pattern="overview dashboard"`
Expected: FAIL — no `svg.ic` in tiles; no `#adminOverviewStatusBar`.

- [ ] **Step 3: Add icons to stat tiles**

Update `renderAdminStatTiles`:

```javascript
function renderAdminStatTiles(tree){
  const postop = tree.hospitals.flatMap(h => h.departments).reduce((n, dep) => n + (dep.stats.byStatus.postop || 0), 0);
  const tiles = [
    { n: tree.totals.departments, l: 'Departments', ic: 'stethoscope' },
    { n: tree.totals.usersActive, l: 'Active users', ic: 'user-check' },
    { n: tree.totals.livePatients, l: 'Live patients', ic: 'bed' },
    { n: postop, l: 'Post-op', ic: 'activity' }
  ];
  return tiles.map(t => `<div class="admin-stat-tile"><div class="admin-stat-icon">${icon(t.ic)}</div><div class="n">${t.n}</div><div class="l">${escapeHTML(t.l)}</div></div>`).join('');
}
```

Adjust `.admin-stat-tile` CSS to left-align and add `.admin-stat-icon{color:var(--ink-soft);font-size:16px;margin-bottom:6px;}` (change `text-align:center` → `text-align:left`).

- [ ] **Step 4: Add the status bar element + render**

In `index.html`, inside `#adminOverviewBody`, add `<div id="adminOverviewStatusBar"></div>` between `#adminStatTiles` and `.admin-quick-actions`. In `renderAdminOverviewSection`, after `renderAdminStatTilesInto(adminData.tree)`:

```javascript
const bar = document.getElementById('adminOverviewStatusBar');
if(bar){ const s = adminData.tree && adminData.tree.org && adminData.tree.org.stats; bar.innerHTML = s ? renderAdminStatusBar(s.byStatus, s.livePatients) : ''; }
```

- [ ] **Step 5: Icon the needs-attention rows + quick actions**

In `renderAdminNeedsAttentionHTML`, prepend a category icon inside each `.admin-attention-row` (`user-check`→unassigned uses `map-pin-off` for stale, `box-off` for empty units, `users` for disabled, `alert-triangle` on the group `h4`) and add a trailing `${icon('chevron-right')}`. Add class `admin-attention-urgent` to the unassigned group for the `--warn-bg` tint. Keep every `data-attention-*` attribute exactly. In `index.html`, add the quick-action icons by editing the three buttons to `${...}` — since they are static markup, edit directly: `<button class="btn" id="adminQuickAddPerson"><svg class="ic" aria-hidden="true"><use href="#ic-plus"/></svg> Add person</button>` etc. Add CSS: `.admin-attention-urgent{background:var(--warn-bg);} .admin-attention-row{display:flex;align-items:center;gap:8px;} .admin-attention-row .ic{color:var(--ink-soft);font-size:15px;} .admin-attention-row .ic:last-child{margin-left:auto;}`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js`
Expected: PASS (whole file).

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/admin-console.js tests/frontend-admin-console.test.js
git commit -m "feat: admin overview dashboard with metric icons, status bar, grouped attention"
```

---

### Task 4: Structure two-pane grid

**Files:**
- Modify: `public/index.html` (`.admin-cc` grid CSS; rail-row/detail CSS)
- Modify: `public/admin-structure.js` (rail-row icons, detail-pane breadcrumb + stat grid, action icons)
- Test: `tests/frontend-admin-structure.test.js`

**Interfaces:**
- Consumes: `icon()`, existing tree data, existing `selectAdminNode`, rename/delete/move handlers (unchanged).
- Produces: same `data-*` hooks; adds `.admin-cc-stats` grid and breadcrumb markup; `.admin-cc` becomes grid at ≥720px.

- [ ] **Step 1: Read the current structure builder**

Read `public/admin-structure.js` fully to learn the exact rail-row and detail markup, the `data-*` hooks (`data-node-select`, `data-new-child-name`, `data-rename-input`, `data-rename-target`, move/delete buttons), and the `structureMobileDrilled` handling. Do not change any hook name.

- [ ] **Step 2: Write the failing tests**

Add to `tests/frontend-admin-structure.test.js` (mirror its existing env helper):

```javascript
test('structure body uses a two-column grid class at desktop', () => {
  const { document } = structureEnv();
  assert.ok(document.getElementById('adminStructureBody').classList.contains('admin-cc'));
  // the CSS grid is asserted via the class contract; JSDOM has no layout engine
});
test('rail rows carry a node-type icon', async () => {
  const { window, document } = structureEnv();
  await window.loadAdminView();
  window.switchAdminSection('structure');
  assert.ok(document.querySelector('#adminTreeRail .admin-cc-row svg.ic use'));
});
test('detail pane shows a stat grid for a selected unit', async () => {
  const { window, document } = structureEnv();
  await window.loadAdminView();
  window.switchAdminSection('structure');
  window.selectAdminNode('unit', 'u1');
  assert.ok(document.querySelector('#adminDetailPane .admin-cc-stats'));
});
```

(If `structureEnv` does not already exist in that file, add one modeled on `orgAdminEnv` from the console test, returning tree `TREE` for `/api/admin/org` and `{ users: [] }` for `/api/admin/users`.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --no-warnings --test tests/frontend-admin-structure.test.js --test-name-pattern="two-column|node-type icon|stat grid"`
Expected: FAIL — no `svg.ic` in rows; no `.admin-cc-stats`.

- [ ] **Step 4: Make `.admin-cc` a grid**

In `index.html` replace `.admin-cc{display:block;}` with:

```css
.admin-cc{display:block;}
@media (min-width:720px){
  .admin-cc{display:grid;grid-template-columns:minmax(220px,280px) 1fr;gap:12px;align-items:start;}
  .admin-cc-rail{margin-bottom:0;}
}
.admin-cc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0;}
.admin-cc-stat{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius-sm);padding:8px 10px;}
.admin-cc-stat .n{font-size:18px;font-weight:700;font-family:var(--mono);color:var(--ink);}
.admin-cc-stat .l{font-size:12px;color:var(--ink-soft);}
.admin-cc-breadcrumb{font-size:12px;color:var(--ink-soft);font-family:var(--mono);margin-left:8px;}
```

Confirm the existing `@media (max-width:699px)` drill-down rules for `.admin-cc-rail`/`.admin-cc-detail` still apply (they gate on `structureMobileDrilled`); the desktop grid only activates ≥720px, so the 700-719px gap stays single-column — acceptable.

- [ ] **Step 5: Add icons + breadcrumb + stat grid in the builder**

In `public/admin-structure.js`: in the rail-row template add a leading `${icon(nodeTypeIcon(type))}` where `nodeTypeIcon` maps `hospital→hospital, department→stethoscope, unit→sitemap, ward→bed`. In the detail-pane header, after the rename target, add `<span class="admin-cc-breadcrumb">${escapeHTML(path)}</span>` using the department-relative path already available (or built from parents). Add the action icons to rename/delete/move buttons (`edit`, `trash`, `arrow-left`/appropriate). Insert an `.admin-cc-stats` block built from the selected node's `stats`:

```javascript
function nodeStatGridHTML(stats){
  if(!stats) return '';
  return `<div class="admin-cc-stats">
    <div class="admin-cc-stat"><div class="n">${stats.livePatients || 0}</div><div class="l">Patients</div></div>
    <div class="admin-cc-stat"><div class="n">${stats.users || 0}</div><div class="l">Staff</div></div>
    <div class="admin-cc-stat"><div class="n">${stats.byStatus ? (stats.byStatus.postop || 0) : 0}</div><div class="l">Post-op</div></div>
  </div>`;
}
```

Insert its output near the top of the detail pane body. Keep the children list, add-child form, rename/delete/move markup and all their hooks intact.

- [ ] **Step 6: Run the structure suite**

Run: `node --no-warnings --test tests/frontend-admin-structure.test.js`
Expected: PASS. Adjust any existing selector-based assertion only if a wrapper/class rename forced it.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/admin-structure.js tests/frontend-admin-structure.test.js
git commit -m "feat: structure two-pane grid with iconed rail + detail stat grid"
```

---

### Task 5: People restyle (filter icons, status chips, avatars)

**Files:**
- Modify: `public/admin-people.js` (filter chip icons, status chip, initials avatar)
- Modify: `public/index.html` (status-chip + avatar CSS)
- Test: `tests/frontend-admin-people.test.js`

**Interfaces:**
- Consumes: `icon()`, existing user rows, `getAdminPeopleFilter()`, all existing People handlers (unchanged).
- Produces: same `data-*` hooks and ids; adds `.admin-status-chip` and `.admin-avatar` presentational elements.

- [ ] **Step 1: Read the current People builder**

Read `public/admin-people.js` to learn the filter-chip template, the table-row/card template, and every `data-*` hook (bulk checkboxes, assignment select, role toggle, disable/enable). Do not rename hooks. Note the `@media (max-width:699px)` table↔card swap must not change.

- [ ] **Step 2: Write the failing tests**

```javascript
test('filter chips carry icons', () => {
  const { window, document } = peopleEnv();
  window.renderAdminPeopleSection();
  assert.ok(document.querySelector('.admin-people-chip svg.ic use'));
});
test('a disabled user renders a disabled status chip', () => {
  const { window, document } = peopleEnv([{ id: 'u9', username: 'bob', active: false }]);
  window.renderAdminPeopleSection();
  const chip = document.querySelector('[data-user-id="u9"] .admin-status-chip, .admin-people-card .admin-status-chip');
  assert.ok(chip);
  assert.match(chip.textContent.toLowerCase(), /disabled/);
});
test('a user row shows an initials avatar', () => {
  const { window, document } = peopleEnv([{ id: 'u9', username: 'bob', active: true }]);
  window.renderAdminPeopleSection();
  assert.ok(document.querySelector('.admin-avatar'));
});
```

(Add a `peopleEnv(users)` helper if absent, modeled on the console test env, that stubs `api` to return `{ users }` for `/api/admin/users` and `TREE` for `/api/admin/org`, then calls `loadAdminView` or seeds `adminData` directly.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --no-warnings --test tests/frontend-admin-people.test.js --test-name-pattern="icons|status chip|avatar"`
Expected: FAIL.

- [ ] **Step 4: Add filter icons, status chip, avatar**

Map filter chips to icons (`all→users, unassigned→map-pin-off, disabled→user-check, admins→user-check, stale→alert-triangle`) and prepend `${icon(...)}`. Add a `statusChipHTML(user, isStale)` helper returning `<span class="admin-status-chip is-<kind>">…</span>` for kinds `active|disabled|unassigned|stale`, and an `initialsAvatar(username)` helper → `<span class="admin-avatar">AB</span>`. Insert the avatar in the first cell / card head and the status chip beside the name. CSS:

```css
.admin-avatar{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:12px;font-weight:700;flex:none;}
.admin-status-chip{font-size:11px;border-radius:var(--radius-chip);padding:2px 8px;font-weight:600;}
.admin-status-chip.is-active{background:var(--accent-soft);color:var(--accent);}
.admin-status-chip.is-disabled{background:var(--bad-bg);color:var(--bad);}
.admin-status-chip.is-unassigned{background:var(--warn-bg);color:var(--warn);}
.admin-status-chip.is-stale{background:var(--warn-bg);color:var(--warn);}
```

- [ ] **Step 5: Run the People suite**

Run: `node --no-warnings --test tests/frontend-admin-people.test.js`
Expected: PASS. Fix only selector churn caused by added wrappers.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/admin-people.js tests/frontend-admin-people.test.js
git commit -m "feat: people restyle with filter icons, status chips, initials avatars"
```

---

### Task 6: Organizations master-detail

**Files:**
- Modify: `public/admin-orgs.js` (rail + detail render; `adminUI.selectedOrgId`)
- Modify: `public/admin-console.js` (add `selectedOrgId: null` to `adminUI`)
- Modify: `public/index.html` (org rail/detail CSS — reuse `.admin-cc*`)
- Test: `tests/frontend-admin-orgs.test.js`

**Interfaces:**
- Consumes: `icon()`, `adminData.orgs`, `enterAdminOrgContext`, existing delegated handler on `#adminOrgsSection` (unchanged — matches via `closest()`).
- Produces: `selectAdminOrg(id)` sets `adminUI.selectedOrgId` and re-renders; rail rows `data-org-select`; detail keeps `data-view-org`, `data-create-org-admin`, `data-new-org-admin`; globals keep `#adminNewOrgName`, `#adminAddOrgBtn`, `data-repair-ancestry`.

- [ ] **Step 1: Write the failing tests**

```javascript
test('orgs render a rail of selectable rows + a detail pane', () => {
  const { window, document } = orgsEnv([
    { id: 'o1', name: 'Alpha', plan: 'pro', stats: { hospitals: 1, departments: 2, users: 3, livePatients: 4 } }
  ]);
  window.renderAdminOrgsSection();
  assert.ok(document.querySelector('[data-org-select="o1"]'));
  assert.ok(document.getElementById('adminOrgsDetail'));
});
test('selecting an org shows its stats + View action in the detail pane', () => {
  const { window, document } = orgsEnv([
    { id: 'o1', name: 'Alpha', plan: 'pro', stats: { hospitals: 1, departments: 2, users: 3, livePatients: 4 } }
  ]);
  window.renderAdminOrgsSection();
  window.selectAdminOrg('o1');
  const detail = document.getElementById('adminOrgsDetail');
  assert.match(detail.textContent, /Alpha/);
  assert.ok(detail.querySelector('[data-view-org="o1"]'));
});
test('global create-org + repair-ancestry controls persist', () => {
  const { window, document } = orgsEnv([{ id: 'o1', name: 'Alpha', plan: 'pro', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }], true);
  window.renderAdminOrgsSection();
  assert.ok(document.getElementById('adminAddOrgBtn'));
  assert.ok(document.querySelector('[data-repair-ancestry]'));
});
```

(Add an `orgsEnv(orgs, instanceAdmin)` helper that seeds `adminData.orgs`, sets `ortho_role` to `admin` when `instanceAdmin`, and returns the env.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --no-warnings --test tests/frontend-admin-orgs.test.js --test-name-pattern="rail|detail|controls"`
Expected: FAIL — flat card list, no `[data-org-select]`, no `#adminOrgsDetail`, no `selectAdminOrg`.

- [ ] **Step 3: Add `selectedOrgId` to state**

In `public/admin-console.js`, add `selectedOrgId: null,` to the `adminUI` initializer.

- [ ] **Step 4: Rebuild `renderAdminOrgsSection` as master-detail**

```javascript
function selectAdminOrg(id){ adminUI.selectedOrgId = id; renderAdminOrgsSection(); }

function renderAdminOrgsSection(){
  const el = document.getElementById('adminOrgsSection');
  if(!el) return;
  const orgs = adminData.orgs || [];
  if(orgs.length && !orgs.some(o => o.id === adminUI.selectedOrgId)) adminUI.selectedOrgId = orgs[0].id;
  const sel = orgs.find(o => o.id === adminUI.selectedOrgId) || null;
  const rail = orgs.map(o => `
    <button type="button" class="admin-cc-row${o.id === adminUI.selectedOrgId ? ' is-selected' : ''}" data-org-select="${escapeHTML(o.id)}">
      ${icon('hospital')}<span>${escapeHTML(o.name)}</span>
      <span class="cc-count">${o.stats.livePatients}</span>
    </button>`).join('');
  const detail = sel ? `
    <div class="admin-detail-head"><h3>${escapeHTML(sel.name)} <span class="spec-badge">${escapeHTML(sel.plan)}</span></h3></div>
    <div class="admin-cc-stats">
      <div class="admin-cc-stat"><div class="n">${sel.stats.hospitals}</div><div class="l">Hospitals</div></div>
      <div class="admin-cc-stat"><div class="n">${sel.stats.departments}</div><div class="l">Departments</div></div>
      <div class="admin-cc-stat"><div class="n">${sel.stats.users}</div><div class="l">Users</div></div>
    </div>
    <div class="small-muted">${sel.stats.livePatients} live patients</div>
    <div class="admin-inline-form">
      <input placeholder="New org admin username" maxlength="32" data-new-org-admin="${escapeHTML(sel.id)}">
      <button class="btn" data-create-org-admin="${escapeHTML(sel.id)}">${icon('plus')} Create org admin</button>
      <button class="btn primary" data-view-org="${escapeHTML(sel.id)}">View</button>
    </div>` : `<div class="small-muted">No organizations yet.</div>`;
  const repairHTML = isInstanceAdminUser()
    ? `<div class="admin-inline-form"><button class="btn" data-repair-ancestry>Repair ancestry</button></div>` : '';
  el.innerHTML = `
    <div class="admin-cc" id="adminOrgsBody">
      <aside class="admin-cc-rail" id="adminOrgsRail">${rail}</aside>
      <section class="admin-cc-detail" id="adminOrgsDetail">${detail}</section>
    </div>
    <div class="admin-inline-form">
      <input placeholder="New organization name" id="adminNewOrgName" maxlength="80">
      <button class="btn" id="adminAddOrgBtn">${icon('plus')} Create organization</button>
    </div>
    ${repairHTML}`;
}
```

- [ ] **Step 5: Wire rail selection into the existing delegated handler**

In the `#adminOrgsSection` click listener, add near the top (before the other branches):

```javascript
const selBtn = e.target.closest('[data-org-select]');
if(selBtn){ e.stopPropagation(); selectAdminOrg(selBtn.dataset.orgSelect); return; }
```

Leave every other branch (`data-view-org`, `#adminAddOrgBtn`, `data-repair-ancestry`, `data-create-org-admin`) exactly as is.

- [ ] **Step 6: Run the orgs suite**

Run: `node --no-warnings --test tests/frontend-admin-orgs.test.js`
Expected: PASS. Update any existing test that asserted the old `.admin-org-card` flat-list markup to the rail/detail structure.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/admin-console.js public/admin-orgs.js tests/frontend-admin-orgs.test.js
git commit -m "feat: organizations master-detail (rail + detail pane)"
```

---

### Task 7: Full-suite verification + visual sanity

**Files:**
- Modify (only if a regression surfaces): any of the five source files.

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: PASS — all backend + frontend tests, including the pre-existing admin behavior tests (People filters/mutations, Structure rename/delete/move, org enter/exit, busy overlap). Investigate and fix any failure; do not weaken an assertion to make it pass unless the change was an intended markup rename.

- [ ] **Step 2: Grep for stragglers**

Run: `grep -rn "adminSectionTabs\|role=\"tab\"\|aria-selected\|renderAdminSectionTabs" public/ tests/`
Expected: no results in `public/` (all migrated). Any test-only references must have been updated to `#adminSidebarNav` / `aria-current`. Fix leftovers.

- [ ] **Step 3: Confirm flag-off + dark-mode contract**

Run: `grep -n "MULTI_TENANT" public/app.js | head` and confirm the console open path is still gated. Manually read the new CSS block for any hard-coded hex (there must be none — tokens only): `grep -nE "#[0-9a-fA-F]{3,6}" public/index.html | grep -iE "admin-(view|sidebar|nav|cc|stat|status|avatar|context|updated)"` should return nothing.

- [ ] **Step 4: Update the spec status**

Edit `docs/superpowers/specs/2026-07-27-admin-console-redesign-design.md` header `Status: Draft` → `Status: Implemented`.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test: full-suite green for admin console redesign; mark spec implemented"
```

---

## Self-Review

**Spec coverage:**
- §1 Shell/sidebar → Task 2. §2 Icons → Task 1. §3 Overview → Task 3. §4 Structure two-pane → Task 4. §5 People restyle → Task 5. §6 Organizations master-detail → Task 6. §7 architecture (`selectedOrgId`, `lastLoadedAt`, race guard) → Tasks 2 & 6. §8 error handling → unchanged, verified in Task 7. §9 testing → each task's tests + Task 7. §10 success criteria → Task 7. All sections covered.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". Tasks 3–6 include a "read the current builder" step because those files were not quoted verbatim in this session; every new/changed fragment is given as literal code. The sprite paths, helpers, CSS, and test code are concrete.

**Type consistency:** `icon(name, cls)` signature is used identically everywhere. `renderAdminSidebarNav` (Task 2) replaces `renderAdminSectionTabs` consistently, including the Task 7 grep that verifies no stragglers. `selectAdminOrg`/`adminUI.selectedOrgId` (Task 6) match between console-state and orgs-render. `adminUI.lastLoadedAt` set in `loadAdminView` and read in `renderAdminSection` (Task 2). Data hooks (`data-admin-section`, `data-attention-*`, `data-view-org`, `data-create-org-admin`, `data-new-org-admin`, `data-repair-ancestry`, `data-org-select`) are consistent with the delegated handlers.
