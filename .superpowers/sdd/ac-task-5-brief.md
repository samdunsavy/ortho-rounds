### Task 5: Admin view UI (flag-gated)

**Files:**
- Modify: `public/index.html` — Admin view container + styles + menu entries (next to Manage Users entries)
- Modify: `public/app.js` — flag fetch, login scope storage, Admin view render/wiring
- Test: `tests/frontend-admin-view.test.js` (new, jsdom)

**Interfaces:**
- Consumes: `GET /api/admin/org`, `GET /api/admin/users`, `POST` hospitals/wards/users/assign/orgs (Task 4 shapes); `api()` helper; `formatRelativeTime`, `escapeHTML`, `showToast`.
- Produces: window-visible functions for tests: `openAdminView()`, `closeAdminView()`, `renderAdminView(tree, users)`, `renderAdminOrgsTab(orgs)`, `adminUiVisible()`.

- [ ] **Step 1: Write the failing tests**

Create `tests/frontend-admin-view.test.js` (follow `loadFrontendEnv` patterns from tests/frontend-worklist.test.js):

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

const TREE = {
  totals: { hospitals: 1, departments: 2, usersActive: 3, usersDisabled: 1, livePatients: 7 },
  hospitals: [{ id: 'h1', name: 'City Hospital', wards: [
    { id: 'w1', name: 'Ortho', specialty: 'ortho',
      stats: { livePatients: 5, byStatus: { postop: 3, preop: 1, conservative: 1, fordischarge: 0 }, users: 2, lastActivity: Date.now() - 60000 } },
    { id: 'w2', name: 'Surgery', specialty: 'surgery',
      stats: { livePatients: 2, byStatus: { postop: 2, preop: 0, conservative: 0, fordischarge: 0 }, users: 1, lastActivity: null } }
  ]}]
};
const USERS = [
  { id: 'u1', username: 'boss', role: 'admin', active: true, createdAt: 1, wardId: null, orgId: 'o1' },
  { id: 'u2', username: 'pg9', role: 'member', active: true, createdAt: 2, wardId: 'w1', orgId: 'o1' }
];

