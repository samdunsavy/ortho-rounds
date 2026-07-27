# Admin Console Premium Craft — Design

**Date:** 2026-07-27  
**Status:** Implemented.  
**Builds on:** `docs/superpowers/specs/2026-07-27-admin-console-redesign-design.md` (sidebar shell, icons, master-detail — implemented) and `docs/superpowers/specs/2026-07-27-admin-console-visual-polish-design.md` (quiet tokens + busy state — implemented). Audit section from T2 remains in the nav and gets the same instrument treatment.

## Problem

The console now has sound IA (Overview / People / Structure / Organizations / Audit) and a utilitarian redesign, but it still reads as a competent internal tool — not a product that feels expensive. Flat surfaces, inherited clinical type, thin motion, and thin empty states leave a “half-finished admin form” impression. The operator opens Admin and gets structure, not presence.

## Goals

1. **Premium showcase** — Admin may visually lead Ortho Rounds for a while; craft is allowed to outshine the ward UI until tokens are ported later.
2. **Master Control Overview** — cinematic, systems-aware first screen: live telemetry, HUD-scale KPIs, alert queue — not a calm SaaS dashboard.
3. **Instrument working sections** — People / Structure / Orgs / Audit feel dense, precise, and tool-like.
4. **Expressive CSS motion** — choreographed enters and pane transitions; tasteful, never bouncy; fully disabled under `prefers-reduced-motion`.
5. **Finished edges** — empty states, focus, busy, and copy so no blank holes remain.

## Non-goals

- New admin capabilities, routes, or AI generation on Overview (no fake chat, no new OpenAI calls for the console).
- New runtime dependencies, frameworks, bundlers, or motion libraries (GSAP etc. explicitly out).
- Redesigning rounds / patient UI in this pass.
- Phone-first redesign (desktop is the hero; phone stays usable via the existing collapsed nav).
- Purple neon / sci-fi glow kitsch; decorative infinite loops beyond a tiny live pulse.

## Constraints

- **Frontend-only.** Touch `public/index.html` (fonts, admin CSS, minimal markup hooks) and `public/admin-*.js` builders for class hooks, telemetry markup, empty states, and stagger indices. No `server.js` / `admin.js` / API changes.
- **No new packages.** Fonts via the existing Google Fonts (or equivalent link) pattern only.
- **Preserve behavior.** Every `data-*` attribute, element `id`, delegated handler, mutation flow, `adminLoadSeq` race guard, and soft busy lifecycle stays. Section visibility rules (including Audit / Organizations) unchanged.
- **Touch targets ≥44px.** Do not shrink controls for aesthetics.
- **`MULTI_TENANT` off** → console unreachable; sync-golden stays green.
- **Dark mode** continues via existing `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]` hooks; admin tokens define both light and dark steps.

## Approach

**Craft pass on the current shell** (Approach 1): admin-scoped token + type layer, Master Control Overview, instrument restyle of working sections, shared CSS motion primitives, and empty-state polish. Chosen over a parallel theme class (double CSS tax) and over a deeper chrome/IA rethink (risk without the requested payoff).

---

## 1. Visual system

Scoped under `#adminView` so rounds stay untouched.

### Type

| Role | Face | Use |
|------|------|-----|
| UI | **Plus Jakarta Sans** | Nav, tables, body, instrument chrome |
| Display | **Fraunces** | Overview KPI numbers and Master Control title weight |
| Meta | **JetBrains Mono** (existing) | Timestamps, counts, telemetry values, breadcrumbs |

Loaded via the same external font-link pattern as DM Sans today. Admin CSS sets `--admin-font-ui` / `--admin-font-display` / `--admin-font-mono` under `#adminView`; rounds keep DM Sans.

### Admin tokens

New custom properties under `#adminView` (and dark counterparts), layered on top of existing app tokens where useful:

