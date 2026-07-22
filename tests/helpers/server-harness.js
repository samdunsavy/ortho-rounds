import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../../storage.js';
import { hashPassword } from '../../auth.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'test-admin-pass';

async function waitForHealth(baseUrl, child, timeoutMs = 15000, stderrCapture = []){
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
  const stderrStr = stderrCapture.join('');
  const msg = `server did not become healthy: ${lastErr?.message}${stderrStr ? '\nstderr: ' + stderrStr : ''}`;
  throw new Error(msg);
}

/** Boot the real server on a temp SQLite dir. `seed(store)` runs before boot. */
export async function startServer({ multiTenant = false, seed = null } = {}){
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-it-'));
  if(seed){
    const store = await createStore({ dataDir });
    await store.init();
    try{
      await seed(store);
      // Server's bootstrapAdmin no-ops once any user exists, so seeded tests
      // must create the instance admin themselves to keep login(baseUrl) working.
      const existingAdmin = await store.getUserByUsername(ADMIN_USERNAME);
      if(!existingAdmin){
        await store.createUser({
          id: 'root-admin',
          username: ADMIN_USERNAME,
          passwordHash: hashPassword(ADMIN_PASSWORD, 'harness-salt'),
          passwordSalt: 'harness-salt',
          role: 'admin',
          orgId: null,
          wardId: null,
          active: true,
          tokenVersion: 0,
          createdAt: Date.now()
        });
      }
    }
    finally{ await store.close(); }
  }

  const env = {
    ...process.env,
    ORTHO_DATA_DIR: dataDir,
    ORTHO_ADMIN_USERNAME: ADMIN_USERNAME,
    ORTHO_ADMIN_PASSWORD: ADMIN_PASSWORD
  };
  delete env.ORTHO_FLAG_MULTI_TENANT;
  if(multiTenant) env.ORTHO_FLAG_MULTI_TENANT = '1';

  // Retry loop: up to 3 attempts with fresh random ports
  let lastErr = null;
  for(let attempt = 0; attempt < 3; attempt++){
    const port = 3100 + Math.floor(Math.random() * 2500);
    env.PORT = String(port);

    const stderrChunks = [];
    const child = spawn(process.execPath, ['server.js'], {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'ignore', 'pipe']
    });

    // Capture stderr (last ~4KB)
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk.toString());
      if(stderrChunks.join('').length > 4096){
        stderrChunks.shift(); // Keep only last ~4KB
      }
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    try{
      await waitForHealth(baseUrl, child, 15000, stderrChunks);
      // Success: return the server instance
      return {
        baseUrl,
        dataDir,
        async stop(){
          child.kill('SIGTERM');
          // Wait up to 2s for graceful exit
          await Promise.race([
            new Promise(r => child.once('exit', r)),
            new Promise(r => setTimeout(r, 2000))
          ]);
          // If still alive, escalate to SIGKILL
          if(child.exitCode === null){
            child.kill('SIGKILL');
            await new Promise(r => child.once('exit', r));
          }
          fs.rmSync(dataDir, { recursive: true, force: true });
        }
      };
    }catch(err){
      // Attempt failed: kill the child process and continue to next attempt
      lastErr = err;
      child.kill('SIGKILL');
      // Let child exit before retrying
      await new Promise(r => {
        child.once('exit', r);
        setTimeout(r, 500).unref?.();
      });
    }
  }

  // All attempts failed: cleanup and rethrow
  fs.rmSync(dataDir, { recursive: true, force: true });
  throw lastErr;
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
