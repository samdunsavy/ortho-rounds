# Admin Console Visual Polish — Design

**Date:** 2026-07-27  
**Status:** Approved (design).  
**Builds on:** `docs/superpowers/specs/2026-07-26-admin-console-overhaul-design.md` (Plan 2 makeover — IA and behavior unchanged).

## Problem

The admin console is functionally task-shaped (Overview / People / Structure / Organizations) after Plan 2, but it still *looks* like a utilitarian form: flat `--paper`, plain bordered boxes, weak type hierarchy, and inherited chrome that ignores the quieter clinical language already used on rounds (DM Sans, JetBrains Mono accents, teal `--accent`, soft card surfaces). Separately, `loadAdminView()` fetches with no busy feedback — the overlay can sit blank or unchanged until data arrives, including on org switch and after mutations that re-fetch.

## Goals

1. **Quiet visual refresh** so Admin feels like the same product as Ortho Rounds — clearer hierarchy, spacing, and surfaces — without redesigning information architecture or flows.
2. **Soft busy state** on every full `loadAdminView()` (first open and later reloads) so waiting is obvious without skeletons or blocking modals.

## Non-goals

- New sections, copy rewrites, or Plan 2 behavior changes (“Can see patients in”, phone cards, Move confirmation, etc. stay as shipped).
- Skeleton placeholders or a full-screen loading modal.
- Backend / `server.js` / `admin.js` changes.
- New dependencies or new colour literals outside existing tokens.
- Non-admin screens; deferred Plan 2 minors (e.g. incomplete `role="tabpanel"`) unless they fall out of the CSS pass for free.

## Constraints

- **Frontend-only.** Touch `public/index.html` (admin CSS + minimal markup hooks) and `public/admin-console.js` (busy flag around `loadAdminView`). Section files only if a class name must be added for styling.
- **Existing design tokens only** — `--paper`, `--card`, `--line`, `--ink`, `--ink-soft`, `--accent`, `--accent-soft`, `--shadow-*`, status colours, and their dark-mode definitions. Fonts already loaded: DM Sans + JetBrains Mono.
- **Flag off → unchanged.** `MULTI_TENANT` off keeps the console unreachable; sync-golden stays green.
- **Touch targets ≥44px** stay at least that large; do not shrink chips/controls for aesthetics.
- **`adminLoadSeq` race guard stays.** Busy must cooperate with it (see §2 Soft busy state).

## Approach

**CSS-only restyle + one shared busy flag** (chosen over extracting shared chrome components or skeleton-first loading).

---

## 1. Visual system

Stay inside existing tokens. No new fonts.

| Surface | Change |
|---------|--------|
| **Header** | Align sticky header with app chrome: clearer Admin title weight; Back as a calm text control; org chip remains a soft pill |
| **Tabs** | Stronger selected state (accent underline + soft fill); slightly more horizontal breathing room; same four tabs |
| **Panels** | Overview tiles, People table/cards, Structure rail/detail, Org cards use patient-card language: `--card` fill, `--line` border, light `--shadow-*` — not flat undimensioned boxes |
| **Type** | Consistent `h3` / table-header hierarchy; mono reserved for small meta (counts, chip labels) where the main app already does |
| **Density** | Slightly more padding and gap between blocks |

**Unchanged:** section structure, routes, copy rules, phone table↔card media query, Plan 2 interactions.

---

## 2. Soft busy state

**Flag:** `adminUI.busy` (boolean), owned by `admin-console.js`.

**Lifecycle inside `loadAdminView()`:**

1. Capture load token as today (`++adminLoadSeq`).
2. Set `adminUI.busy = true` and reflect in the DOM (`#adminView` gets `is-busy`, `aria-busy="true"`).
3. Perform the existing fetch path.
4. On the **latest** token only: set `busy = false`, clear `is-busy` / `aria-busy`, then replace `adminData` and render (success) or rethrow for the existing toast path (failure). Stale completions must neither leave the UI stuck busy nor clear a newer load’s busy early.

**What the user sees:**

- Header: small accent spinner (reuse existing `@keyframes spin` / `ai-spin`) + “Updating…”
- Active section content remains visible but dimmed (`opacity` + `pointer-events: none`) so clicks do not fire mid-reload
- No full-screen overlay, no skeletons

**What does not set busy:**

- Instant section tab switches (Overview ↔ People ↔ Structure ↔ Organizations) that only call `switchAdminSection` / `renderAdminSection` without fetching
- Per-row People mutations that use `renderAdminPeopleRow` without `loadAdminView`

**When busy does run:** first `openAdminView` → `loadAdminView`, org enter/exit, create/delete/move/role flows that call `loadAdminView`, and any other full reload.

---

## 3. Architecture / data flow

```
openAdminView / mutation
        │
        ▼
 loadAdminView()
   busy=true → paint is-busy
   fetch (seq token)
   if stale: return (do not clear newer busy)
   busy=false → clear is-busy
   adminData = {…}; renderAdminSection()
```

No new modules. Busy is UI state next to `adminUI.section`, `viewedOrgId`, etc. Classic-script `let` sharing rules from Plan 2 still apply (`adminUI` is not `window.adminUI`).

---

## 4. Error handling

- Fetch failure: clear busy for the current token, then existing `showToast` / throw path.
- Rapid org switches: only the latest `adminLoadSeq` owns busy and commit; older requests return without mutating busy or `adminData`.

---

## 5. Testing

| Case | Expectation |
|------|-------------|
| `loadAdminView` start | `#adminView` has `is-busy` (or equivalent) and “Updating…” visible |
| Successful finish | `is-busy` cleared; section content rendered |
| Failed finish | `is-busy` cleared; toast still fires |
| Overlapping loads (A then B) | After B completes, not busy; `adminData` matches B. If A finishes after B started, A must not clear B’s busy or overwrite data |
| Section tab click only | No busy flash |
| Flag-off / sync-golden | Unchanged |

Visual polish is primarily CSS; existing People/Structure behavior tests should stay green without rewriting assertions unless class renames require it.

---

## 6. Success criteria

- Opening Admin looks like Ortho Rounds (same token family, quieter hierarchy), not a separate form app.
- Every full `loadAdminView` shows a clear soft busy state instead of an uncertain blank wait.
- No regressions in Plan 2 behavior; suite stays green; no new dependencies.

## Out of scope (explicit)

Skeletons; new admin sections; backend changes; redesign of rounds/patient UI; Plan 2 deferred minors except free CSS fallout.
