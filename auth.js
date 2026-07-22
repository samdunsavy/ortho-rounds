/* Per-user accounts: password hashing, signed tokens, login rate limiting,
   and first-boot admin bootstrap for Ortho Rounds. */

import crypto from 'node:crypto';

const LOGIN_RATE_LIMIT_MAX = 8;
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const loginRateBuckets = new Map();

export function generateReadablePassword(){
  const words = ['bone', 'plate', 'screw', 'radius', 'femur', 'tibia', 'ulna', 'splint', 'suture', 'cast', 'rounds', 'ward'];
  const w = () => words[crypto.randomInt(words.length)];
  return `${w()}-${w()}-${crypto.randomInt(1000, 9999)}`;
}

export function hashPassword(password, salt){
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

export function verifyPasswordHash(input, salt, storedHash){
  if(typeof input !== 'string' || !input || !salt || !storedHash) return false;
  const candidate = hashPassword(input, salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function signToken({ sub, username, tokenVersion }, tokenSecret){
  const claims = { sub, username, tokenVersion, exp: Date.now() + TOKEN_TTL_MS };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.createHmac('sha256', tokenSecret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyToken(token, tokenSecret){
  if(typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if(dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', tokenSecret).update(payload).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let claims;
  try{ claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch{ return null; }
  if(!claims || typeof claims.exp !== 'number' || claims.exp <= Date.now()) return null;
  return claims;
}

/**
 * Login attempts have no pre-auth token to key a rate limit by (unlike the
 * AI endpoints, which key on the bearer token) — key by IP + username instead.
 */
export function checkLoginRateLimit(key, now = Date.now()){
  let bucket = loginRateBuckets.get(key);
  if(!bucket || now - bucket.start > LOGIN_RATE_LIMIT_WINDOW_MS){
    bucket = { start: now, count: 0 };
    loginRateBuckets.set(key, bucket);
  }
  bucket.count++;
  if(bucket.count > LOGIN_RATE_LIMIT_MAX){
    return { ok: false, retryAfterSec: Math.ceil((bucket.start + LOGIN_RATE_LIMIT_WINDOW_MS - now) / 1000) };
  }
  return { ok: true };
}

/**
 * Creates the first admin account on a fresh install. No-op if an
 * instance-level admin (orgId null) already exists — this only ever runs
 * once per install. Tenant-scoped users (orgId set) don't count: multi-tenant
 * installs can be pre-seeded with org/ward members before the instance admin
 * is bootstrapped.
 */
export async function bootstrapAdmin(store){
  const existing = await store.getAllUsers();
  if(existing.some(u => !u.orgId)) return { created: false };

  const username = process.env.ORTHO_ADMIN_USERNAME || 'admin';
  const envPassword = process.env.ORTHO_ADMIN_PASSWORD;
  const password = envPassword || generateReadablePassword();
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, passwordSalt);

  await store.createUser({
    id: crypto.randomUUID(),
    username,
    passwordHash,
    passwordSalt,
    role: 'admin',
    active: true,
    tokenVersion: 0,
    createdAt: Date.now()
  });

  return {
    created: true,
    username,
    generatedPassword: envPassword ? null : password,
    usingEnvPassword: !!envPassword
  };
}
