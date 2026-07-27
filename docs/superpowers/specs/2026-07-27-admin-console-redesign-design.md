# Admin Console Redesign (Approach B) — Design

**Date:** 2026-07-27
**Status:** Implemented.
**Builds on:** `docs/superpowers/specs/2026-07-26-admin-console-overhaul-design.md` (Plan 2 IA) and `docs/superpowers/specs/2026-07-27-admin-console-visual-polish-design.md` (quiet CSS refresh + busy state, already shipped).

## Problem

The console shipped a quiet CSS polish today, but it still reads as a utilitarian admin form rather than part of Ortho Rounds. Three concrete causes, confirmed in the source:

1. **Layout wastes the screen.** `.admin-view` is a full-bleed overlay with `16px` padding and no `max-width`, so on a wide monitor everything stretches edge to edge. Worse, Structure's "command center" (`.admin-cc`) is `display:block`, so the tree rail stacks *on top of* the detail pane — a long vertical scroll instead of a master-detail editor.
2. **Flat, undifferentiated look.** There is not a single icon in the console. Every surface (stat tiles, attention rows, people table, org cards) is the same flat `--card` fill with a `--line` hairline. Text-only + uniform boxes is exactly what reads as "basic."
3. **Thin navigation and context.** Navigation is a horizontal tab strip; the only context is a small org chip in the header. Overview is four tiles + three plain buttons + a text list, none visually connected.

## Goals

1. Make the console feel like the same product as rounds — clear hierarchy, icons, real surfaces — via a **left sidebar shell**, an **inline SVG icon system**, and **true master-detail layouts**.
2. Do it **frontend-only**, inside the existing token system, with **no new dependencies** and **no behavior regressions** to Plan 2 flows.

## Non-goals

- No `server.js` / `admin.js` / API changes. Data shapes (`buildOrgTree`, `buildOrgRollups`, `/api/admin/*`) are unchanged.
- No new admin capabilities, sections, routes, or copy rewrites beyond labels needed for nav.
- No new runtime dependencies (no icon font, no component library, no CSS framework).
- No changes to the offline/sync path, `MULTI_TENANT` gating, or the patient-facing UI.
- People is **not** converted to master-detail (see §5) — its table/cards split stays.

## Constraints

- **Files touched:** `public/index.html` (admin CSS, the icon sprite, shell markup) and the four `public/admin-*.js` builders (`admin-console.js`, `admin-people.js`, `admin-structure.js`, `admin-orgs.js`). No other files.
- **Existing design tokens only:** `--paper`, `--card`, `--line`, `--line-soft`, `--ink`, `--ink-soft`, `--accent`, `--accent-soft`, `--on-accent`, `--warn`/`--warn-bg`, `--bad`/`--bad-bg`, `--shadow-{sm,md,lg}`, `--radius`/`--radius-sm`, status colours. Fonts already loaded: DM Sans + JetBrains Mono. The only new asset is the inline SVG sprite.
- **Dark mode:** both `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]` must keep working. Icons use `currentColor`, so they follow automatically.
- **Preserve all Plan 2 behavior and hooks.** Every `data-*` attribute, element `id`, and delegated click/keydown handler keeps working; every mutation flow (rename, delete with blockers, move + confirm, role change, bulk assign, create org/admin, repair ancestry) is untouched.
- **Preserve the `adminLoadSeq` race guard and the shipped busy state.** The busy spinner relocates into the new context bar but keeps its lifecycle.
- **Touch targets ≥44px** stay ≥44px. **`MULTI_TENANT` off** keeps the console unreachable and sync-golden green.

## Approach

A CSS + markup restyle plus one structural change per section (block → grid), driven from the existing JS builders. Chosen over a component-extraction rewrite (too invasive for an internal console) and over a design-system dependency (violates no-new-deps and fights the token system).

Build order — five reviewable commits:

1. **Shell + icon sprite** — sidebar, context bar, max-width main column, `<symbol>` sprite, `icon()` helper.
2. **Overview** — dashboard metric cards, org status bar, grouped/iconed needs-attention.
3. **Structure** — block → two-pane grid, iconed rail rows, detail-pane stat grid + breadcrumb.
4. **People** — iconed filter chips, semantic status chips, initials avatars, cleaner table/cards.
5. **Organizations** — master-detail (list rail + detail pane), same icon language.

---

## 1. Shell and navigation

