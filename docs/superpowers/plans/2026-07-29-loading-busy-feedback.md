# Loading & Busy Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user-triggered async control visible busy feedback and a hard re-entry guard, add placeholder thumbs for image uploads, and stop cold-empty lists from looking like finished zero-patient wards.

**Architecture:** A tiny classic script `public/busy.js` exports `withBusy` / `isBusy` as globals (loaded before admin + app). Shared `.is-busy` CSS unifies today’s `ai-btn-busy` / `btn-busy`. Call sites wrap their async work. Image adds keep a module-level placeholder list rendered into x-ray rows. List cold-load gates on `patients.length === 0 && syncing`.

**Tech Stack:** Vanilla JS classic scripts, CSS in `public/index.html`, `node:test` + jsdom via `tests/helpers/frontend-env.js`. No new npm packages. No server changes.

**Source spec:** `docs/superpowers/specs/2026-07-29-loading-busy-feedback-design.md`.

## Global Constraints

- **Frontend-only.** Touch `public/busy.js` (new), `public/index.html`, `public/app.js`, `public/admin-*.js`, and matching tests. No `server.js` / storage / sync protocol changes.
- **No new packages.** Nothing may be added to `package.json`.
- **Preserve behavior.** Sync merge, image storage, AI endpoints, and admin mutations unchanged; only in-flight UX changes.
- **Button-local busy only.** No full-screen overlays for ordinary actions.
- **Local-first timing.** Busy on local writes ends when the local operation finishes; sync chip covers network catch-up. Network-only actions (login, AI, admin API, downloads) stay busy until the request settles.
- **`prefers-reduced-motion: reduce`.** Spinner animation disabled or static.
- **Touch targets.** Busy styling must not shrink hit areas; spinner is additive.
- **Classic scripts.** `withBusy` is a function declaration (global). Admin scripts load before `app.js` today — `busy.js` must load before both. Tests eval `busy.js` before admin/app in `frontend-env.js`.
- **Baseline:** run `npm test` before starting (expect green). Commit after every task with `feat:` / `fix:` / `test:` / `docs:`.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `public/busy.js` | `withBusy(el, fn)`, `isBusy(el)` | 1 |
| `public/index.html` | Script tag; `.is-busy` / placeholder / cold-load CSS; reduced-motion | 1, 3, 6 |
| `tests/helpers/frontend-env.js` | Eval `busy.js` before admin/app | 1 |
| `tests/frontend-busy.test.js` | Helper unit tests | 1 |
| `public/app.js` | Migrate AI / images / auth / saves / exports; cold list gate; placeholders | 2–4, 6–7 |
| `public/admin-*.js` | Button-level `withBusy` on mutation handlers | 5 |
| `tests/frontend-busy-images.test.js` | Placeholder success/fail DOM | 3 |
| `tests/frontend-busy-lists.test.js` | Cold vs warm empty rendering | 6 |
| Spec status line | Mark implemented when suite green | 7 |

---

### Task 1: `withBusy` helper, CSS, and harness wiring

**Files:**
- Create: `public/busy.js`
- Modify: `public/index.html` (script tag before `milestones.js`; CSS near existing `.ai-btn-busy` ~604)
- Modify: `tests/helpers/frontend-env.js`
- Create: `tests/frontend-busy.test.js`

**Interfaces:**
- Consumes: none
- Produces:
  - `async function withBusy(el, fn)` — if `el` missing or already busy, return `undefined` without calling `fn`; else mark busy, `await fn()`, clear in `finally` if still connected
  - `function isBusy(el)` — `true` when `el.dataset.busy === '1'`
  - Busy mark: `dataset.busy = '1'`, class `is-busy`, `aria-busy="true"`; buttons get `disabled = true`; non-buttons get `aria-disabled="true"`
  - CSS: `.is-busy` spinner (same visual language as `.ai-btn-busy`); `.ai-btn-busy` and `.btn.btn-busy` remain as aliases that include/extend `.is-busy` rules so old class names still work during migration

