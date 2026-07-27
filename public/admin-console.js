/* Admin console — shared core: state, the section shell, and Overview.
   Plain script, not a module: function declarations must stay global so
   app.js's button handlers and the other admin-*.js files can call them.
   Cross-file calls (e.g. this file calling renderAdminPeopleSection,
   defined in admin-people.js) only ever happen from inside a function body
   that runs later — never at this file's own top level — so the order the
   admin-*.js files load in index.html does not matter. Runtime helpers
   (api, showToast, escapeHTML, formatRelativeTime, isInstanceAdminUser,
   isAdmin, adminUiVisible) come from app.js and are only *called* here. */

/** Server truth: the org tree, the user list, the org list. Replaced
    wholesale by loadAdminView(); nothing else in this file or the other
    admin-*.js files hand-edits it. */
let adminData = { tree: null, users: [], orgs: [] };

/** Everything about what the console is currently showing. Untouched by a
    reload — this is what makes search text, filter chips, tree expansion,
    selection and checked rows survive a mutation instead of being wiped by
    the next loadAdminView() (design spec defect 1). */
let adminUI = {
  section: 'overview',           // 'overview' | 'people' | 'structure' | 'audit' | 'orgs'
  viewedOrgId: null,             // instance admin: which org's tree is loaded
  allOrgs: [],                   // instance admin: every org, kept across a drill-in
  selectedOrgId: null,           // Organizations: rail selection, master-detail
  selectedNode: null,            // Structure: { type, id } | null
  structureExpanded: new Set(),  // Structure: "type:id" keys of expanded rows
  structureInitialized: false,   // Structure: defaults applied once; empty Set is valid
  structureFilter: '',           // Structure: name filter text
  structureMobileDrilled: false, // Structure: phone drill-down flag
  peopleSearch: '',
  peopleFilter: 'all',           // 'all' | 'unassigned' | 'disabled' | 'admins' | 'stale' | 'node:<type>:<id>'
  peopleChecked: new Set(),      // checked user ids, bulk assign
  auditFilters: { action: '', actorId: '', subjectId: '', from: '', to: '', orgId: '' },
  auditEntries: [],
  auditSelectedId: null,
  auditOffset: 0,
  auditLoading: false,
  auditError: null,
  auditHasMore: false,
  busy: false,
  lastLoadedAt: null,            // ms timestamp of the latest successful loadAdminView()
  telemetry: { ok: false, ai: null, storage: null }  // from public GET /api/health via fetch
};

/** Sprite glyph as inline svg. name maps to a <symbol id="ic-<name>">.
    Decorative only — always aria-hidden; callers keep the accessible name. */
function icon(name, cls){
  return `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#ic-${name}"/></svg>`;
}

const ADMIN_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'structure', label: 'Structure' },
  { id: 'audit', label: 'Audit' },
  { id: 'orgs', label: 'Organizations' }
];

function visibleAdminSections(){
  return isInstanceAdminUser() ? ADMIN_SECTIONS : ADMIN_SECTIONS.filter(s => s.id !== 'orgs');
}

const ADMIN_SECTION_ICONS = { overview: 'dashboard', people: 'users', structure: 'sitemap', audit: 'activity', orgs: 'hospital' };

function renderAdminSidebarNav(){
  const el = document.getElementById('adminSidebarNav');
  if(!el) return;
  const sections = visibleAdminSections();
  if(!sections.some(s => s.id === adminUI.section)) adminUI.section = 'overview';
  el.innerHTML = sections.map(s => `
    <button type="button" class="admin-nav-item" data-admin-section="${s.id}"
      ${s.id === adminUI.section ? 'aria-current="page"' : ''}>
      ${icon(ADMIN_SECTION_ICONS[s.id])}<span>${escapeHTML(s.label)}</span>
    </button>`).join('');
}

const ADMIN_SECTION_IDS = { overview: 'adminOverviewSection', people: 'adminPeopleSection', structure: 'adminStructureSection', audit: 'adminAuditSection', orgs: 'adminOrgsSection' };

function renderAdminOrgChip(){
  const chip = document.getElementById('adminOrgChip');
  if(!chip) return;
  if(!adminUI.viewedOrgId){ chip.hidden = true; return; }
  const org = (adminUI.allOrgs || []).find(o => o.id === adminUI.viewedOrgId) || (adminData.tree && adminData.tree.org);
  document.getElementById('adminOrgChipName').textContent = org ? org.name : 'Organization';
  chip.hidden = false;
}