describe('admin view rendering', () => {
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

  test('renderAdminView paints stat tiles, department cards, user rows', () => {
    const { window, document } = loadFrontendEnv();
    window.renderAdminView(TREE, USERS);
    const tiles = [...document.querySelectorAll('#adminStatTiles .admin-stat-tile')];
    assert.equal(tiles.length, 4);
    const tileText = tiles.map(t => t.textContent).join(' ');
    assert.match(tileText, /2/);  // departments
    assert.match(tileText, /3/);  // active users
    assert.match(tileText, /7/);  // live patients
    assert.match(tileText, /5/);  // post-op (3+2)
    const cards = document.querySelectorAll('#adminOrgSection .admin-dept-card');
    assert.equal(cards.length, 2);
    assert.match(cards[0].textContent, /Ortho/);
    assert.ok(cards[0].querySelector('.admin-status-bar'), 'department card has a status bar');
    const rows = document.querySelectorAll('#adminUsersSection tbody tr');
    assert.equal(rows.length, 2);
    const sel = rows[1].querySelector('select[data-assign-user="u2"]');
    assert.ok(sel, 'member row has an assign select');
    assert.equal(sel.value, 'w1');
  });

  test('assign select fires the assign endpoint', async () => {
    const { window, document } = loadFrontendEnv();
    const calls = [];
    window.api = async (path, opts) => { calls.push({ path, opts }); return { ok: true }; };
    window.renderAdminView(TREE, USERS);
    const sel = document.querySelector('select[data-assign-user="u2"]');
    sel.value = 'w2';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/admin/users/u2/assign');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { wardId: 'w2' });
  });

  test('orgs tab renders rollup cards (instance admin surface)', () => {
    const { window, document } = loadFrontendEnv();
    window.renderAdminOrgsTab([
      { id: 'o1', name: 'Pilot Org', plan: 'free', createdAt: 1, stats: { hospitals: 1, departments: 2, users: 4, livePatients: 7 } }
    ]);
    const cards = document.querySelectorAll('#adminOrgsTab .admin-org-card');
    assert.equal(cards.length, 1);
    assert.match(cards[0].textContent, /Pilot Org/);
    assert.match(cards[0].textContent, /7/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend-admin-view.test.js`
Expected: FAIL — `adminUiVisible` / containers undefined.

- [ ] **Step 3: Implement**

**`public/index.html`** — three additions:

1. Menu entries: next to `moreManageUsersBtn` add `<button class="menu-item" id="moreAdminBtn" style="display:none">🏥 Admin console</button>`; next to `desktopManageUsersBtn` add the same with id `desktopAdminBtn`.

2. View container (before the presentation overlay div):

```html
<!-- ADMIN CONSOLE (MULTI_TENANT admins only) -->
<div class="admin-view" id="adminView" hidden>
  <div class="admin-view-header">
    <button class="btn" id="adminViewClose">← Back</button>
    <h2 id="adminViewTitle">Admin console</h2>
    <div class="admin-tabs" id="adminTabs" style="display:none">
      <button class="btn admin-tab active" data-admin-tab="org">Organization</button>
      <button class="btn admin-tab" data-admin-tab="orgs">Organizations</button>
    </div>
  </div>
  <div id="adminOrgPane">
    <div class="admin-stat-tiles" id="adminStatTiles"></div>
    <div id="adminOrgSection"></div>
    <div id="adminUsersSection"></div>
  </div>
  <div id="adminOrgsTab" style="display:none"></div>
</div>
```

3. Styles (near the presentation styles, using existing tokens only):

```css
.admin-view{position:fixed;inset:0;z-index:60;background:var(--bg);overflow-y:auto;padding:16px;}
.admin-view[hidden]{display:none;}
.admin-view-header{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;}
.admin-stat-tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:18px;}
@media (min-width:720px){.admin-stat-tiles{grid-template-columns:repeat(4,1fr);}}
.admin-stat-tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center;}
.admin-stat-tile .n{font-size:28px;font-weight:700;color:var(--ink);}
.admin-stat-tile .l{font-size:12px;color:var(--muted);margin-top:2px;}
.admin-hospital-group{margin-bottom:18px;}
.admin-hospital-group h3{margin:0 0 8px;display:flex;align-items:center;gap:8px;}
.admin-dept-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;}
.admin-dept-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;}
.admin-dept-card .spec-badge{font-size:11px;border:1px solid var(--line);border-radius:10px;padding:1px 8px;color:var(--muted);}
.admin-status-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--line);margin:8px 0;}
.admin-status-bar span{display:block;height:100%;}
.admin-inline-form{display:flex;gap:6px;margin-top:8px;}
.admin-inline-form input{flex:1;min-width:0;}
.admin-users-table{width:100%;border-collapse:collapse;}
.admin-users-table th,.admin-users-table td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;font-size:14px;}
.admin-org-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:10px;}
```

Status-bar segment colors: reuse the app's existing status color variables (grep `postop` in index.html styles for the exact custom-property names and use those; if statuses are colored via classes, reuse those class colors with inline `background`).

**`public/app.js`** — additions (place the admin-view block near the presentation-mode code; helpers at top-level so jsdom sees them):

```js
/* ---------------- admin console (MULTI_TENANT) ---------------- */

var serverFlags = {}; // populated from /api/health at startup and login
const LS_ORG_ID = 'ortho_org_id';

function adminUiVisible(){
  return isAdmin() && !!(serverFlags && serverFlags.MULTI_TENANT);
}

function isInstanceAdminUser(){
  return isAdmin() && !localStorage.getItem(LS_ORG_ID);
}

async function refreshServerFlags(){
  try{
    const res = await fetch('/api/health');
    const data = await res.json();
    serverFlags = data.flags || {};
  }catch{ /* offline — leave as-is */ }
  updateAccountUI();
}

function renderAdminStatTiles(tree){
  const postop = tree.hospitals.flatMap(h => h.wards).reduce((n, w) => n + (w.stats.byStatus.postop || 0), 0);
  const tiles = [
    { n: tree.totals.departments, l: 'Departments' },
    { n: tree.totals.usersActive, l: 'Active users' },
    { n: tree.totals.livePatients, l: 'Live patients' },
    { n: postop, l: 'Post-op' }
  ];
  return tiles.map(t => `<div class="admin-stat-tile"><div class="n">${t.n}</div><div class="l">${t.l}</div></div>`).join('');
}

function renderAdminStatusBar(byStatus, total){
  if(!total) return '<div class="admin-status-bar"></div>';
  const seg = (n, color) => n ? `<span style="width:${(n / total) * 100}%;background:${color}"></span>` : '';
  return `<div class="admin-status-bar">${
    seg(byStatus.postop, 'var(--ok, #2e7d32)')}${
    seg(byStatus.preop, 'var(--warn, #f9a825)')}${
    seg(byStatus.conservative, 'var(--muted, #90a4ae)')}${
    seg(byStatus.fordischarge, 'var(--accent, #1565c0)')}</div>`;
}