- [ ] **Step 1: Write the failing test**

Create `tests/frontend-busy.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

describe('withBusy', () => {
  test('sets busy class, aria-busy, and disabled on a button then clears', async () => {
    const { window, document } = loadFrontendEnv();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    let ran = false;
    const p = window.withBusy(btn, async () => {
      assert.equal(btn.dataset.busy, '1');
      assert.equal(btn.classList.contains('is-busy'), true);
      assert.equal(btn.getAttribute('aria-busy'), 'true');
      assert.equal(btn.disabled, true);
      ran = true;
    });
    await p;
    assert.equal(ran, true);
    assert.equal(btn.dataset.busy, undefined);
    assert.equal(btn.classList.contains('is-busy'), false);
    assert.equal(btn.disabled, false);
  });

  test('second call while in flight is a no-op', async () => {
    const { window, document } = loadFrontendEnv();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    let release;
    const gate = new Promise(r => { release = r; });
    let runs = 0;
    const first = window.withBusy(btn, async () => { runs++; await gate; });
    const second = window.withBusy(btn, async () => { runs++; });
    assert.equal(second, undefined);
    release();
    await first;
    assert.equal(runs, 1);
  });

  test('clears busy when fn throws', async () => {
    const { window, document } = loadFrontendEnv();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await assert.rejects(() => window.withBusy(btn, async () => { throw new Error('boom'); }), /boom/);
    assert.equal(btn.classList.contains('is-busy'), false);
    assert.equal(btn.disabled, false);
  });

  test('non-button gets aria-disabled instead of disabled', async () => {
    const { window, document } = loadFrontendEnv();
    const el = document.createElement('div');
    el.setAttribute('role', 'button');
    document.body.appendChild(el);
    await window.withBusy(el, async () => {
      assert.equal(el.getAttribute('aria-disabled'), 'true');
      assert.equal(el.disabled, undefined);
    });
    assert.equal(el.getAttribute('aria-disabled'), null);
  });

  test('isBusy reflects dataset.busy', async () => {
    const { window, document } = loadFrontendEnv();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    assert.equal(window.isBusy(btn), false);
    let release;
    const gate = new Promise(r => { release = r; });
    const p = window.withBusy(btn, async () => { await gate; });
    assert.equal(window.isBusy(btn), true);
    release();
    await p;
    assert.equal(window.isBusy(btn), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --no-warnings --test tests/frontend-busy.test.js`

Expected: FAIL (e.g. `withBusy` is not a function — `busy.js` not loaded / missing).

- [ ] **Step 3: Implement `public/busy.js`**

```js
/* Shared busy / re-entry guard for async UI actions.
   Classic script: function declarations are globals for admin-*.js and app.js. */

function isBusy(el){
  return !!(el && el.dataset && el.dataset.busy === '1');
}

function _busyIsNativeDisableable(el){
  if(!el || !el.tagName) return false;
  const t = el.tagName;
  return t === 'BUTTON' || t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA';
}

async function withBusy(el, fn){
  if(!el || isBusy(el)) return;
  el.dataset.busy = '1';
  el.classList.add('is-busy');
  el.setAttribute('aria-busy', 'true');
  const native = _busyIsNativeDisableable(el);
  let prevDisabled = false;
  if(native){
    prevDisabled = !!el.disabled;
    el.disabled = true;
  }else{
    el.setAttribute('aria-disabled', 'true');
  }
  try{
    return await fn();
  }finally{
    if(!el.isConnected) return;
    delete el.dataset.busy;
    el.classList.remove('is-busy');
    el.removeAttribute('aria-busy');
    if(native) el.disabled = prevDisabled;
    else el.removeAttribute('aria-disabled');
  }
}
```

- [ ] **Step 4: Wire script + CSS + harness**

In `public/index.html`, add before `milestones.js`:

```html
<script src="busy.js"></script>
```

Near `.ai-btn-busy` (~604), add / adjust:

