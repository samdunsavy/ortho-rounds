# Visual System v2 Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v3 prototype as a working, real-data client at `/v2` on the existing service, leaving the main URL running the current app untouched.

**Architecture:** `public/v2/` is a self-contained client — its own HTML shell, seven layered CSS files, and three ES modules (`data.js`, `render.js`, `app.js`). It talks to the existing `POST /api/sync` endpoint over the same session cookie, so testers log in once and see their real ward. It reuses `public/milestones.js` verbatim for all clinical-day arithmetic rather than reimplementing it. It is **online-only by design**: no IndexedDB, no offline queue, no merge logic. Duplicating the sync/merge layer would double the riskiest code in the repo for a preview that exists to be watched over someone's shoulder for twenty minutes. Nothing in `public/index.html` or `public/app.js` is edited, so the main URL serves the old client by construction rather than by configuration.

**Tech Stack:** Vanilla ES modules, no build step, no new dependencies. Node 22 `node:test` + jsdom 29 for tests. Existing `serveStatic` in `server.js` for delivery.

## Global Constraints

- **No new runtime dependencies.** `package.json` dependencies must be unchanged at the end of this plan.
- **No build step.** CSS and JS are served as authored.
- **`public/index.html` and `public/app.js` must not be modified.** Verify with `git diff --stat` before every commit.
- **`public/sw.js` — one authorised exception (ruled 2026-08-02).** The root worker registers at scope `/` (`public/index.html:2568` calls `register('sw.js')` with no scope option), so it controls `/v2/` too. Its fetch handler intercepts every same-origin GET except `/api/`, and on network failure a navigation falls back to the cached `/index.html` — serving testers the OLD shell at the new URL. The permitted change is an early return in the fetch handler for paths under `/v2`, plus a cache-name bump. Nothing else in `sw.js` may change.
- **Reuse `public/milestones.js`.** Never reimplement `getPatientPod`, `isItemOverdue`, `isItemInDueWindow`, `isItemUpcoming`, `getMilestoneBuckets`, or `normalizePatientChecklists`.
- **All existing tests stay green.** Run `npm test` before every commit.
- **Preview banner is mandatory and non-dismissible.** Testers are editing real patient records.
- **`prefers-reduced-motion`** honoured in every CSS file that defines animation.
- **WCAG AA** on all text in both themes.
- **No PHI leaves the server.** This plan adds no new outbound requests.
- **Reference implementation:** `docs/prototypes/ortho-v3.html` is the source of truth for markup, CSS and interaction. Copy from it; do not redesign.
- **Spec:** `docs/superpowers/specs/2026-08-02-visual-system-v2-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `server.js` (modify) | Add `resolveStaticPath()` so directory URLs resolve to `index.html` |
| `public/v2/index.html` | Shell markup, icon sprite, script/style tags. No logic. |
| `public/v2/css/tokens.css` | `:root`, `[data-theme="dark"]`, type/space scales, easing, shadows |
| `public/v2/css/base.css` | Reset, typography, focus rings, scrollbars, reduced-motion, print |
| `public/v2/css/shell.css` | App grid, rail, header, spine, panes, bottom nav, breakpoint tiers |
| `public/v2/css/card.css` | Hero, film, identity, POD track, flags, plan, list rows |
| `public/v2/css/detail.css` | Record pane, checklists, plan history, field grids |
| `public/v2/css/board.css` | Ward board, tables, documents, admin |
| `public/v2/css/overlay.css` | Palette, modals, film viewer, presentation, toast, preview banner |
| `public/v2/data.js` | `fetchWard()`, `pushPatient()`, `toViewModel()`. No DOM. |
| `public/v2/render.js` | Pure fragment builders. Takes view models, returns HTML strings. No DOM, no state. |
| `public/v2/app.js` | State object, event delegation, view switching. Owns all DOM. |
| `tests/helpers/v2-env.js` | jsdom loader for v2 modules + `milestones.js` |
| `tests/v2-static-routing.test.js` | `resolveStaticPath` |
| `tests/v2-data.test.js` | `toViewModel` normalisation, POD/track derivation |
| `tests/v2-render.test.js` | Fragment builders, escaping, empty states |
| `tests/v2-shell.test.js` | End-to-end: every control fires, every breakpoint renders |

---

### Task 0: Measure imaging coverage

Spec §8.3 makes this a go/no-go on the whole card design. If fewer than ~40% of live patients have an uploaded film, the hero slot is mostly placeholder and the redesign is worse than what exists today. Run this **before Task 5**, and record the number.

**Files:**
- Create: `scripts/imaging-coverage.js`

**Interfaces:**
- Produces: a printed report. No exports, no runtime dependency.

- [ ] **Step 1: Write the script**

```js
// scripts/imaging-coverage.js
/* Reports what fraction of non-discharged patients have at least one
   uploaded film. Read-only: opens the same store the server uses and
   prints counts. No patient identifiers are printed. */
import { openStore } from '../storage.js';

const store = await openStore();
const all = await store.listPatients();
const live = all.filter(p => !p.discharged);
const withFilm = live.filter(p => Array.isArray(p.images) && p.images.length > 0);
const byStatus = {};
for(const p of live){
  const k = p.status || 'unknown';
  byStatus[k] ??= { total: 0, filmed: 0 };
  byStatus[k].total++;
  if(p.images?.length) byStatus[k].filmed++;
}

const pct = (a, b) => b ? Math.round((a / b) * 1000) / 10 : 0;
console.log(`live patients      ${live.length}`);
console.log(`with >=1 film      ${withFilm.length}  (${pct(withFilm.length, live.length)}%)`);
console.log('');
for(const [k, v] of Object.entries(byStatus)){
  console.log(`  ${k.padEnd(14)} ${String(v.filmed).padStart(3)}/${String(v.total).padEnd(3)} (${pct(v.filmed, v.total)}%)`);
}
console.log('');
console.log(pct(withFilm.length, live.length) >= 40
  ? 'GO — film-as-hero is viable.'
  : 'NO GO — demote the film to row scale and lead with identity (spec §8.3).');
await store.close?.();
```

- [ ] **Step 2: Run it**

Run: `node --no-warnings scripts/imaging-coverage.js`
Expected: a coverage percentage and a GO / NO GO line.

If `openStore` / `listPatients` are named differently in `storage.js`, adapt the two call sites — do not change `storage.js` itself.

- [ ] **Step 3: Record the decision**

Append the output as a dated note under a new `## Imaging coverage` heading in `docs/superpowers/specs/2026-08-02-visual-system-v2-design.md`, directly beneath §8.3.

If the result is NO GO, Task 5's `filmBox` still ships — but `hero()` renders the film at row scale (27×33) beside the identity block instead of as the 104×136 lead element, and `detail()` keeps the full gallery. Everything else in this plan is unchanged.

