/* Pure fragment builders for the v2 preview.
   No DOM, no state, no event handling — Task 6 wires these strings into
   the page. Class names and markup structure are lifted verbatim from
   docs/prototypes/ortho-v3.html (the committed, working prototype) and
   MUST match it exactly: public/v2/index.html and public/v2/css/ were
   split from that same prototype, so a renamed class here produces
   unstyled output. */

/* Known image types. Formerly this held drawn SVG "radiographs" — dark
   film, white bones, hardware — used as stand-ins until real thumbnails
   existed. At 71.4% production coverage most rows have a genuine X-ray on
   file, so a convincing fake in that slot could be read as the patient's
   own film during a round. The artwork is gone; only the type whitelist
   remains, feeding labels and the aria-label. Render real imagery here
   only when it is the patient's actual radiograph (spec 8.1). */
const FILM_KINDS = { preop: 1, postop: 1, followup: 1 };
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

/* Resolves an image type to a whitelisted FILMS key.
   `hasOwnProperty.call` rather than `kind in FILMS`: `in` walks
   Object.prototype, so an image type of `constructor`/`toString`/
   `valueOf` passed the old guard and rendered Function.prototype.
   toString's output — literal JS source — into the button's markup and
   aria-label. Every film lookup in this module (filmBox, filmArt,
   row's inline thumbnail) goes through here, so none of them can be
   handed a non-whitelisted key. */
const resolveFilmKind = kind =>
  (kind && Object.prototype.hasOwnProperty.call(FILM_KINDS, kind)) ? kind : 'preop';

/* "POD 4" / "Day 4" for a patient with a clinical day, '' otherwise.
   The POD-vs-Day decision is made by public/milestones.js's
   milestoneDayPrefix() and carried onto the view model by data.js — this
   module (which must stay pure) only reads it. The literal fallback
   covers a view model built before that field existed. */
function dayLabel(p){
  if(p.pod == null) return '';
  return p.podLabel || `POD ${p.pod}`;
}

const ic = n => `<svg class="ico" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const icS = n => `<svg class="ico-s" aria-hidden="true"><use href="#i-${n}"/></svg>`;

/* ── fragments ── */
/* Two visually distinct states, neither of which may be mistaken for an
   actual radiograph.

   Production imaging coverage is 71.4% (spec §Imaging coverage), so most
   rows DO have a real X-ray on file — and v2 does not yet render it:
   data.js keeps only the image `type` and discards the `url`, pending
   server-side thumbnails (spec §8.1). Until then the slot must say so.
   The previous drawn anatomy — dark film, white bones, hardware — read as
   the patient's own film at a glance, which on a round is worse than
   showing nothing: a clinician could take a generic hip drawing for this
   patient's hip. Bone-tinted card, explicit words, no fake anatomy. */
export function filmBox(pi, film, cap, cls=''){
  /* `film` is a view-model entry `{ type, src }`, or undefined. A bare
     string is accepted so older callers/tests keep working; it means
     "this type is on record" with no source. */
  const kind = typeof film === 'string' ? film : film && film.type;
  const src  = typeof film === 'string' ? null : film && film.src;

  if (!kind) {
    /* "No imaging available", not "no imaging on file" — the latter reads
       ambiguously aloud, and a test asserts this state never contains the
       phrase that the has-a-film state uses to claim one exists. */
    return `<div class="fslot fslot-none ${esc(cls)}" role="img" aria-label="No imaging available">
   ${ic('img')}<span class="fslot-t">No imaging</span></div>`;
  }

  const resolvedKind = resolveFilmKind(kind);
  const label = FILM_LABELS[resolvedKind] || 'Film';

  if (src) {
    /* The real radiograph. Dark backing is CORRECT here and only here —
       what is inside it is this patient's own film, so it should look
       like one. `loading="lazy"` and `decoding="async"` keep an off-screen
       row from blocking the round; the browser caches these for a day
       (server.js sends Cache-Control: private, max-age=86400), so the
       download cost is once per device per day, not once per render. */
    return `<button class="fbox ${esc(cls)}" data-film="${esc(String(pi))}:${esc(resolvedKind)}"
   aria-label="View ${esc(label)}"><img src="${esc(src)}" alt="${esc(label)}"
   loading="lazy" decoding="async">${cap ? `<em>${esc(cap)}</em>` : ''}</button>`;
  }

  /* On record, but no usable source — say so rather than showing a broken
     image or, worse, stand-in anatomy that reads as this patient's film. */
  return `<div class="fslot fslot-has ${esc(cls)}" role="img"
   aria-label="${esc(label)} on file — not shown in this preview build">
   ${ic('img')}<span class="fslot-t">${esc(label)}</span><span class="fslot-s">on file · not shown yet</span>
   ${cap ? `<em>${esc(cap)}</em>` : ''}</div>`;
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
  <div class="hero-f">${filmBox(i, p.films[0], '')}<div class="fcap">${p.films.length
      ? p.films.length + ' film' + (p.films.length > 1 ? 's' : '') + ' on file'
      : 'no imaging'}</div></div>
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
 <span class="qb">${esc(p.bed)}</span><span class="qm">${filmBox(i, p.films[0], '')}</span>
 <span class="qi"><span class="qn">${esc(p.name)}</span><span class="qs">${esc(p.dx)}</span></span>
 ${bad ? `<span class="qt" style="background:var(--bad-bg);color:var(--bad)">review</span>`
    : `<span class="qt" style="background:var(--paper);color:var(--ink-3)">${p.pod != null ? esc(dayLabel(p)) : esc(p.stat)}</span>`}</button>`;
}

