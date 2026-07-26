### Task 3: Client scope selector (sends `activeScope`, re-pulls on change)

**Files:**
- Modify: `public/index.html` — add `<select id="scopeSelect" hidden>` to the header toolbar (next to the existing top-bar controls, e.g. after the search/title row around the main list header)
- Modify: `public/app.js` — `getActiveScope`/`setActiveScope`, include `activeScope` in the `syncNow` body, `renderScopeSelector()`, call it on init and after login
- Test: `tests/frontend-scope-selector.test.js`

**Interfaces:**
- Consumes: `loadScopeTree()`; `invalidateScopeTree()`; `isAdmin()`; `scopePickerActive()`; `scheduleSync()`; `LS_LASTSYNC`; `escapeHTML`; the `api('/api/sync', ...)` call in `syncNow`.
- Produces: `getActiveScope() -> { type, id } | null`; `setActiveScope(node|null)`; `renderScopeSelector() -> Promise<void>`; sync body gains `activeScope` when set.

- [ ] **Step 1: Write the failing tests**

Create `tests/frontend-scope-selector.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

describe('active scope persistence', () => {
  test('set/get round-trips through localStorage; null clears', () => {
    const { window } = loadFrontendEnv();
    window.setActiveScope({ type: 'department', id: 'dep1' });
    assert.deepEqual(window.getActiveScope(), { type: 'department', id: 'dep1' });
    window.setActiveScope(null);
    assert.equal(window.getActiveScope(), null);
  });
});

describe('syncNow sends activeScope', () => {
  test('the chosen scope rides on the sync request body', async () => {
    const { window } = loadFrontendEnv();
    localStorage.setItem('ortho_token', 't');
    window.setActiveScope({ type: 'unit', id: 'u1' });
    let sentBody = null;
    window.fetch = async (url, opts) => {
      if(String(url).includes('/api/sync')){
        sentBody = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ serverTime: 1, patients: [], apiVersion: 1, scoped: true, rejected: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await window.syncNow({});
    assert.deepEqual(sentBody.activeScope, { type: 'unit', id: 'u1' });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --no-warnings --test tests/frontend-scope-selector.test.js`
Expected: FAIL — `window.setActiveScope is not a function`.

- [ ] **Step 3: Implement persistence + sync wiring in `public/app.js`**

Add near the storage-key constants (with the other `LS_*` consts, ~line 45):

```js
const LS_ACTIVE_SCOPE = 'ortho_active_scope';
```

Add near `loadScopeTree`/`invalidateScopeTree` (~line 6150):

```js
function getActiveScope(){
  try{ const v = JSON.parse(localStorage.getItem(LS_ACTIVE_SCOPE) || 'null'); return (v && v.id) ? { type: v.type, id: v.id } : null; }
  catch{ return null; }
}
function setActiveScope(node){
  if(node && node.id) localStorage.setItem(LS_ACTIVE_SCOPE, JSON.stringify({ type: node.type, id: node.id }));
  else localStorage.removeItem(LS_ACTIVE_SCOPE);
  // New scope = new slice: force a full re-pull; the eviction path clears the
  // previous slice's patients from cache.
  localStorage.setItem(LS_LASTSYNC, '0');
  scheduleSync();
}
```

In `syncNow` (~line 1863), add `activeScope` to the request body:

```js
    const activeScope = getActiveScope() || undefined;
    const res = await api('/api/sync', { method:'POST', body: JSON.stringify({ since, changes, activeScope }) });
```

And in the full-reconcile snapshot POST a few lines below, include it too:

```js
      const snap = await api('/api/sync', { method:'POST', body: JSON.stringify({ since: 0, changes: [], activeScope }) });
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --no-warnings --test tests/frontend-scope-selector.test.js`
Expected: PASS.

- [ ] **Step 5: Add the selector element and renderer**

In `public/index.html`, add to the main list header toolbar (a visible control row near the top of the rounds view):

```html
<select id="scopeSelect" class="scope-select" hidden aria-label="Viewing scope"></select>
```

In `public/app.js`, add the renderer near `renderScopeSelector` neighbors (with the other scope helpers):

```js
async function renderScopeSelector(){
  const el = document.getElementById('scopeSelect');
  if(!el) return;
  if(!(isAdmin() && scopePickerActive())){ el.hidden = true; return; }
  el.hidden = false;
  const { tree } = await loadScopeTree();
  const cur = getActiveScope();
  const opts = ['<option value="">All</option>'];
  for(const dep of (tree.departments || [])){
    opts.push(`<option value="department:${escapeHTML(dep.id)}">${escapeHTML(dep.name)}</option>`);
    for(const u of (dep.units || [])){
      opts.push(`<option value="unit:${escapeHTML(u.id)}">&nbsp;&nbsp;${escapeHTML(dep.name)} · ${escapeHTML(u.name)}</option>`);
    }
  }
  el.innerHTML = opts.join('');
  el.value = cur ? `${cur.type}:${cur.id}` : '';
  el.onchange = () => {
    const raw = el.value || '';
    const i = raw.indexOf(':');
    if(i < 0){ setActiveScope(null); return; }
    setActiveScope({ type: raw.slice(0, i), id: raw.slice(i + 1) });
  };
}
```

Call `renderScopeSelector()` where the app finishes initial load and after a successful login (next to the existing `updateAccountUI()` / initial-render calls — search for `updateAccountUI(` and add `void renderScopeSelector();` alongside).

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — all pass.

```bash
git add public/index.html public/app.js tests/frontend-scope-selector.test.js
git commit -m "feat: admin scope selector — view one department/unit slice at a time"
```

---

