/* API client + view-model normalisation for the v2 preview.
   Online-only by design: no IndexedDB, no offline queue, no merge logic.
   All clinical-day arithmetic is delegated to public/milestones.js via
   `deps` (defaults to globalThis in the browser, stubbed in tests). */

const STATUS_LABELS = {
  preop:'Pre-op', conservative:'Conservative',
  postop:'Post-op', fordischarge:'For discharge'
};

function todayISO(){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if(Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}

/** Post-op / care track. Stations are laid out proportionally between the
 *  operation (0%) and either the expected discharge date or the latest
 *  milestone due-day (100%). Exactly one station carries state 'now'. */
function buildTrack(raw, pod, deps, dayPrefix){
  const preOp = pod == null;
  if(preOp){
    return [
      ['admit', 0, 'done'],
      ['workup', 34, 'now'],
      [raw.surgeryDate ? 'surgery' : 'surgery date', 68, raw.surgeryDate ? '' : 'due'],
      ['POD 1', 100, '']
    ];
  }
  const checks = Array.isArray(raw.postOpChecks) ? raw.postOpChecks : [];
  const dueDays = checks.map(c => Number(c.duePod)).filter(Number.isFinite);
  // `expectedDischargeDate` is not yet a stored field on the patient record
  // (only `dischargeDate`, set retrospectively after discharge, which must
  // NOT be substituted here — using it prospectively would be wrong). This
  // is intentional: with the field absent, `hasDischarge` is always false
  // and the track falls back to ending at the last milestone, which is the
  // documented behaviour in the design spec's "Empty and degraded states"
  // section. Adding a real discharge-anchor field is a listed outstanding
  // build prerequisite in the design spec.
  const hasDischarge = !!raw.expectedDischargeDate;
  /* Math.max(1, ...) guards the divide-by-zero: a mistyped FUTURE surgery
     date yields a negative pod, which collapsed `span` to 0 and produced
     width:NaN% on every station derived from it. A span of at least one
     day keeps every pct() finite; the clamp below then pins a negative
     day to 0%. */
  const span = Math.max(1, pod + 1, ...dueDays, hasDischarge ? pod + 3 : 0);
  const pct = day => Math.max(0, Math.min(100, Math.round((day / span) * 100)));

  /* A conservative patient has never been operated on — getPatientPod
     counts their day from ADMISSION (public/milestones.js:274-280), so
     station zero is the admission, not an operation, and the day station
     carries milestoneDayPrefix's "Day", not "POD". */
  const conservative = deps.isConservativePatient
    ? deps.isConservativePatient(raw)
    : raw.status === 'conservative';
  const stations = [[conservative ? 'admit' : 'op', 0, 'done'],
    [`${dayPrefix} ${pod}`, pct(pod), 'now']];
  for(const c of checks){
    const day = Number(c.duePod);
    if(!Number.isFinite(day) || day <= pod) continue;
    stations.push([c.label || 'milestone', pct(day),
      deps.isItemOverdue && deps.isItemOverdue(c, pod) ? 'due' : '']);
  }
  if(hasDischarge) stations.push(['discharge', 100, '']);
  return stations.sort((a, b) => a[1] - b[1]);
}

function buildFlags(raw, pod, deps){
  const flags = [];
  const checks = Array.isArray(raw.postOpChecks) ? raw.postOpChecks : [];
  for(const c of checks){
    if(c.status === 'done') continue;
    if(deps.isItemOverdue && deps.isItemOverdue(c, pod))
      flags.push(['bad', `${c.label || 'Milestone'} overdue`]);
  }
  /* Mirrors public/app.js:4398's hasPlanToday() exactly:
     `!!(p.dailyPlan && p.dailyPlanDate === todayISO())`. The previous
     version compared `String(planUpdatedAt).slice(0,10)` — an epoch
     NUMBER — against an ISO date, which can never match, so every
     patient carried this warning permanently and the Work view listed
     the whole ward forever. dailyPlanDate is the field the main app
     stamps (public/app.js:1205) and reads; planUpdatedAt is a
     millisecond timestamp, never a date. */
  const planToday = !!(raw.dailyPlan && raw.dailyPlanDate === todayISO());
  if(!planToday) flags.push(['warn', 'No plan entered today']);
  if(!flags.length) flags.push(['ok', 'Nothing outstanding']);
  return flags;
}

export function toViewModel(raw, deps = globalThis){
  const pod = deps.getPatientPod ? deps.getPatientPod(raw) : null;
  /* "POD" for an operated patient, "Day" for a conservative one — the
     decision belongs to public/milestones.js:287's milestoneDayPrefix()
     and is NOT reimplemented here; v2 only carries its answer onto the
     view model so render.js (which must stay pure) can read it instead
     of hardcoding "POD". Falls back to 'POD' only when deps has no
     milestones module at all, which is the pre-existing convention for
     every other deps.* call in this file. */
  const dayPrefix = deps.milestoneDayPrefix ? deps.milestoneDayPrefix(raw) : 'POD';
  const sex = (raw.sex || '').trim();
  const labs = raw.labs && typeof raw.labs === 'object'
    ? Object.entries(raw.labs).map(([k, v]) => `${k} ${v}`).join(' · ')
    : '';
  return {
    id: raw.id,
    bed: raw.bed || '—',
    name: (raw.name || '').trim() || 'Unnamed',
    age: sex ? `${raw.age || '?'}/${sex}` : String(raw.age || '?'),
    uhid: raw.uhid || '—',
    adm: fmtDate(raw.admissionDate) || '—',
    surgeon: raw.surgeon || '—',
    unit: raw.unit || '—',
    dx: (raw.diagnosis || '').trim() || 'Diagnosis not entered',
    proc: [raw.procedure, fmtDate(raw.surgeryDate), raw.theatreTime && 'OT ' + raw.theatreTime]
      .filter(Boolean).join(' · '),
    /* Raw (unformatted) surgery date/theatre time, added for the OT list
       (Task 7): it must select the exact same patients as public/app.js's
       getOtListPatients() — `p.status === 'preop' && p.surgeryDate === date`
       — which needs the raw ISO date, not the pre-formatted `proc` string
       above. Empty string, never undefined, when absent. */
    surgeryDate: raw.surgeryDate || '',
    theatreTime: raw.theatreTime || '',
    /* otOrder (Task 7 Fix round 1, Finding 2): public/app.js's
       getOtListPatients() sorts on `Number(p.otOrder) || 0`, applied at
       COMPARATOR time (public/app.js:1538), not at storage time. Carried
       through raw and unconverted here so render.js's otList() can apply
       the identical `Number(x.otOrder) || 0` coercion in its own
       comparator — undefined (absent) and 0 must behave identically to
       the main app, which they only do if neither is coerced early. */
    otOrder: raw.otOrder,
    /* admissionDate/dischargeDate (Minor, authorised in the same review,
       Fix round 1): raw ISO, '' when absent. Needed by the discharged
       archive to show a real discharge date and a computed length of
       stay instead of a permanent '—' placeholder. This supersedes the
       earlier Task 7 ruling recorded in fetchDischarged()'s comment below
       (kept there, corrected) that VPatient must not carry dischargeDate
       — that ruling covered SORTING (still done on raw records, for the
       reason explained there), not display, which is what this field is
       for. */
    admissionDate: raw.admissionDate || '',
    dischargeDate: raw.dischargeDate || '',
    implant: raw.implant || '—',
    labs: labs || 'None recorded',
    films: (Array.isArray(raw.images) ? raw.images : []).map(i => i.type || 'preop'),
    pod,
    dayPrefix,
    /* Pre-composed "POD 4" / "Day 4" for every surface that shows the
       clinical day (row, board tile, handover, presentation). null when
       there is no day to show. */
    podLabel: pod == null ? null : `${dayPrefix} ${pod}`,
    status: raw.status || 'preop',
    stat: STATUS_LABELS[raw.status] || 'Pre-op',
    plan: raw.dailyPlan || '',
    track: buildTrack(raw, pod, deps, dayPrefix),
    flags: buildFlags(raw, pod, deps),
    /* Fourth/third element is the item's STABLE id. render.js addresses
       checklist toggles by this id, never by list position: S.raw is
       replaced by every write's loadWard() without the patient being
       re-rendered, so a positional index silently drifts onto whatever
       item happens to occupy that slot in the newer record — which is
       how a click on "Weight bearing" pushed "Suture removal → done".
       Falls back to the position for a record whose items carry no id
       (older data predating public/milestones.js's normalizePostOpItem,
       which always assigns one); app.js resolves that fallback back to
       an index rather than failing the write. */
    checks: (Array.isArray(raw.postOpChecks) ? raw.postOpChecks : [])
      .map((c, n) => [c.label || 'Milestone',
        Number.isFinite(Number(c.duePod)) ? `${dayPrefix} ${c.duePod}` : '—',
        c.status === 'done' ? 1 : 0,
        c.id || String(n)]),
    dc: (Array.isArray(raw.dischargeChecks) ? raw.dischargeChecks : [])
      .map((c, n) => [c.label || 'Item', c.status === 'done' ? 1 : 0, c.id || String(n)]),
    hist: (Array.isArray(raw.planHistory) ? raw.planHistory : [])
      .slice().reverse().map(h => [fmtDate(h.date) || h.date || '', h.text || ''])
  };
}

/* This app does NOT authenticate with a session cookie. POST /api/login
   returns a token in its JSON body; the main client stores it in
   localStorage under "ortho_token" (public/app.js:45,2051) and sends it as
   `Authorization: Bearer <token>` on every request (public/app.js:361),
   which is what server.js:176-178 reads. v2 originally sent
   `credentials: 'same-origin'` and no Authorization header, so every
   request was unauthenticated, /api/sync returned 401, and the ward was
   always empty. Read the same key the main client writes, so logging in at
   / carries straight over to /v2. */
export const LS_TOKEN = 'ortho_token';

export function authToken(store){
  const s = store || (typeof localStorage !== 'undefined' ? localStorage : null);
  try { return s ? s.getItem(LS_TOKEN) : null; }
  catch { return null; }
}

async function post(url, body, fetchImpl, store){
  const headers = { 'Content-Type': 'application/json' };
  const token = authToken(store);
  if(token) headers.Authorization = 'Bearer ' + token;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(body)
  });
  if(res.status === 401) throw new Error(`${url} failed: 401 — not signed in`);
  if(!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

export async function fetchWard(fetchImpl = fetch, deps = globalThis){
  const out = await post('/api/sync', { since: 0, changes: [] }, fetchImpl);
  const list = Array.isArray(out.patients) ? out.patients : [];
  return {
    serverTime: out.serverTime,
    patients: list
      /* Exclude the ward-meta record (id "__ward_meta__", read by
         extractDefaultUnit below). It has no `status` field, so
         `p.status !== 'discharged'` is trivially true for it and it
         would otherwise pass through as a phantom "Unnamed" patient at
         bed "—". public/app.js:1824-1830 special-cases this same id;
         mirrored here. */
      .filter(p => p.id !== '__ward_meta__')
      /* getChangedSince() returns soft-deleted rows too — rowToPatient
         stamps obj.deleted = !!row.deleted (server.js:125-132) — so they
         must be dropped or deleted patients reappear on the ward. */
      .filter(p => !p.deleted)
      .filter(p => p.status !== 'discharged')
      .map(p => toViewModel(p, deps))
      .sort((a, b) => (parseInt(a.bed, 10) || 1e9) - (parseInt(b.bed, 10) || 1e9))
  };
}

/* Mirrors fetchWard, but for the discharged-patients archive (Task 7):
   filters on the inverse of fetchWard's status check, and sorts by
   discharge date descending instead of by bed. Field-name note (see
   task-7-brief.md): this codebase carries lifecycle on `p.status`
   ('discharged' is a string value, not a boolean), and the retrospective
   discharge date lives on `p.dischargeDate` — set only after discharge,
   distinct from any prospective/expected discharge date. Sorting still
   happens on the RAW records, before toViewModel(), even though
   dischargeDate is now ALSO on VPatient (Fix round 1, authorised for
   display — see toViewModel above): sorting raw avoids coupling this
   function's ordering to toViewModel's shape, and there is no reason to
   change working, already-tested code just because a sibling field
   became available. */
export async function fetchDischarged(fetchImpl = fetch, deps = globalThis){
  const out = await post('/api/sync', { since: 0, changes: [] }, fetchImpl);
  const list = Array.isArray(out.patients) ? out.patients : [];
  return {
    serverTime: out.serverTime,
    patients: list
      // Exclude the ward-meta record — see fetchWard's identical filter above.
      .filter(p => p.id !== '__ward_meta__')
      .filter(p => !p.deleted)
      .filter(p => p.status === 'discharged')
      .sort((a, b) => String(b.dischargeDate || '').localeCompare(String(a.dischargeDate || '')))
      .map(p => toViewModel(p, deps))
  };
}

/* extractDefaultUnit (Task 7 Fix round 1, Finding 1) — where v2 gets the
   default unit for the OT list's unit filter.

   public/app.js's getDefaultUnit() reads `wardMeta.defaultUnit`, which is
   NOT localStorage: it's a record with id "__ward_meta__", written via
   saveWardMeta() -> cachePut() -> scheduleSync() (public/app.js:3379-
   3385) and synced through the exact same /api/sync endpoint as every
   patient record (server.js's sync handler stores and returns it as an
   ordinary row keyed by that id — see mergeServerRecords' special case
   for WARD_META_ID in public/app.js:1827 for confirmation it travels the
   normal sync path). Since fetchWard()/fetchDischarged() already POST
   /api/sync and receive this record back in the same response, this
   function reads it straight out of that already-fetched raw array: no
   new fetch, no localStorage, no IndexedDB (v2 has neither) — just a
   second look at data v2 already has.

   This record has no `status` field, so `p.status !== 'discharged'` in
   fetchWard is trivially true for it and `p.status === 'discharged'` in
   fetchDischarged is trivially false — without an explicit id check it
   leaks through as a phantom "Unnamed" patient at bed "—" in the ward
   list, the spine and the round. fetchWard/fetchDischarged above both
   filter it out by id (Task 8 MUST FIX), so this function's own read of
   the raw array here is unaffected by that filtering — it reads
   `rawList` before either function's `.filter()` runs. */
export function extractDefaultUnit(rawList){
  const meta = Array.isArray(rawList) ? rawList.find(p => p && p.id === '__ward_meta__') : null;
  return String((meta && meta.defaultUnit) || '').trim();
}

export async function pushPatient(patient, fetchImpl = fetch){
  const out = await post('/api/sync',
    { since: 0, changes: [{ ...patient, updatedAt: Date.now() }] }, fetchImpl);
  const rejected = Array.isArray(out.rejected) && out.rejected.includes(patient.id);
  return { ok: !rejected, rejected };
}
