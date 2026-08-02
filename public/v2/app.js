/* v2 preview app — state, event delegation, view switching for
   Round, Ward, Work, and the three read-only documents (OT list,
   handover, discharged archive). Admin, the palette, the film viewer,
   presentation mode and the add modal are out of scope for this file
   (later tasks); go() accepts their view names without throwing but
   renders nothing for them — a seam, not a stub.

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
import { esc, hero, row, detail, board, workList, complete, otList, handover, discharged } from './render.js';
import { fetchWard, fetchDischarged, pushPatient, toViewModel } from './data.js';

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
  patients: [],      // view models, from fetchWard() — never demo data
  raw: new Map(),    // id -> raw patient record, for safe pushPatient() writes
  serverTime: 0,
  pending: null,     // promise from the most recent in-flight write (plan or
                      // checklist push) — test-introspection only, so a test
                      // can `await api.state.pending` for the write to settle
                      // before asserting; app.js itself never awaits it.
  otDate: todayISO(),        // OT list date filter — presentational only,
                              // same as the prototype's static date input
  dischargedPatients: []     // populated by loadDischarged(), a separate
                              // fetch — fetchWard() excludes discharged
                              // patients entirely, so the ward's own
                              // S.patients can never serve this view
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
   patients OUT. */
function rOT(){
  const el = $('#otP');
  if(el) el.innerHTML = otList(S.patients, S.otDate);
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

function rDisch(){
  const el = $('#dcP');
  if(el) el.innerHTML = discharged(S.dischargedPatients);
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
  /* data-act, data-film, data-vnav, data-pnav, data-pclose, data-prow,
     data-add, data-close are palette/viewer/present/add-modal concerns
     — tasks 8-9. Intentionally unhandled here: clicking them is a no-op,
     not a crash. */
});
DOC.addEventListener('input', e => {
  const p = e.target.dataset.plan;
  if(p === undefined) return;
  const i = +p;
  if(S.patients[i]){ S.patients[i].plan = e.target.value; schedulePlanPush(i); }
});
/* Task 8 must introduce S.vwP (film-viewer state) together with its
   `?.length` guard everywhere the viewer is driven from here — [data-vnav]
   clicks and the viewer's arrow-key navigation both need
   `S.vwP?.length` checks before indexing into it, same as every other
   guard already in this handler. The viewer is genuinely out of scope
   until then; there is no dead `vwP` stub here on purpose. */
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
