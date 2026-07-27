/* Admin console — Organizations section: instance-admin only. Plain script
   (see admin-console.js's header comment). Ported from the old orgs-tab
   code, reading adminUI.viewedOrgId instead of the old module adminViewOrgId. */

/** Selects an org in the rail and re-renders the detail pane. */
function selectAdminOrg(id){
  adminUI.selectedOrgId = id;
  renderAdminOrgsSection();
}

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
    </div>` : `<div class="admin-empty">No organizations yet.</div>`;
  const repairHTML = isInstanceAdminUser()
    ? `<div class="admin-inline-form"><button class="btn" data-repair-ancestry>${icon('sitemap')} Repair ancestry</button></div>`
    : '';
  el.innerHTML = `
    <h3>Organizations</h3>
    <div class="admin-cc" id="adminOrgsBody">
      <aside class="admin-cc-rail" id="adminOrgsRail">${rail}</aside>
      <section class="admin-cc-detail" id="adminOrgsDetail">${detail}</section>
    </div>
    <div class="admin-inline-form">
      <input placeholder="New organization name" id="adminNewOrgName" maxlength="80">
      <button class="btn" id="adminAddOrgBtn">${icon('plus')} Create organization</button>
    </div>
    ${repairHTML}`;
  const detailEl = document.getElementById('adminOrgsDetail');
  if(detailEl){
    detailEl.classList.remove('admin-motion-slide-in');
    void detailEl.offsetWidth; // restart CSS animation on re-select
    detailEl.classList.add('admin-motion-slide-in');
  }
}

/** Leave a drilled-in org and go back to the all-orgs list. */
function exitAdminOrgContext(){
  adminUI.viewedOrgId = null;
  adminUI.selectedNode = null;
  switchAdminSection('orgs');
  loadAdminView().catch(err => showToast(err.message || 'Could not load admin data'));
}

/** Enter an org's tree. Selection is dropped so a node picked in the
    previous org cannot render as "That item no longer exists" here. */
function enterAdminOrgContext(orgId){
  adminUI.viewedOrgId = orgId;
  adminUI.selectedNode = null;
  switchAdminSection('structure');
  loadAdminView().catch(err => showToast(err.message || 'Could not load admin data'));
}

document.getElementById('adminOrgsSection')?.addEventListener('click', (e) => {
  const selBtn = e.target.closest('[data-org-select]');
  if(selBtn){
    e.stopPropagation();
    selectAdminOrg(selBtn.dataset.orgSelect);
    return;
  }
  const viewOrgBtn = e.target.closest('[data-view-org]');
  if(viewOrgBtn){
    e.stopPropagation();
    enterAdminOrgContext(viewOrgBtn.dataset.viewOrg);
    return;
  }
  if(e.target.closest('#adminAddOrgBtn')){
    e.stopPropagation();
    const input = document.getElementById('adminNewOrgName');
    const name = (input && input.value || '').trim();
    if(!name){ showToast('Enter an organization name'); return; }
    api('/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name }) })
      .then(() => { input.value = ''; return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
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
