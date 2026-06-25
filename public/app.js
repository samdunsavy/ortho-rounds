/* ============================================================
   ORTHO ROUNDS — client
   ------------------------------------------------------------
   Data is stored in a shared SQLite database on the server and
   reached over your network by URL. This client keeps a local
   IndexedDB cache so it keeps working offline, then syncs back
   to the server (last-write-wins) when the connection returns.
   Use Export for file backups.
   ============================================================ */

let patients = [];          // in-memory cache of NON-deleted patients, for rendering
let currentFilter = "all";
const STATUS_LABELS = { preop:'Pre-op', conservative:'Conservative', postop:'Post-op', fordischarge:'For discharge' };
const STATUS_CYCLE = ['preop', 'conservative', 'postop', 'fordischarge'];
let openCardId = null;
let editingPatientId = null; // null = adding new
let modalWorkingData = null; // in-memory draft while add/edit modal is open
let modalSuppressAutoTemplate = false; // user removed milestones — don't refill on save
let pendingImageSlot = null;  // {type: 'preop'|'postop'|'followup'}

/* ---------------- storage / sync keys ---------------- */

const CACHE_DB_NAME = "ortho_rounds_db"; // reuse existing local store so old data migrates
const CACHE_DB_VERSION = 1;
const LS_TOKEN = "ortho_token";
const LS_LASTSYNC = "ortho_lastSync";
const LS_LAST_FULL_SYNC = "ortho_lastFullSync";
const LS_PG_INITIALS = "ortho_pgInitials";
const LS_PRESENTED = "ortho_presented"; // { date, ids[] }
const LS_FILTER = "ortho_filter";
const LS_AUTO_WORKLIST = "ortho_lastAutoWorklistDate";
const LS_ONBOARDED = "ortho_onboarded";
const LS_PRESENT_UNPRESENTED = "ortho_presentUnpresentedOnly";
const LS_CONSULTANT_MODE = "ortho_consultantMode";
const LS_LAST_EXPORT = "ortho_lastExport";
const LS_BACKUP_NUDGE = "ortho_backupNudge";
const LS_DARK_MODE = "ortho_darkMode";
const WARD_META_ID = "__ward_meta__";
const FILTER_LABELS = {
  all: 'All',
  preop: 'Pre-op',
  conservative: 'Conservative',
  postop: 'Post-op',
  fordischarge: 'For discharge',
  flagged: 'Pending items',
  attention: 'Needs attention',
  needsplan: 'Needs plan',
  unpresented: 'Unpresented',
  ottoday: 'OT today',
  mine: 'My patients'
};
const LAB_THRESHOLDS = { hb: 100, crp: 10, wcc: 11, creatinine: 120 };
const PLAN_HISTORY_MAX = 14;
const FULL_RECONCILE_INTERVAL_MS = 5 * 60 * 1000; // periodic full reconcile
let idb = null;
let wardMeta = { handoverNote: '', pgRoster: [], updatedAt: 0 };
let syncing = false;
let presentationUnpresentedOnly = localStorage.getItem(LS_PRESENT_UNPRESENTED) === '1';
let presentationReadAloud = false;
let bulkSelectMode = false;
let bulkSelectedIds = new Set();
let pendingSyncConflicts = [];
let syncQueued = false;
let syncQueuedFullReconcile = false;
let presentationIndex = 0;
let expandedPlanHistory = {}; // patientId -> bool
const LS_LAST_SYNC_OK = 'ortho_lastSyncOk';
let syncChipState = 'offline';
let lastSyncSuccessAt = Number(localStorage.getItem(LS_LAST_SYNC_OK) || 0);

/* ---------------- IndexedDB cache layer ---------------- */

function openCache(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const _db = e.target.result;
      if(!_db.objectStoreNames.contains("patients")){
        _db.createObjectStore("patients", {keyPath:"id"});
      }
    };
    req.onsuccess = (e)=> resolve(e.target.result);
    req.onerror = ()=> reject(req.error || new Error('Could not open local cache'));
    req.onblocked = ()=> reject(new Error('Cache busy — close other tabs with this app open'));
  });
}

function idbReq(req){
  return new Promise((resolve, reject)=>{
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error || new Error('Local cache error'));
  });
}

function cacheGetAll(){
  if(!idb) return Promise.resolve([]);
  const tx = idb.transaction("patients","readonly");
  return idbReq(tx.objectStore("patients").getAll()).then(r => r || []);
}

function cacheGet(id){
  if(!idb) return Promise.resolve(null);
  const tx = idb.transaction("patients","readonly");
  return idbReq(tx.objectStore("patients").get(id));
}

function cachePutRaw(rec){
  const tx = idb.transaction("patients","readwrite");
  tx.objectStore("patients").put(rec);
  return new Promise((resolve, reject)=>{
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error || new Error('Could not write to local cache'));
    tx.onabort = ()=> reject(tx.error || new Error('Local cache write aborted'));
  });
}

