/* Append-only audit log helper (BACKLOG T1).
   ------------------------------------------------------------
   recordAudit never throws and never blocks the caller on failure.
   Storage exposes appendAudit / listAudit only — no update or delete.
*/

import crypto from 'node:crypto';
import { logError } from './logger.js';

export const ACTIONS = Object.freeze({
  LOGIN_SUCCESS: 'login.success',
  LOGIN_FAILURE: 'login.failure',
  PATIENT_VIEW: 'patient.view',
  PATIENT_WRITE: 'patient.write',
  PATIENT_MOVE: 'patient.move',
  EXPORT: 'export',
  IMPORT: 'import',
  BACKUP_DOWNLOAD: 'backup.download',
  PASSWORD_RESET: 'password.reset',
  USER_CREATE: 'user.create',
  USER_DISABLE: 'user.disable',
  USER_ENABLE: 'user.enable',
  STRUCTURE_CREATE: 'structure.create',
  STRUCTURE_UPDATE: 'structure.update',
  STRUCTURE_DELETE: 'structure.delete',
  STRUCTURE_MOVE: 'structure.move',
  AI_INVOKE: 'ai.invoke'
});

function truncUa(ua){
  if(typeof ua !== 'string' || !ua) return null;
  return ua.length > 300 ? ua.slice(0, 300) : ua;
}

function clientIp(req){
  if(!req || !req.headers) return null;
  const fwd = req.headers['x-forwarded-for'];
  if(fwd) return String(fwd).split(',')[0].trim() || null;
  return (req.socket && req.socket.remoteAddress) || null;
}

/** Fire-and-forget audit write. Never throws. */
export async function recordAudit(store, opts = {}){
  try{
    if(!store || typeof store.appendAudit !== 'function') return;
    if(typeof opts.action !== 'string' || !opts.action) return;
    const actor = opts.actor || null;
    const req = opts.req || null;
    await store.appendAudit({
      id: crypto.randomUUID(),
      at: Date.now(),
      actorId: actor && actor.id != null ? String(actor.id) : null,
      actorUsername: actor && actor.username != null ? String(actor.username) : null,
      action: opts.action,
      subjectType: opts.subjectType ?? null,
      subjectId: opts.subjectId != null ? String(opts.subjectId) : null,
      orgId: opts.orgId != null ? String(opts.orgId) : null,
      ip: clientIp(req),
      userAgent: truncUa(req && req.headers && req.headers['user-agent']),
      detail: opts.detail && typeof opts.detail === 'object' ? opts.detail : {}
    });
  }catch(err){
    logError('audit_write_failed', err, { action: opts && opts.action });
  }
}