```css
.is-busy{opacity:0.65;pointer-events:none;}
.is-busy::after{
  content:'';display:inline-block;width:12px;height:12px;margin-left:6px;
  border:2px solid currentColor;border-top-color:transparent;border-radius:50%;
  animation:ai-spin 0.7s linear infinite;vertical-align:middle;
}
.ai-btn-busy{opacity:0.65;pointer-events:none;}
.ai-btn-busy::after{
  content:'';display:inline-block;width:12px;height:12px;margin-left:6px;
  border:2px solid currentColor;border-top-color:transparent;border-radius:50%;
  animation:ai-spin 0.7s linear infinite;vertical-align:middle;
}
@media (prefers-reduced-motion: reduce){
  .is-busy::after,.ai-btn-busy::after,.btn.btn-busy::after{animation:none;opacity:0.85;}
}
```

Keep existing `.btn.btn-busy` centered-spinner rules; they remain valid until Task 4 migrates login to `withBusy` + `is-busy` (login may keep `btn-busy` class as a visual alias — either map `.btn.is-busy` to the same centered rules or leave `btn-busy` and also set `is-busy` from `withBusy`).

In `tests/helpers/frontend-env.js`, after reading files, eval `busy.js` **before** milestones/admin/app:

```js
const busyJs = readFileSync(path.join(PUBLIC_DIR, 'busy.js'), 'utf8');
window.eval(busyJs);
window.eval(milestonesJs);
window.eval(adminFiles.join('\n'));
window.eval(initScript ? `${appJs}\n${initScript}` : appJs);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --no-warnings --test tests/frontend-busy.test.js`

Expected: PASS (all 5 tests).

- [ ] **Step 6: Commit**

```bash
git add public/busy.js public/index.html tests/helpers/frontend-env.js tests/frontend-busy.test.js
git commit -m "$(cat <<'EOF'
feat: add shared withBusy helper for async UI actions

EOF
)"
```

---

### Task 2: Migrate AI buttons from `setAiButtonBusy` to `withBusy`

**Files:**
- Modify: `public/app.js` (`setAiButtonBusy` ~420; all `setAiButtonBusy(` call sites; bulk save busy ~606–620)
- Test: extend `tests/frontend-busy.test.js` with one smoke that `setAiButtonBusy` either is removed or is a thin wrapper that toggles `.is-busy` equivalently — prefer **delete** `setAiButtonBusy` and rewrite call sites

**Interfaces:**
- Consumes: `withBusy(el, fn)` from Task 1
- Produces: AI handlers no longer use manual true/false busy pairs; re-entry safe

**Call sites to rewrite** (each `setAiButtonBusy(btn, true); try { … } finally { setAiButtonBusy(btn, false); }` → `await withBusy(btn, async () => { … })`):

| Approx lines | Control |
|-------------|---------|
| ~827–836 | Draft plan |
| ~848–865 | Polish |
| ~887–898 | Discharge summary |
| ~915–926 | Ward brief |
| ~943–958 | Risk flags |
| ~1008–1020 | Handover |
| ~1147–1155 | Scribe |
| ~1411–1440 | (AI path near that line — keep same behavior) |
| ~1650–1676 | Lab photo parse |
| ~2229–2233 | Remaining AI busy pair |
| ~606–620 | Bulk draft save (`ai-btn-busy` class) |

Pattern for each:

```js
// BEFORE
setAiButtonBusy(draftBtn, true);
try{
  // ... work ...
}catch(err){
  showToast(err.message || '…');
}finally{
  setAiButtonBusy(draftBtn, false);
}

// AFTER
await withBusy(draftBtn, async () => {
  try{
    // ... work ...
  }catch(err){
    showToast(err.message || '…');
  }
});
```

If the outer listener already uses `void (async () => {…})()`, nest `withBusy` inside. Do not double-disable.

Delete `function setAiButtonBusy` once no references remain.

- [ ] **Step 1: Write a regression assertion**

