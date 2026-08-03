/* Boots the REAL server as a child process, over real HTTP, with a real
   login — the layer the suite was missing.

   Every other frontend test stubs `fetch` and hands modules a jsdom
   document directly. That is fast and it caught a lot, but it structurally
   cannot see three whole classes of defect, each of which shipped:

     1. URL resolution. /v2 served public/v2/index.html at the URL /v2,
        leaving the browser's base one level too high, so `css/tokens.css`
        resolved to /css/tokens.css (404) and `app.js` to /app.js — the
        MAIN app's script. Nothing in a stubbed test ever resolves a URL.
     2. Authentication. v2 sent `credentials: 'same-origin'` while this app
        authenticates with `Authorization: Bearer <token>` from
        localStorage. Every request 401'd. No test ever authenticated.
     3. Boot. app.js only DEFINED things; nothing called render(). The
        suite passed because the harness called render() itself — it was
        performing the app's boot.

   Cost is ~400ms for the whole file, measured, so this is CI-cheap. */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PASSWORD = 'test-password-1234';

async function waitForReady(base, ms = 15000){
  const deadline = Date.now() + ms;
  while(Date.now() < deadline){
    try{
      const r = await fetch(base + '/api/health');
      if(r.ok) return true;
    }catch{ /* not up yet */ }
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

/** Start a real server on an unused port with a throwaway database.
 *  Returns { base, token, seed, request, stop }. */
export async function startServer(){
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ortho-v2-http-'));
  let child, base;

  for(let attempt = 0; attempt < 8; attempt++){
    const port = 20000 + Math.floor(Math.random() * 20000);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['--no-warnings', 'server.js'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env,
        PORT: String(port),
        ORTHO_DATA_DIR: dataDir,
        ORTHO_ADMIN_USERNAME: 'admin',
        ORTHO_ADMIN_PASSWORD: PASSWORD,
        MONGODB_URI: '' }
    });
    if(await waitForReady(base)) break;
    child.kill('SIGKILL');
    child = null;
  }
  if(!child) throw new Error('server did not become ready on any port');

  const login = await (await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: PASSWORD })
  })).json();
  if(!login.token) throw new Error('login did not return a token: ' + JSON.stringify(login));

  /** Write patient records through the real sync endpoint. */
  async function seed(patients){
    const now = Date.now();
    const res = await fetch(base + '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token },
      body: JSON.stringify({ since: 0, changes: patients.map(p => ({ updatedAt: now, ...p })) })
    });
    if(!res.ok) throw new Error('seed failed: ' + res.status);
    return res.json();
  }

  const request = (p, init) => fetch(base + p, init);

  function stop(){
    try{ child.kill('SIGKILL'); }catch{}
    try{ rmSync(dataDir, { recursive: true, force: true }); }catch{}
  }

  return { base, token: login.token, seed, request, stop };
}

/** A realistic patient record, shaped like what the app actually stores. */
export const patient = (n, over = {}) => ({
  id: 'http-p' + n,
  bed: String(n).padStart(2, '0'),
  name: 'Patient ' + n,
  age: '62', sex: 'M',
  diagnosis: 'Diagnosis ' + n,
  status: 'postop',
  surgeryDate: '2026-07-29',
  admissionDate: '2026-07-27',
  postOpChecks: [{ id: 'c1', label: 'Suture removal', duePod: 12, status: 'pending' }],
  dischargeChecks: [{ id: 'd1', label: 'Discharge summary', status: 'pending' }],
  planHistory: [{ date: '2026-08-01', text: 'prior plan' }],
  labs: { Hb: '11.2' },
  images: [],
  ...over
});
