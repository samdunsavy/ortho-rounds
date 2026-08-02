import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootV2 } from './helpers/v2-env.js';

const raw = n => ({ id:'p'+n, bed:String(n), name:'P'+n, age:'40', sex:'M',
  diagnosis:'Dx'+n, status:['preop','postop','conservative','fordischarge'][n%4],
  surgeryDate:'2026-07-29', images: n%2 ? [{type:'preop'}] : [],
  postOpChecks:[{ id:'s', label:'Suture removal', duePod:12, status:'pending' }],
  dischargeChecks:[{ id:'d', label:'Summary', status:'pending' }],
  planHistory:[{ date:'2026-08-01', text:'Prior plan' }], labs:{ Hb:'11' } });
const ward = [1,2,3,4,5,6].map(raw);
const VIEWS = ['round','ward','work','ot','handover','disch','admin'];

const SEL = '[data-open],[data-go],[data-act],[data-seen],[data-skip],[data-copy],'
  + '[data-ck],[data-dc],[data-work],[data-film],[data-toast],[data-reset],'
  + '[data-add],[data-close],[data-prow],[data-pnav],[data-vnav],[data-pclose],'
  + '[data-vclose],[data-retry],[data-print],#themeBtn';
// [data-print] added to the brief's SEL list: public/v2/app.js's click
// handler wires a real data-print action (OT list's "Print / PDF" and the
// handover sheet's "Print" button both carry it, calling WIN.print?.()) —
// the brief's list omitted it. Per the task-10 instructions, a control the
// list misses must be added, never left out to keep the list matching the
// brief verbatim.

/* `document.querySelectorAll(SEL)` returns a STATIC NodeList, snapshotted
   once. app.js's render functions (rSpine/rRound/rWork/...) mutate their
   containers via wholesale `innerHTML = ...` reassignment, not targeted
   DOM patching — so any click in the snapshot whose handler re-renders a
   container DETACHES every other snapshotted node that used to live
   inside it. A detached node's `.click()` still runs (no throw — it's a
   real DOM method) but the resulting 'click' event has no path to
   `document`, since bubbling requires a connected ancestor chain, so
   app.js's single delegated `DOC.addEventListener('click', ...)` never
   sees it. The handler silently never runs.

   This bites hardest on the round view: the rail's OWN "Round" button
   (data-go="round") is always first in document order (the <aside
   class="rail"> precedes the view body), so it is always the first
   element clicked in every per-view sweep below — including sweeps of
   OTHER views, since rail is present everywhere. Clicking it calls
   go('round') -> rSpine() + rRound(), which reassign #spine, #roundList
   and #roundDet's innerHTML unconditionally, every single time, even if
   the view was already 'round'. Every data-open/data-film/data-copy/
   data-ck/data-dc/data-seen/data-skip control that lives inside those
   three containers therefore gets detached before the snapshot's
   iteration ever reaches it — verified empirically (a probe script
   instrumented the real document-level click listener and found
   data-seen/data-ck/data-dc/data-skip/data-copy/data-film all fired
   ZERO times across a full sweep, despite being present in every
   snapshot) — so a literal single-pass `for...of
   document.querySelectorAll(SEL)` sweep is vacuous for most of the round
   view's own controls: this is the "overlay swallows subsequent clicks"
   risk the task brief calls out, just triggered by a view's own
   self-re-render instead of a literal scrim.

   Fixing this by tracking "already clicked" per NODE OBJECT (a WeakSet)
   does not converge: several containers re-render themselves in response
   to their OWN child's click — #spine's bed buttons call openPatient(),
   which re-renders #spine itself even when already on the round view
   (app.js's openPatient: the `else` branch runs `rSpine(); rRound();`
   unconditionally); #board's tiles route through the same call whenever
   the round view is re-entered; go(v) itself re-renders unconditionally
   even when `v` already equals the current view. Every one of those
   re-renders is a wholesale `innerHTML` reassignment, so it manufactures
   brand-new DOM node objects with byte-identical markup — a WeakSet
   keyed on node identity can never recognise "I already exercised the
   control that lives at this position" and the sweep spins forever
   (verified empirically: capped at an arbitrary pass limit, it pegged the
   cap on every single view, every width, never converging).

   Fixed by keying "already clicked" on a STABLE identity instead of node
   identity: the id of the nearest ancestor with one (e.g. "spine",
   "board", "roundDet", "workList" — every container these controls live
   in has an id in index.html) plus the element's own data-attribute and
   id values. Two nodes at different times that represent "the same
   control" (e.g. bed 3's spine button before and after a re-render) share
   this key and are only clicked once; two nodes that are genuinely
   different controls (e.g. bed 3's button in #spine vs. bed 3's tile in
   #board, both `data-open="3"`) have different keys because their
   ancestor ids differ, so both still get clicked. This was verified with
   a probe against the real document-level click listener: with node-
   identity tracking, data-seen/data-ck/data-dc/data-skip/data-copy/
   data-film fired the underlying handler ZERO times across a full sweep;
   with key-based tracking every one of them fires a non-zero number of
   times at the width where the control is actually rendered (data-copy
   only exists in the mobile hero card, width < 1100 — see task-10-
   report.md for the exact counts per width). Convergence in practice is
   ~20 passes for a 6-patient ward; the pass cap below is a wide safety
   margin, not a tuned value — hitting it is itself reported as a finding
   rather than silently truncating the sweep. */
function controlKey(el){
  const container = el.closest('[id]');
  const attrs = [...el.attributes]
    .filter(a => a.name.startsWith('data-') || a.name === 'id')
    .map(a => `${a.name}=${a.value}`).sort().join(',');
  return `${container ? container.id : ''}|${el.tagName}|${attrs}`;
}
function sweepToFixedPoint(document, errors, view){
  const done = new Set();
  for(let pass = 0; pass < 200; pass++){
    const fresh = [...document.querySelectorAll(SEL)].filter(el => !done.has(controlKey(el)));
    if(!fresh.length) return;
    for(const el of fresh){
      done.add(controlKey(el));
      try { el.click(); } catch(e){ errors.push(`${view}: ${e.message}`); }
    }
  }
  errors.push(`${view}: sweep did not converge within 200 passes`);
}

for(const width of [360, 760, 1100, 1440]){
  test(`every control fires cleanly at ${width}px`, async () => {
    const { document, api, errors } = await bootV2({ patients: ward, width });
    for(const view of VIEWS){
      api.go(view);
      sweepToFixedPoint(document, errors, view);
    }
    assert.deepEqual([...new Set(errors)], []);
  });
}

test('a full round reaches the completion state', async () => {
  const { document } = await bootV2({ patients: ward });
  for(let i = 0; i < ward.length + 2; i++){
    document.querySelector('[data-seen]')?.click();
  }
  assert.ok(document.body.textContent.includes('Round complete'));
});

test('no view leaves its pane empty', async () => {
  const { document, api } = await bootV2({ patients: ward });
  for(const view of VIEWS){
    api.go(view);
    const pane = document.querySelector(`#v-${view}`);
    assert.ok(pane.textContent.trim().length > 0, `${view} rendered nothing`);
  }
});

test('an empty ward renders an empty state, not a blank screen', async () => {
  const { document, api } = await bootV2({ patients: [] });
  for(const view of VIEWS){
    api.go(view);
    assert.ok(document.querySelector(`#v-${view}`).textContent.trim().length > 0,
      `${view} is blank with no patients`);
  }
});
