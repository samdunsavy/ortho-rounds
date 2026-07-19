import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../storage.js';

describe('SQLite storage — users', () => {
  let dataDir;
  let store;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-'));
    store = await createStore({ dataDir });
    await store.init();
  });

  after(async () => {
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('starts with zero users', async () => {
    assert.equal(await store.countUsers(), 0);
    assert.equal(await store.getUserByUsername('nobody'), null);
  });

  test('creates and retrieves a user by username and id', async () => {
    await store.createUser({
      id: 'u1', username: 'ppg1', passwordHash: 'hash', passwordSalt: 'salt',
      role: 'admin', active: true, tokenVersion: 0, createdAt: Date.now()
    });
    const byUsername = await store.getUserByUsername('ppg1');
    const byId = await store.getUserById('u1');
    assert.equal(byUsername.id, 'u1');
    assert.equal(byId.username, 'ppg1');
    assert.equal(byId.role, 'admin');
    assert.equal(await store.countUsers(), 1);
  });

  test('enforces unique usernames', async () => {
    await assert.rejects(() => store.createUser({
      id: 'u2', username: 'ppg1', passwordHash: 'h', passwordSalt: 's',
      role: 'member', active: true, tokenVersion: 0, createdAt: Date.now()
    }));
  });

  test('updateUser only touches whitelisted fields', async () => {
    await store.createUser({
      id: 'u3', username: 'ppg2', passwordHash: 'h', passwordSalt: 's',
      role: 'member', active: true, tokenVersion: 0, createdAt: Date.now()
    });
    await store.updateUser('u3', { tokenVersion: 5, active: false, id: 'should-be-ignored', username: 'should-be-ignored' });
    const u = await store.getUserById('u3');
    assert.equal(u.tokenVersion, 5);
    assert.equal(u.active, 0);
    assert.equal(u.username, 'ppg2');
  });

  test('can re-enable a disabled user', async () => {
    await store.updateUser('u3', { active: true });
    const u = await store.getUserById('u3');
    assert.equal(u.active, 1);
  });

  test('getAllUsers lists everyone successfully created so far', async () => {
    // u1 and u3 succeeded; u2 was rejected for a duplicate username above.
    const all = await store.getAllUsers();
    assert.equal(all.length, 2);
  });
});

describe('SQLite storage — pushSubscriptions', () => {
  let dataDir;
  let store;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-'));
    store = await createStore({ dataDir });
    await store.init();
  });

  after(async () => {
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('creates and retrieves subscriptions by user', async () => {
    await store.createSubscription({
      id: 's1', userId: 'u1', endpoint: 'https://push.example/ep1',
      p256dh: 'key1', auth: 'auth1', createdAt: Date.now()
    });
    const subs = await store.getSubscriptionsByUserId('u1');
    assert.equal(subs.length, 1);
    assert.equal(subs[0].endpoint, 'https://push.example/ep1');
    assert.equal(subs[0].lastDigestAt, 0);
  });

  test('re-subscribing with the same endpoint updates keys, not creates a duplicate', async () => {
    await store.createSubscription({
      id: 's2-attempted', userId: 'u1', endpoint: 'https://push.example/ep1',
      p256dh: 'key1-updated', auth: 'auth1-updated', createdAt: Date.now()
    });
    const subs = await store.getSubscriptionsByUserId('u1');
    assert.equal(subs.length, 1);
    assert.equal(subs[0].id, 's1'); // original id preserved, not overwritten
    assert.equal(subs[0].p256dh, 'key1-updated');
  });

  test('updateSubscription only touches lastDigestAt', async () => {
    await store.updateSubscription('https://push.example/ep1', { lastDigestAt: 12345, userId: 'attacker' });
    const subs = await store.getSubscriptionsByUserId('u1');
    assert.equal(subs[0].lastDigestAt, 12345);
    assert.equal(subs[0].userId, 'u1'); // ignored the userId in the patch
  });

  test('deleteSubscription removes it', async () => {
    await store.deleteSubscription('https://push.example/ep1');
    assert.deepEqual(await store.getSubscriptionsByUserId('u1'), []);
  });

  test('getAllSubscriptions spans users', async () => {
    await store.createSubscription({ id: 's3', userId: 'u1', endpoint: 'ep-a', p256dh: 'k', auth: 'a', createdAt: Date.now() });
    await store.createSubscription({ id: 's4', userId: 'u2', endpoint: 'ep-b', p256dh: 'k', auth: 'a', createdAt: Date.now() });
    const all = await store.getAllSubscriptions();
    assert.equal(all.length, 2);
  });
});

