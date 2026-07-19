/* Loads public/index.html + public/app.js into a jsdom environment so pure
   client-side logic (icon rendering, the X-ray viewer's zoom/pan math,
   escapeHTML, etc.) can be unit-tested with node:test, without a real
   browser. This sandbox can't run headless Chromium (missing system
   graphics libraries, no root to install them), so full visual/pixel
   testing isn't available here — but behavioral testing of pure logic is,
   and that's most of what actually breaks silently.

   app.js is a plain (non-module) script that calls init() unconditionally
   at the bottom. Loading it normally would immediately try to open
   IndexedDB, register a service worker, and hit the network — none of
   which exist in this environment. Setting __ORTHO_SKIP_AUTOINIT__ before
   evaluating the script (see the guard at the bottom of app.js) skips that
   bootstrap so only the function *definitions* run, which is all a unit
   test needs.

   Usage:
     import { loadFrontendEnv } from './helpers/frontend-env.js';
     const { window } = loadFrontendEnv();
     window.uiIcon('mic'); // etc.

   Seeding module-level state (e.g. the top-level `let patients = []` that
   collectWorklistData()/collectStartHereItems() read from): pass
   `initScript`, a string of statements appended to app.js's own source
   before the single window.eval() call. This has to happen as part of the
   SAME eval invocation that defines app.js's functions, not a later,
   separate window.eval() call -- this jsdom setup does not share top-level
   `let`/`const` bindings across separate eval() calls (only `window`
   properties, i.e. function declarations and `var`, persist across calls),
   so a second eval doing `patients = [...]` after the fact is invisible to
   any function whose closure captured the *first* eval's `patients`
   binding, even though a *later* eval reading `patients` back would appear
   to see it (it's silently reading/writing an unrelated implicit global).
   Appending to the same source string sidesteps the whole issue since it's
   one parse, one scope, no cross-eval sharing involved.

     const { window } = loadFrontendEnv({ initScript: `patients = ${JSON.stringify([...])};` });
*/

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

export function loadFrontendEnv(options){
  const { initScript = '' } = options || {};
  const html = readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only', // we eval app.js ourselves, below
    storageQuota: 10_000_000
  });
  const { window } = dom;

  // Browser APIs jsdom doesn't implement, that app.js references at
  // definition time or that individual functions may call. Minimal stubs —
  // just enough that loading the file and calling pure functions doesn't
  // throw; tests exercising sync/AI/network code paths should mock further
  // per-test.
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener(){}, removeEventListener(){} }));
  window.fetch = window.fetch || (async () => { throw new Error('fetch not mocked in frontend test env'); });
  window.speechSynthesis = window.speechSynthesis || { cancel(){}, speak(){} };
  window.SpeechRecognition = window.SpeechRecognition || undefined;
  window.webkitSpeechRecognition = window.webkitSpeechRecognition || undefined;
  if(!window.navigator.serviceWorker){
    Object.defineProperty(window.navigator, 'serviceWorker', { value: undefined, configurable: true });
  }
  window.__ORTHO_SKIP_AUTOINIT__ = true;

  const appJs = readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const milestonesJs = readFileSync(path.join(PUBLIC_DIR, 'milestones.js'), 'utf8');
  window.eval(milestonesJs);
  window.eval(initScript ? `${appJs}\n${initScript}` : appJs);

  return { dom, window, document: window.document };
}