function renderAdminOrgSectionHTML(tree){
  const groups = tree.hospitals.map(h => `
    <div class="admin-hospital-group" data-hospital-id="${escapeHTML(h.id)}">
      <h3>${escapeHTML(h.name)}</h3>
      <div class="admin-dept-grid">
        ${h.wards.map(w => `
          <div class="admin-dept-card" data-ward-id="${escapeHTML(w.id)}">
            <strong>${escapeHTML(w.name)}</strong> <span class="spec-badge">${escapeHTML(w.specialty || '')}</span>
            <div class="small-muted">${w.stats.livePatients} live patient${w.stats.livePatients === 1 ? '' : 's'} · ${w.stats.users} user${w.stats.users === 1 ? '' : 's'}</div>
            ${renderAdminStatusBar(w.stats.byStatus, w.stats.livePatients)}
            <div class="small-muted">${w.stats.lastActivity ? 'Active ' + formatRelativeTime(w.stats.lastActivity) : 'No activity yet'}</div>
          </div>`).join('')}
      </div>
      <div class="admin-inline-form">
        <input placeholder="New department name" data-new-ward-name="${escapeHTML(h.id)}">
        <button class="btn" data-add-ward="${escapeHTML(h.id)}">Add department</button>
      </div>
    </div>`).join('');
  return `<h3>Organization</h3>${groups || '<div class="small-muted">No hospitals yet — add the first one.</div>'}
    <div class="admin-inline-form">
      <input placeholder="New hospital name" id="adminNewHospitalName">
      <button class="btn" id="adminAddHospitalBtn">Add hospital</button>
    </div>`;
}

function renderAdminUsersSectionHTML(tree, users){
  const wardOptions = tree.hospitals.flatMap(h => h.wards.map(w => ({ id: w.id, label: `${w.name} (${h.name})` })));
  const opts = (sel) => `<option value="">— none —</option>` + wardOptions.map(w =>
    `<option value="${escapeHTML(w.id)}" ${w.id === sel ? 'selected' : ''}>${escapeHTML(w.label)}</option>`).join('');
  const rows = users.map(u => `
    <tr>
      <td>${escapeHTML(u.username)}</td>
      <td>${u.role === 'admin' ? '<span class="spec-badge">admin</span>' : 'member'}</td>
      <td><select data-assign-user="${escapeHTML(u.id)}">${opts(u.wardId)}</select></td>
      <td>${u.active ? 'active' : 'disabled'}</td>
    </tr>`).join('');
  return `<h3>Users</h3><table class="admin-users-table">
    <thead><tr><th>User</th><th>Role</th><th>Department</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderAdminView(tree, users){
  document.getElementById('adminStatTiles').innerHTML = renderAdminStatTiles(tree);
  document.getElementById('adminOrgSection').innerHTML = renderAdminOrgSectionHTML(tree);
  document.getElementById('adminUsersSection').innerHTML = renderAdminUsersSectionHTML(tree, users);
}

function renderAdminOrgsTab(orgs){
  const el = document.getElementById('adminOrgsTab');
  el.innerHTML = `<h3>Organizations</h3>` + orgs.map(o => `
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

let adminViewOrgId = null; // instance admin: which org's tree is loaded

async function loadAdminView(){
  const qs = isInstanceAdminUser() && adminViewOrgId ? `?orgId=${encodeURIComponent(adminViewOrgId)}` : '';
  if(isInstanceAdminUser() && !adminViewOrgId){
    document.getElementById('adminTabs').style.display = '';
    switchAdminTab('orgs');
    renderAdminOrgsTab((await api('/api/admin/orgs')).orgs);
    return;
  }
  const [tree, usersRes] = await Promise.all([api('/api/admin/org' + qs), api('/api/admin/users')]);
  let users = usersRes.users;
  if(isInstanceAdminUser() && adminViewOrgId) users = users.filter(u => u.orgId === adminViewOrgId);
  renderAdminView(tree, users);
}

function switchAdminTab(tab){
  document.getElementById('adminOrgPane').style.display = tab === 'org' ? '' : 'none';
  document.getElementById('adminOrgsTab').style.display = tab === 'orgs' ? '' : 'none';
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.toggle('active', b.dataset.adminTab === tab));
}

function openAdminView(){
  document.getElementById('adminView').hidden = false;
  adminViewOrgId = null;
  for(const id of ['adminStatTiles', 'adminOrgSection', 'adminUsersSection']){
    const el = document.getElementById(id);
    if(el) el.innerHTML = '<div class="small-muted">Loading…</div>';
  }
  loadAdminView().catch(err => showToast(err.message || 'Could not load admin data'));
}