Replace the tab strip with a persistent sidebar.

```
.admin-view (flex row, dark-safe --paper bg)
├── .admin-sidebar (~200px, fixed)         nav + "Back to rounds"
└── .admin-main (flex:1, max-width ~1100px, centered)
    ├── .admin-context-bar (sticky)         section title · org chip · "Updating…" spinner · "updated HH:MM"
    └── .admin-section (the active section)
```

- **Sidebar** is a `<nav aria-label="Admin console">`. Each item is a `<button>` with an icon + label; the active one gets `aria-current="page"` and an `--accent-soft` fill with an accent left border. Order: Overview, People, Structure, and — instance admins only — Organizations. `visibleAdminSections()` already computes the list; the renderer moves from `renderAdminSectionTabs` to `renderAdminSidebarNav` (same data, new markup). "Back to rounds" (the old `#adminViewClose`) pins to the sidebar bottom.
- **Context bar** hosts the current section title, the org chip (`#adminOrgChip`, unchanged behavior), the busy spinner (`#adminBusyStatus`, relocated), and a lightweight "updated HH:MM" stamp set on each successful `loadAdminView`.
- **Keyboard:** the roving-tabindex arrow handler that today walks the tablist is replaced by standard vertical `ArrowUp`/`ArrowDown` movement across nav buttons; `Enter`/`Space` activate. `switchAdminSection` keeps its signature and focus-move-to-target behavior.
- **Mobile (<700px):** the sidebar collapses to a horizontal, horizontally-scrollable icon+label row pinned at the top of `.admin-main`. No change to any section's own phone layout (People cards, Structure drill-down) — only the nav chrome reflows.

**a11y note:** semantics change from `tablist`/`tab`/`tabpanel` to `nav`/`aria-current`. Sections drop `role="tabpanel"` (which Plan 2 left incomplete anyway) in favor of plain landmarks.

## 2. Icon system

- One inline `<svg style="display:none" aria-hidden="true">` block in `index.html` defining ~15 `<symbol>` glyphs (viewBox `0 0 24 24`, `stroke="currentColor"`, `fill="none"`), referenced as `<svg class="ic"><use href="#ic-NAME"/></svg>`.
- `.ic` sizes in `em` (default `1em`, `.ic-lg` ~1.25em) and inherits `color`, so it adapts to light/dark and to the surrounding text colour for free.
- A tiny global helper `icon(name, cls)` returns the `<svg>…<use>…</svg>` string so the JS builders stay readable.
- Glyph set (approx): `dashboard, users, sitemap, hospital, arrow-left, stethoscope, user-check, bed, activity, alert-triangle, chevron-right, chevron-down, plus, edit, trash, map-pin-off, box-off, search`. Add only as screens need them; keep the set small.
- Decorative icons carry `aria-hidden="true"`; icon-only buttons keep a visible label or `aria-label` so accessible names are unchanged.

## 3. Overview → dashboard

- **Metric cards:** the existing four (`Departments, Active users, Live patients, Post-op`) each gain a leading icon and a left-aligned number; `--card` fill, `--shadow-sm`. Grid stays 2-col on phones, 4-col ≥720px. `renderAdminStatTiles` gains an `icon` per tile; markup otherwise the same.
- **Org status bar:** surface `renderAdminStatusBar(byStatus, total)` (already exists) directly under the tiles, fed by the org-level `byStatus` totals, giving an at-a-glance case-mix ribbon.
- **Needs attention:** rebuilt as grouped, iconed rows. Each group keeps its heading and count; the urgent "no assignment" group is tinted `--warn-bg`. Every row stays a `<button>` carrying its existing `data-attention-people` / `data-attention-unit` hook and gains a leading category icon plus a trailing chevron. The `computeAdminNeedsAttention` logic is untouched; only `renderAdminNeedsAttentionHTML` changes.
- **Quick actions:** the three buttons (`Add person, Add ward, Fix an assignment`) gain icons; ids and handlers unchanged.

## 4. Structure → two-pane editor

