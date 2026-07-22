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
   - Admins can add/disable/enable other users and reset passwords from the
     in-app Manage users panel. Any user can change their own password.
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
  buildOtListDocx,
  sanitizeOtExportPatient,
  DEFAULT_OT_DOCTORS
} from './ot-list.js';
import {
  isAiEnabled,
  getAiConfig,
  checkRateLimit,
  draftPlan,
  polishPresentation,
  handoverSummary,
  dischargeSummary,
  wardBrief,
  wardRiskFlags,
  parseAdmission,
  scribeRoundNote,
  parseLabsFromImage
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
import { logError, logWarn } from './logger.js';
import { runDigestPass } from './notifications.js';
import { listFlags, isEnabled } from './flags.js';
import { resolveScope, canRead, decideWrite } from './scope.js';
import { recordEvent, getSnapshot, isExportEnabled, startExportLoop } from './telemetry.js';
import { buildOrgTree, buildOrgRollups } from './admin.js';

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

// The sync wire format (request/response shape below) is versioned from here
// on. `/api/sync` (unversioned) and `/api/sync/v1` are the same handler and
// will stay that way for as long as v1 is current — this lets existing
// clients keep calling the bare path forever while new clients can pin to
// `/api/sync/v1` explicitly. A future breaking change ships as `/api/sync/v2`
// alongside v1, never by changing v1's behavior in place.
const SYNC_API_VERSION = 1;

/* ---------------- config secret (token signing only) ---------------- */

async function setupConfig(store){
  const config = await store.loadRawConfig();
  let changed = false;
  if(!config.tokenSecret){
    config.tokenSecret = crypto.randomBytes(32).toString('hex');
    changed = true;
  }
  if(!config.vapidPublicKey || !config.vapidPrivateKey){
    // Dynamic import so LAN-only installs that never touch push never pay
    // for loading web-push — same pattern storage.js uses for 'mongodb'.
    // web-push is CommonJS — its functions live on the default export.
    const webPush = (await import('web-push')).default;
    const keys = webPush.generateVAPIDKeys();
    config.vapidPublicKey = keys.publicKey;
    config.vapidPrivateKey = keys.privateKey;
    changed = true;
  }
  if(changed) await store.saveRawConfig(config);
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

/** Whole-instance routes (backup/export/import/diag) are instance-admin-only
 *  when MULTI_TENANT is on: they expose or mutate every org's data at once. */
function isInstanceAdmin(actor){
  return actor.role === 'admin' && !actor.orgId;
}

function cleanName(raw, max = 80){
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s && s.length <= max ? s : null;
}

/** Which org is this admin request about? Org admins: their own.
 *  Instance admins must target explicitly (query on GET, body on POST). */
function requestedOrgId(actor, explicit){
  if(!isInstanceAdmin(actor)) return actor.orgId || null;
  return typeof explicit === 'string' && explicit ? explicit : null;
}

/** True iff wardId belongs to org orgId (looks up department -> hospital -> org). */
async function departmentInOrg(wardId, orgId){
  const department = await store.getDepartment(wardId);
  if(!department) return false;
  const hospital = await store.getHospital(department.hospitalId);
  return !!hospital && hospital.orgId === orgId;
}

/** True iff a hierarchy node (org/hospital/department/ward/unit) belongs to
 *  org orgId — resolves the node's org by walking its parents. */
async function nodeInOrg(store, type, id, orgId){
  if(!id || !orgId) return false;
  switch(type){
    case 'unit': {
      const unit = await store.getUnit(id);
      return !!unit && (await nodeInOrg(store, 'ward', unit.wardId, orgId));
    }
    case 'ward': {
      const ward = await store.getWard(id);
      return !!ward && (await nodeInOrg(store, 'department', ward.departmentId, orgId));
    }
    case 'department': {
      const department = await store.getDepartment(id);
      return !!department && (await nodeInOrg(store, 'hospital', department.hospitalId, orgId));
    }
    case 'hospital': {
      const hospital = await store.getHospital(id);
      return !!hospital && hospital.orgId === orgId;
    }
    case 'org':
      return id === orgId;
    default:
      return false;
  }
}

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
      ai: getAiConfig(),
      vapidPublicKey: config ? config.vapidPublicKey : null,
      apiVersion: SYNC_API_VERSION,
      flags: listFlags()
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
    recordEvent('login');
    return sendJSON(res, 200, { token, username: user.username, role: user.role, orgId: user.orgId ?? null, wardId: user.wardId ?? null });
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
  const actor = {
    id: authedUser.id, username: authedUser.username, role: authedUser.role,
    orgId: authedUser.orgId ?? null, wardId: authedUser.wardId ?? null,
    assignment: authedUser.assignmentId ? { type: authedUser.assignmentType, id: authedUser.assignmentId } : null
  };

  if(pathname === '/api/account/revoke-sessions' && req.method === 'POST'){
    await store.updateUser(actor.id, { tokenVersion: (authedUser.tokenVersion || 0) + 1 });
    return sendJSON(res, 200, { ok: true });
  }

  if(pathname === '/api/account/change-password' && req.method === 'POST'){
    const body = await readBody(req) || {};
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if(!currentPassword || !newPassword){
      return sendJSON(res, 400, { error: 'Current and new password required' });
    }
    if(newPassword.length < 6){
      return sendJSON(res, 400, { error: 'New password must be at least 6 characters' });
    }
    if(!verifyPasswordHash(currentPassword, authedUser.passwordSalt, authedUser.passwordHash)){
      return sendJSON(res, 403, { error: 'Current password is wrong' });
    }
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(newPassword, passwordSalt);
    const nextVersion = (authedUser.tokenVersion || 0) + 1;
    await store.updateUser(actor.id, { passwordHash, passwordSalt, tokenVersion: nextVersion });
    // Issue a fresh token so this device stays logged in; other devices are revoked.
    const token = signToken({
      sub: actor.id, username: actor.username, tokenVersion: nextVersion
    }, config.tokenSecret);
    return sendJSON(res, 200, { ok: true, token });
  }

  if(pathname === '/api/push/subscribe' && req.method === 'POST'){
    const body = await readBody(req) || {};
    const sub = body.subscription;
    if(!sub || typeof sub.endpoint !== 'string' || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string'){
      return sendJSON(res, 400, { error: 'Invalid push subscription' });
    }
    await store.createSubscription({
      id: crypto.randomUUID(), userId: actor.id, endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh, auth: sub.keys.auth, createdAt: Date.now()
    });
    return sendJSON(res, 200, { ok: true });
  }

  if(pathname === '/api/push/unsubscribe' && req.method === 'POST'){
    const body = await readBody(req) || {};
    if(typeof body.endpoint === 'string') await store.deleteSubscription(body.endpoint);
    return sendJSON(res, 200, { ok: true });
  }

  if(pathname === '/api/admin/telemetry' && req.method === 'GET'){
    if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    return sendJSON(res, 200, { exportEnabled: isExportEnabled(), ...getSnapshot() });
  }

  if(isEnabled('MULTI_TENANT') && pathname.startsWith('/api/admin/')){
    const orgAdminMatch = pathname.match(/^\/api\/admin\/orgs\/([^/]+)\/admin$/);

    if(pathname === '/api/admin/orgs' && req.method === 'POST'){
      if(!isInstanceAdmin(actor)) return sendJSON(res, 403, { error: 'Instance admin only' });
      const body = await readBody(req) || {};
      const name = cleanName(body.name);
      if(!name) return sendJSON(res, 400, { error: 'Organization name required (max 80 chars)' });
      const org = { id: crypto.randomUUID(), name, plan: body.plan === 'paid' ? 'paid' : 'free', createdAt: Date.now() };
      await store.createOrganization(org);
      return sendJSON(res, 200, { id: org.id, name: org.name, plan: org.plan });
    }

    if(pathname === '/api/admin/orgs' && req.method === 'GET'){
      if(!isInstanceAdmin(actor)) return sendJSON(res, 403, { error: 'Instance admin only' });
      return sendJSON(res, 200, { orgs: await buildOrgRollups(store) });
    }

    if(orgAdminMatch && req.method === 'POST'){
      if(!isInstanceAdmin(actor)) return sendJSON(res, 403, { error: 'Instance admin only' });
      const org = await store.getOrganization(orgAdminMatch[1]);
      if(!org) return sendJSON(res, 404, { error: 'Organization not found' });
      const body = await readBody(req) || {};
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      if(!username || username.length > 32) return sendJSON(res, 400, { error: 'Username required (max 32 chars)' });
      if(await store.getUserByUsername(username)) return sendJSON(res, 409, { error: 'That username is already taken' });
      const password = generateReadablePassword();
      const passwordSalt = crypto.randomBytes(16).toString('hex');
      const newUser = {
        id: crypto.randomUUID(), username, passwordHash: hashPassword(password, passwordSalt), passwordSalt,
        role: 'admin', active: true, tokenVersion: 0, createdAt: Date.now(), orgId: org.id, wardId: null
      };
      await store.createUser(newUser);
      return sendJSON(res, 200, { id: newUser.id, username, role: 'admin', orgId: org.id, temporaryPassword: password });
    }

    if(pathname === '/api/admin/org' && req.method === 'GET'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const qIdx = req.url.indexOf('?');
      const params = new URLSearchParams(qIdx >= 0 ? req.url.slice(qIdx + 1) : '');
      const orgId = requestedOrgId(actor, params.get('orgId'));
      if(!orgId) return sendJSON(res, 400, { error: 'orgId required' });
      if(!(await store.getOrganization(orgId))) return sendJSON(res, 404, { error: 'Organization not found' });
      if(!isInstanceAdmin(actor) && actor.orgId !== orgId) return sendJSON(res, 403, { error: 'Not your organization' });
      return sendJSON(res, 200, await buildOrgTree(store, orgId));
    }

    if(pathname === '/api/admin/hospitals' && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const body = await readBody(req) || {};
      const orgId = requestedOrgId(actor, body.orgId);
      if(!orgId) return sendJSON(res, 400, { error: 'orgId required' });
      if(!(await store.getOrganization(orgId))) return sendJSON(res, 404, { error: 'Organization not found' });
      const name = cleanName(body.name);
      if(!name) return sendJSON(res, 400, { error: 'Hospital name required (max 80 chars)' });
      const hospital = { id: crypto.randomUUID(), orgId, name, createdAt: Date.now() };
      await store.createHospital(hospital);
      return sendJSON(res, 200, { id: hospital.id, orgId, name });
    }

    if(pathname === '/api/admin/departments' && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const body = await readBody(req) || {};
      const hospital = body.hospitalId ? await store.getHospital(body.hospitalId) : null;
      if(!hospital) return sendJSON(res, 404, { error: 'Hospital not found' });
      if(!isInstanceAdmin(actor) && hospital.orgId !== actor.orgId) return sendJSON(res, 403, { error: 'Not your organization' });
      const name = cleanName(body.name);
      if(!name) return sendJSON(res, 400, { error: 'Department name required (max 80 chars)' });
      const specialty = cleanName(body.specialty, 40) || 'ortho';
      const department = { id: crypto.randomUUID(), hospitalId: hospital.id, name, specialty, createdAt: Date.now() };
      await store.createDepartment(department);
      return sendJSON(res, 200, { id: department.id, hospitalId: hospital.id, name, specialty });
    }

    if(pathname === '/api/admin/wards' && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const body = await readBody(req) || {};
      const dep = body.departmentId ? await store.getDepartment(body.departmentId) : null;
      if(!dep) return sendJSON(res, 404, { error: 'Department not found' });
      if(!isInstanceAdmin(actor) && !(await departmentInOrg(dep.id, actor.orgId))) return sendJSON(res, 403, { error: 'Not your organization' });
      const name = cleanName(body.name);
      if(!name) return sendJSON(res, 400, { error: 'Ward name required (max 80 chars)' });
      const ward = { id: crypto.randomUUID(), departmentId: dep.id, name, createdAt: Date.now() };
      await store.createWard(ward);
      return sendJSON(res, 200, { id: ward.id, departmentId: dep.id, name });
    }

    if(pathname === '/api/admin/units' && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const body = await readBody(req) || {};
      const ward = body.wardId ? await store.getWard(body.wardId) : null;
      if(!ward) return sendJSON(res, 404, { error: 'Ward not found' });
      if(!isInstanceAdmin(actor) && !(await departmentInOrg(ward.departmentId, actor.orgId))) return sendJSON(res, 403, { error: 'Not your organization' });
      const name = cleanName(body.name);
      if(!name) return sendJSON(res, 400, { error: 'Unit name required (max 80 chars)' });
      const unit = { id: crypto.randomUUID(), wardId: ward.id, name, createdAt: Date.now() };
      await store.createUnit(unit);
      return sendJSON(res, 200, { id: unit.id, wardId: ward.id, name });
    }

    const assignMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/assign$/);
    if(assignMatch && req.method === 'POST'){
      if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
      const target = await store.getUserById(assignMatch[1]);
      if(!target) return sendJSON(res, 404, { error: 'User not found' });
      if(!isInstanceAdmin(actor) && target.orgId !== actor.orgId) return sendJSON(res, 403, { error: 'Not your organization' });
      const body = await readBody(req) || {};
      if(body.nodeId === null || body.nodeId === undefined){
        await store.updateUser(target.id, { assignmentType: null, assignmentId: null });
        return sendJSON(res, 200, { ok: true, assignment: null });
      }
      const nodeType = String(body.nodeType || '');
      const orgId = isInstanceAdmin(actor) ? target.orgId : actor.orgId;
      if(!orgId || !(await nodeInOrg(store, nodeType, String(body.nodeId), orgId))) return sendJSON(res, 403, { error: 'Node is not in this organization' });
      await store.updateUser(target.id, { assignmentType: nodeType, assignmentId: String(body.nodeId) });
      return sendJSON(res, 200, { ok: true, assignment: { type: nodeType, id: String(body.nodeId) } });
    }
    // fall through: unmatched /api/admin/* paths continue to the routes below
  }

  if(pathname === '/api/admin/users' && req.method === 'GET'){
    if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    let users = await store.getAllUsers();
    if(isEnabled('MULTI_TENANT') && !isInstanceAdmin(actor)){
      users = users.filter(u => u.orgId === actor.orgId);
    }
    const extra = isEnabled('MULTI_TENANT') ? (u) => ({ wardId: u.wardId ?? null, orgId: u.orgId ?? null }) : () => ({});
    return sendJSON(res, 200, {
      users: users.map(u => ({ id: u.id, username: u.username, role: u.role, active: !!u.active, createdAt: u.createdAt, ...extra(u) }))
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
    if(isEnabled('MULTI_TENANT')){
      if(!isInstanceAdmin(actor)){
        newUser.orgId = actor.orgId;
        if(body.wardId){
          if(!(await departmentInOrg(String(body.wardId), actor.orgId))) return sendJSON(res, 403, { error: 'Department is not in this organization' });
          newUser.wardId = String(body.wardId);
        }
      }else if(body.orgId){
        if(!(await store.getOrganization(body.orgId))) return sendJSON(res, 404, { error: 'Organization not found' });
        newUser.orgId = body.orgId;
        if(body.wardId){
          if(!(await departmentInOrg(String(body.wardId), body.orgId))) return sendJSON(res, 403, { error: 'Department is not in this organization' });
          newUser.wardId = String(body.wardId);
        }
      }
    }
    await store.createUser(newUser);
    return sendJSON(res, 200, { id: newUser.id, username: newUser.username, role: newUser.role, temporaryPassword: password });
  }

  const disableMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/disable$/);
  if(disableMatch && req.method === 'POST'){
    if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const target = await store.getUserById(disableMatch[1]);
    if(!target) return sendJSON(res, 404, { error: 'User not found' });
    if(isEnabled('MULTI_TENANT') && !isInstanceAdmin(actor) && target.orgId !== actor.orgId){
      return sendJSON(res, 403, { error: 'Not your organization' });
    }
    if(target.id === actor.id){
      return sendJSON(res, 400, { error: 'You cannot disable your own account' });
    }
    await store.updateUser(target.id, { active: false, tokenVersion: (target.tokenVersion || 0) + 1 });
    return sendJSON(res, 200, { ok: true });
  }

  const enableMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/enable$/);
  if(enableMatch && req.method === 'POST'){
    if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const target = await store.getUserById(enableMatch[1]);
    if(!target) return sendJSON(res, 404, { error: 'User not found' });
    if(isEnabled('MULTI_TENANT') && !isInstanceAdmin(actor) && target.orgId !== actor.orgId){
      return sendJSON(res, 403, { error: 'Not your organization' });
    }
    await store.updateUser(target.id, { active: true });
    return sendJSON(res, 200, { ok: true });
  }

  const resetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
  if(resetMatch && req.method === 'POST'){
    if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const target = await store.getUserById(resetMatch[1]);
    if(!target) return sendJSON(res, 404, { error: 'User not found' });
    if(isEnabled('MULTI_TENANT') && !isInstanceAdmin(actor) && target.orgId !== actor.orgId){
      return sendJSON(res, 403, { error: 'Not your organization' });
    }
    const password = generateReadablePassword();
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, passwordSalt);
    await store.updateUser(target.id, { passwordHash, passwordSalt, tokenVersion: (target.tokenVersion || 0) + 1 });
    return sendJSON(res, 200, { ok: true, temporaryPassword: password });
  }

  if(pathname === '/api/diag' && req.method === 'GET'){
    if(isEnabled('MULTI_TENANT') && !isInstanceAdmin(actor)){
      return sendJSON(res, 403, { error: 'Instance admin only' });
    }
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

  if((pathname === '/api/sync' || pathname === '/api/sync/v1') && req.method === 'POST'){
    recordEvent('sync');
    const body = await readBody(req) || {};
    const since = Number(body.since) || 0;
    const changes = Array.isArray(body.changes) ? body.changes : [];
    const now = Date.now();
    const scope = isEnabled('MULTI_TENANT') ? await resolveScope(actor, store) : null;

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
        let decision = null;
        if(scope){
          decision = await decideWrite({ incoming: p, existing: existingObj, actor, scope, store });
          if(!decision.allow) continue;
        }
        stampAttribution(p, existingObj, actor);
        if(!existing || incomingUpdated >= existing.updatedAt){
          const stored = existingObj ? mergePatientRecords(p, existingObj) : Object.assign({}, p);
          if(decision && decision.ancestry !== undefined){
            const a = decision.ancestry;
            // Always strip client-merged ancestry keys first so a client-supplied
            // value can never linger when the server is about to re-stamp.
            delete stored.unitId; delete stored.wardId; delete stored.departmentId;
            delete stored.hospitalId; delete stored.orgId;
            if(a !== null){
              Object.assign(stored, a);
              const ward = await store.getWard(a.wardId);
              const unit = await store.getUnit(a.unitId);
              if(ward) stored.ward = ward.name;
              if(unit) stored.unit = unit.name;
            }
          }
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
    // apiVersion is additive: existing clients that don't read it are
    // unaffected; new clients can use it to confirm they're talking to the
    // version of the sync contract they expect.
    let outPatients = rows.map(rowToPatient);
    if(scope) outPatients = outPatients.filter(p => canRead(p, scope));
    return sendJSON(res, 200, { serverTime: now, patients: outPatients, apiVersion: SYNC_API_VERSION });
  }

  if(pathname === '/api/backup' && req.method === 'GET'){
    if(isEnabled('MULTI_TENANT') && !isInstanceAdmin(actor)){
      return sendJSON(res, 403, { error: 'Instance admin only' });
    }
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
    if(isEnabled('MULTI_TENANT') && !isInstanceAdmin(actor)){
      return sendJSON(res, 403, { error: 'Instance admin only' });
    }
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

  if(pathname === '/api/ot-list/docx' && req.method === 'POST'){
    const body = await readBody(req) || {};
    const date = typeof body.date === 'string' ? body.date.trim() : '';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
      return sendJSON(res, 400, { error: 'OT date required (YYYY-MM-DD)' });
    }
    const unit = typeof body.unit === 'string' ? body.unit.trim() : '';
    const defaults = Array.isArray(body.defaultOtDoctors) && body.defaultOtDoctors.length
      ? body.defaultOtDoctors.map(s => String(s || '').trim()).filter(Boolean)
      : DEFAULT_OT_DOCTORS;
    const patients = (Array.isArray(body.patients) ? body.patients : [])
      .map(sanitizeOtExportPatient)
      .filter(Boolean)
      .slice(0, 40);
    if(!patients.length){
      return sendJSON(res, 400, { error: 'No patients on the OT list' });
    }
    try{
      const buf = await buildOtListDocx({ date, unit, patients, defaultOtDoctors: defaults });
      const stamp = date.replace(/-/g, '');
      const unitSlug = (unit || 'list').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'list';
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="OT_LIST_UNIT_${unitSlug}_${stamp}.docx"`,
        'Content-Length': buf.length,
        'Cache-Control': 'no-store'
      });
      res.end(buf);
    }catch(err){
      return sendJSON(res, 500, { error: err.message || 'Could not build OT list' });
    }
    return;
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
    recordEvent(`ai:${pathname.slice('/api/ai/'.length)}`);
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
      if(pathname === '/api/ai/risk-flags'){
        if(!Array.isArray(body.patients)){
          return sendJSON(res, 400, { error: 'patients array required' });
        }
        const flags = await wardRiskFlags(body.patients);
        return sendJSON(res, 200, { flags });
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
      if(pathname === '/api/ai/parse-labs-image'){
        if(typeof body.image !== 'string' || !body.image.startsWith('data:image/')){
          return sendJSON(res, 400, { error: 'lab report image required' });
        }
        const { labs, otherLabs, reportDate } = await parseLabsFromImage(body.image);
        return sendJSON(res, 200, { labs, otherLabs, reportDate });
      }
      return sendJSON(res, 404, { error: 'Unknown AI endpoint' });
    }catch(err){
      const status = err.statusCode || 502;
      return sendJSON(res, status, { error: err.message || 'AI request failed' });
    }
  }

  if(pathname === '/api/import' && req.method === 'POST'){
    if(isEnabled('MULTI_TENANT') && !isInstanceAdmin(actor)){
      return sendJSON(res, 403, { error: 'Instance admin only' });
    }
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
  const pathname = (req.url.split('?')[0]) || '/';
  try{
    if(pathname.startsWith('/api/')){
      await handleApi(req, res, pathname);
    }else if(pathname === '/admission.js'){
      const filePath = path.join(__dirname, 'admission.js');
      if(!existsSync(filePath)){
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      createReadStream(filePath).pipe(res);
    }else if(pathname === '/clinical-normalize.js'){
      const filePath = path.join(__dirname, 'clinical-normalize.js');
      if(!existsSync(filePath)){
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      createReadStream(filePath).pipe(res);
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
    if(status >= 500) logError('request_failed', err, { method: req.method, path: pathname, status });
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
  console.log(`  Telemetry: ${isExportEnabled() ? 'local counts + export to ' + process.env.ORTHO_TELEMETRY_URL : 'local counts only, nothing leaves this machine'}`);
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

const DIGEST_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
let digestIntervalHandle = null;

async function runDigestPassSafely(){
  try{
    const rows = await store.getActive();
    await runDigestPass(store, config, rows.map(rowToPatient));
  }catch(err){
    logWarn('digest_pass_failed', { errMessage: err.message });
  }
}

async function main(){
  store = await createStore({ dataDir: DATA_DIR, mongoUri: MONGODB_URI });
  await store.init();
  config = await setupConfig(store);
  const bootstrap = await bootstrapAdmin(store);
  await store.autoBackup();
  digestIntervalHandle = setInterval(runDigestPassSafely, DIGEST_INTERVAL_MS);
  digestIntervalHandle.unref();
  startExportLoop(); // no-op unless both ORTHO_TELEMETRY_URL and ORTHO_FLAG_TELEMETRY_EXPORT=1 are set
  server.listen(PORT, HOST, ()=>{
    printStartupBanner(bootstrap).catch(err => logWarn('startup_banner_failed', { errMessage: err.message }));
  });
}

let shuttingDown = false;
function shutdown(){
  if(shuttingDown) return;
  shuttingDown = true;
  if(digestIntervalHandle) clearInterval(digestIntervalHandle);
  const done = ()=> process.exit(0);
  server.close(()=>{
    Promise.resolve(store && store.close()).then(done, done);
  });
  setTimeout(done, 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(err =>{
  logError('server_start_failed', err);
  process.exit(1);
});
