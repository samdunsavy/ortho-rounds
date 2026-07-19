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

## Priority 2 — Responsive desktop/tablet layout

Confirmed still true: `.view{max-width:880px;margin:0 auto;}` — the whole
app is a single centered column at every viewport width above 680px. A
laptop, an iPad in landscape, or a ward-mounted display all get a narrow
column with dead space on both sides instead of a 2–3 column card grid.
This was flagged before the icon-unification pass and deliberately deferred;
it's still the right next visual investment, especially since presentation
mode (used in front of consultants) and daily rounds both run on exactly
these device sizes.

## Priority 3 — Deliberate device-testing pass on touch/gesture surfaces

The X-ray pinch-zoom bug existed because nobody tested pinch gestures on a
real touchscreen until a user hit it live. That's a pattern, not a one-off —
other touch-heavy surfaces (presentation-mode swipe between patients, bulk
plan select, the scribe voice modal) were built the same way and haven't
had the same scrutiny yet. Recommend one deliberate pass: open each on an
actual phone/tablet, try to break it the way a tired PG on night rounds
would, before the next feature builds on top of any of them.

## Priority 4 — Presentation-mode readability variant

Not yet done. Presentation mode is read from a few feet away, in front of an
audience, but currently shares the same compact type scale as the everyday
ward-list view. A larger, higher-contrast variant for presentation mode
specifically (distinct from the dense day-to-day list) is a cheap, visible
win for the feature most likely to be seen by someone deciding whether this
tool looks credible.

## Priority 5 — Contrast + print-safety audit

Two related, still-open items from the earlier visual review: the status
colors (good/warn/bad, phase tints) haven't been checked against WCAG AA
formally, and the print stylesheet's status pills lean on color alone,
which won't survive a plain black-and-white hospital printer. Both are
cheap to verify, neither has been done yet.

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

## Suggested order

1. Frontend test harness (Priority 1) — protects everything that comes after it, including the polish work itself.
2. Responsive desktop/tablet layout (Priority 2) — highest visible impact.
3. Device-testing pass (Priority 3) — cheap, catches real bugs like the zoom one before users do.
4. Presentation-mode readability (Priority 4) and contrast/print audit (Priority 5) — bundle together, similar surface area.
5. Housekeeping (Priority 6) — do whenever, lowest stakes.
