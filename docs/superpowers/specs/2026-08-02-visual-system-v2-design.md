# Visual System v2 — Design

**Date:** 2026-08-02
**Status:** Approved for planning.
**Prototype:** `docs/prototypes/ortho-v3.html` — clickable, all screens, verified headless (682 controls, 0 errors, 4 breakpoints).
**Builds on:** Existing token block in `public/index.html` (`:root`, lines ~18–100), `renderCard` / `renderCardQuickBar` / `renderSummaryStrip` in `public/app.js`, `withBusy` in `public/busy.js`, admin console modules.
**Supersedes for visual scope:** `POLISH.md` §UI items. Does not supersede `UPGRADE-PLAN.md` stage ordering.

## Problem

The visual layer has grown feature-by-feature without a governing structure. Four specific failures, all measurable in the current source:

1. **Command surface sprawl.** Twenty-one actions live in a `⋮ More` menu (`index.html` lines 2181–2201, duplicated in the desktop dropdown at 2032–2052). Presentation mode, Census, Handover sheet, Templates, Bulk plan, Organize, Consultant mode, PG roster, OT doctors, Default unit, Export, Import all have no discoverable home. Discovery degrades with every feature added.

2. **Four competing navigation systems.** Top tabs (4), bottom nav (5), summary strip (4 chips), filter chips (11) are simultaneously visible on the Rounds view. 38 interactive targets render before the first patient.

3. **No desktop layout.** Breakpoints top out at a 900px tweak. Cards are full-width rows at every width; opening one expands inline. On a ward workstation — the consultant and admin surface — roughly 60% of horizontal space is unused. There is no master-detail anywhere in the product.

4. **Breakpoint drift.** Six near-duplicate media queries (560, 680, 681, 699, 700, 720, 900) with no naming scheme. This is the mechanical cause of the recurring odd-width layout bugs.

Underneath all four: the app is orthopaedic but looks like generic health SaaS. The `--bone` / `--bone-line` / `--bone-ink` tokens exist and are essentially unused. Radiographs — the central artifact of the specialty — are represented as a text pill (`XR 2`).

## Goals

1. **One navigation model** that changes shape by viewport rather than two models stacked.
2. **Every feature has a findable home**, with discovery that improves rather than degrades as features are added.
3. **A real desktop layout** (master-detail) that makes the product credible to consultants and administrators.
4. **A visual language specific to orthopaedics** — radiographic imagery and post-op day as first-class visual elements, not badges.
5. **A CSS architecture** where subsequent visual change is cheap.
6. **One deliberately high-impact surface** (Presentation mode) that carries demo weight, keeping the daily path disciplined.

## Non-goals

- Framework, build step, or bundler. Vanilla JS, no new runtime dependencies.
- Rewriting `app.js` rendering. It continues to return HTML strings.
- Redesigning admin console internals beyond adopting shared tokens and the shell.
- Changing sync, merge, storage, scoping, or any clinical logic.
- Native app, biometric login, offline behaviour changes.
- Visual-regression or screenshot suites.

## Constraints

- **No build step.** CSS ships as layered files served directly; `app.js` stays a single script.
- **jsdom test suites load the real `index.html`.** Four existing frontend suites depend on current DOM structure. Any structural change must keep them green or update them in the same commit.
- **Offline-first.** No design element may require a network round-trip to render a patient row.
- **Bandwidth.** Hospital wifi is unreliable and users are frequently on mobile data. Any imagery must be thumbnailed server-side and lazy-loaded.
- **Touch targets** stay at or above current sizes.
- **WCAG AA** on all text, verified with the luminance formula as the existing tokens were.
- **`prefers-reduced-motion`** honoured throughout.
- **No PHI in imagery paths that leave the server.** Unchanged by this work, but the thumbnail pipeline must not introduce a new egress.

## Approach

Adopt the v3 prototype's structure, delivered in two tiers: a **committed tier** of high-confidence structural changes, and an **experimental tier** containing the one genuine bet, gated behind a flag with a written kill criterion.

Chosen over (a) re-skinning in place, which leaves the 1,950-line CSS monolith and repeats the pattern `MARKET-POSITION.md` flags as the velocity trap, and (b) full component rewrite, which stalls clinical work for weeks at 1.5/10 traction.

---

## 1 · Navigation and shell

**Three destinations** replace four tabs: **Round**, **Ward**, **Work**.