Add to `tests/frontend-busy.test.js`:

```js
test('setAiButtonBusy is not defined (migrated to withBusy)', () => {
  const { window } = loadFrontendEnv();
  assert.equal(typeof window.setAiButtonBusy, 'undefined');
});
```

- [ ] **Step 2: Run test — expect FAIL** while `setAiButtonBusy` still exists (function declarations are globals).

- [ ] **Step 3: Migrate all call sites and delete `setAiButtonBusy`**

Apply the pattern above to every site in the table. Grep to confirm zero matches:

```bash
rg 'setAiButtonBusy' public/app.js
```

Expected: no matches.

- [ ] **Step 4: Run tests**

Run: `node --no-warnings --test tests/frontend-busy.test.js tests/frontend-lab-photo-extraction.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/app.js tests/frontend-busy.test.js
git commit -m "$(cat <<'EOF'
feat: migrate AI busy buttons to withBusy

EOF
)"
```

---

### Task 3: Image add placeholder thumbs

**Files:**
- Modify: `public/app.js` (image handling ~5403–5453; `renderCard` x-ray row ~5002–5014; `renderModalPendingXrays` ~1592; `handleModalImageSelected` ~1624; `closeImageTypeModal`)
- Modify: `public/index.html` (CSS for `.xray-thumb.is-placeholder`)
- Create: `tests/frontend-busy-images.test.js`

**Interfaces:**
- Consumes: `withBusy`, `isBusy`
- Produces:
  - Module state: `let imagePlaceholders = []` // `{ id, patientId }`
  - `function addImagePlaceholder(patientId)` → id; pushes and calls lightweight re-render of rounds (or `renderAll()`)
  - `function removeImagePlaceholder(id)` → filters list and re-renders
  - Placeholder HTML in x-ray rows: muted box, spinner, `aria-busy="true"`, `aria-label="Uploading…"`, class `xray-thumb is-placeholder`
  - Card flow: placeholder from file chosen through confirm/cancel/fail; type-confirm buttons use `withBusy` for upload+save leg; add control busy only for read+compress
  - Modal attach: placeholder (or keep showing add busy) during compress until pending thumb appears

- [ ] **Step 1: Write the failing tests**

Create `tests/frontend-busy-images.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

describe('image placeholders', () => {
  test('addImagePlaceholder renders an uploading thumb for that patient', () => {
    const patient = {
      id: 'p1', name: 'Ada', status: 'preop', bed: '1',
      images: [], investigations: [], fitness: [], postOpChecks: []
    };
    const { window, document } = loadFrontendEnv({
      initScript: `patients = ${JSON.stringify([patient])}; currentFilter = 'all';`
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
```

Note: `addImagePlaceholder` / `removeImagePlaceholder` / `renderRounds` must be function declarations (globals) so jsdom sees them. If `renderRounds` already is, good; expose the two new helpers as function declarations.

- [ ] **Step 2: Run test — expect FAIL** (`addImagePlaceholder` undefined).

- [ ] **Step 3: CSS for placeholder**

In `public/index.html` near `.xray-thumb`:

```css
.xray-thumb.is-placeholder{
  display:flex;align-items:center;justify-content:center;
  background:var(--paper);border:1px dashed var(--line);
}
.xray-thumb.is-placeholder::after{
  content:'';width:16px;height:16px;border:2px solid var(--accent);
  border-top-color:transparent;border-radius:50%;
  animation:ai-spin 0.7s linear infinite;
}
@media (prefers-reduced-motion: reduce){
  .xray-thumb.is-placeholder::after{animation:none;opacity:0.7;}
}
```

- [ ] **Step 4: Implement placeholder state + render hooks**

In `public/app.js` near image handling:

