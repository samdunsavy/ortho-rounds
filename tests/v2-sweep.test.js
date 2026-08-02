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
   identity: a description of the element's position in the tree (not its
   object identity, which a re-render replaces) plus its own data
   attributes. Two nodes at different times that represent "the same
   control" (e.g. bed 3's spine button before and after a re-render) share
   this key and are only clicked once; two nodes that are genuinely
   different controls still get different keys, so both still get
   clicked. This was verified with a probe against the real
   document-level click listener: with node-identity tracking,
   data-seen/data-ck/data-dc/data-skip/data-copy/data-film fired the
   underlying handler ZERO times across a full sweep; with key-based
   tracking every one of them fires a non-zero number of times at the
   width where the control is actually rendered (data-copy only exists in
   the mobile hero card, width < 1100). Convergence in practice is
   ~20-30 passes for a 6-patient ward; the pass cap below is a wide safety
   margin, not a tuned value — hitting it is itself reported as a finding
   rather than silently truncating the sweep.

   Fix round 1 (Finding 1) — the first version of this key used only the
   id of the NEAREST ANCESTOR WITH AN ID, on the theory that "two controls
   under different container ids have different keys". That theory is
   false whenever the ancestor chain between an element and its nearest
   id-bearing ancestor is itself ambiguous, and several real controls sit
   in exactly that gap: `<aside class="rail">`, `<header class="hd">` and
   `<nav class="nav">` (public/v2/index.html) carry no id at all, so their
   `closest('[id]')` walk fell straight through to `null` for all three —
   collapsing the rail's, header's and bottom nav's `data-act="pal"`
   buttons onto ONE key, and the rail's and bottom nav's `data-go="round"`
   /`"ward"`/`"work"` buttons onto one key each. Likewise the add-modal's
   header-X and footer-Cancel `data-close="1"` buttons share the same
   nearest id (`#addM`), so they collapsed too. A collision means only one
   member of the group is ever clicked; the previous version of this
   comment claimed the opposite ("ancestor ids differ") for exactly this
   case, which was simply wrong — verified wrong by an explicit collision
   probe (see the 'controlKey does not collide...' test below).

   The fix widens the identity from "nearest id-bearing ancestor" to the
   FULL ancestor chain up to (and including) `<body>`: each ancestor
   contributes its tag name, id (if any), and its FIRST class token (the
   base/structural class — this codebase's convention, visible throughout
   render.js/app.js, is always `class="base ${dynamicModifier}
   ${otherModifier}"`, base first, e.g. "sp" before "now"/"seen"/"flag",
   "view" before "on"/"split"). Only the first token is used deliberately:
   later tokens are exactly the state-dependent modifier classes
   (`.classList.toggle('on', ...)`, `.now`/`.seen`/`.flag`/`.done`/`.due`)
   that change *during* a sweep as patients get seen/skipped or the active
   view changes — folding those into the key would make the "same"
   control's key drift mid-sweep and defeat convergence exactly the way
   node-identity tracking did (this was hit empirically while building
   this fix: including the full class list stalled the sweep the same way
   the original WeakSet attempt did, for the same underlying reason —
   drifting identity). The element's own data- and id attributes are added
   on top, plus its index among same-selector siblings under its immediate
   parent, as a tie-breaker for any two structurally-identical controls
   that share a container and carry no distinguishing data attribute.
   `<aside>`/`<header>`/`<nav>` are different tag names, so the pal/go
   buttons split apart on that alone; the add-modal's two close buttons
   split on their immediate parent's class (`md-h` vs `md-f`), which is
   static — never toggled — so it's safe to key on.

   Re-verified with the same document-level-listener probe as above:
   handler invocation counts are IDENTICAL to the pre-fix numbers at every
   width (see task-10-report.md's "Fix round 1" section for the full
   before/after table) and a dedicated collision probe over the live DOM,
   after visiting every view, finds zero duplicate keys — where the old
   scheme found 6 (see the report). */
function firstClass(el){
  if(typeof el.className !== 'string' || !el.className.trim()) return '';
  return el.className.trim().split(/\s+/)[0];
}
function describeNode(el){
  const id = el.id ? `#${el.id}` : '';
  const cls = firstClass(el) ? `.${firstClass(el)}` : '';
  return `${el.tagName}${id}${cls}`;
}
function ancestorPath(el){
  const parts = [];
  let node = el.parentElement;
  while(node){
    parts.unshift(describeNode(node));
    if(node.tagName === 'BODY') break;
    node = node.parentElement;
  }
  return parts.join('>');
}
function siblingIndex(el){
  const parent = el.parentElement;
  if(!parent) return 0;
  return [...parent.children].filter(c => c.matches(SEL)).indexOf(el);
}
function controlKey(el){
  const attrs = [...el.attributes]
    .filter(a => a.name.startsWith('data-') || a.name === 'id')
    .map(a => `${a.name}=${a.value}`).sort().join(',');
  return `${ancestorPath(el)}>${describeNode(el)}|${attrs}|#${siblingIndex(el)}`;
}