function clearCache(){
  const tx = idb.transaction("patients","readwrite");
  tx.objectStore("patients").clear();
  return new Promise((resolve, reject)=>{
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

function cacheDelete(id){
  if(!idb) return Promise.resolve();
  const tx = idb.transaction("patients","readwrite");
  tx.objectStore("patients").delete(id);
  return new Promise((resolve, reject)=>{
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

async function cachePut(patient, dirty){
  const rec = Object.assign({}, patient);
  if(rec.updatedAt == null) rec.updatedAt = Date.now();
  rec.deleted = !!rec.deleted;
  rec._dirty = !!dirty;
  await cachePutRaw(rec);
  if(dirty) scheduleSyncChipRefresh();
}

function stripClientFields(rec){
  const out = Object.assign({}, rec);
  delete out._dirty;
  return out;
}

async function reloadFromCache(){
  const all = await cacheGetAll();
  const metaRec = all.find(r => r && r.id === WARD_META_ID);
  wardMeta = metaRec
    ? { handoverNote: metaRec.handoverNote || '', updatedAt: metaRec.updatedAt || 0 }
    : { handoverNote: '', updatedAt: 0 };
  patients = all
    .filter(r => r && r.id && !r.deleted && !String(r.id).startsWith('__'))
    .map(r => { const o = Object.assign({}, r); delete o._dirty; return o; });
  const libRec = all.find(r => r && r.id === TEMPLATE_LIBRARY_ID);
  loadTemplateLibraryFromRecord(libRec);
  patients.forEach(normalizePatientChecklists);
}

// One-time migration: stamp old local-only records so they sync to the server.
async function migrateLegacyRecords(){
  const all = await cacheGetAll();
  for(const r of all){
    if(!r || !r.id || String(r.id).startsWith('__')) continue;
    if(r.updatedAt == null){
      r.updatedAt = r.createdAt || Date.now();
      r.deleted = !!r.deleted;
      r._dirty = true;
      await cachePutRaw(r);
    }
  }
}

/* ---------------- server API ---------------- */

function hasToken(){ return !!localStorage.getItem(LS_TOKEN); }

async function api(path, opts){
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if(opts.body) headers['Content-Type'] = 'application/json';
  const token = localStorage.getItem(LS_TOKEN);
  if(token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  if(res.status === 401){
    localStorage.removeItem(LS_TOKEN);
    showLogin();
    throw new Error('unauthorized');
  }
  if(!res.ok){
    let msg = 'Request failed (' + res.status + ')';
    try{ const j = await res.json(); if(j && j.error) msg = j.error; }catch{ /* ignore */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

async function pingServer(){
  try{
    const ctrl = new AbortController();
    const t = setTimeout(()=> ctrl.abort(), 2500);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  }catch{
    return false;
  }
}

/* ---------------- sync engine ---------------- */

function formatRelativeTime(ts){
  if(!ts) return 'never';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if(sec < 10) return 'just now';
  if(sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if(min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if(hr < 24) return `${hr}h ago`;
  return fmtDate(new Date(ts).toISOString().slice(0, 10));
}

async function getDirtyRecordCount(){
  if(!idb) return 0;
  const all = await cacheGetAll();
  return all.filter(r => r && r._dirty).length;
}

async function refreshSyncChipLabel(){
  const txt = document.getElementById('syncChipText');
  const panelStatus = document.getElementById('syncPanelStatus');
  const panelPending = document.getElementById('syncPanelPending');
  const panelLast = document.getElementById('syncPanelLast');
  if(!txt) return;
  const dirty = await getDirtyRecordCount();
  let label;
  if(syncChipState === 'syncing') label = 'Syncing…';
  else if(syncChipState === 'offline') label = dirty ? `Offline · ${dirty} pending` : 'Offline';
  else label = dirty ? `${dirty} pending` : (lastSyncSuccessAt ? `Synced ${formatRelativeTime(lastSyncSuccessAt)}` : 'Synced');

  txt.textContent = label;
  if(panelStatus) panelStatus.textContent = syncChipState === 'syncing' ? 'Syncing…' : syncChipState === 'offline' ? 'Offline' : 'Online';
  if(panelPending) panelPending.textContent = dirty ? `${dirty} change${dirty === 1 ? '' : 's'} to upload` : 'None';
  if(panelLast) panelLast.textContent = lastSyncSuccessAt ? formatRelativeTime(lastSyncSuccessAt) : 'Not yet';
}

function setSyncStatus(state){
  const chip = document.getElementById('syncChip');
  if(!chip) return;
  syncChipState = state;
  chip.classList.remove('online','syncing','offline');
  chip.classList.add(state);
  if(state === 'online'){
    lastSyncSuccessAt = Date.now();
    localStorage.setItem(LS_LAST_SYNC_OK, String(lastSyncSuccessAt));
  }
  refreshSyncChipLabel();
}

function scheduleSyncChipRefresh(){
  refreshSyncChipLabel().catch(()=>{});
}

function scheduleSync(){
  if(!hasToken()) return;
  if(syncing){ syncQueued = true; return; }
  syncNow({});
}

async function waitForSync(opts){
  opts = opts || {};
  for(let i = 0; i < 120; i++){
    if(!syncing){
      await syncNow(opts);
      if(!syncing) return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Sync timed out');
}

function shouldFullReconcile(force){
  if(force) return true;
  const last = Number(localStorage.getItem(LS_LAST_FULL_SYNC) || 0);
  return Date.now() - last > FULL_RECONCILE_INTERVAL_MS;
}

async function mergeServerRecords(serverRecords){
  for(const rec of serverRecords){
    if(!rec || typeof rec.id !== 'string') continue;
    const cur = await cacheGet(rec.id);
    if(!cur){
      rec._dirty = false;
      await cachePutRaw(rec);
      continue;
    }
    if(cur._dirty){
      const merged = mergePatientRecords(cur, rec);
      merged._dirty = true;
      merged.updatedAt = Math.max(Number(cur.updatedAt) || 0, Number(rec.updatedAt) || 0);
      const conflicts = detectPatientConflicts(cur, rec);
      for(const c of conflicts){
        pendingSyncConflicts.push({ patientId: rec.id, conflict: c });
      }
      await cachePutRaw(merged);
      continue;
    }
    if(rec.updatedAt >= (cur.updatedAt || 0)){
      rec._dirty = false;
      await cachePutRaw(rec);
    }
  }
  if(pendingSyncConflicts.length){
    const first = pendingSyncConflicts.shift();
    showToast('Updated on another device — tap to compare', {
      duration: 8000,
      onClick: ()=> showConflictCompare(first.patientId, first.conflict)
    });
  }
}

// Drop local cache rows that no longer exist on the server (unless still dirty).
async function reconcileWithSnapshot(serverRecords){
  const serverById = new Map();
  for(const rec of serverRecords){
    if(rec && typeof rec.id === 'string') serverById.set(rec.id, rec);
  }

  await mergeServerRecords(serverRecords);

  const local = await cacheGetAll();
  let resurrected = 0;
  for(const localRec of local){
    if(!localRec || !localRec.id || String(localRec.id).startsWith('__')) continue;
    if(localRec._dirty) continue;

    const serverRec = serverById.get(localRec.id);
    if(!serverRec){
      // The server has no row for this id at all. Because the app only ever
      // soft-deletes (an intentionally removed patient stays in the snapshot
      // flagged deleted=true), a record that is *missing* from a full snapshot
      // means the server lost its database — e.g. a redeploy without a
      // persistent disk. Re-upload our local copy instead of deleting it, so
      // the first device to sync repopulates the server rather than every
      // device wiping its own records to match an empty server.
      localRec._dirty = true;
      await cachePutRaw(localRec);
      resurrected++;
      continue;
    }
    if(serverRec.deleted){
      await cacheDelete(localRec.id);
    }
  }

  localStorage.setItem(LS_LAST_FULL_SYNC, String(Date.now()));
  // Push the resurrected records back up on the next sync cycle.
  if(resurrected) scheduleSync();
}

async function syncNow(opts){
  opts = opts || {};
  if(!hasToken()) return;
  if(syncing){
    syncQueued = true;
    if(opts.fullReconcile) syncQueuedFullReconcile = true;
    return;
  }
  syncing = true;
  setSyncStatus('syncing');
  try{
    const since = Number(localStorage.getItem(LS_LASTSYNC) || 0);
    const dirty = (await cacheGetAll()).filter(r => r._dirty);
    const changes = dirty.map(stripClientFields);

    const res = await api('/api/sync', { method:'POST', body: JSON.stringify({ since, changes }) });

    for(const d of dirty){
      const cur = await cacheGet(d.id);
      if(cur && cur._dirty && cur.updatedAt === d.updatedAt){
        cur._dirty = false;
        await cachePutRaw(cur);
      }
    }

    await mergeServerRecords(res.patients || []);
    // Apply server updatedAt to records we just pushed (server re-stamps on accept).
    for(const rec of res.patients || []){
      if(!rec || !rec.id) continue;
      const local = await cacheGet(rec.id);
      if(local && local._dirty && rec.updatedAt >= (local.updatedAt || 0)){
        local.updatedAt = rec.updatedAt;
        local._dirty = false;
        await cachePutRaw(local);
      }
    }
    localStorage.setItem(LS_LASTSYNC, String(res.serverTime));

    if(shouldFullReconcile(!!opts.fullReconcile)){
      const snap = await api('/api/sync', { method:'POST', body: JSON.stringify({ since: 0, changes: [] }) });
      await reconcileWithSnapshot(snap.patients || []);
      localStorage.setItem(LS_LASTSYNC, String(snap.serverTime));
    }

    await reloadFromCache();
    preserveOpenCard();
    renderAll();
    setSyncStatus('online');
  }catch(err){
    if(err.message !== 'unauthorized') console.warn('Sync failed:', err.message);
    setSyncStatus('offline');
    throw err;
  }finally{
    syncing = false;
    if(syncQueued){
      syncQueued = false;
      const fullReconcile = syncQueuedFullReconcile;
      syncQueuedFullReconcile = false;
      setTimeout(()=> syncNow({ fullReconcile }), 60);
    }
  }
}

async function refreshFromServer(){
  if(!hasToken()){ showLogin(); return; }
  const ok = await showConfirm(
    'Refresh from server?',
    'Reload all patient data from the server.\n\nLocal records not on the server will be removed. Unsaved offline edits (not yet synced) will be kept and re-uploaded.',
    { confirmLabel: 'Refresh' }
  );
  if(!ok) return;

  try{
    setSyncStatus('syncing');
    const all = await cacheGetAll();
    const dirty = all.filter(r => r && r._dirty && r.id && !String(r.id).startsWith('__'));
    await clearCache();
    for(const d of dirty) await cachePutRaw(d);
    localStorage.setItem(LS_LASTSYNC, '0');
    await syncNow({ fullReconcile: true });
    showToast('Refreshed from server');
  }catch(err){
    if(err.message !== 'unauthorized') showToast('Refresh failed — ' + (err.message || 'error'));
  }
}

function preserveOpenCard(){
  if(openCardId && !patients.some(p => p.id === openCardId)) openCardId = null;
}

/* ---------------- login ---------------- */

function showLogin(){
  const ov = document.getElementById('loginOverlay');
  ov.classList.add('active');
  setTimeout(()=> document.getElementById('loginPassword').focus(), 50);
}
function hideLogin(){
  document.getElementById('loginOverlay').classList.remove('active');
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
}
async function attemptLogin(){
  const pw = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  if(!pw){ errEl.textContent = 'Enter the password'; return; }
  try{
    const res = await fetch('/api/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ password: pw })
    });
    if(!res.ok){ errEl.textContent = 'Wrong password'; return; }
    const data = await res.json();
    localStorage.setItem(LS_TOKEN, data.token);
    hideLogin();
    await syncNow({ fullReconcile: true });
  }catch{
    errEl.textContent = 'Cannot reach the server';
  }
}

/* ---------------- helpers ---------------- */

function uid(){ return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

// Local calendar date as YYYY-MM-DD (NOT UTC — avoids the date rolling a day
// early/late for non-UTC timezones, e.g. IST before 05:30).
function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if(isNaN(d)) return iso;
  return d.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
}

function calcPOD(surgeryDateISO){
  if(!surgeryDateISO) return null;
  const surg = new Date(surgeryDateISO + 'T00:00:00');
  const now = new Date(); now.setHours(0,0,0,0);
  const diff = Math.round((now - surg) / 86400000);
  return diff;
}

function escapeHTML(s){
  if(s===undefined || s===null) return '';
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function emptyStateSvg(kind){
  const icons = {
    bed:'<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    check:'<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    clipboard:'<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>'
  };
  return icons[kind] || icons.bed;
}

function workItemIcon(kind, urgency){
  const map = {
    handover:'↪', abx:'Rx', lab:'Lb', inv:'?', fit:'✓', postop:'⏱', discharge:'☐', plan:'✎', good:'✓'
  };
  if(kind === 'abx' || kind === 'lab' || kind === 'inv') return map[kind] || '!';
  if(kind === 'postop') return '⏱';
  if(kind === 'plan') return '✎';
  if(urgency === 'good') return '✓';
  if(urgency === 'urgent') return '!';
  return map[kind] || '•';
}

function showToast(msg, opts){
  opts = opts || {};
  const t = document.getElementById('toast');
  clearTimeout(t._timer);
  t.classList.remove('success', 'warn', 'error');
  if(opts.success) t.classList.add('success');
  else if(opts.warn) t.classList.add('warn');
  else if(opts.error) t.classList.add('error');
  if(opts.undo){
    t.innerHTML = `<span class="toast-msg">${escapeHTML(msg)}</span><button type="button" class="toast-undo">Undo</button>`;
    t.querySelector('.toast-undo').onclick = ()=>{
      clearTimeout(t._timer);
      t.classList.remove('show');
      opts.undo();
    };
  }else if(opts.onClick){
    t.innerHTML = `<span class="toast-msg">${escapeHTML(msg)}</span>`;
    t.style.cursor = 'pointer';
    t.onclick = ()=>{
      clearTimeout(t._timer);
      t.classList.remove('show');
      t.style.cursor = '';
      t.onclick = null;
      opts.onClick();
    };
  }else{
    t.textContent = msg;
    t.onclick = null;
    t.style.cursor = '';
  }
  t.classList.add('show');
  t._timer = setTimeout(()=>{
    t.classList.remove('show');
    t.onclick = null;
    t.style.cursor = '';
  }, opts.duration || (opts.undo ? 8000 : 2200));
}

let appDialogResolver = null;

function closeAppDialog(value){
  document.getElementById('appDialogModal').classList.remove('active');
  const resolve = appDialogResolver;
  appDialogResolver = null;
  if(resolve) resolve(value);
}

function showAppDialog(opts){
  opts = opts || {};
  return new Promise(resolve => {
    appDialogResolver = resolve;
    const overlay = document.getElementById('appDialogModal');
    document.getElementById('appDialogTitle').textContent = opts.title || 'Confirm';
    const msgEl = document.getElementById('appDialogMessage');
    if(opts.message){
      msgEl.textContent = opts.message;
      msgEl.style.display = '';
    }else{
      msgEl.textContent = '';
      msgEl.style.display = 'none';
    }

    const fieldsEl = document.getElementById('appDialogFields');
    fieldsEl.innerHTML = '';
    (opts.fields || []).forEach(f => {
      const wrap = document.createElement('div');
      wrap.className = 'form-row';
      wrap.style.marginBottom = '10px';
      const lab = document.createElement('label');
      lab.textContent = f.label || '';
      lab.setAttribute('for', 'adf_' + f.id);
      wrap.appendChild(lab);
      let input;
      if(f.type === 'textarea'){
        input = document.createElement('textarea');
        input.rows = f.rows || 4;
      }else{
        input = document.createElement('input');
        input.type = f.type || 'text';
      }
      input.id = 'adf_' + f.id;
      input.value = f.value ?? '';
      if(f.placeholder) input.placeholder = f.placeholder;
      if(f.maxlength) input.maxLength = f.maxlength;
      wrap.appendChild(input);
      fieldsEl.appendChild(wrap);
    });

    const btnRow = document.getElementById('appDialogButtons');
    btnRow.innerHTML = '';
    (opts.buttons || [{ label: 'OK', value: true, primary: true }]).forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', ()=>{
        if(b.value === false || b.value === 'cancel' || b.value == null){
          closeAppDialog(b.value === undefined ? false : b.value);
          return;
        }
        const out = { action: b.value };
        if((opts.fields || []).length){
          out.fields = {};
          for(const f of opts.fields){
            const el = document.getElementById('adf_' + f.id);
            if(el) out.fields[f.id] = el.value;
          }
        }
        closeAppDialog(out);
      });
      btnRow.appendChild(btn);
    });

    document.getElementById('appDialogClose').onclick = ()=> closeAppDialog(false);
    overlay.classList.add('active');
    const firstInput = fieldsEl.querySelector('input, textarea');
    if(firstInput) setTimeout(()=> firstInput.focus(), 50);
  });
}

function showConfirm(title, message, opts){
  opts = opts || {};
  return showAppDialog({
    title,
    message,
    buttons: [
      { label: opts.cancelLabel || 'Cancel', value: false },
      { label: opts.confirmLabel || 'Confirm', value: true, primary: true, danger: !!opts.danger }
    ]
  }).then(r => !!(r && r.action));
}

function showMergeReplaceDialog(title, message){
  return showAppDialog({
    title,
    message,
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Merge', value: 'merge', primary: true },
      { label: 'Replace all', value: 'replace', danger: true }
    ]
  }).then(r => (r && r.action) || 'cancel');
}

function showPromptFields(title, fields){
  return showAppDialog({
    title,
    fields,
    buttons: [
      { label: 'Cancel', value: false },
      { label: 'OK', value: true, primary: true }
    ]
  }).then(r => (r && r.action && r.fields) ? r.fields : null);
}

function fileToDataURL(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* compress image client-side so the DB / export files don't balloon */
function compressImage(dataURL, maxDim=1100, quality=0.8){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>{
      let {width, height} = img;
      if(width > maxDim || height > maxDim){
        if(width > height){ height = Math.round(height * maxDim/width); width = maxDim; }
        else { width = Math.round(width * maxDim/height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = ()=> resolve(dataURL);
    img.src = dataURL;
  });
}

function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------- patient data shape (defaults) ---------------- */

function blankPatient(){
  return {
    id: uid(),
    name: '', age: '', sex: 'M', bed: '', ward: '', uhid: '',
    admissionDate: todayISO(),
    diagnosis: '',
    surgeryDate: '', procedure: '', surgeon: '', implant: '',
    status: 'preop',   // preop | conservative | postop | fordischarge
    investigations: [], // {name, status: pending|done|abnormal, value}
    fitness: [],         // {dept, status: pending|done, date}
    images: [],           // {id, type: preop|postop|followup, dataURL, date, label}
    dailyPlan: '',
    dailyPlanDate: '',   // ISO date the current plan applies to
    planHistory: [],     // { date, text, by }
    handoverNote: '',
    assignedPg: '',
    postOpChecks: [],    // { id, label, duePod, status, doneAt }
    dischargeChecks: [], // { id, label, status, doneAt }
    complications: [],   // { type, date, note }
    notes: '',
    dischargeDate: '',
    antibiotics: '',
    antibioticsStart: '',
    antibioticsDays: 0,
    antibioticsStoppedDate: '',
    dvtProphylaxis: '',
    dvtStart: '',
    dvtDays: 0,
    theatreTime: '',
    handoverPin: '',
    labs: { hb: '', crp: '', wcc: '', creatinine: '', updatedAt: '' },
    planUpdatedAt: 0,
    statusUpdatedAt: 0,
    createdAt: Date.now()
  };
}

const COMMON_INVESTIGATIONS = ["Hb","TLC/DLC","Platelet count","RBS","RFT","LFT","Serum electrolytes","PT/INR","HIV/HbsAg/HCV","ECG","2D Echo","Chest X-ray"];
const COMMON_FITNESS = ["Anesthesia fitness","Medicine fitness","Cardiology fitness","Pulmonology fitness","Endocrinology (diabetic) fitness"];

function renderPlanTemplatePickerOptions(selectedId){
  const types = [
    { type: 'postop_pathway', label: 'Post-op pathways' },
    { type: 'conservative_pathway', label: 'Conservative pathways' },
    { type: 'preop', label: 'Pre-op plans' }
  ];
  let html = '<option value="">— choose pathway —</option>';
  for(const g of types){
    const items = getTemplatesByType(g.type);
    if(!items.length) continue;
    html += `<optgroup label="${escapeHTML(g.label)}">`;
    html += items.map(t => `<option value="${escapeHTML(t.id)}" ${t.id===selectedId?'selected':''}>${escapeHTML(t.name)}</option>`).join('');
    html += '</optgroup>';
  }
  return html;
}

function renderTemplatePickerOptions(selectedId){
  const types = [
    { type: 'postop_pathway', label: 'Post-op pathways' },
    { type: 'discharge', label: 'Discharge packs' },
    { type: 'preop', label: 'Pre-op' }
  ];
  let html = '<option value="">— choose template —</option>';
  for(const g of types){
    const items = getTemplatesByType(g.type);
    if(!items.length) continue;
    html += `<optgroup label="${escapeHTML(g.label)}">`;
    html += items.map(t => `<option value="${escapeHTML(t.id)}" ${t.id===selectedId?'selected':''}>${escapeHTML(t.name)}</option>`).join('');
    html += '</optgroup>';
  }
  return html;
}

function renderLibraryItemPickerOptions(kind){
  const opts = ['<option value="">— pick from library —</option>'];
  for(const tpl of getMergedTemplates()){
    if(kind === 'postop' && tpl.type !== 'postop_pathway' && tpl.type !== 'conservative_pathway') continue;
    if(kind === 'discharge' && tpl.type !== 'discharge') continue;
    for(const it of (tpl.items || [])){
      opts.push(`<option value="${escapeHTML(tpl.id)}::${escapeHTML(it.id)}">${escapeHTML(tpl.name)} — ${escapeHTML(it.label)}</option>`);
    }
  }
  return opts.join('');
}

function addLibraryItemToPatient(field, compositeKey){
  if(!compositeKey) return false;
  const [tplId, itemId] = compositeKey.split('::');
  const tpl = getTemplateById(tplId);
  if(!tpl) return false;
  const def = (tpl.items || []).find(i => i.id === itemId);
  if(!def) return false;
  const d = getWorkingData();
  d[field] = d[field] || [];
  if(d[field].some(c => c.id === def.id)) return false;
  const isDischarge = field === 'dischargeChecks';
  d[field].push(templateItemToPatientItem(def, tpl.id, isDischarge));
  setWorkingData(d);
  return true;
}

function syncModalFieldsToWorkingData(){
  const d = getWorkingData();
  const surgeryEl = document.getElementById('f_surgeryDate');
  const statusEl = document.getElementById('f_status');
  const procEl = document.getElementById('f_procedure');
  const dxEl = document.getElementById('f_diagnosis');
  if(surgeryEl) d.surgeryDate = surgeryEl.value;
  if(statusEl) d.status = statusEl.value;
  if(procEl) d.procedure = procEl.value.trim();
  if(dxEl) d.diagnosis = dxEl.value.trim();
  setWorkingData(d);
  return d;
}

function renderMilestoneTemplatePickerOptions(selectedId){
  const types = [
    { type: 'conservative_pathway', label: 'Conservative pathways' },
    { type: 'postop_pathway', label: 'Post-op pathways' }
  ];
  let html = '<option value="">— choose template —</option>';
  for(const g of types){
    const items = getTemplatesByType(g.type);
    if(!items.length) continue;
    html += `<optgroup label="${escapeHTML(g.label)}">`;
    html += items.map(t => `<option value="${escapeHTML(t.id)}" ${t.id===selectedId?'selected':''}>${escapeHTML(t.name)}</option>`).join('');
    html += '</optgroup>';
  }
  return html;
}

function getClinicalDayInfo(p){
  const day = getPatientPod(p);
  if(day === null) return null;
  return { day, prefix: milestoneDayPrefix(p) };
}

function getWorkingPatientPod(){
  const d = syncModalFieldsToWorkingData();
  return getPatientPod(d);
}

function syncDailyPlanTextarea(d){
  const ta = document.getElementById('f_dailyPlan');
  if(ta && d) ta.value = d.dailyPlan || '';
}

function renderTemplatePickerOptionsForType(type, selectedId){
  const items = getTemplatesByType(type);
  let html = '<option value="">— choose template —</option>';
  html += items.map(t => `<option value="${escapeHTML(t.id)}" ${t.id===selectedId?'selected':''}>${escapeHTML(t.name)}</option>`).join('');
  return html;
}

function getPgInitials(){
  return (localStorage.getItem(LS_PG_INITIALS) || '').trim().toUpperCase();
}

async function ensurePgInitials(){
  let ini = getPgInitials();
  if(ini) return ini;
  const fields = await showPromptFields('Your initials', [
    { id: 'initials', label: 'PG initials (e.g. AK)', value: '', placeholder: 'AK', maxlength: 6 }
  ]);
  if(fields && fields.initials && fields.initials.trim()){
    ini = fields.initials.trim().toUpperCase().slice(0, 6);
    localStorage.setItem(LS_PG_INITIALS, ini);
    updatePgInitialsUI();
    return ini;
  }
  return '';
}

function updatePgInitialsUI(){
  const el = document.getElementById('pgInitialsInput');
  if(el) el.value = getPgInitials();
}

function archivePlanToHistory(p, text, date, by){
  if(!text || !date) return;
  p.planHistory = p.planHistory || [];
  const last = p.planHistory[p.planHistory.length - 1];
  if(last && last.date === date && last.text === text) return;
  p.planHistory.push({ date, text, by: by || '' });
  if(p.planHistory.length > PLAN_HISTORY_MAX){
    p.planHistory = p.planHistory.slice(-PLAN_HISTORY_MAX);
  }
}

function parseWardFromBed(bed){
  const s = String(bed || '').trim();
  if(!s) return 'Unassigned';
  const split = s.match(/^(.+?)[\-\s\/]/);
  if(split) return split[1].trim().toUpperCase();
  const m = s.match(/^([A-Za-z]+\d*[A-Za-z]*)/);
  if(m) return m[1].toUpperCase();
  return s.toUpperCase();
}

function getPatientWard(p){
  return (p.ward || '').trim() || parseWardFromBed(p.bed);
}

function cloneChecklist(items){
  return (items || []).map(c => Object.assign({}, c));
}

function getYesterdayPlan(p){
  const hist = p.planHistory || [];
  if(hist.length) return hist[hist.length - 1];
  if(p.dailyPlan && p.dailyPlanDate && p.dailyPlanDate !== todayISO()){
    return { date: p.dailyPlanDate, text: p.dailyPlan, by: '' };
  }
  return null;
}

function isConsultantMode(){
  return localStorage.getItem(LS_CONSULTANT_MODE) === '1' || location.hash === '#consultant';
}

function setConsultantMode(on){
  localStorage.setItem(LS_CONSULTANT_MODE, on ? '1' : '0');
  document.body.classList.toggle('consultant-mode', on);
  const btn = document.getElementById('consultantModeBtn');
  if(btn) btn.classList.toggle('active', on);
  renderAll();
}

function getPgRoster(){
  return Array.isArray(wardMeta.pgRoster) ? wardMeta.pgRoster : [];
}

function getPgRosterInitials(){
  const roster = getPgRoster();
  if(roster.length) return roster.map(r => (r.initials || '').trim().toUpperCase()).filter(Boolean);
  const seen = new Set();
  patients.forEach(p => {
    const ini = (p.assignedPg || '').trim().toUpperCase();
    if(ini) seen.add(ini);
  });
  const mine = getPgInitials();
  if(mine) seen.add(mine);
  return [...seen];
}

function daysSince(iso){
  if(!iso) return null;
  const a = new Date(iso + 'T12:00:00');
  const b = new Date(todayISO() + 'T12:00:00');
  return Math.floor((b - a) / 86400000) + 1;
}

function computeTherapyDay(p, startField){
  const start = p[startField];
  if(start) return daysSince(start);
  if(p.status === 'conservative' && p.admissionDate){
    return daysSince(p.admissionDate);
  }
  if(p.surgeryDate && (p.status === 'postop' || p.status === 'fordischarge')){
    return daysSince(p.surgeryDate);
  }
  return null;
}

function parseTherapyDays(val){
  const n = parseInt(val, 10);
  return n > 0 ? n : 0;
}

/** Antibiotic course: day count, duration, and reminder status. */
function getAntibioticsCourse(p){
  const name = (p.antibiotics || '').trim();
  const duration = parseTherapyDays(p.antibioticsDays);
  if(!name && !duration) return null;
  if(p.antibioticsStoppedDate){
    return {
      status: 'stopped',
      name: name || 'Antibiotics',
      label: `${name || 'Abx'} stopped · ${fmtDate(p.antibioticsStoppedDate)}`,
      flagType: 'good'
    };
  }
  const day = computeTherapyDay(p, 'antibioticsStart');
  const drug = name || 'Antibiotics';
  if(day == null){
    return {
      status: 'needs_start',
      name: drug,
      day: null,
      duration,
      label: duration ? `${drug} — set start date (${duration}d course)` : `${drug} — set start date`,
      flagType: 'warn'
    };
  }
  if(!duration){
    return {
      status: 'active',
      name: drug,
      day,
      duration: 0,
      label: `${drug} day ${day}`,
      flagType: 'warn'
    };
  }
  if(day > duration){
    return {
      status: 'overdue',
      name: drug,
      day,
      duration,
      label: `${drug} day ${day}/${duration} — STOP overdue`,
      flagType: 'bad'
    };
  }
  if(day === duration){
    return {
      status: 'last_day',
      name: drug,
      day,
      duration,
      label: `${drug} last day today (${day}/${duration})`,
      flagType: 'bad'
    };
  }
  if(day === duration - 1){
    return {
      status: 'ending_soon',
      name: drug,
      day,
      duration,
      label: `${drug} day ${day}/${duration} — stops tomorrow`,
      flagType: 'warn'
    };
  }
  return {
    status: 'active',
    name: drug,
    day,
    duration,
    label: `${drug} day ${day}/${duration}`,
    flagType: 'good'
  };
}

function getDvtCourse(p){
  const name = (p.dvtProphylaxis || '').trim();
  const duration = parseTherapyDays(p.dvtDays);
  const day = computeTherapyDay(p, 'dvtStart');
  if(!name && day == null) return null;
  const drug = name || 'LMWH';
  if(!duration){
    return day != null
      ? { label: `${drug} day ${day}`, flagType: 'good' }
      : null;
  }
  if(day == null) return { label: `${drug} — set start (${duration}d)`, flagType: 'warn' };
  if(day > duration) return { label: `${drug} day ${day}/${duration} — stop overdue`, flagType: 'bad' };
  if(day === duration) return { label: `${drug} last day (${day}/${duration})`, flagType: 'warn' };
  return { label: `${drug} day ${day}/${duration}`, flagType: 'good' };
}

function getTherapyBadges(p){
  const badges = [];
  const abx = getAntibioticsCourse(p);
  if(abx && abx.status !== 'stopped') badges.push({ label: abx.label, type: abx.flagType === 'bad' ? 'bad' : abx.flagType === 'good' ? 'good' : 'warn' });
  const dvt = getDvtCourse(p);
  if(dvt) badges.push({ label: dvt.label, type: dvt.flagType === 'bad' ? 'bad' : dvt.flagType === 'good' ? 'good' : 'warn' });
  return badges;
}

async function markAntibioticsStopped(p){
  p.antibioticsStoppedDate = todayISO();
  await persistAndRerender(p);
  showToast('Antibiotics marked stopped', {
    undo: async ()=>{
      p.antibioticsStoppedDate = '';
      await persistAndRerender(p);
    }
  });
}

function labValueClass(key, val){
  const n = parseFloat(val);
  if(isNaN(n)) return '';
  const th = LAB_THRESHOLDS[key];
  if(th == null) return '';
  if(key === 'hb' && n < th) return 'lab-low';
  if(key === 'creatinine' && n > th) return 'lab-high';
  if((key === 'crp' || key === 'wcc') && n > th) return 'lab-high';
  return '';
}

function formatLabsLine(p){
  const labs = p.labs || {};
  const parts = [];
  if(labs.hb) parts.push(`Hb ${labs.hb}`);
  if(labs.crp) parts.push(`CRP ${labs.crp}`);
  if(labs.wcc) parts.push(`WCC ${labs.wcc}`);
  if(labs.creatinine) parts.push(`Cr ${labs.creatinine}`);
  return parts.join(' · ');
}

function touchChecklistItem(c){
  c.updatedAt = Date.now();
  return c;
}

function mergeChecklistById(localItems, remoteItems){
  const byId = new Map();
  for(const c of (remoteItems || [])){
    if(c && c.id) byId.set(c.id, Object.assign({}, c));
  }
  for(const c of (localItems || [])){
    if(!c || !c.id) continue;
    const r = byId.get(c.id);
    if(!r){ byId.set(c.id, Object.assign({}, c)); continue; }
    const lt = Number(c.updatedAt) || 0;
    const rt = Number(r.updatedAt) || 0;
    byId.set(c.id, lt >= rt ? Object.assign({}, c) : Object.assign({}, r));
  }
  return [...byId.values()];
}

function mergePlanHistory(localHist, remoteHist){
  const byDate = new Map();
  for(const h of (remoteHist || [])){
    if(h && h.date) byDate.set(h.date, h);
  }
  for(const h of (localHist || [])){
    if(h && h.date) byDate.set(h.date, h);
  }
  return [...byDate.values()].sort((a,b)=> String(a.date).localeCompare(String(b.date))).slice(-PLAN_HISTORY_MAX);
}

function mergePatientRecords(local, remote){
  if(!local) return Object.assign({}, remote);
  if(!remote) return Object.assign({}, local);
  const merged = Object.assign({}, remote, local);
  merged.postOpChecks = mergeChecklistById(local.postOpChecks, remote.postOpChecks);
  merged.dischargeChecks = mergeChecklistById(local.dischargeChecks, remote.dischargeChecks);
  merged.planHistory = mergePlanHistory(local.planHistory, remote.planHistory);
  merged.labs = Object.assign({}, remote.labs || {}, local.labs || {});

  const localPlanTs = Number(local.planUpdatedAt) || 0;
  const remotePlanTs = Number(remote.planUpdatedAt) || 0;
  if(remotePlanTs > localPlanTs){
    merged.dailyPlan = remote.dailyPlan;
    merged.dailyPlanDate = remote.dailyPlanDate;
    merged.planUpdatedAt = remotePlanTs;
  }else if(localPlanTs >= remotePlanTs){
    merged.dailyPlan = local.dailyPlan;
    merged.dailyPlanDate = local.dailyPlanDate;
    merged.planUpdatedAt = localPlanTs || merged.planUpdatedAt;
  }

  const localStatusTs = Number(local.statusUpdatedAt) || 0;
  const remoteStatusTs = Number(remote.statusUpdatedAt) || 0;
  if(remoteStatusTs > localStatusTs){
    merged.status = remote.status;
    merged.statusBeforeDischarge = remote.statusBeforeDischarge;
    merged.statusUpdatedAt = remoteStatusTs;
  }else if(localStatusTs > remoteStatusTs){
    merged.status = local.status;
    merged.statusBeforeDischarge = local.statusBeforeDischarge;
    merged.statusUpdatedAt = localStatusTs;
  }

  merged.updatedAt = Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0);
  delete merged._dirty;
  return merged;
}

function detectPatientConflicts(local, remote){
  const conflicts = [];
  if(!local || !remote) return conflicts;
  const localPlanTs = Number(local.planUpdatedAt) || 0;
  const remotePlanTs = Number(remote.planUpdatedAt) || 0;
  if(localPlanTs && remotePlanTs && localPlanTs !== remotePlanTs
    && (local.dailyPlan || '') !== (remote.dailyPlan || '')){
    conflicts.push({ field: 'dailyPlan', local: local.dailyPlan, remote: remote.dailyPlan, localTs: localPlanTs, remoteTs: remotePlanTs });
  }
  const localStatusTs = Number(local.statusUpdatedAt) || 0;
  const remoteStatusTs = Number(remote.statusUpdatedAt) || 0;
  if(localStatusTs && remoteStatusTs && localStatusTs !== remoteStatusTs && local.status !== remote.status){
    conflicts.push({ field: 'status', local: local.status, remote: remote.status });
  }
  return conflicts;
}

function showConflictCompare(patientId, conflict){
  const localP = patients.find(x => x.id === patientId);
  if(!localP || !conflict) return;
  showAppDialog({
    title: conflict.field === 'dailyPlan' ? 'Plan updated elsewhere' : 'Status changed elsewhere',
    message: conflict.field === 'dailyPlan'
      ? `This device:\n${conflict.local || '—'}\n\nOther device:\n${conflict.remote || '—'}`
      : `This device: ${conflict.local}\nOther device: ${conflict.remote}`,
    buttons: [
      { label: 'Keep mine', value: 'local' },
      { label: 'Use other', value: 'remote', primary: true }
    ]
  }).then(choice => {
    if(!choice || choice.action === 'cancel') return;
    if(choice.action === 'remote'){
      if(conflict.field === 'dailyPlan'){
        localP.dailyPlan = conflict.remote;
        localP.planUpdatedAt = conflict.remoteTs || Date.now();
      }else{
        localP.status = conflict.remote;
        localP.statusUpdatedAt = Date.now();
      }
      void persistAndRerender(localP);
    }
  });
}

function patientNeedsAttention(p){
  const w = collectWorklistData();
  const inList = (arr)=> arr.some(it => it.p.id === p.id);
  return inList(w.pendingInvItems) || inList(w.abnormalItems) || inList(w.pendingFitItems)
    || inList(w.handoverItems) || inList(w.postOpOverdueItems) || inList(w.postOpDueItems)
    || inList(w.planMissingItems) || inList(w.dischargeIncompleteItems)
    || inList(w.abxLastDayItems) || inList(w.abxOverdueItems);
}

function getNextDueMilestones(p, limit){
  const pod = getPatientPod(p);
  if(pod == null) return [];
  const due = [...getOverduePostOpChecks(p), ...getDuePostOpChecks(p), ...getUpcomingPostOpChecks(p, 2)];
  const seen = new Set();
  const out = [];
  for(const c of due){
    if(seen.has(c.id)) continue;
    seen.add(c.id);
    if(c.status === 'done' || c.status === 'skipped' || c.status === 'na') continue;
    out.push(c);
    if(out.length >= limit) break;
  }
  return out;
}

function saveCardPlan(p, text){
  const trimmed = (text || '').trim();
  const prevPlan = p.dailyPlan;
  const prevDate = p.dailyPlanDate;
  if(trimmed){
    p.dailyPlan = trimmed;
    p.dailyPlanDate = todayISO();
    p.planUpdatedAt = Date.now();
    archivePlanToHistory(p, trimmed, todayISO(), getPgInitials());
  }else{
    p.dailyPlan = '';
    p.dailyPlanDate = '';
    p.planUpdatedAt = Date.now();
  }
  return { prevPlan, prevDate };
}

async function cycleCardStatus(p){
  const idx = STATUS_CYCLE.indexOf(p.status);
  const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
  if(next === 'conservative'){
    if(!p.admissionDate) p.admissionDate = todayISO();
    if(!p.postOpChecks || !p.postOpChecks.length) applyConservativeTemplate(p);
  }
  if(next === 'postop'){
    if(!p.surgeryDate) p.surgeryDate = todayISO();
    if(!p.postOpChecks || !p.postOpChecks.length) applyPostOpTemplate(p);
  }
  if(next === 'fordischarge'){
    applyDischargeTemplate(p);
  }
  p.status = next;
  p.statusUpdatedAt = Date.now();
  await persistAndRerender(p);
  showToast(`Status → ${STATUS_LABELS[next] || next}`);
}

async function cycleCardPg(p){
  const roster = getPgRosterInitials();
  if(!roster.length){
    const fields = await showPromptFields('Assign PG', [
      { id: 'pg', label: 'PG initials', value: p.assignedPg || getPgInitials(), maxlength: 6 }
    ]);
    if(fields && fields.pg){
      p.assignedPg = fields.pg.trim().toUpperCase();
      await persistAndRerender(p);
    }
    return;
  }
  const cur = (p.assignedPg || '').toUpperCase();
  let idx = roster.indexOf(cur);
  idx = (idx + 1) % (roster.length + 1);
  p.assignedPg = idx >= roster.length ? '' : roster[idx];
  await persistAndRerender(p);
  showToast(p.assignedPg ? `Assigned ${p.assignedPg}` : 'PG unassigned');
}

function restoreSavedFilter(){
  const saved = localStorage.getItem(LS_FILTER);
  if(saved){
    currentFilter = saved;
    document.querySelectorAll('.filter-chip').forEach(c=>{
      c.classList.toggle('active', c.dataset.filter === saved);
    });
  }else if(getPgInitials()){
    currentFilter = 'mine';
    document.querySelectorAll('.filter-chip').forEach(c=>{
      c.classList.toggle('active', c.dataset.filter === 'mine');
    });
  }
  updateFilterUI();
}

function maybeAutoSwitchWorklist(){
  const today = todayISO();
  if(localStorage.getItem(LS_AUTO_WORKLIST) === today) return;
  localStorage.setItem(LS_AUTO_WORKLIST, today);
  switchView('worklist');
}

async function runOnboarding(){
  if(localStorage.getItem(LS_ONBOARDED)) return;
  const ini = await ensurePgInitials();
  const filterChoice = await showAppDialog({
    title: 'Welcome to Ortho Rounds',
    message: 'Set how you want to start each day. You can change filters anytime.',
    buttons: [
      { label: 'All patients', value: 'all' },
      { label: 'My patients only', value: 'mine', primary: true }
    ]
  });
  if(filterChoice && filterChoice.action !== 'cancel'){
    currentFilter = filterChoice.action;
    localStorage.setItem(LS_FILTER, currentFilter);
    document.querySelectorAll('.filter-chip').forEach(c=>{
      c.classList.toggle('active', c.dataset.filter === currentFilter);
    });
  }else if(ini){
    currentFilter = 'mine';
    localStorage.setItem(LS_FILTER, 'mine');
  }
  await showAppDialog({
    title: 'Tip: use on your phone',
    message: 'Open the network URL printed when the server starts, then Add to Home Screen for quick access offline.',
    buttons: [{ label: 'Got it', value: 'ok', primary: true }]
  });
  localStorage.setItem(LS_ONBOARDED, '1');
}

function maybeNudgeBackup(){
  const last = Number(localStorage.getItem(LS_LAST_EXPORT) || 0);
  const nudgeAt = Number(localStorage.getItem(LS_BACKUP_NUDGE) || 0);
  const week = 7 * 86400000;
  if(Date.now() - last < week) return;
  if(Date.now() - nudgeAt < week) return;
  localStorage.setItem(LS_BACKUP_NUDGE, String(Date.now()));
  showAppDialog({
    title: 'Backup reminder',
    message: 'It has been a while since your last export. Download a JSON backup from More → Export?',
    buttons: [
      { label: 'Later', value: 'later' },
      { label: 'Export now', value: 'export', primary: true }
    ]
  }).then(choice => {
    if(choice && choice.action === 'export') exportData();
  });
}

function imageSrc(img){
  if(!img) return '';
  if(img.url){
    // Server-hosted images are auth-protected. An <img> tag can't send the
    // Authorization header, so pass the token as a query param instead.
    if(img.url.startsWith('/api/images/')){
      const token = localStorage.getItem(LS_TOKEN);
      if(token){
        return img.url + (img.url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
      }
    }
    return img.url;
  }
  return img.dataURL || '';
}

async function uploadPatientImage(patientId, dataURL){
  try{
    const res = await api('/api/images', { method: 'POST', body: JSON.stringify({ patientId, dataURL }) });
    return res.url;
  }catch{
    return null;
  }
}

async function saveWardMeta(partial){
  wardMeta = Object.assign({}, wardMeta, partial, { updatedAt: Date.now() });
  const rec = Object.assign({ id: WARD_META_ID, deleted: false, handoverNote: wardMeta.handoverNote || '' }, wardMeta);
  await cachePut(rec, true);
  scheduleSync();
}

async function loadWardMetaFromCache(){
  const rec = await cacheGet(WARD_META_ID);
  if(rec) wardMeta = {
    handoverNote: rec.handoverNote || '',
    pgRoster: Array.isArray(rec.pgRoster) ? rec.pgRoster : [],
    updatedAt: rec.updatedAt || 0
  };
}

function getFilteredRoundsItems(){
  const search = (document.getElementById('searchInput').value||'').toLowerCase();
  let items = patients.filter(p=>p.status!=='discharged');

  if(currentFilter==='preop') items = items.filter(p=>p.status==='preop');
  if(currentFilter==='conservative') items = items.filter(p=>p.status==='conservative');
  if(currentFilter==='postop') items = items.filter(p=>p.status==='postop');
  if(currentFilter==='fordischarge') items = items.filter(p=>p.status==='fordischarge');
  if(currentFilter==='flagged') items = items.filter(p=>getPatientFlags(p).some(f=>f.type==='bad'||f.type==='warn'));
  if(currentFilter==='mine'){
    const ini = getPgInitials();
    items = ini ? items.filter(p => (p.assignedPg || '').toUpperCase() === ini) : [];
  }
  if(currentFilter==='attention'){
    items = items.filter(p => patientNeedsAttention(p));
  }
  if(currentFilter==='unpresented'){
    items = items.filter(p => !isPresented(p.id));
  }
  if(currentFilter==='needsplan'){
    items = items.filter(p => !hasPlanToday(p));
  }
  if(currentFilter==='ottoday'){
    const t = todayISO();
    items = items.filter(p =>
      p.surgeryDate === t || (p.status === 'postop' && p.surgeryDate && calcPOD(p.surgeryDate) === 0)
    );
    items.sort((a,b)=> (a.theatreTime||'').localeCompare(b.theatreTime||''));
  }

  if(search){
    items = items.filter(p=>
      (p.name||'').toLowerCase().includes(search) ||
      (p.bed||'').toLowerCase().includes(search) ||
      (p.ward||'').toLowerCase().includes(search) ||
      (p.diagnosis||'').toLowerCase().includes(search) ||
      (p.uhid||'').toLowerCase().includes(search) ||
      (p.assignedPg||'').toLowerCase().includes(search)
    );
  }

  items.sort((a,b)=> (a.bed||'').localeCompare(b.bed||'', undefined, {numeric:true}));
  return items;
}

/** All active inpatients in ward/bed order — ignores list filters (for Present / Census). */
function getActiveRoundsItems(){
  const items = patients.filter(p=>p.status!=='discharged');
  items.sort((a,b)=> (a.bed||'').localeCompare(b.bed||'', undefined, {numeric:true}));
  return items;
}

function updateStickyHeaderOffset(){
  const header = document.querySelector('.app-header');
  if(header){
    document.documentElement.style.setProperty('--header-offset', header.offsetHeight + 'px');
  }
}

function buildExportPatientList(){
  const list = patients.map(p => Object.assign({}, p));
  if((wardMeta.handoverNote || '').trim()){
    list.push({
      id: WARD_META_ID,
      handoverNote: wardMeta.handoverNote,
      updatedAt: wardMeta.updatedAt || Date.now(),
      deleted: false
    });
  }
  if((wardTemplateLibrary.templates || []).length || (wardTemplateLibrary.disabledIds || []).length){
    list.push(Object.assign({
      id: TEMPLATE_LIBRARY_ID,
      deleted: false,
      updatedAt: wardTemplateLibrary.updatedAt || Date.now()
    }, wardTemplateLibrary));
  }
  return list;
}

async function saveTemplateLibrary(){
  wardTemplateLibrary.updatedAt = Date.now();
  const rec = Object.assign({
    id: TEMPLATE_LIBRARY_ID,
    deleted: false,
    version: 1
  }, wardTemplateLibrary);
  await cachePut(rec, true);
  scheduleSync();
}

function groupPatientsByWard(items){
  const groups = new Map();
  for(const p of items){
    const w = getPatientWard(p);
    if(!groups.has(w)) groups.set(w, []);
    groups.get(w).push(p);
  }
  return [...groups.entries()].sort((a,b)=> a[0].localeCompare(b[0], undefined, {numeric:true}));
}

function getPresentedState(){
  try{
    const raw = JSON.parse(localStorage.getItem(LS_PRESENTED) || '{}');
    if(raw.date === todayISO()) return new Set(raw.ids || []);
  }catch{ /* ignore */ }
  return new Set();
}

function markPresented(id){
  const ids = [...getPresentedState(), id];
  localStorage.setItem(LS_PRESENTED, JSON.stringify({ date: todayISO(), ids: [...ids] }));
}

function isPresented(id){
  return getPresentedState().has(id);
}

/* ---------------- writes (cache + sync) ---------------- */

async function savePatient(p){
  const snapshot = JSON.parse(JSON.stringify(p));
  snapshot.updatedAt = Date.now();
  snapshot.deleted = false;
  await cachePut(snapshot, true);
  const clean = Object.assign({}, snapshot);
  delete clean._dirty;
  const idx = patients.findIndex(x => x.id === snapshot.id);
  if(idx >= 0) patients[idx] = clean; else patients.push(clean);
  scheduleSync();
}

async function softDeletePatient(id){
  let rec = await cacheGet(id);
  if(!rec) rec = patients.find(x => x.id === id);
  if(!rec) return;
  rec = Object.assign({}, rec, { deleted: true, updatedAt: Date.now() });
  await cachePut(rec, true);
  patients = patients.filter(x => x.id !== id);
  scheduleSync();
}

/* ---------------- init ---------------- */

async function init(){
  document.getElementById('todayLabel').textContent = new Date().toLocaleDateString('en-IN', {weekday:'long', day:'numeric', month:'long'});
  document.getElementById('todayLabel')?.classList.add('has-today');
  restoreSavedFilter();
  document.body.classList.toggle('consultant-mode', isConsultantMode());
  bindEvents();
  bindAuthEvents();
  updateStorageNotice();
  updatePgInitialsUI();
  renderWardHandoverBanner();
  updateStickyHeaderOffset();
  window.addEventListener('resize', updateStickyHeaderOffset);

  try{
    idb = await openCache();
    await migrateLegacyRecords();
    await reloadFromCache();
    renderAll();
    updateStickyHeaderOffset();
  }catch(err){
    console.error(err);
    showToast('Local cache unavailable — ' + (err.message || 'error'));
  }

  const reachable = await pingServer();
  if(reachable){
    if(hasToken()){
      try{
        await syncNow({ fullReconcile: true });
      }catch{
        renderAll();
      }
      await runOnboarding();
      maybeAutoSwitchWorklist();
      maybeNudgeBackup();
    }else{
      setSyncStatus('offline');
      showLogin();
    }
  }else{
    setSyncStatus('offline');
    renderAll();
  }

  setInterval(()=>{ if(hasToken() && navigator.onLine) syncNow({}); }, 20000);
  setInterval(()=>{ refreshSyncChipLabel(); }, 30000);
  window.addEventListener('online', ()=>{ if(hasToken()) syncNow({}); });
  window.addEventListener('focus', ()=>{ if(hasToken()) syncNow({}); });
}

function updateStorageNotice(){
  const el = document.getElementById('storageNotice');
  if(!el) return;
  const txt = el.querySelector('.storage-notice-text');
  el.style.display = 'flex';
  el.classList.remove('warn');
  txt.innerHTML = `Shared records on this server. Open <code>${escapeHTML(location.origin)}</code> on any device on the same Wi-Fi to see the same data. Use <b>Export</b> for file backups.`;
}

function bindSyncPanelEvents(){
  const chip = document.getElementById('syncChip');
  const panel = document.getElementById('syncPanel');
  if(!chip || !panel) return;

  const togglePanel = (e)=>{
    e.stopPropagation();
    panel.classList.toggle('open');
    if(panel.classList.contains('open')) refreshSyncChipLabel();
  };
  chip.addEventListener('click', togglePanel);
  chip.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(e); }
  });

  document.getElementById('syncPanelRetry').addEventListener('click', async ()=>{
    panel.classList.remove('open');
    try{
      await syncNow({});
      showToast('Sync complete');
    }catch{
      showToast('Sync failed — check connection');
    }
  });

  document.addEventListener('click', (e)=>{
    if(!panel.contains(e.target) && !chip.contains(e.target)) panel.classList.remove('open');
  });
}

function bindAuthEvents(){
  document.getElementById('loginBtn').addEventListener('click', attemptLogin);
  document.getElementById('loginPassword').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') attemptLogin();
  });
}

function bindEvents(){
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.addEventListener('click', ()=> switchView(tab.dataset.view));
  });
  document.querySelectorAll('#filterChips .filter-chip').forEach(chip=>{
    chip.addEventListener('click', ()=> applyFilter(chip.dataset.filter));
  });
  document.getElementById('searchInput').addEventListener('input', ()=>{
    renderRounds();
    renderSummaryStrip();
  });
  document.getElementById('searchDischarged').addEventListener('input', renderDischarged);
  document.getElementById('addPatientFab').addEventListener('click', ()=>{
    if(window._fabLongPress){ window._fabLongPress = false; return; }
    openPatientModal(null);
  });
  let fabTimer = null;
  document.getElementById('addPatientFab').addEventListener('mousedown', ()=>{
    fabTimer = setTimeout(()=>{
      fabTimer = null;
      window._fabLongPress = true;
      const last = patients.filter(p=>p.status!=='discharged').slice(-1)[0];
      if(last) void clonePatientRecord(last);
      else openPatientModal(null);
    }, 600);
  });
  document.getElementById('addPatientFab').addEventListener('mouseup', ()=>{ if(fabTimer){ clearTimeout(fabTimer); fabTimer = null; }});
  document.getElementById('addPatientFab').addEventListener('mouseleave', ()=>{ if(fabTimer){ clearTimeout(fabTimer); fabTimer = null; }});
  document.getElementById('modalCloseBtn').addEventListener('click', closePatientModal);
  document.getElementById('cancelModalBtn').addEventListener('click', closePatientModal);
  document.getElementById('savePatientBtn').addEventListener('click', savePatientFromModal);
  document.getElementById('deletePatientBtn').addEventListener('click', deleteCurrentPatient);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('importBtn').addEventListener('click', ()=> document.getElementById('hiddenImportInput').click());
  document.getElementById('refreshServerBtn').addEventListener('click', refreshFromServer);
  document.getElementById('presentBtn').addEventListener('click', openPresentationMode);
  document.getElementById('censusBtn').addEventListener('click', exportCensus);
  document.getElementById('templatesBtn').addEventListener('click', openTemplateManager);
  document.getElementById('handoverSheetBtn')?.addEventListener('click', printHandoverSheet);
  document.getElementById('pgRosterBtn')?.addEventListener('click', editPgRoster);
  document.getElementById('bulkPlanBtn')?.addEventListener('click', toggleBulkSelectMode);
  document.getElementById('bulkPlanApplyBtn')?.addEventListener('click', applyBulkPlan);
  document.getElementById('whatsappHandoverBtn')?.addEventListener('click', copyHandoverWhatsApp);
  document.getElementById('consultantModeBtn')?.addEventListener('click', ()=> setConsultantMode(!isConsultantMode()));
  document.getElementById('darkModeBtn')?.addEventListener('click', toggleDarkMode);
  document.getElementById('themeToggleBtn')?.addEventListener('click', toggleDarkMode);
  document.getElementById('moreMenuBtn')?.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.getElementById('moreMenuPanel')?.classList.toggle('open');
  });
  document.addEventListener('click', ()=> document.getElementById('moreMenuPanel')?.classList.remove('open'));
  document.getElementById('presentUnpresentedOnly')?.addEventListener('change', (e)=>{
    presentationUnpresentedOnly = e.target.checked;
    localStorage.setItem(LS_PRESENT_UNPRESENTED, presentationUnpresentedOnly ? '1' : '0');
  });
  const unpresCb = document.getElementById('presentUnpresentedOnly');
  if(unpresCb) unpresCb.checked = presentationUnpresentedOnly;
  document.getElementById('presentationReadAloud')?.addEventListener('change', (e)=>{
    presentationReadAloud = e.target.checked;
    if(presentationReadAloud) speakCurrentPresentation();
    else if(window.speechSynthesis) window.speechSynthesis.cancel();
  });
  document.getElementById('pgInitialsInput').addEventListener('change', (e)=>{
    localStorage.setItem(LS_PG_INITIALS, (e.target.value || '').trim().toUpperCase().slice(0, 6));
    updatePgInitialsUI();
    renderRounds();
  });
  document.getElementById('wardHandoverDismiss').addEventListener('click', ()=>{
    document.getElementById('wardHandoverBanner').style.display = 'none';
  });
  document.getElementById('wardHandoverEditBtn').addEventListener('click', editWardHandover);
  document.getElementById('worklistWardHandoverBtn').addEventListener('click', editWardHandover);
  document.getElementById('presentationClose').addEventListener('click', closePresentationMode);
  document.getElementById('presentationPrev').addEventListener('click', ()=> stepPresentation(-1));
  document.getElementById('presentationNext').addEventListener('click', ()=> stepPresentation(1, true));
  document.getElementById('presentationMarkBtn').addEventListener('click', markCurrentPresented);
  document.getElementById('presentationWardJump').addEventListener('change', (e)=>{
    jumpPresentationToWard(e.target.value);
  });
  bindPresentationSwipe();
  document.getElementById('storageNoticeDismiss').addEventListener('click', ()=>{
    document.getElementById('storageNotice').style.display = 'none';
  });
  document.getElementById('hiddenImportInput').addEventListener('change', importData);
  bindTemplateManagerEvents();
  bindSyncPanelEvents();
  document.getElementById('imgViewerClose').addEventListener('click', closeImgViewer);
  document.getElementById('imgViewer').addEventListener('click', (e)=>{ if(e.target.id==='imgViewer') closeImgViewer(); });
  document.getElementById('hiddenFileInput').addEventListener('change', handleImageFileSelected);
  document.getElementById('imgTypeCloseBtn').addEventListener('click', closeImageTypeModal);
  document.getElementById('imgTypePreop').addEventListener('click', ()=> confirmImageType('preop'));
  document.getElementById('imgTypePostop').addEventListener('click', ()=> confirmImageType('postop'));
  document.getElementById('imgTypeFollowup').addEventListener('click', ()=> confirmImageType('followup'));
  bindSheets();
  bindBottomNav();
  populateFilterSheet();
  applyDarkMode();
}

function switchView(name){
  document.querySelectorAll('.tab').forEach(t=> t.classList.toggle('active', t.dataset.view===name));
  document.querySelectorAll('.view').forEach(v=> v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  updateBottomNavActive(name);
  if(name==='worklist') renderWorklist();
  if(name==='discharged') renderDischarged();
  if(name==='rounds') renderSummaryStrip();
}

function renderAll(){
  updateFilterUI();
  renderSummaryStrip();
  renderRounds();
  renderWorklist();
  renderDischarged();
  updateCounts();
  renderWardHandoverBanner();
  updateStickyHeaderOffset();
}

function updateCounts(){
  const active = patients.filter(p=>p.status!=='discharged');
  document.getElementById('countRounds').textContent = active.length;
  document.getElementById('countDischarged').textContent = patients.filter(p=>p.status==='discharged').length;
  document.getElementById('countWork').textContent = countPendingItems();
  updateBottomNavBadge();
}

function getSummaryCounts(){
  const w = collectWorklistData();
  const active = patients.filter(p => p.status !== 'discharged');
  const urgentIds = new Set();
  [...w.postOpOverdueItems, ...w.abxOverdueItems, ...w.abxLastDayItems, ...w.labAbnormalItems, ...w.abnormalItems]
    .forEach(it => urgentIds.add(it.p.id));
  const t = todayISO();
  const otToday = active.filter(p =>
    p.surgeryDate === t || (p.status === 'postop' && p.surgeryDate && calcPOD(p.surgeryDate) === 0)
  ).length;
  const unpresented = active.filter(p => !isPresented(p.id)).length;
  return {
    needsPlan: w.planMissingItems.length,
    urgent: urgentIds.size,
    otToday,
    unpresented
  };
}

function applyFilter(filter){
  currentFilter = filter;
  localStorage.setItem(LS_FILTER, currentFilter);
  document.querySelectorAll('.filter-chip').forEach(c=>{
    c.classList.toggle('active', c.dataset.filter === filter);
  });
  updateFilterUI();
  renderSummaryStrip();
  renderRounds();
}

function updateFilterUI(){
  const label = FILTER_LABELS[currentFilter] || 'All';
  const pill = document.getElementById('filterPillBtn');
  if(pill) pill.textContent = label + ' ▾';
  document.querySelectorAll('#filterSheetBody .filter-chip').forEach(c=>{
    c.classList.toggle('active', c.dataset.filter === currentFilter);
  });
}

function renderSummaryStrip(){
  const el = document.getElementById('summaryStrip');
  if(!el) return;
  const c = getSummaryCounts();
  const chips = [
    { key: 'needsplan', label: 'Needs plan', count: c.needsPlan, filter: 'needsplan', icon: '✎' },
    { key: 'urgent', label: 'Urgent', count: c.urgent, filter: 'attention', urgent: true, icon: '!' },
    { key: 'ottoday', label: 'OT today', count: c.otToday, filter: 'ottoday', icon: '◷' },
    { key: 'unpresented', label: 'Unpresented', count: c.unpresented, filter: 'unpresented', icon: '○' }
  ];
  const prevCounts = renderSummaryStrip._prev || {};
  el.innerHTML = chips.map(ch=>{
    if(!ch.count) return '';
    const active = currentFilter === ch.filter ? ' active' : '';
    const urg = ch.urgent ? ' sc-urgent' : '';
    const pulse = prevCounts[ch.key] !== undefined && prevCounts[ch.key] !== ch.count ? ' pulse' : '';
    return `<button type="button" class="summary-chip${active}${urg}${pulse}" data-summary-filter="${ch.filter}">
      <span class="sc-icon">${ch.icon}</span>${escapeHTML(ch.label)} <span class="sc-count">${ch.count}</span>
    </button>`;
  }).join('');
  renderSummaryStrip._prev = Object.fromEntries(chips.map(ch => [ch.key, ch.count]));
  el.querySelectorAll('[data-summary-filter]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const f = btn.dataset.summaryFilter;
      applyFilter(currentFilter === f ? 'all' : f);
    });
  });
}

function updateBottomNavBadge(){
  const badge = document.getElementById('bottomNavWorkBadge');
  if(!badge) return;
  const n = countPendingItems();
  const w = collectWorklistData();
  const urgent = w.postOpOverdueItems.length + w.abxOverdueItems.length + w.abxLastDayItems.length + w.labAbnormalItems.length;
  if(n > 0){
    badge.style.display = 'flex';
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('urgent', urgent > 0);
  }else{
    badge.style.display = 'none';
  }
}

function getMilestoneProgress(p){
  const checks = [...(p.postOpChecks || []), ...(p.dischargeChecks || [])];
  if(!checks.length) return null;
  const done = checks.filter(c => c.status === 'done' || c.status === 'skipped' || c.status === 'na').length;
  const pending = checks.filter(c => c.status === 'pending').length;
  return { total: checks.length, done, pending };
}

function renderMilestoneDots(p){
  const prog = getMilestoneProgress(p);
  if(!prog) return '';
  const maxDots = Math.min(prog.total, 8);
  const doneDots = Math.round((prog.done / prog.total) * maxDots);
  let dots = '';
  for(let i = 0; i < maxDots; i++){
    const cls = i < doneDots ? 'done' : (prog.pending > 0 && i === doneDots ? 'pending' : '');
    dots += `<span class="ms-dot ${cls}"></span>`;
  }
  const urgent = getPatientFlags(p).filter(f => f.type === 'bad').length;
  const urgentLabel = urgent ? ` · ${urgent} urgent` : '';
  return `<span class="ms-progress">${dots}<span>${prog.done}/${prog.total}${urgentLabel}</span></span>`;
}

function renderFlagsGlance(flags){
  if(!flags.length) return '';
  const visible = flags.slice(0, 2);
  const overflow = flags.length - visible.length;
  let html = visible.map(f=>`<span class="flag ${f.type}">${escapeHTML(f.text)}</span>`).join('');
  if(overflow > 0) html += `<span class="flag-overflow">+${overflow} more</span>`;
  return `<div class="flags">${html}</div>`;
}

function applyDarkMode(){
  const stored = localStorage.getItem(LS_DARK_MODE);
  const root = document.documentElement;
  if(stored === 'dark') root.setAttribute('data-theme', 'dark');
  else if(stored === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  const isDark = stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const btn = document.getElementById('darkModeBtn');
  if(btn) btn.textContent = isDark ? 'Light mode' : 'Dark mode';
  const themeBtn = document.getElementById('themeToggleBtn');
  if(themeBtn){
    themeBtn.dataset.mode = isDark ? 'dark' : 'light';
    themeBtn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    themeBtn.setAttribute('aria-label', themeBtn.title);
  }
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if(themeMeta) themeMeta.content = isDark ? '#0e1016' : '#2c5f6e';
}

function toggleDarkMode(){
  const root = document.documentElement;
  const stored = localStorage.getItem(LS_DARK_MODE);
  let next;
  if(stored === 'dark') next = 'light';
  else if(stored === 'light') next = 'dark';
  else next = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
  localStorage.setItem(LS_DARK_MODE, next);
  applyDarkMode();
  showToast(next === 'dark' ? 'Dark mode on' : 'Light mode on', { success: true });
}

function populateFilterSheet(){
  const body = document.getElementById('filterSheetBody');
  const src = document.getElementById('filterChips');
  if(!body || !src) return;
  body.innerHTML = src.innerHTML;
  body.querySelectorAll('.filter-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      applyFilter(chip.dataset.filter);
      closeSheet('filterSheetOverlay');
    });
  });
  updateFilterUI();
}