```js
let imagePlaceholders = []; // { id, patientId }

function addImagePlaceholder(patientId){
  const id = 'ph_' + uid();
  imagePlaceholders.push({ id, patientId });
  return id;
}

function removeImagePlaceholder(id){
  imagePlaceholders = imagePlaceholders.filter(p => p.id !== id);
}

function placeholdersForPatient(patientId){
  return imagePlaceholders.filter(p => p.patientId === patientId);
}

function renderImagePlaceholderThumb(ph){
  return `<div class="xray-thumb is-placeholder" data-placeholder-id="${escapeHTML(ph.id)}" aria-busy="true" aria-label="Uploading…"></div>`;
}
```

In `renderCard` x-ray row, after real images, before `.xray-add`:

```js
${placeholdersForPatient(p.id).map(renderImagePlaceholderThumb).join('')}
```

- [ ] **Step 5: Wire card image flow**

Refactor `handleImageFileSelected` / `confirmImageType` / `closeImageTypeModal`:

1. On file selected: `const phId = addImagePlaceholder(pendingImageSlot.patientId); pendingImageSlot.placeholderId = phId;` then `renderAll()` (or `renderRounds()`). Find the add control if available and `await withBusy(addEl, async () => { … compress … })` — if add control was re-rendered away, skip `withBusy` on it but keep placeholder.
2. After compress + `openImageTypeModal()`, clear busy on add (withBusy finally) — placeholder remains.
3. On each type button (`imgTypePreop` etc.), wrap:

```js
await withBusy(btn, async () => {
  await confirmImageType('preop'); // or pass type
});
```

4. Inside `confirmImageType`: on success `removeImagePlaceholder(pendingImageData.placeholderId)` (store placeholderId on `pendingImageData`); on upload failure remove placeholder + toast; always clear pending.
5. `closeImageTypeModal`: if `pendingImageData?.placeholderId` or `pendingImageSlot?.placeholderId`, remove it.

Store `placeholderId` on both `pendingImageSlot` and `pendingImageData` when creating/advancing state.

Modal path (`handleModalImageSelected`): optionally insert a temporary placeholder in `#modalXrayRow` before compress completes; simplest acceptable approach matching spec — show placeholder in modal row during compress, replace with pending thumb on success. Can reuse a `modalImagePlaceholder` boolean and include it in `renderModalPendingXrays`.

- [ ] **Step 6: Run tests**

Run: `node --no-warnings --test tests/frontend-busy-images.test.js tests/frontend-busy.test.js tests/frontend-icons-and-xray-viewer.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/index.html tests/frontend-busy-images.test.js
git commit -m "$(cat <<'EOF'
feat: show placeholder thumbs while X-rays upload

EOF
)"
```

---

### Task 4: Clinical auth, save, and export busy

**Files:**
- Modify: `public/app.js` — `attemptLogin`, `savePatientFromModal`, change-password / revoke-sessions handlers, OT docx export, `exportData` / `exportCensus` / import if async, any other top-bar actions that await network without busy

**Interfaces:**
- Consumes: `withBusy`
- Produces: those controls use `withBusy`; login drops manual `btn-busy` pair in favor of `withBusy(loginBtn, …)` (CSS: ensure `.btn.is-busy` keeps a visible spinner — either keep adding `btn-busy` inside withBusy for `.btn` elements, or extend CSS so `.btn.is-busy` uses the centered spinner rules)

**Recommended CSS tweak** (so login looks right with only `is-busy`):

```css
.btn.is-busy,.btn.btn-busy{
  position:relative;color:transparent !important;pointer-events:none;
}
.btn.is-busy::after,.btn.btn-busy::after{
  content:"";position:absolute;inset:0;margin:auto;width:18px;height:18px;
  border:2px solid rgba(255,255,255,0.35);border-top-color:#fff;border-radius:50%;
  animation:spin 0.7s linear infinite;
}
```

(Non-`.btn` `.is-busy` keeps the inline AI-style spinner from Task 1.)

- [ ] **Step 1: Write failing smoke tests**

Add to `tests/frontend-busy.test.js`:

```js
describe('clinical busy wiring', () => {
  test('attemptLogin wraps the login button via withBusy (busy during slow fetch)', async () => {
    const { window, document } = loadFrontendEnv();
    document.getElementById('loginUsername').value = 'admin';
    document.getElementById('loginPassword').value = 'secret';
    let release;
    const gate = new Promise(r => { release = r; });
    window.fetch = async () => {
      await gate;
      return { ok: false, json: async () => ({ error: 'nope' }) };
    };
    const btn = document.getElementById('loginBtn');
    const p = window.attemptLogin();
    // yield to allow withBusy to mark busy
    await new Promise(r => setTimeout(r, 0));
    assert.equal(window.isBusy(btn), true);
    release();
    await p;
    assert.equal(window.isBusy(btn), false);
  });
});
```

If `attemptLogin` is not global, it is a function declaration — it is. Good.

- [ ] **Step 2: Run — expect FAIL** (busy never set, or still using only `btn-busy` without `dataset.busy`).

- [ ] **Step 3: Migrate login**

```js
async function attemptLogin(){
  const username = document.getElementById('loginUsername').value.trim();
  const pw = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  errEl.textContent = '';
  if(!username || !pw){ errEl.textContent = 'Enter your username and password'; return; }
  await withBusy(btn, async () => {
    try{
      const res = await fetch('/api/login', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ username, password: pw })
      });
      const data = await res.json().catch(()=> ({}));
      if(!res.ok){ errEl.textContent = data.error || 'Login failed'; return; }
      localStorage.setItem(LS_TOKEN, data.token);
      localStorage.setItem(LS_USERNAME, data.username);
      localStorage.setItem(LS_ROLE, data.role || 'member');
      localStorage.setItem(LS_ORG_ID, data.orgId || '');
      invalidateScopeTree();
      void refreshServerFlags();
      updateAccountUI();
      void renderScopeSelector();
      hideLogin();
      await refreshAiStatus();
      await syncNow({ fullReconcile: true });
    }catch{
      errEl.textContent = 'Cannot reach the server';
    }
  });
}
```

- [ ] **Step 4: Migrate save + account + exports**

Wrap with the clicked element:

| Handler | Element id / selector |
|---------|----------------------|
| `savePatientFromModal` | `#savePatientBtn` |
| change-password submit | the change-password button in that form |
| `revokeSessionsEverywhere` | `#changePasswordRevokeBtn` |
| OT Word export | the OT export button that calls `/api/ot-list/docx` |
| `exportData` / `exportCensus` | `#exportBtn` / census control |

For local-first `savePatientFromModal`: busy ends when modal save’s local `savePatient` + close/render finishes — do **not** `await syncNow` inside the busy wrapper unless the handler already does.

Pattern:

```js
async function savePatientFromModal(){
  const btn = document.getElementById('savePatientBtn');
  await withBusy(btn, async () => {
    // existing body of savePatientFromModal
  });
}
```

Early validation `return`s inside `withBusy` are fine (finally clears busy).

- [ ] **Step 5: Run tests**

Run: `node --no-warnings --test tests/frontend-busy.test.js`

Expected: PASS. Then `npm test` (full suite) — expect green; fix any breakage from login test fetch mock leaking (test should be isolated per `loadFrontendEnv()`).

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/index.html tests/frontend-busy.test.js
git commit -m "$(cat <<'EOF'
feat: busy state on login, save, account, and exports

