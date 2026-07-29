import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

describe('image placeholders', () => {
  test('addImagePlaceholder renders an uploading thumb for that patient', () => {
    const patient = {
      id: 'p1', name: 'Ada', status: 'preop', bed: '1',
      images: [], investigations: [], fitness: [], postOpChecks: []
    };
    // openCardId must be set so renderCard includes the x-ray row in the card body
    const { window, document } = loadFrontendEnv({
      initScript: `patients = ${JSON.stringify([patient])}; currentFilter = 'all'; openCardId = 'p1';`
    });
    const id = window.addImagePlaceholder('p1');
    window.renderRounds();
    const ph = document.querySelector('.xray-thumb.is-placeholder');
    assert.ok(ph, 'expected placeholder thumb');
    assert.equal(ph.getAttribute('aria-busy'), 'true');
    assert.match(ph.getAttribute('aria-label') || '', /upload/i);
    window.removeImagePlaceholder(id);
    window.renderRounds();
    assert.equal(document.querySelector('.xray-thumb.is-placeholder'), null);
  });

  test('removeImagePlaceholder is a no-op for unknown ids', () => {
    const { window } = loadFrontendEnv();
    assert.doesNotThrow(() => window.removeImagePlaceholder('missing'));
  });

  test('confirmImageType save failure removes placeholder and rolls back images', async () => {
    const patient = {
      id: 'p1', name: 'Ada', status: 'preop', bed: '1',
      images: [], investigations: [], fitness: [], postOpChecks: []
    };
    const { window, document } = loadFrontendEnv({
      initScript: [
        `patients = ${JSON.stringify([patient])};`,
        `currentFilter = 'all';`,
        `openCardId = 'p1';`,
        `Object.defineProperty(window, 'patients', { get: function(){ return patients; }, configurable: true });`,
        `Object.defineProperty(window, 'pendingImageData', { get: function(){ return pendingImageData; }, set: function(v){ pendingImageData = v; }, configurable: true });`,
        `Object.defineProperty(window, 'imagePlaceholders', { get: function(){ return imagePlaceholders; }, configurable: true });`,
        // Same-eval reassignment so confirmImageType's lexical calls hit these mocks.
        `uploadPatientImage = async function(){ return '/api/images/fake.jpg'; };`,
        `savePatient = async function(){ throw new Error('persist failed'); };`
      ].join('\n')
    });
    window.showToast = () => {};
    const phId = window.addImagePlaceholder('p1');
    window.pendingImageData = { patientId: 'p1', compressed: 'data:image/jpeg;base64,xx', placeholderId: phId };
    document.getElementById('imgTypeModal').classList.add('active');
    window.renderRounds();
    assert.ok(document.querySelector('.xray-thumb.is-placeholder'), 'placeholder present before confirm');

    await window.confirmImageType('preop');

    assert.equal(document.querySelector('.xray-thumb.is-placeholder'), null, 'placeholder cleared on save failure');
    assert.equal(window.patients[0].images.length, 0, 'optimistic image push rolled back');
    assert.equal(window.pendingImageData, null, 'pending cleared');
    assert.equal(document.getElementById('imgTypeModal').classList.contains('active'), false);
  });
});
