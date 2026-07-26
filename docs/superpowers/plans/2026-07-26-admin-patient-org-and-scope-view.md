# Admin Patient Reorganization + Scoped Viewing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a bulk "Move to unit" action to split the backfilled Default bucket into real departments/units, and an `activeScope` selector to view one slice (department/unit, later org) at a time.

**Architecture:** Feature A is frontend-only — the sync path already lets an admin reassign a patient's `unitId` (`decideWrite` restamps ancestry server-side). Feature B adds one additive server seam: a sync request may carry `activeScope`, which the server intersects with the caller's permission scope (narrow-only, never widen), plus a client selector that sends it and re-pulls on change, reusing the eviction machinery from `2026-07-26-scope-eviction-sync`.

**Tech Stack:** Node 22 (`node:sqlite`, global `fetch`), `node --test`, jsdom frontend harness (`tests/helpers/frontend-env.js`), integration harness (`tests/helpers/server-harness.js`). Vanilla ES modules; no build step.

**Spec:** `docs/superpowers/specs/2026-07-26-admin-patient-org-and-scope-view-design.md`

## Global Constraints

- All behavior is gated by `MULTI_TENANT` (`isEnabled('MULTI_TENANT')` server, `scopePickerActive()` / `serverFlags.MULTI_TENANT` client). Flag off: no selector, no `activeScope`, no "Move to unit" button; behavior byte-identical to today.
- `activeScope` can only ever **narrow** the caller's permission scope — implemented as a set intersection. It must never let any role read or write a unit outside `resolveScope(actor)`.
- Flag-off `/api/sync` response keys stay exactly `serverTime`, `patients`, `apiVersion` (guarded by `tests/server-sync-golden.test.js`). `activeScope` is request-only and ignored when `scope` is null.
- The bulk "Move to unit" action is admin-only (`isAdmin()`), matching the server, which only honors `unitId` reassignment from admins.
- Tests: `npm test` (node --test). Frontend tests load `app.js` via the jsdom harness and drive exposed `window.*` functions; `let`-scoped module globals are exposed in a test's `initScript` via `Object.defineProperty(window, ...)` (see the `patients` accessor in `tests/frontend-unit-picker.test.js`).
- Git quirk: the mount blocks file unlink, so a stale `.git/index.lock` / `HEAD.lock` can't be `rm`'d — rename it aside (`mv .git/index.lock .git/index.lock.stale.$(date +%s)`) before each git write. Prior sessions left `.git/*.lock.*` clutter; ignore it.

---

### Task 1: Bulk "Move to unit" action (frontend only)

**Files:**
- Modify: `public/index.html:1859-1861` (bulk action bar — add a button)
- Modify: `public/app.js` — add `flatUnitsFromScopeTree`, `movePatientToUnit`, `bulkMoveToUnit`; wire the button (~`public/app.js:3859`); toggle button visibility in `updateBulkBar` (~`public/app.js:8340`)
- Test: `tests/frontend-bulk-move.test.js`

