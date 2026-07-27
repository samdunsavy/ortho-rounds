/* Admin console — People section: user list, create, role, placement,
   bulk assign. Plain script (see admin-console.js's header comment). This
   task ports the old users-table code over unchanged in behaviour, reading
   adminData/adminUI instead of adminState. */

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

function isSelfUser(u){
  return u.username === localStorage.getItem('ortho_username');
}

/** Icon glyph for each People filter chip. Only the chips that actually
    exist in renderAdminUsersPanelHTML's chip list get an icon here. */
const ADMIN_PEOPLE_FILTER_ICONS = { all: 'users', unassigned: 'map-pin-off', disabled: 'user-check', admins: 'user-check' };

/** Semantic status chip for a person row/card. Priority: a disabled account
    always reads "Disabled" even if it also happens to be unassigned or
    stale, since that's the more actionable fact. isStale is passed in by
    the caller (which already has assignLabelFor's groups on hand) rather
    than recomputed here. */
function statusChipHTML(u, isStale){
  let kind, label;
  if(!u.active){ kind = 'disabled'; label = 'Disabled'; }
  else if(isStale){ kind = 'stale'; label = 'Stale'; }
  else if(!u.assignmentType || !u.assignmentId){ kind = 'unassigned'; label = 'Unassigned'; }
  else{ kind = 'active'; label = 'Active'; }
  return `<span class="admin-status-chip is-${kind}">${label}</span>`;
}

/** Two-letter initials avatar, e.g. "Amit Roy" -> "AR", "bob" -> "BO". */
function initialsAvatar(username){
  const name = (username || '').trim();
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const initials = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return `<span class="admin-avatar">${escapeHTML((initials || '?').toUpperCase())}</span>`;
}

/** Mirrors the server's own last-admin check in POST .../role (server.js)
    so the client never offers a click that can only 400. */
function isLastActiveAdmin(user, users){
  if(user.role !== 'admin' || !user.active) return false;
  return !(users || []).some(u => u.id !== user.id && u.role === 'admin' && u.active && (u.orgId || null) === (user.orgId || null));
}

function adminPeopleDisableGuard(u, users){
  const self = isSelfUser(u);
  const lastAdmin = isLastActiveAdmin(u, users);
  const guard = self || (u.active && lastAdmin);
  const title = self ? 'You cannot disable your own account' : (u.active && lastAdmin ? 'This is the last active admin — promote someone else first' : '');
  return { guard, title };
}

function adminPeopleRoleGuard(u, users){
  const self = isSelfUser(u);
  const lastAdmin = isLastActiveAdmin(u, users);
  const guard = self || lastAdmin;
  const title = self ? 'You cannot change your own role' : (lastAdmin ? 'This is the last active admin of the organization' : '');
  return { guard, title };
}

function matchesAdminPeopleFilter(u, filter){
  if(filter === 'unassigned') return !u.assignmentType || !u.assignmentId;
  if(filter === 'disabled') return !u.active;
  if(filter === 'admins') return u.role === 'admin';
  if(filter === 'stale') return !!(u.assignmentType && u.assignmentId && !assignLabelFor(buildAssignNodeGroups(adminData.tree, adminData.orgs), u.assignmentType, u.assignmentId));
  if(filter && filter.startsWith('node:')){
    const [, type, id] = filter.split(':');
    return u.assignmentType === type && u.assignmentId === id;
  }
  return true; // 'all'
}

function orgNameForUser(user, orgs){
  const hit = (orgs || []).find(o => o.id === user.orgId);
  return hit ? hit.name : (user.orgId || 'their organization');
}

/** stale: true only in the one branch where we can actually confirm the
    assignment points nowhere (not unscoped, no matching node) — an
    unscoped "Within OrgName" fallback isn't necessarily stale, just
    unresolvable from this context, so it must not be flagged as such. */
function peopleAssignmentDisplay(u, groups, orgs, unscoped){
  const selType = u.assignmentType || null, selId = u.assignmentId || null;
  if(!selType || !selId) return { text: '—', readOnly: unscoped, enterOrgId: null, stale: false };
  const label = assignLabelFor(groups, selType, selId);
  if(label) return { text: label, readOnly: unscoped, enterOrgId: unscoped && u.orgId ? u.orgId : null, stale: false };
  if(unscoped) return { text: `Within ${orgNameForUser(u, orgs)}`, readOnly: true, enterOrgId: u.orgId || null, stale: false };
  return { text: 'assigned to a place that no longer exists', readOnly: false, enterOrgId: null, stale: true };
}

