# Patient Move — Permission, Org Clamp & Audit Implementation Plan (Spec A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone move a patient among units already in their scope (no admin gate, no new role), block cross-org moves for everyone, record an unforgeable server-owned move audit, and surface the bulk move as a discoverable "Organize" action.

**Architecture:** One pure change to `scope.js` `decideWrite` (scope-and-org test replaces the admin gate, returns a `moved` marker); the sync handler in `server.js` writes an append-only, server-owned `moveHistory` from that marker; `merge.js` unions it; and `public/app.js` re-gates the existing bulk-move button to "can move" and adds an Organize entry plus a unit filter.

**Tech Stack:** Node 22 (`node:sqlite`, global `fetch`), `node --test`, jsdom frontend harness (`tests/helpers/frontend-env.js`), integration harness (`tests/helpers/server-harness.js`). Vanilla ES modules.

**Spec:** `docs/superpowers/specs/2026-07-26-patient-move-permissions-and-audit-design.md`

## Global Constraints

- All behavior gated by `MULTI_TENANT` (`isEnabled('MULTI_TENANT')` server; `scopePickerActive()` client). Flag off: member `unitId` ignored, admin reassigns, no `moveHistory` — byte-identical to today; flag-off `/api/sync` golden contract (keys exactly `serverTime`/`patients`/`apiVersion`) unchanged.
- A move is allowed only when the requested unit is in the actor's (effective) scope AND in the **same organization** as the patient's current org. First placement of an unassigned patient (`existing.orgId` falsy) is allowed. The rule can never widen scope.
- `moveHistory` is server-owned: the handler rebuilds it from stored truth plus at most one new entry and discards any client-supplied `moveHistory`. Entry shape: `{ from, to, fromLabel, toLabel, by, at }`; `by` = authenticated `actor.username`; `at` = server `now`.
- The bulk "Move to unit" button and the unit filter are shown when `scopePickerActive()` and the actor's scope spans **2+ units** — matching the server rule — not gated on `isAdmin()`.
- Tests: `npm test` (node --test). Frontend tests drive `window.*` in jsdom; expose `let` globals via `Object.defineProperty` in a test `initScript` (see `tests/frontend-unit-picker.test.js`).
- Git quirk: the mount blocks file unlink; a stale `.git/index.lock`/`HEAD.lock` can't be `rm`'d — rename it aside (`mv .git/index.lock .git/index.lock.stale.$(date +%s)`) before each git write.

---

### Task 1: Scope-derived move + org clamp in `decideWrite` (pure)

**Files:**
- Modify: `scope.js` — `decideWrite` existing-patient branch (`scope.js:42-52`)
- Test: `tests/scope.test.js`

**Interfaces:**
- Consumes: `resolveAncestry(store, unitId)` (from `hierarchy.js`) → `{ unitId, departmentId, hospitalId, orgId } | null`; `canRead(patient, scope)`; Scope `{ unrestricted, unitIds: Set, includeUnassigned }`.
- Produces: `decideWrite(...)` existing-patient result now additionally returns `moved: { from, to }` when (and only when) a real reassignment is accepted; unchanged shape `{ allow, ancestry }` otherwise.

- [ ] **Step 1: Write the failing tests**

Append to `tests/scope.test.js` (it already has a store-backed `describe('decideWrite', ...)` with a real SQLite store; add a new describe reusing the same harness pattern — a store with two orgs so the clamp is testable):

