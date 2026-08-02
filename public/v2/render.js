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
  return kind
    ? `<button class="fbox ${cls}" data-film="${pi}:${kind}" aria-label="View ${esc(FILM_LABELS[kind] || 'film')}">${FILMS[kind] || FILMS.preop}${cap ? `<em>${esc(cap)}</em>` : ''}</button>`
    : `<div class="fnone ${cls}" role="img" aria-label="No imaging on file">${ic('img')}</div>`;
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
