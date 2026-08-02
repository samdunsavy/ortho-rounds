/* Pure fragment builders for the v2 preview.
   No DOM, no state, no event handling — Task 6 wires these strings into
   the page. Class names and markup structure are lifted verbatim from
   docs/prototypes/ortho-v3.html (the committed, working prototype) and
   MUST match it exactly: public/v2/index.html and public/v2/css/ were
   split from that same prototype, so a renamed class here produces
   unstyled output. */

/* ════ films — drawn shapes, no patient imagery ════
   These SVGs are PLACEHOLDERS standing in for real radiograph thumbnails.
   Server-side thumbnail generation is a listed outstanding build
   prerequisite (design spec §8.1) — nobody should mistake these drawings
   for actual imaging.

   RE-KEYED from the prototype. The prototype's FILMS object is keyed
   anatomically (pfn, plate, wrist, spine, knee), but this app's real
   image-type values (see public/index.html's imgTypePreop /
   imgTypePostop / imgTypeFollowup pickers, and data.js's
   `images.map(i => i.type || 'preop')`) are `preop`, `postop`,
   `followup`. Re-keying by image type — reusing three of the prototype's
   five drawn artworks verbatim — so real films render artwork instead of
   silently falling through to the empty-bone placeholder:
     preop    -> the prototype's `pfn` hip-nail artwork
     postop   -> the prototype's `plate` fixation-plate artwork
     followup -> the prototype's `knee` artwork
   FILMS[kind] || FILMS.preop below covers any unknown/future type. */
const FILMS = {
  preop:'<svg viewBox="0 0 60 76" preserveAspectRatio="xMidYMid slice"><rect width="60" height="76" fill="#0e1218"/><path d="M34 8H53V70H36Z" fill="#3f454c" opacity=".45"/><ellipse cx="20" cy="17" rx="13" ry="11" fill="#5c626a"/><path d="M14 20L22 68H34L26 20Z" fill="#989ea5"/><ellipse cx="21" cy="16" rx="9" ry="8" fill="#c2c7cd"/><rect x="19" y="12" width="4.6" height="56" rx="2.3" fill="#eef1f4" transform="rotate(-5 21 40)"/><rect x="12" y="17" width="22" height="3.4" rx="1.7" fill="#eef1f4" transform="rotate(-32 23 19)"/><circle cx="23" cy="63" r="2.1" fill="#eef1f4"/><circle cx="24" cy="54" r="2.1" fill="#eef1f4"/></svg>',
  postop:'<svg viewBox="0 0 60 76" preserveAspectRatio="xMidYMid slice"><rect width="60" height="76" fill="#0e1218"/><path d="M22 4L20 70H32L31 4Z" fill="#a1a7ae"/><path d="M33 8L34 68H39L38 8Z" fill="#747b83"/><ellipse cx="26" cy="7" rx="9" ry="5" fill="#c8cdd2"/><rect x="17" y="22" width="4" height="34" rx="2" fill="#f0f3f6"/><circle cx="19" cy="27" r="2.4" fill="#fbfcfd"/><circle cx="19" cy="37" r="2.4" fill="#fbfcfd"/><circle cx="19" cy="47" r="2.4" fill="#fbfcfd"/><path d="M20 40L31 42" stroke="#2e343b" stroke-width="1.6"/></svg>',
  followup:'<svg viewBox="0 0 60 76" preserveAspectRatio="xMidYMid slice"><rect width="60" height="76" fill="#0e1218"/><path d="M20 2L18 30H36L34 2Z" fill="#999fa6"/><ellipse cx="21" cy="34" rx="9" ry="7" fill="#c5cad0"/><ellipse cx="34" cy="34" rx="9" ry="7" fill="#c5cad0"/><path d="M19 42L21 74H35L34 42Z" fill="#999fa6"/><ellipse cx="27" cy="28" rx="6" ry="4" fill="#dee1e5"/><rect x="16" y="30" width="24" height="5" rx="2.5" fill="#eef1f4"/></svg>'
};
const FILM_LABELS = { preop:'Pre-op film', postop:'Post-op film', followup:'Follow-up film' };

/* ── escaping ──
   Maps null/undefined to '' (never the literal string), and escapes the
   five HTML metacharacters including ' -> &#39;. Every patient-supplied
   field (name, diagnosis, procedure, plan, bed, UHID, surgeon, implant,
   labs, milestone labels, plan-history text, etc.) must pass through
   this before being interpolated into a fragment. */
export function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

