# Product Polish Plan

Written before resuming Phase 1 (auth/sync scoping). Purpose: the current
single-tenant product is what real users touch every day, and it just grew
fast — `public/app.js` went from ~7,600 to ~8,500 lines and the test suite
from 78 to 100 tests over the last stretch of concurrent work (OT list
export, Smart Fill on desktop, X-ray zoom fixes, discard-prompt changes, the
icon unification). That's healthy velocity, but it's also the point where
skipping a deliberate polish pass starts costing more than it saves. This is
that pass, prioritized by risk and value, not by what's easiest.

## Priority 1 — Frontend test coverage (highest risk, do first) — 🟡 STARTED

`public/app.js` (8,487 lines) and `public/milestones.js` (628 lines) had
**zero automated tests**, while every backend module does (100 tests across
9 files). That asymmetry is the single biggest risk in the codebase right
now: the frontend is also the most actively changed surface (three
unrelated people/sessions touched X-ray viewer logic alone in the last
stretch), and a regression there ships straight to whoever's on call
tonight, silently, since nothing would catch it.

**Done:** a jsdom-based harness (`tests/helpers/frontend-env.js`) that loads
the real `index.html` + `app.js` into a test environment without a browser
binary, plus a first real test file (`tests/frontend-icons-and-xray-viewer.test.js`,
7 tests) covering the icon registry and the X-ray zoom/pan state machine —
the newest, least-protected code. Runs in CI as-is (jsdom is pure JS, no
native binary, so `npm ci` picks it up fine on GitHub Actions' runner,
unlike Playwright/Chromium which needs system libraries this sandbox
couldn't install). **Still open:** the other ~8,400 lines remain untested —
this is a start, not full coverage. Next candidates: the sync/merge glue on
the client side, worklist item collection, and the admission/scribe parsing
bridges.

Full pixel/visual testing isn't viable in every environment (headless
Chromium needs system libraries this sandbox doesn't have and can't install
without root) — but that's not what matters most here. What matters is
*behavioral* coverage of pure logic: the X-ray viewer's zoom/pan state
machine, the icon registry, escapeHTML, date/status calculations, merge-ish
helper functions. `jsdom` gives real DOM behavior (classList, event
dispatch, getBoundingClientRect stubs) without a browser binary, which is
enough to unit-test this class of logic today.

**Concrete first step:** stand up a `jsdom`-based harness and write real
tests for the newest, least battle-tested code — the X-ray viewer zoom
functions (`applyImgViewerTransform`, `resetImgViewerZoom`,
`toggleImgViewerZoom`, the pinch/pan gesture math) and the `uiIcon` registry.
Not because they're the most important features, but because they're the
most recently written and currently the least protected.

## Priority 2 — Responsive desktop/tablet layout — 🟡 STARTED (Rounds view done)

Confirmed still true when this was written: `.view{max-width:880px;margin:0
auto;}` — the whole app was a single centered column at every viewport
width above 680px. A laptop, an iPad in landscape, or a ward-mounted
display all got a narrow column with dead space on both sides instead of a
2–3 column card grid.

**Done:** the Rounds view (the main daily-use screen) now widens to 1400px
and shows patient cards in a responsive multi-column grid
(`repeat(auto-fill, minmax(360px, 1fr))`) above 900px, while staying
completely untouched below that (phones/small tablets get the exact same
single-column list as before). The currently-open/expanded card always
spans the full grid width regardless of column count, so detail editing
never feels cramped inside a narrow column. Only one card can ever be open
at a time app-wide (`openCardId` is a single value), so the one trade-off
of CSS grid vs a true masonry layout — uneven row height when one item is
much taller — affects at most one row, and even then the open card isn't
actually inside that row's columns.

**Still open:** the Worklist and OT list views are unchanged — scoped out
of this pass to keep it bounded and low-risk; worth a follow-up pass since
they're both used on the same wide-viewport devices, but their structure
(single-column item lists / table-like OT list) needs its own look rather
than reusing the ward-grid approach.

## Priority 3 — Deliberate device-testing pass on touch/gesture surfaces — 🟡 STARTED (code audit done)

The X-ray pinch-zoom bug existed because nobody tested pinch gestures on a
real touchscreen until a user hit it live. That's a pattern, not a one-off,
so the first thing worth doing — without needing a physical device — is a
code-level audit for the exact same bug shape everywhere it could recur.

**Done:** audited every custom touch-gesture handler in `app.js` (there are
three; searched for every `addEventListener('touchstart', ...)`):

- `bindImgViewerGestures` (X-ray viewer) — already fixed.
- `bindPresentationSwipe` (swipe between patients in presentation mode) —
  **had the identical bug.** It only ever read `changedTouches[0]` with no
  idea whether one or two fingers were down. Presentation mode shows X-ray
  thumbnails inline (`renderPresentationXrays`); a user pinching one of
  those before realizing they need to tap it open first would have each
  finger clear the swipe threshold and flip to the next/previous patient
  mid-pinch — same failure, different screen. Fixed the same way: track
  whether any touchmove ever saw a second finger, and never treat that
  gesture as a swipe if so.
