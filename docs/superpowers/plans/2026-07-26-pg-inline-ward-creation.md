# PG Inline Ward Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a scoped member (PG) create a ward under their own unit directly from the patient form, removing the admin-console bottleneck.

**Architecture:** A new member-accessible `POST /api/wards` route authorizes by the caller's unit scope (not org-admin role), dedupes case-insensitively, and caps wards per unit. The patient form's ward `<select>` becomes a combobox (text input + datalist + hidden id field) with a "Create '<name>'" action that calls the route and injects the new ward into the cached scope tree. Wards stay structured nodes; `decideWrite` and the patient save path are untouched.

**Tech Stack:** Node's built-in HTTP server (`server.js`, ESM), the store abstraction (`storage.js`, SQLite + Mongo), vanilla-JS browser client (`public/app.js`), `node:test` + a jsdom harness for tests.

**Spec:** `docs/superpowers/specs/2026-07-26-pg-inline-ward-creation-design.md`

## Global Constraints

- **Flag gate:** all new behavior is behind `MULTI_TENANT`. Flag off → `POST /api/wards` returns `404 { error: 'Unknown endpoint' }`; the combobox markup does not render (the picker only exists in the `scopePickerActive()` branch).
- **Ward name rules:** trimmed, required, ≤ 80 chars — validate with the existing `cleanName(raw, 80)` helper server-side.
- **Dedupe:** case-insensitive on trimmed name, per unit — an existing match is returned, never duplicated.
- **Per-unit cap:** reject creation when the unit already has ≥ `50` wards → `409 { error: 'Ward limit reached for this unit' }`.
- **Scope authorization:** use `resolveScope(actor, store)`; allow when `scope.unrestricted` or `scope.unitIds.has(unitId)`, else `403 { error: 'Not in your scope' }`.
- **No schema changes:** reuse `store.getUnit`, `store.listWardsByUnit`, `store.createWard`.
- **Server-authoritative ancestry unchanged:** the patient POST still carries only `wardId`; do not touch `decideWrite` or `scope.js`.
- **Test runner:** `npm test` runs `node --no-warnings --test` (discovers `tests/**/*.test.js`).

---

### Task 1: Backend `POST /api/wards` route

Member-accessible ward creation, scope-authorized, deduped, capped. TDD via the server harness.

**Files:**
- Modify: `server.js` — insert a new route immediately after the `/api/me/scope` block (currently ends at `server.js:396`) and before the `if(isEnabled('MULTI_TENANT') && pathname.startsWith('/api/admin/'))` block (currently `server.js:398`).
- Test: `tests/server-wards.test.js` (create)

**Interfaces:**
- Consumes (already present in `server.js`): `isEnabled('MULTI_TENANT')`, `readBody(req)`, `sendJSON(res, status, obj)`, `cleanName(raw, max)`, `resolveScope(actor, store)` (imported at `server.js:66`), `store.getUnit`, `store.listWardsByUnit`, `store.createWard`, `crypto.randomUUID()`, and the `actor` object built at `server.js:329`.
- Consumes (harness): `startServer({ multiTenant, seed })`, `login(baseUrl, username?, password?)` from `tests/helpers/server-harness.js`.
- Produces: `POST /api/wards` accepting `{ unitId, name }` → `200 { id, unitId, name }` on create-or-dedupe; `404`/`403`/`400`/`409` on the failure paths below.

- [ ] **Step 1: Write the failing test**

Create `tests/server-wards.test.js`. This local `api()` helper matches the one in `tests/server-structure.test.js`; the setup mirrors that file (build a tree as an org admin, then create + unit-assign a plain member).