function renderAdminPeopleRowHTML(u, state){
  state = state || adminData;
  const unscoped = adminNeedsOrgChoice();
  const groups = buildAssignNodeGroups(state.tree, state.orgs);
  const selType = u.assignmentType || null, selId = u.assignmentId || null;
  const prev = selType && selId ? `${selType}:${selId}` : '';
  const users = state.users || adminData.users;
  const { guard: disableGuard, title: disableTitle } = adminPeopleDisableGuard(u, users);
  const disableAttrs = disableGuard ? ` disabled title="${escapeHTML(disableTitle)}"` : '';
  const { guard: roleDisabled, title: roleTitle } = adminPeopleRoleGuard(u, users);
  const self = isSelfUser(u);
  const actions = `
        <button class="btn" data-user-toggle="${escapeHTML(u.id)}"${disableAttrs}>${u.active ? 'Disable' : 'Enable'}</button>
        <button class="btn" data-user-reset="${escapeHTML(u.id)}">Reset password</button>`;
  const checkCell = unscoped ? '<td></td>' : `<td><input type="checkbox" data-user-check="${escapeHTML(u.id)}"${adminUI.peopleChecked.has(u.id) ? ' checked' : ''}></td>`;
  const placement = peopleAssignmentDisplay(u, groups, state.orgs, unscoped);
  let assignCell;
  if(placement.readOnly){
    const editBtn = placement.enterOrgId
      ? ` <button type="button" class="btn" data-enter-user-org="${escapeHTML(placement.enterOrgId)}">Edit in org</button>`
      : '';
    assignCell = `<td>${escapeHTML(placement.text)}${editBtn}</td>`;
  }else{
    assignCell = `<td><select data-assign-user="${escapeHTML(u.id)}" data-prev="${escapeHTML(prev)}">${renderAssignSelectOptionsHTML(groups, selType, selId)}</select></td>`;
  }
  const nameCell = `${initialsAvatar(u.username)} <span class="admin-people-name">${escapeHTML(u.username)}${self ? ' <span class="spec-badge">You</span>' : ''}</span> ${statusChipHTML(u, placement.stale)}`;
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

function renderAdminPeopleCard(userId){
  const esc = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : s => String(s);
  const card = document.querySelector(`[data-user-card="${esc(userId)}"]`);
  const u = (adminData.users || []).find(x => x.id === userId);
  if(!card || !u) return;
  const expanded = card.classList.contains('is-expanded');
  card.outerHTML = renderAdminPeopleCardHTML(u);
  if(expanded){
    document.querySelector(`[data-user-card="${esc(userId)}"]`)?.classList.add('is-expanded');
  }
}

/** Keeps Disable disabled/title and role-select guards in sync when the user
    list changes (e.g. one of two org admins was disabled — the survivor
    becomes last active admin). */
function refreshAdminPeopleRowGuards(){
  const users = adminData.users || [];
  const applyToggle = (root, u) => {
    const btn = root.querySelector('[data-user-toggle]');
    if(!u || !btn) return;
    const { guard, title } = adminPeopleDisableGuard(u, users);
    btn.disabled = guard;
    if(guard) btn.title = title;
    else btn.removeAttribute('title');
  };
  const applyRole = (root, u) => {
    const roleSel = root.querySelector('[data-role-user]');
    if(!u || !roleSel) return;
    const { guard, title } = adminPeopleRoleGuard(u, users);
    roleSel.disabled = guard;
    if(guard) roleSel.title = title;
    else roleSel.removeAttribute('title');
  };
  document.querySelectorAll('[data-user-row]').forEach(tr => {
    const u = users.find(x => x.id === tr.dataset.userRow);
    applyToggle(tr, u);
    applyRole(tr, u);
  });
  document.querySelectorAll('[data-user-card]').forEach(card => {
    const u = users.find(x => x.id === card.dataset.userCard);
    applyToggle(card, u);
    applyRole(card, u);
  });
}

function renderAdminPeopleCardHTML(u, state){
  state = state || adminData;
  const unscoped = adminNeedsOrgChoice();
  const groups = buildAssignNodeGroups(state.tree, state.orgs);
  const selType = u.assignmentType || null, selId = u.assignmentId || null;
  const prev = selType && selId ? `${selType}:${selId}` : '';
  const users = state.users || adminData.users;
  const { guard: disableGuard, title: disableTitle } = adminPeopleDisableGuard(u, users);
  const disableAttrs = disableGuard ? ` disabled title="${escapeHTML(disableTitle)}"` : '';
  const { guard: roleDisabled, title: roleTitle } = adminPeopleRoleGuard(u, users);
  const self = isSelfUser(u);
  const placement = peopleAssignmentDisplay(u, groups, state.orgs, unscoped);
  const checkHTML = unscoped ? '' : `<input type="checkbox" data-user-check="${escapeHTML(u.id)}"${adminUI.peopleChecked.has(u.id) ? ' checked' : ''}>`;
  const roleHTML = `<select data-role-user="${escapeHTML(u.id)}"${roleDisabled ? ` disabled title="${escapeHTML(roleTitle)}"` : ''}>
        <option value="member"${u.role === 'member' ? ' selected' : ''}>Member</option>
        <option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin</option>
      </select>`;
  let assignHTML;
  if(placement.readOnly){
    const editBtn = placement.enterOrgId
      ? ` <button type="button" class="btn" data-enter-user-org="${escapeHTML(placement.enterOrgId)}">Edit in org</button>`
      : '';
    const assignText = placement.text === '—' ? 'Not assigned' : placement.text;
    assignHTML = `<span>${escapeHTML(assignText)}</span>${editBtn}`;
  }else{
    assignHTML = `<select data-assign-user="${escapeHTML(u.id)}" data-prev="${escapeHTML(prev)}">${renderAssignSelectOptionsHTML(groups, selType, selId)}</select>`;
  }
  return `<div class="admin-people-card" data-user-card="${escapeHTML(u.id)}" data-username="${escapeHTML((u.username || '').toLowerCase())}">
    <div class="admin-people-card-head" data-card-toggle="${escapeHTML(u.id)}">
      <span class="admin-people-card-title">
        ${initialsAvatar(u.username)}
        <strong>${escapeHTML(u.username)}${self ? ' <span class="spec-badge">You</span>' : ''}</strong>
      </span>
      ${statusChipHTML(u, placement.stale)}
    </div>
    <div class="admin-people-card-body">
      ${checkHTML}
      <div class="admin-people-card-field">
        <span class="small-muted">Role</span>
        ${roleHTML}
      </div>
      <div class="admin-people-card-field admin-people-card-assign">
        <span class="small-muted">Can see patients in</span>
        ${assignHTML}
      </div>
      <div class="admin-inline-form">
        <button class="btn" data-user-toggle="${escapeHTML(u.id)}"${disableAttrs}>${u.active ? 'Disable' : 'Enable'}</button>
        <button class="btn" data-user-reset="${escapeHTML(u.id)}">Reset password</button>
      </div>
    </div>
  </div>`;
}

function renderAdminUsersPanelHTML(state){
  const unscoped = adminNeedsOrgChoice();
  const groups = buildAssignNodeGroups(state.tree, state.orgs);
  const rows = (state.users || []).map(u =>
    `<tr data-user-row="${escapeHTML(u.id)}" data-username="${escapeHTML((u.username || '').toLowerCase())}">${renderAdminPeopleRowHTML(u, state)}</tr>`
  ).join('');
  const cards = (state.users || []).map(u => renderAdminPeopleCardHTML(u, state)).join('');
  const createUserForm = unscoped ? `
    <div class="small-muted">Choose an organization on the Organizations section to create users.</div>
    <button type="button" class="btn" id="adminPeoplePickOrg">Go to Organizations</button>` : `
    <div class="admin-inline-form">
      <label for="adminNewUsername" class="sr-only">New username</label>
      <input id="adminNewUsername" placeholder="New username" maxlength="32">
      <label class="scribe-check"><input type="checkbox" id="adminNewUserAdmin"> Admin</label>
      <label for="adminNewUserPlacement" class="sr-only">Can see patients in</label>
      <select id="adminNewUserPlacement">${renderAssignSelectOptionsHTML(groups, null, null)}</select>
      <button class="btn" id="adminCreateUser">Create person</button>
    </div>`;
  const chips = ['all', 'unassigned', 'disabled', 'admins'].map(f =>
    `<button type="button" class="admin-people-chip${f === adminUI.peopleFilter ? ' is-active' : ''}" data-people-filter="${f}">${icon(ADMIN_PEOPLE_FILTER_ICONS[f])}<span>${f[0].toUpperCase() + f.slice(1)}</span></button>`
  ).join('');
  const emptyList = !(state.users || []).length
    ? `<div class="admin-empty" id="adminPeopleEmpty">No people yet.</div>`
    : `<div class="admin-empty" id="adminPeopleEmptyFilter" hidden>No people match.</div>`;
  return `
    <div class="admin-detail-head"><h3>People</h3></div>
    <div class="admin-inline-form">
      <label for="adminUserSearch" class="sr-only">Search people</label>
      <input id="adminUserSearch" placeholder="Search people…">
    </div>
    <div class="admin-people-chips">${chips}</div>
    ${createUserForm}
    <div id="adminBulkBar" class="admin-bulk-bar" hidden></div>
    <table class="admin-users-table">
      <thead><tr><th></th><th>Person</th><th>Role</th><th>Can see patients in</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="admin-people-cards">${cards}</div>
    ${emptyList}`;
}

function applyAdminPeopleFilters(){
  const q = adminUI.peopleSearch.trim().toLowerCase();
  const apply = (el, userId) => {
    const u = (adminData.users || []).find(x => x.id === userId);
    const username = (el.dataset.username || '').toLowerCase();
    const matchesSearch = !q || username.includes(q);
    const matchesFilter = !u || matchesAdminPeopleFilter(u, adminUI.peopleFilter);
    el.style.display = matchesSearch && matchesFilter ? '' : 'none';
  };
  document.querySelectorAll('[data-user-row]').forEach(tr => apply(tr, tr.dataset.userRow));
  document.querySelectorAll('[data-user-card]').forEach(card => apply(card, card.dataset.userCard));
  const filterEmpty = document.getElementById('adminPeopleEmptyFilter');
  if(filterEmpty){
    const anyVisible = [...document.querySelectorAll('[data-user-row]')].some(el => el.style.display !== 'none');
    filterEmpty.hidden = anyVisible || !(adminData.users || []).length;
  }
}

function applyAdminPeopleChecked(){
  document.querySelectorAll('[data-user-check]').forEach(cb => {
    cb.checked = adminUI.peopleChecked.has(cb.dataset.userCheck);
  });
}

function renderAdminPeopleSection(){
  const el = document.getElementById('adminPeopleSection');
  if(!el) return;
  restoreAdminFocus('#adminUserSearch', () => {
    el.innerHTML = renderAdminUsersPanelHTML(adminData);
    const search = document.getElementById('adminUserSearch');
    if(search) search.value = adminUI.peopleSearch;
    applyAdminPeopleFilters();
    applyAdminPeopleChecked();
    refreshAdminBulkBar();
  });
}

function selectedAdminUserIds(){
  return [...new Set(Array.from(document.querySelectorAll('[data-user-check]'))
    .filter(cb => cb.checked)
    .map(cb => cb.dataset.userCheck))];
}

function refreshAdminBulkBar(){
  const bar = document.getElementById('adminBulkBar');
  if(!bar) return;
  if(adminNeedsOrgChoice()){ bar.hidden = true; bar.innerHTML = ''; return; }
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
  applyAdminPeopleFilters();
});