- The FAB long-press handler (tap-and-hold to clone the last patient) —
  reviewed, single-touch only by design, no multi-touch or competing
  gesture system involved, no issue found.

**Still open:** turned up nothing during the audit doesn't mean nothing's
there — actual finger-on-glass testing (bulk plan select, the scribe voice
modal's mic button under real conditions, general scroll/tap feel) still
needs a real phone/tablet, ideally by someone trying to break it the way a
tired PG on night rounds would. The code-level half of this priority is
done; the device-in-hand half isn't.

## Priority 4 — Presentation-mode readability variant — ✅ DONE

Presentation mode's existing type scale was sized for a phone/tablet held
at arm's length. Added an opt-in "Large text" toggle (Options panel,
sticky across sessions like the other presentation options) that further
enlarges the headline, meta, plan, script, and flag text and boosts muted
text to full white — for reading from across a room off a projector or a
wall-mounted display. Day-to-day presenting on a handheld device is
unaffected; this is additive, not a redesign of the default.

## Priority 5 — Contrast + print-safety audit — ✅ DONE

**Contrast:** ran the actual WCAG relative-luminance formula (not eyeballed)
against every status color pair in both themes. Found four real failures,
all narrowly under the 4.5:1 normal-text threshold (they all already passed
the 3:1 large-text/UI threshold, so nothing looked obviously broken):
`--good` on `--good-bg` (4.29:1), `--warn` on `--warn-bg` (4.24:1), and
`--bone-ink` on `--bone` (4.49:1) in light mode; `--accent` on
`--accent-soft` (4.11:1) in dark mode. Fixed each with the minimal color
nudge that clears 4.5:1 — all four adjustments are small enough to be
visually imperceptible as a color shift (e.g. `#3f7d5c` → `#3d7959`),
verified by recomputing the ratios after the change (4.53–4.56:1 across
the board).

**Print-safety:** the assumption going in — that the app's generic
`@media print` CSS was what actually gets printed — turned out to be
wrong. The two real print features (OT list export, handover sheet) both
open a separate popup window and write a fully self-contained HTML
document via `buildHandoverSheetHtml()`, with their own `<style>` block
that never touches the main page's CSS at all. The handover sheet already
shows status and flags as plain text in dedicated table columns, not color
alone, so that specific worry didn't apply. But the audit surfaced a real
bug instead: the handover-pin `uiIcon('pin')` SVG (added during icon
unification) had no size/color of its own outside the main page's
`.icon-svg` CSS class — inside the popup's isolated stylesheet, it would
have rendered at the browser's ~300×150px default SVG size and broken that
table's layout. Fixed by making every `uiIcon()` output self-contained
(explicit `width`/`height`/`fill`/`stroke` attributes on the `<svg>` itself,
not just a CSS class), so it degrades gracefully with zero external CSS —
protects against the same class of bug in any future export/print/email
context, not just this one.

## Priority 6 — Housekeeping

- [x] `package.json` bumped `2.0.0` → `2.1.0` — substantial feature growth
  since 2.0.0 (OT list export, WhatsApp intake, scribe, risk-flagging, push
  notifications, the roadmap/telemetry/multi-tenant scaffolding) with no
  breaking changes, so a minor bump.
- README is actually current (it already documents OT list export) — no
  action needed there, confirmed while researching this plan.
- `AGENTS.md`'s stale "single shared password" description has already been
  corrected by other work — also confirmed, no action needed.

## What's explicitly out of scope here

New features, and Phase 1's auth/sync scoping. This is a polish pass on
what exists, not feature work — the point is to reduce risk and rough edges
before adding more surface area, not to add more surface area.

## Suggested order — all six priorities now have work done against them

1. ~~Frontend test harness (Priority 1)~~ — harness + first tests shipped; broader coverage of the rest of `app.js` remains open.
2. ~~Responsive desktop/tablet layout (Priority 2)~~ — Rounds view done; Worklist/OT list intentionally deferred to their own pass.
3. ~~Device-testing pass (Priority 3)~~ — code-audit half done (found and fixed a real bug); device-in-hand half still needs an actual phone/tablet.
4. ~~Presentation-mode readability (Priority 4)~~ — done.
5. ~~Contrast/print audit (Priority 5)~~ — done; also fixed a real print-layout bug the audit surfaced.
6. ~~Housekeeping (Priority 6)~~ — done.

**What's left across the whole plan:** broader `app.js` test coverage beyond the first file, the Worklist/OT list responsive layout, and real device testing of touch surfaces. Everything else on this list has shipped.
