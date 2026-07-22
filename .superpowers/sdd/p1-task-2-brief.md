### Task 2: Integration harness + flag-off golden-response test

**Files:**
- Create: `tests/helpers/server-harness.js`
- Test: `tests/server-sync-golden.test.js`

**Interfaces:**
- Produces: `startServer({ multiTenant = false, seed = null }) -> Promise<{ baseUrl, dataDir, stop() }>`; `seed(store)` runs against the temp SQLite dir BEFORE the server boots (this is how tests create orgs/wards/users — there is no runtime assignment endpoint in this pass). Admin credentials are always `admin` / `test-admin-pass`. Helper `login(baseUrl, username, password) -> Promise<responseJson>` and `syncPost(baseUrl, token, body) -> Promise<{status, json}>`.
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the harness**

Create `tests/helpers/server-harness.js`:

```js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../../storage.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'test-admin-pass';

async function waitForHealth(baseUrl, child, timeoutMs = 15000){
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while(Date.now() < deadline){
    if(child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode})`);
    try{
      const res = await fetch(`${baseUrl}/api/health`);
      if(res.ok) return;
    }catch(err){ lastErr = err; }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`server did not become healthy: ${lastErr?.message}`);
}

/** Boot the real server on a temp SQLite dir. `seed(store)` runs before boot. */
export async function startServer({ multiTenant = false, seed = null } = {}){
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-it-'));
  if(seed){
    const store = await createStore({ dataDir });
    await store.init();
    try{ await seed(store); }
    finally{ await store.close(); }
  }
  const port = 3100 + Math.floor(Math.random() * 2500);
  const env = {
    ...process.env,
    PORT: String(port),
    ORTHO_DATA_DIR: dataDir,
    ORTHO_ADMIN_USERNAME: ADMIN_USERNAME,
    ORTHO_ADMIN_PASSWORD: ADMIN_PASSWORD
  };
  delete env.ORTHO_FLAG_MULTI_TENANT;
  if(multiTenant) env.ORTHO_FLAG_MULTI_TENANT = '1';
  const child = spawn(process.execPath, ['server.js'], { cwd: REPO_ROOT, env, stdio: 'ignore' });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);
  return {
    baseUrl,
    dataDir,
    async stop(){
      child.kill('SIGTERM');
      await new Promise(r => { child.once('exit', r); setTimeout(r, 2000).unref?.(); });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

export async function login(baseUrl, username = ADMIN_USERNAME, password = ADMIN_PASSWORD){
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return { status: res.status, json: await res.json() };
}

export async function syncPost(baseUrl, token, body){
  const res = await fetch(`${baseUrl}/api/sync/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}
```

- [ ] **Step 2: Write the golden-response test**

Create `tests/server-sync-golden.test.js`:

```js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, syncPost } from './helpers/server-harness.js';

/* Golden-response regression guard for the flag-OFF sync contract.
   Any accidental behavior drift in the /api/sync handler while wiring
   MULTI_TENANT scoping must fail here. */
describe('flag OFF — /api/sync golden response', () => {
  let srv, token;
  before(async () => {
    srv = await startServer({ multiTenant: false });
    const l = await login(srv.baseUrl);
    assert.equal(l.status, 200);
    token = l.json.token;
  });
  after(async () => { await srv.stop(); });

  test('push + pull round-trips a patient with the exact contract shape', async () => {
    const patient = {
      id: 'golden-p1', name: 'Golden Patient', diagnosis: 'Right femur shaft fracture',
      status: 'postop', unit: 'ortho unit - IV', ward: 'W-3', updatedAt: Date.now()
    };
    const push = await syncPost(srv.baseUrl, token, { since: 0, changes: [patient] });
    assert.equal(push.status, 200);
    assert.deepEqual(Object.keys(push.json).sort(), ['apiVersion', 'patients', 'serverTime']);
    assert.equal(push.json.apiVersion, 1);
    assert.equal(typeof push.json.serverTime, 'number');

    const pull = await syncPost(srv.baseUrl, token, { since: 0, changes: [] });
    assert.equal(pull.status, 200);
    const got = pull.json.patients.find(p => p.id === 'golden-p1');
    assert.ok(got, 'pushed patient must come back');
    assert.equal(got.name, 'Golden Patient');
    assert.equal(got.diagnosis, 'Right femur shaft fracture');
    assert.equal(got.unit, 'ortho unit - IV');
    assert.equal(got.ward, 'W-3');
    assert.equal(got.deleted, false);
    assert.equal(typeof got.updatedAt, 'number');
    // No scoping field is invented flag-off: the server must not add wardId.
    assert.equal('wardId' in got, false);
  });

  test('every user sees every patient (flat instance)', async () => {
    const pull = await syncPost(srv.baseUrl, token, { since: 0, changes: [] });
    assert.ok(pull.json.patients.some(p => p.id === 'golden-p1'));
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npm test -- tests/server-sync-golden.test.js`
Expected: PASS against the CURRENT server (this is the point — it locks today's behavior BEFORE any server.js edits; the harness and golden test must be green pre-wiring). If it fails, fix the harness, not the server.

- [ ] **Step 4: Run full suite, then commit**

Run: `npm test` — all pass.

```bash
git add tests/helpers/server-harness.js tests/server-sync-golden.test.js
git commit -m "test: integration harness + flag-off golden sync contract"
```

---

