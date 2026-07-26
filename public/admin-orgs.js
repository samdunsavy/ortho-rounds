/* Admin console — Organizations section: instance-admin only. Plain script
   (see admin-console.js's header comment). Ported from the old orgs-tab
   code, reading adminUI.viewedOrgId instead of the old module adminViewOrgId. */

function renderAdminOrgsSection(){
  const el = document.getElementById('adminOrgsSection');
  if(!el) return;
  el.innerHTML = `<h3>Organizations</h3>` + (adminData.orgs || []).map(o => `
    <div class="admin-org-card" data-org-id="${escapeHTML(o.id)}">
      <strong>${escapeHTML(o.name)}</strong> <span class="spec-badge">${escapeHTML(o.plan)}</span>
      <div class="small-muted">${o.stats.hospitals} hospitals · ${o.stats.departments} departments · ${o.stats.users} users · ${o.stats.livePatients} live patients</div>
      <div class="admin-inline-form">
        <input placeholder="New org admin username" maxlength="32" data-new-org-admin="${escapeHTML(o.id)}">
        <button class="btn" data-create-org-admin="${escapeHTML(o.id)}">Create org admin</button>
        <button class="btn" data-view-org="${escapeHTML(o.id)}">View</button>
      </div>
    </div>`).join('') + `
    <div class="admin-inline-form">
      <input placeholder="New organization name" id="adminNewOrgName">
      <button class="btn" id="adminAddOrgBtn">Create organization</button>
    </div>`;
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
  const viewOrgBtn = e.target.closest('[data-view-org]');
  if(viewOrgBtn){
    e.stopPropagation();
    enterAdminOrgContext(viewOrgBtn.dataset.viewOrg);
    return;
  }
  if(e.target.id === 'adminAddOrgBtn'){
    e.stopPropagation();
    const input = document.getElementById('adminNewOrgName');
    const name = (input && input.value || '').trim();
    if(!name){ showToast('Enter an organization name'); return; }
    api('/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name }) })
      .then(() => { input.value = ''; return loadAdminView(); })
      .catch(err => showToast(err.message));
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
