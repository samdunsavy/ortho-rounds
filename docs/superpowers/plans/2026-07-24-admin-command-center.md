# Admin Command Center UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-column admin console with a desktop-first master-detail command center that drives the previously UI-less structural operations (rename / move / delete-empty) and unifies all user management into one surface.

**Architecture:** Extract the console from the ~374 KB `public/app.js` into a new plain-script `public/admin-console.js` (same pattern as `milestones.js`), then build a two-pane layout inside the existing `#adminView`: a tree navigator rail plus a context detail panel. State is one client-side model loaded from `GET /api/admin/org` + `GET /api/admin/users`; after any mutation the model is re-fetched and re-rendered with the selection restored — no optimistic updates, so the UI can never disagree with the server about ancestry.

**Tech Stack:** Vanilla ES5-style browser JS (plain `<script>`, no bundler, no deps), existing CSS custom properties, `node:test` + jsdom via `tests/helpers/frontend-env.js`.

## Global Constraints

- **UI-only.** No new backend routes. Consume the shipped Spec-1 routes exactly as they are. If a gap is found, report it — do not add server code.
- **Flag off → byte-identical.** With `MULTI_TENANT` off the console stays unreachable exactly as today; `npm test` and `tests/server-sync-golden.test.js` green.
- **Server-authoritative ancestry.** Never compute or cache ancestry client-side. After any mutation: re-fetch, re-render, restore selection.
- **No new dependencies.** Existing design tokens only (`var(--paper)`, `var(--card)`, `var(--line)`, `var(--ink)`, `var(--ink-soft)`, `var(--accent)`), AA contrast.
- **Node types:** `org, hospital, department, unit, ward`. Tree shape: `hospitals[].departments[].units[].wards[]`. Assignment option values encode `"type:id"` and split on the FIRST `:`.
- **Backend routes consumed (verbatim):** `GET /api/admin/org`, `GET /api/admin/users`, `GET /api/admin/orgs`, `POST /api/admin/hospitals {name}`, `POST /api/admin/departments {hospitalId,name}`, `POST /api/admin/units {departmentId,name}`, `POST /api/admin/wards {unitId,name}`, `PATCH /api/admin/nodes/:type/:id {name}`, `DELETE /api/admin/nodes/:type/:id`, `POST /api/admin/nodes/:type/:id/move {newParentId}`, `POST /api/admin/users/:id/assign {nodeType,nodeId}`, `POST /api/admin/users/assign-bulk {userIds,nodeType,nodeId}`, `POST /api/admin/users {username,role}`, `POST /api/admin/users/:id/disable`, `POST /api/admin/users/:id/enable`, `POST /api/admin/users/:id/reset-password`.
- **Helpers available globally from `app.js`** (call at runtime, do not redefine): `api(path, opts)`, `showToast(msg)`, `escapeHTML(s)`, `formatRelativeTime(ts)`, `isAdmin()`, `adminUiVisible()`, `isInstanceAdminUser()`.
- Run the frontend suites plus `npm test` at each task's final step. Run the suite in the FOREGROUND of a single bash call (backgrounded runs get killed in this sandbox); shard with explicit file lists if it exceeds the timeout.

---

### Task 1: Extract the console into `public/admin-console.js` (no behavior change)

**Files:**
- Create: `public/admin-console.js`
- Modify: `public/app.js` (remove the extracted functions), `public/index.html` (add the script tag), `tests/helpers/frontend-env.js` (load the new file)
- Test: `tests/frontend-admin-view.test.js` (unchanged assertions must still pass)

**Interfaces:**
- Produces (global function declarations, unchanged names so existing tests keep passing): `renderAdminStatTiles(tree)`, `renderAdminStatusBar(byStatus,total)`, `renderAdminUnitRowHTML(u)`, `renderAdminOrgSectionHTML(tree)`, `buildAssignNodeGroups(tree)`, `renderAssignSelectOptionsHTML(groups,selType,selId)`, `renderAdminUsersSectionHTML(tree,users)`, `renderAdminView(tree,users)`, `renderAdminOrgsTab(orgs)`, `loadAdminView()`, `switchAdminTab(tab)`, `openAdminView()`, `closeAdminView()`.
- `app.js` keeps `adminUiVisible()`, `isInstanceAdminUser()`, `isAdmin()` and the button wiring that calls `openAdminView()`.

- [ ] **Step 1: Add the script tag.** In `public/index.html`, immediately before the existing `<script src="app.js"></script>` line, add:

```html
<script src="admin-console.js"></script>
```

(Plain script, not a module — function declarations must land on the global scope so `app.js` can call them, exactly like `milestones.js`.)

- [ ] **Step 2: Teach the test harness to load it.** In `tests/helpers/frontend-env.js`, after the `milestonesJs` read and before the `app.js` eval, add the file and eval it in the same order as the browser:

```javascript
  const adminConsoleJs = readFileSync(path.join(PUBLIC_DIR, 'admin-console.js'), 'utf8');
  window.eval(milestonesJs);
  window.eval(adminConsoleJs);
  window.eval(initScript ? `${appJs}\n${initScript}` : appJs);
```

(Replace the existing two-line eval block with these three evals.)

- [ ] **Step 3: Move the code.** Cut the functions listed in **Interfaces → Produces** out of `public/app.js` and paste them into `public/admin-console.js`, plus the module-level `let adminViewOrgId = null;` and the delegated `document.getElementById('adminView')?.addEventListener('change', …)` assignment handler. Add this header comment at the top of the new file:

```javascript
/* Admin command center — the MULTI_TENANT org/user management console.
   Split out of app.js (which is ~374 KB) because this is a self-contained
   surface. Plain script, not a module: its function declarations must be
   global so app.js's button handlers can call openAdminView(). Runtime
   helpers (api, showToast, escapeHTML, formatRelativeTime) come from
   app.js — they're only *called* here, never at load time, so script
   order doesn't matter. */
```

Do NOT change any logic in this task — it is a pure move.

- [ ] **Step 4: Verify nothing broke.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-view.test.js tests/frontend-unit-picker.test.js`
Expected: PASS with the assertions unchanged (proving the move was behavior-neutral).

- [ ] **Step 5: Full suite + commit.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && npm test`
Expected: PASS.

```bash
git add public/admin-console.js public/app.js public/index.html tests/helpers/frontend-env.js
git commit -m "refactor: extract admin console into public/admin-console.js"
```

---

### Task 2: Command-center shell — two panes, tree navigator, selection

**Files:**
- Modify: `public/index.html` (replace the `#adminOrgPane` markup, add CSS), `public/admin-console.js`
- Test: `tests/frontend-admin-console.test.js` (new)

**Interfaces:**
- Consumes: the tree from `GET /api/admin/org` (`hospitals[].departments[].units[].wards[]`).
- Produces: `adminState` (module-level `{ tree, users, orgs, selection }` where `selection = {type, id} | {type:'users'} | {type:'orgs'}`); `renderAdminTreeHTML(tree, selection)`; `selectAdminNode(type, id)`; `findAdminNode(tree, type, id) → {node, parentType, parentId} | null`.

- [ ] **Step 1: Write the failing test.** Create `tests/frontend-admin-console.test.js`:

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