```js
describe('decideWrite — scope-derived move + org clamp', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-move-'));
    store = await createStore({ dataDir });
    await store.init();
    // org1: dep1 -> unitA, unitB ; org2: depX -> unitX
    await store.createOrganization({ id: 'org1', name: 'O1', plan: 'free' });
    await store.createOrganization({ id: 'org2', name: 'O2', plan: 'free' });
    await store.createHospital({ id: 'h1', orgId: 'org1', name: 'H1' });
    await store.createHospital({ id: 'hx', orgId: 'org2', name: 'HX' });
    await store.createDepartment({ id: 'dep1', hospitalId: 'h1', name: 'D1' });
    await store.createDepartment({ id: 'depx', hospitalId: 'hx', name: 'DX' });
    await store.createUnit({ id: 'unitA', departmentId: 'dep1', name: 'A' });
    await store.createUnit({ id: 'unitB', departmentId: 'dep1', name: 'B' });
    await store.createUnit({ id: 'unitX', departmentId: 'depx', name: 'X' });
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const deptMember = { id: 'u', username: 'pg', role: 'member', orgId: 'org1' };
  const deptScope = { unrestricted: false, unitIds: new Set(['unitA', 'unitB']), includeUnassigned: false };
  const unitScope = { unrestricted: false, unitIds: new Set(['unitA']), includeUnassigned: false };
  const rootScope = { unrestricted: true, unitIds: new Set(), includeUnassigned: true };

  test('a department-scoped member moves a patient between two in-scope units', async () => {
    const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitB' }, existing: { id: 'p', unitId: 'unitA', orgId: 'org1' }, actor: deptMember, scope: deptScope, store });
    assert.equal(d.allow, true);
    assert.equal(d.ancestry.unitId, 'unitB');
    assert.deepEqual(d.moved, { from: 'unitA', to: 'unitB' });
  });

  test('a unit-pinned member cannot move a patient out (requested unit not in scope → force-stamp, no moved)', async () => {
    const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitB' }, existing: { id: 'p', unitId: 'unitA', orgId: 'org1' }, actor: deptMember, scope: unitScope, store });
    assert.equal(d.allow, true);
    assert.equal(d.ancestry.unitId, 'unitA');
    assert.equal(d.moved, undefined);
  });

  test('org clamp: even an unrestricted scope cannot move a patient into another org', async () => {
    const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitX' }, existing: { id: 'p', unitId: 'unitA', orgId: 'org1' }, actor: { role: 'admin', orgId: null }, scope: rootScope, store });
    assert.equal(d.allow, true);
    assert.equal(d.ancestry.unitId, 'unitA', 'target org2 unit ignored; stays put');
    assert.equal(d.moved, undefined);
  });

  test('same-org move under an unrestricted scope is allowed and recorded', async () => {
    const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitB' }, existing: { id: 'p', unitId: 'unitA', orgId: 'org1' }, actor: { role: 'admin', orgId: null }, scope: rootScope, store });
    assert.deepEqual(d.moved, { from: 'unitA', to: 'unitB' });
  });

  test('first placement of an unassigned patient (no orgId) is allowed', async () => {
    const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitA' }, existing: { id: 'p', unitId: null }, actor: { role: 'admin', orgId: null }, scope: rootScope, store });
    assert.equal(d.allow, true);
    assert.equal(d.ancestry.unitId, 'unitA');
    assert.deepEqual(d.moved, { from: null, to: 'unitA' });
  });

  test('re-sending the same unitId is not a move (no moved marker)', async () => {
    const d = await decideWrite({ incoming: { id: 'p', unitId: 'unitA' }, existing: { id: 'p', unitId: 'unitA', orgId: 'org1' }, actor: deptMember, scope: deptScope, store });
    assert.equal(d.moved, undefined);
  });
});
```

Ensure the file's imports include `fs`, `os`, `path`, `createStore`, and `decideWrite` (the existing `decideWrite` describe already imports them; reuse).

- [ ] **Step 2: Run to verify failure**

Run: `node --no-warnings --test tests/scope.test.js`
Expected: FAIL — non-admin move currently force-stamps (no `moved`); org clamp not enforced.

- [ ] **Step 3: Implement — replace the existing-patient branch in `decideWrite`**

In `scope.js`, replace lines 42-52 (the `if(existing){ ... }` block) with:

```js
  if(existing){
    if(!canRead(existing, scope)) return { allow: false };
    const requested = incoming?.unitId;
    if(requested && requested !== existing.unitId
       && (scope.unrestricted || scope.unitIds.has(requested))){
      const target = await resolveAncestry(store, requested);
      // Org clamp: a move never crosses organizations. First placement of a
      // patient with no org yet is allowed (placement, not a cross-org move).
      const sameOrgOrUnassigned = !existing.orgId || (target && target.orgId === existing.orgId);
      if(target && sameOrgOrUnassigned){
        return { allow: true, ancestry: target, moved: { from: existing.unitId || null, to: requested } };
      }
    }
    // Not a legitimate re-assignment (out of scope, or would cross orgs):
    // force-stamp ancestry from server truth so a client-supplied unitId can
    // never relabel the patient's tree position.
    return { allow: true, ancestry: await resolveAncestry(store, existing.unitId) };
  }
```

(The `isAdmin` local is still used by the new-patient branch below — leave it.)

- [ ] **Step 4: Run to verify pass**

Run: `node --no-warnings --test tests/scope.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scope.js tests/scope.test.js
git commit -m "feat: scope-derived patient move + org clamp in decideWrite"
```

---

### Task 2: Server-owned `moveHistory` audit (sync handler + merge)

**Files:**
- Modify: `server.js` — sync handler, inside the write block (after the ward-validation block at `server.js:844-849`, before `stored.updatedAt = now` at `server.js:850`)
- Modify: `merge.js` — add `mergeMoveHistory`, call it in `mergePatientRecords`
- Test: `tests/server-scoping.test.js` (integration), `tests/merge.test.js` (merge)

**Interfaces:**
- Consumes: `decision.moved = { from, to }` from Task 1; `existingObj` (parsed stored patient, has `.unit` = old unit name and `.moveHistory`); `stored.unit` (new unit name, already set); `actor.username`; `now`.
- Produces: `mergeMoveHistory(localHist, remoteHist) -> Array` (union deduped by `${at}|${from}|${to}`, sorted by `at`).

- [ ] **Step 1: Write the failing merge test**

Append to `tests/merge.test.js`:

```js
import { mergeMoveHistory } from '../merge.js';

describe('mergeMoveHistory', () => {
  test('unions by signature, dedupes, sorts by at', () => {
    const a = [{ at: 2, from: 'u1', to: 'u2', by: 'x' }, { at: 1, from: 'u0', to: 'u1', by: 'y' }];
    const b = [{ at: 2, from: 'u1', to: 'u2', by: 'x' }, { at: 3, from: 'u2', to: 'u3', by: 'z' }];
    const m = mergeMoveHistory(a, b);
    assert.deepEqual(m.map(h => h.at), [1, 2, 3]);
    assert.equal(m.length, 3);
  });
  test('missing sides are treated as empty', () => {
    assert.deepEqual(mergeMoveHistory(null, undefined), []);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --no-warnings --test tests/merge.test.js`
Expected: FAIL — `mergeMoveHistory` not exported.

- [ ] **Step 3: Implement `mergeMoveHistory` and wire it in**

In `merge.js`, add near `mergePlanHistory`:

```js
export function mergeMoveHistory(localHist, remoteHist){
  const bySig = new Map();
  const key = h => `${h.at}|${h.from}|${h.to}`;
  for(const h of (remoteHist || [])){ if(h) bySig.set(key(h), h); }
  for(const h of (localHist || [])){ if(h) bySig.set(key(h), h); }
  return [...bySig.values()].sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
}
```

In `mergePatientRecords`, alongside the existing `merged.planHistory = mergePlanHistory(...)` line, add:

```js
  merged.moveHistory = mergeMoveHistory(local.moveHistory, remote.moveHistory);
```

- [ ] **Step 4: Run merge test to verify pass**

