/* v2 preview app — state, event delegation, view switching for
   Round, Ward, Work, the three read-only documents (OT list, handover,
   discharged archive), the command palette, the film viewer, and
   presentation mode. Admin is out of scope for this file (Task 9); go()
   accepts its view name without throwing but renders nothing for it — a
   seam, not a stub — and it stays reachable from the rail and the
   palette per the design spec.

   The three documents are read-only: no write paths, no real
   export/Word generation. Their data-toast/data-print buttons are
   presentational hooks, wired here only to toast()/WIN.print(), exactly
   as they behave in docs/prototypes/ortho-v3.html (whose date input and
   search box are likewise static there — not wired to live filtering —
   so they're reproduced the same way).

   Markup for patient cards/rows/board tiles/work items/the completion
   screen comes exclusively from render.js's exports. The only markup
   written here is small orchestration glue that render.js has no
   builder for: the bed spine, section labels, and the round view's
   action bar.

   ── Why document/window/fetch are captured once, at module top level ──
   tests/helpers/v2-env.js's bootV2 swaps `document`/`window`/`fetch`
   (and friends) onto globalThis only for the duration of the import and
   the first render() — it restores the real Node globals in its
   `finally` right after render() resolves, and returns the booted
   `document`/`window` as plain object references. Test files then keep
   interacting with those returned references directly, e.g.
   `document.querySelector('[data-seen]').click()`, which happens well
   after bootV2 has returned and the global swap is long gone. A click
   dispatched that way still runs this module's `click` listener (it was
   attached to that exact jsdom document during import, so the DOM finds
   it regardless of globals), but if that listener's body resolved a
   bare `document`/`window`/`fetch` identifier at call time, it would
   hit whatever globalThis holds *then* — the restored, non-jsdom value
   — not the jsdom the test is holding a reference to. Capturing
   DOC/WIN/FETCH once, at the top of this module, during the narrow
   window while the swap is active, sidesteps that: every later call
   reads the closed-over jsdom reference instead of re-resolving a
   global. This is module-scope *object* capture, not module-scope
   *element* capture — `document.getElementById(...)` at top level is
   still avoided everywhere below; every element is queried inside a
   function, every time, via $()/$$(). Because bootV2 cache-busts this
   module's import URL on every call, each test gets a fresh module
   instance and thus a fresh, correct capture — there is no cross-test
   staleness. In a real browser this capture is a no-op simplification:
   window/document/fetch never change during a page's lifetime. fetch is
   additionally bound to its receiver because real browsers throw
   "Illegal invocation" if fetch is called detached from `window`. */
import { esc, hero, row, detail, board, workList, complete, otList, handover, discharged,
  paletteGroup, paletteNoMatch, paletteRow, viewerTitle, filmArt, presentSlide } from './render.js';
import { fetchWard, fetchDischarged, pushPatient, toViewModel, extractDefaultUnit } from './data.js';

const DOC = document;
const WIN = window;
const FETCH = window.fetch.bind(window);

const $ = s => DOC.querySelector(s);
const $$ = s => [...DOC.querySelectorAll(s)];
const wide = () => WIN.innerWidth >= 1100;