function renderAdminSection(){
  renderAdminSidebarNav();
  renderAdminOrgChip();
  const titleEl = document.getElementById('adminContextTitle');
  if(titleEl){ const s = ADMIN_SECTIONS.find(x => x.id === adminUI.section); titleEl.textContent = s ? s.label : 'Admin'; }
  const stamp = document.getElementById('adminUpdatedStamp');
  if(stamp){
    if(adminUI.lastLoadedAt){ stamp.hidden = false; stamp.textContent = 'updated ' + new Date(adminUI.lastLoadedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
    else stamp.hidden = true;
  }
  for(const [name, id] of Object.entries(ADMIN_SECTION_IDS)){
    const el = document.getElementById(id);
    if(el) el.hidden = adminUI.section !== name;
  }
  // Late-bound: renderAdminPeopleSection/renderAdminStructureSection/
  // renderAdminAuditSection/renderAdminOrgsSection live in the other admin-*.js
  // files. This call happens long after every <script> tag has run (it only
  // fires from an event handler or after an await), so it is safe regardless
  // of the order those files are listed in index.html.
  if(adminUI.section === 'people') renderAdminPeopleSection();
  else if(adminUI.section === 'structure') renderAdminStructureSection();
  else if(adminUI.section === 'audit') renderAdminAuditSection();
  else if(adminUI.section === 'orgs') renderAdminOrgsSection();
  else renderAdminOverviewSection();
}

function switchAdminSection(section){
  if(!visibleAdminSections().some(s => s.id === section)) return;
  adminUI.section = section;
  renderAdminSection();
  document.querySelector(`[data-admin-section="${section}"]`)?.focus();
}

document.getElementById('adminOrgChip')?.addEventListener('click', (e) => {
  if(e.target.closest('[data-org-chip-close]')) exitAdminOrgContext();
});

document.getElementById('adminSidebarNav')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-admin-section]');
  if(btn) switchAdminSection(btn.dataset.adminSection);
});

document.getElementById('adminSidebarNav')?.addEventListener('keydown', (e) => {
  if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key)) return;
  const sections = visibleAdminSections();
  const i = sections.findIndex(s => s.id === adminUI.section);
  if(i === -1) return;
  e.preventDefault();
  let next;
  if(e.key === 'ArrowUp') next = sections[(i - 1 + sections.length) % sections.length];
  else if(e.key === 'ArrowDown') next = sections[(i + 1) % sections.length];
  else if(e.key === 'Home') next = sections[0];
  else next = sections[sections.length - 1];
  switchAdminSection(next.id);
});

/** True once an instance admin needs to pick an org before Overview or
    Structure — both are meaningless without a specific org's tree. People,
    Audit, and Organizations are not gated by this: an instance admin can
    browse every user cross-org, Audit is org-clamped by the API, and
    Organizations IS the picker. */
function adminNeedsOrgChoice(){
  return isInstanceAdminUser() && !adminUI.viewedOrgId;
}

function adminOrgChooserHTML(){
  return 'Choose an organization on the Organizations section first.';
}

function renderAdminTelemetryHTML(){
  const t = adminUI.telemetry || { ok: false, ai: null, storage: null };
  const ai = t.ok ? (t.ai ? 'on' : 'off') : '—';
  const storage = t.ok && t.storage ? t.storage : '—';
  const pulse = t.ok && t.ai ? ' admin-motion-pulse-soft' : '';
  return `<span class="admin-telemetry-item${pulse}"><span class="admin-telemetry-label">AI</span> <span class="admin-telemetry-value">${ai}</span></span>` +
    `<span class="admin-telemetry-item"><span class="admin-telemetry-label">Storage</span> <span class="admin-telemetry-value">${escapeHTML(storage)}</span></span>`;
}

