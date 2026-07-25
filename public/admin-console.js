/* Admin command center — the MULTI_TENANT org/user management console.
   Split out of app.js (which is ~374 KB) because this is a self-contained
   surface. Plain script, not a module: its function declarations must be
   global so app.js's button handlers can call openAdminView(). Runtime
   helpers (api, showToast, escapeHTML, formatRelativeTime) come from
   app.js — they're only *called* here, never at load time, so script
   order doesn't matter. */

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

function renderAdminUnitRowHTML(u){
  const chips = u.wards.map(w => `
    <span class="admin-ward-chip" data-ward-id="${escapeHTML(w.id)}">${escapeHTML(w.name)} <span class="small-muted">(${w.stats.livePatients})</span></span>`
  ).join('') || '<span class="small-muted">No wards yet</span>';
  return `
    <div class="admin-unit-row" data-unit-id="${escapeHTML(u.id)}">
      <div><strong>${escapeHTML(u.name)}</strong> <span class="small-muted">${u.stats.livePatients} live patient${u.stats.livePatients === 1 ? '' : 's'} · ${u.stats.users} user${u.stats.users === 1 ? '' : 's'}</span></div>
      <div class="admin-ward-chips">${chips}</div>
      <div class="admin-inline-form">
        <input placeholder="New ward name" data-new-ward-name="${escapeHTML(u.id)}">
        <button class="btn" data-add-ward="${escapeHTML(u.id)}">Add ward</button>
      </div>
    </div>`;
}

function renderAdminOrgSectionHTML(tree){
  const groups = tree.hospitals.map(h => `
    <div class="admin-hospital-group" data-hospital-id="${escapeHTML(h.id)}">
      <h3>${escapeHTML(h.name)}</h3>
      <div class="admin-dept-grid">
        ${h.departments.map(dep => `
          <div class="admin-dept-card" data-department-id="${escapeHTML(dep.id)}">
            <strong>${escapeHTML(dep.name)}</strong> <span class="spec-badge">${escapeHTML(dep.specialty || '')}</span>
            <div class="small-muted">${dep.stats.livePatients} live patient${dep.stats.livePatients === 1 ? '' : 's'} · ${dep.stats.users} user${dep.stats.users === 1 ? '' : 's'}</div>
            ${renderAdminStatusBar(dep.stats.byStatus, dep.stats.livePatients)}
            <div class="small-muted">${dep.stats.lastActivity ? 'Active ' + formatRelativeTime(dep.stats.lastActivity) : 'No activity yet'}</div>
            <div class="admin-unit-list">
              ${dep.units.map(renderAdminUnitRowHTML).join('') || '<div class="small-muted">No units yet</div>'}
            </div>
            <div class="admin-inline-form">
              <input placeholder="New unit name" data-new-unit-name="${escapeHTML(dep.id)}">
              <button class="btn" data-add-unit="${escapeHTML(dep.id)}">Add unit</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="admin-inline-form">
        <input placeholder="New department name" data-new-department-name="${escapeHTML(h.id)}">
        <button class="btn" data-add-department="${escapeHTML(h.id)}">Add department</button>
      </div>
    </div>`).join('');
  return `<h3>Organization</h3>${groups || '<div class="small-muted">No hospitals yet — add the first one.</div>'}
    <div class="admin-inline-form">
      <input placeholder="New hospital name" id="adminNewHospitalName">
      <button class="btn" id="adminAddHospitalBtn">Add hospital</button>
    </div>`;
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

function renderAdminUsersSectionHTML(tree, users){
  const groups = buildAssignNodeGroups(tree);
  const rows = users.map(u => {
    const selType = u.assignmentType || null;
    const selId = u.assignmentId || null;
    const prev = selType && selId ? `${selType}:${selId}` : '';
    return `
    <tr>
      <td>${escapeHTML(u.username)}</td>
      <td>${u.role === 'admin' ? '<span class="spec-badge">admin</span>' : 'member'}</td>
      <td><select data-assign-user="${escapeHTML(u.id)}" data-prev="${escapeHTML(prev)}">${renderAssignSelectOptionsHTML(groups, selType, selId)}</select></td>
      <td>${u.active ? 'active' : 'disabled'}</td>
    </tr>`;
  }).join('');
  return `<h3>Users</h3><table class="admin-users-table">
    <thead><tr><th>User</th><th>Role</th><th>Assignment</th><th>Status</th></tr></thead>
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

// Delegated at module scope (not inside bindEvents/init) so the assign
// control works as soon as renderAdminView paints a row — the admin view
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
