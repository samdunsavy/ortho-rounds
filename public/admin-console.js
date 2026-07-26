/* Admin console — shared core: state, the four-section shell, and Overview.
   Plain script, not a module: function declarations must stay global so
   app.js's button handlers and the other three admin-*.js files can call
   them. Cross-file calls (e.g. this file calling renderAdminPeopleSection,
   defined in admin-people.js) only ever happen from inside a function body
   that runs later — never at this file's own top level — so the order the
   four admin-*.js files load in index.html does not matter. Runtime helpers
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
  section: 'overview',           // 'overview' | 'people' | 'structure' | 'orgs'
  viewedOrgId: null,             // instance admin: which org's tree is loaded
  allOrgs: [],                   // instance admin: every org, kept across a drill-in
  selectedNode: null,            // Structure: { type, id } | null
  structureExpanded: new Set(),  // Structure: "type:id" keys of expanded rows
  structureFilter: '',           // Structure: name filter text
  structureMobileDrilled: false, // Structure: phone drill-down flag
  peopleSearch: '',
  peopleFilter: 'all',           // 'all' | 'unassigned' | 'disabled' | 'admins' | 'stale' | 'node:<type>:<id>'
  peopleChecked: new Set()       // checked user ids, bulk assign
};

const ADMIN_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'structure', label: 'Structure' },
  { id: 'orgs', label: 'Organizations' }
];

function visibleAdminSections(){
  return isInstanceAdminUser() ? ADMIN_SECTIONS : ADMIN_SECTIONS.filter(s => s.id !== 'orgs');
}

function renderAdminSectionTabs(){
  const el = document.getElementById('adminSectionTabs');
  if(!el) return;
  const sections = visibleAdminSections();
  if(!sections.some(s => s.id === adminUI.section)) adminUI.section = 'overview';
  el.innerHTML = sections.map(s => `
    <button type="button" class="admin-section-tab" role="tab" id="adminTab-${s.id}"
      aria-selected="${s.id === adminUI.section}" tabindex="${s.id === adminUI.section ? '0' : '-1'}"
      data-admin-section="${s.id}">${escapeHTML(s.label)}</button>`).join('');
}

const ADMIN_SECTION_IDS = { overview: 'adminOverviewSection', people: 'adminPeopleSection', structure: 'adminStructureSection', orgs: 'adminOrgsSection' };

function renderAdminSection(){
  renderAdminSectionTabs();
  for(const [name, id] of Object.entries(ADMIN_SECTION_IDS)){
    const el = document.getElementById(id);
    if(el) el.hidden = adminUI.section !== name;
  }
  // Late-bound: renderAdminPeopleSection/renderAdminStructureSection/
  // renderAdminOrgsSection live in the other three admin-*.js files. This
  // call happens long after every <script> tag has run (it only fires from
  // an event handler or after an await), so it is safe regardless of the
  // order those files are listed in index.html.
  if(adminUI.section === 'people') renderAdminPeopleSection();
  else if(adminUI.section === 'structure') renderAdminStructureSection();
  else if(adminUI.section === 'orgs') renderAdminOrgsSection();
  else renderAdminOverviewSection();
}

function switchAdminSection(section){
  if(!visibleAdminSections().some(s => s.id === section)) return;
  adminUI.section = section;
  renderAdminSection();
  document.getElementById(`adminTab-${section}`)?.focus();
}

document.getElementById('adminSectionTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-admin-section]');
  if(btn) switchAdminSection(btn.dataset.adminSection);
});

document.getElementById('adminSectionTabs')?.addEventListener('keydown', (e) => {
  if(!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const sections = visibleAdminSections();
  const i = sections.findIndex(s => s.id === adminUI.section);
  if(i === -1) return;
  e.preventDefault();
  let next;
  if(e.key === 'ArrowLeft') next = sections[(i - 1 + sections.length) % sections.length];
  else if(e.key === 'ArrowRight') next = sections[(i + 1) % sections.length];
  else if(e.key === 'Home') next = sections[0];
  else next = sections[sections.length - 1];
  switchAdminSection(next.id);
});

/** True once an instance admin needs to pick an org before Overview or
    Structure — both are meaningless without a specific org's tree. People
    and Organizations are not gated by this: an instance admin can browse
    every user cross-org, and Organizations IS the picker. */
function adminNeedsOrgChoice(){
  return isInstanceAdminUser() && !adminUI.viewedOrgId;
}

function adminOrgChooserHTML(){
  return 'Choose an organization on the Organizations tab first.';
}

function renderAdminOverviewSection(){
  const chooser = document.getElementById('adminOverviewChooser');
  const tiles = document.getElementById('adminStatTiles');
  const needsOrg = adminNeedsOrgChoice();
  if(chooser) chooser.hidden = !needsOrg;
  if(tiles) tiles.hidden = needsOrg;
  if(needsOrg){ if(tiles) tiles.innerHTML = ''; return; }
  renderAdminStatTilesInto(adminData.tree);
}

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
// callers can render the "Assigned to a place that no longer exists" copy.
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
    ? `<option value="${escapeHTML(selType)}:${escapeHTML(selId)}" selected>Assigned to a place that no longer exists</option>`
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

async function loadAdminView(){
  const instAdmin = isInstanceAdminUser();
  try{
    let tree, users, orgs;
    if(instAdmin){
      const [usersRes, orgsRes] = await Promise.all([api('/api/admin/users'), api('/api/admin/orgs')]);
      adminUI.allOrgs = orgsRes.orgs;
      orgs = adminUI.allOrgs;
      users = adminUI.viewedOrgId ? usersRes.users.filter(u => u.orgId === adminUI.viewedOrgId) : usersRes.users;
      tree = adminUI.viewedOrgId ? await api(`/api/admin/org?orgId=${encodeURIComponent(adminUI.viewedOrgId)}`) : null;
    }else{
      const [usersRes, treeRes] = await Promise.all([api('/api/admin/users'), api('/api/admin/org')]);
      users = usersRes.users;
      tree = treeRes;
      orgs = tree.org ? [tree.org] : [];
    }
    adminData = { tree, users, orgs };
  }catch(err){
    throw err;
  }
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
