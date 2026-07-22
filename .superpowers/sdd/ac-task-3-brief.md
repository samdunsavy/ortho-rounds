### Task 3: `admin.js` — pure tree/stats builders

**Files:**
- Create: `admin.js` (repo root, ESM)
- Test: `tests/admin.test.js`

**Interfaces:**
- Consumes: store CRUD (`listHospitalsByOrg`, `listWardsByHospital`, `listUsersByOrg`, `listOrganizations`, `getActive`).
- Produces (Task 4 relies on exact shapes):
  - `buildOrgTree(store, orgId) -> Promise<{totals, hospitals}>` where `totals = {hospitals, departments, usersActive, usersDisabled, livePatients}` and `hospitals = [{id, name, wards: [{id, name, specialty, stats: {livePatients, byStatus: {postop, preop, conservative, fordischarge}, users, lastActivity}}]}]`; `lastActivity` = max `updatedAt` among the department's live patients else `null`.
  - `buildOrgRollups(store) -> Promise<[{id, name, plan, createdAt, stats: {hospitals, departments, users, livePatients}}]>`.
  - Patients parse: rows from `getActive()` are `{id, updatedAt, deleted, data}` — parse `data` JSON for `wardId`/`status` (malformed JSON → skip row).

- [ ] **Step 1: Write the failing tests**

Create `tests/admin.test.js`:

```js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';
import { buildOrgTree, buildOrgRollups } from '../admin.js';

describe('admin tree/stats builders', () => {
  let dataDir, store;
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-admin-'));
    store = await createStore({ dataDir });
    await store.init();
    await store.createOrganization({ id: 'o1', name: 'Org One', plan: 'free' });
    await store.createOrganization({ id: 'o2', name: 'Org Two', plan: 'paid' });
    await store.createHospital({ id: 'h1', orgId: 'o1', name: 'City Hospital' });
    await store.createWard({ id: 'w1', hospitalId: 'h1', name: 'Ortho', specialty: 'ortho' });
    await store.createWard({ id: 'w2', hospitalId: 'h1', name: 'Surgery', specialty: 'surgery' });
    const mkUser = (id, orgId, wardId, role = 'member', active = true) => store.createUser({
      id, username: id, passwordHash: 'h', passwordSalt: 's', role, active,
      tokenVersion: 0, createdAt: Date.now(), orgId, wardId
    });
    await mkUser('u1', 'o1', 'w1');
    await mkUser('u2', 'o1', 'w1', 'member', false);
    await mkUser('u3', 'o1', null, 'admin');
    await mkUser('ux', 'o2', null, 'admin');
    const put = (id, wardId, status, updatedAt, deleted = 0) => store.upsertPatient(
      id, updatedAt, deleted, JSON.stringify({ id, wardId, status, updatedAt })
    );
    await put('p1', 'w1', 'postop', 1000);
    await put('p2', 'w1', 'postop', 3000);
    await put('p3', 'w1', 'preop', 2000);
    await put('p4', 'w2', 'conservative', 500);
    await put('p5', 'w1', 'postop', 4000, 1);          // deleted — excluded
    await put('p6', undefined, 'postop', 100);          // unassigned — org counts exclude it
    await put('p7', 'w1', 'weird-status', 50);          // counted live, no bucket
  });
  after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('buildOrgTree computes totals, per-department stats, lastActivity', async () => {
    const tree = await buildOrgTree(store, 'o1');
    assert.deepEqual(tree.totals, {
      hospitals: 1, departments: 2, usersActive: 2, usersDisabled: 1, livePatients: 5
    });
    const w1 = tree.hospitals[0].wards.find(w => w.id === 'w1');
    assert.deepEqual(w1.stats, {
      livePatients: 4,
      byStatus: { postop: 2, preop: 1, conservative: 0, fordischarge: 0 },
      users: 2,
      lastActivity: 3000
    });
    const w2 = tree.hospitals[0].wards.find(w => w.id === 'w2');
    assert.equal(w2.stats.livePatients, 1);
    assert.equal(w2.stats.lastActivity, 500);
    assert.equal(w2.stats.users, 0);
  });

  test('empty org tree is well-formed', async () => {
    await store.createOrganization({ id: 'o3', name: 'Empty', plan: 'free' });
    const tree = await buildOrgTree(store, 'o3');
    assert.deepEqual(tree.totals, { hospitals: 0, departments: 0, usersActive: 0, usersDisabled: 0, livePatients: 0 });
    assert.deepEqual(tree.hospitals, []);
  });

  test('buildOrgRollups summarizes every org', async () => {
    const rollups = await buildOrgRollups(store);
    const o1 = rollups.find(r => r.id === 'o1');
    assert.deepEqual(o1.stats, { hospitals: 1, departments: 2, users: 3, livePatients: 5 });
    assert.equal(o1.plan, 'free');
    const o2 = rollups.find(r => r.id === 'o2');
    assert.deepEqual(o2.stats, { hospitals: 0, departments: 0, users: 1, livePatients: 0 });
  });
});
```

