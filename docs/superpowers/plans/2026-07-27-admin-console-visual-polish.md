# Admin Console Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Quietly restyle the admin console so it matches Ortho Rounds chrome, and show a soft “Updating…” busy state on every `loadAdminView()` (first open and full reloads).

**Architecture:** Keep Plan 2’s four-section shell and behavior. Add `adminUI.busy` plus `setAdminBusy(on)` in `public/admin-console.js`, toggled only inside `loadAdminView()` and cooperating with the existing `adminLoadSeq` stale-completion guard. Visual refresh is CSS (+ tiny markup hooks) in `public/index.html` using existing tokens and the existing `@keyframes spin` animation — no new modules, dependencies, or colour literals.

**Tech Stack:** Vanilla JS (classic scripts), `node:test` + jsdom frontend harness (`tests/helpers/frontend-env.js`), CSS custom properties already defined for light/dark in `public/index.html`.

**Source spec:** `docs/superpowers/specs/2026-07-27-admin-console-visual-polish-design.md`.

## Global Constraints

- **Frontend-only.** Touch `public/index.html` and `public/admin-console.js`. Section files (`admin-people.js` / `admin-structure.js` / `admin-orgs.js`) only if a class hook is required for styling.
- **No new dependencies.** Nothing may be added to `package.json`.
- **Existing design tokens only** — `--paper`, `--card`, `--line`, `--ink`, `--ink-soft`, `--accent`, `--accent-soft`, `--shadow-sm` / `--shadow-md`, `--radius` / `--radius-sm`, `--font-sans`, `--mono`, status colours, and their dark-mode definitions. No new hex/rgb colour literals in admin CSS.
- **Reuse existing `@keyframes spin`** (already in `index.html` near `.btn.btn-busy`) for the busy spinner — do not invent a third spin keyframe.
- **Flag off → unchanged.** With `MULTI_TENANT` off the console stays unreachable; `tests/server-sync-golden.test.js` must stay green.
- **Touch targets ≥44px.** Do not shrink chips, tabs, or controls for aesthetics.
- **`adminLoadSeq` race guard stays.** Stale `loadAdminView` completions must neither leave the UI stuck busy nor clear a newer load’s busy early.
- **Plan 2 behavior unchanged.** No copy rewrites, no IA changes, no skeletons, no full-screen loading modal.
- **Classic scripts:** `let adminData` / `adminUI` are shared lexical bindings, **not** `window.*`. Tests drive via DOM / `loadAdminView` / function-declaration globals.
- **Baseline:** run `npm test` before starting (expect green). Commit after every task with `feat:` / `fix:` / `test:`.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `public/admin-console.js` | `adminUI.busy`, `setAdminBusy(on)`, busy lifecycle inside `loadAdminView()` | 1 |
| `public/index.html` | Busy status markup in header; busy + polish CSS | 1, 2 |
| `tests/frontend-admin-console.test.js` | Busy lifecycle, race, tab-switch, polish class/style assertions | 1, 2 |

---

### Task 1: Soft busy state on every `loadAdminView`

