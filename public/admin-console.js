/* Admin command center — the MULTI_TENANT org/user management console.
   Split out of app.js (which is ~374 KB) because this is a self-contained
   surface. Plain script, not a module: its function declarations must be
   global so app.js's button handlers can call openAdminView(). Runtime
   helpers (api, showToast, escapeHTML, formatRelativeTime) come from
   app.js — they're only *called* here, never at load time, so script
   order doesn't matter. */

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
  return `<button type="button" data-depth="${depth}" data-node="${escapeHTML(type)}:${escapeHTML(id)}" class="admin-cc-row${sel}">${escapeHTML(label)}${c}</button>`;
}

function renderAdminTreeHTML(tree, selection){
  let out = '';
  const usersSel = selection && selection.type === 'users' ? ' is-selected' : '';
  out += `<button type="button" data-depth="0" data-node="users" class="admin-cc-row${usersSel}">Users</button>`;
  if(isInstanceAdminUser()){
    const orgsSel = selection && selection.type === 'orgs' ? ' is-selected' : '';
    out += `<button type="button" data-depth="0" data-node="orgs" class="admin-cc-row${orgsSel}">Organizations</button>`;
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

function renderAdminDetailHTML(state){
  if(!state.selection) return '';
  return `<div class="small-muted">${escapeHTML(state.selection.type)}</div>`;
}

document.getElementById('adminView')?.addEventListener('click', (e) => {
  const row = e.target.closest('[data-node]');
  if(!row) return;
  const raw = row.dataset.node;
  const i = raw.indexOf(':');
  if(i === -1) selectAdminNode(raw, null);
  else selectAdminNode(raw.slice(0, i), raw.slice(i + 1));
});

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

function renderAdminStatusBar(byStatus, total){
  if(!total) return '<div class="admin-status-bar"></div>';
  const seg = (n, color) => n ? `<span style="width:${(n / total) * 100}%;background:${color}"></span>` : '';
  return `<div class="admin-status-bar">${
    seg(byStatus.postop, 'var(--status-postop)')}${
    seg(byStatus.preop, 'var(--status-preop)')}${
    seg(byStatus.conservative, 'var(--status-conservative)')}${
    seg(byStatus.fordischarge, 'var(--status-fordischarge)')}</div>`;
}

// Walks the tree into per-level groups so the assignment <select> can render
// an <optgroup> per node type (hospital/department/unit/ward). Option values
// encode "type:id" — the change handler below splits on the first ":".
function buildAssignNodeGroups(tree){
  const groups = { hospital: [], department: [], unit: [], ward: [] };
  for(const h of tree.hospitals){
    groups.hospital.push({ id: h.id, label: h.name });
    for(const dep of h.departments){
      groups.department.push({ id: dep.id, label: `${dep.name} (${h.name})` });
      for(const u of dep.units){
        groups.unit.push({ id: u.id, label: `${u.name} (${dep.name})` });
        for(const w of u.wards){
          groups.ward.push({ id: w.id, label: `${w.name} (${u.name})` });
        }
      }
    }
  }
  return groups;
}

function renderAssignSelectOptionsHTML(groups, selType, selId){
  const optgroup = (label, type, items) => items.length ? `<optgroup label="${escapeHTML(label)}">${items.map(it =>
    `<option value="${type}:${escapeHTML(it.id)}" ${type === selType && it.id === selId ? 'selected' : ''}>${escapeHTML(it.label)}</option>`
  ).join('')}</optgroup>` : '';
  return `<option value="">— none —</option>` +
    optgroup('Hospitals', 'hospital', groups.hospital) +
    optgroup('Departments', 'department', groups.department) +
    optgroup('Units', 'unit', groups.unit) +
    optgroup('Wards', 'ward', groups.ward);
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

function switchAdminTab(tab){
  document.getElementById('adminOrgPane').style.display = tab === 'org' ? '' : 'none';
  document.getElementById('adminOrgsTab').style.display = tab === 'orgs' ? '' : 'none';
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.toggle('active', b.dataset.adminTab === tab));
}

function openAdminView(){
  document.getElementById('adminView').hidden = false;
  adminViewOrgId = null;
  for(const id of ['adminStatTiles', 'adminTreeRail', 'adminDetailPane']){
    const el = document.getElementById(id);
    if(el) el.innerHTML = '<div class="small-muted">Loading…</div>';
  }
  loadAdminView().catch(err => showToast(err.message || 'Could not load admin data'));
}

function closeAdminView(){
  document.getElementById('adminView').hidden = true;
}

// Delegated at module scope (not inside bindEvents/init) so the assign
// control works as soon as the detail panel paints a row — the admin view
// is unreachable flag-off anyway (buttons hidden, view `hidden`), so this
// doesn't need to be gated behind MULTI_TENANT/isAdmin checks either.
document.getElementById('adminView')?.addEventListener('change', async (e) => {
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