`OT list` and `Discharged` are demoted from destinations. OT list is a generated document; Discharged is an archive. Both remain reachable from the rail (desktop) and the palette (everywhere). Rationale: they are weekly-touch surfaces occupying two of four daily slots.

**The `⋮ More` menu is deleted** and replaced by a command palette:

- Invoked by `⌘K` / `Ctrl+K`, the `Go` slot in the bottom nav, or the header icon.
- Opens showing grouped pinned and recent actions **before any typing**, so it reads as a menu to a first-week user and as a search to an experienced one. This is the mitigation for the discoverability risk that moving 23 actions behind a search field otherwise creates.
- Searches patients and actions in one field.
- Keyboard: arrows, Enter, Esc.

**Contextual surfacing** complements the palette: Ward and Work each surface their 3–4 relevant actions inline, so no one hunts in the palette for "Generate handover" while looking at a handover.

**Header** drops from eight controls to four: title/date, round progress ring, sync state, palette. Add and Present move to where they are used.

### Breakpoint tiers

Six ad-hoc queries collapse to three named tiers:

| Tier | Width | Shape |
|---|---|---|
| `ward` | < 760px | Bottom nav, single column, hero card |
| `bench` | 760–1099px | Icon rail, no bottom nav, single column |
| `console` | ≥ 1100px | Rail + master-detail; rail expands to labels at ≥ 1300px |

## 2 · The Round screen

**`ward` tier:** ward spine (all beds, horizontally scrollable, filled as seen) → hero card for the current patient → up-next queue of 3.

**`console` tier:** spine → ordered patient list (352px) + full record pane.

**Escape hatches are mandatory, not optional.** A sequential UI that traps the user will be rejected on a real ward where the consultant reverses direction and patients are off in radiology:

- Any bed in the spine is tappable and jumps directly.
- `Skip` advances without marking seen, so the patient stays on the list and the round cannot close without them.
- Ward, Work and the palette all jump into the round at an arbitrary patient.

**Completion state.** When all patients are seen, the round resolves into a summary artifact (count, elapsed, flagged) with a direct route to handover, rather than emptying to a blank list.

## 3 · Patient card anatomy

Current collapsed card carries, at rest: plan input, up to 2 milestone buttons, status badge, PG chip, copy-yesterday button, antibiotic chips, handover pin, handover strip, flags. Nine control groups.

New anatomy:

- **Radiograph thumbnail** (104×136 hero, 27×33 in rows) as the leading element.
- **Identity block** — bed, name, age/sex, diagnosis, procedure.
- **POD track** — a horizontal rail from surgery to discharge with milestones as stations and the patient's marker positioned on it. Replaces the `POD 3` pill. Overdue stations render in `--bad`.
- **Flags** — unchanged semantics, tightened presentation.
- **Plan** — single input.
- **Action bar** — `Seen — next` plus `Skip`.

Everything else moves into the expanded record (`console`: always-visible right pane).

### Empty and degraded states

- **No imaging** (conservative cases, pre-admission): bone-tinted placeholder at identical dimensions carrying the imaging glyph. The row must scan identically whether or not a film exists.
- **No discharge anchor**: the track terminates at the last defined milestone rather than a `discharge` station.

## 4 · Radiographic visual language

- Films render on true film-black (`--film: #11151b` light, `#05080b` dark) with an inset hairline and a subtle centre lift.
- **Dark mode is a reading room**, not an inversion: deep blue-black page, mint accent, films gaining a soft outer glow.
- `--bone` family finally carries the empty-imaging and conservative-care states.
- Typography roles fixed: Fraunces for patient names and screen titles only; JetBrains Mono for beds, UHIDs, dates, counts; DM Sans for everything else. Tabular numerals globally.

## 5 · Presentation mode

The single deliberately maximal surface. Full-bleed near-black, film at up to 250×322, patient name at up to 58px, POD as a bordered monospace plate, plan below a hairline. Arrow-key navigation. This is the consultant-round surface and the demo surface; concentrating spectacle here is what allows the daily path to stay quiet.

## 6 · CSS architecture

Extract the 1,950-line inline block into layered files loaded in order, no build step:

| File | Contents |
|---|---|
| `css/tokens.css` | `:root`, `[data-theme]`, type/space scales, easing, shadows |
| `css/base.css` | reset, typography, focus, scrollbars, reduced-motion, print |
| `css/shell.css` | app grid, rail, header, spine, panes, bottom nav, breakpoint tiers |
| `css/card.css` | hero, film, identity, POD track, flags, plan, rows |
| `css/detail.css` | record pane, checklists, history, field grids |
| `css/board.css` | ward board, tables, documents, admin |
| `css/overlay.css` | palette, modals, film viewer, presentation, toast |

Extraction is mechanical and verifiable: the four jsdom suites load the real `index.html`, so a passing suite after extraction is direct evidence that no rule was lost.

## 7 · Feature-to-surface map

All 23 actions currently orphaned or duplicated, and their new home:

| Action | Home |
|---|---|
| Presentation mode | Palette (pinned) · `⇧P` |
| Generate handover | Palette (pinned) · Work inline |
| Morning brief | Palette (pinned) · Work inline |
| Check ward for risks | Palette (pinned) · Work inline |
| OT list | Rail · palette |
| Handover sheet | Rail · palette · round-complete state |
| Census | Palette |
| Discharged patients | Rail · palette |
| Export / Import backup | Palette |
| Ward board | Destination |
| Bulk plan select · Apply bulk plan | Palette · Ward inline |
| Organize patients | Palette · Ward inline |
| Unit handover note | Palette · Ward inline |
| PG roster | Palette |
| Default unit · Default OT doctors | Palette · OT list toolbar |
| Templates | Palette |
| Consultant mode | Palette |
| Dark mode / reading room | Header toggle · palette · `⇧D` |
| Change password · Admin console · Refresh | Palette · rail (admin) |

## 8 · Build prerequisites

Three items must exist before the card redesign can ship. Each is a real dependency, not a nice-to-have:

1. **Server-side thumbnails.** Film thumbnails at row scale (≈54×66 @2x) and hero scale (≈208×272 @2x), lazy-loaded, generated on upload. Without this the redesign makes rounds *slower* on hospital wifi, which is the one outcome that loses users.
2. **Discharge anchor.** The POD track's right terminus needs a target discharge date, either stored or derived from the milestone set. Absent it, the track ends at the last milestone (see §3).
3. **Imaging-coverage measurement.** Before committing to film-as-hero, measure what fraction of live patients actually have an uploaded film. Below ~40%, the hero slot is mostly placeholder and the design is worse than today — in which case the film demotes to a row-scale element and identity leads.

## 9 · Delivery tiers

**Tier A — committed.** High confidence, ships regardless of experiment outcome.

- Breakpoint consolidation to three named tiers
- CSS extraction into layered files
- Command palette replacing `⋮ More` (both copies)
- Header reduction; three destinations; OT list and Discharged demoted
- `console` master-detail for Round and Work
- Card density reduction
- Token refresh, reading-room dark mode, print stylesheet
- Film viewer, focus-visible rings, reduced-motion audit

**Tier B — experimental, flagged.** The sequential round (`roundSequence` flag, default off).

- **Kill criterion:** if, across at least three PGs over five consecutive weekday rounds, median time-to-complete-round is not faster than the current list view, or PGs disable it when given the choice, the sequential surface is removed and the Round destination reverts to a filtered list using the new card. The spine, completion state, and card anatomy survive either way — they are Tier A.

## 10 · Validation

Before Tier B is funded: the prototype goes in front of three PGs and one department head, twenty minutes each, observed. This converts the central assumption into evidence and doubles as the design-partner conversation `MARKET-POSITION.md` identifies as the highest-return open item.

## Success criteria

1. Interactive targets before the first patient row: 38 → ≤ 10.
2. Every one of the 23 actions reachable in ≤ 2 interactions from any screen.
3. Master-detail present on Round and Work at ≥ 1100px.
4. Media queries: 6 near-duplicates → 3 named tiers, zero others.
5. Inline `<style>` in `index.html`: ~1,950 lines → 0.
6. All existing frontend suites green; no regression in sync, merge, scoping or storage tests.
7. WCAG AA on all text in both themes, luminance-verified.
8. No increase in time-to-first-patient-row on a throttled 3G profile.

## Open questions

- Whether nurses (flagged as a future need in the hierarchy work) need a fourth destination or inherit Ward with a narrowed scope. Deferred; does not block Tier A.
- Whether Consultant mode becomes a distinct shell at `console` tier rather than a display toggle. Deferred pending the department-head session.