EOF
)"
```

---

### Task 5: Admin button-level `withBusy`

**Files:**
- Modify: `public/admin-people.js` (create user, reset password, toggle active, role change, bulk assign)
- Modify: `public/admin-structure.js` (create/rename/delete/move mutations)
- Modify: `public/admin-orgs.js` (create org / create user from orgs if present)
- Modify: `public/admin-audit.js` only if CSV export is user-triggered async without busy
- Keep: `setAdminBusy` for section `loadAdminView` — do not replace section loads with button busy alone

**Interfaces:**
- Consumes: global `withBusy` from `busy.js`
- Produces: each mutation’s triggering control is busy for the request duration; section reload may still call `setAdminBusy`

- [ ] **Step 1: Write a failing test for create-user busy**

Add to `tests/frontend-admin-people.test.js` (or new `tests/frontend-busy-admin.test.js`):

```js
test('create user button is busy while the API is in flight', async () => {
  const { window, document, calls } = peopleEnv(CC_USERS);
  // peopleEnv must expose calls — adjust if helper shape differs; otherwise local stub:
  let release;
  const gate = new Promise(r => { release = r; });
  const env = loadFrontendEnv();
  env.window.api = async (path, opts) => {
    if(path === '/api/admin/users' && opts && opts.method === 'POST'){
      await gate;
      return { id: 'new', temporaryPassword: 'tmp' };
    }
    if(path.startsWith('/api/admin/org')) return TREE;
    if(path === '/api/admin/users') return { users: CC_USERS };
    return {};
  };
  // render people section so #adminCreateUser exists
  await env.window.loadAdminView();
  env.window.switchAdminSection('people');
  document.getElementById('adminNewUsername').value = 'newbie';
  const btn = document.getElementById('adminCreateUser');
  btn.click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(env.window.isBusy(btn), true);
  release();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(env.window.isBusy(btn), false);
});
```

Adapt selectors/`peopleEnv`/`TREE` imports to match existing admin people tests. If create is not a dedicated button id, use the actual control from the markup.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Wrap admin mutation handlers**

Example for create user (`admin-people.js`):

```js
if(e.target.id === 'adminCreateUser'){
  e.stopPropagation();
  const btn = e.target;
  void withBusy(btn, async () => {
    // existing validation + api().then chain, converted to await
    ...
  });
  return;
}
```

Convert `.then` chains to `async`/`await` inside `withBusy` so busy covers the full mutation + `loadAdminView` refresh for that click. If `loadAdminView` also sets `setAdminBusy`, that is fine (section bar + button).

Apply the same to reset-password, enable/disable, role select commits, structure create/rename/delete, org create.

- [ ] **Step 4: Run admin frontend tests**

Run: `node --no-warnings --test tests/frontend-admin-people.test.js tests/frontend-admin-structure.test.js tests/frontend-admin-orgs.test.js tests/frontend-admin-console.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/admin-people.js public/admin-structure.js public/admin-orgs.js public/admin-audit.js tests/frontend-admin-people.test.js tests/frontend-busy-admin.test.js
git commit -m "$(cat <<'EOF'
feat: withBusy on admin mutation controls

EOF
)"
```

---

### Task 6: Cold-empty list loading vs warm refresh

**Files:**
- Modify: `public/app.js` — `renderRounds` (~4597), and parallel empty branches in `renderWorklist` / `renderDischarged` / OT list empty if they can flash false empty during sync
- Modify: `public/index.html` — minimal `.list-loading` styles
- Create: `tests/frontend-busy-lists.test.js`

**Interfaces:**
- Consumes: existing `syncing` flag, `patients` array
- Produces:
  - `function isColdPatientLoad()` → `patients.length === 0 && syncing`
  - When `isColdPatientLoad()` and the list would show empty-state “No patients…”: show loading markup instead
  - Warm: `patients.length > 0` while `syncing` → keep cards; sync chip already says “Syncing…”
  - Finished empty: `!syncing && patients.length === 0` → existing empty-state copy

- [ ] **Step 1: Write failing tests**

```js
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
```

`syncing` is a top-level `let` — set via `initScript` in the same eval as app.js (required by frontend-env).

- [ ] **Step 2: Run — expect FAIL** (shows “No patients” while syncing).

- [ ] **Step 3: Implement gate**

```js
function isColdPatientLoad(){
  return patients.length === 0 && !!syncing;
}

