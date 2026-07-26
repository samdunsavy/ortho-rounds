/* Admin console — Structure section: the hospital -> department -> unit ->
   ward tree and its detail panel. Plain script (see admin-console.js's
   header comment for why). This task ports the previous single-file
   command-center tree/detail code over unchanged in behaviour, reading
   adminData/adminUI instead of the old adminState/module adminViewOrgId. */

function isAdminNodeExpanded(key){
  return adminUI.structureExpanded.has(key);
}

function toggleAdminNodeExpanded(key){
  if(adminUI.structureExpanded.has(key)) adminUI.structureExpanded.delete(key);
  else adminUI.structureExpanded.add(key);
}

/** Opens to department level: every hospital and department key, so today's
    single hospital is fully visible without a click. */
function defaultExpandStructure(tree){
  const keys = new Set();
  for(const h of (tree && tree.hospitals) || []){
    keys.add(`hospital:${h.id}`);
    for(const dep of h.departments || []) keys.add(`department:${dep.id}`);
  }
  return keys;
}

function nodeMatchesStructureFilter(node, query){
  const q = (query || '').trim().toLowerCase();
  if(!q) return true;
  return (node.name || '').toLowerCase().includes(q);
}

/** The chain of "type:id" keys from the org down to (but not including) the
    given node — used to auto-expand every ancestor of a filter match. */
function ancestorsOf(tree, type, id){
  const chain = [];
  if(tree && tree.org) chain.push(`org:${tree.org.id}`);
  for(const h of (tree && tree.hospitals) || []){
    if(type === 'hospital' && h.id === id) return chain;
    const withHospital = [...chain, `hospital:${h.id}`];
    for(const dep of h.departments || []){
      if(type === 'department' && dep.id === id) return withHospital;
      const withDep = [...withHospital, `department:${dep.id}`];
      for(const u of dep.units || []){
        if(type === 'unit' && u.id === id) return withDep;
        const withUnit = [...withDep, `unit:${u.id}`];
        for(const w of u.wards || []){
          if(type === 'ward' && w.id === id) return withUnit;
        }
      }
    }
  }
  return [];
}

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

function structureCountLabel(count, unitLabel){
  if(count === null || count === undefined) return '';
  if(unitLabel === 'pinned') return `${count} pinned`;
  return `${count} ${unitLabel}${count === 1 ? '' : 's'}`;
}

function ccRowHTML(type, id, label, count, unitLabel, depth, selection, expandable, expanded){
  const sel = selection && selection.type === type && selection.id === id ? ' is-selected' : '';
  const countLabel = structureCountLabel(count, unitLabel);
  const c = countLabel ? `<span class="cc-count">${escapeHTML(countLabel)}</span>` : '';
  const key = `${type}:${id}`;
  const chevron = expandable
    ? `<button type="button" class="admin-cc-chevron" data-toggle-expand="${escapeHTML(key)}" aria-expanded="${!!expanded}" aria-label="${expanded ? 'Collapse' : 'Expand'}">${expanded ? '▾' : '▸'}</button>`
    : '<span class="admin-cc-chevron-spacer"></span>';
  return `<span class="admin-cc-row-wrap" data-depth="${depth}">${chevron}<button type="button" data-node="${escapeHTML(key)}" class="admin-cc-row${sel}">${escapeHTML(label)}${c}</button></span>`;
}