function renderAdminOverviewSection(){
  const chooser = document.getElementById('adminOverviewChooser');
  const body = document.getElementById('adminOverviewBody');
  const needsOrg = adminNeedsOrgChoice();
  if(chooser) chooser.hidden = !needsOrg;
  if(body) body.hidden = needsOrg;
  if(needsOrg) return;
  const orgName = adminData.tree && adminData.tree.org && adminData.tree.org.name;
  const titleEl = document.getElementById('adminCommandTitle');
  if(titleEl) titleEl.textContent = orgName ? `${orgName} · Command` : 'Command';
  const tel = document.getElementById('adminTelemetry');
  if(tel){ tel.innerHTML = renderAdminTelemetryHTML(); tel.hidden = false; }
  renderAdminStatTilesInto(adminData.tree);
  const bar = document.getElementById('adminOverviewStatusBar');
  if(bar){ const s = adminData.tree && adminData.tree.org && adminData.tree.org.stats; bar.innerHTML = s ? renderAdminStatusBar(s.byStatus, s.livePatients) : ''; }
  const attn = document.getElementById('adminNeedsAttention');
  if(attn) attn.innerHTML = renderAdminNeedsAttentionHTML(computeAdminNeedsAttention(adminData.tree, adminData.users, adminData.orgs));
}

/** Four Needs-attention categories. A unit is "empty" when it has no wards,
    no live patients and no assigned users — migration debris. */
function computeAdminNeedsAttention(tree, users, orgs){
  const groups = buildAssignNodeGroups(tree, orgs || []);
  const unassigned = [], stale = [], disabled = [];
  for(const u of users || []){
    if(!u.active){ disabled.push(u); continue; }
    if(!u.assignmentType || !u.assignmentId){ unassigned.push(u); continue; }
    if(!assignLabelFor(groups, u.assignmentType, u.assignmentId)) stale.push(u);
  }
  const emptyUnits = [];
  for(const h of (tree && tree.hospitals) || []){
    for(const dep of h.departments || []){
      for(const unit of dep.units || []){
        const noWards = !(unit.wards || []).length;
        const noPatients = !unit.stats || !unit.stats.livePatients;
        const noUsers = !unit.stats || !unit.stats.users;
        if(noWards && noPatients && noUsers) emptyUnits.push({ id: unit.id, name: unit.name });
      }
    }
  }
  return { unassigned, stale, emptyUnits, disabled };
}

function renderAdminNeedsAttentionHTML(cats){
  const row = (attr, val, icName, label) => `<button type="button" class="admin-attention-row" ${attr}="${escapeHTML(val)}">${icon(icName)}${label}${icon('chevron-right')}</button>`;
  const groups = [];
  if(cats.unassigned.length) groups.push({ title: `${cats.unassigned.length} ${cats.unassigned.length === 1 ? 'person has' : 'people have'} no assignment`, urgent: true,
    rows: cats.unassigned.map(u => row('data-attention-people', 'unassigned', 'user-check', `${escapeHTML(u.username)} — no assignment`)).join('') });
  if(cats.stale.length) groups.push({ title: `${cats.stale.length} ${cats.stale.length === 1 ? 'person is' : 'people are'} assigned to a place that no longer exists`,
    rows: cats.stale.map(u => row('data-attention-people', 'stale', 'map-pin-off', `${escapeHTML(u.username)} — assigned to a place that no longer exists`)).join('') });
  if(cats.emptyUnits.length) groups.push({ title: `${cats.emptyUnits.length} empty unit${cats.emptyUnits.length === 1 ? '' : 's'} (no wards, patients or staff)`,
    rows: cats.emptyUnits.map(u => row('data-attention-unit', u.id, 'box-off', escapeHTML(u.name))).join('') });
  if(cats.disabled.length) groups.push({ title: `${cats.disabled.length} disabled account${cats.disabled.length === 1 ? '' : 's'}`,
    rows: cats.disabled.map(u => row('data-attention-people', 'disabled', 'users', `${escapeHTML(u.username)} — disabled`)).join('') });
  if(!groups.length){
    return `<div class="admin-systems-clear admin-motion-fade-rise"><span class="admin-motion-pulse-soft" aria-hidden="true"></span> All systems clear</div>`;
  }
  return `<h3 class="admin-alert-queue-title">Needs attention</h3>` + groups.map((g, gi) =>
    `<div class="admin-attention-group admin-motion-slide-in${g.urgent ? ' admin-attention-urgent' : ''}" style="--i:${gi}"><h4>${icon('alert-triangle')}${escapeHTML(g.title)}</h4>${g.rows}</div>`
  ).join('');
}

