/* v2 preview app — state, event delegation, view switching for
   Round, Ward and Work. OT list, handover, discharged, admin, the
   palette, the film viewer, presentation mode and the add modal are
   out of scope for this file (later tasks); go() accepts their view
   names without throwing but renders nothing for them — a seam, not
   a stub.

   Markup for patient cards/rows/board tiles/work items/the completion
   screen comes exclusively from render.js's exports. The only markup
   written here is small orchestration glue that render.js has no
   builder for: the bed spine, section labels, and the round view's
   action bar.

   ── Why document/window/fetch are captured once, at module top level ──
   tests/helpers/v2-env.js's bootV2 swaps `document`/`window`/`fetch`
   (and friends) onto globalThis, dynamically imports this module, and
   then — BEFORE calling render() or dispatching any click — restores
   globalThis to whatever it was before the swap. That was verified
   empirically while building this file: a bare, undeferred `document`
   reference read from inside a function that only runs *after* import
   (e.g. render(), or a click handler invoked by a later `.click()` in
   a test) resolves to `undefined`, not the booted jsdom. Only code that
   runs synchronously during the import itself sees the correct globals.
   So the swap window is captured here, once, at the top of the module,
   into DOC/WIN/FETCH — module-scope bindings, not module-scope *element*
   lookups (`document.getElementById(...)` at top level is still avoided
   everywhere below; every element is queried inside a function, every
   time, via $()/$$()). Because bootV2 cache-busts this module's import
   URL on every call, each test gets a fresh module instance and thus a
   fresh, correct capture — there is no cross-test staleness. In a real
   browser this capture is a no-op simplification: window/document/fetch
   never change during a page's lifetime. fetch is additionally bound to
   its receiver because real browsers throw "Illegal invocation" if
   fetch is called detached from `window`. */
import { esc, hero, row, detail, board, workList, complete } from './render.js';
import { fetchWard, pushPatient, toViewModel } from './data.js';

const DOC = document;
const WIN = window;
const FETCH = window.fetch.bind(window);

const $ = s => DOC.querySelector(s);
const $$ = s => [...DOC.querySelectorAll(s)];
const wide = () => WIN.innerWidth >= 1100;

const S = {
  view: 'round', idx: 0, seen: new Set(), work: 0,
  patients: [],      // view models, from fetchWard() — never demo data
  raw: new Map(),    // id -> raw patient record, for safe pushPatient() writes
  serverTime: 0
};

/* ── toast ── */
let toastTimer;
function toast(m){
  const t = $('#toast');
  if(!t) return;
  t.textContent = m;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2000);
}

/* ── theme ── */
function setTheme(dark){
  DOC.documentElement.dataset.theme = dark ? 'dark' : 'light';
  toast(dark ? 'Reading room on' : 'Reading room off');
}

/* ── overlays (not implemented this task; closeAll is a harmless seam
   so Escape doesn't need special-casing once tasks 7-9 add them) ── */
function closeAll(){
  for(const sel of ['#scrim', '#pal', '#addM', '#present', '#viewer']){
    $(sel)?.classList.remove('on');
  }
}

/* ── data load ──
   fetchWard() is the single required source of truth for rendering (its
   rejection path is what drives the retry UI below). It doesn't expose
   the raw patient records pushPatient() needs — those are necessary
   because the server's merge (merge.js: mergePatientRecords) always
   fully replaces postOpChecks/dischargeChecks with whatever the pushed
   object carries for those keys once the pushed record's updatedAt wins
   (which a freshly-stamped write always does); omitting them would wipe
   the ward's checklists on the very next unrelated write (e.g. a plan
   edit). So fetchImpl is wrapped here to capture the exact JSON body
   fetchWard() itself already fetched and parsed — no second network
   round trip — giving both the view models AND the untransformed raw
   records, keyed by id, from one request. */
async function loadWard(){
  let rawSnapshot = null;
  const capturingFetch = async (url, opts) => {
    const res = await FETCH(url, opts);
    return {
      ok: res.ok,
      status: res.status,
      json: async () => {
        if(rawSnapshot === null) rawSnapshot = await res.json();
        return rawSnapshot;
      }
    };
  };
  const data = await fetchWard(capturingFetch, WIN);
  if(rawSnapshot && Array.isArray(rawSnapshot.patients)){
    S.raw = new Map(rawSnapshot.patients.map(p => [p.id, p]));
  }
  return data;
}

async function render(){
  let data;
  try{
    data = await loadWard();
  }catch(err){
    $('#roundList').innerHTML =
      `<div class="empty" style="text-align:center;padding:var(--s-7) var(--s-4)">
   <p>Couldn't reach the server.</p>
   <button class="btn gh" data-retry="1">Retry</button></div>`;
    return;
  }
  S.patients = data.patients;
  S.serverTime = data.serverTime;
  if(S.idx >= S.patients.length) S.idx = 0;
  if(S.work >= S.patients.length) S.work = 0;
  go(S.view);
}