**Interfaces:**
- Consumes: `loadScopeTree()` → `{ assignment, tree }` where `tree.departments[] = { id, name, units: [{ id, name, wards }] }`; `bulkSelectedIds: Set<string>`; `patients: Array`; `savePatient(p)`; `isAdmin()`; `scopePickerActive()`; `showPromptFields(title, fields)` (supports `{ id, label, type: 'select', value, options: [{value,label}] }`, resolves to `{ [id]: value }` or null); `updateBulkBar()`; `renderAll()`; `showToast(msg)`.
- Produces: `flatUnitsFromScopeTree(tree) -> [{ id, name }]`; `movePatientToUnit(p, unitId) -> p` (sets `p.unitId`, deletes `p.wardId` and `p.ward`); `bulkMoveToUnit() -> Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/frontend-bulk-move.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

const INIT = [
  'Object.defineProperty(window, "patients", { get: function(){ return patients; }, set: function(v){ patients = v; }, configurable: true });',
  'Object.defineProperty(window, "bulkSelectedIds", { get: function(){ return bulkSelectedIds; }, configurable: true });'
].join('\n');

describe('flatUnitsFromScopeTree', () => {
  test('flattens departments -> units into id/name pairs, dept-qualified', () => {
    const { window } = loadFrontendEnv();
    const tree = { departments: [
      { id: 'dep1', name: 'Ortho', units: [{ id: 'u1', name: 'Unit One', wards: [] }, { id: 'u2', name: 'IV', wards: [] }] },
      { id: 'dep2', name: 'Surgery', units: [{ id: 'u3', name: 'Gen', wards: [] }] }
    ] };
    const out = window.flatUnitsFromScopeTree(tree);
    assert.deepEqual(out.map(u => u.id), ['u1', 'u2', 'u3']);
    assert.equal(out[0].name, 'Ortho · Unit One');
    assert.equal(out[2].name, 'Surgery · Gen');
  });

  test('empty / missing tree yields []', () => {
    const { window } = loadFrontendEnv();
    assert.deepEqual(window.flatUnitsFromScopeTree(null), []);
    assert.deepEqual(window.flatUnitsFromScopeTree({ departments: [] }), []);
  });
});

describe('movePatientToUnit', () => {
  test('sets unitId and clears stale ward fields (server re-derives ancestry on sync)', () => {
    const { window } = loadFrontendEnv();
    const p = { id: 'p1', unitId: 'u1', wardId: 'w1', ward: 'Ward One', unit: 'Unit One' };
    window.movePatientToUnit(p, 'u2');
    assert.equal(p.unitId, 'u2');
    assert.equal('wardId' in p, false);
    assert.equal('ward' in p, false);
  });
});

describe('bulkMoveToUnit', () => {
  test('moves every selected patient to the chosen unit and exits select mode', async () => {
    const { window } = loadFrontendEnv({ initScript: INIT });
    window.serverFlags = { MULTI_TENANT: true };
    localStorage.setItem('ortho_role', 'admin');
    window.fetch = async (url) => {
      if(String(url).includes('/api/me/scope')){
        return { ok: true, status: 200, json: async () => ({ assignment: null, tree: { departments: [
          { id: 'dep1', name: 'Ortho', units: [{ id: 'u1', name: 'One', wards: [] }, { id: 'u2', name: 'IV', wards: [] }] }
        ] } }) };
      }
      return { ok: true, status: 200, json: async () => ({ serverTime: 1, patients: [], apiVersion: 1, scoped: true, rejected: [] }) };
    };
    window.showPromptFields = async () => ({ unit: 'u2' });
    window.patients = [{ id: 'a', unitId: 'u1' }, { id: 'b', unitId: 'u1' }, { id: 'c', unitId: 'u1' }];
    window.bulkSelectedIds.add('a');
    window.bulkSelectedIds.add('b');

    await window.bulkMoveToUnit();

    assert.equal(window.patients.find(p => p.id === 'a').unitId, 'u2');
    assert.equal(window.patients.find(p => p.id === 'b').unitId, 'u2');
    assert.equal(window.patients.find(p => p.id === 'c').unitId, 'u1', 'unselected patient untouched');
    assert.equal(window.bulkSelectedIds.size, 0, 'selection cleared after move');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --no-warnings --test tests/frontend-bulk-move.test.js`
Expected: FAIL — `window.flatUnitsFromScopeTree is not a function`.

- [ ] **Step 3: Implement the three functions in `public/app.js`**

Add near the scope-picker helpers (after `invalidateScopeTree`, ~`public/app.js:6150`):

```js
function flatUnitsFromScopeTree(tree){
  const out = [];
  for(const dep of ((tree && tree.departments) || [])){
    for(const u of (dep.units || [])){
      out.push({ id: u.id, name: dep.name ? `${dep.name} · ${u.name}` : u.name });
    }
  }
  return out;
}

function movePatientToUnit(p, unitId){
  p.unitId = unitId;
  // Moving units invalidates any ward; the server re-derives ward + ancestry
  // labels from the new unitId on sync, so drop the stale ward locally.
  delete p.wardId;
  delete p.ward;
  return p;
}

async function bulkMoveToUnit(){
  if(!bulkSelectedIds.size){ showToast('Select patients first'); return; }
  const { tree } = await loadScopeTree();
  const units = flatUnitsFromScopeTree(tree);
  if(!units.length){ showToast('No units yet — create one in the console'); return; }
  const fields = await showPromptFields('Move to unit', [
    { id: 'unit', label: `Move ${bulkSelectedIds.size} patient(s) to`, type: 'select', value: '',
      options: [{ value: '', label: 'Select unit…' }].concat(units.map(u => ({ value: u.id, label: u.name }))) }
  ]);
  if(!fields || !fields.unit) return;
  const count = bulkSelectedIds.size;
  for(const id of bulkSelectedIds){
    const p = patients.find(x => x.id === id);
    if(!p) continue;
    movePatientToUnit(p, fields.unit);
    await savePatient(p);
  }
  bulkSelectMode = false;
  bulkSelectedIds.clear();
  document.getElementById('bulkPlanBtn')?.classList.remove('active');
  updateBulkBar();
  renderAll();
  showToast(`Moved ${count} patient(s)`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --no-warnings --test tests/frontend-bulk-move.test.js`
