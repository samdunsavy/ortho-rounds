# Lab report photo extraction — design

**Date:** 2026-07-19
**Status:** Approved, ready for implementation plan

## Problem

Labs currently enter the app two ways: typed by hand into the `f_lab_*`
fields, or pasted as WhatsApp admission text and parsed by the existing
Smart Paste flow (`POST /api/ai/parse-admission`, which already extracts
`hb`/`crp`/`wcc`/`creatinine` from free text). Neither path helps when what
a PG actually has in hand is a photo of a printed lab report — the far more
common case in practice — and today's tracked panel (4 fields) covers only
a fraction of what a real report contains.

## Scope

One capability: attach a photo of a printed lab report and have AI extract
structured values into the existing labs UI, for the PG to review before
saving. Two entry points share one mechanism:

1. **Admission modal** — alongside the existing Smart Paste text box, for a
   patient's first labs.
2. **Labs trend panel** — during rounds, for repeat labs on an existing
   patient (CBC recheck, RFT follow-up, etc.), landing as a new dated
   `labsHistory` entry.

**Explicitly out of scope for this spec:** reading X-ray images, and
extracting data from outside-hospital documents (referral letters, other
hospitals' discharge summaries). Both were raised in brainstorming as
related ideas but are separate specs.

## Lab panel expansion

Current tracked fields: `hb`, `crp`, `wcc`, `creatinine`.

Adding: `platelets`, `esr`, `urea`, `sodium`, `potassium`, `ptinr`, `rbs`.

This set was chosen for what actually appears on routine ortho ward
workups — pre-op clearance, DVT-prophylaxis monitoring, post-op infection
markers — not a generic full lab panel (no LFTs, no thyroid, etc.).

Expanding the panel touches four existing places in `public/app.js` that
currently hardcode the 4-field list and must grow to the new set:

- `labValueClass(key, val)` — abnormal-range thresholds per key (needs a
  threshold added for each of the 7 new keys)
- The save-flow call to `upsertLabsHistoryEntry(d, {...}, d.labs.updatedAt)`
  (~line 7078) — currently passes only the 4 original keys
- The worklist quick-edit call to `upsertLabsHistoryEntry(p, {...}, ...)`
  (~line 5882) — same expansion
- The abnormal-labs flag check (~line 4488) — currently
  `['hb','crp','wcc','creatinine'].some(...)`, must include the new keys

No new history/save logic is required beyond this — the existing save path
already snapshots whatever is in `d.labs` into `labsHistory`, so photo
extraction only needs to land values in the same `f_lab_*` fields manual
entry already fills.

## Backend

### `parseLabsFromImage(imageDataUrl)` in `ai.js`

Same shape as the existing `parseAdmission(text)`: one OpenAI
vision-capable chat completion call, JSON mode (`callOpenAiJson`-style),
returning:

```json
{ "labs": { "hb": "12.5", "...": "..." }, "reportDate": "2026-07-18" }
```

`reportDate` matters because a printed lab slip carries its own collection
date, which should win over "today" when the entry is saved as a
`labsHistory` record. `reportDate` is `null` when the report has no legible
date.

Field allow-listing and value sanitization reuse the existing
`sanitizeLabs`-style pattern in `clinical-normalize.js`, extended to the 11
keys.

### `POST /api/ai/parse-labs-image` in `server.js`

Follows the existing `/api/ai/*` route pattern exactly:

- Auth required (`Authorization: Bearer` token, same as every other
  `/api/ai/*` route)
- `checkRateLimit(token)` before the OpenAI call
- `recordEvent('ai:parse-labs-image')` telemetry tag, matching the naming
  convention of the other AI routes
- Request body: `{ image: <dataURL> }`
- Response: `{ labs: {...}, reportDate: string|null }` or the existing
  AI error shape (503 not configured, 502/504 upstream failure)

### Privacy note

No pseudonymization step applies here — there's no existing patient
snapshot to alias against, the same as `parseAdmission` today. This is,
however, the **first** AI call in the app where an image itself — not just
sanitized text — leaves the server. Every other AI feature explicitly
excludes images (per the README's current AI privacy section). This flow
needs:

- An explicit system-prompt note treating the photo as a document to
  transcribe, not a clinical image to interpret
- A README update marking this one flow as the stated exception to
  "images never leave the server," distinct from the rest of the AI suite

## Frontend

Reuses the existing image-handling helpers already used for X-ray attach:
`fileToDataURL`, `compressImage`.

- A new "Attach lab report photo" button sits beside the Smart Paste box in
  the patient modal, and a matching button in the labs trend panel.
- On selection: compress the image → call
  `POST /api/ai/parse-labs-image` → fill the (now 11) `f_lab_*` fields via
  an extended `applySmartPasteLabs` → toast showing how many fields were
  filled, matching Smart Paste's existing toast pattern
  (`"Filled N fields — review before saving"`).
- Nothing saves automatically. The PG still hits Save, which is where the
  existing `upsertLabsHistoryEntry` call already runs — only the expanded
  field list changes, not the save mechanism itself.
- If `reportDate` is returned and differs from today, prompt to confirm
  which date the `labsHistory` entry should use, rather than silently
  backdating it. Declining the prompt defaults to today, matching current
  behavior for manual entry.

## Error handling

Matches the posture of every existing AI call in the app:

- AI not configured (503) → "AI not available — check server key or
  connection" toast, same message already used elsewhere
- Failure/timeout → toast with the error message, form stays untouched, PG
  can still type values by hand
- No recognizable fields (blurry photo, not actually a lab report) →
  "Nothing recognisable in that photo" — mirrors Smart Paste's existing
  empty-result message rather than silently filling nothing with no
  feedback

## Testing

- **Server-side:** unit tests for `parseLabsFromImage`'s JSON-shape
  validation and field allow-listing, with a mocked OpenAI response (no
  real API calls) — mirrors the existing pattern in
  `tests/ai-risk-flags.test.js` and `tests/admission-format.test.js`.
- **Frontend:** jsdom tests for the extended `applySmartPasteLabs` field
  mapping (11 keys) and the new report-date-conflict prompt logic,
  following the harness pattern established this sprint in
  `tests/frontend-sync-merge.test.js` and
  `tests/frontend-worklist.test.js`.
- Existing test suite (171 tests as of this writing) must stay green;
  `labValueClass` and the abnormal-labs check need updated test coverage
  for the 7 new keys, not just the 4 original ones.

## Non-goals

- Reading the X-ray image itself (imaging AI) — separate spec
- Extracting from outside-hospital documents (referral letters, transfer
  summaries) — separate spec
- OCR/on-device extraction — considered and deferred (see approaches
  below); revisit if photo-to-AI accuracy or the new privacy exception
  proves to be a real problem in practice

## Approaches considered

1. **Direct vision AI extraction (chosen).** Smallest build, reuses
   existing `ai.js`/`server.js` patterns almost verbatim. Trade-off: photo
   pixels leave the server for this one flow, a new exception to the
   app's current "images never leave the server" privacy stance.
2. **Client-side OCR, no photo ever leaves the device.** Vendor an OCR
   library into `public/`, cached by the service worker, feed extracted
   text through the existing `parseAdmission`-style text extraction.
   Preserves the current privacy guarantee completely, but the OCR
   language data alone (10-20MB) would dwarf every other asset this
   offline-first PWA ships, real-world phone photos of lab slips
   (skewed, creased, mixed print/handwriting) are a known OCR weak spot,
   and it's meaningfully more engineering for a first version.
3. **Hybrid — OCR first, AI vision fallback.** Best of both, but doubles
   what has to be built and tested for a v1. Reasonable follow-up if
   approach 1's accuracy or privacy trade-off turns out to be a real
   problem in practice.