**Files:**
- Modify: `public/admin-console.js` (`adminUI` object ~line 20; `loadAdminView` ~331; add `setAdminBusy`)
- Modify: `public/index.html` (header markup ~2064–2071; busy CSS near other `.admin-*` rules ~711+)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: existing `adminLoadSeq`, `loadAdminView()`, `openAdminView()`, `switchAdminSection()`, `api()`, `showToast()`.
- Produces:
  - `adminUI.busy: boolean` (default `false`)
  - `setAdminBusy(on: boolean): void` — sets `adminUI.busy`, toggles `#adminView.is-busy` + `aria-busy`, shows/hides `#adminBusyStatus`
  - Markup: `#adminBusyStatus.admin-busy-status` inside `.admin-view-header` (spinner + “Updating…”, `aria-live="polite"`, starts `hidden`)

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-console.test.js`:

```js
describe('admin soft busy state', () => {
  test('loadAdminView sets is-busy and shows Updating… until the fetch finishes', async () => {
    const { window, document } = loadFrontendEnv();
    let resolveUsers;
    const usersPending = new Promise(r => { resolveUsers = r; });
    window.api = async (path) => {
      if(path === '/api/admin/users'){ await usersPending; return { users: [] }; }
      if(path.startsWith('/api/admin/org')) return {
        org: { id: 'bfv2-org', name: 'Default', stats: { livePatients: 0, byStatus: {}, users: 0, lastActivity: null } },
        totals: { hospitals: 0, departments: 0, units: 0, wards: 0, usersActive: 0, usersDisabled: 0, livePatients: 0 },
        hospitals: []
      };
      return {};
    };
    document.getElementById('adminView').hidden = false;
    const p = window.loadAdminView();
    await new Promise(r => setTimeout(r, 0));
    const view = document.getElementById('adminView');
    assert.equal(view.classList.contains('is-busy'), true);
    assert.equal(view.getAttribute('aria-busy'), 'true');
    const status = document.getElementById('adminBusyStatus');
    assert.ok(status);
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /Updating/);
    resolveUsers({ users: [] });
    await p;
    assert.equal(view.classList.contains('is-busy'), false);
    assert.equal(view.getAttribute('aria-busy'), 'false');
    assert.equal(status.hidden, true);
  });

  test('a failed loadAdminView clears busy and still surfaces the error', async () => {
    const { window, document } = loadFrontendEnv();
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.api = async () => { throw new window.Error('network down'); };
    document.getElementById('adminView').hidden = false;
    await window.loadAdminView().catch(() => {});
    assert.equal(document.getElementById('adminView').classList.contains('is-busy'), false);
    assert.equal(document.getElementById('adminBusyStatus').hidden, true);
  });

  test('a stale overlapping load does not clear a newer load\'s busy flag', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin'); // instance admin
    let resolveUsersA;
    const usersAPending = new Promise(r => { resolveUsersA = r; });
    let call = 0;
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [
        { id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }
      ] };
      if(path === '/api/admin/users'){
        call += 1;
        if(call === 1){ await usersAPending; return { users: [] }; }
        return { users: [] };
      }
      return {};
    };
    document.getElementById('adminView').hidden = false;
    const pA = window.loadAdminView();
    await new Promise(r => setTimeout(r, 0));
    const pB = window.loadAdminView();
    await pB;
    assert.equal(document.getElementById('adminView').classList.contains('is-busy'), false,
      'B finished — should not be busy');
    resolveUsersA({ users: [] });
    await pA;
    assert.equal(document.getElementById('adminView').classList.contains('is-busy'), false,
      'stale A finishing must not leave busy stuck, and must not re-busy');
  });

  test('switching sections without loadAdminView does not flash busy', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => {
      if(path.startsWith('/api/admin/org')) return {
        org: { id: 'bfv2-org', name: 'Default', stats: { livePatients: 0, byStatus: {}, users: 0, lastActivity: null } },
        totals: { hospitals: 0, departments: 0, units: 0, wards: 0, usersActive: 0, usersDisabled: 0, livePatients: 0 },
        hospitals: []
      };
      if(path === '/api/admin/users') return { users: [] };
      return {};
    };
    await window.loadAdminView();
    assert.equal(document.getElementById('adminView').classList.contains('is-busy'), false);
    window.switchAdminSection('people');
    assert.equal(document.getElementById('adminView').classList.contains('is-busy'), false);
    assert.equal(document.getElementById('adminBusyStatus').hidden, true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="admin soft busy state"`

Expected: FAIL — `#adminBusyStatus` missing; `#adminView` never gets `is-busy`.

- [ ] **Step 3: Add busy markup to the admin header**

In `public/index.html`, inside `.admin-view-header` (after `#adminViewTitle`, before `#adminOrgChip`), add:

```html
    <span id="adminBusyStatus" class="admin-busy-status" hidden aria-live="polite">
      <span class="admin-busy-spinner" aria-hidden="true"></span>
      Updating…
    </span>
```

- [ ] **Step 4: Add busy CSS**

Immediately after the `.admin-view-header{...}` rule block in `public/index.html`, add:

```css
  .admin-busy-status{
    display:inline-flex;align-items:center;gap:8px;margin-left:auto;
    font-size:12px;font-weight:600;color:var(--accent);font-family:var(--mono);
  }
  .admin-busy-status[hidden]{display:none !important;}
  .admin-busy-spinner{
    width:14px;height:14px;border:2px solid var(--accent-soft);
    border-top-color:var(--accent);border-radius:50%;
    animation:spin 0.7s linear infinite;flex:none;
  }
  .admin-view.is-busy .admin-section:not([hidden]){
    opacity:0.55;pointer-events:none;
  }
```

(`@keyframes spin` already exists later in the file — do not duplicate it.)

- [ ] **Step 5: Implement `setAdminBusy` and wire `loadAdminView`**

In `public/admin-console.js`, add `busy: false` to the `adminUI` object literal.

Add this function (near `loadAdminView`):

```js
function setAdminBusy(on){
  adminUI.busy = !!on;
  const view = document.getElementById('adminView');
  if(view){
    view.classList.toggle('is-busy', adminUI.busy);
    view.setAttribute('aria-busy', adminUI.busy ? 'true' : 'false');
  }
  const status = document.getElementById('adminBusyStatus');
  if(status) status.hidden = !adminUI.busy;
}
```

Replace `loadAdminView` with:

```js
async function loadAdminView(){
  const loadToken = ++adminLoadSeq;
  const instAdmin = isInstanceAdminUser();
  const viewedOrgId = adminUI.viewedOrgId;
  setAdminBusy(true);
  try{
    let tree, users, orgs;
    if(instAdmin){
      const [usersRes, orgsRes] = await Promise.all([api('/api/admin/users'), api('/api/admin/orgs')]);
      if(loadToken !== adminLoadSeq) return; // stale: leave busy for the newer load
      orgs = orgsRes.orgs;
      users = viewedOrgId ? usersRes.users.filter(u => u.orgId === viewedOrgId) : usersRes.users;
      tree = viewedOrgId ? await api(`/api/admin/org?orgId=${encodeURIComponent(viewedOrgId)}`) : null;
      if(loadToken !== adminLoadSeq) return;
      adminUI.allOrgs = orgs;
    }else{
      const [usersRes, treeRes] = await Promise.all([api('/api/admin/users'), api('/api/admin/org')]);
      if(loadToken !== adminLoadSeq) return;
      users = usersRes.users;
      tree = treeRes;
      orgs = tree.org ? [tree.org] : [];
    }
    adminData = { tree, users, orgs };
  }catch(err){
    if(loadToken !== adminLoadSeq) return;
    setAdminBusy(false);
    throw err;
  }
  if(loadToken !== adminLoadSeq) return;
  setAdminBusy(false);
  if(instAdmin) renderAdminOrgsSection();
  renderAdminSection();
}
```

**Critical:** every early `return` for a stale token must **not** call `setAdminBusy(false)`. Only the latest token clears busy (on success or failure).

- [ ] **Step 6: Run the busy tests to verify they pass**

Run: `npm test -- --test-name-pattern="admin soft busy state"`

Expected: PASS, 4 tests.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add public/admin-console.js public/index.html tests/frontend-admin-console.test.js
git commit -m "feat: soft busy state on admin loadAdminView

Show Updating… and dim the active section for every full reload,
including first open, without clearing a newer load's busy flag."
```

---

### Task 2: Quiet visual refresh (match Ortho Rounds chrome)

**Files:**
- Modify: `public/index.html` (admin CSS ~711–800; small class on `#adminViewTitle`)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: existing admin markup ids/classes from Plan 2; tokens `--card`, `--line`, `--shadow-sm`, `--accent`, `--accent-soft`, `--ink`, `--ink-soft`, `--mono`, `--radius` / `--radius-sm`.
- Produces: polished surfaces for header, tabs, stat tiles, Structure rail/detail, People cards, org chip — no behavior changes.

- [ ] **Step 1: Write the failing tests**

Add to `tests/frontend-admin-console.test.js`:

```js
describe('admin visual polish hooks', () => {
  test('Admin title uses the admin-view-title class for hierarchy styling', () => {
    const { document } = loadFrontendEnv();
    const title = document.getElementById('adminViewTitle');
    assert.ok(title);
    assert.ok(title.classList.contains('admin-view-title'));
  });

  test('stat tiles and structure panels use elevated card surfaces (shadow token)', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => {
      if(path.startsWith('/api/admin/org')) return {
        org: { id: 'bfv2-org', name: 'Default', stats: { livePatients: 5, byStatus: { postop: 3, preop: 1, conservative: 1, fordischarge: 0 }, users: 2, lastActivity: null } },
        totals: { hospitals: 1, departments: 1, units: 1, wards: 1, usersActive: 2, usersDisabled: 0, livePatients: 5 },
        hospitals: [{ id: 'h1', name: 'City', stats: { livePatients: 5, byStatus: {}, users: 2, lastActivity: null }, departments: [
          { id: 'd1', name: 'Ortho', specialty: 'ortho', stats: { livePatients: 5, byStatus: {}, users: 2, lastActivity: null }, units: [
            { id: 'u1', name: 'IV', stats: { livePatients: 5, byStatus: {}, users: 1, lastActivity: null }, wards: [] }
          ] }
        ] }]
      };
      if(path === '/api/admin/users') return { users: [] };
      return {};
    };
    await window.loadAdminView();
    const tile = document.querySelector('#adminStatTiles .admin-stat-tile');
    assert.ok(tile);
    const tileShadow = window.getComputedStyle(tile).boxShadow;
    assert.notEqual(tileShadow, 'none');
    window.switchAdminSection('structure');
    window.selectAdminNode('unit', 'u1');
    const rail = document.getElementById('adminTreeRail');
    const detail = document.getElementById('adminDetailPane');
    assert.notEqual(window.getComputedStyle(rail).boxShadow, 'none');
    assert.notEqual(window.getComputedStyle(detail).boxShadow, 'none');
  });

  test('selected section tab uses accent-soft fill', async () => {
    const { window, document } = loadFrontendEnv();
    window.api = async (path) => {
      if(path.startsWith('/api/admin/org')) return {
        org: { id: 'bfv2-org', name: 'Default', stats: { livePatients: 0, byStatus: {}, users: 0, lastActivity: null } },
        totals: { hospitals: 0, departments: 0, units: 0, wards: 0, usersActive: 0, usersDisabled: 0, livePatients: 0 },
        hospitals: []
      };
      if(path === '/api/admin/users') return { users: [] };
      return {};
    };
    await window.loadAdminView();
    const tab = document.querySelector('[data-admin-section="overview"]');
    assert.equal(tab.getAttribute('aria-selected'), 'true');
    const bg = window.getComputedStyle(tab).backgroundColor;
    // accent-soft is not transparent / not equal to the unselected tab's empty background
    assert.notEqual(bg, 'rgba(0, 0, 0, 0)');
    assert.notEqual(bg, 'transparent');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="admin visual polish hooks"`

Expected: FAIL — missing `admin-view-title`; tiles/rail still `box-shadow: none`; selected tab background transparent.

- [ ] **Step 3: Add the title class hook**

In `public/index.html`, change:

```html
    <h2 id="adminViewTitle">Admin console</h2>
```

to:

```html
    <h2 id="adminViewTitle" class="admin-view-title">Admin console</h2>
```

- [ ] **Step 4: Apply the quiet refresh CSS**

In `public/index.html`, **replace/extend** the existing admin chrome rules as follows (keep busy rules from Task 1; keep media queries for people cards and structure drill-down).

Update / add these rules (merge into the existing `.admin-*` block starting ~711 — do not invent new hex colours):

```css
  .admin-view-title{
    margin:0;font-size:18px;font-weight:700;letter-spacing:-0.01em;color:var(--ink);
  }
  .admin-view-header .btn#adminViewClose{
    background:transparent;border:1px solid var(--line);color:var(--ink-soft);
    box-shadow:none;min-height:44px;
  }
  .admin-view-header .btn#adminViewClose:hover{color:var(--ink);border-color:var(--ink-soft);background:var(--accent-soft);}
  .admin-section-tab[aria-selected="true"]{
    color:var(--ink);border-bottom-color:var(--accent);font-weight:700;
    background:var(--accent-soft);border-radius:8px 8px 0 0;
  }
  .admin-stat-tile{
    background:var(--card);border:1px solid var(--line);border-radius:var(--radius-sm);
    padding:16px 14px;text-align:center;box-shadow:var(--shadow-sm);
  }
  .admin-stat-tile .n{font-size:28px;font-weight:700;color:var(--ink);font-family:var(--mono);letter-spacing:-0.02em;}
  .admin-stat-tile .l{font-size:12px;color:var(--ink-soft);margin-top:4px;font-weight:600;}
  .admin-quick-actions{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 16px;}
  .admin-cc-rail,.admin-cc-detail{
    background:var(--card);border:1px solid var(--line);border-radius:var(--radius-sm);
    box-shadow:var(--shadow-sm);
  }
  .admin-cc-rail{padding:10px;}
  .admin-cc-detail{padding:16px;}
  .admin-cc-detail h3{margin:0 0 10px;font-size:17px;font-weight:700;color:var(--ink);}
  .admin-people-card{
    background:var(--card);border:1px solid var(--line);border-radius:var(--radius-sm);
    padding:12px;margin-bottom:8px;box-shadow:var(--shadow-sm);
  }
  .admin-users-table th{
    font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:none;
    letter-spacing:0.02em;padding-bottom:10px;
  }
  .admin-org-chip{
    display:inline-flex;align-items:center;gap:8px;padding:6px 10px 6px 12px;
    background:var(--accent-soft);border:1px solid var(--line);border-radius:999px;
    font-size:13px;color:var(--ink);box-shadow:var(--shadow-sm);
  }
  .admin-section{padding-top:4px;}
```

If `.admin-quick-actions` is not yet wrapping the Overview quick-action buttons in markup, wrap them:

```html
      <div class="admin-quick-actions">
        <button class="btn" id="adminQuickAddPerson">Add person</button>
        <button class="btn" id="adminQuickAddWard">Add ward</button>
        <button class="btn" id="adminQuickFixAssignment">Fix an assignment</button>
      </div>
```

(Inspect current Overview markup around `#adminQuickAddPerson` — if a wrapper already exists with another class, add `admin-quick-actions` to it rather than nesting duplicates.)

Ensure existing rules for `.admin-stat-tile`, `.admin-cc-rail`, `.admin-cc-detail`, `.admin-people-card`, `.admin-org-chip`, and `.admin-section-tab[aria-selected="true"]` are **updated in place** (not left as duplicates that win on cascade and keep `box-shadow:none`).

- [ ] **Step 5: Run the polish tests to verify they pass**

Run: `npm test -- --test-name-pattern="admin visual polish hooks"`

Expected: PASS, 3 tests.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: PASS, 0 failures. Also spot-check: `npm test -- --test-name-pattern="flag OFF|sync-golden"` stays green.

- [ ] **Step 7: Commit**

```bash
git add public/index.html tests/frontend-admin-console.test.js
git commit -m "feat: quiet admin console visual refresh

Match Ortho Rounds card surfaces, tab chrome, and type hierarchy
using existing tokens — no IA or behavior changes."
```

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
|---|---|
| Quiet visual refresh (header, tabs, panels, type, density) | 2 |
| Soft busy on every `loadAdminView` | 1 |
| Header spinner + “Updating…” | 1 |
| Dim + pointer-events none on active section | 1 |
| No busy on section tab switch / row-only repaint | 1 (tab test; row-only unchanged by omission) |
| Stale load must not clear newer busy | 1 |
| Existing tokens only / reuse spin | 1–2 |
| No skeletons / no backend / no new deps | both (constraints) |
| Flag-off unchanged | 2 Step 6 |

No placeholders. Busy + polish property names are consistent (`setAdminBusy`, `adminUI.busy`, `is-busy`, `#adminBusyStatus`).