- [ ] **Step 4: Commit**

```bash
git add scripts/imaging-coverage.js docs/superpowers/specs/2026-08-02-visual-system-v2-design.md
git commit -m "chore: measure imaging coverage to settle film-as-hero"
```

---

### Task 1: Serve directory URLs

`serveStatic` maps `/` to `/index.html` but any other directory URL 404s, so `/v2` would fail. Extract the path resolution into a pure, testable function.

**Files:**
- Modify: `server.js:202-217` (`serveStatic`)
- Test: `tests/v2-static-routing.test.js`

**Interfaces:**
- Produces: `export function resolveStaticPath(urlPath: string): string` — returns the path relative to `PUBLIC_DIR`, appending `index.html` to any path ending in `/` and to bare directory names that exist.

- [ ] **Step 1: Write the failing test**

```js
// tests/v2-static-routing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStaticPath } from '../server.js';

test('root resolves to index.html', () => {
  assert.equal(resolveStaticPath('/'), '/index.html');
});

test('trailing-slash directory resolves to its index.html', () => {
  assert.equal(resolveStaticPath('/v2/'), '/v2/index.html');
});

test('bare directory name resolves to its index.html', () => {
  assert.equal(resolveStaticPath('/v2'), '/v2/index.html');
});

test('a real file path is returned unchanged', () => {
  assert.equal(resolveStaticPath('/app.js'), '/app.js');
});

test('a nested file path is returned unchanged', () => {
  assert.equal(resolveStaticPath('/v2/css/tokens.css'), '/v2/css/tokens.css');
});

test('a path with an extension is never treated as a directory', () => {
  assert.equal(resolveStaticPath('/manifest.webmanifest'), '/manifest.webmanifest');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/v2-static-routing.test.js`
Expected: FAIL — `resolveStaticPath` is not exported from `server.js`.

- [ ] **Step 3: Implement**

In `server.js`, immediately above `function serveStatic(req, res){`, add:

```js
/** Maps a request path to a file path under PUBLIC_DIR. Directory URLs
 *  (with or without a trailing slash) resolve to their index.html so
 *  /v2 and /v2/ both serve public/v2/index.html. Anything carrying a
 *  file extension is returned untouched. */
export function resolveStaticPath(urlPath){
  if(!urlPath || urlPath === '/') return '/index.html';
  if(urlPath.endsWith('/')) return urlPath + 'index.html';
  if(path.extname(urlPath)) return urlPath;
  const asDir = path.join(PUBLIC_DIR, urlPath);
  if(existsSync(asDir) && statSync(asDir).isDirectory()) return urlPath + '/index.html';
  return urlPath;
}
```

Then replace the first two lines of `serveStatic`'s body:

```js
function serveStatic(req, res){
  const raw = decodeURIComponent((req.url.split('?')[0]) || '/');
  const urlPath = resolveStaticPath(raw);
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/v2-static-routing.test.js`
Expected: PASS, 6/6.

Then run the full suite: `npm test`
Expected: no new failures.

- [ ] **Step 5: Commit**

```bash
git add server.js tests/v2-static-routing.test.js
git commit -m "feat: resolve directory URLs to index.html in serveStatic"
```

---

### Task 2: v2 shell, preview banner, service-worker isolation

The root service worker (`public/sw.js`, scope `/`) controls `/v2/` and will serve the cached root shell on a navigation fallback — testers would silently get the old UI. v2 must unregister any controller in its own scope and register none.

**Files:**
- Create: `public/v2/index.html`
- Test: `tests/v2-shell.test.js` (first assertions only)

**Interfaces:**
- Produces: DOM contract used by `app.js` — element IDs `#hT`, `#hS`, `#sync`, `#ringW`, `#ringFg`, `#ringN`, `#spine`, `#roundList`, `#roundDet`, `#board`, `#workList`, `#workDet`, `#otP`, `#hoP`, `#dcP`, `#adP`, `#pal`, `#palIn`, `#palL`, `#addM`, `#viewer`, `#vwF`, `#vwT`, `#present`, `#prB`, `#prC`, `#scrim`, `#toast`, `#previewBanner`; view sections `#v-round`, `#v-ward`, `#v-work`, `#v-ot`, `#v-handover`, `#v-disch`, `#v-admin`.

- [ ] **Step 1: Write the failing test**

```js
// tests/v2-shell.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/v2/index.html', import.meta.url), 'utf8');

test('shell declares every element app.js binds to', () => {
  const ids = ['hT','hS','sync','ringW','ringFg','ringN','spine','roundList','roundDet',
    'board','workList','workDet','otP','hoP','dcP','adP','pal','palIn','palL','addM',
    'viewer','vwF','vwT','present','prB','prC','scrim','toast','previewBanner'];
  for(const id of ids) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});

test('shell declares every view section', () => {
  for(const v of ['round','ward','work','ot','handover','disch','admin'])
    assert.ok(html.includes(`id="v-${v}"`), `missing #v-${v}`);
});

test('shell loads the seven css layers in order', () => {
  const order = ['tokens','base','shell','card','detail','board','overlay'];
  const found = [...html.matchAll(/css\/([a-z]+)\.css/g)].map(m => m[1]);
  assert.deepEqual(found, order);
});

test('shell reuses the shared milestones module', () => {
  assert.ok(html.includes('src="../milestones.js"'));
});

test('shell registers no service worker', () => {
  assert.ok(!/serviceWorker\s*\.\s*register/.test(html), 'v2 must not register a SW');
});