Expected: PASS (all).

- [ ] **Step 5: Add the button and wiring**

In `public/index.html`, add the button between apply and cancel (currently lines 1859-1861):

```html
<span><strong class="bulk-plan-count">0</strong> selected</span>
<button type="button" class="btn primary pressable" id="bulkBarApplyBtn">Apply plan</button>
<button type="button" class="btn pressable" id="bulkBarMoveBtn" hidden>Move to unit</button>
<button type="button" class="btn pressable" id="bulkBarCancelBtn">Cancel</button>
```

In `public/app.js`, next to the existing `bulkBarApplyBtn` listener (~line 3859):

```js
document.getElementById('bulkBarMoveBtn')?.addEventListener('click', ()=> void bulkMoveToUnit());
```

In `updateBulkBar()` (~line 8340), after the `.bulk-plan-count` update, gate the move button to admins in multi-tenant mode:

```js
  const moveBtn = document.getElementById('bulkBarMoveBtn');
  if(moveBtn) moveBtn.hidden = !(isAdmin() && scopePickerActive());
```

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — all pass (button/wiring are inert markup; the golden flag-off contract is untouched).

```bash
git add public/index.html public/app.js tests/frontend-bulk-move.test.js
git commit -m "feat: admin bulk 'Move to unit' to reorganize patients into real units"
```

---

### Task 2: Server `activeScope` narrowing on `/api/sync` (flag-on, additive)

**Files:**
- Modify: `scope.js` — add `intersectScope(scope, activeUnitIds)`
- Modify: `server.js` — import `listUnitIdsUnder` + `intersectScope`; compute `effScope` in the sync handler; use it for `decideWrite`, `canRead`, and the `scoped`/`rejected` signals
- Test: `tests/scope.test.js` (pure) and `tests/server-scoping.test.js` (integration)

**Interfaces:**
- Consumes: `resolveScope(actor, store) -> { unrestricted, unitIds: Set, includeUnassigned }`; `listUnitIdsUnder(store, node) -> Promise<Set>` (from `hierarchy.js`, handles unknown node type → empty set); sync request `body.activeScope = { type, id }`.
- Produces: `intersectScope(scope, activeUnitIds) -> { unrestricted: false, unitIds: Set, includeUnassigned: false }` — narrow-only.

- [ ] **Step 1: Write the failing pure test**

Append to `tests/scope.test.js`:

```js
import { intersectScope } from '../scope.js';

describe('intersectScope — narrow-only active scope', () => {
  test('unrestricted collapses to exactly the active units', () => {
    const s = intersectScope({ unrestricted: true, unitIds: new Set(), includeUnassigned: true }, new Set(['u1', 'u2']));
    assert.equal(s.unrestricted, false);
    assert.deepEqual([...s.unitIds].sort(), ['u1', 'u2']);
    assert.equal(s.includeUnassigned, false);
  });
  test('restricted keeps only its own units that are also active (never widens)', () => {
    const s = intersectScope({ unrestricted: false, unitIds: new Set(['u1', 'u2']), includeUnassigned: false }, new Set(['u2', 'u3']));
    assert.deepEqual([...s.unitIds], ['u2']);
  });
  test('empty intersection yields an empty scope (fail closed)', () => {
    const s = intersectScope({ unrestricted: false, unitIds: new Set(['u1']), includeUnassigned: false }, new Set(['u9']));
    assert.equal(s.unitIds.size, 0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --no-warnings --test tests/scope.test.js`
Expected: FAIL — `intersectScope` is not exported.

- [ ] **Step 3: Implement `intersectScope` in `scope.js`**