function renderListLoadingHTML(label){
  return `<div class="empty-state list-loading" aria-busy="true"><div class="msg">${escapeHTML(label || 'Loading…')}</div></div>`;
}
```

At the top of `renderRounds`, after computing `items`:

```js
if(!items.length && isColdPatientLoad()){
  list.innerHTML = renderListLoadingHTML('Loading…');
  return;
}
```

Mirror for `renderWorklist` / `renderDischarged` empty branches if they use the same false-empty pattern during sync.

CSS:

```css
.list-loading .msg{color:var(--ink-soft);}
```

- [ ] **Step 4: Ensure sync flips re-render**

Confirm `syncNow` already calls something that re-renders when `syncing` becomes true/false (e.g. `renderAll` or chip refresh). If starting sync does not re-render the list, add `renderAll()` (or `renderRounds()`) when setting `syncing = true` and in the `finally` that sets `syncing = false`, so cold loading appears and then resolves to empty or cards.

- [ ] **Step 5: Run tests**

Run: `node --no-warnings --test tests/frontend-busy-lists.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/index.html tests/frontend-busy-lists.test.js
git commit -m "$(cat <<'EOF'
feat: cold-load list state while first sync runs

EOF
)"
```

---

### Task 7: Orphan audit, full suite, mark spec done

**Files:**
- Modify: any remaining `public/app.js` / admin handlers found in the audit
- Modify: `docs/superpowers/specs/2026-07-29-loading-busy-feedback-design.md` status line → Implemented

**Interfaces:**
- Consumes: Tasks 1–6
- Produces: no intentional orphan async click handlers; suite green; spec marked done

- [ ] **Step 1: Audit for orphans**

Run from repo root:

```bash
rg -n "addEventListener\\(['\"]click" public/app.js public/admin-*.js | head -80
rg -n "async function|\\.then\\(" public/app.js public/admin-*.js | head -120
rg -n "setAiButtonBusy|btn-busy|ai-btn-busy" public/
```

For every user-triggered path that `await`s `api` / `fetch` / `savePatient` / AI / upload without going through `withBusy` or the image-placeholder contract, wrap it. Skip pure sync chip background paths and `setAdminBusy` section loads.

Checklist from the spec (tick as done):

- [ ] Login, change password, revoke sessions
- [ ] Patient modal save
- [ ] Checklist / plan / discharge actions that await work
- [ ] Pre-op / post-op / follow-up x-rays + lab photo + modal attach
- [ ] AI: draft, polish, handover, discharge, brief, risk, scribe, bulk plans
- [ ] OT Word/PDF, census, JSON export/import, template pack export
- [ ] Admin button-level mutations
- [ ] Cold list loading + warm keep-cards

- [ ] **Step 2: Full test suite**

Run: `npm test`

Expected: all tests PASS. Sync golden unchanged (no server edits).

- [ ] **Step 3: Mark spec implemented**

In `docs/superpowers/specs/2026-07-29-loading-busy-feedback-design.md`:

```markdown
**Status:** Implemented.
```

- [ ] **Step 4: Commit**

```bash
git add public/app.js public/admin-*.js public/index.html tests docs/superpowers/specs/2026-07-29-loading-busy-feedback-design.md
git commit -m "$(cat <<'EOF'
docs: mark loading busy feedback spec implemented

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Shared `withBusy` in `busy.js`, loaded before admin/app | 1 |
| Hard re-entry guard + aria/disabled | 1 |
| Button-local spinner; no overlay | 1–5 |
| Migrate AI off `setAiButtonBusy` | 2 |
| Image placeholder thumbs; confirm uses withBusy; cancel removes placeholder | 3 |
| Auth / save / export busy | 4 |
| Admin button-level busy; keep `setAdminBusy` | 5 |
| Warm keep list + chip; cold loading not false empty | 6 |
| Universal coverage audit | 7 |
| Tests for helper, placeholder, cold/warm | 1, 3, 6 |
| No server / sync protocol changes | Global constraints |

No TBD placeholders remain. Names consistent: `withBusy`, `isBusy`, `addImagePlaceholder`, `removeImagePlaceholder`, `isColdPatientLoad`.
`)