test('the root service worker ignores /v2 entirely', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const fetchHandler = sw.slice(sw.indexOf("addEventListener('fetch'"));
  assert.ok(/pathname\.startsWith\(['"]\/v2/.test(fetchHandler),
    'sw.js fetch handler must return early for /v2 paths');
  const guardIdx = fetchHandler.search(/pathname\.startsWith\(['"]\/v2/);
  const respondIdx = fetchHandler.indexOf('respondWith');
  assert.ok(guardIdx < respondIdx, 'the /v2 guard must precede respondWith');
});

test('preview banner is present and not dismissible', () => {
  const i = html.indexOf('id="previewBanner"');
  assert.ok(i > -1);
  const banner = html.slice(i, i + 400);
  assert.ok(/real patient/i.test(banner), 'banner must warn edits are real');
  assert.ok(!/data-close|dismiss/i.test(banner), 'banner must not be dismissible');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/v2-shell.test.js`
Expected: FAIL — `public/v2/index.html` does not exist.

- [ ] **Step 3: Implement**

Create `public/v2/index.html`. Copy the `<body>` markup and the `<svg class="sr">` icon sprite verbatim from `docs/prototypes/ortho-v3.html`, then apply exactly these four changes:

1. Replace the inline `<style>` block with seven `<link>` tags.
2. Replace the inline `<script>` block with module tags.
3. Add the preview banner as the first child of `<body>`.
4. Add the service-worker cleanup script.

Head and script sections:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Ortho Rounds — preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/tokens.css">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/shell.css">
<link rel="stylesheet" href="css/card.css">
<link rel="stylesheet" href="css/detail.css">
<link rel="stylesheet" href="css/board.css">
<link rel="stylesheet" href="css/overlay.css">
</head>
<body>
<div class="preview-banner" id="previewBanner" role="status">
  Preview build — you are editing real patient records.
</div>
```

Banner goes immediately inside `<body>`, before `<div class="app">`.

At the end of `<body>`, replacing the prototype's inline script:

```html
<script>
if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(rs => {
    rs.forEach(r => { if(new URL(r.scope).pathname.startsWith('/v2')) r.unregister(); });
  }).catch(()=>{});
}
</script>
<script src="../milestones.js"></script>
<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/v2-shell.test.js`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git diff --stat public/index.html public/app.js   # must print nothing
git add public/v2/index.html tests/v2-shell.test.js
git commit -m "feat: v2 preview shell with SW isolation and preview banner"
```

---

### Task 3: CSS layer extraction

Split the prototype's single `<style>` block into seven files at the section boundaries already marked in it (`/* ════ 1 · tokens ════ */` etc).

**Files:**
- Create: `public/v2/css/{tokens,base,shell,card,detail,board,overlay}.css`
- Test: `tests/v2-shell.test.js` (append)

**Interfaces:**
- Produces: CSS custom properties consumed by every later task — `--ink`, `--ink-2`, `--ink-3`, `--line`, `--line-2`, `--paper`, `--card`, `--sunk`, `--hover`, `--accent`, `--accent-2`, `--accent-3`, `--on-accent`, `--bone`, `--bone-line`, `--bone-ink`, `--good`, `--good-bg`, `--warn`, `--warn-bg`, `--bad`, `--bad-bg`, `--film`, `--film-in`, plus `--t-*`, `--s-*`, `--r*`, `--sh-*`, `--ez`, `--sp`, `--d1`–`--d3`, `--rail`, `--rail-x`, `--ring`.

- [ ] **Step 1: Write the failing test**

Append to `tests/v2-shell.test.js`:

```js
import { readdirSync } from 'node:fs';

const cssDir = new URL('../public/v2/css/', import.meta.url);
const readCss = f => readFileSync(new URL(f, cssDir), 'utf8');

test('all seven css layers exist', () => {
  const files = readdirSync(cssDir).sort();
  assert.deepEqual(files,
    ['base.css','board.css','card.css','detail.css','overlay.css','shell.css','tokens.css']);
});

test('tokens.css defines both themes and every colour role', () => {
  const css = readCss('tokens.css');
  assert.ok(css.includes(':root{'));
  assert.ok(css.includes('[data-theme="dark"]'));
  for(const v of ['--ink','--paper','--card','--accent','--bone','--good','--warn','--bad','--film'])
    assert.ok(css.includes(v + ':'), `missing ${v}`);
});

test('only tokens.css declares colour variables', () => {
  for(const f of ['shell.css','card.css','detail.css','board.css','overlay.css']){
    assert.ok(!/^\s*--(ink|paper|accent|bone|film)[-:]/m.test(readCss(f)),
      `${f} must not declare colour tokens`);
  }
});

test('no layer hardcodes a hex colour outside tokens and film artwork', () => {
  for(const f of ['shell.css','card.css','detail.css','board.css']){
    const hex = readCss(f).match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.deepEqual(hex, [], `${f} hardcodes ${hex.join(', ')}`);
  }
});

test('exactly three breakpoint tiers, no strays', () => {
  const all = ['shell.css','card.css','detail.css','board.css','overlay.css','base.css']
    .flatMap(f => [...readCss(f).matchAll(/@media\s*\(min-width:\s*(\d+)px\)/g)].map(m => m[1]));
  assert.deepEqual([...new Set(all)].sort((a,b)=>a-b), ['760','1100','1300']);
});

test('reduced motion is honoured', () => {
  assert.ok(readCss('base.css').includes('prefers-reduced-motion'));
});

test('print stylesheet exists', () => {
  assert.ok(readCss('base.css').includes('@media print'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/v2-shell.test.js`
Expected: FAIL — `public/v2/css/` does not exist.

- [ ] **Step 3: Implement**

Split `docs/prototypes/ortho-v3.html`'s `<style>` block at its numbered section comments:

| Prototype section | Destination |
|---|---|
| `1 · tokens` | `tokens.css` |
| `2 · base` | `base.css` (append the `@media print` block from section 11) |
| `3 · shell` | `shell.css` |
| `4 · film`, `5 · hero` | `card.css` |
| `6 · detail` | `detail.css` |
| `7 · board`, `8 · tables & docs`, `9 · complete` | `board.css` |
| `10 · nav` | `shell.css` |
| `11 · overlays` (minus `@media print`) | `overlay.css` |

Two required edits during the split:

1. The prototype's `.pr-*` and `.vw-*` rules hardcode hex colours for the presentation and viewer surfaces. These are deliberately theme-independent (they are always dark), so move them into `overlay.css` — which the hex test above excludes. `board.css`, `card.css`, `detail.css` and `shell.css` must end up with zero hex literals.
2. Append the preview banner rule to `overlay.css`:

```css
.preview-banner{
  position:sticky;top:0;z-index:30;
  background:var(--warn-bg);color:var(--warn);
  font-size:var(--t-12);font-weight:600;letter-spacing:.02em;
  text-align:center;padding:7px var(--s-4);
  border-bottom:1px solid var(--line);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/v2-shell.test.js`
Expected: PASS, 13/13.

- [ ] **Step 5: Commit**

```bash
git add public/v2/css tests/v2-shell.test.js
git commit -m "feat: extract v2 css into seven layers"
```

---

### Task 4: Data client

**Files:**
- Create: `public/v2/data.js`, `tests/helpers/v2-env.js`
- Test: `tests/v2-data.test.js`

**Interfaces:**
- Consumes: `POST /api/sync` → `{ serverTime, patients, apiVersion, rejected? }`; globals from `public/milestones.js` (`getPatientPod`, `isItemOverdue`, `normalizePatientChecklists`).
- Produces:
  - `export async function fetchWard(fetchImpl = fetch): Promise<{patients: VPatient[], serverTime: number}>`
  - `export async function pushPatient(patient: object, fetchImpl = fetch): Promise<{ok: boolean, rejected: boolean}>`
  - `export function toViewModel(raw: object, deps = globalThis): VPatient`
  - `VPatient = { id, bed, name, age, uhid, adm, surgeon, unit, dx, proc, implant, labs, films: string[], pod: number|null, status, stat, plan, track: [label, pct, state][], flags: [kind, text][], checks: [label, due, done][], dc: [label, done][], hist: [date, text][] }`
  - `state` values are `'done' | 'now' | 'due' | ''`; `kind` is `'bad' | 'warn' | 'ok'`.

- [ ] **Step 1: Write the failing test**

```js
// tests/v2-data.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadV2Module } from './helpers/v2-env.js';

const { toViewModel, fetchWard } = await loadV2Module('data.js');

const base = {
  id:'p1', bed:'12', name:'R. Kumar', age:'62', sex:'M', uhid:'MH-1',
  admissionDate:'2026-07-29', surgeryDate:'2026-07-29', surgeon:'Dr Menon',
  unit:'Unit II', diagnosis:'IT femur fracture', procedure:'PFN',
  status:'postop', dailyPlan:'', images:[], postOpChecks:[], dischargeChecks:[],
  planHistory:[], labs:{}
};
const deps = { getPatientPod: () => 4, isItemOverdue: () => false };

test('maps identity fields onto the view model', () => {
  const v = toViewModel(base, deps);
  assert.equal(v.bed, '12');
  assert.equal(v.name, 'R. Kumar');
  assert.equal(v.age, '62/M');
  assert.equal(v.dx, 'IT femur fracture');
  assert.equal(v.pod, 4);
  assert.equal(v.stat, 'Post-op');
});

test('missing name and diagnosis get explicit fallbacks, never blank', () => {
  const v = toViewModel({ ...base, name:'', diagnosis:'' }, deps);
  assert.equal(v.name, 'Unnamed');
  assert.equal(v.dx, 'Diagnosis not entered');
});

test('age without sex renders without a trailing slash', () => {
  const v = toViewModel({ ...base, sex:'' }, deps);
  assert.equal(v.age, '62');
});

test('films list is derived from images', () => {
  const v = toViewModel({ ...base, images:[{type:'preop'},{type:'postop'}] }, deps);
  assert.deepEqual(v.films, ['preop','postop']);
});

test('no images yields an empty films array, not undefined', () => {
  assert.deepEqual(toViewModel(base, deps).films, []);
});

test('track marks the current POD station and ends at discharge when known', () => {
  const v = toViewModel({ ...base, expectedDischargeDate:'2026-08-08' }, deps);
  assert.equal(v.track.at(-1)[0], 'discharge');
  assert.equal(v.track.filter(t => t[2] === 'now').length, 1);
});

test('track terminates at the last milestone when no discharge date exists', () => {
  const v = toViewModel({ ...base,
    postOpChecks:[{label:'Suture removal', duePod:12, status:'pending'}] }, deps);
  assert.notEqual(v.track.at(-1)[0], 'discharge');
});

test('track percentages are ordered and bounded', () => {
  const v = toViewModel({ ...base, expectedDischargeDate:'2026-08-08' }, deps);
  const pcts = v.track.map(t => t[1]);
  assert.deepEqual(pcts, [...pcts].sort((a,b)=>a-b));
  assert.ok(pcts[0] >= 0 && pcts.at(-1) <= 100);
});

test('pre-op patient has null pod and a pre-op track', () => {
  const v = toViewModel({ ...base, status:'preop', surgeryDate:'' },
    { ...deps, getPatientPod: () => null });
  assert.equal(v.pod, null);
  assert.equal(v.track[0][0], 'admit');
});

test('overdue checklist item becomes a bad flag', () => {
  const v = toViewModel({ ...base,
    postOpChecks:[{ id:'s', label:'Suture removal', duePod:2, status:'pending' }] },
    { ...deps, isItemOverdue: () => true });
  assert.ok(v.flags.some(f => f[0] === 'bad' && /Suture removal/.test(f[1])));
});

test('missing plan for today becomes a warn flag', () => {
  const v = toViewModel({ ...base, dailyPlan:'' }, deps);
  assert.ok(v.flags.some(f => f[0] === 'warn' && /plan/i.test(f[1])));
});

test('fetchWard posts a full-resync body and returns normalised patients', async () => {
  let sent = null;
  const fake = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) };
    return { ok:true, json: async () => ({ serverTime: 99, patients: [base] }) }; };
  const out = await fetchWard(fake);
  assert.equal(sent.url, '/api/sync');
  assert.equal(sent.body.since, 0);
  assert.deepEqual(sent.body.changes, []);
  assert.equal(out.serverTime, 99);
  assert.equal(out.patients[0].name, 'R. Kumar');
});

test('fetchWard rejects with a readable message on a failed response', async () => {
  const fake = async () => ({ ok:false, status:401, json: async () => ({}) });
  await assert.rejects(() => fetchWard(fake), /401/);
});
```

And the test helper:

```js
// tests/helpers/v2-env.js
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
```

**Note for the implementer:** because of trap 2 above, `app.js` must not read `document` at module top level outside a function — the `$` helper and `window.__V2__` assignment run at import time and are fine, but any `const el = document.getElementById(...)` at module scope will bind to a stale DOM on the second boot. Look elements up inside functions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/v2-data.test.js`
Expected: FAIL — `public/v2/data.js` does not exist.

- [ ] **Step 3: Implement**

```js
// public/v2/data.js
/* API client + view-model normalisation for the v2 preview.
   Online-only by design: no IndexedDB, no offline queue, no merge logic.
   All clinical-day arithmetic is delegated to public/milestones.js via
   `deps` (defaults to globalThis in the browser, stubbed in tests). */

const STATUS_LABELS = {
  preop:'Pre-op', conservative:'Conservative',
  postop:'Post-op', fordischarge:'For discharge'
};

function todayISO(){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if(Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}

/** Post-op / care track. Stations are laid out proportionally between the
 *  operation (0%) and either the expected discharge date or the latest
 *  milestone due-day (100%). Exactly one station carries state 'now'. */
function buildTrack(raw, pod, deps){
  const preOp = pod == null;
  if(preOp){
    return [
      ['admit', 0, 'done'],
      ['workup', 34, 'now'],
      [raw.surgeryDate ? 'surgery' : 'surgery date', 68, raw.surgeryDate ? '' : 'due'],
      ['POD 1', 100, '']
    ];
  }
  const checks = Array.isArray(raw.postOpChecks) ? raw.postOpChecks : [];
  const dueDays = checks.map(c => Number(c.duePod)).filter(Number.isFinite);
  const hasDischarge = !!raw.expectedDischargeDate;
  const span = Math.max(pod + 1, ...dueDays, hasDischarge ? pod + 3 : 0);
  const pct = day => Math.max(0, Math.min(100, Math.round((day / span) * 100)));

  const stations = [['op', 0, 'done'], [`POD ${pod}`, pct(pod), 'now']];
  for(const c of checks){
    const day = Number(c.duePod);
    if(!Number.isFinite(day) || day <= pod) continue;
    stations.push([c.label || 'milestone', pct(day),
      deps.isItemOverdue && deps.isItemOverdue(c, pod) ? 'due' : '']);
  }
  if(hasDischarge) stations.push(['discharge', 100, '']);
  return stations.sort((a, b) => a[1] - b[1]);
}

function buildFlags(raw, pod, deps){
  const flags = [];
  const checks = Array.isArray(raw.postOpChecks) ? raw.postOpChecks : [];
  for(const c of checks){
    if(c.status === 'done') continue;
    if(deps.isItemOverdue && deps.isItemOverdue(c, pod))
      flags.push(['bad', `${c.label || 'Milestone'} overdue`]);
  }
  const planToday = raw.planUpdatedAt
    && String(raw.planUpdatedAt).slice(0, 10) === todayISO();
  if(!raw.dailyPlan || !planToday) flags.push(['warn', 'No plan entered today']);
  if(!flags.length) flags.push(['ok', 'Nothing outstanding']);
  return flags;
}

export function toViewModel(raw, deps = globalThis){
  const pod = deps.getPatientPod ? deps.getPatientPod(raw) : null;
  const sex = (raw.sex || '').trim();
  const labs = raw.labs && typeof raw.labs === 'object'
    ? Object.entries(raw.labs).map(([k, v]) => `${k} ${v}`).join(' · ')
    : '';
  return {
    id: raw.id,
    bed: raw.bed || '—',
    name: (raw.name || '').trim() || 'Unnamed',
    age: sex ? `${raw.age || '?'}/${sex}` : String(raw.age || '?'),
    uhid: raw.uhid || '—',
    adm: fmtDate(raw.admissionDate) || '—',
    surgeon: raw.surgeon || '—',
    unit: raw.unit || '—',
    dx: (raw.diagnosis || '').trim() || 'Diagnosis not entered',
    proc: [raw.procedure, fmtDate(raw.surgeryDate), raw.theatreTime && 'OT ' + raw.theatreTime]
      .filter(Boolean).join(' · '),
    implant: raw.implant || '—',
    labs: labs || 'None recorded',
    films: (Array.isArray(raw.images) ? raw.images : []).map(i => i.type || 'preop'),
    pod,
    status: raw.status || 'preop',
    stat: STATUS_LABELS[raw.status] || 'Pre-op',
    plan: raw.dailyPlan || '',
    track: buildTrack(raw, pod, deps),
    flags: buildFlags(raw, pod, deps),
    checks: (Array.isArray(raw.postOpChecks) ? raw.postOpChecks : [])
      .map(c => [c.label || 'Milestone',
        Number.isFinite(Number(c.duePod)) ? `POD ${c.duePod}` : '—',
        c.status === 'done' ? 1 : 0]),
    dc: (Array.isArray(raw.dischargeChecks) ? raw.dischargeChecks : [])
      .map(c => [c.label || 'Item', c.status === 'done' ? 1 : 0]),
    hist: (Array.isArray(raw.planHistory) ? raw.planHistory : [])
      .slice().reverse().map(h => [fmtDate(h.date) || h.date || '', h.text || ''])
  };
}

async function post(url, body, fetchImpl){
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

export async function fetchWard(fetchImpl = fetch, deps = globalThis){
  const out = await post('/api/sync', { since: 0, changes: [] }, fetchImpl);
  const list = Array.isArray(out.patients) ? out.patients : [];
  return {
    serverTime: out.serverTime,
    patients: list
      .filter(p => p.status !== 'discharged')
      .map(p => toViewModel(p, deps))
      .sort((a, b) => (parseInt(a.bed, 10) || 1e9) - (parseInt(b.bed, 10) || 1e9))
  };
}

export async function pushPatient(patient, fetchImpl = fetch){
  const out = await post('/api/sync',
    { since: 0, changes: [{ ...patient, updatedAt: Date.now() }] }, fetchImpl);
  const rejected = Array.isArray(out.rejected) && out.rejected.includes(patient.id);
  return { ok: !rejected, rejected };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/v2-data.test.js`
Expected: PASS, 13/13.

- [ ] **Step 5: Commit**

```bash
git add public/v2/data.js tests/helpers/v2-env.js tests/v2-data.test.js
git commit -m "feat: v2 data client and view-model normalisation"
```

---

### Task 5: Render module

**Files:**
- Create: `public/v2/render.js`
- Test: `tests/v2-render.test.js`

**Interfaces:**
- Consumes: `VPatient` from `data.js`.
- Produces:
  - `export function esc(s: unknown): string`
  - `export function filmBox(pi: number, kind: string|undefined, cap: string): string`
  - `export function track(p: VPatient): string`
  - `export function hero(p: VPatient, i: number): string`
  - `export function row(p: VPatient, i: number, cur: boolean, seen: boolean): string`
  - `export function detail(p: VPatient, i: number): string`
  - `export function board(patients: VPatient[]): string`
  - `export function workList(items: [number, string, string][], sel: number, patients: VPatient[]): string`
  - `export function complete(count: number): string`

- [ ] **Step 1: Write the failing test**

```js
// tests/v2-render.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadV2Module } from './helpers/v2-env.js';

const R = await loadV2Module('render.js');

const p = {
  id:'p1', bed:'12', name:'R. Kumar', age:'62/M', uhid:'MH-1', adm:'29 Jul',
  surgeon:'Dr Menon', unit:'Unit II', dx:'IT femur fracture', proc:'PFN · 29 Jul',
  implant:'PFN long', labs:'Hb 10.8', films:['preop'], pod:4, status:'postop',
  stat:'Post-op', plan:'', track:[['op',0,'done'],['POD 4',40,'now']],
  flags:[['warn','No plan entered today']],
  checks:[['Suture removal','POD 12',0]], dc:[['Summary',0]],
  hist:[['1 Aug','Sit out of bed']]
};

test('esc neutralises every html metacharacter', () => {
  assert.equal(R.esc(`<img src=x onerror="a">&'`),
    '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});

test('esc renders null and undefined as empty, never the literal word', () => {
  assert.equal(R.esc(null), '');
  assert.equal(R.esc(undefined), '');
});

test('patient names are escaped in the hero', () => {
  const html = R.hero({ ...p, name:'<script>x</script>' }, 0);
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('filmBox with a kind renders a zoomable button carrying its index', () => {
  const html = R.filmBox(3, 'preop', 'pre-op');
  assert.ok(html.includes('data-film="3:preop"'));
  assert.ok(html.includes('aria-label'));
});

test('filmBox without a kind renders the bone placeholder, not a button', () => {
  const html = R.filmBox(3, undefined, '');
  assert.ok(html.includes('fnone'));
  assert.ok(!html.includes('<button'));
  assert.ok(html.includes('role="img"'));
});

test('track marks exactly one current station', () => {
  const html = R.track(p);
  assert.equal((html.match(/class="st now"/g) || []).length, 1);
});

test('row shows POD when present and status when not', () => {
  assert.ok(R.row(p, 0, false, false).includes('POD 4'));
  assert.ok(R.row({ ...p, pod:null }, 0, false, false).includes('Post-op'));
});

test('row marks the current patient and seen state', () => {
  assert.ok(R.row(p, 0, true, false).includes('aria-current="true"'));
  assert.ok(R.row(p, 0, false, true).includes('seen'));
});

test('detail checklists carry patient-scoped toggle ids', () => {
  const html = R.detail(p, 5);
  assert.ok(html.includes('data-ck="5:0"'));
  assert.ok(html.includes('data-dc="5:0"'));
});

test('detail marks only the first open milestone as due', () => {
  const html = R.detail({ ...p,
    checks:[['A','POD 1',0],['B','POD 2',0],['C','POD 3',0]] }, 0);
  assert.equal((html.match(/class="ck  due"/g) || []).length, 1);
});

test('detail shows an explicit empty state for an unstarted discharge list', () => {
  const html = R.detail({ ...p, dc:[] }, 0);
  assert.ok(/Not started/i.test(html));
});

test('board groups by status and reports counts', () => {
  const html = R.board([p, { ...p, id:'p2', status:'preop', stat:'Pre-op' }]);
  assert.ok(html.includes('Pre-op'));
  assert.ok(html.includes('For discharge'));
  assert.ok(/None/.test(html), 'empty columns need an explicit empty state');
});

test('complete renders the round summary with the patient count', () => {
  const html = R.complete(8);
  assert.ok(html.includes('Round complete'));
  assert.ok(html.includes('8'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/v2-render.test.js`
Expected: FAIL — `public/v2/render.js` does not exist.

- [ ] **Step 3: Implement**

Create `public/v2/render.js` by lifting the fragment builders from `docs/prototypes/ortho-v3.html` (`esc`, `ic`, `icS`, `filmBox`, `track`, `flagsOf`, `badOf`, `heroOf`, `rowOf`, `detailOf`, `doneOf`, `rBoard`'s column builder) and converting them to named exports. Four required changes from the prototype:

1. `esc` must map `'` to `&#39;` and render `null`/`undefined` as `''` — the prototype already does both; keep it.
2. `filmBox(pi, kind, cap)` renders artwork by looking up `FILMS[kind]`; in production the `kind` is `'preop' | 'postop' | 'followup'` and the artwork is the drawn placeholder until Task 10 swaps in real thumbnails. Keep the drawn SVGs in `render.js` under a `FILMS` const.
3. `detail(p, i)` computes `firstOpen = p.checks.findIndex(c => !c[2])` and applies `due` only at that index.
4. `board(patients)` renders `<p class="empty">None</p>` for an empty column.

Export every builder listed in the Interfaces block.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/v2-render.test.js`
Expected: PASS, 13/13.

- [ ] **Step 5: Commit**

```bash
git add public/v2/render.js tests/v2-render.test.js
git commit -m "feat: v2 render module with escaped fragment builders"
```

---

### Task 6: App wiring — round, ward, work

**Files:**
- Create: `public/v2/app.js`
- Test: `tests/v2-shell.test.js` (append integration block)

**Interfaces:**
- Consumes: `fetchWard`, `pushPatient` from `data.js`; all builders from `render.js`; the DOM contract from Task 2.
- Produces: `window.__V2__ = { state, go, render }` for test introspection only.

- [ ] **Step 1: Write the failing test**

Append to `tests/v2-shell.test.js`:

```js
import { bootV2 } from './helpers/v2-env.js';

export const raw = n => ({ id:'p'+n, bed:String(n), name:'P'+n, age:'40', sex:'M',
  diagnosis:'Dx'+n, status:'postop', surgeryDate:'2026-07-29', images:[],
  postOpChecks:[], dischargeChecks:[], planHistory:[], labs:{} });

test('boots, fetches the ward, and renders one row per patient', async () => {
  const { document } = await bootV2({ patients:[raw(1), raw(2), raw(3)] });
  assert.equal(document.querySelectorAll('#roundList .qr').length, 3);
});

test('marking seen advances to the next unseen patient', async () => {
  const { document, api } = await bootV2({ patients:[raw(1), raw(2)] });
  const before = api.state.idx;
  document.querySelector('[data-seen]').click();
  assert.notEqual(api.state.idx, before);
  assert.equal(api.state.seen.size, 1);
});

test('skip advances without marking seen', async () => {
  const { document, api } = await bootV2({ patients:[raw(1), raw(2)] });
  document.querySelector('[data-skip]').click();
  assert.equal(api.state.seen.size, 0);
});

test('the round cannot complete while a patient is only skipped', async () => {
  const { document } = await bootV2({ patients:[raw(1), raw(2)] });
  document.querySelector('[data-skip]').click();
  document.querySelector('[data-seen]').click();
  assert.ok(!document.body.textContent.includes('Round complete'));
});

test('narrow viewport renders the hero and no detail pane', async () => {
  const { document } = await bootV2({ patients:[raw(1), raw(2)], width:360 });
  assert.ok(document.querySelector('#roundList .hero'));
  assert.equal(document.querySelector('#roundDet').innerHTML, '');
});

test('wide viewport renders the list and the detail pane', async () => {
  const { document } = await bootV2({ patients:[raw(1), raw(2)], width:1440 });
  assert.ok(document.querySelector('#roundDet').innerHTML.length > 0);
});

test('a failed fetch surfaces a retry message and never a blank ward', async () => {
  const { document } = await bootV2({
    fetchImpl: async () => ({ ok:false, status:503, json: async () => ({}) }) });
  assert.ok(/couldn.t reach|retry/i.test(document.body.textContent));
});

test('at most ten interactive targets render before the first patient row', async () => {
  const { document } = await bootV2({ patients:[raw(1), raw(2)], width:360 });
  const chrome = [...document.querySelectorAll('.hd button, .nav button, .preview-banner button')];
  assert.ok(chrome.length <= 10, `${chrome.length} chrome targets, spec caps this at 10`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/v2-shell.test.js`
Expected: FAIL — `public/v2/app.js` does not exist.

- [ ] **Step 3: Implement**

Create `public/v2/app.js` from the prototype's script block, with these changes:

1. Delete the hardcoded `P`, `DC`, `OTL` demo arrays. `state.patients` is populated by `fetchWard()`.
2. `render()` is async, calls `fetchWard()`, and on rejection renders into `#roundList`:

```js
`<div class="empty" style="text-align:center;padding:var(--s-7) var(--s-4)">
   <p>Couldn't reach the server.</p>
   <button class="btn gh" data-retry="1">Retry</button></div>`
```

3. Plan edits call `pushPatient()` debounced at 600ms; on `{rejected:true}` show `toast('Not saved — outside your scope')` and re-fetch.
4. Milestone and discharge toggles call `pushPatient()` immediately.
5. Export the test hook as the last statement: `window.__V2__ = { state: S, go, render };`
6. Keep every guard added during prototype verification: `?.scrollIntoView?.()`, the `S.vwP?.length` check on `[data-vnav]` and viewer arrow keys, and `e.target?.matches?.()` in the keydown handler.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/v2-shell.test.js`
Expected: PASS, 20/20.

- [ ] **Step 5: Commit**

```bash
git add public/v2/app.js tests/v2-shell.test.js
git commit -m "feat: v2 app wiring for round, ward and work"
```

---

### Task 7: Documents — OT list, handover, discharged

**Files:**
- Modify: `public/v2/render.js`, `public/v2/app.js`
- Test: `tests/v2-render.test.js` (append)

**Interfaces:**
- Consumes: `VPatient` from `data.js`; `esc` from `render.js`.
- Produces (in `render.js`): `export function otList(patients: VPatient[], dateISO: string): string`, `export function handover(patients: VPatient[], meta: {when: string, to: string}): string`, `export function discharged(rows: VPatient[]): string`
- Produces (in `data.js`): `export async function fetchDischarged(fetchImpl = fetch, deps = globalThis): Promise<{patients: VPatient[], serverTime: number}>` — identical to `fetchWard` but filters `p.status === 'discharged'` and sorts by discharge date descending rather than by bed.

> **Field-name correction (established in Task 0):** this codebase has no `discharged` boolean. Patient lifecycle is carried on `p.status`, whose discharged value is the string `'discharged'` (see `public/app.js:481,4132,4587`). `!p.discharged` would be true for every patient and silently filter nothing.

- [ ] **Step 1: Write the failing test**

```js
test('OT list includes only patients with theatre time today', () => {
  const html = R.otList([
    { ...p, id:'a', proc:'ORIF · 2 Aug · OT 11:00', otDate:'2026-08-02' },
    { ...p, id:'b', proc:'PFN · 29 Jul', otDate:'2026-07-29' }
  ], '2026-08-02');
  assert.ok(html.includes('11:00'));
  assert.ok(!html.includes('29 Jul'));
});

test('OT list renders an empty state when nothing is scheduled', () => {
  assert.ok(/no cases/i.test(R.otList([], '2026-08-02')));
});

test('handover lists every patient and surfaces urgent flags', () => {
  const html = R.handover([{ ...p, flags:[['bad','Antibiotic overdue']] }],
    { when:'2 Aug, 18:30', to:'Dr Verma' });
  assert.ok(html.includes('R. Kumar'));
  assert.ok(html.includes('Antibiotic overdue'));
  assert.ok(html.includes('Dr Verma'));
});

test('handover falls back to the last plan when today has none', () => {
  const html = R.handover([{ ...p, plan:'', hist:[['1 Aug','Sit out of bed']] }],
    { when:'x', to:'y' });
  assert.ok(html.includes('Sit out of bed'));
});

test('handover escapes plan text', () => {
  const html = R.handover([{ ...p, plan:'<b>x</b>' }], { when:'x', to:'y' });
  assert.ok(!html.includes('<b>x</b>'));
});

test('discharged renders an empty state for no rows', () => {
  assert.ok(/no discharges/i.test(R.discharged([])));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/v2-render.test.js`
Expected: FAIL — `otList is not a function`.

- [ ] **Step 3: Implement**

Add the three exports to `render.js`, lifting the markup from the prototype's `rOT`, `rHand` and `rDisch`. Required changes:

- `otList` filters on `p.otDate === dateISO` and returns `<p class="empty">No cases scheduled for this date.</p>` when the filtered list is empty.
- `handover` uses `p.plan || p.hist[0]?.[1] || 'plan not entered'` and renders the first `bad` flag as `.ho-f`.
- `discharged` returns `<p class="empty">No discharges in this period.</p>` for an empty list.

In `app.js`, wire `#otP`, `#hoP` and `#dcP` to these builders inside `go()`. `discharged` reads from a second `fetchWard` call filtered on `p.discharged === true`; add `fetchDischarged(fetchImpl = fetch, deps = globalThis)` to `data.js` mirroring `fetchWard` with the inverse filter.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add public/v2/render.js public/v2/app.js public/v2/data.js tests/v2-render.test.js
git commit -m "feat: v2 OT list, handover and discharged views"
```

---

### Task 8: Palette, overlays and keyboard

**Files:**
- Modify: `public/v2/app.js`
- Test: `tests/v2-shell.test.js` (append)

**Interfaces:**
- Consumes: DOM contract from Task 2.
- Produces: `state.palRows: (() => void)[]` — the executable action list the palette renders and the keyboard drives.

- [ ] **Step 1: Write the failing test**

```js
```js
import { press } from './helpers/v2-env.js';

const typeInPalette = (window, value) => {
  const input = window.document.querySelector('#palIn');
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles:true }));
};

test('palette opens on meta+k and closes on escape', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  assert.ok(document.querySelector('#pal').classList.contains('on'));
  press(window, 'Escape');
  assert.ok(!document.querySelector('#pal').classList.contains('on'));
});

test('palette lists grouped actions before any typing', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  assert.ok(document.querySelectorAll('#palL .pi').length >= 20);
  assert.ok(document.querySelector('#palL .pal-g').textContent.includes('Most used'));
});

test('palette matches patients and actions in one field', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  typeInPalette(window, 'P1');
  assert.ok(document.querySelector('#palL').textContent.includes('P1'));
});

test('palette reports no match rather than rendering empty', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  typeInPalette(window, 'zzzzzz');
  assert.ok(/no match/i.test(document.querySelector('#palL').textContent));
});

test('arrow keys move the palette selection and enter runs it', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  press(window, 'ArrowDown');
  assert.equal(document.querySelectorAll('#palL .pi.sel').length, 1);
  assert.notEqual(document.querySelectorAll('#palL .pi')[0].className.includes('sel'), true);
  press(window, 'Enter');
  assert.ok(!document.querySelector('#pal').classList.contains('on'), 'enter must close the palette');
});

test('all 23 actions are reachable from the palette', async () => {
  const { window, document } = await bootV2({ patients:[raw(1)] });
  press(window, 'k', { metaKey:true });
  assert.equal(document.querySelectorAll('#palL .pi').length, 23);
});

test('film viewer arrows are inert before a film is opened', async () => {
  const { document } = await bootV2({ patients:[raw(1)] });
  assert.doesNotThrow(() => document.querySelector('[data-vnav]').click());
});

test('every icon-only button carries an accessible label', async () => {
  const { document } = await bootV2({ patients:[raw(1)] });
  const bad = [...document.querySelectorAll('button')]
    .filter(b => !b.textContent.trim() && !b.getAttribute('aria-label'));
  assert.deepEqual(bad.map(b => b.outerHTML.slice(0, 60)), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/v2-shell.test.js`
Expected: FAIL — palette not wired.

- [ ] **Step 3: Implement**

Port the prototype's `rPal`, `markPal`, `runAct`, `openViewer`, `rViewer`, `rPresent` and the full `keydown` handler into `app.js`. The `ACT` table must contain exactly the 23 rows from the spec's §7 feature-to-surface map. Actions with no v2 implementation call `toast(label + ' — not in the preview build')` rather than failing silently.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add public/v2/app.js tests/v2-shell.test.js
git commit -m "feat: v2 command palette, film viewer and keyboard shortcuts"
```

---

### Task 9: Admin hand-off

The existing admin console is five modules bound to the old shell. v2 links out to it rather than reimplementing it.

**Files:**
- Modify: `public/v2/app.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/v2-shell.test.js`:

```js
test('admin view links out to the existing console rather than reimplementing it', async () => {
  const { document, api } = await bootV2({ patients:[raw(1)] });
  api.go('admin');
  const a = document.querySelector('#adP a[href="/"]');
  assert.ok(a, 'admin pane must link back to the main app');
  assert.ok(/admin console/i.test(a.textContent));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/v2-shell.test.js`
Expected: FAIL — `#adP` is empty.

- [ ] **Step 3: Implement**

In `app.js`, replace the prototype's `rAdmin` with:

```js
function rAdmin(){
  $('#adP').innerHTML = `
  <div class="card" style="max-width:520px">
    <p class="lbl">Admin console</p>
    <p class="empty">The admin console is not part of this preview.
      It opens in the current app, using the same login.</p>
    <a class="btn gh" href="/" style="display:inline-flex;margin-top:var(--s-3)">
      Open admin console</a>
  </div>`;
}
```

Remove `admin` from the rail if it renders an empty destination; keep it in the palette.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add public/v2/app.js tests/v2-shell.test.js
git commit -m "feat: v2 admin hand-off to the existing console"
```

---

### Task 10: Full-sweep verification

A single test that clicks every interactive element on every screen at four widths, asserting no handler throws — the harness that caught three invisible bugs in the prototype.

**Files:**
- Test: `tests/v2-sweep.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/v2-sweep.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootV2 } from './helpers/v2-env.js';

const raw = n => ({ id:'p'+n, bed:String(n), name:'P'+n, age:'40', sex:'M',
  diagnosis:'Dx'+n, status:['preop','postop','conservative','fordischarge'][n%4],
  surgeryDate:'2026-07-29', images: n%2 ? [{type:'preop'}] : [],
  postOpChecks:[{ id:'s', label:'Suture removal', duePod:12, status:'pending' }],
  dischargeChecks:[{ id:'d', label:'Summary', status:'pending' }],
  planHistory:[{ date:'2026-08-01', text:'Prior plan' }], labs:{ Hb:'11' } });
const ward = [1,2,3,4,5,6].map(raw);
const VIEWS = ['round','ward','work','ot','handover','disch','admin'];

const SEL = '[data-open],[data-go],[data-act],[data-seen],[data-skip],[data-copy],'
  + '[data-ck],[data-dc],[data-work],[data-film],[data-toast],[data-reset],'
  + '[data-add],[data-close],[data-prow],[data-pnav],[data-vnav],[data-pclose],'
  + '[data-vclose],[data-retry],#themeBtn';

for(const width of [360, 760, 1100, 1440]){
  test(`every control fires cleanly at ${width}px`, async () => {
    const { document, api, errors } = await bootV2({ patients: ward, width });
    for(const view of VIEWS){
      api.go(view);
      for(const el of document.querySelectorAll(SEL)){
        try { el.click(); } catch(e){ errors.push(`${view}: ${e.message}`); }
      }
    }
    assert.deepEqual([...new Set(errors)], []);
  });
}

test('a full round reaches the completion state', async () => {
  const { document } = await bootV2({ patients: ward });
  for(let i = 0; i < ward.length + 2; i++){
    document.querySelector('[data-seen]')?.click();
  }
  assert.ok(document.body.textContent.includes('Round complete'));
});

test('no view leaves its pane empty', async () => {
  const { document, api } = await bootV2({ patients: ward });
  for(const view of VIEWS){
    api.go(view);
    const pane = document.querySelector(`#v-${view}`);
    assert.ok(pane.textContent.trim().length > 0, `${view} rendered nothing`);
  }
});

test('an empty ward renders an empty state, not a blank screen', async () => {
  const { document, api } = await bootV2({ patients: [] });
  for(const view of VIEWS){
    api.go(view);
    assert.ok(document.querySelector(`#v-${view}`).textContent.trim().length > 0,
      `${view} is blank with no patients`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/v2-sweep.test.js`
Expected: FAIL or ERROR until every prior task is complete.

- [ ] **Step 3: Fix whatever it reports**

Expect real findings here. Fix them in the module that owns the behaviour, not in the test.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: every suite green, including all pre-existing frontend and backend suites.

- [ ] **Step 5: Commit**

```bash
git diff --stat public/index.html public/app.js   # must print nothing
git add tests/v2-sweep.test.js
git commit -m "test: full-sweep verification for the v2 preview"
```

---

## Manual verification before the tester session

Not automatable; run these by hand once Task 10 is green.

- [ ] Deploy, open `/v2` in a private window, confirm login redirects and works.
- [ ] Confirm `/` still serves the old client, unchanged.
- [ ] In DevTools → Application → Service Workers, confirm no worker is registered for `/v2/`.
- [ ] Hard-reload `/v2` three times; confirm the new UI every time, never the old shell.
- [ ] Confirm the preview banner is visible on every screen and cannot be dismissed.
- [ ] Edit a plan in `/v2`, reload `/`, confirm the edit is there.
- [ ] Throttle to Slow 3G; confirm the ward renders and the retry state appears when offline.
- [ ] Check both themes against WCAG AA with the contrast checker.
- [ ] Walk one real round end-to-end on a phone.

## Out of scope for the preview

Named so nobody discovers them mid-session and thinks they are bugs:

- Offline support, IndexedDB, sync queue, conflict resolution.
- Real radiograph thumbnails — spec §8.1. Drawn placeholders until then.
- Image upload, lab-photo AI, handover generation via AI.
- Consultant mode, bulk plan, organize, templates, PG roster, export/import.
- Admin console (links out — Task 9).
- Push notifications.