function renderAdminTreeHTML(tree, selection, expanded){
  const exp = expanded || adminUI.structureExpanded;
  const q = adminUI.structureFilter || '';
  let out = '';
  if(tree && tree.org){
    out += ccRowHTML('org', tree.org.id, tree.org.name || 'Organization', tree.org.stats ? tree.org.stats.livePatients : null, 'patient', 0, selection, false, false);
  }
  for(const h of (tree && tree.hospitals) || []){
    const hExpanded = exp.has(`hospital:${h.id}`);
    const hasMatch = (h.departments || []).some(dep => nodeMatchesStructureFilter(dep, q) || (dep.units || []).some(u => nodeMatchesStructureFilter(u, q) || (u.wards || []).some(w => nodeMatchesStructureFilter(w, q))));
    if(q && !nodeMatchesStructureFilter(h, q) && !hasMatch) continue;
    out += ccRowHTML('hospital', h.id, h.name, h.stats ? h.stats.livePatients : null, 'patient', 0, selection, true, hExpanded || (q && hasMatch));
    if(!hExpanded && !(q && hasMatch)) continue;
    for(const dep of h.departments || []){
      const depExpanded = exp.has(`department:${dep.id}`);
      const depHasMatch = (dep.units || []).some(u => nodeMatchesStructureFilter(u, q) || (u.wards || []).some(w => nodeMatchesStructureFilter(w, q)));
      if(q && !nodeMatchesStructureFilter(dep, q) && !depHasMatch) continue;
      out += ccRowHTML('department', dep.id, dep.name, dep.stats.livePatients, 'patient', 1, selection, true, depExpanded || (q && depHasMatch));
      if(!depExpanded && !(q && depHasMatch)) continue;
      for(const u of dep.units || []){
        const uExpanded = exp.has(`unit:${u.id}`);
        const uHasMatch = (u.wards || []).some(w => nodeMatchesStructureFilter(w, q));
        if(q && !nodeMatchesStructureFilter(u, q) && !uHasMatch) continue;
        out += ccRowHTML('unit', u.id, u.name, u.stats.livePatients, 'patient', 2, selection, !!(u.wards || []).length, uExpanded || (q && uHasMatch));
        if((u.wards || []).length && !uExpanded && !(q && uHasMatch)) continue;
        for(const w of u.wards || []){
          if(q && !nodeMatchesStructureFilter(w, q)) continue;
          out += ccRowHTML('ward', w.id, w.name, w.stats.livePatients, 'pinned', 3, selection, false, false);
        }
      }
    }
  }
  return out;
}

function selectAdminNode(type, id){
  adminUI.selectedNode = id ? { type, id } : { type };
  renderAdminStructureBody();
}

function childTypeOf(type){
  return { org: 'hospital', hospital: 'department', department: 'unit', unit: 'ward' }[type] || null;
}

function addChildRouteFor(type){
  return {
    org: { path: '/api/admin/hospitals', parentKey: 'orgId' },
    hospital: { path: '/api/admin/departments', parentKey: 'hospitalId' },
    department: { path: '/api/admin/units', parentKey: 'departmentId' },
    unit: { path: '/api/admin/wards', parentKey: 'unitId' }
  }[type] || null;
}

function childListOf(type, node){
  if(type === 'org') return node.hospitals || [];
  if(type === 'hospital') return node.departments || [];
  if(type === 'department') return node.units || [];
  if(type === 'unit') return node.wards || [];
  return [];
}

function nodeStatsHTML(node, type){
  const s = node.stats;
  if(!s) return '';
  const label = type === 'unit' ? `${s.livePatients} patient${s.livePatients === 1 ? '' : 's'} in this unit`
    : type === 'ward' ? `${s.livePatients} pinned to this ward`
    : `${s.livePatients} live patient${s.livePatients === 1 ? '' : 's'}`;
  return `
    <div class="small-muted">${label} · ${s.users} user${s.users === 1 ? '' : 's'}</div>
    ${renderAdminStatusBar(s.byStatus, s.livePatients)}
    <div class="small-muted">${s.lastActivity ? 'Active ' + formatRelativeTime(s.lastActivity) : 'No activity yet'}</div>`;
}