function closeAdminView(){
  document.getElementById('adminView').hidden = true;
}
```

Wiring (inside the existing page-init / static-bindings function, plus one delegated handler):

```js
  document.getElementById('adminViewClose')?.addEventListener('click', closeAdminView);
  document.getElementById('moreAdminBtn')?.addEventListener('click', openAdminView);
  document.getElementById('desktopAdminBtn')?.addEventListener('click', openAdminView);
  document.getElementById('adminView')?.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-admin-tab]');
    if(tab){ switchAdminTab(tab.dataset.adminTab); return; }
    const addHosp = e.target.closest('#adminAddHospitalBtn');
    if(addHosp){
      const name = document.getElementById('adminNewHospitalName')?.value.trim();
      if(!name) return;
      const body = isInstanceAdminUser() && adminViewOrgId ? { name, orgId: adminViewOrgId } : { name };
      try{ await api('/api/admin/hospitals', { method: 'POST', body: JSON.stringify(body) }); await loadAdminView(); }
      catch(err){ showToast(err.message); }
      return;
    }
    const addWard = e.target.closest('[data-add-ward]');
    if(addWard){
      const hid = addWard.dataset.addWard;
      const input = document.querySelector(`[data-new-ward-name="${hid}"]`);
      const name = input?.value.trim();
      if(!name) return;
      try{ await api('/api/admin/wards', { method: 'POST', body: JSON.stringify({ hospitalId: hid, name }) }); await loadAdminView(); }
      catch(err){ showToast(err.message); }
      return;
    }
    const addOrg = e.target.closest('#adminAddOrgBtn');
    if(addOrg){
      const name = document.getElementById('adminNewOrgName')?.value.trim();
      if(!name) return;
      try{ await api('/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name }) }); await loadAdminView(); }
      catch(err){ showToast(err.message); }
      return;
    }
    const mkAdmin = e.target.closest('[data-create-org-admin]');
    if(mkAdmin){
      const oid = mkAdmin.dataset.createOrgAdmin;
      const input = document.querySelector(`[data-new-org-admin="${oid}"]`);
      const username = input?.value.trim();
      if(!username) return;
      try{
        const r = await api(`/api/admin/orgs/${oid}/admin`, { method: 'POST', body: JSON.stringify({ username }) });
        await showConfirm('Org admin created', `Temporary password for ${r.username}: ${r.temporaryPassword}\nIt is not shown again.`, { confirmLabel: 'Done' });
        await loadAdminView();
      }catch(err){ showToast(err.message); }
      return;
    }
    const viewOrg = e.target.closest('[data-view-org]');
    if(viewOrg){ adminViewOrgId = viewOrg.dataset.viewOrg; switchAdminTab('org'); loadAdminView().catch(err => showToast(err.message)); return; }
  });
  document.getElementById('adminView')?.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-assign-user]');
    if(!sel) return;
    try{
      await api(`/api/admin/users/${sel.dataset.assignUser}/assign`, { method: 'POST', body: JSON.stringify({ wardId: sel.value || null }) });
      showToast('Department updated');
    }catch(err){ showToast(err.message); }
  });
```

Integration points (each is a small addition to an existing function — find by the anchors given):

- Login success handler (~app.js:1964, where LS_ROLE is set): also `localStorage.setItem(LS_ORG_ID, data.orgId || '');` (empty string for null) and call `refreshServerFlags()`.
- Logout (~app.js:1979): `localStorage.removeItem(LS_ORG_ID);`
- `updateAccountUI()` (~app.js:3589): alongside each Manage-Users button toggle, add `const adminBtn = document.getElementById('moreAdminBtn'); if(adminBtn) adminBtn.style.display = adminUiVisible() ? '' : 'none';` (and the desktop twin).
- Page init: call `refreshServerFlags()` once (non-blocking, `void`).
- The assign `change` listener above must NOT be inside a flag check — the whole view is unreachable flag-off (buttons hidden, view `hidden`), keeping wiring simple.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend-admin-view.test.js` → PASS. Also `npm test -- tests/frontend-worklist.test.js tests/frontend-lab-photo-extraction.test.js` (no init regressions).

- [ ] **Step 5: Full suite, commit**

```bash
git add public/index.html public/app.js tests/frontend-admin-view.test.js
git commit -m "feat: flag-gated Admin console view (stats, org tree, users, orgs tab)"
```

---