document.getElementById('adminPeopleSection')?.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-people-filter]');
  if(chip){
    adminUI.peopleFilter = chip.dataset.peopleFilter;
    document.querySelectorAll('[data-people-filter]').forEach(b => b.classList.toggle('is-active', b === chip));
    applyAdminPeopleFilters();
    return;
  }
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
    const groups = buildAssignNodeGroups(adminData.tree, adminData.orgs);
    const targetLabel = nodeType ? (assignLabelFor(groups, nodeType, nodeId) || 'that place') : 'no placement';
    api('/api/admin/users/assign-bulk', { method: 'POST', body: JSON.stringify({ userIds: ids, nodeType, nodeId }) })
      .then(async res => {
        const msg = `Assigned ${res.assigned} ${res.assigned === 1 ? 'person' : 'people'} to ${targetLabel}`;
        showToast(msg);
        await loadAdminView();
        applyAdminPeopleFilters();
        const bar = document.getElementById('adminBulkBar');
        if(bar && selectedAdminUserIds().length){
          bar.hidden = false;
          bar.textContent = msg;
        }
      })
      .catch(err => showToast(err.message));
    return;
  }
  const cardToggle = e.target.closest('[data-card-toggle]');
  if(cardToggle){
    cardToggle.closest('.admin-people-card')?.classList.toggle('is-expanded');
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
        renderAdminPeopleCard(id);
        refreshAdminPeopleRowGuards();
        applyAdminPeopleFilters();
      }catch(err){ showToast(err.message); }
    })();
    return;
  }
  const resetBtn = e.target.closest('[data-user-reset]');
  if(resetBtn){
    e.stopPropagation();
    const id = resetBtn.dataset.userReset;
    api(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST' })
      .then(res => showAdminSecret('Password reset', res.temporaryPassword))
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
    const orgId = adminUI.viewedOrgId || (adminData.tree && adminData.tree.org && adminData.tree.org.id) || null;
    if(!orgId){ showToast('Choose an organization first'); return; }
    const placement = document.getElementById('adminNewUserPlacement').value;
    const body = { username, role, orgId };
    let nodeType = null, nodeId = null;
    if(placement){
      const i = placement.indexOf(':');
      nodeType = placement.slice(0, i);
      nodeId = placement.slice(i + 1);
    }
    api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) })
      .then(async res => {
        if(nodeType){
          try{
            await api(`/api/admin/users/${res.id}/assign`, { method: 'POST', body: JSON.stringify({ nodeType, nodeId }) });
          }catch(err){
            showToast(err.message);
          }
        }
        nameEl.value = '';
        document.getElementById('adminNewUserPlacement').value = '';
        try{
          await loadAdminView();
        }catch(err){
          showToast(err.message);
        }
        await showAdminSecret('Person created', res.temporaryPassword);
      })
      .catch(err => showToast(err.message));
    return;
  }
});

