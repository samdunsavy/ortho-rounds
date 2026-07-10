import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAdmissionWhatsApp,
  formatDiagnosisForWhatsApp,
  resolvePatientUnit,
  resolveWardType
} from '../admission.js';

describe('formatDiagnosisForWhatsApp', () => {
  test('splits plus-separated injuries onto separate lines', () => {
    const out = formatDiagnosisForWhatsApp(
      'L3 wedge compression fracture+ Right radial styloid fracture+ Left navicular fracture'
    );
    assert.equal(out, 'L3 wedge compression fracture+\nRight radial styloid fracture+\nLeft navicular fracture');
  });

  test('strips Imp prefix', () => {
    assert.equal(formatDiagnosisForWhatsApp('Imp : femur shaft fracture'), 'femur shaft fracture');
  });
});

describe('resolvePatientUnit', () => {
  test('uses patient unit when set', () => {
    assert.equal(resolvePatientUnit({ unit: 'III' }, 'IV'), 'III');
  });

  test('falls back to default unit', () => {
    assert.equal(resolvePatientUnit({}, 'II'), 'II');
  });

  test('falls back to IV when nothing set', () => {
    assert.equal(resolvePatientUnit({}), 'IV');
  });
});

describe('formatAdmissionWhatsApp', () => {
  test('formats Shivappa-style admission with default unit', () => {
    const text = formatAdmissionWhatsApp({
      name: 'Shivappa SS',
      age: '53',
      sex: 'M',
      diagnosis: 'L3 wedge compression fracture+ Right radial styloid process fracture+ Left navicular fracture+ Base of left second metatarsal fracture'
    }, { defaultUnit: 'IV' });

    assert.match(text, /^New admission sir/);
    assert.match(text, /Shivappa SS/);
    assert.match(text, /53 years \/ Male/);
    assert.match(text, /Imp : L3 wedge compression fracture\+/);
    assert.match(text, /Admitted under ortho unit - IV/);
    assert.match(text, /Free ward/);
    assert.match(text, /Thank you sir$/);
  });

  test('uses patient unit over default', () => {
    const text = formatAdmissionWhatsApp({
      name: 'Test',
      age: '40',
      sex: 'F',
      unit: 'III',
      wardType: 'Paid ward',
      diagnosis: 'Colles fracture'
    }, { defaultUnit: 'IV' });
    assert.match(text, /Admitted under ortho unit - III/);
    assert.match(text, /Paid ward/);
  });
});

describe('resolveWardType', () => {
  test('defaults to Free ward', () => {
    assert.equal(resolveWardType({}), 'Free ward');
  });
});