```js
/** Narrow an effective scope to the intersection with a set of unit ids
 *  (the caller's chosen activeScope subtree). Narrow-only: an unrestricted
 *  scope collapses to exactly activeUnitIds; a restricted scope keeps only
 *  the units it already allowed. Unassigned patients are never in an
 *  activeScope subtree, so includeUnassigned is always false. */
export function intersectScope(scope, activeUnitIds){
  if(scope.unrestricted){
    return { unrestricted: false, unitIds: new Set(activeUnitIds), includeUnassigned: false };
  }
  const out = new Set();
  for(const u of scope.unitIds){ if(activeUnitIds.has(u)) out.add(u); }
  return { unrestricted: false, unitIds: out, includeUnassigned: false };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --no-warnings --test tests/scope.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing integration tests**

Append to the `MULTI_TENANT sync scoping (unit-based)` describe in `tests/server-scoping.test.js` (seed has org1 → dep1(unit1), dep2(unit2); pg1@unit1, boss1 org-admin, root instance-admin; patients pat-w1@unit1, pat-w2 moved to unit1 earlier, pat-wx@unitx in org2):

```js
  test('activeScope narrows an unrestricted admin to one department', async () => {
    const r = await syncPost(srv.baseUrl, tokens.root, { since: 0, changes: [], activeScope: { type: 'department', id: 'dep1' } });
    assert.equal(r.json.scoped, true, 'narrowed admin is now scoped');
    for(const p of r.json.patients){ assert.equal(p.departmentId, 'dep1'); }
    assert.equal(r.json.patients.some(p => p.orgId === 'org2'), false, 'other org excluded');
  });

  test('activeScope cannot widen a member beyond their permission scope', async () => {
    // pg1 is pinned to unit1; pointing activeScope at unit2 (in-org but not theirs)
    // intersects to empty — no escalation, and definitely no cross to unit2.
    const r = await syncPost(srv.baseUrl, tokens.pg1, { since: 0, changes: [], activeScope: { type: 'unit', id: 'unit2' } });
    assert.equal(r.json.patients.some(p => p.unitId === 'unit2'), false);
  });

  test('absent activeScope reproduces the un-narrowed result', async () => {
    const a = await syncPost(srv.baseUrl, tokens.pg1, { since: 0, changes: [] });
    assert.ok(a.json.patients.every(p => p.unitId === 'unit1'));
  });
```

- [ ] **Step 6: Run to verify they fail**

Run: `node --no-warnings --test tests/server-scoping.test.js`
Expected: FAIL — the admin sees all patients (activeScope not yet honored).

- [ ] **Step 7: Wire `activeScope` into the sync handler (`server.js`, wrap-only)**

Extend both existing imports at the top of `server.js` (currently `server.js:66-67` import `{ resolveScope, canRead, decideWrite }` from `./scope.js` and `{ wardUnitId }` from `./hierarchy.js`):

```js
import { resolveScope, canRead, decideWrite, intersectScope } from './scope.js';
import { wardUnitId, listUnitIdsUnder } from './hierarchy.js';
```

In the sync handler, right after `const scope = isEnabled('MULTI_TENANT') ? await resolveScope(actor, store) : null;`, compute the effective scope:

```js
    let effScope = scope;
    if(scope && body.activeScope && body.activeScope.id){
      const activeUnitIds = await listUnitIdsUnder(store, { type: String(body.activeScope.type || ''), id: String(body.activeScope.id) });
      effScope = intersectScope(scope, activeUnitIds);
    }
```

Then replace the three remaining uses of `scope` in this handler with `effScope`: the `decideWrite({ ..., scope })` call, the `outPatients.filter(p => canRead(p, scope))` line, and the `if(scope){ responseBody.rejected = ...; responseBody.scoped = !scope.unrestricted; }` block. (Keep the guard `if(scope)` — an absent flag means no narrowing and no keys, unchanged. `effScope` is never unrestricted when narrowed, so `scoped` reports the narrowed truth.) The `if(scope && stored.wardId)` ward-validation guard can stay on `scope` — it only checks whether we're in multi-tenant mode, and narrowing doesn't change ward validity.

- [ ] **Step 8: Run to verify tests pass**

Run: `node --no-warnings --test tests/scope.test.js tests/server-scoping.test.js tests/server-sync-golden.test.js`
Expected: PASS (golden flag-off unaffected — `scope` is null there, so `activeScope` is ignored).

- [ ] **Step 9: Run the full suite, then commit**

Run: `npm test` — all pass.

```bash
git add scope.js server.js tests/scope.test.js tests/server-scoping.test.js
git commit -m "feat: activeScope narrows /api/sync to a subtree (intersect, never widen)"
```

---

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

## Self-review notes (author)

- Spec coverage: Feature A → Task 1; Feature B1 (server seam) → Task 2; Feature B2 (client selector) → Task 3. Feature B3 (multi-org org switcher, empty-state prompt, rollups) is explicitly Phase 2 and out of this plan, per the spec's "Out of scope."
- The narrow-only guarantee is proven by `intersectScope` unit tests plus the member-can't-widen integration test.
- `scoped`/`rejected` correctly reflect the narrowed `effScope`, so an admin narrowing their view evicts the previous slice via the existing eviction path — intended.
- No new dependency; all vanilla. Flag-off paths untouched (golden test remains the guard).

## Phase 2 (not in this plan)

When a second organization exists: default an unrestricted admin with no `activeScope` to an empty list + "pick an organization" prompt; add an org tier to the selector (needs an org list — extend `/api/me/scope` or add `GET /api/me/orgs`); optional counts-only cross-org rollup via `buildOrgRollups`. The Task 2 seam already supports org-level `activeScope`, so this is additive UX only.
