# Lab Report Photo Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a PG attach a photo of a printed lab report and have AI transcribe it into the app's lab fields for review before saving, at both admission and later rounds-day updates, and expand the tracked lab panel from 4 to 11 fields.

**Architecture:** One new vision-capable OpenAI call (`parseLabsFromImage` in `ai.js`) behind one new route (`POST /api/ai/parse-labs-image`), following the exact shape of the existing `parseAdmission`/`/api/ai/parse-admission` pair. The client reuses the existing X-ray photo-attach helpers (`fileToDataURL`, `compressImage`) and the existing Smart Paste review-before-save UX (`applySmartPasteLabs`). The 4→11 field lab panel expansion is a shared data-model change that benefits both this new photo flow and the existing WhatsApp-text Smart Paste flow, since both already funnel through `sanitizeLabs`.

**Tech Stack:** Node.js (`node:sqlite`, `node:test`), vanilla JS PWA frontend (no framework, no build step), OpenAI Chat Completions API (vision-capable `gpt-4o-mini` default), jsdom for frontend unit tests.

## Global Constraints

- Node.js ≥ 22.5 required (built-in `node:sqlite`) — unchanged by this work.
- Self-host install stays zero-required-dependency; this feature adds no new npm dependency of any kind.
- AI stays fully opt-in via `OPENAI_API_KEY` — every new code path must degrade to "AI not available" exactly like existing AI features when unset.
- No breaking changes to `/api/sync` or the patient record shape (per `POLICY.md`); the 7 new lab keys are additive fields on the existing `labs`/`labsHistory` objects.
- This is the first AI call in the app where an image (not just sanitized text) leaves the server — this must be called out explicitly in the README's AI privacy section, distinct from the rest of the AI suite which excludes images.
- Full existing test suite (171 tests as of 2026-07-19) must stay green throughout; every new/modified function gets its own test coverage, no exceptions.
- Follow existing code conventions exactly: `node:test` + `node:assert/strict` for all tests, the `mockOpenAi(handler)` fetch-mocking pattern already used in `tests/ai-risk-flags.test.js`, and the `loadFrontendEnv()` jsdom harness already used in `tests/frontend-*.test.js` for anything touching `public/app.js`.

---

## File Structure

| File | Responsibility |
|---|---|
| `clinical-normalize.js` | `sanitizeLabs` allow-list expanded from 4 to 11 keys — shared by both the existing WhatsApp-text Smart Paste flow and the new photo flow. |
| `ai.js` | New `parseLabsFromImage(imageDataUrl)` export — one vision-capable OpenAI call, JSON mode, returns `{ labs, reportDate }`. |
| `server.js` | New `POST /api/ai/parse-labs-image` route, following the existing `/api/ai/*` block exactly. |
| `public/app.js` | `LAB_SPEC`/`labValueClass`/`LAB_TREND_LABELS` expanded to 11 keys; new lab input rows + "Attach lab report photo" button + hidden file input in `renderModalForm`; new `handleLabPhotoSelected` handler; save-flow (`d.labs`, `upsertLabsHistoryEntry` call) expanded to 11 keys; new `modalLabReportDate` state variable. |
| `README.md` | AI privacy section gets one new paragraph noting this flow as the stated exception to "images never leave the server." |
| `tests/clinical-normalize.test.js` | New `sanitizeLabs` describe block. |
| `tests/ai-parse-labs-image.test.js` (new file) | Unit tests for `parseLabsFromImage`, mocked OpenAI, no real API calls. |
| `tests/frontend-lab-photo-extraction.test.js` (new file) | jsdom tests for the expanded `labValueClass`, `applySmartPasteLabs`, and the new markup in `renderModalForm`. |

---

### Task 1: Expand the lab panel data model (`clinical-normalize.js`)

