import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OT_DOCTORS, normalizeOtDoctors, resolveOtDoctors,
  formatOtListDate, formatOtAge, formatOtUnitLabel, buildOtListDocx,
  sanitizeOtExportPatient, countOtBodyRows
} from '../ot-list.js';

describe('OT list helpers', () => {
  test('default doctors match the hospital template team', () => {
    assert.deepEqual(DEFAULT_OT_DOCTORS, [
      'DR MAHESH', 'DR BALAKRISHNA', 'DR JACOB', 'DR DEEPAK'
    ]);
  });

  test('resolveOtDoctors prefers patient team, then ward defaults, then template defaults', () => {
    assert.deepEqual(resolveOtDoctors({ otDoctors: ['DR A'] }, DEFAULT_OT_DOCTORS), ['DR A']);
    assert.deepEqual(resolveOtDoctors({}, ['DR X', 'DR Y']), ['DR X', 'DR Y']);
    assert.deepEqual(resolveOtDoctors({}, []), DEFAULT_OT_DOCTORS);
  });

  test('normalizeOtDoctors accepts arrays and newline strings', () => {
    assert.deepEqual(normalizeOtDoctors('DR A\nDR B\n'), ['DR A', 'DR B']);
    assert.deepEqual(normalizeOtDoctors([' DR A ', '', 'DR B']), ['DR A', 'DR B']);
  });

  test('formats date age and unit like the Word template', () => {
    assert.equal(formatOtListDate('2026-07-13'), '13/07/26');
    assert.equal(formatOtAge('28'), '28 YR');
    assert.equal(formatOtAge('28 YR'), '28 YR');
    assert.equal(formatOtUnitLabel('IV'), 'OT LIST UNIT IV');
    assert.equal(formatOtUnitLabel('unit IV'), 'OT LIST UNIT IV');
  });

  test('sanitizeOtExportPatient keeps only template fields', () => {
    const out = sanitizeOtExportPatient({
      id: 'p1', name: 'Afzal', age: '28', sex: 'M', ward: '7MOW', uhid: '1',
      diagnosis: 'fx', procedure: 'ORIF', payer: 'ABARK', anaesthesia: 'GA',
      otDoctors: ['DR MAHESH'], otOrder: 1, dailyPlan: 'should not appear', images: []
    });
    assert.equal(out.name, 'Afzal');
    assert.equal(out.payer, 'ABARK');
    assert.equal(out.dailyPlan, undefined);
    assert.equal(out.images, undefined);
  });

  test('buildOtListDocx returns a non-empty docx buffer', async () => {
    const buf = await buildOtListDocx({
      date: '2026-07-13',
      unit: 'IV',
      patients: [{
        name: 'AFZAL PASHA', age: '28', sex: 'M', ward: '7MOW', uhid: '3439047',
        diagnosis: 'BOTH BONE FOREARM FRACTURE', procedure: 'ORIF WITH PLATES',
        payer: 'ABARK', anaesthesia: 'GA', otOrder: 1, otDoctors: [], cArmRequired: true
      }]
    });
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 1000);
    // DOCX files are ZIP archives
    assert.equal(buf[0], 0x50);
    assert.equal(buf[1], 0x4b);
  });

  test('sanitizeOtExportPatient keeps equipment banners', () => {
    const out = sanitizeOtExportPatient({
      id: 'p1', name: 'A', cArmRequired: true, arthroMonitorRequired: true, dailyPlan: 'x'
    });
    assert.equal(out.cArmRequired, true);
    assert.equal(out.arthroMonitorRequired, true);
    assert.equal(out.dailyPlan, undefined);
  });

  test('countOtBodyRows includes equipment banners', () => {
    assert.equal(countOtBodyRows([
      { cArmRequired: true },
      { arthroMonitorRequired: true },
      {}
    ]), 5);
  });

  test('buildOtListDocx merges doctors column for multiple patients', async () => {
    const buf = await buildOtListDocx({
      date: '2026-07-13',
      unit: 'IV',
      patients: [
        {
          name: 'A', age: '28', sex: 'M', ward: '7MOW', uhid: '1',
          diagnosis: 'DX', procedure: 'PROC', anaesthesia: 'GA', otOrder: 1,
          otDoctors: [], cArmRequired: true
        },
        {
          name: 'B', age: '40', sex: 'F', ward: '7MOW', uhid: '2',
          diagnosis: 'DX', procedure: 'PROC', anaesthesia: 'SA', otOrder: 2,
          otDoctors: []
        }
      ]
    });
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 1000);
  });
});
