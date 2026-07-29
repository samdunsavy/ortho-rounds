# Loading & Busy Feedback — Design

**Date:** 2026-07-29  
**Status:** Approved for planning (awaiting implementation plan).  
**Builds on:** Existing partial patterns — `setAiButtonBusy` / `.ai-btn-busy` in `public/app.js`, admin `setAdminBusy` / `.is-busy` in `public/admin-console.js`, sync chip (`setSyncStatus` / “Syncing…”), and `showToast` for outcomes.

## Problem

Many async controls in Ortho Rounds give no in-progress indication. On ward rounds, clinicians tap again when nothing appears to happen. That causes double-submits, duplicate work, and eroded trust. Image add flows (pre-op / post-op / follow-up x-rays, lab photos) are especially opaque during compress + upload. Lists can briefly look empty while still fetching, which reads as “no patients” rather than “still loading.”

This is product-quality debt for a company shipping clinical software: silent or ambiguous progress is a reliability issue, not a cosmetic one.

## Goals

1. **Every user-triggered async action** shows busy on the control that was tapped and cannot double-fire.
2. **Image adds** show a placeholder thumbnail in the result slot until upload succeeds (or fails cleanly).
3. **Lists** never present a finished empty state while a fetch is still in flight; warm refresh keeps last-known data visible.
4. **One shared client contract** so new features inherit the same behavior without one-off CSS.

## Non-goals

- Full-screen / panel-blocking overlays for ordinary actions.
- Optimistic writes that pretend network-only actions succeeded before they did.
- A second toast system or replacing success/error toasts with busy chrome.
- Screenshot / visual-regression suites.
- Redesigning admin IA or clinical layout beyond busy/loading cues.
- Holding button busy until background sync completes for local-first writes.

## Constraints

- **Vanilla JS / no new dependencies** — helpers live in `public/` alongside existing patterns; no framework, no build step.
- **Clinical safety** — re-entry guard is mandatory, not optional visual sugar. Prefer miss a second tap over double-write.
- **Preserve behavior** — sync merge, image storage, AI endpoints, and admin mutations unchanged; only UX around in-flight work changes.
- **Touch targets** — busy styling must not shrink hit areas below existing sizes; spinner is additive.
- **`prefers-reduced-motion`** — spinner animation respects reduced motion (static indicator or opacity pulse is fine).
- **Offline-first** — local saves clear busy when the local write finishes; the sync chip remains the network progress cue.

## Approach

**Shared `withBusy` in `public/busy.js` + image placeholder thumbs + warm/cold list rules** (Approach 1).

Chosen over CSS-only copy-paste (orphans inevitable) and over a global request overlay (overblocks rounds UI; conflicts with button-local preference).

---

## 1. Core busy contract

### Helper

Introduce a shared helper `withBusy(el, fn)` used by clinical UI, AI, exports, auth/account, and admin button-level actions.

**Placement:** `public/busy.js`, loaded in `index.html` **before** `admin-*.js` and `app.js` (admin scripts currently load before `app.js`, so the helper cannot live only in `app.js` if admin must call it). Global function declaration, same plain-script style as `milestones.js`. Tests can load `busy.js` in isolation.

Behavior:

1. If `el` is already busy → **return immediately** (hard re-entry guard).
2. Mark busy: `disabled` on native buttons; for non-`<button>` controls (e.g. `.xray-add`) set `aria-disabled="true"` and ignore activation while busy.
3. Add shared class `.is-busy` and `aria-busy="true"`.
4. `await fn()`.
5. In `finally`: clear busy unless the element was removed from the DOM.

### Visual

- Feedback is **on the tapped control only** — no full-screen overlay.
- Shared `.is-busy` CSS (small inline spinner via `::after`, matching today’s `.ai-btn-busy` look). Keep `.ai-btn-busy` as a thin alias during migration, then remove call-site dependence on `setAiButtonBusy`.
- Toasts remain for **outcomes** (success / error). Busy means in progress only.

### Background sync

Sync that is not tied to a specific control continues to use `setSyncStatus('syncing')` and the sync chip label (“Syncing…”). Do not put unrelated buttons into busy for background `scheduleSync` / `backgroundSync`.

---

## 2. Image add flows

Applies to pre-op / post-op / follow-up x-rays, modal attach, lab photos, and any similar add/upload control.

### Flow

