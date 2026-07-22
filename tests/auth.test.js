import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  hashPassword, verifyPasswordHash, signToken, verifyToken,
  checkLoginRateLimit, bootstrapAdmin, generateReadablePassword
} from '../auth.js';

describe('password hashing', () => {
  test('verifies a correct password', () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword('bone-plate-1234', salt);
    assert.equal(verifyPasswordHash('bone-plate-1234', salt, hash), true);
  });

  test('rejects a wrong password', () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword('correct-horse', salt);
    assert.equal(verifyPasswordHash('wrong-horse', salt, hash), false);
  });

  test('rejects empty/missing input', () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword('something', salt);
    assert.equal(verifyPasswordHash('', salt, hash), false);
    assert.equal(verifyPasswordHash(undefined, salt, hash), false);
  });

  test('generateReadablePassword produces a well-formed string', () => {
    const a = generateReadablePassword();
    assert.match(a, /^[a-z]+-[a-z]+-\d{4}$/);
  });
});

describe('token sign/verify', () => {
  const secret = 'test-secret';

  test('round-trips valid claims', () => {
    const token = signToken({ sub: 'u1', username: 'ppg', tokenVersion: 0 }, secret);
    const claims = verifyToken(token, secret);
    assert.ok(claims);
    assert.equal(claims.sub, 'u1');
    assert.equal(claims.username, 'ppg');
    assert.equal(claims.tokenVersion, 0);
  });

  test('rejects a tampered signature', () => {
    const token = signToken({ sub: 'u1', username: 'ppg', tokenVersion: 0 }, secret);
    const tampered = token.slice(0, -2) + 'ff';
    assert.equal(verifyToken(tampered, secret), null);
  });

  test('rejects a token signed with a different secret', () => {
    const token = signToken({ sub: 'u1', username: 'ppg', tokenVersion: 0 }, secret);
    assert.equal(verifyToken(token, 'different-secret'), null);
  });

  test('rejects an expired token', () => {
    const claims = { sub: 'u1', username: 'ppg', tokenVersion: 0, exp: Date.now() - 1000 };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    assert.equal(verifyToken(`${payload}.${sig}`, secret), null);
  });

  test('rejects malformed tokens', () => {
    assert.equal(verifyToken('not-a-token', secret), null);
    assert.equal(verifyToken('', secret), null);
    assert.equal(verifyToken(null, secret), null);
  });
});

describe('login rate limiting', () => {
  test('allows attempts under the limit, blocks past it, resets after the window', () => {
    const key = 'ip:someuser';
    let now = 1_000_000;
    for(let i = 0; i < 8; i++){
      const res = checkLoginRateLimit(key, now);
      assert.equal(res.ok, true, `attempt ${i + 1} should be allowed`);
    }
    const blocked = checkLoginRateLimit(key, now);
    assert.equal(blocked.ok, false);
    assert.ok(blocked.retryAfterSec > 0);

    now += 15 * 60 * 1000 + 1;
    const afterWindow = checkLoginRateLimit(key, now);
    assert.equal(afterWindow.ok, true);
  });

  test('tracks separate keys independently', () => {
    const now = 2_000_000;
    for(let i = 0; i < 8; i++) checkLoginRateLimit('ip:a', now);
    const blockedA = checkLoginRateLimit('ip:a', now);
    const freshB = checkLoginRateLimit('ip:b', now);
    assert.equal(blockedA.ok, false);
    assert.equal(freshB.ok, true);
  });
});

describe('bootstrapAdmin', () => {
  function fakeStore(){
    const users = [];
    return {
      users,
      async countUsers(){ return users.length; },
      async getAllUsers(){ return users; },
      async createUser(u){ users.push(u); }
    };
  }

  test('creates one admin on a fresh store, generating a password when unset', async () => {
    delete process.env.ORTHO_ADMIN_PASSWORD;
    delete process.env.ORTHO_ADMIN_USERNAME;
    const store = fakeStore();
    const result = await bootstrapAdmin(store);
    assert.equal(result.created, true);
    assert.equal(result.username, 'admin');
    assert.equal(result.usingEnvPassword, false);
    assert.ok(result.generatedPassword);
    assert.equal(store.users.length, 1);
    assert.equal(store.users[0].role, 'admin');
    assert.equal(verifyPasswordHash(result.generatedPassword, store.users[0].passwordSalt, store.users[0].passwordHash), true);
  });

  test('is a no-op when a user already exists', async () => {
    const store = fakeStore();
    store.users.push({ id: 'x', username: 'existing' });
    const result = await bootstrapAdmin(store);
    assert.equal(result.created, false);
    assert.equal(store.users.length, 1);
  });

  test('uses ORTHO_ADMIN_PASSWORD when set, and does not return it in the result', async () => {
    process.env.ORTHO_ADMIN_PASSWORD = 'my-chosen-password';
    process.env.ORTHO_ADMIN_USERNAME = 'chief';
    try{
      const store = fakeStore();
      const result = await bootstrapAdmin(store);
      assert.equal(result.username, 'chief');
      assert.equal(result.usingEnvPassword, true);
      assert.equal(result.generatedPassword, null);
      assert.equal(verifyPasswordHash('my-chosen-password', store.users[0].passwordSalt, store.users[0].passwordHash), true);
    }finally{
      delete process.env.ORTHO_ADMIN_PASSWORD;
      delete process.env.ORTHO_ADMIN_USERNAME;
    }
  });
});
