/* ============================================================
   ORTHO ROUNDS — self-hosted LAN server
   ------------------------------------------------------------
   - Stores patient data via a pluggable storage backend (see storage.js):
       * SQLite (default): single local file data/ortho.db, zero external
         dependencies, data never leaves the machine.
       * MongoDB (optional): set MONGODB_URI to persist patients, X-rays and
         auth config in a managed database that survives redeploys.
   - Frontend (public/) is an offline-capable client that syncs here.

   Run:   node server.js
   Then open the printed http://<your-ip>:<port> URL on any device
   on the same network.

   Accounts:
   - Each person logs in with their own username + password (see auth.js).
   - On first run (no users yet), one admin account is created automatically.
     Set its credentials with ORTHO_ADMIN_USERNAME / ORTHO_ADMIN_PASSWORD, or
     leave ORTHO_ADMIN_PASSWORD unset to have one generated and printed once.
   - The admin can add/disable other users and reset passwords from the
     in-app Account panel — no server access needed after the first run.
   - Change the port with PORT=4000 node server.js (default 3000).
   - Use MongoDB with MONGODB_URI="mongodb+srv://..." node server.js
   - Relocate the SQLite data directory with ORTHO_DATA_DIR=/path node server.js
   ============================================================ */

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createStore } from './storage.js';
import {
  isAiEnabled,
  getAiConfig,
  checkRateLimit,
  draftPlan,
  polishPresentation,
  handoverSummary,
  dischargeSummary,
  wardBrief,
  parseAdmission,
  scribeRoundNote
} from './ai.js';
import {
  hashPassword,
  verifyPasswordHash,
  generateReadablePassword,
  signToken,
  verifyToken,
  checkLoginRateLimit,
  bootstrapAdmin
} from './auth.js';
import { mergePatientRecords, stampAttribution } from './merge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
// SQLite data directory. MUST be on a persistent disk, or use the MongoDB
// backend (MONGODB_URI) so patients survive redeploys.
const DATA_DIR = process.env.ORTHO_DATA_DIR
  ? path.resolve(process.env.ORTHO_DATA_DIR)
  : path.join(__dirname, 'data');
const MONGODB_URI = process.env.MONGODB_URI || '';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY_BYTES = 64 * 1024 * 1024; // 64MB — patients can carry base64 X-rays

/* ---------------- config secret (token signing only) ---------------- */

async function setupConfig(store){
  const config = await store.loadRawConfig();
  if(!config.tokenSecret){
    config.tokenSecret = crypto.randomBytes(32).toString('hex');
    await store.saveRawConfig(config);
  }
  return config;
}