Run: `node --no-warnings --test tests/merge.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing integration tests**

Append to the `MULTI_TENANT sync scoping (unit-based)` describe in `tests/server-scoping.test.js`. Seed note: that suite has `pg1@unit1`, `boss1` org-admin, `root` instance-admin, `pat-w1@unit1`, and (after an earlier test) `pat-w2@unit1`; org2 has `pat-wx@unitx`. Add a department-scoped member and a second unit for the move target — extend the existing seed by adding, in the `before` seed function, a department-assigned member `dlead` and confirming `unit1`/`unit1b` exist. If the suite's seed lacks a second unit under dep1, add these seeded tests to the `GET /api/me/scope` suite instead, which already seeds `unit1` and `unit1b` under `dep1`. Use whichever suite has two units under one department; here we target that two-unit department and a member assigned at `dep1`:

```js
  test('a department-assigned member moves a patient between the department\'s units and it persists + audits', async () => {
    // dlead is assigned at dep1 (covers unit1 + unit1b). Create a patient in unit1, move to unit1b.
    await syncPost(srv.baseUrl, tokens.dlead, { since: 0, changes: [{ id: 'mv1', name: 'Mover', unitId: 'unit1', updatedAt: Date.now() }] });
    await syncPost(srv.baseUrl, tokens.dlead, { since: 0, changes: [{ id: 'mv1', name: 'Mover', unitId: 'unit1b', updatedAt: Date.now() + 5 }] });
    const pull = await syncPost(srv.baseUrl, tokens.dlead, { since: 0, changes: [] });
    const p = pull.json.patients.find(x => x.id === 'mv1');
    assert.equal(p.unitId, 'unit1b');
    assert.equal(Array.isArray(p.moveHistory), true);
    const last = p.moveHistory[p.moveHistory.length - 1];
    assert.equal(last.to, 'unit1b');
    assert.equal(last.by, 'dlead', 'by is the authenticated actor, server-stamped');
  });

  test('a client cannot forge moveHistory — server discards client-supplied entries', async () => {
    await syncPost(srv.baseUrl, tokens.dlead, {
      since: 0,
      changes: [{ id: 'mv1', name: 'Mover', unitId: 'unit1b', updatedAt: Date.now() + 10,
        moveHistory: [{ from: 'x', to: 'y', by: 'HACKER', at: 1 }] }]
    });
    const pull = await syncPost(srv.baseUrl, tokens.dlead, { since: 0, changes: [] });
    const p = pull.json.patients.find(x => x.id === 'mv1');
    assert.equal(p.moveHistory.some(h => h.by === 'HACKER'), false, 'forged entry rejected');
  });
```

Add `dlead` to the suite's seed and tokens: in the `seed` function add `await seedUser(store, { id: 'ud', username: 'dlead', orgId: 'org1', assignment: { type: 'department', id: 'dep1' } });` and in `tokens` add `dlead: await tok(srv.baseUrl, 'dlead', 'pw-dlead')`. (Use the suite that has `dep1` with two units; if the primary scoping suite's `dep1` has only `unit1`, add a `unit1b` to its seed as well.)

- [ ] **Step 6: Run to verify failure**

Run: `node --no-warnings --test tests/server-scoping.test.js`
Expected: FAIL — `moveHistory` is absent (server doesn't stamp it yet).

- [ ] **Step 7: Implement the audit stamp in the sync handler**

In `server.js`, inside `if(!existing || incomingUpdated >= existing.updatedAt){ ... }`, after the ward-validation block (`server.js:844-849`) and before `stored.updatedAt = now;`, add:

```js
          if(scope){
            // moveHistory is server-owned: rebuild from stored truth and append
            // at most one entry; never trust client-supplied history.
            const prior = (existingObj && Array.isArray(existingObj.moveHistory)) ? existingObj.moveHistory : [];
            if(decision && decision.moved){
              stored.moveHistory = prior.concat([{
                from: decision.moved.from,
                to: decision.moved.to,
                fromLabel: (existingObj && existingObj.unit) || null,
                toLabel: stored.unit || null,
                by: actor.username,
                at: now
              }]);
            } else {
              stored.moveHistory = prior;
            }
          }