- `.admin-cc` changes from `display:block` to `display:grid; grid-template-columns: minmax(220px,280px) 1fr; gap:12px` at ≥720px. Below 720px it stays single-column and the existing `adminUI.structureMobileDrilled` flag continues to swap rail ↔ detail exactly as today.
- **Rail rows** (`.admin-cc-row`): add a node-type icon (hospital/department/unit/ward) before the name; keep the count on the right, the chevron affordance, the depth padding, the selected state, and all `data-*` hooks.
- **Detail pane:** header shows the node name with a mono breadcrumb path (e.g. `Ortho › Unit IV`), and the rename/delete/move actions gain icons (`edit`, `trash`). Add a small 3-up stat grid (patients / wards / staff) from the node's `stats`. The children list and inline add-child form keep their markup contract. Rename dashed-underline target, 44px targets, delete-blocker copy, and move+confirm flow are unchanged.

## 5. People — restyle only

Keep the responsive table (desktop) / cards (phone) split and every handler; the `@media (max-width:699px)` swap and all `data-*` hooks stay.

- Filter chips (`.admin-people-chip`) gain leading icons and keep their active state.
- A **status chip** per user encodes active / disabled / unassigned / stale using existing semantic tokens (`--accent-soft`, `--warn-bg`, `--bad-bg`) — no new colours.
- **Initials avatar** in the first cell / card head, using `--accent-soft`.
- Table header, row hover, and assignment `<select>` get a light cleanup. Bulk bar restyled but keeps its sticky behavior and `id`s.

Full master-detail for People is out of scope: the table works, and converting it would add risk without a clear win.

## 6. Organizations → master-detail

Convert the flat card list (`renderAdminOrgsSection`) into the same rail + detail pattern as Structure:

- **Rail:** one row per org (name, plan badge, a headline stat), selectable; mirrors Structure's rail styling and the mobile drill-down pattern.
- **Detail pane:** the selected org's stat grid (`hospitals · departments · users · live patients`), plan and created date, and its actions — **View** (`data-view-org` → `enterAdminOrgContext`) and **Create org admin** (`data-create-org-admin` + `data-new-org-admin` input).
- **Global controls** below the rail: **Create organization** (`#adminNewOrgName` + `#adminAddOrgBtn`) and, for instance admins, **Repair ancestry** (`data-repair-ancestry`).
- The delegated click handler on `#adminOrgsSection` is untouched — it matches via `closest()`, so relocating these controls into a rail/detail layout keeps every action working. A small `adminUI.selectedOrgId` (UI-only, mirrors `selectedNode`) tracks the rail selection.

---

## 7. Architecture / data flow

No new modules and no new server calls. All state stays on the existing `adminUI` object (add `selectedOrgId`; `lastLoadedAt` for the "updated HH:MM" stamp). The classic-script `let`-sharing rules from Plan 2 still apply (`adminUI` is file-local, not `window.adminUI`). `loadAdminView` keeps its `adminLoadSeq` token, busy lifecycle, and instance-admin vs. member branch; it only additionally stamps `lastLoadedAt` and renders the sidebar (via `renderAdminSection`) instead of the tab strip.

## 8. Error handling

Unchanged. Fetch failures still clear busy for the current token and route through `showToast`; rapid org switches are still resolved by `adminLoadSeq` (only the latest load commits `adminData` and clears busy).

## 9. Testing

- Existing admin behavior tests (People filters/mutations, Structure rename/delete/move, org enter/exit, busy overlap) must stay green; update selectors **only** where a class or wrapper rename forces it.
- New/adjusted assertions:
  - Sidebar renders the correct items per role (Organizations only for instance admins); active item has `aria-current="page"`.
  - Structure body is a two-column grid at desktop width and single-column with drill-down on mobile.
  - The icon sprite is present and `icon()` emits a `<use href="#ic-…">`.
  - Busy state still toggles `is-busy` / `aria-busy` and the spinner now lives in the context bar.
  - Organizations renders a rail + detail and every relocated action (`data-view-org`, `data-create-org-admin`, `#adminAddOrgBtn`, `data-repair-ancestry`) still fires.
- `MULTI_TENANT` off: console unreachable, sync-golden unchanged.

## 10. Success criteria

- Opening Admin presents a sidebar-navigated, icon-led, master-detail console that visually belongs to Ortho Rounds — not an admin form.
- Structure and Organizations are side-by-side master-detail on desktop; nothing stretches edge-to-edge.
- Zero Plan 2 behavior regressions; no new dependencies; suite green in light and dark mode.

## Out of scope (explicit)

Backend/API changes; new admin capabilities or sections; People master-detail; icon fonts or component libraries; patient/rounds UI; any change to sync, auth, or `MULTI_TENANT` gating.