function renderAdminDetailHTML(state){
  const sel = state.selection;
  if(!sel) return '<div class="small-muted">Select something on the left.</div>';
  let hit;
  if(sel.type === 'org'){
    if(!state.tree || !state.tree.org) return `<div class="small-muted">That item no longer exists.</div>`;
    hit = { node: { id: state.tree.org.id, name: state.tree.org.name || 'Organization', stats: state.tree.org.stats, hospitals: state.tree.hospitals || [] }, parentType: null, parentId: null };
  } else {
    hit = findAdminNode(state.tree, sel.type, sel.id);
    if(!hit) return `<div class="small-muted">That item no longer exists.</div>`;
  }
  const { node } = hit;
  const kids = childListOf(sel.type, node);
  const childType = childTypeOf(sel.type);
  const kidsHTML = kids.length
    ? kids.map(k => `<button type="button" class="admin-cc-row" data-node="${escapeHTML(childType)}:${escapeHTML(k.id)}">${escapeHTML(k.name)}<span class="cc-count">${k.stats ? k.stats.livePatients : ''}</span></button>`).join('')
    : (childType ? `<div class="small-muted">No ${childType}s yet.</div>` : `<div class="small-muted">No contents.</div>`);
  const addChild = (childType && !adminIsNarrow()) ? `
    <div class="admin-inline-form">
      <input placeholder="New ${escapeHTML(childType)} name" maxlength="80" data-new-child-name="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">
      <button class="btn" data-add-child="${escapeHTML(sel.type)}:${escapeHTML(sel.id)}">Add ${escapeHTML(childType)}</button>
    </div>` : '';
  return `
    <div class="admin-detail-head">
      <h3>${escapeHTML(node.name)}</h3>
      <span class="spec-badge">${escapeHTML(humanNodeType(sel.type))}</span>
      ${renderAdminNodeActionsHTML(state, sel, hit)}
    </div>
    ${nodeStatsHTML(node, sel.type)}
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

function deleteBlockedReason(node, type){
  const bits = [];
  const kids = childListOf(type, node).length;
  if(kids) bits.push(`${kids} ${childTypeOf(type)}${kids === 1 ? '' : 's'}`);
  if(node.stats && node.stats.livePatients) bits.push(`${node.stats.livePatients} patient${node.stats.livePatients === 1 ? '' : 's'}`);
  if(node.stats && node.stats.users) bits.push(`${node.stats.users} user${node.stats.users === 1 ? '' : 's'}`);
  return bits.join(', ');
}

function adminIsNarrow(){
  return typeof window !== 'undefined' && window.innerWidth < 900;
}

function renderAdminNodeActionsHTML(state, sel, hit){
  if(adminIsNarrow()) return '<span class="small-muted">Open on a larger screen to edit</span>';
  const key = `${sel.type}:${sel.id}`;
  if(sel.type === 'org'){
    return `<span class="admin-node-actions"><button class="btn" data-rename-node="${escapeHTML(key)}">Rename</button></span>`;
  }
  const blocked = deleteBlockedReason(hit.node, sel.type);
  const parents = validMoveParents(state.tree, sel.type, hit.parentId);
  const moveHTML = MOVE_PARENT_TYPE[sel.type] ? `
    <select data-move-node="${escapeHTML(key)}">
      <option value="">Move to…</option>
      ${parents.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}
    </select>` : '';
  const deleteLabel = blocked ? `Can't delete — ${escapeHTML(blocked)}` : 'Delete';
  return `
    <span class="admin-node-actions">
      <button class="btn" data-rename-node="${escapeHTML(key)}">Rename</button>
      ${moveHTML}
      <button class="btn" data-delete-node="${escapeHTML(key)}"${blocked ? ' disabled' : ''} title="${escapeHTML(deleteLabel)}">${escapeHTML(deleteLabel)}</button>
    </span>`;
}

function renderAdminStructureSection(){
  const needsOrg = adminNeedsOrgChoice();
  const chooser = document.getElementById('adminStructureChooser');
  const body = document.getElementById('adminStructureBody');
  if(chooser) chooser.hidden = !needsOrg;
  if(body) body.hidden = needsOrg;
  if(needsOrg) return;
  renderAdminStructureBody();
}

function renderAdminStructureBody(){
  if(adminData.tree && !adminUI.structureInitialized){
    adminUI.structureExpanded = defaultExpandStructure(adminData.tree);
    adminUI.structureInitialized = true;
  }
  const rail = document.getElementById('adminTreeRail');
  if(rail){
    rail.innerHTML = `
      <label for="adminStructureFilter" class="sr-only">Filter the tree by name</label>
      <input id="adminStructureFilter" placeholder="Filter…" value="${escapeHTML(adminUI.structureFilter)}">
      <div class="admin-cc-rows">${renderAdminTreeHTML(adminData.tree, adminUI.selectedNode)}</div>`;
  }
  const detail = document.getElementById('adminDetailPane');
  if(detail) detail.innerHTML = renderAdminDetailHTML({ tree: adminData.tree, users: adminData.users, orgs: adminData.orgs, selection: adminUI.selectedNode });
}