function openSheet(id){
  document.getElementById(id)?.classList.add('active');
}

function closeSheet(id){
  document.getElementById(id)?.classList.remove('active');
}

function bindSheets(){
  document.getElementById('filterPillBtn')?.addEventListener('click', ()=>{
    populateFilterSheet();
    openSheet('filterSheetOverlay');
  });
  document.getElementById('filterSheetClose')?.addEventListener('click', ()=> closeSheet('filterSheetOverlay'));
  document.getElementById('filterSheetOverlay')?.addEventListener('click', (e)=>{
    if(e.target.id === 'filterSheetOverlay') closeSheet('filterSheetOverlay');
  });
  document.getElementById('moreSheetClose')?.addEventListener('click', ()=> closeSheet('moreSheetOverlay'));
  document.getElementById('moreSheetOverlay')?.addEventListener('click', (e)=>{
    if(e.target.id === 'moreSheetOverlay') closeSheet('moreSheetOverlay');
  });
  document.querySelectorAll('[data-more-action]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      closeSheet('moreSheetOverlay');
      const a = btn.dataset.moreAction;
      if(a === 'present') openPresentationMode();
      else if(a === 'export') exportData();
      else if(a === 'import') document.getElementById('hiddenImportInput').click();
      else if(a === 'templates') openTemplateManager();
      else if(a === 'census') exportCensus();
      else if(a === 'handover') printHandoverSheet();
      else if(a === 'whatsapp') copyHandoverWhatsApp();
      else if(a === 'pgroster') editPgRoster();
      else if(a === 'bulk') toggleBulkSelectMode();
      else if(a === 'bulkapply') applyBulkPlan();
      else if(a === 'consultant') setConsultantMode(!isConsultantMode());
      else if(a === 'darkmode') toggleDarkMode();
      else if(a === 'discharged') switchView('discharged');
      else if(a === 'refresh') refreshFromServer();
    });
  });
}

function bindBottomNav(){
  document.querySelectorAll('.bottom-nav-item').forEach(item=>{
    item.addEventListener('click', ()=>{
      const nav = item.dataset.nav;
      if(nav === 'rounds') switchView('rounds');
      else if(nav === 'worklist') switchView('worklist');
      else if(nav === 'add'){
        if(window._fabLongPress){ window._fabLongPress = false; return; }
        openPatientModal(null);
      }
      else if(nav === 'search'){
        switchView('rounds');
        const inp = document.getElementById('searchInput');
        if(inp){ inp.focus(); inp.select(); }
      }
      else if(nav === 'more') openSheet('moreSheetOverlay');
    });
  });
  const addBtn = document.querySelector('.bottom-nav-item[data-nav="add"]');
  if(addBtn){
    let fabTimer = null;
    addBtn.addEventListener('mousedown', ()=>{
      fabTimer = setTimeout(()=>{
        fabTimer = null;
        window._fabLongPress = true;
        const last = patients.filter(p=>p.status!=='discharged').slice(-1)[0];
        if(last) void clonePatientRecord(last);
        else openPatientModal(null);
      }, 600);
    });
    addBtn.addEventListener('mouseup', ()=>{ if(fabTimer){ clearTimeout(fabTimer); fabTimer = null; }});
    addBtn.addEventListener('mouseleave', ()=>{ if(fabTimer){ clearTimeout(fabTimer); fabTimer = null; }});
    addBtn.addEventListener('touchstart', ()=>{
      fabTimer = setTimeout(()=>{
        fabTimer = null;
        window._fabLongPress = true;
        const last = patients.filter(p=>p.status!=='discharged').slice(-1)[0];
        if(last) void clonePatientRecord(last);
        else openPatientModal(null);
      }, 600);
    }, { passive: true });
    addBtn.addEventListener('touchend', ()=>{ if(fabTimer){ clearTimeout(fabTimer); fabTimer = null; }});
  }
}

function updateBottomNavActive(view){
  document.querySelectorAll('.bottom-nav-item').forEach(item=>{
    const nav = item.dataset.nav;
    const on = (view === 'rounds' && nav === 'rounds')
      || (view === 'worklist' && nav === 'worklist');
    item.classList.toggle('active', on);
  });
}

function hasPlanToday(p){
  return !!(p.dailyPlan && p.dailyPlanDate === todayISO());
}

function countPendingItems(){
  const w = collectWorklistData();
  return w.pendingInvItems.length
    + w.abnormalItems.length
    + w.pendingFitItems.length
    + w.handoverItems.length
    + w.postOpOverdueItems.length
    + w.postOpDueItems.length
    + w.postOpUpcomingItems.length
    + w.dischargeIncompleteItems.length
    + w.planMissingItems.length
    + w.labAbnormalItems.length
    + w.abxLastDayItems.length
    + w.abxOverdueItems.length
    + (w.hasUnitHandover ? 1 : 0);
}