/* ── spine ── */
function rSpine(){
  $('#spine').innerHTML = S.patients.map((p, i) => {
    const bad = p.flags.find(f => f[0] === 'bad');
    return `<button class="sp ${i === S.idx ? 'now' : ''} ${S.seen.has(i) ? 'seen' : ''} ${bad ? 'flag' : ''}"
  data-open="${i}" role="tab" aria-selected="${i === S.idx}" aria-label="Bed ${esc(p.bed)}, ${esc(p.name)}">${esc(p.bed)}<i></i></button>`;
  }).join('');
  const total = S.patients.length || 1;
  const ringFg = $('#ringFg');
  if(ringFg) ringFg.style.strokeDashoffset = 97.4 * (1 - S.seen.size / total);
  const ringN = $('#ringN');
  if(ringN) ringN.textContent = `${S.seen.size}/${S.patients.length}`;
  $('#spine .sp.now')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
}

/* ── round ── */
function rRound(){
  if(!S.patients.length){
    $('#roundList').innerHTML = `<p class="empty">No patients on this ward yet.</p>`;
    $('#roundDet').innerHTML = '';
    return;
  }
  const all = S.seen.size === S.patients.length;
  if(wide()){
    $('#roundList').innerHTML = `<p class="lbl">The round · ${S.seen.size} of ${S.patients.length} seen</p>`
      + S.patients.map((p, i) => row(p, i, i === S.idx, S.seen.has(i))).join('');
    $('#roundDet').innerHTML = all ? complete(S.patients.length)
      : detail(S.patients[S.idx], S.idx) +
        `<div style="display:flex;gap:9px;margin-top:var(--s-3)"><button class="btn pri" style="flex:0 0 auto" data-seen="1">Seen — next patient</button>
    <button class="btn gh" data-skip="1">Skip for now</button></div>`;
  }else{
    if(all){
      $('#roundList').innerHTML = complete(S.patients.length);
      $('#roundDet').innerHTML = '';
      return;
    }
    const nx = [];
    for(let k = 1; k <= S.patients.length && nx.length < 3; k++){
      const i = (S.idx + k) % S.patients.length;
      if(!S.seen.has(i)) nx.push(i);
    }
    $('#roundList').innerHTML = hero(S.patients[S.idx], S.idx)
      + (nx.length ? `<p class="lbl mt">Up next</p>` + nx.map(i => row(S.patients[i], i, false, S.seen.has(i))).join('') : '');
    $('#roundDet').innerHTML = '';
  }
}

/* ── ward ── */
function rBoardView(){
  $('#board').innerHTML = board(S.patients);
}

/* ── work ── */
function workItems(){
  const out = [];
  S.patients.forEach((p, i) => p.flags.forEach(([k, t]) => { if(k !== 'ok') out.push([i, k, t]); }));
  return out.sort((a, b) => (a[1] === 'bad' ? 0 : 1) - (b[1] === 'bad' ? 0 : 1));
}
function rWork(){
  const it = workItems();
  if(S.work >= it.length) S.work = 0;
  $('#workList').innerHTML = workList(it, S.work, S.patients);
  const sel = it[S.work];
  $('#workDet').innerHTML = sel ? detail(S.patients[sel[0]], sel[0]) : '';
}

/* ── view switching ──
   ot/handover/disch/admin are accepted (the shell declares #v-ot etc.
   per Task 2) but deliberately render nothing — that's tasks 7 and 9. */
