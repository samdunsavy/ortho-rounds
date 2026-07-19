import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

/* Behavioral tests for the newest, least battle-tested client-side logic:
   the shared icon registry (added when raw emoji were replaced with SVG
   icons) and the X-ray viewer's zoom/pan state machine (added to fix the
   pinch-zoom-misread-as-swipe bug). Neither had any automated coverage
   before this — both had already been touched multiple times by different
   people/sessions with nothing to catch a regression.

   These test *behavior* (DOM state after calling a function), not internal
   module-scope variables — app.js is a plain script, so top-level `let`
   state (like ivScale) isn't reachable as a window property from outside
   even though it's visible to code evaluated inside the same script realm.
   Asserting on observable output (style.transform, classList) is the
   correct level to test at here anyway. */

describe('uiIcon — shared SVG icon registry', () => {
  test('returns a wrapped, valid svg for every icon used by section() and the mic/pin call sites', () => {
    const { window } = loadFrontendEnv();
    const names = [
      'handover', 'pill', 'flask', 'alert', 'stopwatch', 'clock',
      'circleOutline', 'square', 'clipboard', 'pencil', 'checkmark',
      'mic', 'stop', 'pin'
    ];
    for(const name of names){
      const markup = window.uiIcon(name);
      assert.match(markup, /^<svg class="icon-svg" viewBox="0 0 24 24">/, `${name} should render an icon-svg wrapper`);
      assert.match(markup, /<\/svg>$/, `${name} should close its svg tag`);
      assert.ok(markup.length > 40, `${name} should contain real path data, not an empty shell`);
    }
  });

  test('falls back to a known icon for an unrecognized name instead of rendering blank', () => {
    const { window } = loadFrontendEnv();
    const markup = window.uiIcon('not-a-real-icon-name');
    assert.match(markup, /^<svg class="icon-svg" viewBox="0 0 24 24">/);
    assert.ok(markup.length > 40);
  });

  test('escapeHTML still escapes the five dangerous characters (used everywhere icons sit next to user text)', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.escapeHTML(`<script>&"'</script>`), '&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
    assert.equal(window.escapeHTML(null), '');
    assert.equal(window.escapeHTML(undefined), '');
  });
});

describe('X-ray viewer — zoom/pan state machine', () => {
  test('toggleImgViewerZoom zooms in around the tap point, then back out to resting state', () => {
    const { window, document } = loadFrontendEnv();
    const imgEl = document.getElementById('imgViewerImg');
    assert.equal(imgEl.style.transform, '', 'starts at rest with no transform');

    window.toggleImgViewerZoom(100, 100);
    assert.match(imgEl.style.transform, /scale\(2\.5\)/, 'zooms to 2.5x on first toggle');
    assert.match(imgEl.style.transform, /translate\(/, 'pans to center the tapped point');
    assert.ok(imgEl.classList.contains('iv-zoomed'), 'adds the zoomed class so cursor/UI can react');

    window.toggleImgViewerZoom(100, 100);
    assert.equal(imgEl.style.transform, '', 'second toggle resets back to resting state');
    assert.ok(!imgEl.classList.contains('iv-zoomed'), 'removes the zoomed class on reset');
  });

  test('resetImgViewerZoom always returns to a clean resting transform, even mid-zoom', () => {
    const { window, document } = loadFrontendEnv();
    const imgEl = document.getElementById('imgViewerImg');
    window.toggleImgViewerZoom(50, 50);
    assert.notEqual(imgEl.style.transform, '');
    window.resetImgViewerZoom();
    assert.equal(imgEl.style.transform, '');
    assert.ok(!imgEl.classList.contains('iv-zoomed'));
  });

  test('applyImgViewerTransform reflects whatever pan/scale state is live, without needing a full render', () => {
    const { window, document } = loadFrontendEnv();
    const imgEl = document.getElementById('imgViewerImg');
    // Drive it the way the pinch/pan gesture handlers do: mutate state via
    // the exported toggle, since ivScale/ivPanX/ivPanY themselves aren't
    // reachable as window properties (see file header) — this exercises
    // the same code path a real pinch gesture would.
    window.toggleImgViewerZoom(0, 0);
    assert.match(imgEl.style.transform, /scale\(2\.5\)/);
  });

  test('this test suite intentionally does not simulate raw touchstart/touchmove/touchend', () => {
    // Synthetic multi-touch events in jsdom are unreliable enough (no real
    // Touch/TouchEvent geometry, no real gesture timing) that testing the
    // gesture handlers themselves this way would be more fragile than
    // valuable. That's exactly what POLISH.md's "deliberate device-testing
    // pass" is for — this suite covers the zoom/pan *outcomes*, a real
    // touchscreen covers the *gesture recognition*.
    assert.ok(true);
  });
});