/** Shared worklist buckets — keep tab badge and worklist view in sync. */
function collectWorklistData(){
  const active = patients.filter(p=>p.status!=='discharged');

  const pendingInvItems = [];
  const abnormalItems = [];
  const pendingFitItems = [];
  const planMissingItems = [];
  const planTodayItems = [];
  const handoverItems = [];
  const postOpOverdueItems = [];
  const postOpDueItems = [];
  const postOpUpcomingItems = [];
  const dischargeIncompleteItems = [];
  const readyForDischarge = [];
  const labAbnormalItems = [];
  const abxLastDayItems = [];
  const abxOverdueItems = [];
  const abxEndingSoonItems = [];

  active.forEach(p=>{
    (p.investigations||[]).forEach(inv=>{
      if(inv.status==='pending') pendingInvItems.push({p, text:inv.name});
      if(inv.status==='abnormal') abnormalItems.push({p, text:inv.name + (inv.value?' — '+inv.value:'')});
    });
    (p.fitness||[]).forEach(f=>{
      if(f.status==='pending') pendingFitItems.push({p, text:f.dept});
    });
    if((p.handoverNote||'').trim()) handoverItems.push({p, text: p.handoverNote.trim()});
    getOverduePostOpChecks(p).forEach(c=> postOpOverdueItems.push({p, text: c.label + ' (overdue)', kind: 'postop', checkId: c.id }));
    getDuePostOpChecks(p).forEach(c=> postOpDueItems.push({p, text: c.label, kind: 'postop', checkId: c.id }));
    getUpcomingPostOpChecks(p, 2).forEach(c=> postOpUpcomingItems.push({p, text: c.label + ' (upcoming)', kind: 'postop', checkId: c.id }));
    if(hasIncompleteDischargeChecks(p)){
      const pending = getPendingRequiredDischargeChecks(p).map(c=>c.label);
      dischargeIncompleteItems.push({p, text: pending.join(', ')});
    }
    if(hasPlanToday(p)){
      planTodayItems.push({p, text:p.dailyPlan});
    }else{
      const text = p.dailyPlan ? `Plan outdated (last set ${fmtDate(p.dailyPlanDate)||'earlier'})` : 'No plan entered for today';
      planMissingItems.push({p, text});
    }
    if(p.status==='fordischarge'){
      const noPending = !(p.investigations||[]).some(i=>i.status==='pending') && !(p.fitness||[]).some(f=>f.status==='pending');
      if(noPending && !hasIncompleteDischargeChecks(p)) readyForDischarge.push({p, text:'All clearances done'});
    }
    const labs = p.labs || {};
    for(const key of ['hb','crp','wcc','creatinine']){
      const val = labs[key];
      if(val && labValueClass(key, val)){
        labAbnormalItems.push({ p, text: `${key.toUpperCase()} ${val}`, kind: 'lab', labKey: key, labVal: val });
      }
    }
    const abx = getAntibioticsCourse(p);
    if(abx){
      if(abx.status === 'last_day'){
        abxLastDayItems.push({ p, text: abx.label, kind: 'abx', abxAction: 'stop' });
      }else if(abx.status === 'overdue'){
        abxOverdueItems.push({ p, text: abx.label, kind: 'abx', abxAction: 'stop' });
      }else if(abx.status === 'ending_soon'){
        abxEndingSoonItems.push({ p, text: abx.label, kind: 'abx' });
      }
    }
  });

  const byWard = (a,b)=> (a.p.bed||'').localeCompare(b.p.bed||'', undefined, {numeric:true});
  [handoverItems, postOpOverdueItems, postOpDueItems, postOpUpcomingItems, dischargeIncompleteItems, planMissingItems, planTodayItems, labAbnormalItems, abxLastDayItems, abxOverdueItems, abxEndingSoonItems].forEach(arr=> arr.sort(byWard));

  return {
    pendingInvItems,
    abnormalItems,
    pendingFitItems,
    planMissingItems,
    planTodayItems,
    handoverItems,
    postOpOverdueItems,
    postOpDueItems,
    postOpUpcomingItems,
    dischargeIncompleteItems,
    readyForDischarge,
    labAbnormalItems,
    abxLastDayItems,
    abxOverdueItems,
    abxEndingSoonItems,
    hasUnitHandover: !!(wardMeta.handoverNote || '').trim()
  };
}

/* ---------------- flags / derived info ---------------- */

function getPatientFlags(p){
  const flags = [];
  const pendingInv = (p.investigations||[]).filter(i=>i.status==='pending');
  const abnormalInv = (p.investigations||[]).filter(i=>i.status==='abnormal');
  const pendingFit = (p.fitness||[]).filter(f=>f.status==='pending');
  const duePostOp = getDuePostOpChecks(p);
  const overduePostOp = getOverduePostOpChecks(p);
  getTherapyBadges(p).forEach(b=> flags.push({ type: b.type === 'info' ? 'good' : 'warn', text: b.label }));
  const labsLine = formatLabsLine(p);
  if(labsLine){
    const labs = p.labs || {};
    const abnormal = ['hb','crp','wcc','creatinine'].some(k => labValueClass(k, labs[k]));
    if(abnormal) flags.push({ type: 'warn', text: labsLine });
  }
  if((p.handoverPin||'').trim()) flags.push({ type: 'warn', text: 'Pin: ' + p.handoverPin.trim() });
  if(pendingInv.length) flags.push({type:'bad', text:`${pendingInv.length} investigation${pendingInv.length>1?'s':''} pending`});
  if(abnormalInv.length) flags.push({type:'warn', text:`${abnormalInv.length} abnormal result${abnormalInv.length>1?'s':''}`});
  if(pendingFit.length) flags.push({type:'bad', text:`${pendingFit.map(f=>f.dept).join(', ')} pending`});
  if(overduePostOp.length) flags.push({type:'bad', text:`${overduePostOp.length} milestone${overduePostOp.length>1?'s':''} overdue`});
  else if(duePostOp.length) flags.push({type:'warn', text:`${duePostOp.length} post-op milestone${duePostOp.length>1?'s':''} due`});
  if(hasIncompleteDischargeChecks(p)) flags.push({type:'warn', text:'Discharge checklist incomplete'});
  if((p.handoverNote||'').trim()) flags.push({type:'warn', text:'Handover note'});
  if((p.complications||[]).length) flags.push({type:'warn', text:`${p.complications.length} complication${p.complications.length>1?'s':''} noted`});
  if(p.status==='fordischarge' && !pendingInv.length && !pendingFit.length && !hasIncompleteDischargeChecks(p)){
    flags.push({type:'good', text:'Ready for discharge'});
  }
  return flags;
}

/* ---------------- ROUNDS LIST ---------------- */

function renderRounds(){
  const list = document.getElementById('roundsList');
  const items = getFilteredRoundsItems();

  if(!items.length){
    let msg = 'No patients here yet.';
    const hasActive = patients.some(p=>p.status!=='discharged');
    if(!hasActive && !isConsultantMode()){
      list.innerHTML = `<div class="empty-state"><div class="big">${emptyStateSvg('bed')}</div><div class="msg">${escapeHTML(msg)}</div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap;">
          <button type="button" class="btn primary" data-empty-action="add">Add first patient</button>
          <button type="button" class="btn" data-empty-action="import">Import backup</button>
        </div></div>`;
      list.querySelector('[data-empty-action="add"]')?.addEventListener('click', ()=> openPatientModal(null));
      list.querySelector('[data-empty-action="import"]')?.addEventListener('click', ()=> document.getElementById('hiddenImportInput').click());
      return;
    }
    if(currentFilter==='mine'){
      const ini = getPgInitials();
      msg = ini
        ? `No patients assigned to ${ini}. Open a patient → Edit → Assigned PG.`
        : 'Set your PG initials in the top bar, then assign patients to yourself.';
    }else if(currentFilter==='needsplan'){
      msg = 'All patients have a plan for today.';
    }else if(currentFilter==='attention'){
      msg = 'No patients need attention right now.';
    }else if(currentFilter==='unpresented'){
      msg = 'All patients have been presented today.';
    }else if(currentFilter==='conservative'){
      msg = 'No conservative patients on the list.';
    }else if(currentFilter==='ottoday'){
      msg = 'No surgeries listed for today.';
    }else if(hasActive){
      msg = 'No patients match this filter.';
    }
    list.innerHTML = `<div class="empty-state"><div class="big">${emptyStateSvg('bed')}</div><div class="msg">${escapeHTML(msg)}</div></div>`;
    return;
  }

  const groups = groupPatientsByWard(items);
  list.innerHTML = groups.map(([ward, pts])=>`
    <div class="ward-section">
      <div class="ward-header">Ward ${escapeHTML(ward)} <span class="ward-count">${pts.length}</span></div>
      ${pts.map(p=> renderCard(p)).join('')}
    </div>
  `).join('');

  list.querySelectorAll('.card-head').forEach(head=>{
    head.addEventListener('click', (e)=>{
      if(e.target.closest('.card-quick-bar, .card-quick-footer, .bulk-check, [data-action]')) return;
      const card = head.closest('.card');
      toggleCardOpen(card.dataset.id);
    });
  });

  bindCardListEvents(list);
}

function bindCardListEvents(root){
  if(!root) return;
  root.querySelectorAll('.card-plan-input').forEach(inp=>{
    if(inp._bound) return;
    inp._bound = true;
    inp.addEventListener('click', e=> e.stopPropagation());
    inp.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){
        e.preventDefault();
        inp.blur();
      }
    });
    inp.addEventListener('blur', ()=>{
      const id = inp.dataset.id;
      const p = patients.find(x=>x.id===id);
      if(!p) return;
      const newVal = inp.value.trim();
      if(newVal === (p.dailyPlan||'').trim() && hasPlanToday(p)) return;
      const { prevPlan, prevDate } = saveCardPlan(p, newVal);
      void persistAndRerender(p).then(()=>{
        showToast('Plan saved', { success: true,
          undo: ()=>{
            p.dailyPlan = prevPlan;
            p.dailyPlanDate = prevDate;
            void persistAndRerender(p);
          }
        });
      });
    });
  });

  root.querySelectorAll('[data-action]').forEach(el=>{
    if(el._bound) return;
    el._bound = true;
    el.addEventListener('click', (e)=>{
      e.stopPropagation();
      handleCardAction(el.dataset.action, el.dataset.id, el);
    });
  });
}

const CARD_ANIM_MS = 350;

/** Keep card-head glance content in sync when toggling without full renderRounds(). */
function removeCardHeadGlance(head){
  if(!head) return;
  head.querySelectorAll('.card-plan-snippet, .card-quick-bar, .handover-pin, .handover-strip, .card-glance-row, .flags').forEach(el => el.remove());
}

function patchCardHeadGlance(p, collapsed){
  const card = document.querySelector(`.card[data-id="${p.id}"]`);
  if(!card) return;
  const head = card.querySelector('.card-head');
  if(!head) return;
  removeCardHeadGlance(head);
  if(!collapsed) return;
  const anchor = head.querySelector('.card-head-top');
  if(!anchor) return;
  const flags = getPatientFlags(p);
  const html = [
    renderCardQuickBar(p),
    (p.handoverPin||'').trim() ? `<div class="handover-pin">📌 ${escapeHTML(p.handoverPin.trim())}</div>` : '',
    (p.handoverNote||'').trim() ? `<div class="handover-strip">↪ ${escapeHTML(p.handoverNote.trim())}</div>` : '',
    renderFlagsGlance(flags)
  ].filter(Boolean).join('');
  if(html) anchor.insertAdjacentHTML('afterend', html);
  bindCardListEvents(card);
}

