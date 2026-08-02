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
function buildTrack(raw, pod, deps){
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
  const hasDischarge = !!raw.expectedDischargeDate;
  const span = Math.max(pod + 1, ...dueDays, hasDischarge ? pod + 3 : 0);
  const pct = day => Math.max(0, Math.min(100, Math.round((day / span) * 100)));

  const stations = [['op', 0, 'done'], [`POD ${pod}`, pct(pod), 'now']];
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
  const planToday = raw.planUpdatedAt
    && String(raw.planUpdatedAt).slice(0, 10) === todayISO();
  if(!raw.dailyPlan || !planToday) flags.push(['warn', 'No plan entered today']);
  if(!flags.length) flags.push(['ok', 'Nothing outstanding']);
  return flags;
}

export function toViewModel(raw, deps = globalThis){
  const pod = deps.getPatientPod ? deps.getPatientPod(raw) : null;
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
    implant: raw.implant || '—',
    labs: labs || 'None recorded',
    films: (Array.isArray(raw.images) ? raw.images : []).map(i => i.type || 'preop'),
    pod,
    status: raw.status || 'preop',
    stat: STATUS_LABELS[raw.status] || 'Pre-op',
    plan: raw.dailyPlan || '',
    track: buildTrack(raw, pod, deps),
    flags: buildFlags(raw, pod, deps),
    checks: (Array.isArray(raw.postOpChecks) ? raw.postOpChecks : [])
      .map(c => [c.label || 'Milestone',
        Number.isFinite(Number(c.duePod)) ? `POD ${c.duePod}` : '—',
        c.status === 'done' ? 1 : 0]),
    dc: (Array.isArray(raw.dischargeChecks) ? raw.dischargeChecks : [])
      .map(c => [c.label || 'Item', c.status === 'done' ? 1 : 0]),
    hist: (Array.isArray(raw.planHistory) ? raw.planHistory : [])
      .slice().reverse().map(h => [fmtDate(h.date) || h.date || '', h.text || ''])
  };
}

async function post(url, body, fetchImpl){
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

export async function fetchWard(fetchImpl = fetch, deps = globalThis){
  const out = await post('/api/sync', { since: 0, changes: [] }, fetchImpl);
  const list = Array.isArray(out.patients) ? out.patients : [];
  return {
    serverTime: out.serverTime,
    patients: list
      .filter(p => p.status !== 'discharged')
      .map(p => toViewModel(p, deps))
      .sort((a, b) => (parseInt(a.bed, 10) || 1e9) - (parseInt(b.bed, 10) || 1e9))
  };
}

export async function pushPatient(patient, fetchImpl = fetch){
  const out = await post('/api/sync',
    { since: 0, changes: [{ ...patient, updatedAt: Date.now() }] }, fetchImpl);
  const rejected = Array.isArray(out.rejected) && out.rejected.includes(patient.id);
  return { ok: !rejected, rejected };
}
