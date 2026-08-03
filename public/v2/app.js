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
  paletteGroup, paletteNoMatch, paletteRow, viewerTitle, filmArt, presentSlide } from './render.js?v=6';
import { fetchWard, fetchDischarged, pushPatient, toViewModel, extractDefaultUnit, authToken } from './data.js?v=6';

/* Bump alongside the ?v= stamps in index.html. Printed at boot and shown
   in the failure state, so "which build is actually live?" is answerable
   in one second instead of by inference. */
const BUILD = 'v6';

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
  if(!p){
    /* An empty ward previously returned here untouched, leaving the
       shell's literal placeholder counter ("1 of 8", public/v2/
       index.html — off limits, so it is overwritten from here) sitting
       over a blank black slide. Say so instead. */
    const c = $('#prC'), b = $('#prB');
    if(c) c.textContent = `0 of ${S.patients.length}`;
    if(b) b.innerHTML = `<p class="empty">No patients on this ward yet.</p>`;
    return;
  }
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
   first is still in flight.

   ── Why this returns its own snapshot (final review, B5) ──
   The seq guard deliberately declines to publish a superseded snapshot
   into the SHARED S.raw. A write that then read S.raw to build its
   payload could therefore pick up a boot-era map — the superseding load
   need not have resolved yet — and push it, inverting the clinician's
   own toggle AND dropping another clinician's milestone via merge.js's
   full replace, while still toasting success. So loadWard returns
   `{ data, raw }`: `raw` is the map built from THIS call's own response,
   always, whether or not it was current enough to publish. Writes build
   their payload from that returned map and never re-read shared state;
   only the publishing of S.raw/S.defaultUnit stays gated by the guard,
   which is what the guard was for. Removing the guard instead would
   re-open the hole it was added to close (an older response clobbering a
   newer one), so it stays. */
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
  const hasRaw = !!(rawSnapshot && Array.isArray(rawSnapshot.patients));
  const raw = hasRaw ? new Map(rawSnapshot.patients.map(p => [p.id, p])) : new Map();
  if(mySeq === loadSeq && hasRaw){
    S.raw = raw;
    // Task 7 Fix round 1, Finding 1: the default-unit record rides along
    // in this same raw response (see extractDefaultUnit()'s doc comment
    // in data.js for exactly where it comes from) — no extra fetch.
    S.defaultUnit = extractDefaultUnit(rawSnapshot.patients);
  }
  return { data, raw, current: mySeq === loadSeq };
}