function toggleCardOpen(id){
  const p = patients.find(x => x.id === id);
  if(!p) return;

  if(openCardId === id){
    const card = document.querySelector(`.card[data-id="${id}"]`);
    if(card){
      card.classList.remove('open');
      const body = card.querySelector('.card-body');
      if(body) body.innerHTML = '';
    }
    openCardId = null;
    patchCardHeadGlance(p, true);
    return;
  }

  const prevId = openCardId;
  if(prevId){
    const prevCard = document.querySelector(`.card[data-id="${prevId}"]`);
    if(prevCard){
      prevCard.classList.remove('open');
      const prevBody = prevCard.querySelector('.card-body');
      if(prevBody) prevBody.innerHTML = '';
      const prevP = patients.find(x => x.id === prevId);
      if(prevP) patchCardHeadGlance(prevP, true);
    }
  }

  openCardId = id;
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if(!card){
    renderRounds();
    return;
  }

  document.querySelectorAll('.card.open').forEach(c=>{
    if(c.dataset.id !== id) c.classList.remove('open');
  });
  card.classList.add('open');
  patchCardHeadGlance(p, false);
  const dayInfo = getClinicalDayInfo(p);
  const body = card.querySelector('.card-body');
  body.innerHTML = `
    <div class="card-body-inner">
      <div class="card-body-sticky">
        <div class="card-name">${escapeHTML(p.name||'Unnamed')}</div>
        <div class="small-muted">${escapeHTML(p.bed||'—')}${dayInfo ? ' · '+dayInfo.prefix+' '+dayInfo.day : ''}</div>
      </div>
      ${renderCardBody(p)}
      <div class="card-quick-footer">${renderCardQuickBar(p)}</div>
    </div>`;
  bindCardListEvents(card);
  patchCardHeadGlance(p, false);
  requestAnimationFrame(()=>{
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function renderCardQuickBar(p){
  if(isConsultantMode()) return '';
  const dueMs = getNextDueMilestones(p, 2);
  const planVal = escapeHTML(p.dailyPlan || '');
  const planStale = p.dailyPlan && !hasPlanToday(p);
  const pgLabel = p.assignedPg || 'PG';
  const statusLabel = STATUS_LABELS[p.status] || 'Status';
  return `
    <div class="card-quick-bar" data-id="${p.id}">
      <input type="text" class="card-plan-input ${planStale ? 'stale' : ''}" data-action="save-plan" data-id="${p.id}"
        value="${planVal}" placeholder="Today's plan…" title="Enter plan and press Enter">
      <div class="card-quick-milestones">
        ${dueMs.length ? dueMs.map(c=>`
          <button type="button" class="card-ms-btn ${isItemOverdue(c, getPatientPod(p)) ? 'overdue' : ''}"
            data-action="cycle-milestone" data-id="${p.id}" data-check-id="${escapeHTML(c.id)}" title="Tap to mark done">
            ${escapeHTML(c.label)}</button>`).join('') : ''}
      </div>
      <button type="button" class="status-badge clickable ${p.status||'preop'}" data-action="cycle-status" data-id="${p.id}">${statusLabel}</button>
      <button type="button" class="pg-chip" data-action="cycle-pg" data-id="${p.id}">${escapeHTML(pgLabel)}</button>
      <button type="button" class="btn card-copy-plan" data-action="copy-yesterday-plan" data-id="${p.id}" title="Copy yesterday's plan">↶</button>
      ${renderAbxQuickChip(p)}
    </div>`;
}

function renderAbxQuickChip(p){
  const abx = getAntibioticsCourse(p);
  if(!abx || abx.status === 'stopped') return '';
  const urgent = abx.status === 'last_day' || abx.status === 'overdue';
  return `<button type="button" class="card-abx-chip ${urgent?'urgent':''}" data-action="mark-abx-stopped" data-id="${p.id}" title="Tap when antibiotics stopped">${escapeHTML(abx.label)}</button>`;
}

function renderCard(p){
  const isOpen = openCardId===p.id;
  const dayInfo = getClinicalDayInfo(p);
  const flags = getPatientFlags(p);
  const statusLabel = STATUS_LABELS[p.status] || '';
  const statusClass = STATUS_CYCLE.includes(p.status) ? ` card-status-${p.status}` : '';
  const presented = isPresented(p.id);
  const bulkOn = bulkSelectMode && bulkSelectedIds.has(p.id);
  const procLine = p.procedure
    ? `${escapeHTML(p.procedure)}${p.surgeryDate ? ' · '+fmtDate(p.surgeryDate) : ''}${p.theatreTime ? ' · OT '+escapeHTML(p.theatreTime) : ''}`
    : '';

  return `
  <div class="card status-rail ${isOpen?'open':''}${statusClass}${bulkOn?' bulk-selected':''}" data-id="${p.id}">
    <div class="card-head">
      ${bulkSelectMode ? `<input type="checkbox" class="bulk-check" data-action="bulk-toggle" data-id="${p.id}" ${bulkOn?'checked':''}>` : ''}
      <div class="card-head-top">
        <div class="bed-chip">${escapeHTML(p.bed||'—')}</div>
        <div class="card-main">
          <div class="card-name-row">
            <span class="card-name">${escapeHTML(p.name||'Unnamed')}</span>
            <span class="card-meta">${escapeHTML(p.age||'?')}${p.sex?'/'+p.sex:''}</span>
            <span class="card-badges">
              ${dayInfo ? `<span class="pod-pill">${escapeHTML(dayInfo.prefix)} ${dayInfo.day}</span>` : `<span class="status-badge ${p.status||'preop'}">${statusLabel}</span>`}
              ${presented ? `<span class="presented-pill" title="Presented today">✓</span>` : ''}
            </span>
          </div>
          <div class="card-dx">${escapeHTML(p.diagnosis||'Diagnosis not entered')}</div>
          ${procLine ? `<div class="card-proc">${procLine}</div>` : ''}
        </div>
        <div class="chevron">›</div>
      </div>
      ${!isOpen ? renderCardQuickBar(p) : ''}
      ${!isOpen && (p.handoverPin||'').trim() ? `<div class="handover-pin">📌 ${escapeHTML(p.handoverPin.trim())}</div>` : ''}
      ${!isOpen && (p.handoverNote||'').trim() ? `<div class="handover-strip">↪ ${escapeHTML(p.handoverNote.trim())}</div>` : ''}
      ${!isOpen ? renderFlagsGlance(flags) : ''}
    </div>
    <div class="card-body">${isOpen ? `
      <div class="card-body-inner">
        <div class="card-body-sticky">
          <div class="card-name">${escapeHTML(p.name||'Unnamed')}</div>
          <div class="small-muted">${escapeHTML(p.bed||'—')}${dayInfo ? ' · '+dayInfo.prefix+' '+dayInfo.day : ''}</div>
        </div>
        ${renderCardBody(p)}
        <div class="card-quick-footer">${renderCardQuickBar(p)}</div>
      </div>` : ''}</div>
  </div>`;
}

function renderPlanHistoryBlock(p){
  const hist = (p.planHistory || []).slice().reverse();
  const showAll = expandedPlanHistory[p.id];
  const visible = showAll ? hist : hist.slice(0, 3);
  if(!visible.length && !p.dailyPlan) return '';
  let html = '';
  if(visible.length){
    html += visible.map(h=>`
      <div class="plan-history-row">
        <span class="plan-history-date">${fmtDate(h.date)}${h.by ? ' · '+escapeHTML(h.by) : ''}</span>
        <span>${escapeHTML(h.text)}</span>
      </div>`).join('');
    if(hist.length > 3){
      html += `<button type="button" class="btn linkish" data-action="toggle-plan-history" data-id="${p.id}" style="margin-top:6px;padding:2px 0;">${showAll ? 'Show less' : `Show all ${hist.length} entries`}</button>`;
    }
  }
  return html;
}

function renderCardBody(p){
  const dayInfo = getClinicalDayInfo(p);
  return `
    <div class="detail-grid">
      <div class="field"><label>UHID</label><div class="val ${!p.uhid?'empty':''}">${escapeHTML(p.uhid)||'not entered'}</div></div>
      <div class="field"><label>Admission date</label><div class="val">${fmtDate(p.admissionDate)||'—'}</div></div>
      <div class="field"><label>Surgery date</label><div class="val ${!p.surgeryDate?'empty':''}">${p.surgeryDate?fmtDate(p.surgeryDate):'not yet operated'}</div></div>
      <div class="field"><label>Surgeon</label><div class="val ${!p.surgeon?'empty':''}">${escapeHTML(p.surgeon)||'not entered'}</div></div>
      ${p.assignedPg ? `<div class="field"><label>Assigned PG</label><div class="val">${escapeHTML(p.assignedPg)}</div></div>` : ''}
    </div>

    ${p.implant ? `<div class="field" style="margin-bottom:10px;"><label>Implant / fixation details</label><div class="val">${escapeHTML(p.implant)}</div></div>` : ''}

    ${(p.handoverNote||'').trim() ? `<div class="section-label">Handover note</div><div class="notes-box handover-box">${escapeHTML(p.handoverNote.trim())}</div><button type="button" class="btn" data-action="clear-handover" data-id="${p.id}" style="margin-top:6px;">Clear handover</button>` : ''}

    <div class="section-label">Today's plan</div>
    <div class="notes-box">${escapeHTML(p.dailyPlan) || '<span class="text-muted">No plan entered for today</span>'}</div>
    ${renderPlanHistoryBlock(p) ? `<div class="section-label" style="margin-top:10px;">Plan history</div><div class="plan-history">${renderPlanHistoryBlock(p)}</div>` : ''}

    ${(p.postOpChecks||[]).length ? `
    <div class="section-label">${p.status==='conservative' ? 'Care milestones' : 'Post-op milestones'}</div>
    <div class="checklist">
      ${p.postOpChecks.map((c,idx)=>`
        <div class="check-row">
          <span>${escapeHTML(c.label)} <span class="small-muted">(${formatMilestonePodLabelForPatient(c, p)}${c.category!=='other' ? ' · '+c.category : ''})</span></span>
          <button class="status-pill ${c.status}" data-action="cycle-postop" data-id="${p.id}" data-idx="${idx}">${c.status}</button>
        </div>`).join('')}
    </div>` : ''}

    ${(p.dischargeChecks||[]).length ? `
    <div class="section-label">Discharge checklist</div>
    <div class="checklist">
      ${p.dischargeChecks.map((c,idx)=>`
        <div class="check-row">
          <span>${escapeHTML(c.label)}</span>
          <button class="status-pill ${c.status}" data-action="cycle-discharge" data-id="${p.id}" data-idx="${idx}">${c.status}</button>
        </div>`).join('')}
    </div>` : ''}

    <div class="section-label">Investigations</div>
    <div class="checklist">
      ${(p.investigations||[]).length ? p.investigations.map((inv,idx)=>`
        <div class="check-row">
          <span>${escapeHTML(inv.name)}${inv.value?` — <strong>${escapeHTML(inv.value)}</strong>`:''}</span>
          <button class="status-pill ${inv.status}" data-action="cycle-inv" data-id="${p.id}" data-idx="${idx}">${inv.status}</button>
        </div>`).join('') : '<div class="small-muted">None added</div>'}
    </div>

    <div class="section-label">Fitness for surgery / discharge</div>
    <div class="checklist">
      ${(p.fitness||[]).length ? p.fitness.map((f,idx)=>`
        <div class="check-row">
          <span>${escapeHTML(f.dept)}</span>
          <button class="status-pill ${f.status}" data-action="cycle-fit" data-id="${p.id}" data-idx="${idx}">${f.status}</button>
        </div>`).join('') : '<div class="small-muted">None added</div>'}
    </div>

    <div class="section-label">X-rays</div>
    <div class="xray-row">
      ${(p.images||[]).map(img=>`
        <div class="xray-thumb" data-action="view-img" data-id="${p.id}" data-imgid="${img.id}">
          <img src="${imageSrc(img)}">
          <div class="tag">${img.type.toUpperCase()}</div>
        </div>`).join('')}
      <div class="xray-add" data-action="add-img" data-id="${p.id}">+</div>
    </div>

    <div class="section-label">Presentation script</div>
    <div class="script-box">
      <span class="lbl">Read for rounds</span>
      ${generatePresentationScript(p)}
    </div>

    ${(p.complications||[]).length ? `
    <div class="section-label">Complications</div>
    <div class="notes-box">${p.complications.map(c=>`<div><strong>${escapeHTML(c.type||'Note')}</strong> · ${fmtDate(c.date)} — ${escapeHTML(c.note||'')}</div>`).join('')}</div>` : ''}

    ${p.notes ? `<div class="section-label">Notes</div><div class="notes-box">${escapeHTML(p.notes)}</div>` : ''}

    <div class="card-actions">
      <button class="btn primary" data-action="edit" data-id="${p.id}">Edit details</button>
      ${!isConsultantMode() ? `<button class="btn" data-action="clone-patient" data-id="${p.id}">Clone</button>` : ''}
      ${p.status!=='fordischarge' && p.status!=='discharged' ? `<button class="btn" data-action="mark-fordischarge" data-id="${p.id}">Mark for discharge</button>` : ''}
      ${p.status==='fordischarge' ? `<button class="btn" data-action="unmark-fordischarge" data-id="${p.id}">Unmark for discharge</button>` : ''}
      ${p.status==='fordischarge' ? `<button class="btn primary" data-action="mark-discharged" data-id="${p.id}">Confirm discharged</button>` : ''}
      ${p.status==='preop' ? `<button class="btn" data-action="mark-conservative" data-id="${p.id}">Conservative mgmt</button>` : ''}
      ${p.status==='preop' ? `<button class="btn" data-action="mark-postop" data-id="${p.id}">Mark as operated</button>` : ''}
    </div>
  `;
}

function generateCompactPresentationScript(p){
  const dayInfo = getClinicalDayInfo(p);
  const bullets = [];
  bullets.push(`${p.bed ? 'Bed '+p.bed+' · ' : ''}${p.name||'Patient'}, ${p.age||'?'}/${p.sex||'?'}`);
  if(dayInfo && p.status === 'conservative'){
    bullets.push(`Day ${dayInfo.day} · conservative management · ${p.diagnosis||'—'}`);
  }else if(dayInfo){
    bullets.push(`${dayInfo.prefix} ${dayInfo.day} · ${p.procedure || 'post-op'}`);
  }else if(p.status==='preop'){
    bullets.push(`Pre-op · ${p.diagnosis||'—'}`);
  }else{
    bullets.push(`${p.status==='conservative'?'Conservative':'Inpatient'} · ${p.diagnosis||'—'}`);
  }
  const labs = formatLabsLine(p);
  if(labs) bullets.push('Labs: ' + labs);
  getTherapyBadges(p).forEach(b=> bullets.push(b.label));
  const due = [...getOverduePostOpChecks(p), ...getDuePostOpChecks(p)].map(c=>c.label);
  if(due.length) bullets.push('Due: ' + due.join(', '));
  if(p.dailyPlan) bullets.push('Plan: ' + p.dailyPlan);
  if((p.handoverPin||'').trim()) bullets.push('Pin: ' + p.handoverPin.trim());
  return bullets.map(b=>`• ${escapeHTML(b)}`).join('<br>');
}

function generatePresentationScript(p){
  const dayInfo = getClinicalDayInfo(p);
  const parts = [];

  let opening = `${p.bed ? 'Bed '+p.bed+', ' : ''}${p.name || 'patient'}, ${p.age||'?'}-year-old ${p.sex==='M'?'male':p.sex==='F'?'female':'patient'}`;
  parts.push(opening);

  if(p.status === 'conservative'){
    const dayStr = dayInfo ? `day ${dayInfo.day} of admission` : 'currently admitted';
    parts.push(`on ${dayStr} for conservative management of ${p.diagnosis || 'the diagnosed condition'}${p.procedure ? ' ('+p.procedure+')' : ''}.`);
  }else if(dayInfo && (p.status === 'postop' || p.status === 'fordischarge')){
    parts.push(`post-operative day ${dayInfo.day} following ${p.procedure || 'surgery'}${p.implant ? ' ('+p.implant+')' : ''} for ${p.diagnosis || 'the diagnosed condition'}, done on ${fmtDate(p.surgeryDate)}.`);
  } else if(p.status==='preop'){
    parts.push(`admitted with ${p.diagnosis || 'pending diagnosis'}, currently awaiting surgery.`);
  } else {
    parts.push(`with ${p.diagnosis || 'pending diagnosis'}.`);
  }

  const imgTypes = [...new Set((p.images||[]).map(i=>i.type))];
  if(imgTypes.length){
    const labels = imgTypes.map(t=> t==='preop'?'pre-op':t==='postop'?'post-op':'follow-up');
    parts.push(`${labels.join(' and ')} X-rays available.`);
  }

  const pendingInv = (p.investigations||[]).filter(i=>i.status==='pending');
  const abnormalInv = (p.investigations||[]).filter(i=>i.status==='abnormal');
  const pendingFit = (p.fitness||[]).filter(f=>f.status==='pending');

  if(abnormalInv.length){
    parts.push(`${abnormalInv.map(i=>i.name+(i.value?' ('+i.value+')':'')).join(', ')} abnormal — needs attention.`);
  }
  if(pendingInv.length){
    parts.push(`Awaiting ${pendingInv.map(i=>i.name).join(', ')}.`);
  }
  if(pendingFit.length){
    parts.push(`Awaiting ${pendingFit.map(f=>f.dept).join(', ')}.`);
  }
  if(p.dailyPlan){
    parts.push(`Plan for today: ${p.dailyPlan}.`);
  }
  if((p.handoverNote||'').trim()){
    parts.push(`Handover: ${p.handoverNote.trim()}.`);
  }
  const duePostOp = getDuePostOpChecks(p);
  if(duePostOp.length){
    parts.push(`Due milestones: ${duePostOp.map(c=>c.label).join(', ')}.`);
  }
  if(p.status==='fordischarge' && !pendingInv.length && !pendingFit.length && !hasIncompleteDischargeChecks(p)){
    parts.push(`Fit for discharge.`);
  }

  return parts.join(' ');
}

/* ---------------- card actions ---------------- */

function handleCardAction(action, id, el){
  const p = patients.find(x=>x.id===id);
  if(!p) return;

  if(action==='cycle-status'){
    void cycleCardStatus(p);
    return;
  }
  if(action==='cycle-pg'){
    void cycleCardPg(p);
    return;
  }
  if(action==='cycle-milestone'){
    const checkId = el.dataset.checkId;
    const c = (p.postOpChecks||[]).find(x=>x.id===checkId);
    if(!c) return;
    const prev = { status: c.status, doneAt: c.doneAt };
    c.status = cycleChecklistStatus(c.status);
    c.doneAt = c.status === 'done' ? todayISO() : '';
    touchChecklistItem(c);
    if(c.status === 'done' && navigator.vibrate){
      try{ navigator.vibrate(10); }catch{ /* ignore */ }
    }
    void persistAndRerender(p).then(()=>{
      showToast('Milestone updated', { success: c.status === 'done',
        undo: ()=>{
          c.status = prev.status;
          c.doneAt = prev.doneAt;
          touchChecklistItem(c);
          void persistAndRerender(p);
        }
      });
    });
    return;
  }
  if(action==='copy-yesterday-plan'){
    const y = getYesterdayPlan(p);
    if(!y){ showToast('No previous plan'); return; }
    const { prevPlan, prevDate } = saveCardPlan(p, y.text);
    void persistAndRerender(p).then(()=> showToast('Copied yesterday\'s plan'));
    return;
  }
  if(action==='mark-abx-stopped'){
    void markAntibioticsStopped(p);
    return;
  }
  if(action==='bulk-toggle'){
    if(bulkSelectedIds.has(id)) bulkSelectedIds.delete(id);
    else bulkSelectedIds.add(id);
    renderRounds();
    return;
  }
  if(action==='clone-patient'){
    void clonePatientRecord(p);
    return;
  }

  if(action==='edit') return openPatientModal(p);
  if(action==='cycle-inv'){
    const idx = +el.dataset.idx;
    const order = ['pending','done','abnormal'];
    p.investigations[idx].status = order[(order.indexOf(p.investigations[idx].status)+1)%order.length];
    persistAndRerender(p);
  }
  if(action==='cycle-fit'){
    const idx = +el.dataset.idx;
    const order = ['pending','done'];
    p.fitness[idx].status = order[(order.indexOf(p.fitness[idx].status)+1)%order.length];
    persistAndRerender(p);
  }
  if(action==='cycle-postop'){
    const idx = +el.dataset.idx;
    const c = p.postOpChecks[idx];
    const wasDone = c.status === 'done';
    c.status = cycleChecklistStatus(c.status);
    c.doneAt = (c.status === 'done') ? todayISO() : '';
    touchChecklistItem(c);
    if(c.status === 'done' && !wasDone){
      el.classList.add('flash-done');
      setTimeout(()=> el.classList.remove('flash-done'), 400);
      if(navigator.vibrate){ try{ navigator.vibrate(10); }catch{ /* ignore */ } }
    }
    persistAndRerender(p);
  }
  if(action==='cycle-discharge'){
    const idx = +el.dataset.idx;
    const c = p.dischargeChecks[idx];
    c.status = cycleChecklistStatus(c.status);
    c.doneAt = (c.status === 'done') ? todayISO() : '';
    touchChecklistItem(c);
    persistAndRerender(p);
  }
  if(action==='toggle-plan-history'){
    expandedPlanHistory[id] = !expandedPlanHistory[id];
    renderRounds();
    return;
  }
  if(action==='clear-handover'){
    const prev = p.handoverNote || '';
    p.handoverNote = '';
    void persistAndRerender(p).then(()=>{
      showToast('Handover cleared', {
        undo: ()=>{
          p.handoverNote = prev;
          void persistAndRerender(p);
        }
      });
    });
  }
  if(action==='mark-fordischarge'){
    if(p.status !== 'fordischarge'){
      p.statusBeforeDischarge = p.status;
      p.status = 'fordischarge';
      applyDischargeTemplate(p);
      persistAndRerender(p);
      showToast('Marked for discharge');
    }
  }
  if(action==='unmark-fordischarge'){
    p.status = p.statusBeforeDischarge || (p.surgeryDate ? 'postop' : 'preop');
    if(!p.statusBeforeDischarge && !p.surgeryDate && (p.postOpChecks||[]).length) p.status = 'conservative';
    delete p.statusBeforeDischarge;
    persistAndRerender(p);
    showToast('Removed from discharge list');
  }
  if(action==='mark-conservative'){
    void (async ()=>{
      p.status = 'conservative';
      p.statusUpdatedAt = Date.now();
      if(!p.admissionDate) p.admissionDate = todayISO();
      if(!p.postOpChecks || !p.postOpChecks.length){
        const suggestions = suggestTemplatesForPatient(p, 'conservative_pathway', 3);
        if(suggestions.length){
          const pick = suggestions[0];
          const names = suggestions.map(t=>'• ' + t.name).join('\n');
          const choice = await showAppDialog({
            title: 'Apply conservative pathway?',
            message: `Suggested for this patient:\n${names}`,
            buttons: [
              { label: 'Default template', value: 'default' },
              { label: `Apply "${pick.name}"`, value: 'suggested', primary: true }
            ]
          });
          if(choice && choice.action === 'suggested') applyTemplateToPatient(p, pick.id, { fillPlan: 'current_pod' });
          else applyConservativeTemplate(p);
        }else{
          applyConservativeTemplate(p);
        }
      }
      await persistAndRerender(p);
      showToast('Marked conservative');
    })();
    return;
  }
  if(action==='mark-postop'){
    void (async ()=>{
      p.status='postop';
      if(!p.surgeryDate) p.surgeryDate = todayISO();
      if(!p.postOpChecks || !p.postOpChecks.length){
        const suggestions = suggestTemplatesForPatient(p, 'postop_pathway', 3);
        if(suggestions.length){
          const pick = suggestions[0];
          const names = suggestions.map(t=>'• ' + t.name).join('\n');
          const choice = await showAppDialog({
            title: 'Apply post-op pathway?',
            message: `Suggested for this patient:\n${names}`,
            buttons: [
              { label: 'Default template', value: 'default' },
              { label: `Apply "${pick.name}"`, value: 'suggested', primary: true }
            ]
          });
          if(choice && choice.action === 'suggested') applyTemplateToPatient(p, pick.id, { fillPlan: 'current_pod' });
          else applyPostOpTemplate(p);
        }else{
          applyPostOpTemplate(p);
        }
      }
      await persistAndRerender(p);
      showToast('Marked as operated');
    })();
    return;
  }
  if(action==='mark-discharged'){
    void (async ()=>{
      const pendingInv = (p.investigations||[]).filter(i=>i.status==='pending');
      const pendingFit = (p.fitness||[]).filter(f=>f.status==='pending');
      const pendingDis = getPendingRequiredDischargeChecks(p);
      const blockers = [];
      if(pendingInv.length) blockers.push('Pending investigations: ' + pendingInv.map(i=>i.name).join(', '));
      if(pendingFit.length) blockers.push('Pending fitness: ' + pendingFit.map(f=>f.dept).join(', '));
      if(pendingDis.length) blockers.push('Discharge checklist: ' + pendingDis.map(c=>c.label).join(', '));
      if(blockers.length){
        const ok = await showConfirm(
          'Before discharge',
          blockers.map(b=>'• ' + b).join('\n') + '\n\nDischarge anyway?',
          { confirmLabel: 'Discharge anyway', danger: true }
        );
        if(!ok) return;
      }
      const prevStatus = p.status;
      const prevDischargeDate = p.dischargeDate;
      p.status='discharged'; p.dischargeDate = todayISO();
      delete p.statusBeforeDischarge;
      openCardId=null;
      await persistAndRerender(p);
      showToast('Patient discharged', {
        undo: async ()=>{
          p.status = prevStatus;
          p.dischargeDate = prevDischargeDate || '';
          await persistAndRerender(p);
          showToast('Discharge undone');
        }
      });
    })();
    return;
  }
  if(action==='add-img'){
    pendingImageSlot = {patientId:id};
    document.getElementById('hiddenFileInput').click();
  }
  if(action==='view-img'){
    const img = p.images.find(i=>i.id===el.dataset.imgid);
    if(img) openImgViewer(img);
  }
}

async function clonePatientRecord(p){
  const copy = blankPatient();
  copy.name = p.name;
  copy.age = p.age;
  copy.sex = p.sex;
  copy.bed = p.bed;
  copy.ward = p.ward;
  copy.diagnosis = p.diagnosis;
  copy.procedure = p.procedure;
  copy.surgeon = p.surgeon;
  copy.implant = p.implant;
  copy.assignedPg = p.assignedPg || getPgInitials();
  copy.status = 'preop';
  if(p.procedure){
    const tpl = suggestTemplatesForPatient(copy, 'postop_pathway', 1)[0];
    if(tpl) applyTemplateToPatient(copy, tpl.id, { merge: false, fillPlan: 'none' });
  }
  await savePatient(copy);
  openPatientModal(copy);
  showToast('Patient cloned — update bed/name');
}

async function persistAndRerender(p){
  try{
    await savePatient(p);
    renderAll();
  }catch(err){
    console.error(err);
    showToast('Could not save changes — ' + (err.message || 'error'));
  }
}

/* ---------------- image handling ---------------- */

let pendingImageData = null; // {patientId, compressed} awaiting type confirmation

async function handleImageFileSelected(e){
  const file = e.target.files[0];
  if(!file || !pendingImageSlot) return;
  const raw = await fileToDataURL(file);
  const compressed = await compressImage(raw);
  pendingImageData = { patientId: pendingImageSlot.patientId, compressed };
  e.target.value = '';
  openImageTypeModal();
}

function openImageTypeModal(){
  document.getElementById('imgTypeModal').classList.add('active');
}
function closeImageTypeModal(){
  document.getElementById('imgTypeModal').classList.remove('active');
  pendingImageData = null;
  pendingImageSlot = null;
}
async function confirmImageType(type){
  if(!pendingImageData) return;
  const p = patients.find(x=>x.id===pendingImageData.patientId);
  if(!p){ closeImageTypeModal(); return; }
  const img = { id: uid(), type, dataURL: pendingImageData.compressed, date: todayISO() };
  const url = await uploadPatientImage(p.id, pendingImageData.compressed);
  if(url){ img.url = url; delete img.dataURL; }
  p.images = p.images || [];
  p.images.push(img);
  try{
    await savePatient(p);
    closeImageTypeModal();
    renderAll();
    showToast('X-ray added');
  }catch(err){
    console.error(err);
    showToast('Could not add X-ray — ' + (err.message || 'error'));
  }
}

function openImgViewer(img){
  document.getElementById('imgViewerImg').src = imageSrc(img);
  document.getElementById('imgViewerLabel').textContent = `${img.type.toUpperCase()} · ${fmtDate(img.date)}`;
  document.getElementById('imgViewer').classList.add('active');
}
function closeImgViewer(){ document.getElementById('imgViewer').classList.remove('active'); }

/* ---------------- WORKLIST ---------------- */

function renderWorklist(){
  const el = document.getElementById('worklistContent');
  const w = collectWorklistData();
  const {
    pendingInvItems, abnormalItems, pendingFitItems, planMissingItems, planTodayItems,
    handoverItems, postOpOverdueItems, postOpDueItems, postOpUpcomingItems,
    dischargeIncompleteItems, readyForDischarge, labAbnormalItems,
    abxLastDayItems, abxOverdueItems, abxEndingSoonItems, hasUnitHandover
  } = w;

  function section(title, items, emoji, urgency){
    if(!items.length) return '';
    const urgClass = urgency ? ` work-${urgency}` : '';
    return `<div class="work-section${urgClass}"><h3>${emoji} ${title} <span class="small-muted">(${items.length})</span></h3>
      ${items.map(it=>{
        const doneBtn = (it.kind === 'postop' && it.checkId)
          ? `<button type="button" class="btn primary work-done-btn pressable" data-work-done="${escapeHTML(it.p.id)}" data-check-id="${escapeHTML(it.checkId)}">Done</button>`
          : (it.kind === 'abx' && it.abxAction === 'stop')
          ? `<button type="button" class="btn primary work-abx-stop pressable" data-abx-stop="${escapeHTML(it.p.id)}">Stopped</button>`
          : '';
        const labEdit = (it.kind === 'lab')
          ? `<input type="text" class="work-lab-input ${labValueClass(it.labKey, it.labVal)}" data-lab-edit="${escapeHTML(it.p.id)}" data-lab-key="${escapeHTML(it.labKey)}" value="${escapeHTML(it.labVal||'')}" inputmode="decimal">`
          : '';
        const pg = (it.p.assignedPg || '').trim();
        const pgAvatar = pg ? `<span class="work-pg-avatar" title="PG ${escapeHTML(pg)}">${escapeHTML(pg.slice(0,2).toUpperCase())}</span>` : '';
        return `<div class="work-item pressable" data-jump="${it.p.id}">
          <span class="work-item-icon">${workItemIcon(it.kind, urgency)}</span>
          <div class="work-item-main"><div class="who">${escapeHTML(it.p.name)} <span class="small-muted">· Ward ${escapeHTML(it.p.bed||'—')}</span></div>
          <div class="what">${labEdit || escapeHTML(it.text)}</div></div>
          ${pgAvatar}
          ${doneBtn}
        </div>`;
      }).join('')}
    </div>`;
  }

  const html = [
    hasUnitHandover ? `<div class="work-section work-warn ward-meta-handover"><h3>Unit handover</h3><div class="notes-box">${escapeHTML(wardMeta.handoverNote)}</div><button type="button" class="btn" id="clearWardHandoverBtn" style="margin-top:8px;">Clear unit handover</button></div>` : '',
    section('Handover flags', handoverItems, '↪', 'warn'),
    section('Antibiotics — stop today', abxLastDayItems, '💊', 'urgent'),
    section('Antibiotics — stop overdue', abxOverdueItems, '💊', 'urgent'),
    section('Antibiotics — ending tomorrow', abxEndingSoonItems, '💊', 'warn'),
    section('Abnormal labs (structured)', labAbnormalItems, '🧪', 'urgent'),
    section('Abnormal results — needs review', abnormalItems, '△', 'urgent'),
    section('Pending investigations', pendingInvItems, '⚠', 'warn'),
    section('Pending fitness clearance', pendingFitItems, '⚠', 'warn'),
    section('Post-op milestones overdue', postOpOverdueItems, '⏱', 'urgent'),
    section('Post-op milestones due', postOpDueItems, '◷', 'warn'),
    section('Post-op milestones upcoming', postOpUpcomingItems, '○', 'info'),
    section('Discharge checklist incomplete', dischargeIncompleteItems, '☐', 'warn'),
    section('Plan not entered for today', planMissingItems, '📝', 'warn'),
    section("Today's plan", planTodayItems, '🗒️', 'good'),
    section('Ready for discharge', readyForDischarge, '✓', 'good'),
  ].join('');

  el.innerHTML = html || `<div class="empty-state"><div class="big">${emptyStateSvg('check')}</div><div class="msg">Nothing pending. All caught up.</div></div>`;

  const clearBtn = document.getElementById('clearWardHandoverBtn');
  if(clearBtn){
    clearBtn.addEventListener('click', async ()=>{
      const ok = await showConfirm('Clear unit handover?', 'Remove the unit-wide handover note from the worklist.', { confirmLabel: 'Clear', danger: true });
      if(!ok) return;
      const prev = wardMeta.handoverNote || '';
      await saveWardMeta({ handoverNote: '' });
      renderWardHandoverBanner();
      renderWorklist();
      updateCounts();
      showToast('Unit handover cleared', {
        undo: async ()=>{
          await saveWardMeta({ handoverNote: prev });
          renderWardHandoverBanner();
          renderWorklist();
          updateCounts();
        }
      });
    });
  }

  el.querySelectorAll('[data-lab-edit]').forEach(inp=>{
    inp.addEventListener('click', e=> e.stopPropagation());
    inp.addEventListener('change', async ()=>{
      const p = patients.find(x=>x.id===inp.dataset.labEdit);
      if(!p) return;
      p.labs = p.labs || {};
      p.labs[inp.dataset.labKey] = inp.value.trim();
      p.labs.updatedAt = todayISO();
      await persistAndRerender(p);
      showToast('Lab updated');
    });
  });

  el.querySelectorAll('[data-abx-stop]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const p = patients.find(x => x.id === btn.dataset.abxStop);
      if(p) await markAntibioticsStopped(p);
    });
  });

  el.querySelectorAll('[data-work-done]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const pid = btn.dataset.workDone;
      const checkId = btn.dataset.checkId;
      const p = patients.find(x => x.id === pid);
      if(!p) return;
      const c = (p.postOpChecks || []).find(x => x.id === checkId);
      if(!c) return;
      const prevStatus = c.status;
      const prevDoneAt = c.doneAt || '';
      c.status = 'done';
      c.doneAt = todayISO();
      touchChecklistItem(c);
      await persistAndRerender(p);
      showToast(`Done: ${c.label}`, {
        undo: async ()=>{
          c.status = prevStatus;
          c.doneAt = prevDoneAt;
          await persistAndRerender(p);
        }
      });
    });
  });

  el.querySelectorAll('.work-item').forEach(item=>{
    item.addEventListener('click', (e)=>{
      if(e.target.closest('[data-work-done]')) return;
      const id = item.dataset.jump;
      switchView('rounds');
      openCardId = id;
      currentFilter = 'all';
      document.querySelectorAll('.filter-chip').forEach(c=>c.classList.toggle('active', c.dataset.filter==='all'));
      renderRounds();
      setTimeout(()=>{
        const card = document.querySelector(`.card[data-id="${id}"]`);
        if(card) card.scrollIntoView({behavior:'smooth', block:'center'});
      }, 60);
    });
  });
}

/* ---------------- DISCHARGED ---------------- */