- **Surfaces:** `--admin-paper`, `--admin-card`, `--admin-elevated` (deeper paper → card → elevated panel)
- **Accent steps:** richer soft / hover / active in the teal family (no new hue family)
- **Lines / ink:** instrument sections use slightly cooler ink and stronger hairlines; Overview uses softer radius and gentler shadow
- **Radii:** Overview softer; instrument tighter (`--admin-radius-lux` vs `--admin-radius-tool`)
- **Shadows:** one soft elevated step for Master Control panels — not multi-layer glow stacks

### Personality split

| Surface | Personality |
|---------|-------------|
| Overview | Clinical luxury + cinematic Master Control |
| People, Structure, Organizations, Audit | Precision instrument — denser, sharper, mono accents |

---

## 2. Shell and navigation

Keep left sidebar + sticky context bar + max-width main column.

**Sidebar (~220px)**
- Brand lockup: “Ortho Rounds” + muted “Admin”
- Nav items: clearer active state (accent rail + soft fill); quieter idle
- “Back to rounds” as a calm ghost/text control at the bottom (same `#adminViewClose`)
- Audit and Organizations remain in `visibleAdminSections()` order/rules

**Context bar**
- Stronger section title
- Org chip as a refined pill (behavior unchanged)
- Busy: existing `#adminBusyStatus` + spinner; add a soft **shimmer** on the bar’s bottom edge while `#adminView.is-busy`
- “updated HH:MM” stays mono, right-aligned

**Main stage**
- Desktop: composed column ~1120–1200px with intentional vertical rhythm
- Mobile (&lt;700px): existing horizontal collapsed sidebar — usable, not phone-first redesign

**Unchanged:** `switchAdminSection`, org enter/exit, all section ids.

---

## 3. Overview — Master Control

First screen when Admin opens: mission-control presence, not a metric postcard.

### Command header

- Title treatment: org name + **Command** (display weight). “Master Control” is the design concept name, not the visible label.
- **Live telemetry strip** (existing `/api/health` only — no new routes):
  - **AI** on/off from `ai.enabled` (reuse/refresh the existing `aiAvailable` path)
  - **Storage** from health’s `storage` field (`sqlite` | `mongo` | `starting`). Today `refreshServerFlags()` keeps only `flags`; this pass may also stash `storage` (and refresh AI) from that same health response, or read `/api/health` once inside `loadAdminView`. Do not invent values; if health fails, show “—” for AI/storage.
  - **Last updated HH:MM** from `adminUI.lastLoadedAt` / existing stamp
  - Soft pulse when AI is on and load succeeded; pulse off under reduced motion or when health failed
- Plain text labels; decorative pulse is not announced. Busy continues to use `aria-live` on `#adminBusyStatus` only.

### Hero KPIs

- Four existing tiles (Departments, Active users, Live patients, Post-op) become elevated HUD panels: icon, **Fraunces** number, quiet label
- Case-mix **status ribbon** under the row (existing `byStatus` data via `renderAdminStatusBar`)
- Same scroll-to-section behavior if tiles currently act as shortcuts — preserve hooks

### Alert queue

- Rebuild visual language of Needs attention as an ops queue: priority tint for urgent group, mono counts, crisp iconed rows with chevron
- Preserve `computeAdminNeedsAttention` and every `data-attention-people` / `data-attention-unit` hook
- **Empty state:** calm “All systems clear” (with quiet pulse when motion allowed) — never a blank region

### Quick actions

- Iconed secondary “dispatch” controls: Add person / Add ward / Fix an assignment — ids and handlers unchanged; visually subordinate to KPIs and queue

### Explicitly out

- Fake AI chat or generated ward brief on Overview
- New backend routes or health fields
- Neon/glow sci-fi styling

---

## 4. Working sections — instrument

### Structure

- Keep two-pane master-detail and mobile drill-down flag
- Rail: tighter rows, type icons, sharp selected accent rail
- Detail: mono breadcrumb, compact 3-up stats, iconed rename/delete/move
- On node select: detail pane `slide-in` (~200–300ms)
- Mutation flows, delete blockers, move confirm: unchanged

### People