/** Selects the first unit found in the tree and focuses its add-ward input.
    With no units anywhere yet, asks the admin to add a department first. */
function quickActionAddWard(){
  switchAdminSection('structure');
  const firstUnit = (adminData.tree && adminData.tree.hospitals || [])
    .flatMap(h => h.departments || []).flatMap(dep => dep.units || [])[0];
  if(!firstUnit){ showToast('Add a department first, then a unit'); return; }
  selectAdminNode('unit', firstUnit.id);
  document.querySelector(`[data-new-child-name="unit:${firstUnit.id}"]`)?.focus();
}

function quickActionAddPerson(){
  switchAdminSection('people');
  document.getElementById('adminNewUsername')?.focus();
}

function quickActionFixAssignment(){
  openAdminPeopleFilter('unassigned');
}

function openAdminPeopleFilter(filter){
  adminUI.peopleFilter = filter;
  switchAdminSection('people');
}

function getAdminPeopleFilter(){
  return adminUI.peopleFilter;
}

document.getElementById('adminOverviewBody')?.addEventListener('click', (e) => {
  if(e.target.closest('#adminQuickAddPerson')) return quickActionAddPerson();
  if(e.target.closest('#adminQuickAddWard')) return quickActionAddWard();
  if(e.target.closest('#adminQuickFixAssignment')) return quickActionFixAssignment();
  const unitRow = e.target.closest('[data-attention-unit]');
  if(unitRow){ switchAdminSection('structure'); selectAdminNode('unit', unitRow.dataset.attentionUnit); return; }
  const peopleRow = e.target.closest('[data-attention-people]');
  if(peopleRow){ openAdminPeopleFilter(peopleRow.dataset.attentionPeople); return; }
});

function renderAdminStatTiles(tree){
  const postop = tree.hospitals.flatMap(h => h.departments).reduce((n, dep) => n + (dep.stats.byStatus.postop || 0), 0);
  const tiles = [
    { n: tree.totals.departments, l: 'Departments', ic: 'stethoscope' },
    { n: tree.totals.usersActive, l: 'Active users', ic: 'user-check' },
    { n: tree.totals.livePatients, l: 'Live patients', ic: 'bed' },
    { n: postop, l: 'Post-op', ic: 'activity' }
  ];
  return tiles.map((t, i) =>
    `<div class="admin-stat-tile admin-motion-stagger" style="--i:${i}"><div class="admin-stat-icon">${icon(t.ic)}</div><div class="n">${t.n}</div><div class="l">${escapeHTML(t.l)}</div></div>`
  ).join('');
}

