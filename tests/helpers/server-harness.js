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