const TITLES = { round: ['Morning round', null], ward: ['Ward board', null], work: ['Work', 'What needs doing today'] };
function go(v){
  S.view = v;
  $$('.view').forEach(e => e.classList.toggle('on', e.id === 'v-' + v));
  $$('.rl,.nv').forEach(b => {
    if(b.dataset.go === v) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const hT = $('#hT'), hS = $('#hS');
  if(hT && TITLES[v]) hT.textContent = TITLES[v][0];
  if(hS){
    if(v === 'round') hS.textContent = `${S.seen.size} of ${S.patients.length} seen`;
    else if(v === 'ward') hS.textContent = `${S.patients.length} inpatient${S.patients.length === 1 ? '' : 's'}`;
    else if(TITLES[v]) hS.textContent = TITLES[v][1] || '';
  }
  const isRound = v === 'round';
  const spine = $('#spine'), ringW = $('#ringW');
  if(spine) spine.style.display = isRound ? '' : 'none';
  if(ringW) ringW.style.display = isRound ? '' : 'none';
  if(v === 'round'){ rSpine(); rRound(); }
  else if(v === 'ward') rBoardView();
  else if(v === 'work') rWork();
}

/* ── round actions ── */
function openPatient(i){
  S.idx = i;
  if(S.view !== 'round') go('round');
  else{ rSpine(); rRound(); }
}
function advance(){
  S.seen.add(S.idx);
  for(let k = 1; k <= S.patients.length; k++){
    const c = (S.idx + k) % S.patients.length;
    if(!S.seen.has(c)){ S.idx = c; break; }
  }
  rSpine(); rRound();
}
function skip(){
  for(let k = 1; k <= S.patients.length; k++){
    const c = (S.idx + k) % S.patients.length;
    if(!S.seen.has(c)){ S.idx = c; break; }
  }
  rSpine(); rRound();
  toast('Skipped — still on the list');
}

/* ── writes back to the server ──
   Plan edits are debounced 600ms; milestone/discharge toggles push
   immediately. Both mutate the RAW record kept in S.raw (see loadWard's
   comment for why fetchWard's view models alone aren't enough), then
   call pushPatient() with that full raw record so the server's
   last-write-wins merge never sees a hole where a checklist used to be.
   A `{rejected:true}` response means the write was refused (out of the
   caller's scope) — surface it and re-fetch so the UI reflects the
   server's actual state rather than the rejected local edit. */
const planTimers = new Map();
function schedulePlanPush(i){
  const p = S.patients[i];
  if(!p) return;
  clearTimeout(planTimers.get(p.id));
  planTimers.set(p.id, setTimeout(() => {
    planTimers.delete(p.id);
    pushPlanNow(p.id);
  }, 600));
}
async function pushPlanNow(id){
  const rec = S.raw.get(id);
  const p = S.patients.find(x => x.id === id);
  if(!rec || !p) return;
  rec.dailyPlan = p.plan;
  rec.planUpdatedAt = Date.now();
  try{
    const out = await pushPatient(rec, FETCH);
    if(out?.rejected){ toast('Not saved — outside your scope'); render(); }
  }catch{ /* offline — local optimistic state stands until the next successful render() */ }
}
function copyYesterday(i){
  const p = S.patients[i];
  if(!p) return;
  p.plan = p.hist[0]?.[1] || '';
  (S.view === 'work' ? rWork : rRound)();
  toast("Yesterday's plan copied");
  schedulePlanPush(i);
}

function toggleCheck(kind, i, n){
  const p = S.patients[i];
  if(!p) return;
  const rec = S.raw.get(p.id);
  if(!rec) return;
  const list = kind === 'ck' ? (rec.postOpChecks || []) : (rec.dischargeChecks || []);
  const item = list[n];
  if(!item) return;
  item.status = item.status === 'done' ? 'pending' : 'done';
  S.patients[i] = toViewModel(rec, WIN);
  (S.view === 'work' ? rWork : rRound)();
  toast(kind === 'ck' ? 'Milestone updated' : 'Checklist updated');
  pushCheckNow(rec);
}
async function pushCheckNow(rec){
  try{
    const out = await pushPatient(rec, FETCH);
    if(out?.rejected){ toast('Not saved — outside your scope'); render(); }
  }catch{ /* offline — local optimistic state stands until the next successful render() */ }
}

/* ── events ── */
DOC.addEventListener('click', e => {
  const t = e.target;
  if(t.closest('[data-retry]')){ render(); return; }
  const o = t.closest('[data-open]'); if(o){ openPatient(+o.dataset.open); return; }
  const w = t.closest('[data-work]'); if(w){ S.work = +w.dataset.work; rWork(); return; }
  const ck = t.closest('[data-ck]'); if(ck){
    const [i, n] = ck.dataset.ck.split(':').map(Number); toggleCheck('ck', i, n); return;
  }
  const dc = t.closest('[data-dc]'); if(dc){
    const [i, n] = dc.dataset.dc.split(':').map(Number); toggleCheck('dc', i, n); return;
  }
  if(t.closest('[data-seen]')){ advance(); toast('Marked seen'); return; }
  if(t.closest('[data-skip]')){ skip(); return; }
  const cp = t.closest('[data-copy]'); if(cp){ copyYesterday(+cp.dataset.copy); return; }
  if(t.closest('[data-reset]')){ S.seen.clear(); S.idx = 0; rSpine(); rRound(); return; }
  const g = t.closest('[data-go]'); if(g){ go(g.dataset.go); return; }
  if(t.closest('#themeBtn')){ setTheme(DOC.documentElement.dataset.theme !== 'dark'); return; }
  /* data-act, data-film, data-vnav, data-pnav, data-pclose, data-prow,
     data-add, data-close, data-print, data-toast are palette/viewer/
     present/add-modal/documents concerns — tasks 7-9. Intentionally
     unhandled here: clicking them is a no-op, not a crash. */
});
DOC.addEventListener('input', e => {
  const p = e.target.dataset.plan;
  if(p === undefined) return;
  const i = +p;
  if(S.patients[i]){ S.patients[i].plan = e.target.value; schedulePlanPush(i); }
});
DOC.addEventListener('keydown', e => {
  if(e.key === 'Escape'){ closeAll(); return; }
  if(e.target?.matches?.('input,select,textarea')) return;
  if(e.shiftKey && e.key === 'D') setTheme(DOC.documentElement.dataset.theme !== 'dark');
});

let resizeTimer, lastWide = wide();
WIN.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if(wide() !== lastWide){ lastWide = wide(); if(S.view === 'round') rRound(); }
  }, 150);
});

if(WIN.matchMedia?.('(prefers-color-scheme: dark)')?.matches){
  DOC.documentElement.dataset.theme = 'dark';
}

window.__V2__ = { state: S, go, render };
