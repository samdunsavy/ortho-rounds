/* Admin console — Audit section: filterable audit log + CSV export.
   Plain script (see admin-console.js's header comment). Reads/writes
   adminUI.audit* fields; loads via GET /api/admin/audit. */

const ADMIN_AUDIT_PAGE = 50;

function buildAuditQuery(opts){
  opts = opts || {};
  const f = adminUI.auditFilters || {};
  const p = new URLSearchParams();
  if(f.action) p.set('action', f.action);
  if(f.actorId) p.set('actorId', f.actorId);
  if(f.subjectId) p.set('subjectId', f.subjectId);
  if(f.from) p.set('from', f.from);
  if(f.to) p.set('to', f.to);
  if(f.orgId) p.set('orgId', f.orgId);
  if(!opts.csv){
    p.set('limit', String(ADMIN_AUDIT_PAGE));
    p.set('offset', String(adminUI.auditOffset || 0));
  }
  return p.toString();
}

function readAuditFiltersFromDom(){
  const g = id => {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  };
  adminUI.auditFilters = {
    action: g('adminAuditFilterAction'),
    actorId: g('adminAuditFilterActorId'),
    subjectId: g('adminAuditFilterSubjectId'),
    from: g('adminAuditFilterFrom'),
    to: g('adminAuditFilterTo'),
    orgId: g('adminAuditFilterOrgId')
  };
}

function auditSubjectLabel(e){
  const type = e.subjectType || '';
  const id = e.subjectId || '';
  if(type && id) return type + '/' + id;
  return type || id || '—';
}

function renderAdminAuditDetailHTML(entry){
  if(!entry){
    return `<div class="admin-detail-head"><h3>Detail</h3></div>
      <div class="small-muted">Select an entry.</div>`;
  }
  const rows = [
    ['When', entry.at ? new Date(entry.at).toLocaleString() + ' (' + formatRelativeTime(entry.at) + ')' : '—'],
    ['Action', entry.action || '—'],
    ['Actor', (entry.actorUsername || '—') + (entry.actorId ? ' · ' + entry.actorId : '')],
    ['Subject', auditSubjectLabel(entry)],
    ['Org', entry.orgId || '—'],
    ['IP', entry.ip || '—'],
    ['User agent', entry.userAgent || '—'],
    ['Id', entry.id || '—']
  ].map(([k, v]) =>
    `<div class="admin-people-card-field"><span class="small-muted">${escapeHTML(k)}</span><div>${escapeHTML(String(v))}</div></div>`
  ).join('');
  const detailJson = escapeHTML(JSON.stringify(entry.detail != null ? entry.detail : {}, null, 2));
  return `<div class="admin-detail-head"><h3>${escapeHTML(entry.action || 'Entry')}</h3></div>
    ${rows}
    <div class="admin-people-card-field">
      <span class="small-muted">Detail</span>
      <pre style="white-space:pre-wrap;word-break:break-word;margin:0;font:inherit;font-family:var(--mono);font-size:12px;">${detailJson}</pre>
    </div>`;
}

function renderAdminAuditListHTML(){
  const entries = adminUI.auditEntries || [];
  if(adminUI.auditLoading && !entries.length){
    return `<div class="small-muted">Loading…</div>`;
  }
  if(adminUI.auditError && !entries.length){
    return `<div class="small-muted">${escapeHTML(adminUI.auditError)}</div>`;
  }
  if(!entries.length){
    return `<div class="admin-empty">No audit entries match.</div>`;
  }
  return entries.map(e => {
    const sel = e.id === adminUI.auditSelectedId ? ' is-selected' : '';
    const when = e.at ? formatRelativeTime(e.at) : '—';
    return `<button type="button" class="admin-cc-row${sel}" data-audit-select="${escapeHTML(e.id)}">
      <span class="small-muted">${escapeHTML(when)}</span>
      <span>${escapeHTML(e.actorUsername || '—')}</span>
      <span>${escapeHTML(e.action || '—')}</span>
      <span class="cc-count">${escapeHTML(auditSubjectLabel(e))}</span>
    </button>`;
  }).join('');
}