async function render(){
  let data;
  try{
    ({ data } = await loadWard());
  }catch(err){
    /* Log it. Swallowing this is how a real failure spent a whole round
       of debugging looking like an empty ward: the user saw a generic
       "couldn't reach the server" and the console said nothing. */
    try{ (WIN.console || console).error('[v2] ward load failed:', err); }catch{}
    /* Say WHICH failure this is, on screen, without needing DevTools.
       "Login required" from the server covers both "no Authorization
       header was sent" and "the token was rejected" — but the client
       knows which, because it knows whether it had a token to send. */
    const is401 = /401|not signed in/.test(String(err && err.message));
    const hadToken = !!authToken(WIN.localStorage);
    let msg, hint;
    if(is401 && !hadToken){
      msg = 'You are not signed in on this browser.';
      hint = 'Open the main app, log in, then come back and reload.';
    }else if(is401){
      msg = 'Your session was rejected.';
      hint = 'The saved sign-in has expired. Log in again on the main app, then reload.';
    }else{
      msg = "Couldn't reach the server.";
      hint = String((err && err.message) || '');
    }
    $('#roundList').innerHTML =
      `<div class="empty" style="text-align:center;padding:var(--s-7) var(--s-4)">
   <p style="font-weight:500">${esc(msg)}</p>
   <p style="font-size:var(--t-12);color:var(--ink-3);max-width:38ch;margin:6px auto 14px">${esc(hint)}</p>
   <p style="display:flex;gap:9px;justify-content:center">
     <a class="btn gh" href="/">Open the main app</a>
     <button class="btn gh" data-retry="1">Retry</button></p>
   <p style="font-size:var(--t-11);color:var(--ink-3);margin-top:16px">preview build ${esc(BUILD)} · signed in: ${hadToken ? 'yes' : 'no'}</p>
   </div>`;
    /* Clear the detail pane too. Leaving it up left a plan input and a
       row of checkboxes wired to state that just failed to refresh —
       live-looking controls whose next click would write against a
       stale record (and whose click was itself B5's trigger). The retry
       button in #roundList is the only thing left to press. */
    const det = $('#roundDet');
    if(det) det.innerHTML = '';
    return;
  }
  S.patients = data.patients;
  /* Carry un-pushed plan text across a full refresh too (B2). These view
     models come straight from fetchWard(), not from vmFor(), so without
     this a render() triggered mid-edit — by a rejected write, or by the
     retry button — would blank the clinician's input under them. The
     text is still owed to the server either way; pendingPlans is what
     the debounced write reads. */
  if(pendingPlans.size){
    for(const v of S.patients){
      if(pendingPlans.has(v.id)) v.plan = pendingPlans.get(v.id);
    }
  }
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

function rAdmin(){
  $('#adP').innerHTML = `
  <div class="card" style="max-width:520px">
    <p class="lbl">Admin console</p>
    <p class="empty">The admin console is not part of this preview.
      It opens in the current app, using the same login.</p>
    <a class="btn gh" href="/" style="display:inline-flex;margin-top:var(--s-3)">
      Open admin console</a>
  </div>`;
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
  else if(v === 'admin') rAdmin();
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
let writesInFlight = 0;
function enqueueWrite(fn){
  writesInFlight++;
  const run = writeChain.then(fn, fn);
  /* The chain continuation must still be the poison-proof
     `.then(noop, noop)` — the counter is decremented on a SEPARATE
     branch so it can never change how a rejection propagates to the
     write's own try/catch. */
  writeChain = run.then(() => {}, () => {});
  const settled = () => { writesInFlight--; markSync(); };
  run.then(settled, settled);
  markSync();
  return run;
}

/* ── un-pushed local edits (final review, B2) ──
   A plan edit lives only on the view model until its 600ms debounce
   fires. Every checklist write rebuilds that view model from the raw
   record and re-renders — which discarded the typed text, blanked the
   input under the clinician, and then let the debounced write push the
   empty string over their plan.

   pendingPlans is the authoritative store for text a clinician has typed
   but v2 has not yet written. vmFor() re-applies it on top of every
   rebuilt view model, so no re-render — from a checklist toggle, a
   failed write's revert, or anything else — can drop it. An entry is
   cleared only once the server has accepted exactly that text (or the
   edit has been explicitly reverted).

   Deliberately NOT solved by flushing the pending plan write ahead of a
   checklist write: that would start a second write cycle from inside the
   first, which is exactly the interleaving the Fix-round-3 write queue
   exists to prevent. Ordering is unchanged — the checklist write goes
   first, the debounced plan write follows through the same queue, and
   each refreshes before it builds its payload. */
const pendingPlans = new Map();
function vmFor(rec){
  const vm = toViewModel(rec, WIN);
  if(pendingPlans.has(vm.id)) vm.plan = pendingPlans.get(vm.id);
  return vm;
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
  markSync();
}
async function pushPlanNow(id){
  const staleRec = S.raw.get(id);
  const p = S.patients.find(x => x.id === id);
  if(!staleRec || !p) return;
  /* The pending store, not the view model, is the source of truth for
     un-pushed text — the view model may have been rebuilt since. */
  const pendingPlan = pendingPlans.has(id) ? pendingPlans.get(id) : p.plan;
  let freshRec, prevPlan = staleRec.dailyPlan, prevPlanDate = staleRec.dailyPlanDate;
  try{
    const { raw } = await loadWard();
    freshRec = raw.get(id);
    if(!freshRec){ toast('Not saved — patient no longer on this ward'); await render(); return; }
    prevPlan = freshRec.dailyPlan;
    prevPlanDate = freshRec.dailyPlanDate;
    freshRec.dailyPlan = pendingPlan;
    /* dailyPlanDate is what the main app at `/` stamps
       (public/app.js:1205) and reads (public/app.js:4398's
       hasPlanToday). v2 stamped only planUpdatedAt, which public/app.js
       never sets — so v2's stamp always won merge.js:68-77's comparison
       and merge.js then assigned `merged.dailyPlanDate = undefined`,
       after which the main app reported the patient as "No plan entered
       for today" even though the plan text had just been updated. Both
       fields are stamped together, exactly as public/app.js does. */
    freshRec.dailyPlanDate = todayISO();
    freshRec.planUpdatedAt = Date.now();
    const out = await pushPatient(freshRec, FETCH);
    if(out?.rejected){ toast('Not saved — outside your scope'); await render(); return; }
    /* Accepted. Stop treating this text as un-pushed — unless the
       clinician has typed further since this write was built, in which
       case a later write still owes the server that newer text. */
    if(pendingPlans.get(id) === pendingPlan) pendingPlans.delete(id);
  }catch{
    if(freshRec){
      freshRec.dailyPlan = prevPlan;
      freshRec.dailyPlanDate = prevPlanDate;
    }
    pendingPlans.delete(id);
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
  pendingPlans.set(p.id, p.plan);
  (S.view === 'work' ? rWork : rRound)();
  toast("Yesterday's plan copied");
  schedulePlanPush(i);
}

/* Resolves a checklist item by the STABLE key render.js put in the
   data-ck/data-dc attribute — the item's own id. Positional addressing
   was B1: S.raw is replaced by every write's loadWard() without the
   patient being re-rendered, so `list[n]` drifted onto whatever item
   occupied slot n in the NEWER record, and a click on the row labelled
   "Weight bearing" pushed "Suture removal → done" with a success toast.

   The numeric fallback exists only for records whose items carry no id
   at all (data.js emits the position as the key for those). Real records
   always have one — public/milestones.js's normalizePostOpItem assigns
   `chk_<ts>_<rand>` — and an id match is always tried first, so an id
   that happens to look numeric still resolves as an id. */
function findChecklistItem(list, key){
  const byId = list.find(c => c && c.id != null && String(c.id) === key);
  if(byId) return byId;
  return /^\d+$/.test(key) ? list[Number(key)] : undefined;
}

function toggleCheck(kind, i, key){
  const p = S.patients[i];
  if(!p) return;
  const rec = S.raw.get(p.id);
  if(!rec) return;
  const list = kind === 'ck' ? (rec.postOpChecks || []) : (rec.dischargeChecks || []);
  const item = findChecklistItem(list, key);
  if(!item) return;
  const itemId = item.id != null ? String(item.id) : key;
  const optimisticPrevStatus = item.status;
  const optimisticPrevUpdatedAt = item.updatedAt;
  /* Immediate optimistic flip for a responsive checkbox — provisional
     only. pushCheckNow() re-fetches, re-applies this same toggle onto
     the FRESH server record, and either confirms it with a success
     toast or reverts it. This local flip alone never earns a toast. */
  item.status = item.status === 'done' ? 'pending' : 'done';
  S.patients[i] = vmFor(rec);
  (S.view === 'work' ? rWork : rRound)();
  S.pending = enqueueWrite(() => pushCheckNow(kind, p.id, itemId, {
    rec, prevStatus: optimisticPrevStatus, prevUpdatedAt: optimisticPrevUpdatedAt
  }));
}
async function pushCheckNow(kind, patientId, itemId, optimistic){
  let flipped = null, prevStatus, prevUpdatedAt, freshRec;
  try{
    /* B5: build the payload from THIS refresh's own snapshot, never from
       the shared S.raw, which a concurrent load may have left holding an
       older map. */
    const { raw } = await loadWard();
    freshRec = raw.get(patientId);
    if(!freshRec){ toast('Not saved — patient no longer on this ward'); await render(); return; }
    const list = kind === 'ck' ? (freshRec.postOpChecks || []) : (freshRec.dischargeChecks || []);
    const item = findChecklistItem(list, itemId);
    if(!item){ toast('Not saved — item no longer exists'); await render(); return; }
    prevStatus = item.status;
    prevUpdatedAt = item.updatedAt;
    item.status = item.status === 'done' ? 'pending' : 'done';
    touchChecklistItem(item);
    flipped = item;
    const pi = S.patients.findIndex(x => x.id === patientId);
    if(pi > -1) S.patients[pi] = vmFor(freshRec);
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
      const original = findChecklistItem(list, itemId);
      if(original){
        original.status = optimistic.prevStatus;
        original.updatedAt = optimistic.prevUpdatedAt;
      }
    }
    const pi = S.patients.findIndex(x => x.id === patientId);
    if(pi > -1) S.patients[pi] = vmFor(recForView);
    (S.view === 'work' ? rWork : rRound)();
    toast('Not saved — check your connection');
  }
}

/* ── events ── */
/* "<patient index>:<checklist item id>" -> [index, id]. */
function splitControl(value){
  const s = String(value ?? '');
  const j = s.indexOf(':');
  return j < 0 ? [Number(s), ''] : [Number(s.slice(0, j)), s.slice(j + 1)];
}

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
  /* "<patient index>:<item id>". Split on the FIRST colon only — the
     patient index can never contain one, but an item id might. */
  const ck = t.closest('[data-ck]'); if(ck){ toggleCheck('ck', ...splitControl(ck.dataset.ck)); return; }
  const dc = t.closest('[data-dc]'); if(dc){ toggleCheck('dc', ...splitControl(dc.dataset.dc)); return; }
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
  if(S.patients[i]){
    S.patients[i].plan = e.target.value;
    /* Record it as un-pushed (B2) so any re-render before the debounce
       fires — a checklist toggle's, most commonly — carries it forward
       instead of blanking the input and then writing an empty string. */
    pendingPlans.set(S.patients[i].id, e.target.value);
    schedulePlanPush(i);
  }
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

/* ── unsaved work on tab close ──
   A plan edit is only written 600ms after the last keystroke, and a
   write can still be in flight after that. Closing the tab in either
   window silently discarded the edit with nothing on screen to suggest
   anything was outstanding. Three things count as unsaved: text typed
   but not yet debounced (a live planTimers entry), text debounced but
   not yet accepted by the server (a pendingPlans entry), and any write
   still queued or in flight. `dirty()` is also what drives the header's
   sync indicator, so the state is visible before the tab is closed, not
   only in the browser's confirm dialog. */
function dirty(){
  return planTimers.size > 0 || pendingPlans.size > 0 || writesInFlight > 0;
}
function markSync(){
  const el = $('#sync');
  if(el) el.innerHTML = dirty() ? '<i></i>Saving…' : '<i></i>Synced';
}
WIN.addEventListener('beforeunload', e => {
  if(!dirty()) return;
  e.preventDefault();
  /* Legacy form still required by some browsers to raise the dialog. */
  e.returnValue = '';
  return '';
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

try{ (window.console || console).info('[v2] build', BUILD, '· signed in:', !!authToken(window.localStorage)); }catch{}

/* ── boot ──────────────────────────────────────────────────────────────
   Without this the module only DEFINES things. In a browser that meant
   app.js loaded, logged its build line, exposed __V2__ and stopped: no
   fetch, no render, the shell left showing its static placeholder ring
   ("0/8", the prototype's demo count) and empty panes, with no error
   anywhere because nothing had run.

   It was invisible to the whole test suite because tests/helpers/v2-env.js's
   bootV2 calls api.render() itself — the harness was performing the app's
   boot, so 897 tests exercised a page that could never start on its own.
   `ready` is that boot promise; bootV2 awaits it instead of re-rendering,
   so there is exactly one boot render in both the browser and the tests.
   The guard test is in tests/v2-shell.test.js ("app.js boots itself"). */
const ready = render();

window.__V2__ = { state: S, go, render, build: BUILD, ready };