Note on `usersDisabled`/`users` semantics: tree `totals.usersActive/usersDisabled` split by `active`; per-ward `stats.users` counts ALL users assigned to that ward (active or not — u1+u2 = 2); rollup `stats.users` counts all org users. `livePatients` (org totals and rollups) counts live patients in the org's wards ONLY (p6 unassigned is excluded; `w1:4 + w2:1 = 5`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/admin.test.js`
Expected: FAIL — `Cannot find module '../admin.js'`.

- [ ] **Step 3: Implement `admin.js`**

```js
/* Pure builders for the MULTI_TENANT admin console: org tree + stats.
   Stats are computed app-layer from getActive() + patient JSON (wardId,
   status) — same pattern as the sync scope filter; no schema changes.
   See docs/superpowers/specs/2026-07-22-admin-console-design.md. */

const STATUS_BUCKETS = ['postop', 'preop', 'conservative', 'fordischarge'];

function parseLivePatients(rows){
  const out = [];
  for(const row of rows){
    try{
      const obj = JSON.parse(row.data);
      out.push({ wardId: obj?.wardId, status: obj?.status, updatedAt: row.updatedAt });
    }catch{ /* malformed row — skip */ }
  }
  return out;
}

function emptyWardStats(){
  const byStatus = {};
  for(const s of STATUS_BUCKETS) byStatus[s] = 0;
  return { livePatients: 0, byStatus, users: 0, lastActivity: null };
}

export async function buildOrgTree(store, orgId){
  const hospitals = await store.listHospitalsByOrg(orgId);
  const users = await store.listUsersByOrg(orgId);
  const patients = parseLivePatients(await store.getActive());

  const outHospitals = [];
  const wardStats = new Map(); // wardId -> stats object (shared with output)
  for(const h of hospitals){
    const wards = await store.listWardsByHospital(h.id);
    outHospitals.push({
      id: h.id, name: h.name,
      wards: wards.map(w => {
        const stats = emptyWardStats();
        wardStats.set(w.id, stats);
        return { id: w.id, name: w.name, specialty: w.specialty, stats };
      })
    });
  }

  for(const u of users){
    const stats = u.wardId ? wardStats.get(u.wardId) : null;
    if(stats) stats.users++;
  }

  let livePatients = 0;
  for(const p of patients){
    const stats = p.wardId ? wardStats.get(p.wardId) : null;
    if(!stats) continue; // other orgs' wards or unassigned
    livePatients++;
    stats.livePatients++;
    if(STATUS_BUCKETS.includes(p.status)) stats.byStatus[p.status]++;
    if(stats.lastActivity === null || p.updatedAt > stats.lastActivity) stats.lastActivity = p.updatedAt;
  }

  let departments = 0;
  for(const h of outHospitals) departments += h.wards.length;

  return {
    totals: {
      hospitals: outHospitals.length,
      departments,
      usersActive: users.filter(u => !!u.active).length,
      usersDisabled: users.filter(u => !u.active).length,
      livePatients
    },
    hospitals: outHospitals
  };
}

export async function buildOrgRollups(store){
  const orgs = await store.listOrganizations();
  const out = [];
  for(const org of orgs){
    const tree = await buildOrgTree(store, org.id);
    out.push({
      id: org.id, name: org.name, plan: org.plan, createdAt: org.createdAt,
      stats: {
        hospitals: tree.totals.hospitals,
        departments: tree.totals.departments,
        users: tree.totals.usersActive + tree.totals.usersDisabled,
        livePatients: tree.totals.livePatients
      }
    });
  }
  return out;
}
```

Note: SQLite `active` column comes back as 0/1 — `!!u.active` / `!u.active` handles both backends.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/admin.test.js` → PASS.

- [ ] **Step 5: Full suite, commit**

```bash
git add admin.js tests/admin.test.js
git commit -m "feat: admin.js pure org tree + stats builders"
```

---

