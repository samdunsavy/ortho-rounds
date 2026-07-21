### Task 1: `clinical-normalize.js` — KNOWN_LAB_KEYS, 15-key sanitizeLabs, extractOtherLabs, mergeLabs union

**Files:**
- Modify: `clinical-normalize.js:158-172`
- Test: `tests/clinical-normalize.test.js`

**Interfaces:**
- Produces: `KNOWN_LAB_KEYS: string[]` (15 keys, exported); `sanitizeLabs(raw) -> {[key]: string}` (unchanged signature, now 15 keys); `extractOtherLabs(raw) -> [{name, value}]` where `raw` is the whole AI response object (`{labs, otherLabs}`); `mergeLabs(primary, fallback)` (unchanged signature, now unions `otherLabs` arrays by name).

- [ ] **Step 1: Write the failing tests**

Append to `tests/clinical-normalize.test.js` (it already imports `sanitizeLabs` and `mergeLabs` from `../clinical-normalize.js` at line ~10; add `extractOtherLabs` and `KNOWN_LAB_KEYS` to that import):

```js
describe('sanitizeLabs — bone profile keys', () => {
  test('accepts calcium, phosphate, alp, albumin', () => {
    const out = sanitizeLabs({ calcium: '9.1', phosphate: '3.2', alp: '95', albumin: '3.9' });
    assert.deepEqual(out, { calcium: '9.1', phosphate: '3.2', alp: '95', albumin: '3.9' });
  });

  test('KNOWN_LAB_KEYS has exactly the 15 panel keys', () => {
    assert.deepEqual([...KNOWN_LAB_KEYS].sort(), [
      'albumin','alp','calcium','creatinine','crp','esr','hb','phosphate',
      'platelets','potassium','ptinr','rbs','sodium','urea','wcc'
    ]);
  });
});

describe('extractOtherLabs', () => {
  test('harvests unknown keys from labs object and explicit otherLabs array', () => {
    const out = extractOtherLabs({
      labs: { hb: '11', uricAcid: '8.2' },
      otherLabs: [{ name: 'HbA1c', value: '6.1' }]
    });
    assert.deepEqual(out, [
      { name: 'uricAcid', value: '8.2' },
      { name: 'HbA1c', value: '6.1' }
    ]);
  });

  test('caps lengths and entry count, dedupes case-insensitively, drops empties', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Lab${i}`, value: String(i) }));
    const out = extractOtherLabs({ otherLabs: many });
    assert.equal(out.length, 12);

    const capped = extractOtherLabs({ otherLabs: [{ name: 'X'.repeat(60), value: 'Y'.repeat(30) }] });
    assert.equal(capped[0].name.length, 40);
    assert.equal(capped[0].value.length, 20);

    const deduped = extractOtherLabs({ otherLabs: [
      { name: 'Uric Acid', value: '8' },
      { name: 'uric acid', value: '9' },
      { name: '', value: '5' },
      { name: 'Bilirubin', value: '' },
      { name: 'Bilirubin', value: 'null' }
    ]});
    assert.deepEqual(deduped, [{ name: 'Uric Acid', value: '8' }]);
  });

  test('returns [] for malformed input', () => {
    assert.deepEqual(extractOtherLabs(null), []);
    assert.deepEqual(extractOtherLabs('junk'), []);
    assert.deepEqual(extractOtherLabs({ otherLabs: 'junk', labs: 7 }), []);
    assert.deepEqual(extractOtherLabs({ otherLabs: [null, 'x', 42] }), []);
  });
});

