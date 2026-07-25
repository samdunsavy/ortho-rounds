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
  // Rendered whenever the type is movable at all, even with zero valid
  // targets right now (e.g. only one sibling parent exists) — hiding the
  // control entirely would make "there's nowhere to move this yet" look
  // identical to "this type can't be moved", which it isn't.
  const moveHTML = MOVE_PARENT_TYPE[sel.type] ? `
    <select data-move-node="${escapeHTML(key)}">
      <option value="">Move to…</option>
      ${parents.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}
    </select>` : '';
  // NOTE: the brief's snippet built this label with a single-quoted string
  // containing `\\'t` — that's an escaped backslash followed by an
  // unescaped quote, which terminates the string early and is a syntax
  // error. Using a template literal sidesteps the escaping issue entirely.
  const deleteLabel = blocked ? `Can't delete — ${escapeHTML(blocked)}` : 'Delete';
  return `
    <span class="admin-node-actions">
      <button class="btn" data-rename-node="${escapeHTML(key)}">Rename</button>
      ${moveHTML}
      <button class="btn" data-delete-node="${escapeHTML(key)}"${blocked ? ' disabled' : ''} title="${escapeHTML(deleteLabel)}">${escapeHTML(deleteLabel)}</button>
    </span>`;
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

// Delegated at module scope alongside the other adminView listeners — see
// the note above the `change` listener near the end of this file for why
// that's safe even though this file doesn't have an init()/bindEvents().
document.getElementById('adminView')?.addEventListener('input', (e) => {
  if(e.target.id !== 'adminUserSearch') return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('[data-user-row]').forEach(tr => {
    tr.style.display = !q || tr.dataset.username.includes(q) ? '' : 'none';
  });
});

document.getElementById('adminView')?.addEventListener('click', (e) => {
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

// Walks the tree (plus the org list) into per-level groups so the assignment
// <select> can render an <optgroup> per node type (org/hospital/department/
// unit/ward). Option values encode "type:id" — the change handler below
// splits on the first ":".
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

// Looks up the display label for a "type:id" assignment against the groups
// built above. Returns a "Stale (type:id)" placeholder when the node isn't
// in the current tree/org list — e.g. orphaned units left over from a
// migration, or a since-deleted org.
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