function getClientIp(req){
  const fwd = req.headers['x-forwarded-for'];
  if(fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/* ---------------- patient records ---------------- */

function rowToPatient(row){
  let obj;
  try{ obj = JSON.parse(row.data); }
  catch{ obj = {}; }
  obj.id = row.id;
  obj.updatedAt = row.updatedAt;
  obj.deleted = !!row.deleted;
  return obj;
}

async function saveImageFromDataUrl(dataURL){
  const m = String(dataURL).match(/^data:(image\/\w+);base64,(.+)$/);
  if(!m) throw Object.assign(new Error('Invalid image data'), { statusCode: 400 });
  const ext = m[1].includes('png') ? '.png' : m[1].includes('webp') ? '.webp' : '.jpg';
  return await store.saveImage(Buffer.from(m[2], 'base64'), ext);
}

/* ---------------- http helpers ---------------- */

function sendJSON(res, status, payload){
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req){
  return new Promise((resolve, reject)=>{
    let size = 0;
    const chunks = [];
    req.on('data', (chunk)=>{
      size += chunk.length;
      if(size > MAX_BODY_BYTES){
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', ()=>{
      if(!chunks.length) return resolve(null);
      try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch{ reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function getBearerToken(req){
  const h = req.headers['authorization'] || '';
  if(h.startsWith('Bearer ')) return h.slice(7);
  // Fallback: token in query string. Browsers can't attach an Authorization
  // header to plain <img>/<a> requests, so server-hosted X-ray images are
  // fetched as /api/images/<id>.jpg?token=<token>.
  const qIdx = req.url.indexOf('?');
  if(qIdx >= 0){
    const params = new URLSearchParams(req.url.slice(qIdx + 1));
    const t = params.get('token');
    if(t) return t;
  }
  return null;
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function serveStatic(req, res){
  let urlPath = decodeURIComponent((req.url.split('?')[0]) || '/');
  if(urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if(!filePath.startsWith(PUBLIC_DIR)){
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if(!existsSync(filePath) || !statSync(filePath).isFile()){
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  createReadStream(filePath).pipe(res);
}

/* ---------------- API routes ---------------- */

async function handleApi(req, res, pathname){
  // Public endpoints (no auth)
  if(pathname === '/api/health' && req.method === 'GET'){
    // `storage` lets you confirm at a glance whether a deployment is actually
    // using MongoDB ("mongo") or the ephemeral local file ("sqlite").
    return sendJSON(res, 200, {
      ok: true,
      app: 'ortho-rounds',
      storage: store ? store.kind : 'starting',
      time: Date.now(),
      ai: getAiConfig()
    });
  }
  if(pathname === '/api/login' && req.method === 'POST'){
    const body = await readBody(req) || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const rateKey = `${getClientIp(req)}:${username.toLowerCase()}`;
    const rate = checkLoginRateLimit(rateKey);
    if(!rate.ok){
      return sendJSON(res, 429, { error: `Too many attempts — try again in ${rate.retryAfterSec}s` });
    }
    const user = username ? await store.getUserByUsername(username) : null;
    const ok = user && user.active && verifyPasswordHash(body.password, user.passwordSalt, user.passwordHash);
    if(!ok){
      return sendJSON(res, 401, { error: 'Invalid username or password' });
    }
    const token = signToken({ sub: user.id, username: user.username, tokenVersion: user.tokenVersion }, config.tokenSecret);
    return sendJSON(res, 200, { token, username: user.username, role: user.role });
  }

  // Everything below requires a valid, non-revoked token
  const claims = verifyToken(getBearerToken(req), config.tokenSecret);
  if(!claims){
    return sendJSON(res, 401, { error: 'Login required' });
  }
  const authedUser = await store.getUserById(claims.sub);
  if(!authedUser || !authedUser.active || authedUser.tokenVersion !== claims.tokenVersion){
    return sendJSON(res, 401, { error: 'Session revoked — log in again' });
  }
  const actor = { id: authedUser.id, username: authedUser.username, role: authedUser.role };

  if(pathname === '/api/account/revoke-sessions' && req.method === 'POST'){
    await store.updateUser(actor.id, { tokenVersion: (authedUser.tokenVersion || 0) + 1 });
    return sendJSON(res, 200, { ok: true });
  }

  if(pathname === '/api/admin/users' && req.method === 'GET'){
    if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const users = await store.getAllUsers();
    return sendJSON(res, 200, {
      users: users.map(u => ({ id: u.id, username: u.username, role: u.role, active: !!u.active, createdAt: u.createdAt }))
    });
  }

  if(pathname === '/api/admin/users' && req.method === 'POST'){
    if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const body = await readBody(req) || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if(!username || username.length > 32){
      return sendJSON(res, 400, { error: 'Username required (max 32 chars)' });
    }
    if(await store.getUserByUsername(username)){
      return sendJSON(res, 409, { error: 'That username is already taken' });
    }
    const password = typeof body.password === 'string' && body.password ? body.password : generateReadablePassword();
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, passwordSalt);
    const newUser = {
      id: crypto.randomUUID(), username, passwordHash, passwordSalt,
      role: body.role === 'admin' ? 'admin' : 'member', active: true, tokenVersion: 0, createdAt: Date.now()
    };
    await store.createUser(newUser);
    return sendJSON(res, 200, { id: newUser.id, username: newUser.username, role: newUser.role, temporaryPassword: password });
  }

  const disableMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/disable$/);
  if(disableMatch && req.method === 'POST'){
    if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const target = await store.getUserById(disableMatch[1]);
    if(!target) return sendJSON(res, 404, { error: 'User not found' });
    await store.updateUser(target.id, { active: false, tokenVersion: (target.tokenVersion || 0) + 1 });
    return sendJSON(res, 200, { ok: true });
  }

  const resetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
  if(resetMatch && req.method === 'POST'){
    if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const target = await store.getUserById(resetMatch[1]);
    if(!target) return sendJSON(res, 404, { error: 'User not found' });
    const password = generateReadablePassword();
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, passwordSalt);
    await store.updateUser(target.id, { passwordHash, passwordSalt, tokenVersion: (target.tokenVersion || 0) + 1 });
    return sendJSON(res, 200, { ok: true, temporaryPassword: password });
  }

  if(pathname === '/api/diag' && req.method === 'GET'){
    const all = await store.getAll();
    const live = all.filter(r => !r.deleted);
    return sendJSON(res, 200, {
      storage: store.kind,
      location: store.location,
      totalRecords: all.length,
      livePatients: live.length,
      sample: live.slice(0, 10).map(r => { let nm=''; try{ nm = JSON.parse(r.data||'{}').name || ''; }catch{} return { id: r.id, name: nm, updatedAt: r.updatedAt }; })
    });
  }

  if(pathname === '/api/sync' && req.method === 'POST'){
    const body = await readBody(req) || {};
    const since = Number(body.since) || 0;
    const changes = Array.isArray(body.changes) ? body.changes : [];
    const now = Date.now();

    await store.begin();
    try{
      for(const p of changes){
        if(!p || typeof p.id !== 'string') continue;
        const incomingUpdated = Number(p.updatedAt) || 0;
        const existing = await store.getPatientRaw(p.id);
        let existingObj = null;
        if(existing){
          try{ existingObj = JSON.parse(existing.data); }
          catch{ existingObj = {}; }
          existingObj.id = p.id;
          existingObj.updatedAt = existing.updatedAt;
        }
        stampAttribution(p, existingObj, actor);
        if(!existing || incomingUpdated >= existing.updatedAt){
          const stored = existingObj ? mergePatientRecords(p, existingObj) : Object.assign({}, p);
          stored.updatedAt = now;
          await store.upsertPatient(p.id, now, p.deleted ? 1 : 0, JSON.stringify(stored));
        }
      }
      await store.commit();
    }catch(err){
      await store.rollback();
      throw err;
    }

    const rows = await store.getChangedSince(since);
    return sendJSON(res, 200, { serverTime: now, patients: rows.map(rowToPatient) });
  }

  if(pathname === '/api/backup' && req.method === 'GET'){
    const filePath = store.backupFilePath ? store.backupFilePath() : null;
    if(filePath){
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="ortho_${new Date().toISOString().slice(0,10)}.db"`,
        'Cache-Control': 'no-store'
      });
      return createReadStream(filePath).pipe(res);
    }
    // Backends without a file (e.g. MongoDB): hand back a full JSON dump.
    const rows = await store.getAll();
    const payload = {
      exportedAt: new Date().toISOString(),
      appVersion: 2,
      source: store.kind,
      patients: rows.map(rowToPatient)
    };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="ortho_${new Date().toISOString().slice(0,10)}.json"`,
      'Cache-Control': 'no-store'
    });
    return res.end(JSON.stringify(payload, null, 2));
  }

  if(pathname === '/api/images' && req.method === 'POST'){
    const body = await readBody(req) || {};
    if(!body.dataURL) return sendJSON(res, 400, { error: 'dataURL required' });
    const url = await saveImageFromDataUrl(body.dataURL);
    return sendJSON(res, 200, { url });
  }

  const imgMatch = pathname.match(/^\/api\/images\/([a-f0-9]+\.(jpg|png|webp))$/i);
  if(imgMatch && req.method === 'GET'){
    const img = await store.getImage(imgMatch[1]);
    if(!img){ res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': img.contentType || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' });
    return res.end(img.buffer);
  }
  if(imgMatch && req.method === 'DELETE'){
    const ok = await store.deleteImage(imgMatch[1]);
    return sendJSON(res, ok ? 200 : 404, { ok });
  }

  if(pathname === '/api/export' && req.method === 'GET'){
    const rows = await store.getActive();
    const payload = {
      exportedAt: new Date().toISOString(),
      appVersion: 2,
      patients: rows.map(rowToPatient)
    };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="ortho_rounds_backup_${new Date().toISOString().slice(0,10)}.json"`,
      'Cache-Control': 'no-store'
    });
    return res.end(JSON.stringify(payload, null, 2));
  }

  if(pathname.startsWith('/api/ai/') && req.method === 'POST'){
    if(!isAiEnabled()){
      return sendJSON(res, 503, { error: 'AI not configured' });
    }
    const token = getBearerToken(req);
    const rate = checkRateLimit(token);
    if(!rate.ok){
      return sendJSON(res, 429, { error: `AI rate limit — try again in ${rate.retryAfterSec}s` });
    }
    const body = await readBody(req) || {};
    try{
      if(pathname === '/api/ai/draft-plan'){
        if(!body.patient || typeof body.patient !== 'object'){
          return sendJSON(res, 400, { error: 'patient snapshot required' });
        }
        const text = await draftPlan(body.patient);
        return sendJSON(res, 200, { text });
      }
      if(pathname === '/api/ai/polish-presentation'){
        if(!body.patient || typeof body.patient !== 'object'){
          return sendJSON(res, 400, { error: 'patient snapshot required' });
        }
        const style = body.style === 'compact' ? 'compact' : 'full';
        const text = await polishPresentation(body.patient, style, body.seedScript || '');
        return sendJSON(res, 200, { text });
      }
      if(pathname === '/api/ai/handover-summary'){
        if(!Array.isArray(body.patients)){
          return sendJSON(res, 400, { error: 'patients array required' });
        }
        const text = await handoverSummary(body.patients, body.wardNote || '');
        return sendJSON(res, 200, { text });
      }
      if(pathname === '/api/ai/discharge-summary'){
        if(!body.patient || typeof body.patient !== 'object'){
          return sendJSON(res, 400, { error: 'patient snapshot required' });
        }
        const text = await dischargeSummary(body.patient);
        return sendJSON(res, 200, { text });
      }
      if(pathname === '/api/ai/ward-brief'){
        if(!Array.isArray(body.patients)){
          return sendJSON(res, 400, { error: 'patients array required' });
        }
        const text = await wardBrief(body.patients);
        return sendJSON(res, 200, { text });
      }
      if(pathname === '/api/ai/parse-admission'){
        if(typeof body.text !== 'string' || !body.text.trim()){
          return sendJSON(res, 400, { error: 'admission note text required' });
        }
        const fields = await parseAdmission(body.text);
        return sendJSON(res, 200, { fields });
      }
      if(pathname === '/api/ai/scribe'){
        if(!body.patient || typeof body.patient !== 'object'){
          return sendJSON(res, 400, { error: 'patient snapshot required' });
        }
        if(typeof body.transcript !== 'string' || !body.transcript.trim()){
          return sendJSON(res, 400, { error: 'transcript required' });
        }
        const result = await scribeRoundNote(body.patient, body.transcript);
        return sendJSON(res, 200, { result });
      }
      return sendJSON(res, 404, { error: 'Unknown AI endpoint' });
    }catch(err){
      const status = err.statusCode || 502;
      return sendJSON(res, status, { error: err.message || 'AI request failed' });
    }
  }

  if(pathname === '/api/import' && req.method === 'POST'){
    const body = await readBody(req) || {};
    const incoming = Array.isArray(body.patients) ? body.patients : null;
    if(!incoming) return sendJSON(res, 400, { error: 'Invalid file format' });
    const replace = body.mode === 'replace';
    const now = Date.now();

    await store.begin();
    try{
      if(replace) await store.deleteAllPatients();
      for(const p of incoming){
        if(!p || typeof p.id !== 'string') continue;
        const updatedAt = Number(p.updatedAt) || now;
        await store.upsertPatient(p.id, updatedAt, p.deleted ? 1 : 0, JSON.stringify(p));
      }
      await store.commit();
    }catch(err){
      await store.rollback();
      throw err;
    }
    return sendJSON(res, 200, { count: incoming.length });
  }

  return sendJSON(res, 404, { error: 'Unknown endpoint' });
}

/* ---------------- server ---------------- */

let store = null;
let config = null;

const server = http.createServer(async (req, res)=>{
  try{
    const pathname = (req.url.split('?')[0]) || '/';
    if(pathname.startsWith('/api/')){
      await handleApi(req, res, pathname);
    }else{
      serveStatic(req, res);
    }
  }catch(err){
    const status = err.statusCode || 500;
    if(!res.headersSent){
      sendJSON(res, status, { error: err.message || 'Server error' });
    }else{
      try{ res.end(); }catch{ /* ignore */ }
    }
    if(status >= 500) console.error(err);
  }
});

function getLanAddresses(){
  const out = [];
  const ifaces = os.networkInterfaces();
  for(const name of Object.keys(ifaces)){
    for(const iface of ifaces[name] || []){
      if(iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

async function printStartupBanner(bootstrap){
  const lan = getLanAddresses();
  console.log('\n  ORTHO ROUNDS server is running');
  console.log('  ------------------------------------------');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  for(const ip of lan){
    console.log(`  On the network:    http://${ip}:${PORT}`);
  }
  console.log('  ------------------------------------------');
  console.log(`  Storage:   ${store.kind === 'mongo' ? 'MongoDB' : 'SQLite'} — ${store.location}`);
  if(bootstrap.created){
    console.log(`\n  >> First run — created admin account "${bootstrap.username}"`);
    if(bootstrap.usingEnvPassword){
      console.log('  >> Password: (from ORTHO_ADMIN_PASSWORD environment variable)');
    }else{
      console.log(`  >>     ${bootstrap.generatedPassword}`);
      console.log('  >> Write it down. It is not shown again.');
      console.log('  >> (To set your own next time: ORTHO_ADMIN_PASSWORD="..." node server.js)');
    }
  }else{
    console.log('  Accounts:  existing users found — log in with your account');
  }
  if(store.freshStart && (await store.countPatients()) === 0){
    console.warn('\n  !! No existing data was found — starting EMPTY.');
    if(store.kind === 'mongo'){
      console.warn('  !! (New MongoDB database. If you expected existing patients,');
      console.warn('  !!  double-check MONGODB_URI points at the right cluster/db.)');
    }else{
      console.warn('  !! If this is a redeploy and you expected existing patients,');
      console.warn('  !! the data directory is NOT on a persistent disk/volume.');
      console.warn(`  !! Mount a persistent disk at: ${DATA_DIR}`);
      console.warn('  !! (or set MONGODB_URI to use a managed database instead).');
    }
  }
  console.log('\n  Press Ctrl+C to stop.\n');
}

async function main(){
  store = await createStore({ dataDir: DATA_DIR, mongoUri: MONGODB_URI });
  await store.init();
  config = await setupConfig(store);
  const bootstrap = await bootstrapAdmin(store);
  await store.autoBackup();
  server.listen(PORT, HOST, ()=>{
    printStartupBanner(bootstrap).catch(err => console.warn('Banner error:', err.message));
  });
}

let shuttingDown = false;
function shutdown(){
  if(shuttingDown) return;
  shuttingDown = true;
  const done = ()=> process.exit(0);
  server.close(()=>{
    Promise.resolve(store && store.close()).then(done, done);
  });
  setTimeout(done, 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(err =>{
  console.error('Failed to start server:', err);
  process.exit(1);
});