**Files:**
- Modify: `clinical-normalize.js` (the `sanitizeLabs` function, currently ~line 158-168)
- Test: `tests/clinical-normalize.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `sanitizeLabs(raw)` now accepts and returns up to 11 keys: `hb`, `crp`, `wcc`, `creatinine`, `platelets`, `esr`, `urea`, `sodium`, `potassium`, `ptinr`, `rbs`. Every later task that calls `sanitizeLabs` (Task 2's `parseLabsFromImage`, and the existing `parseAdmission`) automatically gets the expanded panel for free.

- [ ] **Step 1: Write the failing test**

Add `sanitizeLabs` to the existing import block at the top of `tests/clinical-normalize.test.js`:

```js
import {
  normalizePersonName,
  normalizeDiagnosis,
  normalizeProcedure,
  normalizeSurgeon,
  extractLabsFromText,
  sanitizeAntibioticCourses,
  sanitizeLabs,
  normalizePatientClinicalFields
} from '../clinical-normalize.js';
```

Append a new describe block at the end of the file:

```js
describe('sanitizeLabs', () => {
  test('keeps the expanded panel of 11 keys and drops unknown fields', () => {
    const out = sanitizeLabs({
      hb: '11.2', crp: '8', wcc: '9000', creatinine: '0.9',
      platelets: '210000', esr: '18', urea: '32', sodium: '138',
      potassium: '4.1', ptinr: '1.1', rbs: '110',
      randomField: 'ignore me'
    });
    assert.equal(Object.keys(out).length, 11);
    assert.equal(out.platelets, '210000');
    assert.equal(out.ptinr, '1.1');
    assert.equal(out.randomField, undefined);
  });

  test('drops null/undefined/"null" values same as the original 4 fields', () => {
    const out = sanitizeLabs({ hb: null, sodium: 'null', potassium: undefined, rbs: '110' });
    assert.deepEqual(out, { rbs: '110' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern sanitizeLabs`
Expected: FAIL — `out.platelets` is `undefined`, `Object.keys(out).length` is not 11 (current allow-list only has 4 keys).

- [ ] **Step 3: Write minimal implementation**

In `clinical-normalize.js`, change:

```js
export function sanitizeLabs(raw){
  if(!raw || typeof raw !== 'object') return {};
  const out = {};
  for(const key of ['hb', 'crp', 'wcc', 'creatinine']){
```

to:

```js
export function sanitizeLabs(raw){
  if(!raw || typeof raw !== 'object') return {};
  const out = {};
  for(const key of ['hb', 'crp', 'wcc', 'creatinine', 'platelets', 'esr', 'urea', 'sodium', 'potassium', 'ptinr', 'rbs']){
```

(The rest of the function body — the `val === undefined`/`null` guard and the `'null'` string check — is unchanged; it already applies generically to whatever keys are in the loop.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern sanitizeLabs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add clinical-normalize.js tests/clinical-normalize.test.js
git commit -m "Expand tracked lab panel from 4 to 11 fields in sanitizeLabs"
```

---

### Task 2: Add `parseLabsFromImage` to `ai.js`

**Files:**
- Modify: `ai.js` (new export, appended after `parseAdmission`, ~line 415)
- Test: `tests/ai-parse-labs-image.test.js` (new file)

**Interfaces:**
- Consumes: `sanitizeLabs` from `clinical-normalize.js` (already imported in `ai.js`, no import change needed — expanded by Task 1), `callOpenAiJson(systemPrompt, userContent, opts)` (existing, unchanged).
- Produces: `parseLabsFromImage(imageDataUrl: string) => Promise<{ labs: object, reportDate: string|null }>`. Task 3's server route calls this directly.

- [ ] **Step 1: Write the failing test**

Create `tests/ai-parse-labs-image.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = 'test-key';
const { parseLabsFromImage } = await import('../ai.js');

function mockOpenAi(handler){
  const original = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = original; };
}

describe('parseLabsFromImage', () => {
  test('sends the photo as an image_url content block and returns sanitized labs', async (t) => {
    const restore = mockOpenAi(async (url, opts) => {
      const body = JSON.parse(opts.body);
      const userMsg = body.messages.find(m => m.role === 'user');
      assert.ok(Array.isArray(userMsg.content), 'vision content must be an array of parts');
      const imagePart = userMsg.content.find(p => p.type === 'image_url');
      assert.equal(imagePart.image_url.url, 'data:image/jpeg;base64,AAAA');
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            labs: { hb: '11.2', platelets: '210000', sodium: '138' },
            reportDate: '2026-07-18'
          }) } }]
        })
      };
    });
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.equal(result.labs.hb, '11.2');
    assert.equal(result.labs.platelets, '210000');
    assert.equal(result.labs.sodium, '138');
    assert.equal(result.reportDate, '2026-07-18');
  });

  test('drops an unparseable reportDate rather than guessing', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          labs: { hb: '10' }, reportDate: 'sometime last week'
        }) } }]
      })
    }));
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.equal(result.reportDate, null);
  });

  test('returns an empty labs object when nothing is recognizable', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ labs: {}, reportDate: null }) } }]
      })
    }));
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.deepEqual(result.labs, {});
    assert.equal(result.reportDate, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ai-parse-labs-image.test.js`
Expected: FAIL with `parseLabsFromImage is not a function` (not exported yet).

- [ ] **Step 3: Write minimal implementation**

Append to `ai.js`, after the closing brace of `parseAdmission` (~line 414):

```js
export async function parseLabsFromImage(imageDataUrl){
  const systemPrompt = `You transcribe values from a photo of a printed or handwritten hospital lab report (Indian ward setting) into structured data. This is a transcription task — read what is printed, do not interpret, diagnose, or comment on the values.
Return ONLY a JSON object with these keys:
"labs": object with optional string keys — hb, platelets, wcc, esr, crp, urea, creatinine, sodium, potassium, ptinr, rbs. Use the exact numeric value as printed (no units in the value). Omit any key not legible or not present on the report — never guess or invent a value.
"reportDate": the report's own collection/reporting date if printed on it, as ISO YYYY-MM-DD, else null. Do not substitute today's date.
Do not include the patient's name, hospital name, or any other identifying text anywhere in your response — only the "labs" and "reportDate" keys.`;

  const userContent = [
    { type: 'text', text: 'Transcribe the lab values from this report photo. Return the JSON.' },
    { type: 'image_url', image_url: { url: imageDataUrl } }
  ];
  const raw = await callOpenAiJson(systemPrompt, userContent, { maxTokens: 500, temperature: 0.1 });
  const labs = sanitizeLabs(raw?.labs);
  let reportDate = null;
  if(typeof raw?.reportDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.reportDate.trim())){
    reportDate = raw.reportDate.trim();
  }
  return { labs, reportDate };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ai-parse-labs-image.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add ai.js tests/ai-parse-labs-image.test.js
git commit -m "Add parseLabsFromImage: vision AI transcription of lab report photos"
```

---

### Task 3: Wire `POST /api/ai/parse-labs-image` (`server.js`)

**Files:**
- Modify: `server.js` (import block ~line 39-51; route block ~line 522-599)

**Interfaces:**
- Consumes: `parseLabsFromImage` from Task 2.
- Produces: `POST /api/ai/parse-labs-image` — request `{ image: string }`, response `{ labs: object, reportDate: string|null }` on success, or the existing AI error shape (`{ error: string }` with 400/503/502/504/429) on failure. Task 8's client `callAi('parse-labs-image', { image })` call depends on this exact request/response shape.

- [ ] **Step 1: Update the import**

In `server.js`, change:

```js
import {
  isAiEnabled,
  getAiConfig,
  checkRateLimit,
  draftPlan,
  polishPresentation,
  handoverSummary,
  dischargeSummary,
  wardBrief,
  wardRiskFlags,
  parseAdmission,
  scribeRoundNote
} from './ai.js';
```

to:

```js
import {
  isAiEnabled,
  getAiConfig,
  checkRateLimit,
  draftPlan,
  polishPresentation,
  handoverSummary,
  dischargeSummary,
  wardBrief,
  wardRiskFlags,
  parseAdmission,
  scribeRoundNote,
  parseLabsFromImage
} from './ai.js';
```

- [ ] **Step 2: Add the route**

In the `/api/ai/` handler block, insert a new branch immediately after the `/api/ai/scribe` block and before the final `return sendJSON(res, 404, ...)` (~line 593):

```js
      if(pathname === '/api/ai/scribe'){
        if(!body.patient || typeof body.patient !== 'object'){
          return sendJSON(res, 400, { error: 'patient snapshot required' });
        }
        if(typeof body.transcript !== 'string' || !body.transcript.trim()){
          return sendJSON(res, 400, { error: 'transcript required' });
        }
        const result = await scribeRoundNote(body.patient, body.transcript);
        return sendJSON(res, 200, { result });
      }
      if(pathname === '/api/ai/parse-labs-image'){
        if(typeof body.image !== 'string' || !body.image.startsWith('data:image/')){
          return sendJSON(res, 400, { error: 'lab report image required' });
        }
        const { labs, reportDate } = await parseLabsFromImage(body.image);
        return sendJSON(res, 200, { labs, reportDate });
      }
      return sendJSON(res, 404, { error: 'Unknown AI endpoint' });
```

- [ ] **Step 3: Verify wiring manually**

This route is a thin pass-through with no branching logic of its own (all real logic is in `parseLabsFromImage`, already covered by Task 2's tests) — consistent with how the other seven `/api/ai/*` routes in this file have no dedicated HTTP-level tests either; they're exercised through their underlying `ai.js` function tests. Verify the wiring by hand once:

```bash
ORTHO_ADMIN_PASSWORD=test-pass OPENAI_API_KEY=sk-fake npm start &
sleep 1
TOKEN=$(curl -s -X POST http://localhost:3000/api/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"test-pass"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")
curl -s -X POST http://localhost:3000/api/ai/parse-labs-image -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
kill %1
```

Expected: `{"error":"lab report image required"}` (400) — proves the route is reachable, auth-gated, and validates its body before ever calling the (fake-keyed) OpenAI client.

- [ ] **Step 4: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all existing tests still pass (server.js has no dedicated route tests to update, so this just confirms the import/syntax change didn't break module loading).

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "Add POST /api/ai/parse-labs-image route"
```

---

### Task 4: Expand the client-side lab data model (`public/app.js`)

**Files:**
- Modify: `public/app.js` (`LAB_SPEC` ~line 87-92, `labValueClass` ~line 2633-2655, `LAB_TREND_LABELS` ~line 2698)
- Test: `tests/frontend-lab-photo-extraction.test.js` (new file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `LAB_SPEC` now has 11 keys with `unit`/`low`/`high` (and the existing SI-conversion fields for `hb`/`wcc`/`creatinine`, unchanged). `labValueClass(key, val)` returns `'lab-low'`/`'lab-high'`/`''` for all 11 keys. `LAB_TREND_LABELS` has 11 entries, so `renderLabsTrendPanel` (unchanged code, reads `Object.keys(LAB_TREND_LABELS)`) automatically renders 11 sparklines once history exists for the new keys. Task 5 and Task 6 depend on `LAB_SPEC` covering all 11 keys.

- [ ] **Step 1: Write the failing test**

Create `tests/frontend-lab-photo-extraction.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

describe('labValueClass — expanded 11-field panel', () => {
  test('flags low platelets', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.labValueClass('platelets', '120000'), 'lab-low');
    assert.equal(window.labValueClass('platelets', '250000'), '');
  });

  test('flags high ESR, urea, and PT/INR', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.labValueClass('esr', '35'), 'lab-high');
    assert.equal(window.labValueClass('esr', '10'), '');
    assert.equal(window.labValueClass('urea', '55'), 'lab-high');
    assert.equal(window.labValueClass('ptinr', '1.8'), 'lab-high');
    assert.equal(window.labValueClass('ptinr', '1.0'), '');
  });

  test('flags both directions for sodium, potassium, and RBS', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.labValueClass('sodium', '128'), 'lab-low');
    assert.equal(window.labValueClass('sodium', '150'), 'lab-high');
    assert.equal(window.labValueClass('sodium', '140'), '');
    assert.equal(window.labValueClass('potassium', '2.9'), 'lab-low');
    assert.equal(window.labValueClass('potassium', '6.1'), 'lab-high');
    assert.equal(window.labValueClass('rbs', '55'), 'lab-low');
    assert.equal(window.labValueClass('rbs', '260'), 'lab-high');
  });

  test('unrecognized values and unknown keys stay unflagged', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.labValueClass('platelets', ''), '');
    assert.equal(window.labValueClass('platelets', 'not a number'), '');
    assert.equal(window.labValueClass('unknownKey', '100'), '');
  });
});

describe('LAB_TREND_LABELS — expanded panel', () => {
  test('has all 11 keys with human-readable labels', () => {
    const { window } = loadFrontendEnv();
    const keys = Object.keys(window.LAB_TREND_LABELS);
    assert.equal(keys.length, 11);
    for(const key of ['hb', 'crp', 'wcc', 'creatinine', 'platelets', 'esr', 'urea', 'sodium', 'potassium', 'ptinr', 'rbs']){
      assert.ok(keys.includes(key), `missing trend label for ${key}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/frontend-lab-photo-extraction.test.js`
Expected: FAIL — `labValueClass('platelets', ...)` returns `''` unconditionally (key not in `LAB_SPEC` yet), `LAB_TREND_LABELS` has only 4 keys.

- [ ] **Step 3: Write minimal implementation**

In `public/app.js`, change:

```js
const LAB_SPEC = {
  hb:         { unit: 'g/dL',        low: 12,    siLow: 100,   siIfAbove: 25 },
  crp:        { unit: 'mg/L',        high: 10 },
  wcc:        { unit: 'cells/cu.mm', high: 11000, siHigh: 11, siIfBelow: 100 },
  creatinine: { unit: 'mg/dL',       high: 1.3,  siHigh: 120,  siIfAbove: 20 }
};
```

to:

```js
const LAB_SPEC = {
  hb:         { unit: 'g/dL',        low: 12,    siLow: 100,   siIfAbove: 25 },
  crp:        { unit: 'mg/L',        high: 10 },
  wcc:        { unit: 'cells/cu.mm', high: 11000, siHigh: 11, siIfBelow: 100 },
  creatinine: { unit: 'mg/dL',       high: 1.3,  siHigh: 120,  siIfAbove: 20 },
  platelets:  { unit: 'cells/cu.mm', low: 150000 },
  esr:        { unit: 'mm/hr',       high: 20 },
  urea:       { unit: 'mg/dL',       high: 40 },
  sodium:     { unit: 'mEq/L',       low: 135,   high: 145 },
  potassium:  { unit: 'mEq/L',       low: 3.5,   high: 5.5 },
  ptinr:      { unit: '',            high: 1.5 },
  rbs:        { unit: 'mg/dL',       low: 70,    high: 200 }
};
```

Change `labValueClass` from:

```js
function labValueClass(key, val){
  const n = parseFloat(val);
  if(isNaN(n)) return '';
  const spec = LAB_SPEC[key];
  if(!spec) return '';
  if(key === 'hb'){
    const limit = n > spec.siIfAbove ? spec.siLow : spec.low;
    return n < limit ? 'lab-low' : '';
  }
  if(key === 'wcc'){
    const limit = n < spec.siIfBelow ? spec.siHigh * 1000 : spec.high;
    const compare = n < spec.siIfBelow ? n * 1000 : n;
    return compare > limit ? 'lab-high' : '';
  }
  if(key === 'creatinine'){
    const limit = n > spec.siIfAbove ? spec.siHigh : spec.high;
    return n > limit ? 'lab-high' : '';
  }
  if(key === 'crp'){
    return n > spec.high ? 'lab-high' : '';
  }
  return '';
}
```

to:

```js
function labValueClass(key, val){
  const n = parseFloat(val);
  if(isNaN(n)) return '';
  const spec = LAB_SPEC[key];
  if(!spec) return '';
  if(key === 'hb'){
    const limit = n > spec.siIfAbove ? spec.siLow : spec.low;
    return n < limit ? 'lab-low' : '';
  }
  if(key === 'wcc'){
    const limit = n < spec.siIfBelow ? spec.siHigh * 1000 : spec.high;
    const compare = n < spec.siIfBelow ? n * 1000 : n;
    return compare > limit ? 'lab-high' : '';
  }
  if(key === 'creatinine'){
    const limit = n > spec.siIfAbove ? spec.siHigh : spec.high;
    return n > limit ? 'lab-high' : '';
  }
  if(key === 'crp'){
    return n > spec.high ? 'lab-high' : '';
  }
  if(key === 'platelets'){
    return n < spec.low ? 'lab-low' : '';
  }
  if(key === 'esr' || key === 'urea' || key === 'ptinr'){
    return n > spec.high ? 'lab-high' : '';
  }
  if(key === 'sodium' || key === 'potassium' || key === 'rbs'){
    if(spec.low != null && n < spec.low) return 'lab-low';
    if(spec.high != null && n > spec.high) return 'lab-high';
    return '';
  }
  return '';
}
```

Change `LAB_TREND_LABELS` from:

```js
const LAB_TREND_LABELS = { hb: 'Hb', crp: 'CRP', wcc: 'TLC', creatinine: 'Creatinine' };
```

to:

```js
const LAB_TREND_LABELS = {
  hb: 'Hb', crp: 'CRP', wcc: 'TLC', creatinine: 'Creatinine',
  platelets: 'Platelets', esr: 'ESR', urea: 'Urea',
  sodium: 'Na', potassium: 'K', ptinr: 'PT/INR', rbs: 'RBS'
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/frontend-lab-photo-extraction.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all tests pass, including the existing `labValueClass`-adjacent coverage for `hb`/`crp`/`wcc`/`creatinine` (unchanged branches).

- [ ] **Step 6: Commit**

```bash
git add public/app.js tests/frontend-lab-photo-extraction.test.js
git commit -m "Expand LAB_SPEC, labValueClass, and LAB_TREND_LABELS to the 11-field panel"
```

---

### Task 5: Add the new lab inputs and photo-attach button to the patient modal (`public/app.js`)

**Files:**
- Modify: `public/app.js` (`renderModalForm`, ~line 6254-6263)
- Test: `tests/frontend-lab-photo-extraction.test.js` (append)

**Interfaces:**
- Consumes: `LAB_SPEC`, `labValueClass`, `renderLabsTrendPanel` (all from Task 4, unchanged signatures).
- Produces: `renderModalForm(d)` output now contains 7 new `f_lab_*` input elements, one `#labPhotoBtn` button, and one hidden `#labPhotoFileInput` file input. Task 6 (save-flow) reads the new `f_lab_*` ids; Task 8 (photo handler) wires `#labPhotoBtn` and `#labPhotoFileInput`.

- [ ] **Step 1: Write the failing test**

Append to `tests/frontend-lab-photo-extraction.test.js`:

```js
describe('renderModalForm — expanded labs grid and photo button', () => {
  test('renders inputs for all 11 lab fields', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderModalForm(window.blankPatient());
    for(const id of ['f_lab_hb', 'f_lab_crp', 'f_lab_wcc', 'f_lab_creatinine', 'f_lab_platelets', 'f_lab_esr', 'f_lab_urea', 'f_lab_sodium', 'f_lab_potassium', 'f_lab_ptinr', 'f_lab_rbs']){
      assert.ok(html.includes(`id="${id}"`), `missing input ${id}`);
    }
  });

  test('renders the lab photo attach button and a hidden file input', () => {
    const { window } = loadFrontendEnv();
    const html = window.renderModalForm(window.blankPatient());
    assert.ok(html.includes('id="labPhotoBtn"'));
    assert.ok(html.includes('id="labPhotoFileInput"'));
    assert.match(html, /<input[^>]*id="labPhotoFileInput"[^>]*type="file"/);
  });

  test('pre-fills existing values for the new fields when editing', () => {
    const { window } = loadFrontendEnv();
    const patient = window.blankPatient();
    patient.labs = { platelets: '410000', sodium: '129' };
    const html = window.renderModalForm(patient);
    assert.ok(html.includes('value="410000"'));
    assert.ok(html.includes('value="129"'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/frontend-lab-photo-extraction.test.js`
Expected: FAIL — the new `f_lab_*` ids, `labPhotoBtn`, and `labPhotoFileInput` don't exist in the current markup.

- [ ] **Step 3: Write minimal implementation**

In `public/app.js`, change the labs form-row inside `renderModalForm`:

```js
    <div class="form-row">
      <label>Key labs (optional) <span class="small-muted">— Indian report units</span></label>
      <div class="labs-grid">
        <div><span>Hb (g/dL)</span><input id="f_lab_hb" inputmode="decimal" placeholder="e.g. 12.5" value="${escapeHTML((d.labs||{}).hb||'')}" class="${labValueClass('hb', (d.labs||{}).hb)}"></div>
        <div><span>CRP (mg/L)</span><input id="f_lab_crp" inputmode="decimal" placeholder="e.g. 5" value="${escapeHTML((d.labs||{}).crp||'')}" class="${labValueClass('crp', (d.labs||{}).crp)}"></div>
        <div><span>TLC (cells/cu.mm)</span><input id="f_lab_wcc" inputmode="decimal" placeholder="e.g. 8500" value="${escapeHTML((d.labs||{}).wcc||'')}" class="${labValueClass('wcc', (d.labs||{}).wcc)}"></div>
        <div><span>Creatinine (mg/dL)</span><input id="f_lab_creatinine" inputmode="decimal" placeholder="e.g. 0.9" value="${escapeHTML((d.labs||{}).creatinine||'')}" class="${labValueClass('creatinine', (d.labs||{}).creatinine)}"></div>
      </div>
      ${renderLabsTrendPanel(d)}
    </div>
```

to:

```js
    <div class="form-row">
      <label>Key labs (optional) <span class="small-muted">— Indian report units</span></label>
      <div class="labs-photo-row">
        <button type="button" class="btn ai-btn" id="labPhotoBtn">📷 Read lab report photo</button>
        <input type="file" id="labPhotoFileInput" accept="image/*" capture="environment" hidden>
        <div class="form-hint">AI fills the fields below for your review — nothing is saved until you press Save.</div>
      </div>
      <div class="labs-grid">
        <div><span>Hb (g/dL)</span><input id="f_lab_hb" inputmode="decimal" placeholder="e.g. 12.5" value="${escapeHTML((d.labs||{}).hb||'')}" class="${labValueClass('hb', (d.labs||{}).hb)}"></div>
        <div><span>CRP (mg/L)</span><input id="f_lab_crp" inputmode="decimal" placeholder="e.g. 5" value="${escapeHTML((d.labs||{}).crp||'')}" class="${labValueClass('crp', (d.labs||{}).crp)}"></div>
        <div><span>TLC (cells/cu.mm)</span><input id="f_lab_wcc" inputmode="decimal" placeholder="e.g. 8500" value="${escapeHTML((d.labs||{}).wcc||'')}" class="${labValueClass('wcc', (d.labs||{}).wcc)}"></div>
        <div><span>Creatinine (mg/dL)</span><input id="f_lab_creatinine" inputmode="decimal" placeholder="e.g. 0.9" value="${escapeHTML((d.labs||{}).creatinine||'')}" class="${labValueClass('creatinine', (d.labs||{}).creatinine)}"></div>
        <div><span>Platelets (cells/cu.mm)</span><input id="f_lab_platelets" inputmode="decimal" placeholder="e.g. 250000" value="${escapeHTML((d.labs||{}).platelets||'')}" class="${labValueClass('platelets', (d.labs||{}).platelets)}"></div>
        <div><span>ESR (mm/hr)</span><input id="f_lab_esr" inputmode="decimal" placeholder="e.g. 15" value="${escapeHTML((d.labs||{}).esr||'')}" class="${labValueClass('esr', (d.labs||{}).esr)}"></div>
        <div><span>Urea (mg/dL)</span><input id="f_lab_urea" inputmode="decimal" placeholder="e.g. 28" value="${escapeHTML((d.labs||{}).urea||'')}" class="${labValueClass('urea', (d.labs||{}).urea)}"></div>
        <div><span>Sodium (mEq/L)</span><input id="f_lab_sodium" inputmode="decimal" placeholder="e.g. 138" value="${escapeHTML((d.labs||{}).sodium||'')}" class="${labValueClass('sodium', (d.labs||{}).sodium)}"></div>
        <div><span>Potassium (mEq/L)</span><input id="f_lab_potassium" inputmode="decimal" placeholder="e.g. 4.2" value="${escapeHTML((d.labs||{}).potassium||'')}" class="${labValueClass('potassium', (d.labs||{}).potassium)}"></div>
        <div><span>PT/INR</span><input id="f_lab_ptinr" inputmode="decimal" placeholder="e.g. 1.1" value="${escapeHTML((d.labs||{}).ptinr||'')}" class="${labValueClass('ptinr', (d.labs||{}).ptinr)}"></div>
        <div><span>RBS (mg/dL)</span><input id="f_lab_rbs" inputmode="decimal" placeholder="e.g. 110" value="${escapeHTML((d.labs||{}).rbs||'')}" class="${labValueClass('rbs', (d.labs||{}).rbs)}"></div>
      </div>
      ${renderLabsTrendPanel(d)}
    </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/frontend-lab-photo-extraction.test.js`
Expected: PASS (9 tests total so far)

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add public/app.js tests/frontend-lab-photo-extraction.test.js
git commit -m "Add 7 new lab input fields and the lab-photo attach button to the patient modal"
```

---

### Task 6: Wire the expanded panel through the save flow (`public/app.js`)

**Files:**
- Modify: `public/app.js` (save handler ~line 7070-7079; `openPatientModal`/`closePatientModal` state resets ~line 6035-6113)

**Interfaces:**
- Consumes: the 7 new `f_lab_*` input ids from Task 5.
- Produces: a new module-level `modalLabReportDate` variable (`string|null`), reset to `null` alongside `modalSmartPasteUsed`/`modalPendingImages` in both `openPatientModal` and `closePatientModal`. On save, `d.labs` carries all 11 keys and `upsertLabsHistoryEntry` is called with the full 11-key patch, dated by `modalLabReportDate` when set. Task 8's photo handler sets `modalLabReportDate`.

- [ ] **Step 1: Write the failing test**

Append to `tests/frontend-lab-photo-extraction.test.js`:

```js
describe('save flow — expanded labs object', () => {
  test('modalLabReportDate starts null and resets on modal open/close', () => {
    const { window, document } = loadFrontendEnv();
    // openPatientModal needs its DOM targets present — the harness loads
    // the real index.html, which already has #modalTitle/#modalBody/etc.
    window.openPatientModal(window.blankPatient());
    assert.equal(window.modalLabReportDate, null);
    window.modalLabReportDate = '2026-07-18';
    window.closePatientModal({ force: true });
    assert.equal(window.modalLabReportDate, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/frontend-lab-photo-extraction.test.js`
Expected: FAIL — `window.modalLabReportDate` is `undefined` (variable doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `public/app.js`, add the new state variable next to the existing modal-scoped ones (~line 19-21):

```js
let modalSmartPasteUsed = false; // AI admission fill — don't auto-apply milestone templates
```

becomes (add the new line immediately after):

```js
let modalSmartPasteUsed = false; // AI admission fill — don't auto-apply milestone templates
let modalLabReportDate = null; // set by lab-photo extraction when the report's own date differs from today
```

In `openPatientModal`, change:

```js
  modalPendingImages = [];
  modalSuppressAutoTemplate = false;
  modalSmartPasteUsed = false;
```

to:

```js
  modalPendingImages = [];
  modalSuppressAutoTemplate = false;
  modalSmartPasteUsed = false;
  modalLabReportDate = null;
```

In `closePatientModal`, change:

```js
  modalPendingImages = [];
  modalSuppressAutoTemplate = false;
  modalSmartPasteUsed = false;
}
```

to:

```js
  modalPendingImages = [];
  modalSuppressAutoTemplate = false;
  modalSmartPasteUsed = false;
  modalLabReportDate = null;
}
```

Now change the save-flow's labs block from:

```js
    d.labs = {
      hb: document.getElementById('f_lab_hb')?.value.trim() || '',
      crp: document.getElementById('f_lab_crp')?.value.trim() || '',
      wcc: document.getElementById('f_lab_wcc')?.value.trim() || '',
      creatinine: document.getElementById('f_lab_creatinine')?.value.trim() || '',
      updatedAt: todayISO()
    };
    if(d.labs.hb || d.labs.crp || d.labs.wcc || d.labs.creatinine){
      upsertLabsHistoryEntry(d, { hb: d.labs.hb, crp: d.labs.crp, wcc: d.labs.wcc, creatinine: d.labs.creatinine }, d.labs.updatedAt);
    }
```

to:

```js
    d.labs = {
      hb: document.getElementById('f_lab_hb')?.value.trim() || '',
      crp: document.getElementById('f_lab_crp')?.value.trim() || '',
      wcc: document.getElementById('f_lab_wcc')?.value.trim() || '',
      creatinine: document.getElementById('f_lab_creatinine')?.value.trim() || '',
      platelets: document.getElementById('f_lab_platelets')?.value.trim() || '',
      esr: document.getElementById('f_lab_esr')?.value.trim() || '',
      urea: document.getElementById('f_lab_urea')?.value.trim() || '',
      sodium: document.getElementById('f_lab_sodium')?.value.trim() || '',
      potassium: document.getElementById('f_lab_potassium')?.value.trim() || '',
      ptinr: document.getElementById('f_lab_ptinr')?.value.trim() || '',
      rbs: document.getElementById('f_lab_rbs')?.value.trim() || '',
      updatedAt: modalLabReportDate || todayISO()
    };
    const hasAnyLabValue = ['hb', 'crp', 'wcc', 'creatinine', 'platelets', 'esr', 'urea', 'sodium', 'potassium', 'ptinr', 'rbs']
      .some(key => d.labs[key]);
    if(hasAnyLabValue){
      upsertLabsHistoryEntry(d, {
        hb: d.labs.hb, crp: d.labs.crp, wcc: d.labs.wcc, creatinine: d.labs.creatinine,
        platelets: d.labs.platelets, esr: d.labs.esr, urea: d.labs.urea,
        sodium: d.labs.sodium, potassium: d.labs.potassium, ptinr: d.labs.ptinr, rbs: d.labs.rbs
      }, d.labs.updatedAt);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/frontend-lab-photo-extraction.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all tests pass — pay particular attention to `tests/frontend-sync-merge.test.js`, which exercises `labsHistory` merge behavior; the new keys must not break its existing per-key merge assertions since it only asserts on the 4 original keys, which are untouched.

- [ ] **Step 6: Commit**

```bash
git add public/app.js tests/frontend-lab-photo-extraction.test.js
git commit -m "Wire the 11-field lab panel through the save flow, with report-date override"
```

---

### Task 7: Expand `applySmartPasteLabs` to the 11-field panel (`public/app.js`)

**Files:**
- Modify: `public/app.js` (`applySmartPasteLabs`, ~line 1264-1281)
- Test: `tests/frontend-lab-photo-extraction.test.js` (append)

**Interfaces:**
- Consumes: the `f_lab_*` input ids from Task 5.
- Produces: `applySmartPasteLabs(labs)` now fills all 11 fields when present in its input object and returns the count filled. This is the shared fill helper both the existing WhatsApp Smart Paste flow and Task 8's new photo flow call.

- [ ] **Step 1: Write the failing test**

Append to `tests/frontend-lab-photo-extraction.test.js`:

```js
describe('applySmartPasteLabs — expanded panel', () => {
  test('fills all 11 fields when present and counts them', () => {
    const { window, document } = loadFrontendEnv();
    window.openPatientModal(window.blankPatient());
    const filled = window.applySmartPasteLabs({
      hb: '11.2', crp: '8', wcc: '9000', creatinine: '0.9',
      platelets: '210000', esr: '18', urea: '32',
      sodium: '138', potassium: '4.1', ptinr: '1.1', rbs: '110'
    });
    assert.equal(filled, 11);
    assert.equal(document.getElementById('f_lab_platelets').value, '210000');
    assert.equal(document.getElementById('f_lab_ptinr').value, '1.1');
  });

  test('only fills fields present in the input, ignoring the rest', () => {
    const { window, document } = loadFrontendEnv();
    window.openPatientModal(window.blankPatient());
    const filled = window.applySmartPasteLabs({ sodium: '129' });
    assert.equal(filled, 1);
    assert.equal(document.getElementById('f_lab_sodium').value, '129');
    assert.equal(document.getElementById('f_lab_potassium').value, '');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/frontend-lab-photo-extraction.test.js`
Expected: FAIL — `applySmartPasteLabs` only knows the 4 original keys, so `filled` is at most 4 and `f_lab_platelets`/`f_lab_ptinr` stay empty.

- [ ] **Step 3: Write minimal implementation**

Change:

```js
function applySmartPasteLabs(labs){
  if(!labs) return 0;
  let filled = 0;
  const pairs = [
    ['hb', 'f_lab_hb'],
    ['crp', 'f_lab_crp'],
    ['wcc', 'f_lab_wcc'],
    ['creatinine', 'f_lab_creatinine']
  ];
  for(const [key, id] of pairs){
    if(!labs[key]) continue;
    const el = document.getElementById(id);
    if(!el) continue;
    el.value = labs[key];
    filled++;
  }
  return filled;
}
```

to:

```js
function applySmartPasteLabs(labs){
  if(!labs) return 0;
  let filled = 0;
  const pairs = [
    ['hb', 'f_lab_hb'],
    ['crp', 'f_lab_crp'],
    ['wcc', 'f_lab_wcc'],
    ['creatinine', 'f_lab_creatinine'],
    ['platelets', 'f_lab_platelets'],
    ['esr', 'f_lab_esr'],
    ['urea', 'f_lab_urea'],
    ['sodium', 'f_lab_sodium'],
    ['potassium', 'f_lab_potassium'],
    ['ptinr', 'f_lab_ptinr'],
    ['rbs', 'f_lab_rbs']
  ];
  for(const [key, id] of pairs){
    if(!labs[key]) continue;
    const el = document.getElementById(id);
    if(!el) continue;
    el.value = labs[key];
    filled++;
  }
  return filled;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/frontend-lab-photo-extraction.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all tests pass, including any existing Smart Paste coverage that calls `applySmartPasteLabs` with only the original 4 keys — unaffected since the function still fills whatever subset is present.

- [ ] **Step 6: Commit**

```bash
git add public/app.js tests/frontend-lab-photo-extraction.test.js
git commit -m "Expand applySmartPasteLabs to fill all 11 lab fields"
```

---

### Task 8: Add the photo-attach handler and wire the UI (`public/app.js`)

**Files:**
- Modify: `public/app.js` (new `handleLabPhotoSelected` function near `handleModalImageSelected`, ~line 1546-1560; delegated click handler ~line 940-946; listener binding ~line 3860)

**Interfaces:**
- Consumes: `callAi(endpoint, body)` (existing), `fileToDataURL`/`compressImage` (existing), `applySmartPasteLabs` (Task 7), `showConfirm(title, message, opts)` (existing, used elsewhere at ~line 7101), `modalLabReportDate` (Task 6), `canUseAi()`/`setAiButtonBusy()` (existing).
- Produces: clicking `#labPhotoBtn` opens the file picker; selecting a photo calls `POST /api/ai/parse-labs-image` via `callAi('parse-labs-image', { image })`, fills the labs grid, and — if the AI returns a `reportDate` different from today — prompts the PG to confirm using that date for the `labsHistory` entry.

- [ ] **Step 1: Write the failing test**

Append to `tests/frontend-lab-photo-extraction.test.js`:

```js
describe('handleLabPhotoSelected', () => {
  test('fills the labs grid from the AI response and reports the fill count', async () => {
    const { window, document } = loadFrontendEnv();
    window.openPatientModal(window.blankPatient());
    window.aiAvailable = true;
    window.callAi = async (endpoint, body) => {
      assert.equal(endpoint, 'parse-labs-image');
      assert.ok(body.image.startsWith('data:'));
      return { labs: { hb: '11.0', sodium: '138' }, reportDate: null };
    };
    window.showToast = () => {}; // no-op, just observing side effects below

    const fakeFile = new window.File(['fake-bytes'], 'report.jpg', { type: 'image/jpeg' });
    const filled = await window.handleLabPhotoSelected(fakeFile);

    assert.equal(filled, 2);
    assert.equal(document.getElementById('f_lab_hb').value, '11.0');
    assert.equal(document.getElementById('f_lab_sodium').value, '138');
    assert.equal(window.modalLabReportDate, null);
  });

  test('prompts for the report date when it differs from today, and stores it on confirm', async () => {
    const { window, document } = loadFrontendEnv();
    window.openPatientModal(window.blankPatient());
    window.aiAvailable = true;
    window.callAi = async () => ({ labs: { hb: '11.0' }, reportDate: '2026-07-10' });
    window.showToast = () => {};
    window.showConfirm = async () => true; // simulate PG confirming "use report date"

    const fakeFile = new window.File(['fake-bytes'], 'report.jpg', { type: 'image/jpeg' });
    await window.handleLabPhotoSelected(fakeFile);

    assert.equal(window.modalLabReportDate, '2026-07-10');
  });

  test('declining the report-date prompt leaves modalLabReportDate null', async () => {
    const { window } = loadFrontendEnv();
    window.openPatientModal(window.blankPatient());
    window.aiAvailable = true;
    window.callAi = async () => ({ labs: { hb: '11.0' }, reportDate: '2026-07-10' });
    window.showToast = () => {};
    window.showConfirm = async () => false; // PG declines — keep today's date

    const fakeFile = new window.File(['fake-bytes'], 'report.jpg', { type: 'image/jpeg' });
    await window.handleLabPhotoSelected(fakeFile);

    assert.equal(window.modalLabReportDate, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/frontend-lab-photo-extraction.test.js`
Expected: FAIL with `window.handleLabPhotoSelected is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add the new handler in `public/app.js`, right after `handleModalImageSelected` (~line 1560):

```js
async function handleModalImageSelected(e){
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  try{
    const raw = await fileToDataURL(file);
    const compressed = await compressImage(raw);
    modalPendingImages.push({ id: uid(), dataURL: compressed, type: 'preop' });
    renderModalPendingXrays();
    showToast('X-ray attached — saved with patient');
  }catch(err){
    console.warn('Modal image attach failed:', err);
    showToast('Could not read image — try another file');
  }
}

async function handleLabPhotoSelected(file){
  if(!file) return 0;
  if(!canUseAi()){
    await refreshAiStatus();
  }
  if(!canUseAi()){
    showToast('AI not available — check server key or connection');
    return 0;
  }
  const btn = document.getElementById('labPhotoBtn');
  setAiButtonBusy(btn, true);
  try{
    const raw = await fileToDataURL(file);
    const compressed = await compressImage(raw);
    const { labs, reportDate } = await callAi('parse-labs-image', { image: compressed });
    const filled = applySmartPasteLabs(labs);
    if(reportDate && reportDate !== todayISO()){
      const useReportDate = await showConfirm(
        'Use report date?',
        `This report is dated ${reportDate} — use that date for this lab entry instead of today?`,
        { confirmLabel: 'Use report date' }
      );
      modalLabReportDate = useReportDate ? reportDate : null;
    }else{
      modalLabReportDate = null;
    }
    showToast(filled ? `Filled ${filled} field${filled > 1 ? 's' : ''} — review before saving` : 'Nothing recognisable in that photo');
    return filled;
  }catch(err){
    showToast(err.message || 'Could not read that lab report photo');
    return 0;
  }finally{
    setAiButtonBusy(btn, false);
  }
}
```

Wire the button click and file selection. In the delegated click handler, change:

```js
    const smartBtn = e.target.closest('#smartPasteBtn');
    if(smartBtn){
      e.stopPropagation();
      e.preventDefault();
      await runSmartPaste(smartBtn);
      return;
    }
```

to (add a new block immediately after):

```js
    const smartBtn = e.target.closest('#smartPasteBtn');
    if(smartBtn){
      e.stopPropagation();
      e.preventDefault();
      await runSmartPaste(smartBtn);
      return;
    }

    const labPhotoBtn = e.target.closest('#labPhotoBtn');
    if(labPhotoBtn){
      e.stopPropagation();
      e.preventDefault();
      document.getElementById('labPhotoFileInput')?.click();
      return;
    }
```

Bind the file input's change listener alongside the existing `modalFileInput` binding:

```js
  document.getElementById('modalFileInput')?.addEventListener('change', handleModalImageSelected);
```

becomes:

```js
  document.getElementById('modalFileInput')?.addEventListener('change', handleModalImageSelected);
  document.getElementById('labPhotoFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    void handleLabPhotoSelected(file);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/frontend-lab-photo-extraction.test.js`
Expected: PASS (all tests in the file, ~14 total)

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add public/app.js tests/frontend-lab-photo-extraction.test.js
git commit -m "Add lab report photo capture, AI extraction, and report-date confirmation"
```

---

### Task 9: README privacy note and final verification

**Files:**
- Modify: `README.md` (the "AI assistants (optional)" section's "Privacy" subsection, ~line 189-193)

**Interfaces:**
- Consumes: nothing.
- Produces: documentation only — no code interface.

- [ ] **Step 1: Update the README**

In `README.md`, change:

```markdown
### Privacy

- Patient snapshots sent to OpenAI **exclude images and UHID**
- AI output is a **draft only** — PGs must review before saving
- Recommend hospital IT review before using with real patient data on a cloud API
```

to:

```markdown
### Privacy

- Patient snapshots sent to OpenAI **exclude images and UHID**
- **Exception:** the lab report photo-extraction feature sends the photo
  itself to OpenAI to transcribe — this is the one AI flow where an image
  leaves the server, since there's no way to redact a name printed inside
  a photo the way sanitized text fields can be. Every other AI feature
  never sends images.
- AI output is a **draft only** — PGs must review before saving
- Recommend hospital IT review before using with real patient data on a cloud API
```

- [ ] **Step 2: Run the full test suite one final time**

Run: `npm test`
Expected: all tests pass — this is the final confirmation that every task's changes compose correctly together (191 tests expected: 171 baseline + 3 in `tests/ai-parse-labs-image.test.js` + ~17 in `tests/frontend-lab-photo-extraction.test.js` + 2 new in `tests/clinical-normalize.test.js`, exact count depends on final test enumeration).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document the lab-photo AI flow as an exception to the images-never-leave-the-server policy"
```

---

## Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-07-19-lab-report-photo-extraction-design.md` maps to a task — panel expansion (Tasks 1, 4), backend AI call (Task 2), route (Task 3), both entry points sharing one mechanism (Task 5's single labs-grid section, confirmed to already serve both admission and edit/rounds-day contexts since `renderModalForm` is the same function in both cases), save-flow/history wiring (Task 6), Smart-Paste-style fill (Task 7), error handling (Task 8's try/catch + existing toast conventions), privacy documentation (Task 9).
- **Placeholder scan:** none — every step has complete, copy-pasteable code and exact commands.
- **Type/name consistency check:** `parseLabsFromImage` (Task 2) → same name in the `server.js` import and call (Task 3) → same endpoint string `'parse-labs-image'` used in Task 3's route match and Task 8's `callAi('parse-labs-image', ...)` call → same response shape `{ labs, reportDate }` used consistently in Task 2's return, Task 3's `sendJSON`, and Task 8's destructuring. `modalLabReportDate` declared in Task 6, consumed in Task 6's save block and set in Task 8 — same name throughout. `applySmartPasteLabs` signature (`labs => filled count`) unchanged from its pre-existing shape, just given more pairs to check (Task 7), so Task 8's use of it needs no adaptation.
