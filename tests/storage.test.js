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

  test('getAllUsers lists everyone successfully created so far', async () => {
    // u1 and u3 succeeded; u2 was rejected for a duplicate username above.
    const all = await store.getAllUsers();
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