function renderAdminAuditSection(){
  const el = document.getElementById('adminAuditSection');
  if(!el) return;
  if(document.getElementById('adminAuditFilterAction')) readAuditFiltersFromDom();
  const f = adminUI.auditFilters || {};
  const orgFilter = isInstanceAdminUser()
    ? `<label class="sr-only" for="adminAuditFilterOrgId">Org id</label>
       <input id="adminAuditFilterOrgId" placeholder="Org id" value="${escapeHTML(f.orgId || '')}">`
    : '';
  const selected = (adminUI.auditEntries || []).find(e => e.id === adminUI.auditSelectedId) || null;
  const moreBtn = adminUI.auditHasMore
    ? `<button type="button" class="btn" id="adminAuditLoadMore"${adminUI.auditLoading ? ' disabled' : ''}>Load more</button>`
    : '';
  const status = adminUI.auditLoading
    ? `<div class="small-muted">Loading…</div>`
    : (adminUI.auditError ? `<div class="small-muted">${escapeHTML(adminUI.auditError)}</div>` : '');

  el.innerHTML = `
    <div class="admin-detail-head"><h3>Audit</h3></div>
    <div class="admin-inline-form" id="adminAuditFilters">
      <label class="sr-only" for="adminAuditFilterAction">Action</label>
      <input id="adminAuditFilterAction" placeholder="Action" value="${escapeHTML(f.action || '')}">
      <label class="sr-only" for="adminAuditFilterActorId">Actor id</label>
      <input id="adminAuditFilterActorId" placeholder="Actor id" value="${escapeHTML(f.actorId || '')}">
      <label class="sr-only" for="adminAuditFilterSubjectId">Subject id</label>
      <input id="adminAuditFilterSubjectId" placeholder="Subject id" value="${escapeHTML(f.subjectId || '')}">
      <label class="sr-only" for="adminAuditFilterFrom">From (epoch ms)</label>
      <input id="adminAuditFilterFrom" placeholder="From (epoch ms)" value="${escapeHTML(f.from || '')}">
      <label class="sr-only" for="adminAuditFilterTo">To (epoch ms)</label>
      <input id="adminAuditFilterTo" placeholder="To (epoch ms)" value="${escapeHTML(f.to || '')}">
      ${orgFilter}
      <button type="button" class="btn primary" id="adminAuditApply">Apply</button>
      <button type="button" class="btn" id="adminAuditExportCsv">Export CSV</button>
    </div>
    ${status}
    <div class="admin-cc" id="adminAuditBody">
      <aside class="admin-cc-rail" id="adminAuditRail">${renderAdminAuditListHTML()}</aside>
      <section class="admin-cc-detail" id="adminAuditDetail">${renderAdminAuditDetailHTML(selected)}</section>
    </div>
    <div class="admin-inline-form">${moreBtn}</div>`;

  if(!adminUI._auditAutoLoaded && !adminUI.auditLoading){
    adminUI._auditAutoLoaded = true;
    loadAdminAuditEntries(true);
  }
}

async function loadAdminAuditEntries(reset){
  if(adminUI.auditLoading) return;
  if(reset){
    adminUI.auditOffset = 0;
    adminUI.auditSelectedId = null;
  }
  adminUI.auditLoading = true;
  adminUI.auditError = null;
  renderAdminAuditSection();
  try{
    const data = await api('/api/admin/audit?' + buildAuditQuery());
    const entries = data.entries || [];
    if(reset) adminUI.auditEntries = entries;
    else adminUI.auditEntries = (adminUI.auditEntries || []).concat(entries);
    adminUI.auditOffset = (adminUI.auditEntries || []).length;
    adminUI.auditHasMore = entries.length >= ADMIN_AUDIT_PAGE;
  }catch(err){
    adminUI.auditError = err.message || 'Could not load audit';
    if(reset) adminUI.auditEntries = [];
    adminUI.auditHasMore = false;
  }
  adminUI.auditLoading = false;
  renderAdminAuditSection();
}

async function downloadAdminAuditCsv(){
  readAuditFiltersFromDom();
  const token = localStorage.getItem('ortho_token');
  try{
    const res = await fetch('/api/admin/audit.csv?' + buildAuditQuery({ csv: true }), {
      headers: { Authorization: 'Bearer ' + (token || '') }
    });
    if(!res.ok){
      showToast('Could not export audit CSV');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ortho_audit.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }catch{
    showToast('Could not export audit CSV');
  }
}

document.getElementById('adminAuditSection')?.addEventListener('click', (e) => {
  const row = e.target.closest('[data-audit-select]');
  if(row){
    e.stopPropagation();
    adminUI.auditSelectedId = row.dataset.auditSelect;
    document.querySelectorAll('#adminAuditRail [data-audit-select]').forEach(b => {
      b.classList.toggle('is-selected', b.dataset.auditSelect === adminUI.auditSelectedId);
    });
    const detail = document.getElementById('adminAuditDetail');
    const entry = (adminUI.auditEntries || []).find(x => x.id === adminUI.auditSelectedId);
    if(detail) detail.innerHTML = renderAdminAuditDetailHTML(entry);
    return;
  }
  if(e.target.closest('#adminAuditApply')){
    e.stopPropagation();
    readAuditFiltersFromDom();
    loadAdminAuditEntries(true);
    return;
  }
  if(e.target.closest('#adminAuditExportCsv')){
    e.stopPropagation();
    const btn = e.target.closest('#adminAuditExportCsv');
    void withBusy(btn, () => downloadAdminAuditCsv());
    return;
  }
  if(e.target.closest('#adminAuditLoadMore')){
    e.stopPropagation();
    loadAdminAuditEntries(false);
  }
});
