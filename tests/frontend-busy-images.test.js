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
});