```

- [ ] **Step 8: Run to verify pass**

Run: `node --no-warnings --test tests/server-scoping.test.js tests/merge.test.js tests/server-sync-golden.test.js`
Expected: PASS (golden flag-off unaffected — `scope` is null, no `moveHistory` written).

- [ ] **Step 9: Run full suite, then commit**

Run: `npm test` — all pass.

```bash
git add server.js merge.js tests/server-scoping.test.js tests/merge.test.js
git commit -m "feat: server-owned append-only moveHistory audit on unit reassignment"
```

---

### Task 3: Organize surface — capability gate, Organize entry, unit filter (frontend)

**Files:**
- Modify: `public/app.js` — add `moveCapableFromTree`, `filterByUnit`, `refreshMoveCapability`, `currentUnitFilter`; re-gate `updateBulkBar` (`public/app.js:8434`); add unit-filter application in `getFilteredRoundsItems` (`public/app.js:3349`); add `organize` case to the more-action handler (`public/app.js:4261`)
- Modify: `public/index.html` — a `<select id="unitFilter" hidden>` in the search row; a `<button data-more-action="organize">` in the More sheet
- Test: `tests/frontend-organize.test.js`

**Interfaces:**
- Consumes: `loadScopeTree()`, `flatUnitsFromScopeTree(tree)` (both exist), `scopePickerActive()`, `toggleBulkSelectMode()`, `renderRounds()`/`renderAll()`, `showToast()`, `escapeHTML()`.
- Produces: `moveCapableFromTree(tree) -> boolean` (2+ units); `filterByUnit(items, unitFilter) -> Array` (`''` = all, `'__unsorted__'` = no unitId, else exact unitId); `refreshMoveCapability() -> Promise<void>` (sets `canMovePatients`, refreshes bar + filter visibility); module globals `canMovePatients: boolean`, `currentUnitFilter: string`.

- [ ] **Step 1: Write the failing pure tests**

Create `tests/frontend-organize.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

describe('moveCapableFromTree', () => {
  test('true only when 2+ units are in scope', () => {
    const { window } = loadFrontendEnv();
    const one = { departments: [{ id: 'd', name: 'D', units: [{ id: 'u1', name: 'A', wards: [] }] }] };
    const two = { departments: [{ id: 'd', name: 'D', units: [{ id: 'u1', name: 'A', wards: [] }, { id: 'u2', name: 'B', wards: [] }] }] };
    assert.equal(window.moveCapableFromTree(one), false);
    assert.equal(window.moveCapableFromTree(two), true);
    assert.equal(window.moveCapableFromTree(null), false);
  });
});

