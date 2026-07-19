import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('telemetry — local-only by default', () => {
  test('recordEvent increments in-memory counts, getSnapshot reports them', async () => {
    const { recordEvent, getSnapshot } = await import('../telemetry.js');
    const before = getSnapshot().counts.sync || 0;
    recordEvent('sync');
    recordEvent('sync');
    recordEvent('ai:draft-plan');
    const snap = getSnapshot();
    assert.equal(snap.counts.sync, before + 2);
    assert.equal(snap.counts['ai:draft-plan'] >= 1, true);
    assert.equal(typeof snap.startedAt, 'number');
    assert.equal(typeof snap.now, 'number');
  });

  test('ignores non-string / empty event names without throwing', async () => {
    const { recordEvent, getSnapshot } = await import('../telemetry.js');
    const before = { ...getSnapshot().counts };
    recordEvent('');
    recordEvent(null);
    recordEvent(undefined);
    recordEvent(42);
    assert.deepEqual(getSnapshot().counts, before);
  });

  test('export is disabled unless ORTHO_TELEMETRY_URL and the flag are BOTH set', async () => {
    delete process.env.ORTHO_TELEMETRY_URL;
    delete process.env.ORTHO_FLAG_TELEMETRY_EXPORT;
    const { isExportEnabled } = await import('../telemetry.js');
    assert.equal(isExportEnabled(), false);

    process.env.ORTHO_TELEMETRY_URL = 'https://example.invalid/collect';
    assert.equal(isExportEnabled(), false, 'URL alone must not enable export');

    process.env.ORTHO_FLAG_TELEMETRY_EXPORT = '1';
    assert.equal(isExportEnabled(), true, 'both URL and flag together enable export');

    delete process.env.ORTHO_TELEMETRY_URL;
    delete process.env.ORTHO_FLAG_TELEMETRY_EXPORT;
  });

  test('startExportLoop is a no-op with no URL/flag configured (no interval leaks)', async () => {
    delete process.env.ORTHO_TELEMETRY_URL;
    delete process.env.ORTHO_FLAG_TELEMETRY_EXPORT;
    const { startExportLoop, stopExportLoop } = await import('../telemetry.js');
    assert.doesNotThrow(() => startExportLoop(60000));
    stopExportLoop();
  });
});

describe('flags — everything defaults off', () => {
  test('unset flags all report false', async () => {
    for(const key of Object.keys(process.env)) if(key.startsWith('ORTHO_FLAG_')) delete process.env[key];
    const { listFlags, isEnabled } = await import('../flags.js');
    const flags = listFlags();
    assert.equal(Object.values(flags).every(v => v === false), true);
    assert.equal(isEnabled('MULTI_TENANT'), false);
  });

  test('a flag turns on only via its exact env var, "1" or "true"', async () => {
    const { isEnabled } = await import('../flags.js');
    process.env.ORTHO_FLAG_MULTI_TENANT = '1';
    assert.equal(isEnabled('MULTI_TENANT'), true);
    process.env.ORTHO_FLAG_MULTI_TENANT = 'true';
    assert.equal(isEnabled('MULTI_TENANT'), true);
    process.env.ORTHO_FLAG_MULTI_TENANT = 'yes';
    assert.equal(isEnabled('MULTI_TENANT'), false);
    delete process.env.ORTHO_FLAG_MULTI_TENANT;
  });
});