function renderDischarged(){
  const list = document.getElementById('dischargedList');
  const search = (document.getElementById('searchDischarged').value||'').toLowerCase();
  let items = patients.filter(p=>p.status==='discharged');
  if(search){
    items = items.filter(p=> (p.name||'').toLowerCase().includes(search) || (p.diagnosis||'').toLowerCase().includes(search));
  }
  items.sort((a,b)=> (b.dischargeDate||'').localeCompare(a.dischargeDate||''));

  if(!items.length){
    list.innerHTML = `<div class="empty-state"><div class="big">${emptyStateSvg('clipboard')}</div><div class="msg">No discharged patients yet.</div></div>`;
    return;
  }

  list.innerHTML = items.map(p=>`
    <div class="card" data-id="${p.id}">
      <div class="card-head" style="cursor:default;">
        <div class="bed-chip" style="background:var(--line-soft);color:var(--ink-soft);">${escapeHTML(p.bed||'—')}</div>
        <div class="card-main">
          <div class="card-name-row">
            <span class="card-name">${escapeHTML(p.name)}</span>
            <span class="card-meta">${escapeHTML(p.age)}${p.sex?'/'+p.sex:''}</span>
          </div>
          <div class="card-dx">${escapeHTML(p.diagnosis)}</div>
          <div class="card-proc">${escapeHTML(p.procedure||'')} · Discharged ${fmtDate(p.dischargeDate)}</div>
        </div>
        <button class="btn" data-action="reopen" data-id="${p.id}">Reopen</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-action="reopen"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const p = patients.find(x=>x.id===btn.dataset.id);
      if(!p) return;
      p.status = 'fordischarge';
      await persistAndRerender(p);
      showToast('Patient reopened to active list');
    });
  });
}

/* ---------------- ADD / EDIT MODAL ---------------- */

function openPatientModal(p){
  editingPatientId = p ? p.id : null;
  modalWorkingData = p ? JSON.parse(JSON.stringify(p)) : blankPatient();
  modalSuppressAutoTemplate = false;
  if(!p){
    const ini = getPgInitials();
    if(ini && !modalWorkingData.assignedPg) modalWorkingData.assignedPg = ini;
  }
  document.getElementById('modalTitle').textContent = p ? 'Edit patient' : 'Add patient';
  document.getElementById('deletePatientBtn').style.display = p ? 'inline-block' : 'none';
  document.getElementById('modalBody').innerHTML = renderModalForm(modalWorkingData);
  bindModalDynamicLists();
  document.getElementById('patientModal').classList.add('active');
}

function closePatientModal(){
  document.getElementById('patientModal').classList.remove('active');
  editingPatientId = null;
  modalWorkingData = null;
  modalSuppressAutoTemplate = false;
}

/** Read checklist rows from the modal DOM into working data (source of truth on save). */
function flushChecklistsFromModal(d){
  const postEl = document.getElementById('postOpList');
  if(postEl){
    const byId = new Map((d.postOpChecks || []).map(c => [c.id, c]));
    const next = [];
    postEl.querySelectorAll('.checklist-edit-row[data-check-id]').forEach(row => {
      const id = row.dataset.checkId;
      const base = byId.get(id) || {};
      const labelInp = row.querySelector('[data-postop-label]');
      const label = labelInp ? labelInp.value.trim() : (base.label || '');
      if(!label) return;
      const endEl = row.querySelector('[data-postop-end]');
      const endVal = endEl && endEl.value !== '' ? +endEl.value : null;
      next.push(normalizePostOpItem({
        id: id || base.id,
        label,
        duePod: +(row.querySelector('[data-postop-due]')?.value) || 0,
        duePodEnd: endVal,
        exactPod: !!row.querySelector('[data-postop-exact]')?.checked,
        category: row.querySelector('[data-postop-cat]')?.value || base.category || 'other',
        status: row.querySelector('[data-postop-status]')?.value || base.status || 'pending',
        doneAt: base.doneAt || '',
        notes: base.notes || '',
        sourceTemplateId: base.sourceTemplateId || ''
      }));
    });
    d.postOpChecks = next;
  }

  const disEl = document.getElementById('dischargeList');
  if(disEl){
    const byId = new Map((d.dischargeChecks || []).map(c => [c.id, c]));
    const next = [];
    disEl.querySelectorAll('.checklist-edit-row[data-check-id]').forEach(row => {
      const id = row.dataset.checkId;
      const base = byId.get(id) || {};
      const labelInp = row.querySelector('[data-discharge-label]');
      const label = labelInp ? labelInp.value.trim() : (base.label || '');
      if(!label) return;
      next.push(normalizeDischargeItem({
        id: id || base.id,
        label,
        required: row.querySelector('[data-discharge-req]')?.checked !== false,
        category: base.category || 'other',
        status: row.querySelector('[data-discharge-status]')?.value || base.status || 'pending',
        doneAt: base.doneAt || '',
        notes: base.notes || '',
        sourceTemplateId: base.sourceTemplateId || ''
      }));
    });
    d.dischargeChecks = next;
  }
}

function renderModalForm(d){
  return `
    <div class="form-row two">
      <div><label>Patient name</label><input id="f_name" value="${escapeHTML(d.name)}" placeholder="Full name"></div>
      <div><label>Ward / bed</label><input id="f_bed" value="${escapeHTML(d.bed)}" placeholder="e.g. 7FOW-12"></div>
    </div>
    <div class="form-row two">
      <div><label>Ward group (optional)</label><input id="f_ward" value="${escapeHTML(d.ward||'')}" placeholder="e.g. 7FOW — auto from bed if blank"></div>
      <div><label>Assigned PG</label><input id="f_assignedPg" value="${escapeHTML(d.assignedPg||'')}" placeholder="Initials e.g. AK" maxlength="6"></div>
    </div>
    <div class="form-row two">
      <div><label>Age</label><input id="f_age" value="${escapeHTML(d.age)}" placeholder="e.g. 34" inputmode="numeric"></div>
      <div><label>Sex</label>
        <select id="f_sex">
          <option value="M" ${d.sex==='M'?'selected':''}>Male</option>
          <option value="F" ${d.sex==='F'?'selected':''}>Female</option>
          <option value="O" ${d.sex==='O'?'selected':''}>Other</option>
        </select>
      </div>
    </div>
    <div class="form-row two">
      <div><label>UHID</label><input id="f_uhid" value="${escapeHTML(d.uhid)}" placeholder="Hospital ID"></div>
      <div><label>Admission date</label><input id="f_admissionDate" type="date" value="${d.admissionDate||''}"></div>
    </div>

    <div class="form-row">
      <label>Diagnosis</label>
      <textarea id="f_diagnosis" placeholder="e.g. Closed fracture distal end radius, right side">${escapeHTML(d.diagnosis)}</textarea>
    </div>

    <div class="form-row two">
      <div><label>Status</label>
        <select id="f_status">
          <option value="preop" ${d.status==='preop'?'selected':''}>Pre-op</option>
          <option value="conservative" ${d.status==='conservative'?'selected':''}>Conservative</option>
          <option value="postop" ${d.status==='postop'?'selected':''}>Post-op</option>
          <option value="fordischarge" ${d.status==='fordischarge'?'selected':''}>For discharge</option>
        </select>
      </div>
      <div><label>Surgery date</label><input id="f_surgeryDate" type="date" value="${d.surgeryDate||''}"></div>
    </div>
    <div class="form-row two">
      <div><label>Theatre time (optional)</label><input id="f_theatreTime" value="${escapeHTML(d.theatreTime||'')}" placeholder="e.g. 09:30"></div>
      <div><label>Handover pin</label><input id="f_handoverPin" value="${escapeHTML(d.handoverPin||'')}" placeholder="One-line for shift handover"></div>
    </div>

    <div class="form-row two">
      <div><label>Antibiotics</label><input id="f_antibiotics" value="${escapeHTML(d.antibiotics||'')}" placeholder="e.g. Cefazolin"></div>
      <div><label>Abx start date</label><input id="f_antibioticsStart" type="date" value="${d.antibioticsStart||d.surgeryDate||''}"></div>
    </div>
    <div class="form-row">
      <label>Antibiotic course length</label>
      <div class="abx-days-row">
        <button type="button" class="btn abx-day-preset abx-day-clear ${!parseTherapyDays(d.antibioticsDays)?'active':''}" data-abx-days="0">None</button>
        ${[3,5,7].map(n=>`<button type="button" class="btn abx-day-preset ${parseTherapyDays(d.antibioticsDays)===n?'active':''}" data-abx-days="${n}">${n} days</button>`).join('')}
        <input id="f_antibioticsDays" type="number" min="0" max="30" placeholder="Custom days" value="${[3,5,7].includes(parseTherapyDays(d.antibioticsDays))?'' : (parseTherapyDays(d.antibioticsDays)||'')}" style="width:88px;">
      </div>
      <div id="abxCoursePreview" class="form-hint"></div>
      ${d.antibioticsStoppedDate ? `<div class="form-hint">Stopped ${fmtDate(d.antibioticsStoppedDate)} — change drug/days to restart course.</div>` : ''}
    </div>
    <div class="form-row two">
      <div><label>DVT prophylaxis</label><input id="f_dvtProphylaxis" value="${escapeHTML(d.dvtProphylaxis||'')}" placeholder="e.g. LMWH"></div>
      <div><label>DVT start date</label><input id="f_dvtStart" type="date" value="${d.dvtStart||d.surgeryDate||''}"></div>
    </div>
    <div class="form-row">
      <label>DVT course (days, optional)</label>
      <div class="abx-days-row">
        <button type="button" class="btn abx-day-preset dvt-day-preset dvt-day-clear ${!parseTherapyDays(d.dvtDays)?'active':''}" data-dvt-days="0">None</button>
        ${[3,5,7,14].map(n=>`<button type="button" class="btn abx-day-preset dvt-day-preset ${parseTherapyDays(d.dvtDays)===n?'active':''}" data-dvt-days="${n}">${n}d</button>`).join('')}
        <input id="f_dvtDays" type="number" min="0" max="30" placeholder="Custom" value="${[3,5,7,14].includes(parseTherapyDays(d.dvtDays))?'' : (parseTherapyDays(d.dvtDays)||'')}" style="width:72px;">
      </div>
    </div>

    <div class="form-row">
      <label>Key labs (optional)</label>
      <div class="labs-grid">
        <div><span>Hb</span><input id="f_lab_hb" inputmode="decimal" value="${escapeHTML((d.labs||{}).hb||'')}" class="${labValueClass('hb', (d.labs||{}).hb)}"></div>
        <div><span>CRP</span><input id="f_lab_crp" inputmode="decimal" value="${escapeHTML((d.labs||{}).crp||'')}" class="${labValueClass('crp', (d.labs||{}).crp)}"></div>
        <div><span>WCC</span><input id="f_lab_wcc" inputmode="decimal" value="${escapeHTML((d.labs||{}).wcc||'')}" class="${labValueClass('wcc', (d.labs||{}).wcc)}"></div>
        <div><span>Creatinine</span><input id="f_lab_creatinine" inputmode="decimal" value="${escapeHTML((d.labs||{}).creatinine||'')}" class="${labValueClass('creatinine', (d.labs||{}).creatinine)}"></div>
      </div>
    </div>

    <div class="form-row">
      <label>Procedure done</label>
      <input id="f_procedure" value="${escapeHTML(d.procedure)}" placeholder="e.g. ORIF with plate and screws — radius">
    </div>
    <div class="form-row two">
      <div><label>Surgeon</label><input id="f_surgeon" value="${escapeHTML(d.surgeon)}" placeholder="Operating surgeon"></div>
      <div><label>Implant details</label><input id="f_implant" value="${escapeHTML(d.implant)}" placeholder="e.g. 3.5mm LCP, 6 holes"></div>
    </div>

    <div class="form-row">
      <label>Today's plan</label>
      <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center;">
        <select id="pathwayTemplatePicker" style="flex:1;min-width:160px;">
          ${renderPlanTemplatePickerOptions('')}
        </select>
        <button type="button" class="btn" id="insertPlanFromTemplateBtn" title="Insert plan text for current POD only">Insert plan</button>
        <button type="button" class="btn primary" id="applyPathwayTemplateBtn" title="Add milestones + insert today's plan">Apply pathway</button>
      </div>
      <div id="templateApplyPreview" class="form-hint"></div>
      <textarea id="f_dailyPlan" placeholder="e.g. Dressing check, wrist mobilization, repeat X-ray">${escapeHTML(d.dailyPlan)}</textarea>
      <div id="planStatus" class="plan-status"></div>
    </div>

    <div class="form-row">
      <label>Handover note</label>
      <textarea id="f_handoverNote" placeholder="Watch for / pending / call consultant if…">${escapeHTML(d.handoverNote||'')}</textarea>
      <div class="form-hint">Visible on card and worklist until cleared.</div>
    </div>

    <div class="form-row">
      <label>${d.status==='conservative' ? 'Care milestones' : 'Post-op milestones'}</label>
      <div id="postOpList"></div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
        <select id="postOpTemplatePicker" style="flex:1;min-width:140px;">
          ${renderMilestoneTemplatePickerOptions('')}
        </select>
        <button type="button" class="btn" id="applyPostOpTemplateBtn">Apply template</button>
        <button type="button" class="btn" id="addPostOpItemBtn">+ Custom</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
        <select id="postOpLibraryItemPicker" style="flex:1;min-width:160px;">${renderLibraryItemPickerOptions('postop')}</select>
        <button type="button" class="btn" id="addPostOpFromLibBtn">Add from library</button>
      </div>
    </div>

    <div class="form-row">
      <label>Discharge checklist</label>
      <div id="dischargeList"></div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
        <select id="dischargeTemplatePicker" style="flex:1;min-width:140px;">
          ${renderTemplatePickerOptionsForType('discharge')}
        </select>
        <button type="button" class="btn" id="applyDischargeTemplateBtn">Apply template</button>
        <button type="button" class="btn" id="addDischargeItemBtn">+ Custom</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
        <select id="dischargeLibraryItemPicker" style="flex:1;min-width:160px;">${renderLibraryItemPickerOptions('discharge')}</select>
        <button type="button" class="btn" id="addDischargeFromLibBtn">Add from library</button>
      </div>
    </div>

    <div class="form-row">
      <label>Complications</label>
      <div id="complicationList"></div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
        <input id="compType" placeholder="Type e.g. wound infection" style="flex:1;min-width:120px;">
        <input id="compNote" placeholder="Brief note" style="flex:2;min-width:160px;">
        <button type="button" class="btn" id="addCompBtn">Add</button>
      </div>
    </div>

    <div class="form-row">
      <label>Investigations</label>
      <div id="invList"></div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <select id="invPicker" style="flex:1;">
          <option value="">— choose common investigation —</option>
          ${COMMON_INVESTIGATIONS.map(i=>`<option value="${i}">${i}</option>`).join('')}
        </select>
        <button type="button" class="btn" id="addInvBtn">Add</button>
      </div>
      <input id="invCustom" placeholder="...or type a custom investigation and press Add" style="margin-top:6px;">
    </div>

    <div class="form-row">
      <label>Fitness clearances</label>
      <div id="fitList"></div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <select id="fitPicker" style="flex:1;">
          <option value="">— choose department —</option>
          ${COMMON_FITNESS.map(f=>`<option value="${f}">${f}</option>`).join('')}
        </select>
        <button type="button" class="btn" id="addFitBtn">Add</button>
      </div>
    </div>

    <div class="form-row">
      <label>Notes</label>
      <textarea id="f_notes" placeholder="Free-text rounds notes">${escapeHTML(d.notes)}</textarea>
    </div>
  `;
}

function getWorkingData(){
  if(!modalWorkingData) throw new Error('Patient form is not open');
  return modalWorkingData;
}
function setWorkingData(d){
  modalWorkingData = d;
}

// Shows whether the current plan counts as "today's" and lets the user carry
// an unchanged/older plan forward to today in one tap (without retyping it).
function renderPlanStatus(){
  const el = document.getElementById('planStatus');
  if(!el) return;
  const d = getWorkingData();
  const cur = (document.getElementById('f_dailyPlan').value || '').trim();
  const orig = (d.dailyPlan || '').trim();
  const today = todayISO();

  let html = '';
  if(!cur){
    html = `<span class="small-muted">No plan entered for today.</span>`;
  }else if(cur !== orig){
    html = `<span class="plan-ok">✓ Will be saved as today's plan.</span>`;
  }else if(d.dailyPlanDate === today){
    html = `<span class="plan-ok">✓ Plan set for today.</span>`;
  }else{
    const last = d.dailyPlanDate ? fmtDate(d.dailyPlanDate) : 'a previous day';
    const yPlan = getYesterdayPlan(d);
    html = `<span class="plan-stale">⚠ Plan last set ${escapeHTML(last)}.</span>
      <button type="button" class="btn" id="usePlanTodayBtn" style="padding:3px 9px;">Use this plan for today</button>`;
    if(yPlan && yPlan.text !== cur){
      html += `<button type="button" class="btn" id="copyYesterdayPlanBtn" style="padding:3px 9px;">Copy yesterday's plan</button>`;
    }
  }
  el.innerHTML = html;

  const btn = document.getElementById('usePlanTodayBtn');
  if(btn){
    btn.addEventListener('click', ()=>{
      const dd = getWorkingData();
      dd.dailyPlanDate = today;
      setWorkingData(dd);
      renderPlanStatus();
    });
  }
  const copyBtn = document.getElementById('copyYesterdayPlanBtn');
  if(copyBtn){
    copyBtn.addEventListener('click', ()=>{
      const yPlan = getYesterdayPlan(getWorkingData());
      if(!yPlan) return;
      document.getElementById('f_dailyPlan').value = yPlan.text;
      renderPlanStatus();
    });
  }
}

function updateAbxCoursePreview(){
  const el = document.getElementById('abxCoursePreview');
  if(!el) return;
  const draft = {
    antibiotics: document.getElementById('f_antibiotics')?.value.trim() || '',
    antibioticsStart: document.getElementById('f_antibioticsStart')?.value || '',
    antibioticsDays: parseTherapyDays(document.getElementById('f_antibioticsDays')?.value)
      || parseTherapyDays(document.querySelector('.abx-day-preset.active:not(.dvt-day-preset)')?.dataset.abxDays),
    antibioticsStoppedDate: '',
    surgeryDate: document.getElementById('f_surgeryDate')?.value || '',
    status: document.getElementById('f_status')?.value || 'preop'
  };
  const c = getAntibioticsCourse(draft);
  el.textContent = c ? c.label : 'Set drug name, start date, and course length for reminders.';
}

function clearAbxDaySelection(){
  document.querySelectorAll('.abx-day-preset:not(.dvt-day-preset)').forEach(b=> b.classList.remove('active'));
  const none = document.querySelector('.abx-day-clear');
  if(none) none.classList.add('active');
  const inp = document.getElementById('f_antibioticsDays');
  if(inp) inp.value = '';
  updateAbxCoursePreview();
}

function clearDvtDaySelection(){
  document.querySelectorAll('.dvt-day-preset').forEach(b=> b.classList.remove('active'));
  const none = document.querySelector('.dvt-day-clear');
  if(none) none.classList.add('active');
  const inp = document.getElementById('f_dvtDays');
  if(inp) inp.value = '';
}

function bindModalDynamicLists(){
  renderInvList();
  renderFitList();
  renderPostOpList();
  renderDischargeList();
  renderComplicationList();
  renderPlanStatus();
  updateAbxCoursePreview();
  document.getElementById('f_dailyPlan').addEventListener('input', renderPlanStatus);

  document.querySelectorAll('.abx-day-preset:not(.dvt-day-preset)').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const days = parseTherapyDays(btn.dataset.abxDays);
      if(days === 0){
        clearAbxDaySelection();
        return;
      }
      if(btn.classList.contains('active')){
        clearAbxDaySelection();
        return;
      }
      document.querySelectorAll('.abx-day-preset:not(.dvt-day-preset)').forEach(b=> b.classList.remove('active'));
      btn.classList.add('active');
      const inp = document.getElementById('f_antibioticsDays');
      if(inp) inp.value = '';
      updateAbxCoursePreview();
    });
  });
  document.querySelectorAll('.dvt-day-preset').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const days = parseTherapyDays(btn.dataset.dvtDays);
      if(days === 0){
        clearDvtDaySelection();
        return;
      }
      if(btn.classList.contains('active')){
        clearDvtDaySelection();
        return;
      }
      document.querySelectorAll('.dvt-day-preset').forEach(b=> b.classList.remove('active'));
      btn.classList.add('active');
      const inp = document.getElementById('f_dvtDays');
      if(inp) inp.value = '';
    });
  });
  const abxDaysInp = document.getElementById('f_antibioticsDays');
  if(abxDaysInp){
    abxDaysInp.addEventListener('input', ()=>{
      const v = abxDaysInp.value.trim();
      if(!v){
        clearAbxDaySelection();
        return;
      }
      document.querySelectorAll('.abx-day-preset:not(.dvt-day-preset)').forEach(b=> b.classList.remove('active'));
      updateAbxCoursePreview();
    });
  }
  const dvtDaysInp = document.getElementById('f_dvtDays');
  if(dvtDaysInp){
    dvtDaysInp.addEventListener('input', ()=>{
      const v = dvtDaysInp.value.trim();
      if(!v){
        clearDvtDaySelection();
        return;
      }
      document.querySelectorAll('.dvt-day-preset').forEach(b=> b.classList.remove('active'));
    });
  }
  ['f_antibiotics','f_antibioticsStart','f_surgeryDate'].forEach(id=>{
    const node = document.getElementById(id);
    if(node) node.addEventListener('change', updateAbxCoursePreview);
    if(node) node.addEventListener('input', updateAbxCoursePreview);
  });

  document.getElementById('f_status').addEventListener('change', (e)=>{
    const d = getWorkingData();
    d.procedure = document.getElementById('f_procedure').value.trim();
    d.diagnosis = document.getElementById('f_diagnosis').value.trim();
    if(e.target.value === 'conservative' && (!d.postOpChecks || !d.postOpChecks.length) && !modalSuppressAutoTemplate){
      applyConservativeTemplate(d);
    }
    if(e.target.value === 'postop' && (!d.postOpChecks || !d.postOpChecks.length) && !modalSuppressAutoTemplate){
      applyPostOpTemplate(d);
    }
    if(e.target.value === 'fordischarge' && (!d.dischargeChecks || !d.dischargeChecks.length) && !modalSuppressAutoTemplate){
      applyDischargeTemplate(d);
    }
    setWorkingData(d);
    renderPostOpList();
    renderDischargeList();
    updateTemplateApplyPreview();
  });

  document.getElementById('pathwayTemplatePicker').addEventListener('change', updateTemplateApplyPreview);
  const surgeryDateEl = document.getElementById('f_surgeryDate');
  if(surgeryDateEl) surgeryDateEl.addEventListener('change', updateTemplateApplyPreview);

  document.getElementById('insertPlanFromTemplateBtn').addEventListener('click', ()=>{
    const id = document.getElementById('pathwayTemplatePicker').value;
    if(!id){ showToast('Choose a pathway'); return; }
    const d = syncModalFieldsToWorkingData();
    const pod = getWorkingPatientPod();
    const res = applyPlanFromTemplate(d, id, pod);
    if(!res.ok){ showToast(res.message || 'Could not insert plan'); return; }
    setWorkingData(d);
    syncDailyPlanTextarea(d);
    renderPlanStatus();
    updateTemplateApplyPreview();
    const label = res.planInfo.podLabel ? ` (${res.planInfo.podLabel})` : '';
    showToast(`Plan inserted${label}`);
  });

  document.getElementById('applyPathwayTemplateBtn').addEventListener('click', ()=>{
    const id = document.getElementById('pathwayTemplatePicker').value;
    if(!id){ showToast('Choose a pathway'); return; }
    const d = syncModalFieldsToWorkingData();
    const pod = getWorkingPatientPod();
    const res = applyTemplateToPatient(d, id, { merge: true, preserveDone: true, fillPlan: 'current_pod', podOverride: pod });
    setWorkingData(d);
    syncDailyPlanTextarea(d);
    renderPostOpList();
    renderDischargeList();
    renderPlanStatus();
    updateTemplateApplyPreview();
    const parts = [];
    if(res.added) parts.push(`${res.added} milestone(s)`);
    if(res.planApplied) parts.push('plan for today');
    showToast(parts.length ? `Applied — ${parts.join(' + ')}` : 'Pathway applied (no new items)');
  });

  document.getElementById('applyPostOpTemplateBtn').addEventListener('click', ()=>{
    const id = document.getElementById('postOpTemplatePicker').value;
    if(!id){ showToast('Choose a post-op template'); return; }
    const d = getWorkingData();
    const res = applyTemplateToPatient(d, id, { merge: true, preserveDone: true, fillPlan: 'none' });
    setWorkingData(d);
    renderPostOpList();
    showToast(res.added ? `Added ${res.added} milestone(s)` : 'No new items to add');
  });

  document.getElementById('applyDischargeTemplateBtn').addEventListener('click', ()=>{
    const id = document.getElementById('dischargeTemplatePicker').value;
    if(!id){ showToast('Choose a discharge template'); return; }
    const d = getWorkingData();
    const res = applyTemplateToPatient(d, id, { merge: true, preserveDone: true, fillPlan: 'none' });
    setWorkingData(d);
    renderDischargeList();
    showToast(res.added ? `Added ${res.added} item(s)` : 'No new items to add');
  });

  document.getElementById('addPostOpItemBtn').addEventListener('click', async ()=>{
    const fields = await showPromptFields('Add milestone', [
      { id: 'label', label: 'Milestone label', value: '', placeholder: 'e.g. Follow-up X-ray' },
      { id: 'duePod', label: 'Due POD', value: '0', type: 'number' }
    ]);
    if(!fields || !fields.label || !fields.label.trim()) return;
    const d = getWorkingData();
    d.postOpChecks = d.postOpChecks || [];
    d.postOpChecks.push(normalizePostOpItem({
      id: 'custom_' + uid(),
      label: fields.label.trim(),
      duePod: Number(fields.duePod) || 0,
      status: 'pending'
    }));
    setWorkingData(d);
    renderPostOpList();
  });

  document.getElementById('addDischargeItemBtn').addEventListener('click', async ()=>{
    const fields = await showPromptFields('Add discharge item', [
      { id: 'label', label: 'Checklist item', value: '', placeholder: 'e.g. Discharge summary done' }
    ]);
    if(!fields || !fields.label || !fields.label.trim()) return;
    const d = getWorkingData();
    d.dischargeChecks = d.dischargeChecks || [];
    d.dischargeChecks.push(normalizeDischargeItem({
      id: 'dcustom_' + uid(),
      label: fields.label.trim(),
      status: 'pending'
    }));
    setWorkingData(d);
    renderDischargeList();
  });

  document.getElementById('addPostOpFromLibBtn').addEventListener('click', ()=>{
    const key = document.getElementById('postOpLibraryItemPicker').value;
    if(!key){ showToast('Choose a library item'); return; }
    if(addLibraryItemToPatient('postOpChecks', key)){
      renderPostOpList();
      showToast('Item added');
    }else showToast('Item already on checklist');
  });

  document.getElementById('addDischargeFromLibBtn').addEventListener('click', ()=>{
    const key = document.getElementById('dischargeLibraryItemPicker').value;
    if(!key){ showToast('Choose a library item'); return; }
    if(addLibraryItemToPatient('dischargeChecks', key)){
      renderDischargeList();
      showToast('Item added');
    }else showToast('Item already on checklist');
  });

  updateTemplateApplyPreview();

  document.getElementById('addCompBtn').addEventListener('click', ()=>{
    const type = document.getElementById('compType').value.trim();
    const note = document.getElementById('compNote').value.trim();
    if(!type && !note) return;
    const d = getWorkingData();
    d.complications = d.complications || [];
    d.complications.push({ type: type || 'Complication', date: todayISO(), note });
    setWorkingData(d);
    document.getElementById('compType').value = '';
    document.getElementById('compNote').value = '';
    renderComplicationList();
  });

  document.getElementById('addInvBtn').addEventListener('click', ()=>{
    const picker = document.getElementById('invPicker');
    const custom = document.getElementById('invCustom');
    const name = custom.value.trim() || picker.value;
    if(!name) return;
    const d = getWorkingData();
    d.investigations = d.investigations || [];
    d.investigations.push({name, status:'pending', value:''});
    setWorkingData(d);
    custom.value=''; picker.value='';
    renderInvList();
  });

  document.getElementById('addFitBtn').addEventListener('click', ()=>{
    const picker = document.getElementById('fitPicker');
    if(!picker.value) return;
    const d = getWorkingData();
    d.fitness = d.fitness || [];
    d.fitness.push({dept:picker.value, status:'pending'});
    setWorkingData(d);
    picker.value='';
    renderFitList();
  });
}

