# Labs: expanded core panel + capture-don't-drop — Design

**Date:** 2026-07-21
**Status:** Approved scope: labs only. Milestone voice-suggestions deferred to POLISH.md backlog.

## Problem

The lab pipeline hard-whitelists 11 keys (`hb, crp, wcc, creatinine, platelets, esr, urea, sodium, potassium, ptinr, rbs`). When AI photo extraction (`parseLabsFromImage`) or admission parsing reads any other analyte — calcium, phosphate, ALP, albumin, bilirubin, HbA1c, uric acid — `sanitizeLabs` silently discards it. The doctor photographed the report, the AI read the value correctly, and the app threw it away with no trace. The bone profile (core to an ortho ward) is entirely absent from the panel.

## Goals

1. Add the bone profile to the core panel: **calcium, phosphate, alp, albumin** (11 → 15 fields).
2. Never silently drop a lab the AI reads: capture unrecognized analytes into a structured `otherLabs` list, shown to the doctor.

## Non-goals (explicitly out of scope)

- Ward-configurable lab panels / custom thresholds (Phase 2+ SaaS-tier feature).
- Trending, sparklines, or abnormal-value coloring for `otherLabs` (no thresholds for unknowns — safety).
- Milestone changes of any kind. The voice-round "suggest unmatched milestone" idea goes to POLISH.md as a backlog item.

## Design

### 1. Core panel expansion (4 new fields)

New `LAB_SPEC` entries (`public/app.js`), consistent with existing Indian-report-unit pattern:

| key | unit | low | high |
|---|---|---|---|
| `calcium` | mg/dL | 8.5 | 10.5 |
| `phosphate` | mg/dL | 2.5 | 4.5 |
| `alp` | U/L | — | 120 |
| `albumin` | g/dL | 3.5 | — |

Touch points (same list-of-keys pattern already used per field):

- `clinical-normalize.js` — `sanitizeLabs` key list extended to 15.
- `ai.js` — `parseLabsFromImage` prompt key list extended; admission-parse prompt (`labs: object with optional keys …`) extended.
- `public/app.js` — labs form grid: 4 new inputs (`f_lab_calcium`, `f_lab_phosphate`, `f_lab_alp`, `f_lab_albumin`); form save/collect key lists; `LAB_TREND_LABELS` (+`Ca`, `PO4`, `ALP`, `Albumin`); labs summary/chips key lists; photo-review modal field list; `hasAnyLabValue` list.
- Trend sparklines: new keys participate automatically once added to `LAB_TREND_LABELS` — `renderLabsTrendPanel` iterates its keys, and the detail-modal save patches `labsHistory` from the `LAB_SPEC` key set.
- **Unchanged by design:** the worklist abnormal-lab surfacing and risk scoring keep their deliberate headline-four list (`hb, crp, wcc, creatinine`) — the new fields display and trend but do not add worklist noise.

### 2. Capture-don't-drop: `otherLabs`

**Extraction.** New export in `clinical-normalize.js`:

```js
extractOtherLabs(raw) -> [{ name, value }]
```

Collects entries from (a) keys in the AI's `labs` object that aren't in the known 15, and (b) an explicit `otherLabs` array the prompt is updated to emit (`[{name, value}]` for any other legible analyte). `sanitizeLabs` keeps its existing signature and behavior (known keys only) — no caller churn.

**Prompt change** (`parseLabsFromImage`): add `"otherLabs": array of {name, value} for any other legible analyte printed on the report; name as printed (max ~30 chars), value as printed without units. Same rules: transcribe only, never guess, no patient-identifying text.`

**Sanitization limits** (defends against a junk/adversarial photo flooding the UI): name trimmed, max 40 chars; value trimmed, max 20 chars; max 12 entries; entries with empty name or value dropped; names deduplicated case-insensitively (first wins).

**Storage.** Stored at `patient.labs.otherLabs` (array). Living inside `labs` means it rides the existing field-aware sync semantics for the labs object — whole-array replace on newer update, no new merge logic. `mergeLabs` (shallow `Object.assign`) needs one addition: when both sides carry `otherLabs`, union by name (primary wins).

**Display.**

- *Photo review modal:* extras listed under the recognized fields, each with a remove (×) control, so the doctor vets them before Save. Nothing saves without review — same contract as today.
- *Patient form:* read-only chips under the labs grid ("Ca 9.1 · Uric acid 8.2"), each removable. No inputmode editing — extras come from reports; manual entry stays the 15 core fields.
- *Detail/summary views:* appended to the existing labs summary line, plain style, no abnormal coloring.

**`labsHistory`:** unchanged — stores known keys only. `otherLabs` is current-state only, not trended.

### 3. Roadmap bookkeeping

Add to `POLISH.md` backlog: "Voice-round scribe: surface spoken-but-unmatched milestone actions as one-tap suggested checklist additions (deferred 2026-07-21 — labs capture prioritized; template library already covers milestone customization)."

## Error handling

- AI returns malformed `otherLabs` (not array, non-object entries): filtered silently, recognized fields still apply.
- Sanitization caps above bound UI damage from OCR noise.
- `otherLabs` absent/empty: no chips section rendered; zero visual change for existing users.

## Compatibility

Purely additive to the patient record shape — no sync-contract version bump needed per POLICY.md (additive fields allowed). Old clients ignore `labs.otherLabs` and won't destroy it only if their merge preserves unknown keys in `labs`; verify in tests that a pre-change client shape passing through `mergeLabs`/sync does not strip it. If it does strip, document as acceptable (older client wins on labs update) — same behavior any new lab key has.

## Testing

- `tests/clinical-normalize.test.js`: expanded `sanitizeLabs` (15 keys), `extractOtherLabs` (unknown-key harvest, explicit array, caps, dedupe, malformed input), `mergeLabs` union behavior.
- `tests/frontend-lab-photo-extraction.test.js`: review modal shows extras, × removes one, Save persists remainder to `labs.otherLabs`.
- Frontend form test: chips render from `labs.otherLabs`, removable, absent when empty.
- Regression: existing 11-key flows and default-labs object (`app.js` init) unchanged; full suite green.
