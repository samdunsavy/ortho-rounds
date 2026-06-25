/* ============================================================
   ORTHO ROUNDS — self-hosted LAN server
   ------------------------------------------------------------
   - Zero npm dependencies (Node built-ins only).
   - Stores patient data in a single local SQLite file (data/ortho.db).
   - Data never leaves this machine. Access over your own Wi-Fi by URL.
   - Frontend (public/) is an offline-capable client that syncs here.

   Run:   node server.js
   Then open the printed http://<your-ip>:<port> URL on any device
   on the same network.

   Config / password:
   - Set a password with the ORTHO_PASSWORD environment variable, e.g.
        ORTHO_PASSWORD="ward12" node server.js
   - If unset, a random password is generated and printed once on first
     run, and its hash is stored in data/config.json.
   - Change the port with PORT=4000 node server.js (default 3000).
   ============================================================ */

import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'ortho.db');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY_BYTES = 64 * 1024 * 1024; // 64MB — patients can carry base64 X-rays
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/* ---------------- config + auth secrets ---------------- */

function loadConfig(){
  if(!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  let config = {};
  if(existsSync(CONFIG_PATH)){
    try{ config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); }
    catch{ config = {}; }
  }
  let changed = false;
  if(!config.tokenSecret){ config.tokenSecret = crypto.randomBytes(32).toString('hex'); changed = true; }
  if(!config.passwordSalt){ config.passwordSalt = crypto.randomBytes(16).toString('hex'); changed = true; }

  let generatedPassword = null;
  const envPassword = process.env.ORTHO_PASSWORD;
  if(envPassword){
    // Env var always wins; keep the file's stored hash in sync for reference.
    config.passwordHash = hashPassword(envPassword, config.passwordSalt);
    changed = true;
  } else if(!config.passwordHash){
    generatedPassword = generateReadablePassword();
    config.passwordHash = hashPassword(generatedPassword, config.passwordSalt);
    changed = true;
  }

  if(changed) writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  return { config, generatedPassword, usingEnvPassword: !!envPassword };
}

function generateReadablePassword(){
  const words = ['bone','plate','screw','radius','femur','tibia','ulna','splint','suture','cast','rounds','ward'];
  const w = () => words[crypto.randomInt(words.length)];
  return `${w()}-${w()}-${crypto.randomInt(1000, 9999)}`;
}

