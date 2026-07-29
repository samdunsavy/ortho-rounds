import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

describe('cold vs warm list loading', () => {
  test('empty patients while syncing shows Loading, not No patients', () => {
    const { window, document } = loadFrontendEnv({
      initScript: `patients = []; syncing = true; currentFilter = 'all';`
    });
    window.renderRounds();
    const text = document.getElementById('roundsList').textContent;
    assert.match(text, /Loading/i);
    assert.doesNotMatch(text, /No patients here yet/);
  });

  test('empty patients when not syncing shows finished empty state', () => {
    const { window, document } = loadFrontendEnv({
      initScript: `patients = []; syncing = false; currentFilter = 'all';`
    });
    window.renderRounds();
    const text = document.getElementById('roundsList').textContent;
    assert.match(text, /No patients here yet/);
  });

  test('cached patients remain visible while syncing', () => {
    const patient = {
      id: 'p1', name: 'Ada', status: 'preop', bed: '1', ward: '7',
      images: [], investigations: [], fitness: [], postOpChecks: []
    };
    const { window, document } = loadFrontendEnv({
      initScript: `patients = ${JSON.stringify([patient])}; syncing = true; currentFilter = 'all';`
    });
    window.renderRounds();
    assert.match(document.getElementById('roundsList').textContent, /Ada/);
  });
});