function adminEscId(id){
  return (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : String(id);
}

function adminAssignNoteHost(sel){
  return sel.closest('.admin-people-card-assign') || sel.closest('td') || sel.parentElement;
}

function showAdminAssignNote(userId, text, isError){
  document.querySelectorAll(`[data-assign-user="${adminEscId(userId)}"]`).forEach(sel => {
    const host = adminAssignNoteHost(sel);
    host?.querySelectorAll('.admin-inline-note').forEach(n => n.remove());
    const note = document.createElement('span');
    note.className = isError ? 'admin-inline-note admin-inline-note-error' : 'admin-inline-note';
    note.textContent = text;
    host?.appendChild(note);
    if(!isError) setTimeout(() => note.remove(), 2500);
  });
}

function syncAdminAssignSelects(userId, value){
  document.querySelectorAll(`[data-assign-user="${adminEscId(userId)}"]`).forEach(s => {
    s.value = value;
    s.dataset.prev = value;
  });
}

function syncAdminRoleSelects(userId, role){
  document.querySelectorAll(`[data-role-user="${adminEscId(userId)}"]`).forEach(s => { s.value = role; });
}

document.getElementById('adminPeopleSection')?.addEventListener('change', async (e) => {
  if(e.target.matches('[data-user-check]')){
    const id = e.target.dataset.userCheck;
    if(e.target.checked) adminUI.peopleChecked.add(id); else adminUI.peopleChecked.delete(id);
    applyAdminPeopleChecked();
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
    if(!ok){ syncAdminRoleSelects(id, prevRole); return; }
    try{
      await api(`/api/admin/users/${encodeURIComponent(id)}/role`, { method: 'POST', body: JSON.stringify({ role: newRole }) });
      showToast('Role updated');
      await loadAdminView();
    }catch(err){
      syncAdminRoleSelects(id, prevRole);
      showToast(err.message);
    }
    return;
  }
  const sel = e.target.closest('[data-assign-user]');
  if(sel){
    const raw = sel.value;
    const sepIdx = raw.indexOf(':');
    const nodeType = sepIdx === -1 ? null : raw.slice(0, sepIdx);
    const nodeId = sepIdx === -1 ? null : raw.slice(sepIdx + 1);
    const userId = sel.dataset.assignUser;
    const prev = sel.dataset.prev || '';
    try{
      await api(`/api/admin/users/${userId}/assign`, { method: 'POST', body: JSON.stringify({ nodeType, nodeId }) });
      const u = (adminData.users || []).find(x => x.id === userId);
      if(u){ u.assignmentType = nodeType; u.assignmentId = nodeId; }
      renderAdminPeopleRow(userId);
      renderAdminPeopleCard(userId);
      syncAdminAssignSelects(userId, raw);
      applyAdminPeopleFilters();
      showAdminAssignNote(userId, 'Saved', false);
    }catch(err){
      syncAdminAssignSelects(userId, prev);
      showAdminAssignNote(userId, err.message, true);
    }
    return;
  }
});