```js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './helpers/server-harness.js';

async function api(baseUrl, token, path, opts = {}){
  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let json = null;
  try{ json = await res.json(); }catch{}
  return { status: res.status, json };
}

describe('POST /api/wards — member self-service ward creation (flag on)', () => {
  let srv, root, boss, orgId, departmentId, unitId, otherUnitId, memberToken;
  before(async () => {
    srv = await startServer({ multiTenant: true, seed: async () => {} });
    root = (await login(srv.baseUrl)).json.token;

    const org = await api(srv.baseUrl, root, '/api/admin/orgs', { method: 'POST', body: { name: 'Ward Org' } });
    orgId = org.json.id;
    const admin = await api(srv.baseUrl, root, `/api/admin/orgs/${orgId}/admin`, { method: 'POST', body: { username: 'wardboss' } });
    boss = (await login(srv.baseUrl, 'wardboss', admin.json.temporaryPassword)).json.token;

    const h = await api(srv.baseUrl, boss, '/api/admin/hospitals', { method: 'POST', body: { name: 'City Hospital' } });
    const d = await api(srv.baseUrl, boss, '/api/admin/departments', { method: 'POST', body: { hospitalId: h.json.id, name: 'Ortho' } });
    departmentId = d.json.id;
    const u = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { departmentId, name: 'Unit IV' } });
    unitId = u.json.id;
    const u2 = await api(srv.baseUrl, boss, '/api/admin/units', { method: 'POST', body: { departmentId, name: 'Unit V' } });
    otherUnitId = u2.json.id;

    const m = await api(srv.baseUrl, boss, '/api/admin/users', { method: 'POST', body: { username: 'pgmember' } });
    await api(srv.baseUrl, boss, `/api/admin/users/${m.json.id}/assign`, { method: 'POST', body: { nodeType: 'unit', nodeId: unitId } });
    memberToken = (await login(srv.baseUrl, 'pgmember', m.json.temporaryPassword)).json.token;
  });
  after(async () => { await srv.stop(); });

  test('member creates a ward under their own unit → 200 with id', async () => {
    const r = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId, name: '7MOW' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.unitId, unitId);
    assert.equal(r.json.name, '7MOW');
    assert.ok(r.json.id, 'returns a ward id');
  });

  test('duplicate name (case-insensitive) returns the existing ward, no second row', async () => {
    const first = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId, name: 'Bay 12' } });
    const again = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId, name: '  bay 12 ' } });
    assert.equal(again.status, 200);
    assert.equal(again.json.id, first.json.id, 'dedupes to the same ward id');
  });

  test('member cannot create under a unit outside their scope → 403', async () => {
    const r = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId: otherUnitId, name: 'Sneaky' } });
    assert.equal(r.status, 403);
  });

  test('nonexistent unit → 404', async () => {
    const r = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId: 'nope', name: 'X' } });
    assert.equal(r.status, 404);
  });

  test('empty name → 400; over 80 chars → 400', async () => {
    const empty = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId, name: '   ' } });
    assert.equal(empty.status, 400);
    const long = await api(srv.baseUrl, memberToken, '/api/wards', { method: 'POST', body: { unitId, name: 'x'.repeat(81) } });
    assert.equal(long.status, 400);
  });

  test('instance admin (unrestricted) can create under any unit → 200', async () => {
    const r = await api(srv.baseUrl, root, '/api/wards', { method: 'POST', body: { unitId: otherUnitId, name: 'Admin Ward' } });
    assert.equal(r.status, 200);
  });
});

describe('POST /api/wards — flag OFF', () => {
  let srv;
  before(async () => { srv = await startServer({ multiTenant: false }); });
  after(async () => { await srv.stop(); });

  test('route 404s when MULTI_TENANT is off', async () => {
    const token = (await login(srv.baseUrl)).json.token;
    const r = await api(srv.baseUrl, token, '/api/wards', { method: 'POST', body: { unitId: 'u', name: 'W' } });
    assert.equal(r.status, 404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/server-wards.test.js`