/* Fix round 1 (Finding 2) — `ctx`, when supplied, records the (view,
   width, key) of whatever control is about to be clicked, so a failure
   can be traced to it from EITHER of the two places a handler's error
   can surface:

   1. The `catch` below. This is NOT dead code — `el.click()` can still
      throw synchronously for reasons unrelated to app.js's delegated
      listener (e.g. a call on a node jsdom considers invalid) — but it is
      never hit by a throw raised INSIDE that listener.
   2. A throw inside app.js's single delegated `DOC.addEventListener
      ('click', ...)` listener. Confirmed empirically: jsdom's `.click()`
      returns normally to the caller even when a listener it invokes
      throws — the exception instead surfaces as a `window` 'error' event
      carrying only `e.message` (no stack, no origin). tests/helpers/
      v2-env.js:73 (off-limits — shared by other suites) already listens
      for that event and pushes the bare message onto the `errors` array
      bootV2 returns. Each width-test below adds its OWN 'error' listener
      on the same `window`, registered after bootV2 returns and therefore
      run AFTER v2-env.js's (event listeners fire in registration order):
      it reads `ctx.current` (set immediately before this function's own
      `el.click()` call) and rewrites the bare message v2-env.js just
      pushed into one prefixed with the view, width and control key that
      were active when the event fired — supplementing what v2-env.js
      collected, never replacing its listener or its logic. */
function sweepToFixedPoint(document, errors, view, width, ctx){
  const done = new Set();
  for(let pass = 0; pass < 200; pass++){
    const fresh = [...document.querySelectorAll(SEL)].filter(el => !done.has(controlKey(el)));
    if(!fresh.length) return;
    for(const el of fresh){
      const key = controlKey(el);
      done.add(key);
      if(ctx) ctx.current = { view, width, key };
      try {
        el.click();
      } catch(e){
        errors.push(`${view} @ ${width}px [${key}]: ${e.message}`);
      } finally {
        if(ctx) ctx.current = null;
      }
    }
  }
  errors.push(`${view} @ ${width}px: sweep did not converge within 200 passes`);
}

for(const width of [360, 760, 1100, 1440]){
  test(`every control fires cleanly at ${width}px`, async () => {
    const { document, api, errors, window } = await bootV2({ patients: ward, width });
    const ctx = { current: null };
    window.addEventListener('error', () => {
      if(!ctx.current) return;
      const bare = errors.pop();
      errors.push(`${ctx.current.view} @ ${ctx.current.width}px [${ctx.current.key}]: ${bare}`);
    });
    for(const view of VIEWS){
      api.go(view);
      sweepToFixedPoint(document, errors, view, width, ctx);
    }
    /* Dedup decision (Fix round 1, "Also consider"): every entry now
       embeds view+width+key, and within one run of this test a given
       (view, width, key) triple is clicked at most once (the fixed-point
       `done` set prevents re-clicking within a view's sweep, and this
       loop visits each view exactly once at this one width) — so two
       array entries can only be textually equal if the SAME click threw
       the SAME message, which is exactly a legitimate duplicate the
       original brief's dedup was written to tolerate, not a case where
       context is lost. The Set-based dedup is therefore a harmless no-op
       against the new context-bearing strings, not a hazard — kept as-is
       rather than removed, since removing it would be a behavior change
       with no observed upside. */
    assert.deepEqual([...new Set(errors)], []);
  });
}

test('controlKey does not collide between structurally distinct controls', async () => {
  /* Finding 1's collision proof. Visits every view (so every container —
     rail, header, bottom nav, and every view's own containers — has real
     content) at every width the sweep runs at, then asserts controlKey()
     is injective over every control present. This is what actually
     caught the pre-fix bug: at 1440px alone the old id-ancestor key
     produced 6 collisions (rail/header/bottom-nav's data-act="pal" ×3,
     rail/bottom-nav's data-go="round"/"ward"/"work", and the add-modal's
     two data-close="1" buttons) — see task-10-report.md's "Fix round 1"
     section for the full list. */
  for(const width of [360, 760, 1100, 1440]){
    const { document, api } = await bootV2({ patients: ward, width });
    for(const view of VIEWS) api.go(view);
    const seen = new Map();
    const collisions = [];
    for(const el of document.querySelectorAll(SEL)){
      const key = controlKey(el);
      if(seen.has(key)){
        collisions.push(`${key}\n    A: ${seen.get(key)}\n    B: ${el.outerHTML.slice(0, 100)}`);
      } else {
        seen.set(key, el.outerHTML.slice(0, 100));
      }
    }
    assert.deepEqual(collisions, [],
      `controlKey collided for distinct controls at ${width}px:\n${collisions.join('\n')}`);
  }
});

test('a thrown handler error names its view, width and control', async () => {
  /* Finding 2's proof. Deliberately breaks a real handler — [data-print]
     on the 'ot' view calls `WIN.print?.()` (public/v2/app.js) — by
     overriding the `window.print` no-op bootV2 installs so it throws.
     That throw happens INSIDE app.js's delegated click listener, which is
     exactly the failure mode Finding 2 is about: it never reaches the
     `catch` in sweepToFixedPoint (verified in the comment above it), only
     the `window` 'error' listener registered here, mirroring exactly what
     each width-test above does. Before this fix, the recorded failure
     would have been the bare string "deliberate test throw" — no view, no
     width, no control. */
  const { document, api, errors, window } = await bootV2({ patients: ward, width: 1440 });
  const ctx = { current: null };
  window.addEventListener('error', () => {
    if(!ctx.current) return;
    const bare = errors.pop();
    errors.push(`${ctx.current.view} @ ${ctx.current.width}px [${ctx.current.key}]: ${bare}`);
  });
  window.print = () => { throw new Error('deliberate test throw'); };

  api.go('ot');
  sweepToFixedPoint(document, errors, 'ot', 1440, ctx);

  const failure = errors.find(m => m.includes('deliberate test throw'));
  assert.ok(failure,
    `expected a recorded failure mentioning the deliberate throw; got: ${JSON.stringify(errors)}`);
  assert.match(failure, /^ot @ 1440px \[.*data-print.*\]: deliberate test throw$/);
});

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