describe('SQLite storage — patients (regression check alongside new users table)', () => {
  let dataDir;
  let store;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-'));
    store = await createStore({ dataDir });
    await store.init();
  });

  after(async () => {
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('upserts and reads back a patient', async () => {
    await store.upsertPatient('p1', 100, 0, JSON.stringify({ name: 'Test Patient' }));
    const row = await store.getPatientRaw('p1');
    assert.equal(row.updatedAt, 100);
    assert.equal(JSON.parse(row.data).name, 'Test Patient');
  });

  test('getChangedSince only returns rows newer than the watermark', async () => {
    await store.upsertPatient('p2', 200, 0, JSON.stringify({ name: 'Later' }));
    const changed = await store.getChangedSince(150);
    assert.equal(changed.length, 1);
    assert.equal(changed[0].id, 'p2');
  });

  test('patients and users tables coexist independently', async () => {
    assert.equal(await store.countPatients(), 2);
    assert.equal(await store.countUsers(), 0);
  });
});

describe('SQLite storage — multi-tenant hierarchy (roadmap Phase 1, unused until MULTI_TENANT flag is on)', () => {
  let dataDir;
  let store;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-'));
    store = await createStore({ dataDir });
    await store.init();
  });

  after(async () => {
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('a fresh install has no orgs/hospitals/wards', async () => {
    assert.deepEqual(await store.listOrganizations(), []);
  });

  test('creates the org -> hospital -> ward chain and reads it back', async () => {
    await store.createOrganization({ id: 'org1', name: 'City Hospital Group', plan: 'paid', createdAt: 1 });
    await store.createHospital({ id: 'hosp1', orgId: 'org1', name: 'City General', createdAt: 2 });
    await store.createWard({ id: 'ward1', hospitalId: 'hosp1', name: 'Ortho A', specialty: 'ortho', createdAt: 3 });

    const org = await store.getOrganization('org1');
    assert.equal(org.name, 'City Hospital Group');
    assert.equal(org.plan, 'paid');

    const hospitals = await store.listHospitalsByOrg('org1');
    assert.equal(hospitals.length, 1);
    assert.equal(hospitals[0].name, 'City General');

    const wards = await store.listWardsByHospital('hosp1');
    assert.equal(wards.length, 1);
    assert.equal(wards[0].specialty, 'ortho');
  });

  test('a fresh user has orgId/wardId as null (single-tenant default)', async () => {
    await store.createUser({
      id: 'mt-u1', username: 'mtuser', passwordHash: 'h', passwordSalt: 's',
      role: 'member', active: true, tokenVersion: 0, createdAt: Date.now()
    });
    const u = await store.getUserById('mt-u1');
    assert.equal(u.orgId, null);
    assert.equal(u.wardId, null);
  });

  test('updateUser can assign orgId/wardId once multi-tenant is in use', async () => {
    await store.updateUser('mt-u1', { orgId: 'org1', wardId: 'ward1' });
    const u = await store.getUserById('mt-u1');
    assert.equal(u.orgId, 'org1');
    assert.equal(u.wardId, 'ward1');
  });
});

describe('SQLite storage — upgrading a pre-multi-tenant database', () => {
  test('a users table created before orgId/wardId existed gets the columns added automatically', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-test-'));
    try{
      // Simulate an old install: create the users table exactly as the
      // original (pre-Phase-1) schema did, with no orgId/wardId columns.
      const { DatabaseSync } = await import('node:sqlite');
      const dbPath = path.join(dataDir, 'ortho.db');
      const raw = new DatabaseSync(dbPath);
      raw.exec(`
        CREATE TABLE users (
          id           TEXT PRIMARY KEY,
          username     TEXT NOT NULL UNIQUE,
          passwordHash TEXT NOT NULL,
          passwordSalt TEXT NOT NULL,
          role         TEXT NOT NULL DEFAULT 'member',
          active       INTEGER NOT NULL DEFAULT 1,
          tokenVersion INTEGER NOT NULL DEFAULT 0,
          createdAt    INTEGER NOT NULL
        );
      `);
      raw.exec(`INSERT INTO users (id, username, passwordHash, passwordSalt, role, active, tokenVersion, createdAt)
        VALUES ('old1', 'legacyuser', 'h', 's', 'admin', 1, 0, 1000)`);
      raw.close();

      // Now open it through the real store, exactly like a version upgrade would.
      const store = await createStore({ dataDir });
      await store.init();

      const u = await store.getUserById('old1');
      assert.equal(u.username, 'legacyuser', 'pre-existing user survives the upgrade untouched');
      assert.equal(u.orgId, null, 'new column defaults to null for pre-existing rows');
      assert.equal(u.wardId, null);

      await store.close();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
