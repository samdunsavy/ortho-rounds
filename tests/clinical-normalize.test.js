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
  normalizePatientClinicalFields
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