const ic = n => `<svg class="ico" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const icS = n => `<svg class="ico-s" aria-hidden="true"><use href="#i-${n}"/></svg>`;

/* ── fragments ── */
export function filmBox(pi, kind, cap, cls=''){
  if (!kind) {
    return `<div class="fnone ${esc(cls)}" role="img" aria-label="No imaging on file">${ic('img')}</div>`;
  }
  const resolvedKind = kind in FILMS ? kind : 'preop';
  return `<button class="fbox ${esc(cls)}" data-film="${esc(String(pi))}:${esc(resolvedKind)}" aria-label="View ${esc(FILM_LABELS[resolvedKind] || 'film')}">${FILMS[resolvedKind]}${cap ? `<em>${esc(cap)}</em>` : ''}</button>`;
}

export function track(p){
  return `<div class="trk"><div class="trk-r"><div class="trk-f" style="width:${p.track.find(t => t[2] === 'now')?.[1] || 0}%"></div>
 ${p.track.map(([l,,s]) => `<span class="st ${s}"><i></i><b>${esc(l)}</b></span>`).join('')}</div><div class="trk-lg"></div></div>`;
}

function flagsOf(p){
  return p.flags.map(([k,t]) => `<span class="fl ${k}">${esc(t)}</span>`).join('');
}

function badOf(p){
  return p.flags.find(f => f[0] === 'bad');
}

export function hero(p, i){
  return `<article class="hero">
 <div class="hero-lb"><span class="pls"></span>At the bedside</div>
 <div class="hero-tp">
  <div class="hero-f">${filmBox(i, p.films[0], '')}<div class="fcap">${p.films.length ? p.films.length + ' film' + (p.films.length > 1 ? 's' : '') + ' · tap to view' : 'no imaging'}</div></div>
  <div class="who"><div class="w-bed">BED ${esc(p.bed)}</div><h2 class="w-nm">${esc(p.name)}</h2>
   <div class="w-mt">${esc(p.age)} · ${esc(p.stat)}</div>
   <div class="w-dx">${esc(p.dx)}</div><div class="w-pr">${esc(p.proc)}</div></div></div>
 ${track(p)}<div class="flags">${flagsOf(p)}</div>
 <div class="plan"><div class="lbl" style="margin-bottom:7px">Today's plan</div>
  <input class="pin" data-plan="${i}" placeholder="What are we doing today?" value="${esc(p.plan)}" aria-label="Today's plan">
  <div class="pyest">Yesterday: ${esc(p.hist[0]?.[1] || '—')} <button data-copy="${i}">Use this</button></div></div>
 <div class="bar"><button class="btn pri" data-seen="1">Seen — next patient</button>
  <button class="btn gh sq" data-skip="1" aria-label="Skip for now">${ic('skip')}</button></div></article>`;
}

export function row(p, i, cur, seen){
  const bad = badOf(p);
  return `<button class="qr ${seen ? 'seen' : ''}" data-open="${i}" ${cur ? 'aria-current="true"' : ''}>
 <span class="qb">${esc(p.bed)}</span><span class="qm ${p.films[0] ? '' : 'none'}">${p.films[0] ? (FILMS[p.films[0]] || FILMS.preop) : ''}</span>
 <span class="qi"><span class="qn">${esc(p.name)}</span><span class="qs">${esc(p.dx)}</span></span>
 ${bad ? `<span class="qt" style="background:var(--bad-bg);color:var(--bad)">review</span>`
    : `<span class="qt" style="background:var(--paper);color:var(--ink-3)">${p.pod != null ? 'POD ' + p.pod : esc(p.stat)}</span>`}</button>`;
}

export function detail(p, i){
  const firstOpen = p.checks.findIndex(c => !c[2]);
  return `<div class="dt-hd">
 <div class="dt-gal">${p.films.length ? p.films.map((k,n) => filmBox(i, k, n === 0 ? 'pre-op' : 'post-op')).join('')
   : `<div class="fnone" style="width:98px;height:128px" role="img" aria-label="No imaging">${ic('img')}</div>`}</div>
 <div style="min-width:230px;flex:1"><div class="w-bed">BED ${esc(p.bed)} · ${esc(p.uhid)}</div>
  <h2 class="dt-nm">${esc(p.name)}</h2>
  <div class="dt-sub">${esc(p.age)} · ${esc(p.stat)} · admitted ${esc(p.adm)} · ${esc(p.surgeon)}</div>
  <div class="dt-dx">${esc(p.dx)}</div><div class="w-pr">${esc(p.proc)}</div>
  <div class="flags" style="padding:0;margin-top:12px">${flagsOf(p)}</div></div></div>
 <div class="card" style="padding-bottom:6px"><div class="trk" style="margin:6px 0 0"><div class="trk-r">
  <div class="trk-f" style="width:${p.track.find(t => t[2] === 'now')?.[1] || 0}%"></div>
  ${p.track.map(([l,,s]) => `<span class="st ${s}"><i></i><b>${esc(l)}</b></span>`).join('')}</div><div class="trk-lg"></div></div></div>
 <div class="card"><div class="lbl">Today's plan</div>
  <input class="pin" data-plan="${i}" placeholder="What are we doing today?" value="${esc(p.plan)}" aria-label="Today's plan">
  <div class="lbl mt">Plan history</div>
  ${p.hist.map(([d,t]) => `<div class="hist"><b>${esc(d)}</b><span>${esc(t)}</span></div>`).join('')}</div>
 <div class="g2">
  <div class="card"><div class="lbl">Milestones</div>
   ${p.checks.map(([l,d,done],n) => `<button class="ck ${done ? 'done' : ''} ${n === firstOpen ? 'due' : ''}" data-ck="${i}:${n}" aria-pressed="${!!done}">
    <span class="ck-b">${icS('tick')}</span><span>${esc(l)}</span><em>${esc(d)}</em></button>`).join('')}</div>
  <div class="card"><div class="lbl">Discharge checklist</div>
   ${p.dc.length ? p.dc.map(([l,done],n) => `<button class="ck ${done ? 'done' : ''}" data-dc="${i}:${n}" aria-pressed="${!!done}">
    <span class="ck-b">${icS('tick')}</span><span>${esc(l)}</span></button>`).join('')
    : `<p class="empty">Not started — patient is ${esc(String(p.stat || '').toLowerCase())}.</p>`}</div></div>
 <div class="card"><div class="lbl">Record</div><div class="g4">
  <div class="fld"><label>UHID</label><div class="mono">${esc(p.uhid)}</div></div>
  <div class="fld"><label>Admitted</label><div>${esc(p.adm)}</div></div>
  <div class="fld"><label>Surgeon</label><div>${esc(p.surgeon)}</div></div>
  <div class="fld"><label>Unit</label><div>${esc(p.unit)}</div></div>
  <div class="fld" style="grid-column:span 2"><label>Implant</label><div>${esc(p.implant)}</div></div>
  <div class="fld" style="grid-column:span 2"><label>Latest labs</label><div class="mono">${esc(p.labs)}</div></div></div></div>`;
}

export function board(patients){
  const cols = [
    ['preop','Pre-op','var(--accent)'],
    ['postop','Post-op','var(--ink-2)'],
    ['conservative','Conservative','var(--bone-ink)'],
    ['discharge','For discharge','var(--good)']
  ];
  return cols.map(([k,l,c]) => {
    const list = patients.map((p,i) => [p,i]).filter(([p]) => p.status === k);
    return `<div><div class="ch"><b style="color:${c}">${l}</b><span>${list.length}</span></div>
  ${list.length ? list.map(([p,i]) => {
      const bad = badOf(p);
      return `<button class="tile" data-open="${i}" style="border-left-color:${bad ? 'var(--bad)' : c}">
    <span class="tile-t"><b>${esc(p.bed)}</b><span>${esc(p.name)}</span></span>
    <span class="tile-s" style="${bad ? 'color:var(--bad)' : ''}">${esc(bad ? bad[1] : (p.pod != null ? 'POD ' + p.pod : p.dx))}</span></button>`;
    }).join('') : `<p class="empty">None</p>`}</div>`;
  }).join('');
}

export function workList(items, sel, patients){
  const grp = (k, l) => {
    const g = items.map((x,n) => [x,n]).filter(([x]) => x[1] === k);
    return g.length ? `<p class="lbl ${k === 'warn' ? 'mt' : ''}">${l}</p>` + g.map(([[i,kk,t],n]) => {
      const p = patients[i];
      return `<button class="qr" data-work="${n}" ${n === sel ? 'aria-current="true"' : ''}>
    <span class="qb">${esc(p.bed)}</span><span class="qi"><span class="qn">${esc(t)}</span>
    <span class="qs">${esc(p.name)} · ${esc(p.dx)}</span></span>
    <span class="qt" style="background:var(--${kk}-bg);color:var(--${kk})">${kk === 'bad' ? 'urgent' : 'today'}</span></button>`;
    }).join('') : '';
  };
  return (grp('bad', 'Urgent — do now') + grp('warn', 'Today')) || `<p class="empty">Nothing outstanding. Good ward.</p>`;
}

export function complete(count){
  return `<div class="done"><svg class="dring" viewBox="0 0 108 108" aria-hidden="true">
 <circle class="bg" cx="54" cy="54" r="48"/><circle class="fg" cx="54" cy="54" r="48"/></svg>
 <h2>Round complete</h2><p>All ${count} patients seen and planned.<br>Handover is ready to send.</p>
 <div class="dstats"><div class="dstat"><b>${count}</b><span>seen</span></div>
 <div class="dstat"><b>—</b><span>minutes</span></div><div class="dstat"><b>—</b><span>flagged</span></div></div>
 <div style="display:flex;gap:9px;justify-content:center;margin-top:var(--s-6);flex-wrap:wrap">
 <button class="btn pri" style="flex:0 0 auto" data-go="handover">Open handover</button>
 <button class="btn gh" data-reset="1">Start again</button></div></div>`;
}

/* ── documents ──
   otList, handover and discharged are read-only document views (Task 7).
   Markup and classes are lifted verbatim from docs/prototypes/ortho-v3.html's
   rOT/rHand/rDisch. The prototype's date input and search box are static —
   neither is wired to live filtering in the prototype either. Task 7 Fix
   round 1 (Finding 3) wires them up for real, but from app.js only: it
   listens for their change/input events and calls otList()/discharged()
   again with a new dateISO/unitFilter/search argument — no fetch, no DOM,
   no global read happens in this module; every input these builders need
   is an explicit parameter, so they stay pure. data-toast/data-print stay
   presentational hooks for app.js to wire toast()/print() onto. */

/** OT list for `dateISO`, optionally narrowed to `unitFilter`. Filter and
 *  sort MUST match public/app.js:1526-1545's getOtListPatients() exactly:
 *
 *   1. `p.status === 'preop' && p.surgeryDate === dateISO` (status ===
 *      'preop' already implies not discharged, so the main app's
 *      redundant `p.status !== 'discharged'` clause is a no-op here).
 *   2. Only when `unitFilter` is non-empty, AND only when it would not
 *      empty the list, narrow further to patients whose unit matches it
 *      (case-insensitive, trimmed) — the main app discards the filter
 *      rather than showing nobody when nothing on the list matches it.
 *      Unit comparison treats VPatient's '—' placeholder (toViewModel's
 *      fallback for an absent raw `unit`) as equivalent to an absent
 *      unit, since the main app's filter runs against the raw record —
 *      where an absent unit is simply falsy, never the literal '—'.
 *   3. Sort by `otOrder` ascending (`Number(x.otOrder) || 0`), where a
 *      truthy otOrder on one side and not the other always sorts the
 *      truthy side first; then by `theatreTime`; then by `name`. */
export function otList(patients, dateISO, unitFilter = ''){
  let rows = patients.filter(p => p.status === 'preop' && p.surgeryDate === dateISO);
  const uf = String(unitFilter || '').trim().toUpperCase();
  if(uf){
    const unitOf = p => String(p.unit === '—' ? '' : (p.unit || '')).trim().toUpperCase();
    const matched = rows.filter(p => unitOf(p) === uf);
    if(matched.length) rows = matched;
  }
  rows = rows.slice().sort((a, b) => {
    const ao = Number(a.otOrder) || 0;
    const bo = Number(b.otOrder) || 0;
    if(ao && bo && ao !== bo) return ao - bo;
    if(ao && !bo) return -1;
    if(!ao && bo) return 1;
    return (a.theatreTime || '').localeCompare(b.theatreTime || '')
      || (a.name || '').localeCompare(b.name || '');
  });
  const body = rows.map((p, n) => `<tr><td class="mono">${n + 1}</td><td class="mono">${esc(p.bed)}</td>
 <td style="font-weight:500">${esc(p.name)}</td><td>${esc(p.age)}</td><td>${esc(p.dx)}</td>
 <td>${esc(p.proc)}</td><td>${esc(p.surgeon)}</td><td class="mono">${esc(p.theatreTime)}</td></tr>`).join('');
  return `<div class="toolbar">
 <input class="inp" type="date" value="${esc(dateISO)}" aria-label="OT date">
 <button class="btn gh" data-toast="Word file generated">Download Word</button>
 <button class="btn gh" data-print="1">Print / PDF</button>
 <button class="btn gh" data-toast="Default doctors saved">Default doctors</button></div>
 ${rows.length ? `<div class="tw"><table class="tbl"><thead><tr><th>#</th><th>Bed</th><th>Name</th><th>Age/Sex</th><th>Diagnosis</th><th>Procedure</th><th>Surgeon</th><th>Time</th></tr></thead>
 <tbody>${body}</tbody></table></div>
 <p class="note">Formatted to the hospital OT list template. The Word export preserves the header block and signature lines, so it can go straight to theatre.</p>`
 : `<p class="empty">No cases scheduled for this date.</p>`}`;
}

/** Evening handover sheet. `meta.when`/`meta.to` are supplied by the
 *  caller (app.js), not derived here — render.js stays pure. Falls back
 *  from today's plan to yesterday's plan-history entry, then to an
 *  explicit "not entered" string, and surfaces the first `bad` flag (if
 *  any) as `.ho-f`. */
export function handover(patients, meta){
  const rows = patients.map(p => {
    const bad = badOf(p);
    const planText = p.plan || p.hist[0]?.[1] || 'plan not entered';
    return `<div class="ho"><div class="ho-t"><b>${esc(p.bed)}</b>
 <strong>${esc(p.name)}</strong><em>${esc(p.age)} · ${p.pod != null ? 'POD ' + p.pod : esc(p.stat)}</em></div>
 <p class="ho-p">${esc(p.dx)} — ${esc(planText)}</p>
 ${bad ? `<span class="ho-f">${esc(bad[1])}</span>` : ''}</div>`;
  }).join('');
  return `<div class="toolbar">
 <button class="btn pri" style="flex:0 0 auto" data-toast="Handover copied to clipboard">Copy for WhatsApp</button>
 <button class="btn gh" data-toast="Word file generated">Download Word</button>
 <button class="btn gh" data-print="1">Print</button></div>
 <div class="sheet"><h3>Unit II — evening handover</h3>
 <p class="sh-meta">${esc(meta.when)} · ${patients.length} inpatient${patients.length === 1 ? '' : 's'} · handed to ${esc(meta.to)}</p>
 ${rows}
 <p class="note" style="margin-top:var(--s-4)">Generated from today's plans and open flags. Edit before sending.</p></div>`;
}