describe('mergeLabs — otherLabs union', () => {
  test('unions otherLabs by name, primary wins', () => {
    const out = mergeLabs(
      { hb: '11', otherLabs: [{ name: 'Uric Acid', value: '8.2' }] },
      { crp: '5', otherLabs: [{ name: 'uric acid', value: '7.0' }, { name: 'HbA1c', value: '6.1' }] }
    );
    assert.equal(out.hb, '11');
    assert.equal(out.crp, '5');
    assert.deepEqual(out.otherLabs, [
      { name: 'Uric Acid', value: '8.2' },
      { name: 'HbA1c', value: '6.1' }
    ]);
  });

  test('no otherLabs key when neither side has entries', () => {
    const out = mergeLabs({ hb: '11' }, { crp: '5' });
    assert.equal('otherLabs' in out, false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/clinical-normalize.test.js`
Expected: FAIL — `KNOWN_LAB_KEYS`/`extractOtherLabs` not exported; bone-profile keys dropped by `sanitizeLabs`; `otherLabs` union missing.

- [ ] **Step 3: Implement in `clinical-normalize.js`**

Replace lines 158-172 (`sanitizeLabs` + `mergeLabs`) with:

```js
export const KNOWN_LAB_KEYS = [
  'hb', 'crp', 'wcc', 'creatinine', 'platelets', 'esr', 'urea',
  'sodium', 'potassium', 'ptinr', 'rbs',
  'calcium', 'phosphate', 'alp', 'albumin'
];

export function sanitizeLabs(raw){
  if(!raw || typeof raw !== 'object') return {};
  const out = {};
  for(const key of KNOWN_LAB_KEYS){
    const val = raw[key];
    if(val === undefined || val === null) continue;
    const str = String(val).trim();
    if(str && str.toLowerCase() !== 'null') out[key] = str;
  }
  return out;
}

const OTHER_LABS_MAX = 12;
const OTHER_LAB_NAME_MAX = 40;
const OTHER_LAB_VALUE_MAX = 20;

/** Harvest analytes the AI read that aren't in the known panel.
 *  `raw` is the whole AI response object: unknown keys inside raw.labs
 *  plus entries of raw.otherLabs ([{name, value}]). Capture-don't-drop. */
export function extractOtherLabs(raw){
  const out = [];
  const seen = new Set();
  const push = (name, value) => {
    const n = String(name ?? '').trim().slice(0, OTHER_LAB_NAME_MAX);
    const v = String(value ?? '').trim().slice(0, OTHER_LAB_VALUE_MAX);
    if(!n || !v || v.toLowerCase() === 'null') return;
    const dedupeKey = n.toLowerCase();
    if(seen.has(dedupeKey) || out.length >= OTHER_LABS_MAX) return;
    seen.add(dedupeKey);
    out.push({ name: n, value: v });
  };
  if(!raw || typeof raw !== 'object') return out;
  if(raw.labs && typeof raw.labs === 'object'){
    for(const [k, v] of Object.entries(raw.labs)){
      if(!KNOWN_LAB_KEYS.includes(k)) push(k, v);
    }
  }
  if(Array.isArray(raw.otherLabs)){
    for(const entry of raw.otherLabs){
      if(entry && typeof entry === 'object') push(entry.name, entry.value);
    }
  }
  return out;
}

export function mergeLabs(primary, fallback){
  const merged = Object.assign({}, fallback || {}, primary || {});
  const pOther = Array.isArray(primary?.otherLabs) ? primary.otherLabs : [];
  const fOther = Array.isArray(fallback?.otherLabs) ? fallback.otherLabs : [];
  if(pOther.length || fOther.length){
    const seen = new Set();
    const union = [];
    for(const e of [...pOther, ...fOther]){
      if(!e || !e.name) continue;
      const k = String(e.name).toLowerCase();
      if(seen.has(k)) continue;
      seen.add(k);
      union.push(e);
    }
    merged.otherLabs = union;
  }else{
    delete merged.otherLabs;
  }
  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/clinical-normalize.test.js`
Expected: PASS (all, including pre-existing sanitizeLabs/mergeLabs tests).

- [ ] **Step 5: Commit**

```bash
git add clinical-normalize.js tests/clinical-normalize.test.js
git commit -m "feat: 15-key lab panel + extractOtherLabs capture in clinical-normalize"
```

---