function todayISO(){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

const S = {
  view: 'round', idx: 0, seen: new Set(), work: 0,
  pr: 0,             // presentation-mode slide index, into S.patients
  vwP: null,         // film viewer: the current patient's film-kind list
                      // (or a single-item fallback) — null until a film
                      // is first opened; every reader guards with
                      // `S.vwP?.length` (the [data-vnav] click handler
                      // and the viewer's arrow-key handling in the
                      // keydown handler) before indexing into it
  vwI: 0,             // film viewer: index into S.vwP
  palSel: 0,          // command palette: selected row index
  palRows: [],        // command palette: the executable action list the
                      // palette renders and the keyboard drives — the
                      // Task 8 interface contract (state.palRows)
  patients: [],      // view models, from fetchWard() — never demo data
  raw: new Map(),    // id -> raw patient record, for safe pushPatient() writes
  serverTime: 0,
  pending: null,     // promise from the most recent in-flight write (plan or
                      // checklist push) — test-introspection only, so a test
                      // can `await api.state.pending` for the write to settle
                      // before asserting; app.js itself never awaits it.
  otDate: todayISO(),        // OT list date filter, live (Task 7 Fix
                              // round 1, Finding 3) — the date input's
                              // change event updates this and re-renders
                              // the OT view from S.patients; no new fetch
  defaultUnit: '',           // OT list unit filter (Task 7 Fix round 1,
                              // Finding 1) — extracted from the raw
                              // "__ward_meta__" sync record every
                              // loadWard() already fetches; see
                              // extractDefaultUnit() in data.js for
                              // exactly where this value comes from
  dischargedPatients: [],    // populated by loadDischarged(), a separate
                              // fetch — fetchWard() excludes discharged
                              // patients entirely, so the ward's own
                              // S.patients can never serve this view
  dischSearch: ''            // discharged-archive search term, live
                              // (Task 7 Fix round 1, Finding 3) — filters
                              // S.dischargedPatients client-side; no fetch
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

/* ── overlays: scrim/close-all seam ──
   closeAll() is the single Escape-key/backdrop-click destination for
   every overlay (palette, add modal, presentation mode, film viewer) —
   defined once here so each overlay's open path doesn't need its own
   Escape handling. */
function closeAll(){
  for(const sel of ['#scrim', '#pal', '#addM', '#present', '#viewer']){
    $(sel)?.classList.remove('on');
  }
}

/* ── command palette (Task 8) ──
   Ported from docs/prototypes/ortho-v3.html's rPal/markPal/runAct. The
   23-row ACT table is that prototype's ACT table verbatim — the design
   spec's §7 feature-to-surface map names the same 23 actions grouped
   the same way; the prototype is the literal, already-reviewed encoding
   of that map (group, label, view-key or 'toast'/'present'/'dark',
   shortcut hint, icon name). Actions with no v2 implementation carry the
   sentinel key 'toast' and always toast(label + ' — not in the preview
   build') from runAct() below, rather than failing silently or doing
   nothing. */
const ACT = [
  ['Most used','Presentation mode','present','⇧P','spark'],
  ['Most used','Generate handover','handover','⇧H','hand'],
  ['Most used','Morning brief','toast','','spark'],
  ['Most used','Check ward for risks','work','','check'],
  ['Documents','OT list','ot','','doc'],
  ['Documents','Handover sheet','handover','','doc'],
  ['Documents','Census','toast','','doc'],
  ['Documents','Discharged patients','disch','','out'],
  ['Documents','Export backup','toast','','doc'],
  ['Documents','Import backup','toast','','doc'],
  ['Ward','Ward board','ward','','board'],
  ['Ward','Bulk plan select','toast','','list'],
  ['Ward','Organize patients','toast','','list'],
  ['Ward','Unit handover note','toast','','hand'],
  ['Ward','PG roster','toast','','user'],
  ['Ward','Default unit','toast','','set'],
  ['Ward','Default OT doctors','toast','','user'],
  ['Ward','Templates','toast','','doc'],
  ['Settings','Consultant mode','toast','','user'],
  ['Settings','Reading room','dark','⇧D','moon'],
  ['Settings','Change password','toast','','set'],
  ['Settings','Admin console','admin','','set'],
  ['Settings','Refresh from server','toast','','set']
];

/* Views runAct() can go() straight to. Deliberately NOT the same object
   as TITLES below: TITLES only carries a header title/subtitle for
   views this task renders content for; 'admin' has no TITLES entry yet
   (Task 9 owns its header text and its rendered content) but must still
   be reachable as a destination from the palette per the design spec
   ("Admin console — Palette · rail"), so it is listed here regardless. */
const VIEW_KEYS = new Set(['round','ward','work','ot','handover','disch','admin']);

function rPal(q = ''){
  const t = q.trim().toLowerCase();
  let h = '';
  S.palRows = [];
  const add = (html, fn) => { S.palRows.push(fn); return html; };
  if(t){
    const pm = S.patients.map((p, i) => [p, i])
      .filter(([p]) => (p.name + ' ' + p.bed + ' ' + p.dx).toLowerCase().includes(t));
    if(pm.length){
      h += paletteGroup('Patients') + pm.map(([p, i]) => add(
        paletteRow('user', p.name, 'bed ' + p.bed, S.palRows.length),
        () => { openPatient(i); closePal(); }
      )).join('');
    }
    const am = ACT.filter(a => a[1].toLowerCase().includes(t));
    if(am.length){
      h += paletteGroup('Actions') + am.map(a => add(
        paletteRow(a[4], a[1], a[3], S.palRows.length),
        () => runAct(a)
      )).join('');
    }
    if(!S.palRows.length) h = paletteNoMatch(q.trim());
  }else{
    for(const g of ['Most used', 'Documents', 'Ward', 'Settings']){
      h += paletteGroup(g) + ACT.filter(a => a[0] === g).map(a => add(
        paletteRow(a[4], a[1], a[3], S.palRows.length),
        () => runAct(a)
      )).join('');
    }
  }
  $('#palL').innerHTML = h;
  S.palSel = 0;
  markPal();
}
function markPal(){
  const rows = $$('#palL .pi');
  rows.forEach((e, n) => e.classList.toggle('sel', n === S.palSel));
  rows[S.palSel]?.scrollIntoView?.({ block: 'nearest' });
}
function runAct(a){
  const k = a[2];
  closePal();
  if(k === 'present'){ S.pr = 0; rPresent(); $('#present').classList.add('on'); }
  else if(k === 'dark') setTheme(DOC.documentElement.dataset.theme !== 'dark');
  else if(VIEW_KEYS.has(k)) go(k);
  else toast(a[1] + ' — not in the preview build');
}
function openPal(){
  $('#pal').classList.add('on');
  $('#scrim').classList.add('on');
  $('#palIn').value = '';
  rPal();
  setTimeout(() => $('#palIn')?.focus(), 80);
}
function closePal(){
  $('#pal').classList.remove('on');
  $('#scrim').classList.remove('on');
}

/* ── film viewer (Task 8) ──
   Ported from the prototype's openViewer/rViewer. S.vwP/S.vwI are the
   MUST FIX carried forward from Task 6 (a controller-flagged
   requirement): every reader of S.vwP — the [data-vnav] click handler
   below and the viewer's arrow-key handling in the keydown handler —
   guards with `S.vwP?.length` before indexing into it, since S.vwP is
   null until a film is first opened (clicking a viewer arrow, or
   pressing an arrow key, before that must be inert, not a crash). */
function openViewer(pi, k){
  const p = S.patients[pi];
  const list = (p && p.films.length) ? p.films : [k];
  S.vwP = list;
  S.vwI = Math.max(0, list.indexOf(k));
  rViewer();
  $('#viewer').classList.add('on');
}
function rViewer(){
  const k = S.vwP[S.vwI];
  $('#vwF').innerHTML = filmArt(k) || '';
  $('#vwT').innerHTML = viewerTitle(k, S.vwI, S.vwP.length);
}

/* ── presentation mode (Task 8) ──
   Ported from the prototype's rPresent. Handles a patient with no film
   via render.js's presentSlide(), which renders a `.pr-f.none`
   placeholder — never an empty black box with no indication (design
   spec §5). Also guards against an empty ward (S.patients.length === 0),
   which the prototype does not need to since it always has demo data. */
function rPresent(){
  const p = S.patients[S.pr];
  if(!p) return;
  $('#prC').textContent = `${S.pr + 1} of ${S.patients.length}`;
  $('#prB').innerHTML = presentSlide(p);
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
   records, keyed by id, from one request.

   Monotonic guard: `loadSeq` is bumped at the START of every loadWard()
   call (render()'s calls included, not just the write path's). If a
   newer call has already started by the time an older call's response
   lands, the older call's snapshot is NOT applied to S.raw/S.patients —
   an in-flight response only reflects state as of when the request was
   made, so an older request that resolves late must never clobber
   whatever a request that started later already wrote. This complements
   the write queue below (which is the actual fix for the interleaving
   finding — see "Fix round 3" in task-6-report.md); it does not replace
   it. On its own this guard would not have prevented the finding, since
   both write cycles restart their OWN loadWard() after the fact, each
   correctly becoming "the newest call" by the time it fires — the queue
   is what stops a second write cycle from starting at all while the
   first is still in flight. */
let loadSeq = 0;
async function loadWard(){
  const mySeq = ++loadSeq;
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
  if(mySeq === loadSeq && rawSnapshot && Array.isArray(rawSnapshot.patients)){
    S.raw = new Map(rawSnapshot.patients.map(p => [p.id, p]));
    // Task 7 Fix round 1, Finding 1: the default-unit record rides along
    // in this same raw response (see extractDefaultUnit()'s doc comment
    // in data.js for exactly where it comes from) — no extra fetch.
    S.defaultUnit = extractDefaultUnit(rawSnapshot.patients);
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

/* ── documents (Task 7): OT list, handover, discharged archive ──
   All three are read-only — no write paths, no real export/Word
   generation. The OT list and handover sheet render straight off
   S.patients (already loaded by loadWard()/render()); the discharged
   archive needs its own fetch, since fetchWard() filters discharged
   patients OUT.

   rOT()/rDisch() are called both from go() (initial view entry) and
   from the change/input handlers below (Fix round 1, Finding 3) — every
   call re-derives from already-loaded state (S.patients/S.otDate/
   S.defaultUnit, or S.dischargedPatients/S.dischSearch), never issuing a
   fetch of its own. */
function rOT(){
  const el = $('#otP');
  if(el) el.innerHTML = otList(S.patients, S.otDate, S.defaultUnit);
}

function handoverWhen(){
  const d = new Date();
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function rHandover(){
  const el = $('#hoP');
  if(el) el.innerHTML = handover(S.patients, { when: handoverWhen(), to: 'the on-call team' });
}

/* Re-rendering #dcP on every keystroke (Fix round 1, Finding 3) replaces
   the search input's own DOM node — which would otherwise drop focus and
   cursor position after each character, making the box effectively
   untypeable. Save/restore both around the innerHTML swap so typing
   feels continuous; discharged() is told the CURRENT search term so the
   freshly-built input's `value` reflects what was just typed rather than
   reverting to empty. */
function rDisch(){
  const el = $('#dcP');
  if(!el) return;
  const active = DOC.activeElement;
  const restoreFocus = !!(active && el.contains(active) && active.tagName === 'INPUT');
  const selStart = restoreFocus ? active.selectionStart : null;
  const selEnd = restoreFocus ? active.selectionEnd : null;
  el.innerHTML = discharged(S.dischargedPatients, S.dischSearch);
  if(restoreFocus){
    const input = el.querySelector('input');
    if(input){
      input.focus();
      if(selStart != null && typeof input.setSelectionRange === 'function'){
        try{ input.setSelectionRange(selStart, selEnd); }catch{ /* not all input types support it */ }
      }
    }
  }
}
/* Fetches independently of loadWard()/render() — fetchDischarged() hits
   the same /api/sync endpoint but keeps ONLY discharged patients, the
   inverse of what fetchWard() keeps, so it cannot be derived from
   S.patients. Re-fetched every time the discharged view is opened (this
   is a read-only preview document, not a high-traffic path); a failed
   fetch leaves the previous list on screen rather than clearing it, and
   only re-renders if the user is still on the discharged view by the
   time it resolves (they may have navigated away). */
async function loadDischarged(){
  try{
    const data = await fetchDischarged(FETCH, WIN);
    S.dischargedPatients = data.patients;
  }catch{
    /* leave S.dischargedPatients as whatever it already was */
  }
  if(S.view === 'disch') rDisch();
}

/* ── view switching ──
   admin/the palette/the viewer/presentation/the add modal are accepted
   (the shell declares #v-admin etc. per Task 2) but deliberately render
   nothing — that's tasks 8 and 9. */
const TITLES = {
  round: ['Morning round', null], ward: ['Ward board', null], work: ['Work', 'What needs doing today'],
  ot: ['OT list', null], handover: ['Handover', null], disch: ['Discharged', null]
};
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
  else if(v === 'ot') rOT();
  else if(v === 'handover') rHandover();
  else if(v === 'disch'){ rDisch(); loadDischarged(); }
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
   immediately. Both re-fetch the ward via loadWard() right before
   building the payload, then apply the single edit on top of that
   FRESH raw record and push it — never the snapshot captured at boot
   or at the last render(). This matters because merge.js's
   mergePatientRecords takes its full-replace branch for
   postOpChecks/dischargeChecks whenever the pushed record's
   updatedAt is >= the server's — true for essentially every v2 write,
   since pushPatient() always stamps Date.now(). Sending a stale
   postOpChecks/dischargeChecks array in that push would silently wipe
   out any edit another clinician made against the SAME record after
   this tab's last fetch (e.g. via the main app at `/`), with no error
   and no toast to either clinician. The extra round trip (one
   /api/sync call to refresh, before the one that actually writes) is
   the deliberate cost of never resending a stale array; see
   task-6-report.md, "Fix round 2", for why a refresh-after-write-only
   strategy doesn't close this hole.

   Every checklist item that's toggled is also stamped with its own
   `updatedAt`, exactly as `touchChecklistItem` in public/app.js does
   (`c.updatedAt = Date.now()`) — this is what lets merge.js's
   mergeChecklistById resolve item-by-item on the rare occasions the
   full-replace branch doesn't fire, instead of v2's edits always
   losing because their item updatedAt was 0/absent.

   A `{rejected:true}` response means the write was refused (out of the
   caller's scope) — surface it and re-fetch via render() so the UI
   reflects the server's actual state rather than the rejected local
   edit. A THROWN error (network failure, as opposed to a defined
   rejection) must never look like success: no success toast fires in
   that case, and the specific optimistic edit is reverted in place —
   on the fresh record if the write itself failed, or on the original
   pre-refresh record if even the refresh couldn't reach the server —
   so the UI stops claiming a state the server does not have.

   ── Write queue (Fix round 3) ──
   Refresh-before-write (above) closes the CROSS-CLIENT staleness hole,
   but by itself it introduced a new same-client hole: two overlapping
   write cycles for the SAME patient each do their own
   `loadWard() -> mutate -> pushPatient()`, and nothing stops those two
   async cycles from interleaving. Whichever cycle's `loadWard()` happens
   to resolve LAST wins the write, regardless of which click happened
   first or which push actually reached the server last — because that
   cycle's "fresh" snapshot was taken before the other cycle's push
   landed, and it silently replaces the whole postOpChecks/
   dischargeChecks array, reverting the other cycle's edit. See
   task-6-report.md, "Fix round 3", for the exact reproduction.

   Fixed by serialising every write through one promise chain
   (`writeChain`) so a write's `loadWard() -> mutate -> pushPatient()` is
   atomic with respect to every other write: the next write's body does
   not even START running until the previous one has fully settled.
   Chosen scope: GLOBAL, not per-patient. A ward round's write volume is
   low (one clinician, one tab, occasional checkbox/plan edits — this is
   a preview, not a high-throughput multi-user editor), so cross-patient
   writes queueing behind each other costs, at most, a few hundred
   milliseconds of extra latency on an already-network-bound path; a
   global chain is far simpler to reason about and verify than a
   per-patient `Map<id, Promise>` for that trade. `enqueueWrite` never
   lets a rejected/thrown write poison the chain: the continuation that
   becomes the new `writeChain` always resolves (via `.then(noop, noop)`
   on the just-run write), so the write's own try/catch — which already
   handles the thrown-vs-{rejected:true} distinction — still runs
   exactly as before; only the SCHEDULING is serialised, not the
   per-write error handling. */
function touchChecklistItem(c){
  c.updatedAt = Date.now();
  return c;
}

let writeChain = Promise.resolve();
function enqueueWrite(fn){
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => {}, () => {});
  return run;
}

const planTimers = new Map();
function schedulePlanPush(i){
  const p = S.patients[i];
  if(!p) return;
  clearTimeout(planTimers.get(p.id));
  planTimers.set(p.id, setTimeout(() => {
    planTimers.delete(p.id);
    S.pending = enqueueWrite(() => pushPlanNow(p.id));
  }, 600));
}
async function pushPlanNow(id){
  const staleRec = S.raw.get(id);
  const p = S.patients.find(x => x.id === id);
  if(!staleRec || !p) return;
  const pendingPlan = p.plan;
  let freshRec, prevPlan = staleRec.dailyPlan;
  try{
    await loadWard();
    freshRec = S.raw.get(id);
    if(!freshRec){ toast('Not saved — patient no longer on this ward'); await render(); return; }
    prevPlan = freshRec.dailyPlan;
    freshRec.dailyPlan = pendingPlan;
    freshRec.planUpdatedAt = Date.now();
    const out = await pushPatient(freshRec, FETCH);
    if(out?.rejected){ toast('Not saved — outside your scope'); await render(); return; }
  }catch{
    if(freshRec) freshRec.dailyPlan = prevPlan;
    const idx = S.patients.findIndex(x => x.id === id);
    if(idx > -1){
      S.patients[idx].plan = prevPlan;
      (S.view === 'work' ? rWork : rRound)();
    }
    toast('Not saved — check your connection');
  }
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
  const itemId = item.id;
  const optimisticPrevStatus = item.status;
  const optimisticPrevUpdatedAt = item.updatedAt;
  /* Immediate optimistic flip for a responsive checkbox — provisional
     only. pushCheckNow() re-fetches, re-applies this same toggle onto
     the FRESH server record, and either confirms it with a success
     toast or reverts it. This local flip alone never earns a toast. */
  item.status = item.status === 'done' ? 'pending' : 'done';
  S.patients[i] = toViewModel(rec, WIN);
  (S.view === 'work' ? rWork : rRound)();
  S.pending = enqueueWrite(() => pushCheckNow(kind, p.id, itemId, {
    rec, prevStatus: optimisticPrevStatus, prevUpdatedAt: optimisticPrevUpdatedAt
  }));
}
async function pushCheckNow(kind, patientId, itemId, optimistic){
  let flipped = null, prevStatus, prevUpdatedAt, freshRec;
  try{
    await loadWard();
    freshRec = S.raw.get(patientId);
    if(!freshRec){ toast('Not saved — patient no longer on this ward'); await render(); return; }
    const list = kind === 'ck' ? (freshRec.postOpChecks || []) : (freshRec.dischargeChecks || []);
    const item = list.find(c => c && c.id === itemId);
    if(!item){ toast('Not saved — item no longer exists'); await render(); return; }
    prevStatus = item.status;
    prevUpdatedAt = item.updatedAt;
    item.status = item.status === 'done' ? 'pending' : 'done';
    touchChecklistItem(item);
    flipped = item;
    const pi = S.patients.findIndex(x => x.id === patientId);
    if(pi > -1) S.patients[pi] = toViewModel(freshRec, WIN);
    (S.view === 'work' ? rWork : rRound)();

    const out = await pushPatient(freshRec, FETCH);
    if(out?.rejected){ toast('Not saved — outside your scope'); await render(); return; }
    toast(kind === 'ck' ? 'Milestone updated' : 'Checklist updated');
  }catch{
    /* The write (or the refresh that precedes it) failed. Revert whichever
       record actually got mutated: the FRESH one if we got far enough to
       refresh and flip it, otherwise the original pre-refresh record from
       toggleCheck's optimistic edit — either way, the UI must stop
       claiming a state the server does not have. */
    const recForView = flipped ? freshRec : optimistic.rec;
    if(flipped){
      flipped.status = prevStatus;
      flipped.updatedAt = prevUpdatedAt;
    }else{
      const list = kind === 'ck' ? (recForView.postOpChecks || []) : (recForView.dischargeChecks || []);
      const original = list.find(c => c && c.id === itemId);
      if(original){
        original.status = optimistic.prevStatus;
        original.updatedAt = optimistic.prevUpdatedAt;
      }
    }
    const pi = S.patients.findIndex(x => x.id === patientId);
    if(pi > -1) S.patients[pi] = toViewModel(recForView, WIN);
    (S.view === 'work' ? rWork : rRound)();
    toast('Not saved — check your connection');
  }
}

/* ── events ── */
DOC.addEventListener('click', e => {
  const t = e.target;
  if(t.closest('[data-retry]')){ render(); return; }
  const f = t.closest('[data-film]'); if(f){
    const [pi, k] = f.dataset.film.split(':'); openViewer(+pi, k); return;
  }
  if(t.closest('[data-vclose]')){ $('#viewer').classList.remove('on'); return; }
  const vn = t.closest('[data-vnav]'); if(vn){
    if(!S.vwP?.length) return; // MUST FIX (Task 6 carry-forward): guard before indexing
    S.vwI = (S.vwI + +vn.dataset.vnav + S.vwP.length) % S.vwP.length;
    rViewer();
    return;
  }
  const pn = t.closest('[data-pnav]'); if(pn){
    if(!S.patients.length) return;
    S.pr = (S.pr + +pn.dataset.pnav + S.patients.length) % S.patients.length;
    rPresent();
    return;
  }
  if(t.closest('[data-pclose]')){ $('#present').classList.remove('on'); return; }
  const pr = t.closest('[data-prow]'); if(pr){ S.palRows[+pr.dataset.prow]?.(); return; }
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
  if(t.closest('[data-print]')){ WIN.print?.(); return; }
  const ts = t.closest('[data-toast]'); if(ts){ toast(ts.dataset.toast); return; }
  /* data-add: the "Add patient" button inside the new-admission modal.
     This preview has no real admission write path (design spec's "Out
     of scope" list — image upload/AI extraction is explicitly deferred),
     so it closes the modal and toasts, exactly as the prototype does. */
  if(t.closest('[data-add]')){ closeAll(); toast('Patient added to the ward'); return; }
  if(t.closest('[data-close]') || t.id === 'scrim'){ closeAll(); return; }
  const a = t.closest('[data-act]'); if(a){
    const k = a.dataset.act;
    if(k === 'pal'){ $('#pal').classList.contains('on') ? closePal() : openPal(); }
    else if(k === 'add'){ $('#addM').classList.add('on'); $('#scrim').classList.add('on'); }
    return;
  }
});
DOC.addEventListener('input', e => {
  /* Command palette: filter as the clinician types (Task 8). Checked
     first/returned early, same pattern as the discharged-search branch
     below, so it can't be shadowed by the dataset.plan branch. */
  if(e.target.id === 'palIn'){ rPal(e.target.value); return; }
  /* Fix round 1, Finding 3: the discharged search box filters
     S.dischargedPatients client-side, live as the clinician types — no
     fetch. Checked first/returned early so it can't be shadowed by the
     dataset.plan branch below (a plain <input>, not a .pin, never has
     dataset.plan, but keeping the branches mutually exclusive avoids any
     future ambiguity). */
  if(e.target.matches('#dcP input')){
    S.dischSearch = e.target.value || '';
    rDisch();
    return;
  }
  const p = e.target.dataset.plan;
  if(p === undefined) return;
  const i = +p;
  if(S.patients[i]){ S.patients[i].plan = e.target.value; schedulePlanPush(i); }
});
/* Fix round 1, Finding 3: the OT date input re-renders the OT list for
   the newly-picked date from already-loaded S.patients — no fetch.
   `change` (not `input`) fires once the date is actually committed,
   avoiding a re-render — and a rebuilt, refocus-losing input — on every
   intermediate keystroke while a clinician is still typing the digits of
   a partial date. */
DOC.addEventListener('change', e => {
  if(e.target.matches('#otP input[type="date"]')){
    S.otDate = e.target.value || todayISO();
    rOT();
  }
});
/* Full keydown handler, ported from the prototype (Task 8). Order matters:
   ⌘K/Ctrl+K and Escape are checked first, unconditionally, so they work
   regardless of focus (including while typing in the palette's own
   search input). Palette navigation is checked next (only while the
   palette is open), then the film viewer's arrow-key navigation (MUST
   FIX, Task 6 carry-forward: guarded with `S.vwP?.length` before
   indexing into it — the viewer is null until a film is first opened,
   and an arrow key before that must be inert, not a crash), then
   presentation mode's arrow-key navigation. Only after all of those is
   focus-in-a-form-field checked, so the single-letter shortcuts below
   (⇧P/⇧D/⇧H) never fire while a clinician is typing a plan or a search
   term. */
DOC.addEventListener('keydown', e => {
  const palOn = $('#pal').classList.contains('on');
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'){
    e.preventDefault();
    palOn ? closePal() : openPal();
    return;
  }
  if(e.key === 'Escape'){ closeAll(); return; }
  if(palOn){
    if(e.key === 'ArrowDown'){ e.preventDefault(); S.palSel = Math.min(S.palSel + 1, S.palRows.length - 1); markPal(); }
    if(e.key === 'ArrowUp'){ e.preventDefault(); S.palSel = Math.max(S.palSel - 1, 0); markPal(); }
    if(e.key === 'Enter'){ e.preventDefault(); S.palRows[S.palSel]?.(); }
    return;
  }
  if($('#viewer').classList.contains('on') && S.vwP?.length){
    if(e.key === 'ArrowRight'){ S.vwI = (S.vwI + 1) % S.vwP.length; rViewer(); }
    if(e.key === 'ArrowLeft'){ S.vwI = (S.vwI - 1 + S.vwP.length) % S.vwP.length; rViewer(); }
    return;
  }
  if($('#present').classList.contains('on')){
    if(!S.patients.length) return;
    if(e.key === 'ArrowRight'){ S.pr = (S.pr + 1) % S.patients.length; rPresent(); }
    if(e.key === 'ArrowLeft'){ S.pr = (S.pr - 1 + S.patients.length) % S.patients.length; rPresent(); }
    return;
  }
  if(e.target?.matches?.('input,select,textarea')) return;
  if(e.shiftKey && e.key === 'P'){ S.pr = 0; rPresent(); $('#present').classList.add('on'); }
  if(e.shiftKey && e.key === 'D') setTheme(DOC.documentElement.dataset.theme !== 'dark');
  if(e.shiftKey && e.key === 'H') go('handover');
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
