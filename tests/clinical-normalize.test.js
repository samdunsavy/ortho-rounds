import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePersonName,
  normalizeDiagnosis,
  normalizeProcedure,
  normalizeSurgeon,
  extractLabsFromText,
  sanitizeAntibioticCourses,
  sanitizeLabs,
  normalizePatientClinicalFields,
  extractOtherLabs,
  KNOWN_LAB_KEYS,
  mergeLabs
} from '../clinical-normalize.js';

describe('normalizePersonName', () => {
  test('title-cases and uppercases initials', () => {
    assert.equal(normalizePersonName('shivappa ss'), 'Shivappa SS');
  });
});

describe('normalizeDiagnosis', () => {
  test('fixes spine levels and sides', () => {
    assert.equal(
      normalizeDiagnosis('l3 wedge compression fracture + right radial styloid fracture'),
      'L3 wedge compression fracture + Right radial styloid fracture'
    );
  });

  test('fixes cervical ranges', () => {
    assert.equal(normalizeDiagnosis('c5-6 disc prolapse'), 'C5-C6 disc prolapse');
  });
});

describe('normalizeProcedure', () => {
  test('normalizes ORIF abbreviation', () => {
    assert.match(normalizeProcedure('orif distal radius'), /ORIF/);
  });
});

describe('normalizeSurgeon', () => {
  test('handles Dr prefix', () => {
    assert.equal(normalizeSurgeon('dr rao'), 'Dr Rao');
  });
});

describe('extractLabsFromText', () => {
  test('pulls Hb and CRP from shorthand', () => {
    const labs = extractLabsFromText('Admitted. Hb 9.2, CRP 48, TLC 12000');
    assert.equal(labs.hb, '9.2');
    assert.equal(labs.crp, '48');
    assert.equal(labs.wcc, '12000');
  });
});

describe('sanitizeAntibioticCourses', () => {
  test('keeps named courses with duration', () => {
    const out = sanitizeAntibioticCourses([
      { name: 'augmentin 1.2g bd', days: '5' },
      { name: '', days: 0 }
    ], { start: '2026-07-11' });
    assert.equal(out.length, 1);
    assert.equal(out[0].days, 5);
    assert.equal(out[0].start, '2026-07-11');
  });
});

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

describe('normalizePatientClinicalFields', () => {
  test('normalizes multiple fields together', () => {
    const out = normalizePatientClinicalFields({
      name: 'shivappa ss',
      diagnosis: 'l3 fracture left femur',
      procedure: 'orif femur'
    });
    assert.equal(out.name, 'Shivappa SS');
    assert.match(out.diagnosis, /L3/);
    assert.match(out.diagnosis, /Left/);
    assert.match(out.procedure, /ORIF/);
  });
});

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

  test('skips entries in the explicit otherLabs array whose name is a known panel key', () => {
    const out = extractOtherLabs({ otherLabs: [
      { name: 'hb', value: '11' },
      { name: 'Hb', value: '11' },
      { name: 'ALP', value: '95' },
      { name: 'Uric Acid', value: '8.2' }
    ]});
    assert.deepEqual(out, [{ name: 'Uric Acid', value: '8.2' }]);
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