describe('filterByUnit', () => {
  test('empty = all; a unit id = exact match; __unsorted__ = no unitId', () => {
    const { window } = loadFrontendEnv();
    const items = [{ id: 'a', unitId: 'u1' }, { id: 'b', unitId: 'u2' }, { id: 'c' }];
    assert.deepEqual(window.filterByUnit(items, '').map(p => p.id), ['a', 'b', 'c']);
    assert.deepEqual(window.filterByUnit(items, 'u1').map(p => p.id), ['a']);
    assert.deepEqual(window.filterByUnit(items, '__unsorted__').map(p => p.id), ['c']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --no-warnings --test tests/frontend-organize.test.js`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement the pure helpers + capability state in `public/app.js`**

Near `flatUnitsFromScopeTree` (added in the earlier feature, ~`public/app.js:6149`):

```js
function moveCapableFromTree(tree){
  return flatUnitsFromScopeTree(tree).length >= 2;
}
function filterByUnit(items, unitFilter){
  if(!unitFilter) return items;
  if(unitFilter === '__unsorted__') return items.filter(p => !p.unitId);
  return items.filter(p => p.unitId === unitFilter);
}
let canMovePatients = false;
let currentUnitFilter = '';
async function refreshMoveCapability(){
  if(!scopePickerActive()){ canMovePatients = false; }
  else {
    const { tree } = await loadScopeTree();
    canMovePatients = moveCapableFromTree(tree);
    renderUnitFilter(tree);
  }
  updateBulkBar();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --no-warnings --test tests/frontend-organize.test.js`
Expected: PASS.

- [ ] **Step 5: Re-gate the bulk button and apply the unit filter**

In `updateBulkBar()` (`public/app.js:8434`), replace the move-button gate line with:

```js
  const moveBtn = document.getElementById('bulkBarMoveBtn');
  if(moveBtn) moveBtn.hidden = !canMovePatients;
```

In `getFilteredRoundsItems()` (`public/app.js:3351`), immediately after `let items = patients.filter(p=>p.status!=='discharged');` add:

```js
  items = filterByUnit(items, currentUnitFilter);
```

- [ ] **Step 6: Add the unit-filter select, its renderer, the Organize entry, and wiring**

In `public/index.html` search row (near `#scopeSelect`, `public/index.html:1788`):

```html
<select id="unitFilter" class="scope-select" hidden aria-label="Filter by unit"></select>
```

In the More sheet action list (near the other `data-more-action` buttons, e.g. after the bulk one at `public/index.html:1906`):

```html
<button type="button" class="sheet-action-btn" data-more-action="organize"><span class="sa-icon"><svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg></span> Organize patients</button>
```

In `public/app.js`, add the renderer next to `renderScopeSelector`:

```js
function renderUnitFilter(tree){
  const el = document.getElementById('unitFilter');
  if(!el) return;
  if(!canMovePatients){ el.hidden = true; return; }
  el.hidden = false;
  const units = flatUnitsFromScopeTree(tree);
  const opts = ['<option value="">All units</option>', '<option value="__unsorted__">Unsorted (General)</option>']
    .concat(units.map(u => `<option value="${escapeHTML(u.id)}">${escapeHTML(u.name)}</option>`));
  el.innerHTML = opts.join('');
  el.value = currentUnitFilter;
  el.onchange = () => { currentUnitFilter = el.value || ''; renderRounds(); };
}
```

Add the `organize` case to the more-action handler (`public/app.js:4261`, alongside the other `else if`):

```js
      else if(a === 'organize'){ if(!bulkSelectMode) toggleBulkSelectMode(); showToast('Select patients, then tap Move to unit'); }
```

Call `void refreshMoveCapability();` where the app renders the scope selector — next to the existing `void renderScopeSelector();` calls (post-login and startup, inside `refreshServerFlags`).

- [ ] **Step 7: Run the full suite, then commit**

Run: `npm test` — all pass (pure helpers covered; wiring is inert until an admin/lead uses it; flag-off untouched).

```bash
git add public/app.js public/index.html tests/frontend-organize.test.js
git commit -m "feat: Organize surface — move-capability gate, Organize entry, unit filter"
```

---

## Self-review notes (author)

- Spec coverage: §1 permission + org clamp → Task 1; §2 audit (`moveHistory` server-owned + merge) → Task 2; §3 move UX (gate, Organize, unit filter) → Task 3. One-off placement needs no code (the edit-modal picker already sends `unitId`; Task 1 makes the server accept it for dept-scoped users) — called out in the spec, no task required.
- Type consistency: `decision.moved = { from, to }` produced in Task 1, consumed in Task 2; `moveHistory` entry shape identical in Task 2 stamp and `mergeMoveHistory`; `canMovePatients`/`currentUnitFilter`/`filterByUnit`/`moveCapableFromTree` consistent across Task 3.
- Seed caveat (Task 2): the move integration tests need a department with 2+ units and a department-assigned member — the plan directs the implementer to the two-unit department in the scoping suite (or to add `unit1b`), because a single-unit department can't demonstrate a move.

## Out of scope (this plan)

Admin-console patient view + multi-level search (Spec B — separate plan). A named `lead` role. Cross-org re-home. Any change to `activeScope` viewing or new-patient creation.