Expected: FAIL — the flag-on creation tests get `404` (route doesn't exist yet) instead of `200`/`403`/`400`.

- [ ] **Step 3: Implement the route**

Insert this block in `server.js` right after the `/api/me/scope` handler returns (after `server.js:396`), before the `/api/admin/` block:

```js
  if(pathname === '/api/wards' && req.method === 'POST'){
    if(!isEnabled('MULTI_TENANT')) return sendJSON(res, 404, { error: 'Unknown endpoint' });
    const body = await readBody(req) || {};
    const unit = body.unitId ? await store.getUnit(body.unitId) : null;
    if(!unit) return sendJSON(res, 404, { error: 'Unit not found' });
    const scope = await resolveScope(actor, store);
    if(!scope.unrestricted && !scope.unitIds.has(unit.id)){
      return sendJSON(res, 403, { error: 'Not in your scope' });
    }
    const name = cleanName(body.name);
    if(!name) return sendJSON(res, 400, { error: 'Ward name required (max 80 chars)' });
    const existing = await store.listWardsByUnit(unit.id);
    const dup = existing.find(w => String(w.name).trim().toLowerCase() === name.toLowerCase());
    if(dup) return sendJSON(res, 200, { id: dup.id, unitId: unit.id, name: dup.name });
    if(existing.length >= 50) return sendJSON(res, 409, { error: 'Ward limit reached for this unit' });
    const ward = { id: crypto.randomUUID(), unitId: unit.id, name, createdAt: Date.now() };
    await store.createWard(ward);
    return sendJSON(res, 200, { id: ward.id, unitId: unit.id, name });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/server-wards.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add server.js tests/server-wards.test.js
git commit -m "feat: member-accessible POST /api/wards (scope-bounded, deduped, capped)"
```

---

### Task 2: Frontend ward combobox with type-to-create

Turn the ward `<select>` into a text-input + datalist combobox backed by a hidden id field, with a "Create '<name>'" action. Add pure, testable tree helpers and wire the DOM.

**Files:**
- Modify: `public/app.js`
  - Markup: the scoped-picker ward cell in `renderModalForm` (`public/app.js:6380`).
  - Logic: `populateWardSelect` (`public/app.js:6140-6149`) and `populateScopePicker` (`public/app.js:6164-6198`); add new helpers near the picker section (after `public/app.js:6162`).
  - Leave unchanged: the two save-path reads of `#f_ward` (`public/app.js:6241-6242` and `public/app.js:7282-7283`) — they keep reading the hidden id field.
- Test: `tests/frontend-ward-create.test.js` (create), using `tests/helpers/frontend-env.js`.

**Interfaces:**
- Consumes: `cachedScopeTree` (`public/app.js:6103`), `escapeHTML`, `fillSelect` (`public/app.js:6120`), `api(path, opts)` (the client fetch helper used elsewhere in app.js, e.g. `public/app.js:6112`), `showToast`.
- Produces (all top-level `function` declarations, so visible as `window.*` in the jsdom harness):
  - `wardsForUnit(tree, unitId) -> Array<{id,name}>`
  - `matchWardByName(tree, unitId, typed) -> {id,name}|null`
  - `injectWardIntoScopeTree(tree, unitId, ward) -> boolean` (idempotent by ward id)

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `tests/frontend-ward-create.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

const TREE = () => ({
  departments: [
    { id: 'd1', name: 'Ortho', units: [
      { id: 'u1', name: 'Unit IV', wards: [{ id: 'w1', name: '7MOW' }] },
      { id: 'u2', name: 'Unit V', wards: [] }
    ]}
  ]
});

describe('ward combobox pure helpers', () => {
  test('wardsForUnit returns the unit\'s wards, or [] for unknown unit', () => {
    const { window } = loadFrontendEnv();
    assert.deepEqual(window.wardsForUnit(TREE(), 'u1'), [{ id: 'w1', name: '7MOW' }]);
    assert.deepEqual(window.wardsForUnit(TREE(), 'u2'), []);
    assert.deepEqual(window.wardsForUnit(TREE(), 'nope'), []);
  });

  test('matchWardByName matches case-insensitively and trims, else null', () => {
    const { window } = loadFrontendEnv();
    assert.equal(window.matchWardByName(TREE(), 'u1', '  7mow ').id, 'w1');
    assert.equal(window.matchWardByName(TREE(), 'u1', '7FOW'), null);
    assert.equal(window.matchWardByName(TREE(), 'u1', ''), null);
  });

  test('injectWardIntoScopeTree adds once and is idempotent by id', () => {
    const { window } = loadFrontendEnv();
    const tree = TREE();
    assert.equal(window.injectWardIntoScopeTree(tree, 'u2', { id: 'w9', name: '3SPW' }), true);
    assert.deepEqual(window.wardsForUnit(tree, 'u2'), [{ id: 'w9', name: '3SPW' }]);
    window.injectWardIntoScopeTree(tree, 'u2', { id: 'w9', name: '3SPW' });
    assert.equal(window.wardsForUnit(tree, 'u2').length, 1, 'no duplicate on re-inject');
    assert.equal(window.injectWardIntoScopeTree(tree, 'nope', { id: 'wX', name: 'X' }), false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/frontend-ward-create.test.js`
Expected: FAIL — `window.wardsForUnit is not a function` (helpers not defined yet).

- [ ] **Step 3: Add the pure helpers**

Insert into `public/app.js` after `findSingleUnitChain` (after `public/app.js:6162`):

```js
function wardsForUnit(tree, unitId){
  for(const dep of ((tree && tree.departments) || [])){
    const unit = (dep.units || []).find(u => u.id === unitId);
    if(unit) return unit.wards || [];
  }
  return [];
}

function matchWardByName(tree, unitId, typed){
  const name = String(typed || '').trim().toLowerCase();
  if(!name) return null;
  return wardsForUnit(tree, unitId).find(w => String(w.name).trim().toLowerCase() === name) || null;
}

function injectWardIntoScopeTree(tree, unitId, ward){
  for(const dep of ((tree && tree.departments) || [])){
    const unit = (dep.units || []).find(u => u.id === unitId);
    if(unit){
      unit.wards = unit.wards || [];
      if(!unit.wards.some(w => w.id === ward.id)) unit.wards.push({ id: ward.id, name: ward.name });
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/frontend-ward-create.test.js`
Expected: PASS.

- [ ] **Step 5: Commit the helpers**

```bash
git add public/app.js tests/frontend-ward-create.test.js
git commit -m "feat: scope-tree ward helpers (wardsForUnit, matchWardByName, injectWardIntoScopeTree)"
```

- [ ] **Step 6: Replace the ward `<select>` markup with the combobox**

In `renderModalForm`, replace the scoped-picker ward cell at `public/app.js:6380`:

```html
      <div><label>Ward (optional)</label><select id="f_ward"></select></div>
```

with:

```html
      <div><label>Ward (optional)</label>
        <input id="f_ward_name" list="f_ward_list" placeholder="Select or type a new ward" autocomplete="off">
        <datalist id="f_ward_list"></datalist>
        <input type="hidden" id="f_ward">
        <button type="button" id="f_ward_create" class="btn" style="display:none; margin-top:6px;"></button>
        <div id="f_ward_msg" class="form-hint" style="display:none; margin-top:4px;"></div>
      </div>
```

The hidden `#f_ward` preserves the existing read contract at `public/app.js:6241` and `public/app.js:7282`, which stay unchanged.

- [ ] **Step 7: Rewrite `populateWardSelect` to drive the combobox**

Replace `populateWardSelect` (`public/app.js:6140-6149`) with:

```js
function populateWardSelect(tree, departmentId, unitId, selectedWardId){
  const listEl = document.getElementById('f_ward_list');
  const nameEl = document.getElementById('f_ward_name');
  const idEl = document.getElementById('f_ward');
  if(!listEl || !nameEl || !idEl) return;
  const wards = wardsForUnit(tree, unitId);
  listEl.innerHTML = wards.map(w => `<option value="${escapeHTML(w.name)}"></option>`).join('');
  const selected = wards.find(w => w.id === selectedWardId) || null;
  idEl.value = selected ? selected.id : '';
  nameEl.value = selected ? selected.name : '';
  nameEl.dataset.unitId = unitId || '';
  updateWardCreateAffordance(tree);
}

function updateWardCreateAffordance(tree){
  const nameEl = document.getElementById('f_ward_name');
  const idEl = document.getElementById('f_ward');
  const btn = document.getElementById('f_ward_create');
  const msg = document.getElementById('f_ward_msg');
  if(!nameEl || !idEl || !btn) return;
  const unitId = nameEl.dataset.unitId || '';
  const typed = nameEl.value.trim();
  const match = matchWardByName(tree, unitId, typed);
  if(match){
    idEl.value = match.id;
    btn.style.display = 'none';
    if(msg) msg.style.display = 'none';
  }else{
    idEl.value = '';
    if(unitId && typed){
      btn.textContent = `Create “${typed}”`;
      btn.style.display = 'inline-block';
    }else{
      btn.style.display = 'none';
    }
    if(msg) msg.style.display = 'none';
  }
}

async function createWardFromInput(tree){
  const nameEl = document.getElementById('f_ward_name');
  const idEl = document.getElementById('f_ward');
  const btn = document.getElementById('f_ward_create');
  const msg = document.getElementById('f_ward_msg');
  if(!nameEl || !idEl) return;
  const unitId = nameEl.dataset.unitId || '';
  const name = nameEl.value.trim();
  if(!unitId || !name) return;
  if(btn) btn.disabled = true;
  try{
    const ward = await api('/api/wards', { method: 'POST', body: { unitId, name } });
    injectWardIntoScopeTree(tree, unitId, ward);
    const listEl = document.getElementById('f_ward_list');
    if(listEl){
      listEl.innerHTML = wardsForUnit(tree, unitId)
        .map(w => `<option value="${escapeHTML(w.name)}"></option>`).join('');
    }
    idEl.value = ward.id;
    nameEl.value = ward.name;
    if(btn) btn.style.display = 'none';
    if(msg) msg.style.display = 'none';
  }catch(err){
    if(msg){ msg.textContent = (err && err.message) || 'Could not create ward'; msg.style.display = 'block'; }
  }finally{
    if(btn) btn.disabled = false;
  }
}
```

Note: confirm the client `api(path, opts)` helper posts `opts.body` as JSON and throws on non-2xx with a readable `.message` (it's the same helper `loadScopeTree` uses at `public/app.js:6112`). If it returns `{error}` on failure instead of throwing, adjust `createWardFromInput` to check the response shape — but do not change `api()` itself.

- [ ] **Step 8: Wire events in `populateScopePicker`**

In `populateScopePicker` (`public/app.js:6164-6198`), the current handlers are:

```js
  depEl.onchange = () => populateUnitSelect(tree, depEl.value, '', '');
  unitEl.onchange = () => populateWardSelect(tree, depEl.value, unitEl.value, '');
```

Add, immediately after them, the ward-input handlers (the dep/unit `onchange` already rebuild the ward control via `populateUnitSelect`/`populateWardSelect`, so no change to those two lines):

```js
  const wardNameEl = document.getElementById('f_ward_name');
  const wardCreateEl = document.getElementById('f_ward_create');
  if(wardNameEl) wardNameEl.oninput = () => updateWardCreateAffordance(tree);
  if(wardCreateEl) wardCreateEl.onclick = () => createWardFromInput(tree);
```

Also update the ward-disabled line at the end of `populateScopePicker` (`public/app.js:6197`, `wardEl.disabled = false;`) — replace the stale `wardEl` reference (the old `<select>` is gone) with:

```js
  const wardNameCtl = document.getElementById('f_ward_name');
  if(wardNameCtl) wardNameCtl.disabled = false;
```

And near the top of `populateScopePicker`, the guard at `public/app.js:6167-6168` reads `const wardEl = document.getElementById('f_ward');` then `if(!depEl || !unitEl || !wardEl) return;`. Keep it — the hidden `#f_ward` still exists, so this guard still holds. Do not reference `wardEl` for `.disabled` anymore.

- [ ] **Step 9: Manual DOM verification (no automated browser in this env)**

The jsdom harness can't drive the full modal, so verify wiring by hand against a `MULTI_TENANT` dev server:

1. `MULTI_TENANT=1 npm start`, log in as a member assigned to a unit that has one existing ward.
2. Open Add patient. Confirm the Ward field shows existing wards in its dropdown (datalist) and the field is optional.
3. Type an existing ward name (any case) → no Create button; saving pins that `wardId` (check the patient shows the ward).
4. Type a brand-new name → a `Create "<name>"` button appears; click it → button disappears, name stays, and saving pins the new ward. Confirm the ward now appears in the admin console under that unit.
5. Type the same new name again in a second Add → it's already in the dropdown (dedupe), no duplicate created.

- [ ] **Step 10: Commit the UI**

```bash
git add public/app.js
git commit -m "feat: type-to-create ward combobox in the patient form"
```

---

### Task 3: Full-suite + flag-off verification

Guard against regressions in the shared sync/golden path and confirm flag-off parity.

**Files:**
- No source changes expected; this task is verification. If the golden test fails, fix the regression in the task that caused it.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS, including `tests/server-sync-golden.test.js` and the existing structure/scope/admin-console suites.

- [ ] **Step 2: Flag-off smoke check**

Run: `MULTI_TENANT= npm start` in one shell; in another confirm `POST /api/wards` returns `404`:

```bash
TOKEN=$(curl -s localhost:3000/api/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"'"$ORTHO_ADMIN_PASSWORD"'"}' | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))')
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/wards -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"unitId":"x","name":"W"}'
```

Expected: `404`. (Adjust port/password to your dev setup; the flag-off assertion is also covered by the automated test in Task 1, so this step is a belt-and-suspenders manual check.)

- [ ] **Step 3: Final commit (only if any fix was needed)**

```bash
git add -A
git commit -m "test: verify full suite + flag-off parity for inline ward creation"
```

---

## Self-Review

**Spec coverage:**
- Member-accessible `POST /api/wards`, scope-authorized, deduped, capped, flag-gated → Task 1.
- Type-to-create picker, live scope-tree injection, unchanged patient save → Task 2.
- Admin visibility (no work needed; wards are ordinary nodes) → confirmed in Task 2 Step 9.4 manual check.
- Flag-off parity + golden sync → Task 1 (automated) + Task 3.
- Out-of-scope items (nurse scoping, member-created units/depts, member ward edit) → not implemented, as specified.

**Placeholder scan:** No TBD/TODO; every code step shows real code and exact run/expect lines. The one conditional ("confirm `api()` throws on non-2xx") names the exact file:line to check and the fallback action.

**Type consistency:** `wardsForUnit` / `matchWardByName` / `injectWardIntoScopeTree` signatures are identical across the helper definitions (Task 2 Step 3), their tests (Step 1), and their callers (`populateWardSelect`, `updateWardCreateAffordance`, `createWardFromInput`). The route returns `{ id, unitId, name }` consistently on both the create and dedupe paths, matching what `injectWardIntoScopeTree` consumes (`ward.id`, `ward.name`). The hidden `#f_ward` id contract is preserved for both existing readers.