function renderAdminStatTilesInto(tree){
  const el = document.getElementById('adminStatTiles');
  if(el) el.innerHTML = renderAdminStatTiles(tree);
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

/** "unit" -> "Unit", "org" -> "Organization" (the only irregular one). */
function humanNodeType(type){
  if(type === 'org') return 'Organization';
  return type ? type[0].toUpperCase() + type.slice(1) : '';
}

// Walks the tree (plus the org list) into per-level groups so an assignment
// <select> can render an <optgroup> per node type. Option values encode
// "type:id" — change handlers split on the first ":". Labels are full paths
// (department-relative — see renderAssignSelectOptionsHTML's test for the
// exact "Ortho › IV › 7MOW" shape) so two same-named wards are distinguishable.
function buildAssignNodeGroups(tree, orgs){
  const groups = { org: [], hospital: [], department: [], unit: [], ward: [] };
  for(const o of orgs || []) groups.org.push({ id: o.id, label: o.name });
  for(const h of (tree && tree.hospitals) || []){
    groups.hospital.push({ id: h.id, label: h.name });
    for(const dep of h.departments || []){
      groups.department.push({ id: dep.id, label: `${h.name} › ${dep.name}` });
      for(const u of dep.units || []){
        groups.unit.push({ id: u.id, label: `${dep.name} › ${u.name}` });
        for(const w of u.wards || []) groups.ward.push({ id: w.id, label: `${dep.name} › ${u.name} › ${w.name}` });
      }
    }
  }
  return groups;
}

// Looks up the display label for a "type:id" assignment. Returns null when
// the node isn't in the current tree/org list (a stale assignment) so
// callers can render the "assigned to a place that no longer exists" copy.
function assignLabelFor(groups, type, id){
  if(!type || !id) return null;
  const hit = (groups[type] || []).find(x => x.id === id);
  return hit ? hit.label : null;
}

function renderAssignSelectOptionsHTML(groups, selType, selId){
  const optgroup = (label, type, items) => items.length ? `<optgroup label="${escapeHTML(label)}">${items.map(it =>
    `<option value="${type}:${escapeHTML(it.id)}"${type === selType && it.id === selId ? ' selected' : ''}>${escapeHTML(it.label)}</option>`
  ).join('')}</optgroup>` : '';
  const known = (groups[selType] || []).some(x => x.id === selId);
  const stale = selType && selId && !known
    ? `<option value="${escapeHTML(selType)}:${escapeHTML(selId)}" selected>assigned to a place that no longer exists</option>`
    : '';
  return `<option value="">— none —</option>` + stale +
    optgroup('Organizations', 'org', groups.org) +
    optgroup('Hospitals', 'hospital', groups.hospital) +
    optgroup('Departments', 'department', groups.department) +
    optgroup('Units', 'unit', groups.unit) +
    optgroup('Wards', 'ward', groups.ward);
}

/** Turns a 409 `{ error, blockedBy: { children, users, patients } }` into a
    sentence naming what is actually in the way. Returns null for any error
    without a blockedBy payload so callers can fall back to err.message. */
function describeDeleteBlock(err){
  const b = err && err.payload && err.payload.blockedBy;
  if(!b) return null;
  const bits = [];
  if(b.children) bits.push(`${b.children} child item${b.children === 1 ? '' : 's'}`);
  if(b.patients) bits.push(`${b.patients} patient${b.patients === 1 ? '' : 's'}`);
  if(b.users) bits.push(`${b.users} user${b.users === 1 ? '' : 's'}`);
  return bits.length ? `Can't delete — still has ${bits.join(', ')}` : null;
}

// A hierarchy edit here changes what the patient-form unit picker should
// show. That picker (in app.js) memoizes the scope tree per page session, so
// drop its cache on any node create/rename/delete/move to force a refetch.
function invalidateHierarchyCaches(){
  if(typeof invalidateScopeTree === 'function') invalidateScopeTree();
}

/** Captures whether `selector` is focused, runs `repaint`, then refocuses the
    matching element — used when a full-section repaint would otherwise drop
    keyboard focus (Structure filter, People search). Pass `alwaysRefocus` to
    restore a different selector after repaint (e.g. rename target). */
function restoreAdminFocus(selector, repaint, alwaysRefocus){
  const keep = !alwaysRefocus && document.activeElement?.matches?.(selector);
  const restore = alwaysRefocus || keep;
  const refocus = () => { if(restore) document.querySelector(selector)?.focus(); };
  const result = repaint();
  if(result != null && typeof result.then === 'function') return result.then(refocus);
  refocus();
}

// Concurrent loadAdminView() calls (e.g. rapid org switches) are unordered;
// only the latest completion may replace adminData and re-render.
let adminLoadSeq = 0;

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

/** Public /api/health via fetch (not api()) — no auth headers needed. */
async function refreshAdminTelemetry(){
  try{
    const res = await fetch('/api/health');
    if(!res.ok) throw new Error('health ' + res.status);
    const data = await res.json();
    adminUI.telemetry = {
      ok: true,
      ai: !!(data.ai && data.ai.enabled),
      storage: typeof data.storage === 'string' ? data.storage : null
    };
  }catch{
    adminUI.telemetry = { ok: false, ai: null, storage: null };
  }
}

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
    await refreshAdminTelemetry();
    if(loadToken !== adminLoadSeq) return;
  }catch(err){
    if(loadToken !== adminLoadSeq) return;
    setAdminBusy(false);
    throw err;
  }
  if(loadToken !== adminLoadSeq) return;
  setAdminBusy(false);
  adminUI.lastLoadedAt = Date.now();
  if(instAdmin) renderAdminOrgsSection();
  renderAdminSection();
}

function openAdminView(){
  document.getElementById('adminView').hidden = false;
  loadAdminView().catch(err => showToast(err.message || 'Could not load admin data'));
}

function closeAdminView(){
  document.getElementById('adminView').hidden = true;
}