function renderInvList(){
  const d = getWorkingData();
  const el = document.getElementById('invList');
  const items = d.investigations || [];
  el.innerHTML = items.length ? items.map((inv,idx)=>`
    <div class="check-row">
      <span>${escapeHTML(inv.name)}</span>
      <span style="display:flex;gap:6px;">
        <select data-inv-status="${idx}" style="font-size:11px;padding:2px 4px;border-radius:4px;">
          <option value="pending" ${inv.status==='pending'?'selected':''}>pending</option>
          <option value="done" ${inv.status==='done'?'selected':''}>done</option>
          <option value="abnormal" ${inv.status==='abnormal'?'selected':''}>abnormal</option>
        </select>
        <button type="button" class="btn danger" data-remove-inv="${idx}" style="padding:2px 8px;">✕</button>
      </span>
    </div>`).join('') : '<div class="small-muted">None added yet</div>';

  el.querySelectorAll('[data-inv-status]').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const d = getWorkingData();
      d.investigations[+sel.dataset.invStatus].status = sel.value;
      setWorkingData(d);
    });
  });
  el.querySelectorAll('[data-remove-inv]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const d = getWorkingData();
      d.investigations.splice(+btn.dataset.removeInv,1);
      setWorkingData(d);
      renderInvList();
    });
  });
}

function renderFitList(){
  const d = getWorkingData();
  const el = document.getElementById('fitList');
  const items = d.fitness || [];
  el.innerHTML = items.length ? items.map((f,idx)=>`
    <div class="check-row">
      <span>${escapeHTML(f.dept)}</span>
      <span style="display:flex;gap:6px;">
        <select data-fit-status="${idx}" style="font-size:11px;padding:2px 4px;border-radius:4px;">
          <option value="pending" ${f.status==='pending'?'selected':''}>pending</option>
          <option value="done" ${f.status==='done'?'selected':''}>done</option>
        </select>
        <button type="button" class="btn danger" data-remove-fit="${idx}" style="padding:2px 8px;">✕</button>
      </span>
    </div>`).join('') : '<div class="small-muted">None added yet</div>';

  el.querySelectorAll('[data-fit-status]').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const d = getWorkingData();
      d.fitness[+sel.dataset.fitStatus].status = sel.value;
      setWorkingData(d);
    });
  });
  el.querySelectorAll('[data-remove-fit]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const d = getWorkingData();
      d.fitness.splice(+btn.dataset.removeFit,1);
      setWorkingData(d);
      renderFitList();
    });
  });
}

function updateTemplateApplyPreview(){
  const el = document.getElementById('templateApplyPreview');
  const picker = document.getElementById('pathwayTemplatePicker');
  if(!el || !picker) return;
  const id = picker.value;
  if(!id){ el.textContent = ''; return; }
  try{
    const d = syncModalFieldsToWorkingData();
    const pod = getWorkingPatientPod();
    const prev = previewTemplateApply(d, id, { merge: true, preserveDone: true, podOverride: pod });
    if(!prev.tpl){ el.textContent = ''; return; }
    const bits = [];
    if(prev.adds || prev.skips) bits.push(`Milestones: +${prev.adds}, ${prev.skips} already on list`);
    if(prev.planInfo){
      bits.push(`Plan (${prev.planInfo.podLabel || 'template'}): ${prev.planInfo.text.slice(0, 72)}${prev.planInfo.text.length > 72 ? '…' : ''}`);
    }else if(pod === null && prev.tpl.type === 'postop_pathway'){
      bits.push('Plan: set surgery date + post-op status for POD plan');
    }else if(prev.tpl.type === 'postop_pathway'){
      bits.push('Plan: none defined for this POD in template');
    }
    el.textContent = bits.join(' · ');
  }catch{ el.textContent = ''; }
}

function renderPostOpList(){
  const el = document.getElementById('postOpList');
  if(!el) return;
  const d = getWorkingData();
  const items = d.postOpChecks || [];
  const catOpts = CHECKLIST_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('');
  const statOpts = CHECKLIST_STATUSES.map(s=>`<option value="${s}">${s}</option>`).join('');
  el.innerHTML = items.length ? items.map((c,idx)=>`
    <div class="check-row checklist-edit-row" data-check-id="${escapeHTML(c.id)}">
      <div style="flex:1;min-width:0;">
        <input data-postop-label="${idx}" value="${escapeHTML(c.label)}" style="width:100%;font-size:13px;margin-bottom:4px;">
        <span style="display:flex;gap:4px;flex-wrap:wrap;">
          <label class="small-muted">POD <input data-postop-due="${idx}" type="number" min="0" value="${c.duePod??0}" style="width:42px;font-size:11px;"></label>
          <label class="small-muted">End <input data-postop-end="${idx}" type="number" min="" value="${c.duePodEnd??''}" placeholder="—" style="width:42px;font-size:11px;"></label>
          <label class="small-muted"><input type="checkbox" data-postop-exact="${idx}" ${c.exactPod?'checked':''}> Exact</label>
          <select data-postop-cat="${idx}" style="font-size:11px;">${CHECKLIST_CATEGORIES.map(cat=>`<option value="${cat}" ${c.category===cat?'selected':''}>${cat}</option>`).join('')}</select>
        </span>
      </div>
      <span style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
        <select data-postop-status="${idx}" style="font-size:11px;">${CHECKLIST_STATUSES.map(s=>`<option value="${s}" ${c.status===s?'selected':''}>${s}</option>`).join('')}</select>
        <span style="display:flex;gap:2px;">
          <button type="button" class="btn" data-postop-up="${idx}" style="padding:1px 6px;">↑</button>
          <button type="button" class="btn" data-postop-down="${idx}" style="padding:1px 6px;">↓</button>
          <button type="button" class="btn danger" data-postop-rm-id="${escapeHTML(c.id)}" style="padding:1px 6px;">✕</button>
        </span>
      </span>
    </div>`).join('') : '<div class="small-muted">None — apply a pathway template or add custom items</div>';

  const sync = ()=>{ setWorkingData(getWorkingData()); };

  el.querySelectorAll('[data-postop-label]').forEach(inp=>{
    inp.addEventListener('change', ()=>{ const d=getWorkingData(); d.postOpChecks[+inp.dataset.postopLabel].label=inp.value; sync(); });
  });
  el.querySelectorAll('[data-postop-due]').forEach(inp=>{
    inp.addEventListener('change', ()=>{ const d=getWorkingData(); d.postOpChecks[+inp.dataset.postopDue].duePod=+inp.value||0; sync(); });
  });
  el.querySelectorAll('[data-postop-end]').forEach(inp=>{
    inp.addEventListener('change', ()=>{ const d=getWorkingData(); const v=inp.value; d.postOpChecks[+inp.dataset.postopEnd].duePodEnd=v===''?null:+v; sync(); });
  });
  el.querySelectorAll('[data-postop-exact]').forEach(inp=>{
    inp.addEventListener('change', ()=>{ const d=getWorkingData(); d.postOpChecks[+inp.dataset.postopExact].exactPod=inp.checked; sync(); });
  });
  el.querySelectorAll('[data-postop-cat]').forEach(sel=>{
    sel.addEventListener('change', ()=>{ const d=getWorkingData(); d.postOpChecks[+sel.dataset.postopCat].category=sel.value; sync(); });
  });
  el.querySelectorAll('[data-postop-status]').forEach(sel=>{
    sel.addEventListener('change', ()=>{ const d=getWorkingData(); d.postOpChecks[+sel.dataset.postopStatus].status=sel.value; sync(); });
  });
  el.querySelectorAll('[data-postop-rm-id]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const d = getWorkingData();
      const rid = btn.dataset.postopRmId;
      d.postOpChecks = (d.postOpChecks || []).filter(c => c.id !== rid);
      modalSuppressAutoTemplate = true;
      setWorkingData(d);
      renderPostOpList();
    });
  });
  el.querySelectorAll('[data-postop-up]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ const d=getWorkingData(); const i=+btn.dataset.postopUp; if(i>0){ const t=d.postOpChecks[i]; d.postOpChecks[i]=d.postOpChecks[i-1]; d.postOpChecks[i-1]=t; setWorkingData(d); renderPostOpList(); }});
  });
  el.querySelectorAll('[data-postop-down]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ const d=getWorkingData(); const i=+btn.dataset.postopDown; if(i<d.postOpChecks.length-1){ const t=d.postOpChecks[i]; d.postOpChecks[i]=d.postOpChecks[i+1]; d.postOpChecks[i+1]=t; setWorkingData(d); renderPostOpList(); }});
  });
}

function renderDischargeList(){
  const el = document.getElementById('dischargeList');
  if(!el) return;
  const d = getWorkingData();
  const items = d.dischargeChecks || [];
  el.innerHTML = items.length ? items.map((c,idx)=>`
    <div class="check-row checklist-edit-row" data-check-id="${escapeHTML(c.id)}">
      <input data-discharge-label="${idx}" value="${escapeHTML(c.label)}" style="flex:1;font-size:13px;">
      <label class="small-muted" style="font-size:10px;"><input type="checkbox" data-discharge-req="${idx}" ${c.required!==false?'checked':''}> Req</label>
      <select data-discharge-status="${idx}" style="font-size:11px;">${CHECKLIST_STATUSES.map(s=>`<option value="${s}" ${c.status===s?'selected':''}>${s}</option>`).join('')}</select>
      <button type="button" class="btn danger" data-discharge-rm-id="${escapeHTML(c.id)}" style="padding:2px 8px;">✕</button>
    </div>`).join('') : '<div class="small-muted">None — apply a discharge template or add custom items</div>';

  el.querySelectorAll('[data-discharge-label]').forEach(inp=>{
    inp.addEventListener('change', ()=>{ const d=getWorkingData(); d.dischargeChecks[+inp.dataset.dischargeLabel].label=inp.value; setWorkingData(d); });
  });
  el.querySelectorAll('[data-discharge-req]').forEach(inp=>{
    inp.addEventListener('change', ()=>{ const d=getWorkingData(); d.dischargeChecks[+inp.dataset.dischargeReq].required=inp.checked; setWorkingData(d); });
  });
  el.querySelectorAll('[data-discharge-status]').forEach(sel=>{
    sel.addEventListener('change', ()=>{ const d=getWorkingData(); d.dischargeChecks[+sel.dataset.dischargeStatus].status=sel.value; setWorkingData(d); });
  });
  el.querySelectorAll('[data-discharge-rm-id]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const d = getWorkingData();
      const rid = btn.dataset.dischargeRmId;
      d.dischargeChecks = (d.dischargeChecks || []).filter(c => c.id !== rid);
      modalSuppressAutoTemplate = true;
      setWorkingData(d);
      renderDischargeList();
    });
  });
}

function renderComplicationList(){
  const el = document.getElementById('complicationList');
  if(!el) return;
  const d = getWorkingData();
  const items = d.complications || [];
  el.innerHTML = items.length ? items.map((c,idx)=>`
    <div class="check-row">
      <span><strong>${escapeHTML(c.type||'Note')}</strong> · ${fmtDate(c.date)} — ${escapeHTML(c.note||'')}</span>
      <button type="button" class="btn danger" data-remove-comp="${idx}" style="padding:2px 8px;">✕</button>
    </div>`).join('') : '<div class="small-muted">None recorded</div>';
  el.querySelectorAll('[data-remove-comp]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const dd = getWorkingData();
      dd.complications.splice(+btn.dataset.removeComp, 1);
      setWorkingData(dd);
      renderComplicationList();
    });
  });
}

async function savePatientFromModal(){
  const isNew = !editingPatientId;
  try{
    const d = getWorkingData();
    const prevPlan = (d.dailyPlan || '').trim();
    const prevPlanDate = d.dailyPlanDate || '';
    d.name = document.getElementById('f_name').value.trim();
    d.bed = document.getElementById('f_bed').value.trim();
    d.ward = document.getElementById('f_ward').value.trim();
    d.assignedPg = document.getElementById('f_assignedPg').value.trim().toUpperCase();
    d.age = document.getElementById('f_age').value.trim();
    d.sex = document.getElementById('f_sex').value;
    d.uhid = document.getElementById('f_uhid').value.trim();
    d.admissionDate = document.getElementById('f_admissionDate').value;
    d.diagnosis = document.getElementById('f_diagnosis').value.trim();
    const newStatus = document.getElementById('f_status').value;
    const prevStatus = d.status;
    d.status = newStatus;
    if(newStatus !== prevStatus) d.statusUpdatedAt = Date.now();
    d.surgeryDate = document.getElementById('f_surgeryDate').value;
    d.theatreTime = document.getElementById('f_theatreTime')?.value.trim() || '';
    d.handoverPin = document.getElementById('f_handoverPin')?.value.trim() || '';
    d.antibiotics = document.getElementById('f_antibiotics')?.value.trim() || '';
    d.antibioticsStart = document.getElementById('f_antibioticsStart')?.value || '';
    const prevAbx = { name: d.antibiotics, start: d.antibioticsStart, days: d.antibioticsDays, stopped: d.antibioticsStoppedDate };
    d.antibioticsDays = parseTherapyDays(document.getElementById('f_antibioticsDays')?.value);
    if(!d.antibioticsDays){
      const activePreset = document.querySelector('.abx-day-preset.active:not(.dvt-day-preset)');
      if(activePreset) d.antibioticsDays = parseTherapyDays(activePreset.dataset.abxDays);
    }
    d.dvtProphylaxis = document.getElementById('f_dvtProphylaxis')?.value.trim() || '';
    d.dvtStart = document.getElementById('f_dvtStart')?.value || '';
    d.dvtDays = parseTherapyDays(document.getElementById('f_dvtDays')?.value);
    if(!d.dvtDays){
      const activeDvt = document.querySelector('.dvt-day-preset.active');
      if(activeDvt) d.dvtDays = parseTherapyDays(activeDvt.dataset.dvtDays);
    }
    if(d.antibiotics !== prevAbx.name || d.antibioticsStart !== prevAbx.start || d.antibioticsDays !== prevAbx.days){
      d.antibioticsStoppedDate = '';
    }
    d.labs = {
      hb: document.getElementById('f_lab_hb')?.value.trim() || '',
      crp: document.getElementById('f_lab_crp')?.value.trim() || '',
      wcc: document.getElementById('f_lab_wcc')?.value.trim() || '',
      creatinine: document.getElementById('f_lab_creatinine')?.value.trim() || '',
      updatedAt: todayISO()
    };
    d.procedure = document.getElementById('f_procedure').value.trim();
    d.surgeon = document.getElementById('f_surgeon').value.trim();
    d.implant = document.getElementById('f_implant').value.trim();
    const newPlan = document.getElementById('f_dailyPlan').value.trim();
    d.handoverNote = document.getElementById('f_handoverNote').value.trim();
    d.planHistory = d.planHistory || [];

    flushChecklistsFromModal(d);

    if(isNew && !modalSuppressAutoTemplate && newStatus === 'postop' && !d.postOpChecks?.length) applyPostOpTemplate(d);
    if(isNew && !modalSuppressAutoTemplate && newStatus === 'fordischarge' && !d.dischargeChecks?.length) applyDischargeTemplate(d);

    const ini = await ensurePgInitials();
    if(prevPlan && (newPlan !== prevPlan || (newPlan && prevPlanDate !== todayISO() && newPlan === prevPlan))){
      if(prevPlanDate && (prevPlan !== newPlan || prevPlanDate !== todayISO())){
        archivePlanToHistory(d, prevPlan, prevPlanDate, ini);
      }
    }
    if(!newPlan){
      if(prevPlan && prevPlanDate) archivePlanToHistory(d, prevPlan, prevPlanDate, ini);
      d.dailyPlanDate = '';
    }else if(newPlan !== prevPlan || !d.dailyPlanDate){
      d.dailyPlanDate = todayISO();
    }
    d.dailyPlan = newPlan;
    if(newPlan !== prevPlan || !d.dailyPlanDate){
      d.planUpdatedAt = Date.now();
    }
    d.notes = document.getElementById('f_notes').value.trim();

    if(!d.name){ showToast('Please enter patient name'); return; }

    normalizePatientChecklists(d);
    await savePatient(d);

    if(isNew){
      currentFilter = 'all';
      document.getElementById('searchInput').value = '';
      document.querySelectorAll('.filter-chip').forEach(c=> c.classList.toggle('active', c.dataset.filter==='all'));
    }

    closePatientModal();
    renderAll();
    showToast('Saved');
  }catch(err){
    console.error(err);
    showToast('Could not save patient — ' + (err.message || 'error'));
  }
}

async function deleteCurrentPatient(){
  const d = getWorkingData();
  const ok = await showConfirm(
    'Delete patient?',
    `Delete ${d.name || 'this patient'}? This cannot be undone.`,
    { confirmLabel: 'Delete', danger: true }
  );
  if(!ok) return;
  try{
    await softDeletePatient(d.id);
    closePatientModal();
    renderAll();
    showToast('Patient deleted');
  }catch(err){
    console.error(err);
    showToast('Could not delete — ' + (err.message || 'error'));
  }
}

/* ---------------- WARD HANDOVER (unit meta) ---------------- */

function renderWardHandoverBanner(){
  const el = document.getElementById('wardHandoverBanner');
  if(!el) return;
  const txt = (wardMeta.handoverNote || '').trim();
  if(!txt){
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';
  el.querySelector('.ward-handover-text').textContent = txt;
}

async function editWardHandover(){
  const cur = wardMeta.handoverNote || '';
  const fields = await showPromptFields('Unit handover note', [
    { id: 'note', label: 'Visible on worklist for all PGs', value: cur, type: 'textarea', rows: 5, placeholder: 'Ward-wide handover for today…' }
  ]);
  if(!fields) return;
  const next = fields.note ?? '';
  await saveWardMeta({ handoverNote: next.trim() });
  renderWardHandoverBanner();
  renderWorklist();
  updateCounts();
  showToast(next.trim() ? 'Unit handover saved' : 'Unit handover cleared');
}

/* ---------------- PRESENTATION MODE ---------------- */

function getPresentationList(){
  let list = getActiveRoundsItems();
  if(presentationUnpresentedOnly){
    list = list.filter(p => !isPresented(p.id));
  }
  return list;
}

function getPresentationWards(list){
  const seen = new Set();
  const wards = [];
  for(const p of list){
    const w = getPatientWard(p);
    if(!seen.has(w)){ seen.add(w); wards.push(w); }
  }
  return wards;
}

function jumpPresentationToWard(ward){
  if(!ward) return;
  const list = getPresentationList();
  const idx = list.findIndex(p => getPatientWard(p) === ward);
  if(idx >= 0){
    presentationIndex = idx;
    renderPresentationSlide();
  }
}

function renderPresentationExtras(p){
  const overdue = getOverduePostOpChecks(p);
  const due = getDuePostOpChecks(p);
  const pendingDis = getPendingRequiredDischargeChecks(p);
  const comps = p.complications || [];
  let html = '';
  if(overdue.length){
    html += `<div class="pres-section"><div class="pres-label">Overdue milestones</div><div class="pres-plan" style="border-left:3px solid #d0705f;">${overdue.map(c=>escapeHTML(c.label)).join(' · ')}</div></div>`;
  }
  if(due.length){
    html += `<div class="pres-section"><div class="pres-label">Due milestones</div><div class="pres-plan">${due.map(c=>escapeHTML(c.label)).join(' · ')}</div></div>`;
  }
  if(p.status==='fordischarge' && pendingDis.length){
    html += `<div class="pres-section"><div class="pres-label">Discharge pending (required)</div><div class="pres-plan">${pendingDis.map(c=>escapeHTML(c.label)).join(' · ')}</div></div>`;
  }
  if(comps.length){
    html += `<div class="pres-section"><div class="pres-label">Complications</div><div class="pres-plan">${comps.map(c=>escapeHTML((c.type||'Note') + (c.note ? ': '+c.note : ''))).join(' · ')}</div></div>`;
  }
  if(!hasPlanToday(p) && p.dailyPlan){
    html += `<div class="pres-section"><div class="pres-label">Plan note</div><div class="pres-plan" style="opacity:0.85;">Outdated — last set ${escapeHTML(fmtDate(p.dailyPlanDate)||'earlier')}</div></div>`;
  }
  return html;
}

function openPresentationMode(){
  const list = getPresentationList();
  if(!list.length){
    if(presentationUnpresentedOnly){
      showToast('All patients presented');
      presentationUnpresentedOnly = false;
      localStorage.setItem(LS_PRESENT_UNPRESENTED, '0');
      const cb = document.getElementById('presentUnpresentedOnly');
      if(cb) cb.checked = false;
    }else{
      showToast('No patients to present');
    }
    return;
  }
  presentationIndex = 0;
  document.getElementById('presentationOverlay').classList.add('active');
  renderPresentationSlide();
  bindPresentationKeyboard();
}

function bindPresentationKeyboard(){
  if(window._presKeyHandler) return;
  window._presKeyHandler = (e)=>{
    const overlay = document.getElementById('presentationOverlay');
    if(!overlay?.classList.contains('active')) return;
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if(e.key === 'ArrowRight' || e.key === 'n') stepPresentation(1, true);
    if(e.key === 'ArrowLeft' || e.key === 'p') stepPresentation(-1);
    if(e.key === ' ') { e.preventDefault(); markCurrentPresented(); }
  };
  document.addEventListener('keydown', window._presKeyHandler);
}

function closePresentationMode(){
  document.getElementById('presentationOverlay').classList.remove('active');
  if(window.speechSynthesis) window.speechSynthesis.cancel();
}

function stepPresentation(delta, autoMark){
  const list = getPresentationList();
  if(!list.length) return;
  if(autoMark && delta > 0){
    const p = list[presentationIndex];
    if(p && !isPresented(p.id)) markPresented(p.id);
  }
  const body = document.getElementById('presentationContent');
  const doStep = ()=>{
    presentationIndex = Math.max(0, Math.min(list.length - 1, presentationIndex + delta));
    renderPresentationSlide(true);
    if(presentationReadAloud) speakCurrentPresentation();
  };
  if(body && window.matchMedia('(prefers-reduced-motion: no-preference)').matches){
    body.classList.add('pres-slide-out');
    setTimeout(()=>{
      doStep();
      body.classList.remove('pres-slide-out');
      body.classList.add('pres-slide-in');
      requestAnimationFrame(()=> body.classList.remove('pres-slide-in'));
    }, 120);
  }else{
    doStep();
  }
}

function markCurrentPresented(){
  const list = getPresentationList();
  const p = list[presentationIndex];
  if(!p) return;
  markPresented(p.id);
  renderPresentationSlide();
  showToast('Marked as presented');
  if(presentationUnpresentedOnly && presentationIndex >= list.length - 1){
    showToast('All done — queue complete');
  }
}

function speakCurrentPresentation(){
  if(!window.speechSynthesis) return;
  const list = getPresentationList();
  const p = list[presentationIndex];
  if(!p) return;
  window.speechSynthesis.cancel();
  const text = generatePresentationScript(p).replace(/<[^>]+>/g, ' ');
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}

function renderPresentationXrays(p){
  const imgs = p.images || [];
  if(!imgs.length) return '';
  return `<div class="pres-section">
    <div class="pres-label">X-rays</div>
    <div class="pres-xray-row">
      ${imgs.map(img=>`
        <button type="button" class="pres-xray-thumb" data-pres-img="${escapeHTML(img.id)}" aria-label="${escapeHTML(img.type)} X-ray">
          <img src="${imageSrc(img)}" alt="">
          <span class="pres-xray-tag">${escapeHTML(img.type.toUpperCase())}${img.date ? ' · '+escapeHTML(fmtDate(img.date)) : ''}</span>
        </button>`).join('')}
    </div>
  </div>`;
}

function bindPresentationXrayClicks(container, p){
  container.querySelectorAll('[data-pres-img]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const img = (p.images||[]).find(i=>i.id===btn.dataset.presImg);
      if(img) openImgViewer(img);
    });
  });
}