1. User activates add and picks a file.
2. Immediately insert a **placeholder thumb** in the target row: muted box, spinner, `aria-busy`, accessible name such as “Uploading…”. The placeholder is the durable in-progress signal for the whole pipeline.
3. Busy on the **add control** covers read + compress only. When the type-confirm modal opens, clear busy on the add control so the modal is the interaction surface; the placeholder stays.
4. Pipeline unchanged in substance: read file → `compressImage` → type-confirm modal when required → `uploadPatientImage` → attach to patient → `savePatient` / sync as today.
5. **Confirm** on the type modal uses `withBusy` on that confirm control for upload + save.
6. **Success:** replace placeholder with the real thumbnail.
7. **Failure:** remove placeholder, clear busy on whichever control is in flight, `showToast` with the error. No orphan grey boxes.
8. **Type-confirm cancelled:** remove placeholder, clear `pendingImageSlot` / `pendingImageData` as today.

### Rules

- Placeholder is **local UI only** — not persisted to patient data or storage until upload succeeds.
- Multiple concurrent adds each get their own placeholder; do not block the whole patient card unless that specific add control is busy.

---

## 3. List / screen loading

### Warm refresh (default)

- Keep last-known list/cards visible while sync or reload runs.
- Use the existing sync chip (“Syncing…”) as the refresh cue. Do not invent a second global banner on clinical views.
- Admin keeps its existing context-bar busy (`setAdminBusy` / “Updating…”); align vocabulary (`.is-busy`, `aria-busy`) where practical without redesigning chrome.

### Cold empty only

- When there is **no cached data** yet (e.g. post-login first paint) and a fetch is in flight: show a short skeleton or a single list-level “Loading…” state.
- Do **not** show finished empty copy (“No patients”, etc.) until the load has finished and the result is truly empty.

### Rules

- Never clear a populated list to a blank “loading” DOM when cached patients already exist.
- Empty-state copy is reserved for completed loads with zero results.

---

## 4. Coverage inventory

Every user-triggered async action must use the busy contract (or the image-placeholder variant). Inventory:

| Surface | Examples |
|---------|----------|
| Auth / account | Login, change password, revoke sessions |
| Patient CRUD | Modal save, checklist / plan / discharge actions that await work |
| Images | Pre-op / post-op / follow-up x-rays, lab photos, modal attach |
| AI | Draft, polish, handover, discharge, brief, risk, scribe, bulk plans — migrate off `setAiButtonBusy` |
| Export / import | OT Word/PDF, census, JSON export/import, template pack export |
| Admin | Button-level where a specific control fires the request; section load continues via `setAdminBusy` |
| Sync chip | Manual sync uses chip state; do not double-busy unrelated controls |

Ship as one coherent migration pass so orphan actions are not left behind. New features must use `withBusy` (or the image variant); no one-off busy CSS.

---

## 5. Error handling & local-first timing

- Always clear busy in `finally`.
- On error: re-enable the control, toast via existing `showToast`; image paths remove the placeholder (§2).
- **Local-first writes** (`savePatient` and similar that complete locally then schedule sync): busy ends when the **local** operation finishes. Network catch-up stays on the sync chip (pending / Syncing…).
- **Network-only actions** (login, AI, admin API mutations, file download exports): busy lasts until the request/download path settles.

---

## 6. Testing

### Unit / harness

- `withBusy`: second invocation while in flight is a no-op; busy class + disabled/`aria-busy` applied then cleared in `finally`; still clears when `fn` throws.
- Non-button controls: `aria-disabled` + activation ignored while busy.
- Image placeholder: success swaps to real thumb; failure removes placeholder (DOM assertions; mocked upload).

### Integration / smoke

- One clinical save control and one AI control: busy around a mocked slow `api`.
- Cold empty: empty cache + in-flight sync mock → loading cue, not “No patients”.
- Warm refresh: cached patients + syncing → cards remain; chip/label shows syncing.

### Not required

- Visual regression / screenshot suite for this pass.

---

## 7. Files likely touched

- `public/busy.js` — new: `withBusy` (+ any tiny helpers for busy class / aria).
- `public/app.js` — migrate AI/save/export/auth/image handlers; cold/warm list gates; thin-wrap or delete `setAiButtonBusy`.
- `public/index.html` — script tag for `busy.js` before admin/app; shared `.is-busy` + placeholder thumb CSS; reduced-motion; optional cold-load markup hooks.
- `public/admin-*.js` — button-level `withBusy` where missing; keep `setAdminBusy` for section loads.
- `tests/` — new frontend harness tests for helper + placeholder + list empty/loading rules.

Server / storage / sync protocol: **unchanged**.

---

## Success criteria

- No user-triggered async control lacks busy (or image placeholder) feedback.
- Double-activation while in flight does not start a second run.
- Failed image add leaves no placeholder; control is usable again.
- Warm lists never flash a false empty state; cold first load never looks like a finished zero-patient ward.
- Existing sync chip and admin busy bar remain the cues for non-control-bound work.
`)