function hashPassword(password, salt){
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function verifyPassword(input){
  if(typeof input !== 'string' || !input) return false;
  const candidate = hashPassword(input, config.passwordSalt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(config.passwordHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signToken(){
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = crypto.createHmac('sha256', config.tokenSecret).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}

function verifyToken(token){
  if(typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if(dot < 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', config.tokenSecret).update(expStr).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(expStr) > Date.now();
}

/* ---------------- database ---------------- */

function initDb(){
  if(!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const database = new DatabaseSync(DB_PATH);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id        TEXT PRIMARY KEY,
      updatedAt INTEGER NOT NULL,
      deleted   INTEGER NOT NULL DEFAULT 0,
      data      TEXT    NOT NULL
    );
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_patients_updatedAt ON patients(updatedAt);');
  return database;
}

function autoBackupDb(){
  if(!existsSync(DB_PATH)) return;
  const backupDir = path.join(DATA_DIR, 'backups');
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dest = path.join(backupDir, `ortho-${stamp}.db`);
  try{
    copyFileSync(DB_PATH, dest);
    const files = readdirSync(backupDir)
      .filter(f => f.startsWith('ortho-') && f.endsWith('.db'))
      .map(f => ({ name: f, time: statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for(const old of files.slice(7)){
      try{ unlinkSync(path.join(backupDir, old.name)); }catch{ /* ignore */ }
    }
    console.log(`  Auto-backup: ${dest}`);
  }catch(err){
    console.warn('  Auto-backup failed:', err.message);
  }
}

function rowToPatient(row){
  let obj;
  try{ obj = JSON.parse(row.data); }
  catch{ obj = {}; }
  obj.id = row.id;
  obj.updatedAt = row.updatedAt;
  obj.deleted = !!row.deleted;
  return obj;
}

function mergeChecklistById(localItems, remoteItems){
  const byId = new Map();
  for(const c of (remoteItems || [])){
    if(c && c.id) byId.set(c.id, Object.assign({}, c));
  }
  for(const c of (localItems || [])){
    if(!c || !c.id) continue;
    const r = byId.get(c.id);
    if(!r){ byId.set(c.id, Object.assign({}, c)); continue; }
    const lt = Number(c.updatedAt) || 0;
    const rt = Number(r.updatedAt) || 0;
    byId.set(c.id, lt >= rt ? Object.assign({}, c) : Object.assign({}, r));
  }
  return [...byId.values()];
}

function mergePlanHistory(localHist, remoteHist){
  const byDate = new Map();
  for(const h of (remoteHist || [])){
    if(h && h.date) byDate.set(h.date, h);
  }
  for(const h of (localHist || [])){
    if(h && h.date) byDate.set(h.date, h);
  }
  return [...byDate.values()].sort((a,b)=> String(a.date).localeCompare(String(b.date)));
}

function mergePatientRecords(local, remote){
  if(!local) return Object.assign({}, remote);
  if(!remote) return Object.assign({}, local);
  const merged = Object.assign({}, remote, local);
  merged.postOpChecks = mergeChecklistById(local.postOpChecks, remote.postOpChecks);
  merged.dischargeChecks = mergeChecklistById(local.dischargeChecks, remote.dischargeChecks);
  merged.planHistory = mergePlanHistory(local.planHistory, remote.planHistory);
  merged.labs = Object.assign({}, remote.labs || {}, local.labs || {});
  const localPlanTs = Number(local.planUpdatedAt) || 0;
  const remotePlanTs = Number(remote.planUpdatedAt) || 0;
  if(remotePlanTs > localPlanTs){
    merged.dailyPlan = remote.dailyPlan;
    merged.dailyPlanDate = remote.dailyPlanDate;
    merged.planUpdatedAt = remotePlanTs;
  }else if(localPlanTs >= remotePlanTs){
    merged.dailyPlan = local.dailyPlan;
    merged.dailyPlanDate = local.dailyPlanDate;
    merged.planUpdatedAt = localPlanTs || merged.planUpdatedAt;
  }
  const localStatusTs = Number(local.statusUpdatedAt) || 0;
  const remoteStatusTs = Number(remote.statusUpdatedAt) || 0;
  if(remoteStatusTs > localStatusTs){
    merged.status = remote.status;
    merged.statusBeforeDischarge = remote.statusBeforeDischarge;
    merged.statusUpdatedAt = remoteStatusTs;
  }else if(localStatusTs > remoteStatusTs){
    merged.status = local.status;
    merged.statusBeforeDischarge = local.statusBeforeDischarge;
    merged.statusUpdatedAt = localStatusTs;
  }
  merged.updatedAt = Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0);
  return merged;
}

function getStoredPatient(id){
  const row = db.prepare('SELECT id, updatedAt, deleted, data FROM patients WHERE id = ?').get(id);
  return row ? rowToPatient(row) : null;
}

function saveImageFromDataUrl(dataURL){
  mkdirSync(IMAGES_DIR, { recursive: true });
  const m = String(dataURL).match(/^data:(image\/\w+);base64,(.+)$/);
  if(!m) throw Object.assign(new Error('Invalid image data'), { statusCode: 400 });
  const ext = m[1].includes('png') ? '.png' : m[1].includes('webp') ? '.webp' : '.jpg';
  const id = crypto.randomBytes(12).toString('hex');
  const filePath = path.join(IMAGES_DIR, id + ext);
  writeFileSync(filePath, Buffer.from(m[2], 'base64'));
  return `/api/images/${id}${ext}`;
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
    return sendJSON(res, 200, { ok: true, app: 'ortho-rounds', time: Date.now() });
  }
  if(pathname === '/api/login' && req.method === 'POST'){
    const body = await readBody(req);
    if(!body || !verifyPassword(body.password)){
      return sendJSON(res, 401, { error: 'Wrong password' });
    }
    return sendJSON(res, 200, { token: signToken() });
  }

  // Everything below requires a valid token
  if(!verifyToken(getBearerToken(req))){
    return sendJSON(res, 401, { error: 'Login required' });
  }

  if(pathname === '/api/sync' && req.method === 'POST'){
    const body = await readBody(req) || {};
    const since = Number(body.since) || 0;
    const changes = Array.isArray(body.changes) ? body.changes : [];
    const now = Date.now();

    const upsert = db.prepare(`
      INSERT INTO patients (id, updatedAt, deleted, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updatedAt = excluded.updatedAt,
        deleted   = excluded.deleted,
        data      = excluded.data
    `);
    const getOne = db.prepare('SELECT updatedAt, data FROM patients WHERE id = ?');

    db.exec('BEGIN');
    try{
      for(const p of changes){
        if(!p || typeof p.id !== 'string') continue;
        const incomingUpdated = Number(p.updatedAt) || 0;
        const existing = getOne.get(p.id);
        if(!existing || incomingUpdated >= existing.updatedAt){
          let stored = Object.assign({}, p);
          if(existing){
            let existingObj;
            try{ existingObj = JSON.parse(existing.data); }
            catch{ existingObj = {}; }
            existingObj.id = p.id;
            existingObj.updatedAt = existing.updatedAt;
            stored = mergePatientRecords(p, existingObj);
          }
          const serverUpdated = now;
          stored.updatedAt = serverUpdated;
          upsert.run(p.id, serverUpdated, p.deleted ? 1 : 0, JSON.stringify(stored));
        }
      }
      db.exec('COMMIT');
    }catch(err){
      db.exec('ROLLBACK');
      throw err;
    }

    const rows = db.prepare('SELECT id, updatedAt, deleted, data FROM patients WHERE updatedAt > ?').all(since);
    return sendJSON(res, 200, { serverTime: now, patients: rows.map(rowToPatient) });
  }

  if(pathname === '/api/backup' && req.method === 'GET'){
    if(!existsSync(DB_PATH)) return sendJSON(res, 404, { error: 'Database not found' });
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="ortho_${new Date().toISOString().slice(0,10)}.db"`,
      'Cache-Control': 'no-store'
    });
    return createReadStream(DB_PATH).pipe(res);
  }

  if(pathname === '/api/images' && req.method === 'POST'){
    const body = await readBody(req) || {};
    if(!body.dataURL) return sendJSON(res, 400, { error: 'dataURL required' });
    const url = saveImageFromDataUrl(body.dataURL);
    return sendJSON(res, 200, { url });
  }

  const imgMatch = pathname.match(/^\/api\/images\/([a-f0-9]+\.(jpg|png|webp))$/i);
  if(imgMatch && req.method === 'GET'){
    const filePath = path.join(IMAGES_DIR, imgMatch[1]);
    if(!filePath.startsWith(IMAGES_DIR) || !existsSync(filePath)){
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' });
    return createReadStream(filePath).pipe(res);
  }

  if(pathname === '/api/export' && req.method === 'GET'){
    const rows = db.prepare('SELECT id, updatedAt, deleted, data FROM patients WHERE deleted = 0').all();
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

  if(pathname === '/api/import' && req.method === 'POST'){
    const body = await readBody(req) || {};
    const incoming = Array.isArray(body.patients) ? body.patients : null;
    if(!incoming) return sendJSON(res, 400, { error: 'Invalid file format' });
    const replace = body.mode === 'replace';
    const now = Date.now();

    const upsert = db.prepare(`
      INSERT INTO patients (id, updatedAt, deleted, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updatedAt = excluded.updatedAt,
        deleted   = excluded.deleted,
        data      = excluded.data
    `);

    db.exec('BEGIN');
    try{
      if(replace) db.exec('DELETE FROM patients');
      for(const p of incoming){
        if(!p || typeof p.id !== 'string') continue;
        const updatedAt = Number(p.updatedAt) || now;
        upsert.run(p.id, updatedAt, p.deleted ? 1 : 0, JSON.stringify(p));
      }
      db.exec('COMMIT');
    }catch(err){
      db.exec('ROLLBACK');
      throw err;
    }
    return sendJSON(res, 200, { count: incoming.length });
  }

  return sendJSON(res, 404, { error: 'Unknown endpoint' });
}

/* ---------------- server ---------------- */

const { config, generatedPassword, usingEnvPassword } = loadConfig();
const db = initDb();
autoBackupDb();

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

server.listen(PORT, HOST, ()=>{
  printStartupBanner();
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

function printStartupBanner(){
  const lan = getLanAddresses();
  console.log('\n  ORTHO ROUNDS server is running');
  console.log('  ------------------------------------------');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  for(const ip of lan){
    console.log(`  On the network:    http://${ip}:${PORT}`);
  }
  console.log('  ------------------------------------------');
  console.log(`  Database:  ${DB_PATH}`);
  if(usingEnvPassword){
    console.log('  Password:  (from ORTHO_PASSWORD environment variable)');
  }else if(generatedPassword){
    console.log('\n  >> A login password was generated for you:');
    console.log(`  >>     ${generatedPassword}`);
    console.log('  >> Write it down. It is not shown again.');
    console.log('  >> (To set your own: ORTHO_PASSWORD="..." node server.js)');
  }else{
    console.log('  Password:  (stored hash in data/config.json — delete it to reset)');
  }
  console.log('\n  Press Ctrl+C to stop.\n');
}

function shutdown(){
  try{ db.close(); }catch{ /* ignore */ }
  server.close(()=> process.exit(0));
  setTimeout(()=> process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