export const TREE = {
  totals: { hospitals: 1, departments: 1, units: 2, wards: 1, usersActive: 2, usersDisabled: 0, livePatients: 5 },
  hospitals: [{ id: 'h1', name: 'City Hospital', departments: [
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

describe('command center tree', () => {
  test('renders a row per node with live counts', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminTreeHTML(TREE, null);
    assert.ok(html.includes('data-node="hospital:h1"'));
    assert.ok(html.includes('data-node="department:d1"'));
    assert.ok(html.includes('data-node="unit:u1"'));
    assert.ok(html.includes('data-node="ward:w1"'));
    assert.ok(html.includes('data-node="users"'));
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
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js`
Expected: FAIL — `window.renderAdminTreeHTML is not a function`.

- [ ] **Step 3: Replace the pane markup.** In `public/index.html`, replace the `<div id="adminOrgPane">…</div>` block with:

```html
  <div id="adminOrgPane" class="admin-cc">
    <aside class="admin-cc-rail" id="adminTreeRail"></aside>
    <section class="admin-cc-detail" id="adminDetailPane"></section>
  </div>
```

- [ ] **Step 4: Add the CSS.** In `public/index.html`, after the existing `.admin-org-card` rule, add:

```css
  .admin-cc{display:block;}
  .admin-cc-rail{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px;margin-bottom:12px;}
  .admin-cc-detail{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;}
  .admin-cc-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:0;color:var(--ink);padding:6px 8px;border-radius:8px;cursor:pointer;font:inherit;}
  .admin-cc-row:hover{background:var(--accent-soft);}
  .admin-cc-row.is-selected{background:var(--accent-soft);font-weight:700;}
  .admin-cc-row .cc-count{margin-left:auto;font-size:12px;color:var(--ink-soft);}
  .admin-cc-row[data-depth="1"]{padding-left:20px;}
  .admin-cc-row[data-depth="2"]{padding-left:34px;}
  .admin-cc-row[data-depth="3"]{padding-left:48px;}
  .admin-cc-sep{height:1px;background:var(--line);margin:8px 4px;}
  @media (min-width:900px){
    .admin-cc{display:grid;grid-template-columns:280px 1fr;gap:12px;align-items:start;}
    .admin-cc-rail{margin-bottom:0;max-height:calc(100vh - 140px);overflow-y:auto;}
  }
```

- [ ] **Step 5: Implement in `public/admin-console.js`.** Add near the top (after the header comment):

```javascript
let adminState = { tree: null, users: [], orgs: [], selection: null };

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
  return `<button type="button" class="admin-cc-row${sel}" data-depth="${depth}" data-node="${escapeHTML(type)}:${escapeHTML(id)}">${escapeHTML(label)}${c}</button>`;
}

function renderAdminTreeHTML(tree, selection){
  let out = '';
  const usersSel = selection && selection.type === 'users' ? ' is-selected' : '';
  out += `<button type="button" class="admin-cc-row${usersSel}" data-depth="0" data-node="users">Users</button>`;
  if(isInstanceAdminUser()){
    const orgsSel = selection && selection.type === 'orgs' ? ' is-selected' : '';
    out += `<button type="button" class="admin-cc-row${orgsSel}" data-depth="0" data-node="orgs">Organizations</button>`;
  }
  out += '<div class="admin-cc-sep"></div>';
  for(const h of (tree && tree.hospitals) || []){
    out += ccRowHTML('hospital', h.id, h.name, null, 0, selection);
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
  adminState.selection = id ? { type, id } : { type };
  renderAdminCommandCenter();
}

function renderAdminCommandCenter(){
  const rail = document.getElementById('adminTreeRail');
  if(rail) rail.innerHTML = renderAdminTreeHTML(adminState.tree, adminState.selection);
  const detail = document.getElementById('adminDetailPane');
  if(detail) detail.innerHTML = renderAdminDetailHTML(adminState);
}
```

Add a delegated click handler at module scope (next to the existing assignment `change` handler):

```javascript
document.getElementById('adminView')?.addEventListener('click', (e) => {
  const row = e.target.closest('[data-node]');
  if(!row) return;
  const raw = row.dataset.node;
  const i = raw.indexOf(':');
  if(i === -1) selectAdminNode(raw, null);
  else selectAdminNode(raw.slice(0, i), raw.slice(i + 1));
});
```

Rewrite `loadAdminView()` to populate `adminState` and render the command center, keeping the existing instance-admin org-list behavior:

```javascript
async function loadAdminView(){
  const qs = isInstanceAdminUser() && adminViewOrgId ? `?orgId=${encodeURIComponent(adminViewOrgId)}` : '';
  if(isInstanceAdminUser() && !adminViewOrgId){
    document.getElementById('adminTabs').style.display = '';
    switchAdminTab('orgs');
    adminState.orgs = (await api('/api/admin/orgs')).orgs;
    renderAdminOrgsTab(adminState.orgs);
    return;
  }
  const [tree, usersRes] = await Promise.all([api('/api/admin/org' + qs), api('/api/admin/users')]);
  adminState.tree = tree;
  adminState.users = isInstanceAdminUser() && adminViewOrgId
    ? usersRes.users.filter(u => u.orgId === adminViewOrgId)
    : usersRes.users;
  if(!adminState.selection) adminState.selection = { type: 'users' };
  renderAdminStatTilesInto(tree);
  renderAdminCommandCenter();
}

function renderAdminStatTilesInto(tree){
  const el = document.getElementById('adminStatTiles');
  if(el) el.innerHTML = renderAdminStatTiles(tree);
}
```

Add a placeholder detail renderer so the file loads (Task 3 fills it in):

```javascript
function renderAdminDetailHTML(state){
  if(!state.selection) return '';
  return `<div class="small-muted">${escapeHTML(state.selection.type)}</div>`;
}
```

Delete the now-unused `renderAdminOrgSectionHTML`, `renderAdminUnitRowHTML`, and `renderAdminUsersSectionHTML` call sites from `renderAdminView`, and delete `renderAdminView` itself (the command center replaces it). Keep `renderAdminOrgsTab` and `switchAdminTab` as they are.

- [ ] **Step 6: Run tests.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js`
Expected: PASS.

- [ ] **Step 7: Update the old suite.** `tests/frontend-admin-view.test.js` asserts against the deleted single-column renderers. Port each still-relevant assertion to the new command-center functions (tree rows instead of dept cards; the Task-5 users view will cover the rest) and delete assertions for renderers that no longer exist. Do not weaken coverage — every deleted assertion must have an equivalent in `tests/frontend-admin-console.test.js` or be genuinely obsolete; note which in the commit body.

- [ ] **Step 8: Full suite + commit.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && npm test`
Expected: PASS.

```bash
git add public/index.html public/admin-console.js tests/
git commit -m "feat: command center shell — tree navigator + selection"
```

---

### Task 3: Detail panel — header, stats, children, add-child

**Files:**
- Modify: `public/admin-console.js`, `public/index.html` (CSS only)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `adminState`, `findAdminNode`, `renderAdminStatusBar(byStatus,total)`.
- Produces: `renderAdminDetailHTML(state)` (real implementation); `childTypeOf(type)` → `'department'|'unit'|'ward'|null`; `addChildRouteFor(type)` → `{path, parentKey}`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/frontend-admin-console.test.js`:

```javascript
describe('detail panel', () => {
  test('unit detail shows name, stats and its wards', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'unit', id: 'u1' } });
    assert.ok(html.includes('IV'));
    assert.ok(html.includes('4 live patient'));
    assert.ok(html.includes('7MOW'));
    assert.ok(html.includes('data-add-child="unit:u1"'));
  });
  test('department detail lists its units and offers add-unit', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'department', id: 'd1' } });
    assert.ok(html.includes('IV'));
    assert.ok(html.includes('General'));
    assert.ok(html.includes('data-add-child="department:d1"'));
  });
  test('ward detail has no add-child control', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminDetailHTML({ tree: TREE, users: [], orgs: [], selection: { type: 'ward', id: 'w1' } });
    assert.ok(!html.includes('data-add-child='));
  });
  test('childTypeOf maps the hierarchy', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.childTypeOf('hospital'), 'department');
    assert.equal(window.childTypeOf('department'), 'unit');
    assert.equal(window.childTypeOf('unit'), 'ward');
    assert.equal(window.childTypeOf('ward'), null);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.** Replace the placeholder `renderAdminDetailHTML` in `public/admin-console.js` with:

```javascript
function childTypeOf(type){
  return { hospital: 'department', department: 'unit', unit: 'ward' }[type] || null;
}

function addChildRouteFor(type){
  return {
    hospital: { path: '/api/admin/departments', parentKey: 'hospitalId' },
    department: { path: '/api/admin/units', parentKey: 'departmentId' },
    unit: { path: '/api/admin/wards', parentKey: 'unitId' }
  }[type] || null;
}

function childListOf(type, node){
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
  if(!sel) return '';
  if(sel.type === 'users') return renderAdminUsersPanelHTML(state);
  if(sel.type === 'orgs') return '';
  const hit = findAdminNode(state.tree, sel.type, sel.id);
  if(!hit) return `<div class="small-muted">That item no longer exists — reloading.</div>`;
  const { node } = hit;
  const kids = childListOf(sel.type, node);
  const childType = childTypeOf(sel.type);
  const kidsHTML = kids.length
    ? kids.map(k => `<button type="button" class="admin-cc-row" data-node="${escapeHTML(childType)}:${escapeHTML(k.id)}">${escapeHTML(k.name)}<span class="cc-count">${k.stats ? k.stats.livePatients : ''}</span></button>`).join('')
    : `<div class="small-muted">No ${childType || 'children'}s yet.</div>`;
  const addChild = childType ? `
    <div class="admin-inline-form">
      <input placeholder="New ${escapeHTML(childType)} name" data-new-child-name="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">
      <button class="btn" data-add-child="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">Add ${escapeHTML(childType)}</button>
    </div>` : '';
  return `
    <div class="admin-detail-head">
      <h3>${escapeHTML(node.name)}</h3>
      <span class="spec-badge">${escapeHTML(sel.type)}</span>
      ${renderAdminNodeActionsHTML(state, sel, hit)}
    </div>
    ${nodeStatsHTML(node)}
    <h4>${childType ? childType[0].toUpperCase() + childType.slice(1) + 's' : 'Contents'}</h4>
    <div class="admin-cc-children">${kidsHTML}</div>
    ${addChild}`;
}

function renderAdminNodeActionsHTML(){ return ''; } // Task 4 replaces this
function renderAdminUsersPanelHTML(){ return ''; }  // Task 5 replaces this
```

Add the add-child click handler inside the existing delegated `click` listener, **before** the `[data-node]` branch (so the button doesn't also trigger selection):

```javascript
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
    api(route.path, { method: 'POST', body: JSON.stringify({ [route.parentKey]: parentId, name }) })
      .then(() => loadAdminView())
      .catch(err => showToast(err.message));
    return;
  }
```

Add CSS in `public/index.html` after the `.admin-cc-sep` rule:

```css
  .admin-detail-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
  .admin-detail-head h3{margin:0;}
  .admin-cc-children{display:flex;flex-direction:column;gap:2px;margin-bottom:8px;}
```

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add public/admin-console.js public/index.html tests/frontend-admin-console.test.js
git commit -m "feat: command center detail panel with stats, children and add-child"
```

---

### Task 4: Structural actions — rename, move, delete

**Files:**
- Modify: `public/admin-console.js`, `public/index.html` (CSS only)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `adminState`, `findAdminNode`, `childTypeOf`.
- Produces: `renderAdminNodeActionsHTML(state, sel, hit)` (real implementation); `validMoveParents(tree, type, currentParentId)` → array of `{id, name}`; `deleteBlockedReason(node, type)` → string or `''`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/frontend-admin-console.test.js`:

```javascript
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
    assert.deepEqual(parents.map(p => p.id), []); // only one department exists
    const wardParents = window.validMoveParents(TREE, 'ward', 'u1');
    assert.deepEqual(wardParents.map(p => p.id), ['u2']);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.** Replace the `renderAdminNodeActionsHTML` stub in `public/admin-console.js` with:

```javascript
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

/** Client-side preview of the server's delete-empty rule. The server is
    authoritative (409 blockedBy); this just avoids offering a click that
    can only fail. */
function deleteBlockedReason(node, type){
  const bits = [];
  const kids = childListOf(type, node).length;
  if(kids) bits.push(`${kids} ${childTypeOf(type)}${kids === 1 ? '' : 's'}`);
  if(node.stats && node.stats.livePatients) bits.push(`${node.stats.livePatients} patient${node.stats.livePatients === 1 ? '' : 's'}`);
  if(node.stats && node.stats.users) bits.push(`${node.stats.users} user${node.stats.users === 1 ? '' : 's'}`);
  return bits.join(', ');
}

function renderAdminNodeActionsHTML(state, sel, hit){
  const key = `${sel.type}:${sel.id}`;
  const blocked = deleteBlockedReason(hit.node, sel.type);
  const parents = validMoveParents(state.tree, sel.type, hit.parentId);
  const moveHTML = MOVE_PARENT_TYPE[sel.type] && parents.length ? `
    <select data-move-node="${escapeHTML(key)}">
      <option value="">Move to…</option>
      ${parents.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}
    </select>` : '';
  return `
    <span class="admin-node-actions">
      <button class="btn" data-rename-node="${escapeHTML(key)}">Rename</button>
      ${moveHTML}
      <button class="btn" data-delete-node="${escapeHTML(key)}"${blocked ? ' disabled' : ''} title="${blocked ? 'Can\\'t delete — ' + escapeHTML(blocked) : 'Delete'}">${blocked ? 'Can\\'t delete — ' + escapeHTML(blocked) : 'Delete'}</button>
    </span>`;
}
```

Add the handlers inside the delegated `click` listener (before the `[data-node]` branch), plus a `change` handler for move:

```javascript
  const renameBtn = e.target.closest('[data-rename-node]');
  if(renameBtn){
    e.stopPropagation();
    const raw = renameBtn.dataset.renameNode;
    const i = raw.indexOf(':');
    const type = raw.slice(0, i), id = raw.slice(i + 1);
    const hit = findAdminNode(adminState.tree, type, id);
    const next = window.prompt('New name', hit ? hit.node.name : '');
    if(next === null) return;
    const name = next.trim();
    if(!name || name.length > 80){ showToast('Name required (max 80 chars)'); return; }
    api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) })
      .then(() => loadAdminView())
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
    if(!window.confirm(`Delete this ${type}? This cannot be undone.`)) return;
    api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(() => { adminState.selection = { type: 'users' }; return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
```

In the existing delegated `change` listener, add before the assignment branch:

```javascript
  const moveSel = e.target.closest('[data-move-node]');
  if(moveSel){
    const newParentId = moveSel.value;
    if(!newParentId) return;
    const raw = moveSel.dataset.moveNode;
    const i = raw.indexOf(':');
    const type = raw.slice(0, i), id = raw.slice(i + 1);
    api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify({ newParentId }) })
      .then(() => loadAdminView())
      .catch(err => { showToast(err.message); loadAdminView(); });
    return;
  }
```

Add CSS after `.admin-cc-children`:

```css
  .admin-node-actions{display:flex;gap:6px;align-items:center;margin-left:auto;flex-wrap:wrap;}
  .admin-node-actions .btn[disabled]{opacity:.55;cursor:not-allowed;}
```

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add public/admin-console.js public/index.html tests/frontend-admin-console.test.js
git commit -m "feat: rename, move and delete-empty controls in the detail panel"
```

---

### Task 5: Users panel — table, search, assignment picker with Org level

**Files:**
- Modify: `public/admin-console.js`, `public/index.html` (CSS only)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `adminState`, `buildAssignNodeGroups(tree)`.
- Produces: `renderAdminUsersPanelHTML(state)` (real implementation); `buildAssignNodeGroups` extended to include an `org` group; `assignLabelFor(groups, type, id)` → display string, returning `Stale (type:id)` when the node is absent.

- [ ] **Step 1: Write the failing tests.** Append to `tests/frontend-admin-console.test.js`:

```javascript
const CC_USERS = [
  { id: 'usr1', username: 'xavier', role: 'admin', active: true, orgId: null, assignmentType: null, assignmentId: null },
  { id: 'usr2', username: 'Amit', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'org', assignmentId: 'bfv2-org' },
  { id: 'usr3', username: 'ghost', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'unit', assignmentId: 'gone-unit' }
];

describe('users panel', () => {
  test('assignment picker includes an Organizations group', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }], selection: { type: 'users' } });
    assert.ok(html.includes('<optgroup label="Organizations"'));
    assert.ok(html.includes('value="org:bfv2-org"'));
  });
  test('an org-assigned user is preselected, not shown as none', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }], selection: { type: 'users' } });
    assert.match(html, /value="org:bfv2-org"\s+selected/);
  });
  test('a stale assignment is shown explicitly', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [], selection: { type: 'users' } });
    assert.ok(html.includes('Stale (unit:gone-unit)'));
  });
  test('rows carry a search key and a checkbox', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [], selection: { type: 'users' } });
    assert.ok(html.includes('data-user-row="usr2"'));
    assert.ok(html.includes('data-user-check="usr2"'));
    assert.ok(html.includes('id="adminUserSearch"'));
  });
});
```

- [ ] **Step 2: Run, verify fail.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `public/admin-console.js`, extend `buildAssignNodeGroups` to add the org level (it currently starts at hospital) and add the users panel:

```javascript
function buildAssignNodeGroups(tree, orgs){
  const groups = { org: [], hospital: [], department: [], unit: [], ward: [] };
  for(const o of orgs || []) groups.org.push({ id: o.id, label: o.name });
  for(const h of (tree && tree.hospitals) || []){
    groups.hospital.push({ id: h.id, label: h.name });
    for(const dep of h.departments || []){
      groups.department.push({ id: dep.id, label: `${dep.name} (${h.name})` });
      for(const u of dep.units || []){
        groups.unit.push({ id: u.id, label: `${u.name} (${dep.name})` });
        for(const w of u.wards || []) groups.ward.push({ id: w.id, label: `${w.name} (${u.name})` });
      }
    }
  }
  return groups;
}