/** Formats an ISO discharge date for display, or '' if `iso` is absent/
 *  unparseable — the caller renders the codebase's '—' placeholder for
 *  that case, never a fabricated date. */
function fmtDischargeDate(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if(Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

/** Whole days between `admissionIso` and `dischargeIso`, or null when
 *  either date is absent/unparseable — the caller renders '—' for that
 *  case rather than a fabricated length of stay. */
function stayDays(admissionIso, dischargeIso){
  if(!admissionIso || !dischargeIso) return null;
  const a = new Date(admissionIso + 'T00:00:00');
  const d = new Date(dischargeIso + 'T00:00:00');
  if(Number.isNaN(a.getTime()) || Number.isNaN(d.getTime())) return null;
  const days = Math.round((d.getTime() - a.getTime()) / 86400000);
  return Number.isFinite(days) ? days : null;
}

/** Discharged-patients archive. `rows` are already filtered/sorted by
 *  data.js's fetchDischarged() — this function narrows further by
 *  `search` (Task 7 Fix round 1, Finding 3: case-insensitive substring
 *  match against name and diagnosis; render.js stays pure, so `search`
 *  is an explicit parameter, never read from a global) and renders.
 *
 *  Discharged date and length of stay (Minor, authorised in the same
 *  review, Fix round 1) render the real values from VPatient's
 *  `dischargeDate`/`admissionDate` when present; the codebase's
 *  established '—' placeholder renders only when the underlying date(s)
 *  are genuinely absent, never a fabricated value. */
export function discharged(rows, search = ''){
  const q = String(search || '').trim().toLowerCase();
  const filtered = q
    ? rows.filter(p => (p.name || '').toLowerCase().includes(q) || (p.dx || '').toLowerCase().includes(q))
    : rows;
  const body = filtered.map(p => {
    const dc = fmtDischargeDate(p.dischargeDate);
    const stay = stayDays(p.admissionDate, p.dischargeDate);
    return `<tr><td style="font-weight:500">${esc(p.name)}</td><td>${esc(p.age)}</td>
 <td>${esc(p.dx)}</td><td>${esc(p.proc)}</td><td>${dc ? esc(dc) : '—'}</td><td class="mono">${stay != null ? esc(stay + 'd') : '—'}</td></tr>`;
  }).join('');
  return `<div class="toolbar">
 <input class="inp" placeholder="Search discharged patients…" style="min-width:260px" aria-label="Search discharged" value="${esc(search)}"></div>
 ${filtered.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Name</th><th>Age/Sex</th><th>Diagnosis</th><th>Procedure</th><th>Discharged</th><th>Stay</th></tr></thead>
 <tbody>${body}</tbody></table></div>`
 : `<p class="empty">${rows.length ? 'No discharges match your search.' : 'No discharges in this period.'}</p>`}`;
}
