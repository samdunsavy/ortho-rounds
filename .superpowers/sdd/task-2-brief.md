### Task 2: `ai.js` + `server.js` — prompt updates and otherLabs passthrough

**Files:**
- Modify: `ai.js` (`parseLabsFromImage` ~416-434, `parseAdmission` prompt ~371, import at line 6)
- Modify: `server.js:599-600`
- Test: `tests/ai-parse-labs-image.test.js`

**Interfaces:**
- Consumes: `extractOtherLabs(raw)`, `KNOWN_LAB_KEYS` from Task 1.
- Produces: `parseLabsFromImage(imageDataUrl) -> { labs, otherLabs, reportDate }` (new `otherLabs` key); `POST /api/ai/parse-labs-image` response gains `otherLabs`.

- [ ] **Step 1: Write the failing test**

Append to `tests/ai-parse-labs-image.test.js` inside the existing `describe('parseLabsFromImage')` (uses the file's existing `mockOpenAi` helper):

```js
  test('captures unrecognized analytes as otherLabs instead of dropping them', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          labs: { hb: '11.2', uricAcid: '8.2' },
          otherLabs: [{ name: 'HbA1c', value: '6.1' }],
          reportDate: null
        }) } }]
      })
    }));
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.equal(result.labs.hb, '11.2');
    assert.equal('uricAcid' in result.labs, false);
    assert.deepEqual(result.otherLabs, [
      { name: 'uricAcid', value: '8.2' },
      { name: 'HbA1c', value: '6.1' }
    ]);
  });

  test('accepts bone-profile keys as first-class labs', async (t) => {
    const restore = mockOpenAi(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          labs: { calcium: '9.1', phosphate: '3.2', alp: '95', albumin: '3.9' },
          reportDate: null
        }) } }]
      })
    }));
    t.after(restore);

    const result = await parseLabsFromImage('data:image/jpeg;base64,AAAA');
    assert.deepEqual(result.labs, { calcium: '9.1', phosphate: '3.2', alp: '95', albumin: '3.9' });
    assert.deepEqual(result.otherLabs, []);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ai-parse-labs-image.test.js`
Expected: FAIL — `result.otherLabs` is `undefined`; bone-profile test may already pass after Task 1 (fine).

- [ ] **Step 3: Implement**

In `ai.js` line 6 import block, add `extractOtherLabs` to the existing `from './clinical-normalize.js'` import.

In `parseLabsFromImage`, replace the system prompt's key list line ("labs": object with optional string keys — …) with:

```
"labs": object with optional string keys — hb, platelets, wcc, esr, crp, urea, creatinine, sodium, potassium, ptinr, rbs, calcium, phosphate, alp, albumin. Use the exact numeric value as printed (no units in the value). Omit any key not legible or not present on the report — never guess or invent a value.
"otherLabs": array of {name, value} for any other legible analyte printed on the report that does not fit a key above. name exactly as printed (max 30 chars), value as printed without units. Same rules: transcribe only, never guess, no patient-identifying text.
```

And after `const labs = sanitizeLabs(raw?.labs);` add:

```js
  const otherLabs = extractOtherLabs(raw);
```

Change the return to:

```js
  return { labs, otherLabs, reportDate };
```

In `parseAdmission`'s system prompt (~line 371), change

```
labs: object with optional keys hb, crp, wcc, creatinine (string numbers only, Indian report units),
```

to

```
labs: object with optional keys hb, crp, wcc, creatinine, platelets, esr, urea, sodium, potassium, ptinr, rbs, calcium, phosphate, alp, albumin (string numbers only, Indian report units),
```

In `server.js` lines 599-600, replace:

```js
        const { labs, otherLabs, reportDate } = await parseLabsFromImage(body.image);
        return sendJSON(res, 200, { labs, otherLabs, reportDate });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/ai-parse-labs-image.test.js`
Expected: PASS (all, including the three pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add ai.js server.js tests/ai-parse-labs-image.test.js
git commit -m "feat: AI lab extraction returns otherLabs; prompts cover 15-key panel"
```

---

