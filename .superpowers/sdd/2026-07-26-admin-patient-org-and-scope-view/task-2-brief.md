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