document.getElementById('adminStructureSection')?.addEventListener('click', (e) => {
  const chevron = e.target.closest('[data-toggle-expand]');
  if(chevron){
    e.stopPropagation();
    toggleAdminNodeExpanded(chevron.dataset.toggleExpand);
    renderAdminStructureBody();
    return;
  }
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
    const body = route.parentKey ? { [route.parentKey]: parentId, name } : { name };
    api(route.path, { method: 'POST', body: JSON.stringify(body) })
      .then(() => { invalidateHierarchyCaches(); return loadAdminView(); })
      .catch(err => showToast(err.message));
    return;
  }
  const renameBtn = e.target.closest('[data-rename-node]');
  if(renameBtn){
    e.stopPropagation();
    const raw = renameBtn.dataset.renameNode;
    const i = raw.indexOf(':');
    const type = raw.slice(0, i), id = raw.slice(i + 1);
    const hit = findAdminNode(adminData.tree, type, id);
    const next = window.prompt('New name', hit ? hit.node.name : '');
    if(next === null) return;
    const name = next.trim();
    if(!name || name.length > 80){ showToast('Name required (max 80 chars)'); return; }
    api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) })
      .then(() => { invalidateHierarchyCaches(); return loadAdminView(); })
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
    if(!window.confirm(`Delete this ${humanNodeType(type)}? This cannot be undone.`)) return;
    api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(() => { invalidateHierarchyCaches(); adminUI.selectedNode = null; return loadAdminView(); })
      .catch(err => showToast(describeDeleteBlock(err) || err.message));
    return;
  }
  const row = e.target.closest('[data-node]');
  if(!row) return;
  const raw = row.dataset.node;
  const i = raw.indexOf(':');
  if(i === -1) selectAdminNode(raw, null);
  else selectAdminNode(raw.slice(0, i), raw.slice(i + 1));
});

document.getElementById('adminStructureSection')?.addEventListener('input', (e) => {
  if(e.target.id !== 'adminStructureFilter') return;
  adminUI.structureFilter = e.target.value;
  if(adminUI.structureFilter.trim()){
    const walk = (type, id, name) => {
      if(nodeMatchesStructureFilter({ name }, adminUI.structureFilter)){
        for(const key of ancestorsOf(adminData.tree, type, id)) adminUI.structureExpanded.add(key);
      }
    };
    for(const h of (adminData.tree && adminData.tree.hospitals) || []){
      walk('hospital', h.id, h.name);
      for(const dep of h.departments || []){
        walk('department', dep.id, dep.name);
        for(const u of dep.units || []){
          walk('unit', u.id, u.name);
          for(const w of u.wards || []) walk('ward', w.id, w.name);
        }
      }
    }
  }
  const rail = document.getElementById('adminTreeRail');
  const focused = document.activeElement === document.getElementById('adminStructureFilter');
  const rows = rail && rail.querySelector('.admin-cc-rows');
  if(rows) rows.innerHTML = renderAdminTreeHTML(adminData.tree, adminUI.selectedNode);
  if(focused) document.getElementById('adminStructureFilter').focus();
});

document.getElementById('adminStructureSection')?.addEventListener('change', async (e) => {
  const moveSel = e.target.closest('[data-move-node]');
  if(moveSel){
    const newParentId = moveSel.value;
    if(!newParentId) return;
    const raw = moveSel.dataset.moveNode;
    const i = raw.indexOf(':');
    const type = raw.slice(0, i), id = raw.slice(i + 1);
    api(`/api/admin/nodes/${encodeURIComponent(type)}/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify({ newParentId }) })
      .then(() => { invalidateHierarchyCaches(); return loadAdminView(); })
      .catch(err => { showToast(err.message); loadAdminView(); });
  }
});
