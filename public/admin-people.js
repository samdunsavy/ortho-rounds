/* Admin console — People section: user list, create, role, placement,
   bulk assign. Plain script (see admin-console.js's header comment). This
   task ports the old users-table code over unchanged in behaviour, reading
   adminData/adminUI instead of adminState. */

function orgNameForUser(user, orgs){
  const hit = (orgs || []).find(o => o.id === user.orgId);
  return hit ? hit.name : (user.orgId || 'their organization');
}

function peopleAssignmentDisplay(u, groups, orgs, unscoped){
  const selType = u.assignmentType || null, selId = u.assignmentId || null;
  if(!selType || !selId) return { text: '—', readOnly: true, enterOrgId: null };
  const label = assignLabelFor(groups, selType, selId);
  if(label) return { text: label, readOnly: unscoped, enterOrgId: unscoped && u.orgId ? u.orgId : null };
  if(unscoped) return { text: `Within ${orgNameForUser(u, orgs)}`, readOnly: true, enterOrgId: u.orgId || null };
  return { text: 'Assigned to a place that no longer exists', readOnly: true, enterOrgId: null };
}

function renderAdminPeopleRowHTML(u, state){
  state = state || adminData;
  const narrow = adminIsNarrow();
  const unscoped = adminNeedsOrgChoice();
  const groups = buildAssignNodeGroups(state.tree, state.orgs);
  const selType = u.assignmentType || null, selId = u.assignmentId || null;
  const prev = selType && selId ? `${selType}:${selId}` : '';
  const actions = narrow ? '' : `
        <button class="btn" data-user-toggle="${escapeHTML(u.id)}">${u.active ? 'Disable' : 'Enable'}</button>
        <button class="btn" data-user-reset="${escapeHTML(u.id)}">Reset password</button>`;
  const checkCell = (narrow || unscoped) ? '<td></td>' : `<td><input type="checkbox" data-user-check="${escapeHTML(u.id)}"${adminUI.peopleChecked.has(u.id) ? ' checked' : ''}></td>`;
  const placement = peopleAssignmentDisplay(u, groups, state.orgs, unscoped);
  let assignCell;
  if(narrow || placement.readOnly){
    const editBtn = placement.enterOrgId && !narrow
      ? ` <button type="button" class="btn" data-enter-user-org="${escapeHTML(placement.enterOrgId)}">Edit in org</button>`
      : '';
    assignCell = `<td>${escapeHTML(placement.text)}${editBtn}</td>`;
  }else{
    assignCell = `<td><select data-assign-user="${escapeHTML(u.id)}" data-prev="${escapeHTML(prev)}">${renderAssignSelectOptionsHTML(groups, selType, selId)}</select></td>`;
  }
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
  const esc = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : s => String(s);
  const row = document.querySelector(`[data-user-row="${esc(userId)}"]`);
  const u = (adminData.users || []).find(x => x.id === userId);
  if(!row || !u) return;
  row.innerHTML = renderAdminPeopleRowHTML(u);
}

function renderAdminUsersPanelHTML(state){
  const narrow = adminIsNarrow();
  const unscoped = adminNeedsOrgChoice();
  const rows = (state.users || []).map(u =>
    `<tr data-user-row="${escapeHTML(u.id)}" data-username="${escapeHTML((u.username || '').toLowerCase())}">${renderAdminPeopleRowHTML(u, state)}</tr>`
  ).join('');
  const narrowNote = narrow ? '<div class="small-muted">Open on a larger screen to edit</div>' : '';
  const createUserForm = narrow ? '' : unscoped ? `
    <div class="small-muted">Choose an organization on the Organizations tab to create users.</div>
    <button type="button" class="btn" id="adminPeoplePickOrg">Go to Organizations</button>` : `
    <div class="admin-inline-form">
      <input id="adminNewUsername" placeholder="New username" maxlength="32">
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

function selectedAdminUserIds(){
  return Array.from(document.querySelectorAll('[data-user-check]'))
    .filter(cb => cb.checked)
    .map(cb => cb.dataset.userCheck);
}

function refreshAdminBulkBar(){
  const bar = document.getElementById('adminBulkBar');
  if(!bar) return;
  if(adminIsNarrow() || adminNeedsOrgChoice()){ bar.hidden = true; bar.innerHTML = ''; return; }
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
  adminUI.peopleSearch = e.target.value;
  applyAdminPeopleSearch();
});

document.getElementById('adminPeopleSection')?.addEventListener('click', (e) => {
  const enterOrgBtn = e.target.closest('[data-enter-user-org]');
  if(enterOrgBtn){
    e.stopPropagation();
    enterAdminOrgContext(enterOrgBtn.dataset.enterUserOrg);
    return;
  }
  if(e.target.id === 'adminPeoplePickOrg'){
    e.stopPropagation();
    switchAdminSection('orgs');
    return;
  }
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
    if(adminNeedsOrgChoice()){ showToast('Choose an organization first'); return; }
    const nameEl = document.getElementById('adminNewUsername');
    const username = (nameEl.value || '').trim();
    if(!username){ showToast('Enter a username'); return; }
    const role = document.getElementById('adminNewUserAdmin').checked ? 'admin' : 'member';
    const body = { username, role };
    const orgId = adminUI.viewedOrgId || (adminData.tree && adminData.tree.org && adminData.tree.org.id) || null;
    if(!orgId){ showToast('Choose an organization first'); return; }
    body.orgId = orgId;
    api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) })
      .then(res => { window.alert(`User created. Temporary password (shown once): ${res.temporaryPassword}`); nameEl.value = ''; return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
});

document.getElementById('adminPeopleSection')?.addEventListener('change', async (e) => {
  if(e.target.matches('[data-user-check]')){
    const id = e.target.dataset.userCheck;
    if(e.target.checked) adminUI.peopleChecked.add(id); else adminUI.peopleChecked.delete(id);
    refreshAdminBulkBar();
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
