/* Loads v2 ES modules for testing.

   Two traps this helper exists to avoid:

   1. ESM module caching. `import()` returns the SAME module instance for
      the same specifier for the whole process. app.js captures `document`
      and `window` at module scope, so a second test booting a second jsdom
      would silently keep talking to the FIRST one. Every load appends a
      unique query string to force a fresh module instance.

   2. Globals must exist BEFORE the module body runs. app.js reads
      `document` at import time, so global assignment has to happen first,
      not after. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const V2 = new URL('../../public/v2/', import.meta.url);
const SHELL = readFileSync(new URL('index.html', V2), 'utf8');
let seq = 0;

/** Load a pure v2 module (data.js, render.js) with milestones globals present.
 *  These modules touch no DOM, so no jsdom is needed. */
export async function loadV2Module(name){
  const milestones = readFileSync(new URL('../../public/milestones.js', import.meta.url), 'utf8');
  vm.runInThisContext(milestones);
  return import(new URL(name, V2) + `?n=${++seq}`);
}

/** Boot the full v2 client against a fresh jsdom.
 *  Returns { dom, window, document, api, errors } where `api` is window.__V2__. */
export async function bootV2({ patients = [], width = 1440, fetchImpl } = {}){
  const dom = new JSDOM(SHELL, { runScripts:'outside-only', url:'http://localhost/v2/' });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });

  const errors = [];
  window.addEventListener('error', e => errors.push(e.message));
  window.print = () => {};
  window.fetch = fetchImpl
    || (async () => ({ ok:true, json: async () => ({ serverTime:1, patients }) }));

  const milestones = readFileSync(new URL('../../public/milestones.js', import.meta.url), 'utf8');
  window.eval(milestones);

  const prev = {};
  for(const k of ['window','document','navigator','fetch','KeyboardEvent','MouseEvent','Event','requestAnimationFrame']){
    prev[k] = globalThis[k];
    globalThis[k] = k === 'requestAnimationFrame'
      ? (cb => setTimeout(cb, 0))
      : window[k];
  }
  try {
    await import(new URL('app.js', V2) + `?n=${++seq}`);
  } finally {
    for(const k of Object.keys(prev)) globalThis[k] = prev[k];
  }

  const api = window.__V2__;
  if(!api) throw new Error('app.js did not expose window.__V2__');
  await api.render();
  return { dom, window, document: window.document, api, errors };
}

/** Dispatch a keydown on the booted document. */
export function press(window, key, mods = {}){
  window.document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key, bubbles:true, ...mods }));
}