/* `data-ck`/`data-dc` are "<patient index>:<checklist item id>". The id
   (not the item's list position) is what app.js resolves the write
   against: S.raw is replaced by every write's loadWard() without the
   patient being re-rendered, so a rendered position can drift onto a
   different item in the newer record — a click on the row labelled
   "Weight bearing" pushed "Suture removal → done", with a success toast.
   An id is stable regardless of refresh timing. data.js supplies the id
   as the last element of each checks/dc tuple, falling back to the
   position for records whose items carry no id. */
export function detail(p, i){
  const firstOpen = p.checks.findIndex(c => !c[2]);
  return `<div class="dt-hd">
 <div class="dt-gal">${p.films.length ? p.films.map((k,n) => filmBox(i, k, n === 0 ? 'pre-op' : 'post-op')).join('')
   : filmBox(i, undefined, '')}</div>
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
   ${p.checks.map(([l,d,done,key],n) => `<button class="ck ${done ? 'done' : ''} ${n === firstOpen ? 'due' : ''}" data-ck="${i}:${esc(key ?? n)}" aria-pressed="${!!done}">
    <span class="ck-b">${icS('tick')}</span><span>${esc(l)}</span><em>${esc(d)}</em></button>`).join('')}</div>
  <div class="card"><div class="lbl">Discharge checklist</div>
   ${p.dc.length ? p.dc.map(([l,done,key],n) => `<button class="ck ${done ? 'done' : ''}" data-dc="${i}:${esc(key ?? n)}" aria-pressed="${!!done}">
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

/* Column keys are this codebase's REAL status values — the four in
   public/app.js:13-14's STATUS_LABELS/STATUS_CYCLE (`preop`,
   `conservative`, `postop`, `fordischarge`) — not the prototype's demo
   vocabulary. The last column was keyed `discharge`, which matches no
   patient: the column rendered with the right heading and a count of 0
   while every for-discharge patient appeared in no column at all. */
export function board(patients){
  const cols = [
    ['preop','Pre-op','var(--accent)'],
    ['postop','Post-op','var(--ink-2)'],
    ['conservative','Conservative','var(--bone-ink)'],
    ['fordischarge','For discharge','var(--good)']
  ];
  return cols.map(([k,l,c]) => {
    const list = patients.map((p,i) => [p,i]).filter(([p]) => p.status === k);
    return `<div><div class="ch"><b style="color:${c}">${l}</b><span>${list.length}</span></div>
  ${list.length ? list.map(([p,i]) => {
      const bad = badOf(p);
      return `<button class="tile" data-open="${i}" style="border-left-color:${bad ? 'var(--bad)' : c}">
    <span class="tile-t"><b>${esc(p.bed)}</b><span>${esc(p.name)}</span></span>
    <span class="tile-s" style="${bad ? 'color:var(--bad)' : ''}">${esc(bad ? bad[1] : (p.pod != null ? dayLabel(p) : p.dx))}</span></button>`;
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
 <strong>${esc(p.name)}</strong><em>${esc(p.age)} · ${p.pod != null ? esc(dayLabel(p)) : esc(p.stat)}</em></div>
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

/* ── overlays: command palette, film viewer, presentation mode (Task 8) ──
   Pure fragment builders only. app.js owns all overlay STATE (the
   executable S.palRows array the palette renders and the keyboard
   drives, S.vwP/S.vwI for the film viewer, S.pr for presentation mode,
   which overlay is `.on`) and all DOM wiring; these functions only turn
   already-decided inputs into markup, exactly like every other builder
   in this module. Markup/classes are lifted verbatim from
   docs/prototypes/ortho-v3.html's rPal/rViewer/rPresent. */

/** Raw film artwork (no surrounding <button>) for the film viewer and
 *  presentation mode — reuses the same three drawn placeholders as
 *  filmBox(), with the same 'preop' fallback for an unknown/future kind.
 *  Returns null for a falsy `kind`; the caller renders its own "no film"
 *  placeholder in that case (see presentSlide() below). */
/** Resolves an image type to its whitelisted key, or null. Kept as an
 *  export because the film viewer and its tests resolve types through a
 *  single guarded path — it returns a KEY, never artwork. */
export function filmArt(kind){
  const k = typeof kind === 'string' ? kind : kind && kind.type;
  return k ? resolveFilmKind(k) : null;
}


/** Human label for a film kind, e.g. for the viewer's title bar.
 *  hasOwnProperty rather than a plain lookup: `FILM_LABELS['constructor']`
 *  is inherited from Object.prototype and would otherwise be stringified
 *  into the viewer's title bar as literal JS source. */
export function filmLabelOf(kind){
  return Object.prototype.hasOwnProperty.call(FILM_LABELS, kind)
    ? FILM_LABELS[kind] : 'Film';
}

/** Film viewer title bar: "<b>Pre-op film</b>2 of 3". */
export function viewerTitle(kind, index, total){
  return `<b>${esc(filmLabelOf(kind))}</b>${index + 1} of ${total}`;
}

/** Command palette group heading, e.g. "Most used". */
export function paletteGroup(title){
  return `<p class="pal-g">${esc(title)}</p>`;
}

/** Command palette "nothing matched" state — rendered instead of an
 *  empty list so a search with no hits still reads as a deliberate
 *  answer, never a blank box. */
export function paletteNoMatch(query){
  return `<p class="pal-g">No match for "${esc(query)}"</p>`;
}

/** One selectable command-palette row (a patient match or an action).
 *  `index` is this row's position in the caller's flat, executable
 *  S.palRows array — app.js wires click/keyboard selection to that
 *  array by this same index via the `data-prow` attribute. */
export function paletteRow(icon, label, hint, index){
  return `<button class="pi" data-prow="${index}"><span class="pi-ic">${ic(icon)}</span>
 <span class="pi-t">${esc(label)}</span><span class="pi-h">${esc(hint)}</span></button>`;
}

/** Presentation-mode slide for one patient. Handles the no-film case
 *  explicitly (design spec §5): a `.pr-f.none` placeholder with the
 *  generic image icon, never an empty black box with no indication. */
export function presentSlide(p){
  const film = p.films[0];
  const src = film && film.src;
  const podLabel = p.pod != null
    ? esc(dayLabel(p)).toUpperCase()
    : esc(String(p.stat || '').toUpperCase());
  const filmPane = src
    ? `<div class="pr-f"><img src="${esc(src)}" alt="${esc(FILM_LABELS[resolveFilmKind(film.type)] || 'Film')}" decoding="async"></div>`
    : `<div class="pr-f none">${ic('img')}<span class="pr-fs">${film ? 'Film on file — not shown yet' : 'No imaging'}</span></div>`;
  return `${filmPane}
 <div class="pr-i"><div class="pr-bd">BED ${esc(p.bed)}</div><h2 class="pr-n">${esc(p.name)}</h2>
 <p class="pr-d">${esc(p.dx)}</p><p class="pr-p">${esc(p.age)} · ${esc(p.proc)}</p>
 <div class="pr-pod">${podLabel}</div>
 <div class="pr-pl"><b>Plan</b>${esc(p.plan || p.hist[0]?.[1] || '—')}</div></div>`;
}