function renderPresentationSlide(animating){
  const list = getPresentationList();
  const p = list[presentationIndex];
  const el = document.getElementById('presentationContent');
  if(!p || !el){
    closePresentationMode();
    return;
  }
  const dayInfo = getClinicalDayInfo(p);
  const flags = getPatientFlags(p);
  const presented = isPresented(p.id);
  const dayLabel = dayInfo ? ` · ${dayInfo.prefix} ${dayInfo.day}` : (p.status === 'conservative' ? ' · Conservative' : '');
  document.getElementById('presentationCounter').textContent = `${presentationIndex + 1} / ${list.length}`;
  document.getElementById('presentationWard').textContent = `Ward ${getPatientWard(p)} · ${p.bed || '—'}`;

  const wardJump = document.getElementById('presentationWardJump');
  const wards = getPresentationWards(list);
  const curWard = getPatientWard(p);
  wardJump.innerHTML = wards.map(w=>`<option value="${escapeHTML(w)}" ${w===curWard?'selected':''}>Ward ${escapeHTML(w)}</option>`).join('');

  el.innerHTML = `
    <div class="pres-hero-line">Ward ${escapeHTML(getPatientWard(p))} · Bed ${escapeHTML(p.bed||'—')}</div>
    <div class="pres-head">
      <h2>${escapeHTML(p.name||'Unnamed')}</h2>
      <div class="pres-meta">${escapeHTML(p.age||'?')}${p.sex?'/'+p.sex:''} · ${escapeHTML(p.diagnosis||'—')}${dayLabel}${presented ? ' · ✓ Presented' : ''}${p.assignedPg ? ' · PG '+escapeHTML(p.assignedPg) : ''}</div>
    </div>
    ${flags.length ? `<div class="flags pres-flags">${flags.map(f=>`<span class="flag ${f.type}">${escapeHTML(f.text)}</span>`).join('')}</div>` : ''}
    ${(p.handoverNote||'').trim() ? `<div class="pres-handover"><strong>Handover:</strong> ${escapeHTML(p.handoverNote.trim())}</div>` : ''}
    <div class="pres-section"><div class="pres-label">Today's plan</div><div class="pres-plan">${escapeHTML(p.dailyPlan) || '—'}</div></div>
    ${renderPresentationExtras(p)}
    ${renderPresentationXrays(p)}
    <div class="pres-section"><div class="pres-label">Compact script</div><div class="pres-script pres-compact">${generateCompactPresentationScript(p)}</div></div>
    <div class="pres-section"><div class="pres-label">Full script</div><div class="pres-script">${generatePresentationScript(p)}</div></div>
  `;

  bindPresentationXrayClicks(el, p);

  document.getElementById('presentationPrev').disabled = presentationIndex <= 0;
  document.getElementById('presentationNext').disabled = presentationIndex >= list.length - 1;
  if(!animating) el.scrollTop = 0;
}

function bindPresentationSwipe(){
  const overlay = document.getElementById('presentationOverlay');
  if(!overlay) return;
  let startX = 0;
  overlay.addEventListener('touchstart', (e)=>{
    if(!overlay.classList.contains('active')) return;
    startX = e.changedTouches[0].screenX;
  }, { passive: true });
  overlay.addEventListener('touchend', (e)=>{
    if(!overlay.classList.contains('active')) return;
    const dx = e.changedTouches[0].screenX - startX;
    if(dx > 60) stepPresentation(-1);
    if(dx < -60) stepPresentation(1);
  }, { passive: true });
}

/* ---------------- TEMPLATE MANAGER ---------------- */

let editingTemplateId = null;

function openTemplateManager(){
  editingTemplateId = null;
  document.getElementById('templateManagerModal').classList.add('active');
  renderTemplateManagerList();
}

function closeTemplateManager(){
  document.getElementById('templateManagerModal').classList.remove('active');
  editingTemplateId = null;
}

function renderTemplateManagerList(){
  const el = document.getElementById('templateManagerList');
  const search = (document.getElementById('templateSearchInput').value || '').toLowerCase();
  let list = getMergedTemplates();
  if(search) list = list.filter(t => (t.name||'').toLowerCase().includes(search) || (t.tags||[]).some(tag=>tag.includes(search)));
  el.innerHTML = list.map(t=>`
    <div class="template-row" data-tid="${escapeHTML(t.id)}">
      <div>
        <strong>${escapeHTML(t.name)}</strong>
        ${t.builtin ? '<span class="small-muted"> (built-in)</span>' : ''}
        <div class="small-muted">${escapeHTML(t.type)} · ${(t.items||[]).length} items · ${(t.tags||[]).slice(0,4).join(', ')}</div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0;">
        <button type="button" class="btn" data-tpl-edit="${escapeHTML(t.id)}">Edit</button>
        <button type="button" class="btn" data-tpl-dup="${escapeHTML(t.id)}">Dup</button>
        ${t.builtin ? `<button type="button" class="btn" data-tpl-hide="${escapeHTML(t.id)}">Hide</button>` : `<button type="button" class="btn danger" data-tpl-del="${escapeHTML(t.id)}">Del</button>`}
      </div>
    </div>`).join('') || '<div class="small-muted">No templates match.</div>';

  el.querySelectorAll('[data-tpl-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openTemplateEditor(btn.dataset.tplEdit));
  });
  el.querySelectorAll('[data-tpl-dup]').forEach(btn=>{
    btn.addEventListener('click', ()=> duplicateWardTemplate(btn.dataset.tplDup));
  });
  el.querySelectorAll('[data-tpl-hide]').forEach(btn=>{
    btn.addEventListener('click', ()=> hideBuiltinTemplate(btn.dataset.tplHide));
  });
  el.querySelectorAll('[data-tpl-del]').forEach(btn=>{
    btn.addEventListener('click', ()=> deleteWardTemplate(btn.dataset.tplDel));
  });
}

function openTemplateEditor(id){
  const tpl = getTemplateById(id) || getBuiltinTemplates().find(t=>t.id===id);
  if(!tpl) return;
  editingTemplateId = tpl.builtin ? null : id;
  const isNew = !tpl.builtin && !wardTemplateLibrary.templates.find(t=>t.id===id);
  const body = document.getElementById('templateEditorBody');
  document.getElementById('templateEditorTitle').textContent = tpl.builtin ? `View / duplicate: ${tpl.name}` : (editingTemplateId ? `Edit: ${tpl.name}` : 'New template');
  const items = tpl.items || [];
  body.innerHTML = `
    <div class="form-row"><label>Name</label><input id="te_name" value="${escapeHTML(tpl.name)}" ${tpl.builtin?'readonly':''}></div>
    <div class="form-row two">
      <div><label>Type</label>
        <select id="te_type" ${tpl.builtin?'disabled':''}>
          <option value="postop_pathway" ${tpl.type==='postop_pathway'?'selected':''}>Post-op pathway</option>
          <option value="discharge" ${tpl.type==='discharge'?'selected':''}>Discharge</option>
          <option value="preop" ${tpl.type==='preop'?'selected':''}>Pre-op</option>
        </select>
      </div>
      <div><label>Tags (comma-separated)</label><input id="te_tags" value="${escapeHTML((tpl.tags||[]).join(', '))}" ${tpl.builtin?'readonly':''}></div>
    </div>
    <div class="form-row"><label>Items (label | duePod | duePodEnd | exact | category)</label>
      <div id="te_items">${items.map((it,i)=>`
        <div class="check-row te-item-row" style="margin-bottom:4px;flex-wrap:wrap;gap:4px;">
          <input data-te-label="${i}" value="${escapeHTML(it.label)}" style="flex:2;min-width:120px;" ${tpl.builtin?'readonly':''}>
          ${tpl.type!=='discharge' ? `<input data-te-due="${i}" type="number" value="${it.duePod??0}" style="width:48px;" ${tpl.builtin?'readonly':''} title="due POD">
          <input data-te-end="${i}" type="number" value="${it.duePodEnd??''}" placeholder="end" style="width:48px;" ${tpl.builtin?'readonly':''}>
          <label><input type="checkbox" data-te-exact="${i}" ${it.exactPod?'checked':''} ${tpl.builtin?'disabled':''}> Exact</label>` : ''}
          <select data-te-cat="${i}" ${tpl.builtin?'disabled':''}>${CHECKLIST_CATEGORIES.map(c=>`<option value="${c}" ${it.category===c?'selected':''}>${c}</option>`).join('')}</select>
          ${!tpl.builtin ? `<button type="button" class="btn danger te-rm-item" style="padding:2px 8px;">✕</button>` : ''}
        </div>`).join('')}</div>
      ${!tpl.builtin ? '<button type="button" class="btn" id="te_addItem" style="margin-top:6px;">+ Item</button>' : ''}
    </div>
    ${tpl.builtin ? '<p class="form-hint">Built-in templates are read-only. Use Duplicate to create an editable copy.</p>' : ''}
  `;
  document.getElementById('templateEditorPanel').style.display = 'block';
  if(!tpl.builtin){
    document.getElementById('te_addItem').addEventListener('click', ()=>{
      const box = document.getElementById('te_items');
      const i = box.querySelectorAll('[data-te-label]').length;
      const div = document.createElement('div');
      div.className = 'check-row te-item-row';
      div.style.cssText = 'margin-bottom:4px;flex-wrap:wrap;gap:4px;';
      div.innerHTML = `<input data-te-label="${i}" value="New item" style="flex:2;min-width:120px;">
        <input data-te-due="${i}" type="number" value="0" style="width:48px;">
        <input data-te-end="${i}" type="number" placeholder="end" style="width:48px;">
        <label><input type="checkbox" data-te-exact="${i}"> Exact</label>
        <select data-te-cat="${i}">${CHECKLIST_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}</select>
        <button type="button" class="btn danger te-rm-item" style="padding:2px 8px;">✕</button>`;
      box.appendChild(div);
      bindTemplateItemRemoveButtons();
    });
    bindTemplateItemRemoveButtons();
  }
}

function bindTemplateItemRemoveButtons(){
  document.querySelectorAll('#te_items .te-rm-item').forEach(btn=>{
    if(btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', ()=>{
      btn.closest('.te-item-row')?.remove();
    });
  });
}

function collectTemplateEditorData(){
  const name = document.getElementById('te_name').value.trim();
  const type = document.getElementById('te_type').value;
  const tags = document.getElementById('te_tags').value.split(',').map(s=>s.trim()).filter(Boolean);
  const items = [];
  document.querySelectorAll('#te_items .te-item-row').forEach(row => {
    const labelInp = row.querySelector('[data-te-label]');
    if(!labelInp) return;
    const label = labelInp.value.trim();
    if(!label) return;
    if(type === 'discharge'){
      const cat = row.querySelector('[data-te-cat]');
      items.push(dischargeItemDef('item_' + uid(), label, { category: cat ? cat.value : 'other' }));
    }else{
      const dueEl = row.querySelector('[data-te-due]');
      const endEl = row.querySelector('[data-te-end]');
      const exactEl = row.querySelector('[data-te-exact]');
      const catEl = row.querySelector('[data-te-cat]');
      const endVal = endEl && endEl.value !== '' ? +endEl.value : null;
      items.push(itemDef('item_' + uid(), label, dueEl ? (+dueEl.value || 0) : 0, {
        duePodEnd: endVal,
        exactPod: exactEl && exactEl.checked,
        category: catEl ? catEl.value : 'other'
      }));
    }
  });
  return { name, type, tags, items };
}

async function saveTemplateEditor(){
  if(document.getElementById('te_name').readOnly) return;
  const data = collectTemplateEditorData();
  if(!data.name){ showToast('Enter template name'); return; }
  wardTemplateLibrary.templates = wardTemplateLibrary.templates || [];
  const id = editingTemplateId || ('ward_' + uid());
  const idx = wardTemplateLibrary.templates.findIndex(t=>t.id===id);
  const rec = { id, name: data.name, type: data.type, tags: data.tags, items: data.items, builtin: false };
  if(idx >= 0) wardTemplateLibrary.templates[idx] = rec;
  else wardTemplateLibrary.templates.push(rec);
  await saveTemplateLibrary();
  document.getElementById('templateEditorPanel').style.display = 'none';
  renderTemplateManagerList();
  showToast('Template saved');
}

async function duplicateWardTemplate(id){
  const src = getTemplateById(id) || getBuiltinTemplates().find(t=>t.id===id);
  if(!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = 'ward_' + uid();
  copy.name = src.name + ' (copy)';
  copy.builtin = false;
  wardTemplateLibrary.templates = wardTemplateLibrary.templates || [];
  wardTemplateLibrary.templates.push(copy);
  await saveTemplateLibrary();
  renderTemplateManagerList();
  openTemplateEditor(copy.id);
  editingTemplateId = copy.id;
  showToast('Duplicated — edit and save');
}

async function hideBuiltinTemplate(id){
  wardTemplateLibrary.disabledIds = wardTemplateLibrary.disabledIds || [];
  if(!wardTemplateLibrary.disabledIds.includes(id)) wardTemplateLibrary.disabledIds.push(id);
  await saveTemplateLibrary();
  renderTemplateManagerList();
  showToast('Template hidden');
}

async function deleteWardTemplate(id){
  const ok = await showConfirm('Delete template?', 'Delete this ward template? Built-in templates cannot be deleted.', { confirmLabel: 'Delete', danger: true });
  if(!ok) return;
  wardTemplateLibrary.templates = (wardTemplateLibrary.templates || []).filter(t=>t.id!==id);
  await saveTemplateLibrary();
  renderTemplateManagerList();
  showToast('Deleted');
}

function exportTemplatePack(){
  downloadJSON(buildTemplateLibraryExport(), `ortho_templates_${todayISO()}.json`);
  showToast('Template pack downloaded');
}

async function importTemplatePack(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const payload = JSON.parse(reader.result);
      const incoming = payload.templates || payload;
      if(!Array.isArray(incoming)) throw new Error('Invalid format');
      const choice = await showMergeReplaceDialog(
        'Import templates',
        `Import ${incoming.length} template(s) into the ward library?`
      );
      if(choice === 'cancel') return;
      const merge = choice === 'merge';
      if(merge){
        const byId = new Map((wardTemplateLibrary.templates||[]).map(t=>[t.id,t]));
        for(const t of incoming){
          if(t && t.id) byId.set(t.id, Object.assign({}, t, { builtin: false }));
        }
        wardTemplateLibrary.templates = [...byId.values()];
      }else{
        wardTemplateLibrary.templates = incoming.map(t=>Object.assign({}, t, { builtin: false }));
      }
      if(Array.isArray(payload.disabledIds)) wardTemplateLibrary.disabledIds = payload.disabledIds;
      await saveTemplateLibrary();
      renderTemplateManagerList();
      showToast('Templates imported');
    }catch(err){
      showToast('Import failed: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function bindTemplateManagerEvents(){
  document.getElementById('templateManagerClose').addEventListener('click', closeTemplateManager);
  document.getElementById('templateSearchInput').addEventListener('input', renderTemplateManagerList);
  document.getElementById('templateNewBtn').addEventListener('click', ()=>{
    editingTemplateId = null;
    const body = document.getElementById('templateEditorBody');
    document.getElementById('templateEditorTitle').textContent = 'New template';
    body.innerHTML = `
      <div class="form-row"><label>Name</label><input id="te_name" value=""></div>
      <div class="form-row two">
        <div><label>Type</label><select id="te_type"><option value="postop_pathway">Post-op pathway</option><option value="discharge">Discharge</option></select></div>
        <div><label>Tags</label><input id="te_tags" placeholder="orif, radius"></div>
      </div>
      <div class="form-row"><div id="te_items"></div><button type="button" class="btn" id="te_addItem">+ Item</button></div>`;
    document.getElementById('templateEditorPanel').style.display = 'block';
    document.getElementById('te_addItem').addEventListener('click', ()=>{
      const box = document.getElementById('te_items');
      const i = box.querySelectorAll('[data-te-label]').length;
      const div = document.createElement('div');
      div.className = 'check-row te-item-row';
      div.innerHTML = `<input data-te-label="${i}" value="New item" style="flex:2;"><input data-te-due="${i}" type="number" value="0" style="width:48px;">
        <button type="button" class="btn danger te-rm-item" style="padding:2px 8px;">✕</button>`;
      box.appendChild(div);
      bindTemplateItemRemoveButtons();
    });
  });
  document.getElementById('templateEditorSave').addEventListener('click', saveTemplateEditor);
  document.getElementById('templateEditorCancel').addEventListener('click', ()=>{
    document.getElementById('templateEditorPanel').style.display = 'none';
  });
  document.getElementById('templateExportBtn').addEventListener('click', exportTemplatePack);
  document.getElementById('templateImportBtn').addEventListener('click', ()=> document.getElementById('hiddenTemplateImport').click());
  document.getElementById('hiddenTemplateImport').addEventListener('change', importTemplatePack);
}

/* ---------------- handover / roster / bulk ---------------- */

function toggleBulkSelectMode(){
  bulkSelectMode = !bulkSelectMode;
  if(!bulkSelectMode) bulkSelectedIds.clear();
  const btn = document.getElementById('bulkPlanBtn');
  if(btn) btn.classList.toggle('active', bulkSelectMode);
  renderRounds();
  if(bulkSelectMode) showToast('Select patients, then use Bulk plan in More menu');
}

async function applyBulkPlan(){
  if(!bulkSelectedIds.size){ showToast('Select patients first'); return; }
  const fields = await showPromptFields('Bulk plan', [
    { id: 'plan', label: 'Plan for all selected patients', value: '', placeholder: 'Same instruction for everyone' }
  ]);
  if(!fields || !fields.plan?.trim()) return;
  const text = fields.plan.trim();
  const count = bulkSelectedIds.size;
  for(const id of bulkSelectedIds){
    const p = patients.find(x=>x.id===id);
    if(!p) continue;
    saveCardPlan(p, text);
    await savePatient(p);
  }
  bulkSelectMode = false;
  bulkSelectedIds.clear();
  document.getElementById('bulkPlanBtn')?.classList.remove('active');
  renderAll();
  showToast(`Plan applied to ${count} patient(s)`);
}

async function editPgRoster(){
  const cur = getPgRoster().map(r => `${r.initials}|${r.name}|${r.onCall?'1':'0'}`).join('\n');
  const fields = await showPromptFields('PG roster', [
    { id: 'lines', label: 'One per line: INITIALS|Name|on-call (1/0)', value: cur, placeholder: 'AK|Dr Kumar|1' }
  ]);
  if(!fields) return;
  const roster = (fields.lines || '').split('\n').map(line=>{
    const [initials, name, onCall] = line.split('|').map(s=> (s||'').trim());
    if(!initials) return null;
    return { initials: initials.toUpperCase(), name: name || initials, onCall: onCall === '1' };
  }).filter(Boolean);
  await saveWardMeta({ pgRoster: roster });
  showToast('PG roster saved');
}

function buildHandoverSheetHtml(){
  const active = getActiveRoundsItems();
  const groups = groupPatientsByWard(active);
  const today = todayISO();
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Handover ${today}</title>
  <style>body{font-family:system-ui,sans-serif;padding:20px;color:#1c2230;} h1{font-size:18px;} h2{font-size:14px;margin-top:18px;border-bottom:1px solid #ddd;padding-bottom:4px;}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;} th,td{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top;}
  .pin{color:#a6622a;font-weight:600;} @media print{body{padding:0;}}</style></head><body>`;
  html += `<h1>Shift handover — ${fmtDate(today)}</h1>`;
  if(wardMeta.handoverNote) html += `<p><strong>Unit note:</strong> ${escapeHTML(wardMeta.handoverNote)}</p>`;
  for(const [ward, pts] of groups){
    html += `<h2>Ward ${escapeHTML(ward)} (${pts.length})</h2><table><tr><th>Bed</th><th>Name</th><th>Status</th><th>Plan</th><th>PG</th><th>Flags</th></tr>`;
    for(const p of pts){
      const dayInfo = getClinicalDayInfo(p);
      const status = dayInfo ? `${dayInfo.prefix} ${dayInfo.day}` : (STATUS_LABELS[p.status] || p.status || '');
      const plan = hasPlanToday(p) ? (p.dailyPlan||'') : (p.dailyPlan ? '(outdated)' : '(none)');
      const flags = getPatientFlags(p).map(f=>f.text).join('; ');
      html += `<tr><td>${escapeHTML(p.bed||'')}</td><td>${escapeHTML(p.name||'')}</td><td>${escapeHTML(status)}</td>
        <td>${escapeHTML(plan)}${(p.handoverPin||'').trim() ? `<div class="pin">📌 ${escapeHTML(p.handoverPin)}</div>` : ''}</td>
        <td>${escapeHTML(p.assignedPg||'')}</td><td>${escapeHTML(flags)}</td></tr>`;
    }
    html += '</table>';
  }
  html += '</body></html>';
  return html;
}

function printHandoverSheet(){
  const w = window.open('', '_blank');
  if(!w){ showToast('Allow pop-ups to print handover'); return; }
  w.document.write(buildHandoverSheetHtml());
  w.document.close();
  w.focus();
  setTimeout(()=> w.print(), 300);
}

function copyHandoverWhatsApp(){
  const lines = [`*Ortho handover ${fmtDate(todayISO())}*`];
  if(wardMeta.handoverNote) lines.push(`Unit: ${wardMeta.handoverNote}`);
  for(const p of getActiveRoundsItems()){
    const dayInfo = getClinicalDayInfo(p);
    const st = dayInfo ? `${dayInfo.prefix} ${dayInfo.day}` : (STATUS_LABELS[p.status] || p.status);
    lines.push(`${p.bed||'?'} ${p.name||'?'} — ${st} — ${hasPlanToday(p)?p.dailyPlan:'no plan'}${p.assignedPg?' ('+p.assignedPg+')':''}`);
  }
  navigator.clipboard.writeText(lines.join('\n')).then(()=> showToast('Handover copied')).catch(()=> showToast('Could not copy'));
}

/* ---------------- MORNING CENSUS ---------------- */

function exportCensus(){
  const groups = groupPatientsByWard(getActiveRoundsItems());
  const csvRows = [['Ward','Bed','Name','Age/Sex','Diagnosis','POD/Status','Plan today','PG']];
  for(const [ward, pts] of groups){
    for(const p of pts){
      const dayInfo = getClinicalDayInfo(p);
      const plan = (p.dailyPlan && hasPlanToday(p)) ? p.dailyPlan.replace(/\s+/g, ' ').slice(0, 120) : '';
      csvRows.push([
        ward,
        p.bed || '',
        p.name || '',
        `${p.age||''}${p.sex?'/'+p.sex:''}`,
        (p.diagnosis||'').replace(/\s+/g, ' '),
        dayInfo ? `${dayInfo.prefix} ${dayInfo.day}` : (STATUS_LABELS[p.status] || p.status || ''),
        plan,
        p.assignedPg || ''
      ]);
    }
  }
  const csv = csvRows.map(row => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ortho_census_${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Census CSV downloaded');
}

function csvEscape(val){
  const s = String(val ?? '');
  if(/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/* ---------------- EXPORT / IMPORT ---------------- */

async function exportData(){
  try{
    const payload = await api('/api/export');
    downloadJSON(payload, `ortho_rounds_backup_${todayISO()}.json`);
    localStorage.setItem(LS_LAST_EXPORT, String(Date.now()));
    showToast('Backup file downloaded');
  }catch(err){
    const payload = { exportedAt: new Date().toISOString(), appVersion: 2, patients: buildExportPatientList() };
    downloadJSON(payload, `ortho_rounds_backup_${todayISO()}.json`);
    localStorage.setItem(LS_LAST_EXPORT, String(Date.now()));
    showToast('Backup downloaded (from local cache)');
  }
}

function importData(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const payload = JSON.parse(reader.result);
      if(!payload.patients || !Array.isArray(payload.patients)) throw new Error('Invalid file format');
      const choice = await showMergeReplaceDialog(
        'Import backup',
        `Import ${payload.patients.length} patient record(s)?`
      );
      if(choice === 'cancel') return;
      const mode = choice === 'merge' ? 'merge' : 'replace';
      if(mode === 'replace'){
        const ok = await showConfirm(
          'Replace all data?',
          'This will erase all current data and replace it with the imported file.',
          { confirmLabel: 'Replace all', danger: true }
        );
        if(!ok) return;
      }

      showToast('Importing…');
      let importedOnServer = false;
      try{
        await api('/api/import', { method:'POST', body: JSON.stringify({ patients: payload.patients, mode }) });
        importedOnServer = true;
        if(mode==='replace'){
          localStorage.setItem(LS_LASTSYNC, '0');
          await clearCache();
        }
        try{
          await waitForSync({ fullReconcile: true });
          showToast('Import complete');
        }catch(syncErr){
          console.warn('Post-import sync failed:', syncErr.message);
          showToast('Saved on server — tap Refresh if list looks wrong');
        }
      }catch(serverErr){
        if(serverErr.message === 'unauthorized') throw serverErr;
        if(importedOnServer){
          showToast('Saved on server — tap Refresh to update this device');
          return;
        }
        // Offline fallback: write into local cache, mark dirty so it pushes later.
        if(mode==='replace'){ await clearCache(); localStorage.setItem(LS_LASTSYNC, '0'); }
        for(const p of payload.patients){
          p.updatedAt = p.updatedAt || Date.now();
          await cachePut(p, true);
        }
        await reloadFromCache();
        renderAll();
        showToast('Imported locally — will sync when online');
      }
    }catch(err){
      showToast('Could not read file: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ---------------- go ---------------- */
init();