- Keep desktop table / phone cards split and all `data-*` hooks
- Sharper table chrome, stronger status chips, avatars retained
- Denser filter chips; bulk bar as a tool strip (not a soft marketing banner)
- Empty / no-match states with a short line and primary affordance (e.g. Add person)

### Organizations

- Same master-detail language as Structure
- Rail: name, plan badge, headline stat; detail actions (View, Create org admin, create org, repair ancestry) unchanged

### Audit

- Instrument table: mono timestamps, tight filters, clear CSV control
- Empty / no-results states aligned with People

---

## 5. Motion system (CSS only)

Shared primitives under `#adminView`:

| Primitive | Behavior |
|-----------|----------|
| `fade-rise` | opacity + 6–10px translateY |
| `slide-in` | detail panes / alert queue enter |
| `stagger` | child delay via `--i` (0, 1, 2…) |
| `pulse-soft` | telemetry healthy / all-clear |
| `shimmer` | context-bar busy edge |

**Choreography**
1. Open Admin / successful full `loadAdminView`: telemetry → KPI stagger → alert queue
2. Section switch: short crossfade of `.admin-section`
3. Structure / Orgs selection: detail `slide-in`
4. Hover: 120–180ms color/elevation only — no layout thrash

**Guards**
- `@media (prefers-reduced-motion: reduce)`: instant show/hide; no stagger, pulse, or shimmer
- Busy dim + `pointer-events: none` on active section content stays as shipped
- No infinite decorative loops except the tiny live pulse (disabled under reduced motion)

Implementation detail: builders may add `style="--i:N"` or `data-stagger` classes; motion is CSS-driven, not a JS animation engine.

---

## 6. Architecture / data flow

```
openAdminView / mutation
        │
        ▼
 loadAdminView()          ← adminLoadSeq + busy unchanged
   fetch org / users / …
   stamp lastLoadedAt
   render shell + active section
        │
        ├── Overview: telemetry from /api/health (stash storage + AI;
        │             no new routes) + stats / attention from adminData
        └── Other sections: existing builders + instrument classes
```

No new modules required. Prefer extending `admin-console.js` (Overview + shell helpers) and section files only for class/empty-state markup. Classic-script `let` sharing rules unchanged (`adminUI` file-local).

---

## 7. Error handling

- Fetch failure: clear busy for current token; existing `showToast` path
- Overlapping loads: only latest `adminLoadSeq` commits data and clears busy
- Telemetry health failure: show “—” for AI/storage — never invent healthy state
- No new error UI framework

---

## 8. Testing

| Case | Expectation |
|------|-------------|
| Admin font/token hooks | `#adminView` exposes admin font/token variables or classes used by CSS |
| Telemetry | Overview strip reflects AI on/off and storage kind from health fixture; “—” when health failed |
| Empty attention | “All systems clear” (or agreed copy) visible |
| Empty People / Audit / Orgs | Dedicated empty markup, not blank |
| Motion hooks | Stagger/motion classes present when rendered; reduced-motion is CSS-only (no flaky timing tests) |
| Busy / race | Existing soft-busy + `adminLoadSeq` tests stay green |
| Section behavior | Existing People / Structure / Orgs / Audit tests stay green; update only for intentional class/markup hooks |
| Flag-off / sync-golden | Unchanged |

Visual craft is primarily CSS; assert DOM hooks and copy, not pixel values.

---

## 9. Success criteria

1. Opening Admin feels like **Master Control** — cinematic Overview with telemetry and HUD KPIs.
2. Working sections feel like a **precision instrument**.
3. Motion is **expressive** and vanishes under `prefers-reduced-motion`.
4. Empty states and busy feedback feel finished — no blank holes.
5. **No behavior regressions**; **no new dependencies**; desktop hero, phone usable.

## Out of scope (explicit)

New admin features/APIs; AI generation on Overview; motion/UI libraries; framework/bundler; rounds UI redesign; phone-first shell redesign; sci-fi glow aesthetics.