function assignLabelFor(groups, type, id){
  if(!type || !id) return '';
  const list = groups[type] || [];
  const hit = list.find(x => x.id === id);
  return hit ? hit.label : `Stale (${type}:${id})`;
}

function renderAssignSelectOptionsHTML(groups, selType, selId){
  const optgroup = (label, type, items) => items.length ? `<optgroup label="${escapeHTML(label)}">${items.map(it =>
    `<option value="${type}:${escapeHTML(it.id)}"${type === selType && it.id === selId ? ' selected' : ''}>${escapeHTML(it.label)}</option>`
  ).join('')}</optgroup>` : '';
  const known = (groups[selType] || []).some(x => x.id === selId);
  const stale = selType && selId && !known
    ? `<option value="${escapeHTML(selType)}:${escapeHTML(selId)}" selected>Stale (${escapeHTML(selType)}:${escapeHTML(selId)})</option>`
    : '';
  return `<option value="">— none —</option>` + stale +
    optgroup('Organizations', 'org', groups.org) +
    optgroup('Hospitals', 'hospital', groups.hospital) +
    optgroup('Departments', 'department', groups.department) +
    optgroup('Units', 'unit', groups.unit) +
    optgroup('Wards', 'ward', groups.ward);
}

function renderAdminUsersPanelHTML(state){
  const groups = buildAssignNodeGroups(state.tree, state.orgs);
  const rows = (state.users || []).map(u => {
    const selType = u.assignmentType || null, selId = u.assignmentId || null;
    const prev = selType && selId ? `${selType}:${selId}` : '';
    return `
      <tr data-user-row="${escapeHTML(u.id)}" data-username="${escapeHTML((u.username || '').toLowerCase())}">
        <td><input type="checkbox" data-user-check="${escapeHTML(u.id)}"></td>
        <td>${escapeHTML(u.username)}</td>
        <td>${u.role === 'admin' ? '<span class="spec-badge">admin</span>' : 'member'}</td>
        <td><select data-assign-user="${escapeHTML(u.id)}" data-prev="${escapeHTML(prev)}">${renderAssignSelectOptionsHTML(groups, selType, selId)}</select></td>
        <td>${u.active ? 'active' : 'disabled'}</td>
      </tr>`;
  }).join('');
  return `
    <div class="admin-detail-head"><h3>Users</h3></div>
    <div class="admin-inline-form">
      <input id="adminUserSearch" placeholder="Search users…">
    </div>
    <div id="adminBulkBar" class="admin-bulk-bar" hidden></div>
    <table class="admin-users-table">
      <thead><tr><th></th><th>User</th><th>Role</th><th>Assignment</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
```

Wire search with an `input` listener at module scope:

```javascript
document.getElementById('adminView')?.addEventListener('input', (e) => {
  if(e.target.id !== 'adminUserSearch') return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('[data-user-row]').forEach(tr => {
    tr.style.display = !q || tr.dataset.username.includes(q) ? '' : 'none';
  });
});
```

Add CSS:

```css
  .admin-bulk-bar{display:flex;gap:8px;align-items:center;background:var(--accent-soft);border-radius:8px;padding:8px;margin-bottom:8px;}
  .admin-bulk-bar[hidden]{display:none;}
```

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add public/admin-console.js public/index.html tests/frontend-admin-console.test.js
git commit -m "feat: users panel with search, org-level assignment and stale-assignment display"
```

---

### Task 6: Bulk assign

**Files:**
- Modify: `public/admin-console.js`
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `adminState`, `buildAssignNodeGroups`, `renderAssignSelectOptionsHTML`.
- Produces: `refreshAdminBulkBar()`; `selectedAdminUserIds()` → array of user ids.

- [ ] **Step 1: Write the failing test.** Append:

```javascript
describe('bulk assign', () => {
  test('checking rows reveals the bulk bar and posts assign-bulk', async () => {
    const { window } = loadFrontendEnv();
    const calls = [];
    window.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
    document.getElementById; // jsdom document is window.document
    const pane = window.document.getElementById('adminDetailPane');
    pane.innerHTML = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [{ id: 'bfv2-org', name: 'Default' }], selection: { type: 'users' } });
    const cb = window.document.querySelector('[data-user-check="usr2"]');
    cb.checked = true;
    cb.dispatchEvent(new window.Event('change', { bubbles: true }));
    const bar = window.document.getElementById('adminBulkBar');
    assert.equal(bar.hasAttribute('hidden'), false);
    assert.ok(bar.innerHTML.includes('1 selected'));
    assert.deepEqual(window.selectedAdminUserIds(), ['usr2']);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add to `public/admin-console.js`:

```javascript
function selectedAdminUserIds(){
  return Array.from(document.querySelectorAll('[data-user-check]'))
    .filter(cb => cb.checked)
    .map(cb => cb.dataset.userCheck);
}

function refreshAdminBulkBar(){
  const bar = document.getElementById('adminBulkBar');
  if(!bar) return;
  const ids = selectedAdminUserIds();
  if(!ids.length){ bar.hidden = true; bar.innerHTML = ''; return; }
  const groups = buildAssignNodeGroups(adminState.tree, adminState.orgs);
  bar.hidden = false;
  bar.innerHTML = `<strong>${ids.length} selected</strong>
    <select id="adminBulkNode">${renderAssignSelectOptionsHTML(groups, null, null)}</select>
    <button class="btn" id="adminBulkApply">Assign</button>`;
}
```

Extend the module-scope `change` listener (before the single-assign branch):

```javascript
  if(e.target.matches('[data-user-check]')){ refreshAdminBulkBar(); return; }
```

Extend the `click` listener (before the `[data-node]` branch):

```javascript
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
```

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add public/admin-console.js tests/frontend-admin-console.test.js
git commit -m "feat: bulk user assignment from the users panel"
```

---

### Task 7: Absorb user lifecycle — create / disable / enable / reset, delete the legacy modal

**Files:**
- Modify: `public/admin-console.js`, `public/app.js` (delete the legacy modal handlers), `public/index.html` (delete the legacy modal markup, add CSS)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `adminState`.
- Produces: user rows gain `data-user-toggle="<id>"` (disable/enable) and `data-user-reset="<id>"` buttons; a create-user form with `id="adminNewUsername"`, `id="adminNewUserAdmin"` (checkbox), `id="adminCreateUser"` (button).

- [ ] **Step 1: Write the failing tests.** Append:

```javascript
describe('user lifecycle', () => {
  test('rows expose toggle and reset controls; create form present', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users: CC_USERS, orgs: [], selection: { type: 'users' } });
    assert.ok(html.includes('data-user-toggle="usr2"'));
    assert.ok(html.includes('data-user-reset="usr2"'));
    assert.ok(html.includes('id="adminCreateUser"'));
    assert.ok(html.includes('id="adminNewUsername"'));
  });
  test('a disabled user offers Enable', () => {
    const { window } = loadFrontendEnv();
    const users = [{ id: 'u9', username: 'off', role: 'member', active: false, orgId: null, assignmentType: null, assignmentId: null }];
    const html = window.renderAdminUsersPanelHTML({ tree: TREE, users, orgs: [], selection: { type: 'users' } });
    assert.match(html, /data-user-toggle="u9"[^>]*>Enable</);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `renderAdminUsersPanelHTML`, change the status cell to include the action buttons:

```javascript
        <td>${u.active ? 'active' : 'disabled'}
          <button class="btn" data-user-toggle="${escapeHTML(u.id)}">${u.active ? 'Disable' : 'Enable'}</button>
          <button class="btn" data-user-reset="${escapeHTML(u.id)}">Reset password</button>
        </td>`;
```

and insert the create form immediately after the search input div:

```javascript
    <div class="admin-inline-form">
      <input id="adminNewUsername" placeholder="New username">
      <label class="scribe-check"><input type="checkbox" id="adminNewUserAdmin"> Admin</label>
      <button class="btn" id="adminCreateUser">Create user</button>
    </div>
```

Add the handlers to the delegated `click` listener (before the `[data-node]` branch):

```javascript
  const toggleBtn = e.target.closest('[data-user-toggle]');
  if(toggleBtn){
    e.stopPropagation();
    const id = toggleBtn.dataset.userToggle;
    const user = (adminState.users || []).find(u => u.id === id);
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
    api('/api/admin/users', { method: 'POST', body: JSON.stringify({ username, role }) })
      .then(res => { window.alert(`User created. Temporary password (shown once): ${res.temporaryPassword}`); nameEl.value = ''; return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
```

Then remove the legacy surface: delete the "Manage Users" modal markup from `public/index.html` (the `<!-- ACCOUNT / MANAGE USERS (admin only) -->` block) and, from `public/app.js`, delete `createUserFromModal()` and the disable/enable/reset helpers plus the `moreManageUsersBtn` / `desktopManageUsersBtn` handlers and their buttons. Grep to confirm nothing else references them: `grep -n "createUserFromModal\|moreManageUsersBtn\|desktopManageUsersBtn" public/*.js public/index.html` must return nothing.

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js && npm test`
Expected: PASS. If a suite asserted on the deleted modal, port the assertion to the new panel rather than deleting it.

- [ ] **Step 5: Commit.**

```bash
git add public/admin-console.js public/app.js public/index.html tests/
git commit -m "feat: user lifecycle in the console; remove legacy Manage Users modal"
```

---

### Task 8: Mobile read-only + flag-off guard

**Files:**
- Modify: `public/admin-console.js`, `public/index.html` (CSS)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `adminState`.
- Produces: `adminIsNarrow()` → boolean (true when `window.innerWidth < 900`); rendering suppresses editing controls when narrow.

- [ ] **Step 1: Write the failing tests.** Append:

```javascript
describe('mobile read-only', () => {
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
```

- [ ] **Step 2: Run, verify fail.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add to `public/admin-console.js`:

```javascript
function adminIsNarrow(){
  return typeof window !== 'undefined' && window.innerWidth < 900;
}
```

In `renderAdminNodeActionsHTML`, return the read-only note when narrow — insert as the first line of the function body:

```javascript
  if(adminIsNarrow()) return '<span class="small-muted">Open on a larger screen to edit</span>';
```

In `renderAdminDetailHTML`, suppress the add-child form when narrow — change the `addChild` assignment to:

```javascript
  const addChild = (childType && !adminIsNarrow()) ? `
    <div class="admin-inline-form">
      <input placeholder="New ${escapeHTML(childType)} name" data-new-child-name="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">
      <button class="btn" data-add-child="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">Add ${escapeHTML(childType)}</button>
    </div>` : '';
```

In `renderAdminUsersPanelHTML`, wrap the create-user form and the per-row action buttons in the same `!adminIsNarrow()` condition, and render the read-only note once above the table when narrow.

- [ ] **Step 4: Run tests, verify pass; full suite.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/frontend-admin-console.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Verify flag-off is untouched.**

Run: `cd /sessions/quirky-sweet-einstein/mnt/ortho-rounds && node --test tests/server-sync-golden.test.js`
Expected: PASS (the console is client-side only; this confirms no server behavior drifted).

- [ ] **Step 6: Commit.**

```bash
git add public/admin-console.js public/index.html tests/frontend-admin-console.test.js
git commit -m "feat: mobile read-only command center"
```

---

## Self-Review

**Spec coverage:** §1 file structure → Task 1; §2 layout (rail/detail/selection) → Tasks 2-3, mobile → Task 8; §2 structural actions (rename/move/delete + blockedBy) → Task 4; §3 users view (search, picker with Org level, stale display) → Task 5, bulk → Task 6, lifecycle + legacy modal removal → Task 7; §4 data flow (re-fetch + restore selection) → Task 2's `loadAdminView` and every mutation handler; §5 error handling → Tasks 3-7 (`showToast` on failure, disabled delete with reason, confirms on destructive ops, forms keep input); §6 testing → each task is TDD + Task 8's golden check. No gaps.

**Placeholder scan:** every code step carries complete code. Task 2 Step 7 and Task 7's legacy-removal step are judgment steps (porting/removing existing assertions) — both name the exact files, the grep to prove completion, and forbid weakening coverage, rather than leaving "update tests" vague.

**Type consistency:** `adminState = {tree, users, orgs, selection}` is defined in Task 2 and consumed unchanged in Tasks 3-8. `findAdminNode` returns `{node, parentType, parentId}` (Task 2), used by Task 4's `validMoveParents(tree, type, hit.parentId)`. `childTypeOf`/`childListOf`/`addChildRouteFor` defined in Task 3, reused by Task 4's `deleteBlockedReason`. `buildAssignNodeGroups(tree, orgs)` gains its second parameter in Task 5 and is called with both args in Task 6. `renderAdminNodeActionsHTML` and `renderAdminUsersPanelHTML` are stubbed in Task 3 and replaced in Tasks 4 and 5 respectively — the stub signatures match their final ones. Option values are `"type:id"` split on the first `:` in every handler.
