/* ============================================================
   STORAGE BACKENDS
   ------------------------------------------------------------
   Two interchangeable persistence layers behind one async API:

   - SQLite (default): single local file data/ortho.db. Zero external
     dependencies. Data never leaves the machine. Great for LAN use, but the
     file must sit on a persistent disk or a redeploy wipes it.

   - MongoDB (optional): activated when MONGODB_URI is set. Patients, images
     and auth config live in a managed database (e.g. MongoDB Atlas free tier)
     that persists independently of the app host — so redeploys keep the data.

   Both stores expose the same shape of rows: { id, updatedAt, deleted, data }
   where `data` is the patient record serialised as a JSON string, mirroring
   the original SQLite columns so the server logic stays identical.
   ============================================================ */

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, statSync,
  copyFileSync, readdirSync, unlinkSync
} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { logWarn } from './logger.js';

const MAX_BACKUPS = 7;
// orgId/wardId are additive, nullable fields for the roadmap Phase 1
// multi-tenant model (see DESIGN-multitenant.md). Every existing user row
// gets NULL for both, which self-host/single-tenant code paths never read —
// they're inert until something behind the MULTI_TENANT flag starts using
// them.
const USER_PATCH_FIELDS = ['passwordHash', 'passwordSalt', 'active', 'role', 'tokenVersion', 'orgId', 'wardId'];
const SUBSCRIPTION_PATCH_FIELDS = ['lastDigestAt'];

export async function createStore(opts){
  if(opts && opts.mongoUri){
    return await createMongoStore(opts);
  }
  return createSqliteStore(opts);
}

function extToContentType(ext){
  return ext === '.png' ? 'image/png'
       : ext === '.webp' ? 'image/webp'
       : 'image/jpeg';
}

/* ---------------- SQLite ---------------- */

// Adds `column` to `table` if it doesn't already exist. Used to evolve the
// schema of a database that was created before a given column existed,
// without ever needing a destructive migration or a fresh install.
function addColumnIfMissing(db, table, column, type){
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if(cols.some(c => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function createSqliteStore({ dataDir }){
  const DB_PATH = path.join(dataDir, 'ortho.db');
  const CONFIG_PATH = path.join(dataDir, 'config.json');
  const IMAGES_DIR = path.join(dataDir, 'images');
  let db = null;
  let freshStart = false;

  return {
    kind: 'sqlite',
    location: DB_PATH,
    get freshStart(){ return freshStart; },

    async init(){
      if(!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
      freshStart = !existsSync(DB_PATH);
      db = new DatabaseSync(DB_PATH);
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec(`
        CREATE TABLE IF NOT EXISTS patients (
          id        TEXT PRIMARY KEY,
          updatedAt INTEGER NOT NULL,
          deleted   INTEGER NOT NULL DEFAULT 0,
          data      TEXT    NOT NULL
        );
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_patients_updatedAt ON patients(updatedAt);');
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id           TEXT PRIMARY KEY,
          username     TEXT NOT NULL UNIQUE,
          passwordHash TEXT NOT NULL,
          passwordSalt TEXT NOT NULL,
          role         TEXT NOT NULL DEFAULT 'member',
          active       INTEGER NOT NULL DEFAULT 1,
          tokenVersion INTEGER NOT NULL DEFAULT 0,
          createdAt    INTEGER NOT NULL,
          orgId        TEXT,
          wardId       TEXT
        );
      `);
      // Existing databases created before orgId/wardId existed won't have
      // these columns yet — add them if missing. NULL for every existing
      // row, which is exactly the "not part of any org yet" state.
      addColumnIfMissing(db, 'users', 'orgId', 'TEXT');
      addColumnIfMissing(db, 'users', 'wardId', 'TEXT');

      // ---- multi-tenant hierarchy (roadmap Phase 1, see DESIGN-multitenant.md) ----
      // These tables are created unconditionally (cheap, and avoids ever
      // running with a half-migrated schema) but nothing in this codebase
      // queries them yet outside of the CRUD methods below, which nothing
      // calls unless the MULTI_TENANT flag is on. A self-hosted install that
      // never touches that flag never has rows in these tables.
      db.exec(`
        CREATE TABLE IF NOT EXISTS organizations (
          id        TEXT PRIMARY KEY,
          name      TEXT NOT NULL,
          plan      TEXT NOT NULL DEFAULT 'free',
          createdAt INTEGER NOT NULL
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS hospitals (
          id        TEXT PRIMARY KEY,
          orgId     TEXT NOT NULL,
          name      TEXT NOT NULL,
          createdAt INTEGER NOT NULL
        );
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_hospitals_orgId ON hospitals(orgId);');
      db.exec(`
        CREATE TABLE IF NOT EXISTS departments (
          id         TEXT PRIMARY KEY,
          hospitalId TEXT NOT NULL,
          name       TEXT NOT NULL,
          specialty  TEXT NOT NULL DEFAULT 'ortho',
          createdAt  INTEGER NOT NULL
        );
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_departments_hospitalId ON departments(hospitalId);');
      db.exec(`
        CREATE TABLE IF NOT EXISTS wards (
          id           TEXT PRIMARY KEY,
          departmentId TEXT NOT NULL,
          name         TEXT NOT NULL,
          createdAt    INTEGER NOT NULL
        );
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_wards_departmentId ON wards(departmentId);');
      db.exec(`
        CREATE TABLE IF NOT EXISTS units (
          id        TEXT PRIMARY KEY,
          wardId    TEXT NOT NULL,
          name      TEXT NOT NULL,
          createdAt INTEGER NOT NULL
        );
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_units_wardId ON units(wardId);');
      db.exec(`
        CREATE TABLE IF NOT EXISTS pushSubscriptions (
          id           TEXT PRIMARY KEY,
          userId       TEXT NOT NULL,
          endpoint     TEXT NOT NULL UNIQUE,
          p256dh       TEXT NOT NULL,
          auth         TEXT NOT NULL,
          createdAt    INTEGER NOT NULL,
          lastDigestAt INTEGER NOT NULL DEFAULT 0
        );
      `);
    },

    async loadRawConfig(){
      if(existsSync(CONFIG_PATH)){
        try{ return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); }
        catch{ return {}; }
      }
      return {};
    },
    async saveRawConfig(cfg){
      if(!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
      writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    },

    async getPatientRaw(id){
      const row = db.prepare('SELECT updatedAt, data FROM patients WHERE id = ?').get(id);
      return row || null;
    },
    async upsertPatient(id, updatedAt, deleted, dataStr){
      db.prepare(`
        INSERT INTO patients (id, updatedAt, deleted, data)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          updatedAt = excluded.updatedAt,
          deleted   = excluded.deleted,
          data      = excluded.data
      `).run(id, updatedAt, deleted ? 1 : 0, dataStr);
    },
    async getChangedSince(since){
      return db.prepare('SELECT id, updatedAt, deleted, data FROM patients WHERE updatedAt > ?').all(since);
    },
    async getActive(){
      return db.prepare('SELECT id, updatedAt, deleted, data FROM patients WHERE deleted = 0').all();
    },
    async getAll(){
      return db.prepare('SELECT id, updatedAt, deleted, data FROM patients').all();
    },
    async deleteAllPatients(){ db.exec('DELETE FROM patients'); },
    async countPatients(){ return db.prepare('SELECT COUNT(*) AS n FROM patients').get().n; },

    async getUserByUsername(username){
      return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
    },
    async getUserById(id){
      return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
    },
    async getAllUsers(){
      return db.prepare('SELECT * FROM users ORDER BY createdAt ASC').all();
    },
    async listUsersByOrg(orgId){
      return db.prepare('SELECT * FROM users WHERE orgId = ? ORDER BY createdAt ASC').all(orgId);
    },
    async hasInstanceAdmin(){
      const row = db.prepare(
        "SELECT 1 AS ok FROM users WHERE role = 'admin' AND active = 1 AND orgId IS NULL LIMIT 1"
      ).get();
      return !!row;
    },
    async countUsers(){ return db.prepare('SELECT COUNT(*) AS n FROM users').get().n; },
    async createUser(user){
      db.prepare(`
        INSERT INTO users (id, username, passwordHash, passwordSalt, role, active, tokenVersion, createdAt, orgId, wardId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.id, user.username, user.passwordHash, user.passwordSalt,
        user.role || 'member', user.active === false ? 0 : 1,
        user.tokenVersion || 0, user.createdAt || Date.now(),
        user.orgId ?? null, user.wardId ?? null
      );
    },
    async updateUser(id, patch){
      const fields = Object.keys(patch || {}).filter(k => USER_PATCH_FIELDS.includes(k));
      if(!fields.length) return;
      const setClause = fields.map(f => `${f} = ?`).join(', ');
      const values = fields.map(f => (f === 'active' ? (patch[f] ? 1 : 0) : patch[f]));
      db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values, id);
    },

    async createSubscription(sub){
      db.prepare(`
        INSERT INTO pushSubscriptions (id, userId, endpoint, p256dh, auth, createdAt, lastDigestAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
          userId = excluded.userId,
          p256dh = excluded.p256dh,
          auth   = excluded.auth
      `).run(
        sub.id, sub.userId, sub.endpoint, sub.p256dh, sub.auth,
        sub.createdAt || Date.now(), sub.lastDigestAt || 0
      );
    },
    async getSubscriptionsByUserId(userId){
      return db.prepare('SELECT * FROM pushSubscriptions WHERE userId = ?').all(userId);
    },
    async getAllSubscriptions(){
      return db.prepare('SELECT * FROM pushSubscriptions').all();
    },
    async deleteSubscription(endpoint){
      db.prepare('DELETE FROM pushSubscriptions WHERE endpoint = ?').run(endpoint);
    },
    async updateSubscription(endpoint, patch){
      const fields = Object.keys(patch || {}).filter(k => SUBSCRIPTION_PATCH_FIELDS.includes(k));
      if(!fields.length) return;
      const setClause = fields.map(f => `${f} = ?`).join(', ');
      db.prepare(`UPDATE pushSubscriptions SET ${setClause} WHERE endpoint = ?`).run(...fields.map(f => patch[f]), endpoint);
    },

    // ---- multi-tenant hierarchy (roadmap Phase 1) — unused until MULTI_TENANT is on ----
    async createOrganization(org){
      db.prepare(`INSERT INTO organizations (id, name, plan, createdAt) VALUES (?, ?, ?, ?)`)
        .run(org.id, org.name, org.plan || 'free', org.createdAt || Date.now());
    },
    async getOrganization(id){
      return db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) || null;
    },
    async listOrganizations(){
      return db.prepare('SELECT * FROM organizations ORDER BY createdAt ASC').all();
    },
    async createHospital(hospital){
      db.prepare(`INSERT INTO hospitals (id, orgId, name, createdAt) VALUES (?, ?, ?, ?)`)
        .run(hospital.id, hospital.orgId, hospital.name, hospital.createdAt || Date.now());
    },
    async getHospital(id){
      return db.prepare('SELECT * FROM hospitals WHERE id = ?').get(id) || null;
    },
    async listHospitalsByOrg(orgId){
      return db.prepare('SELECT * FROM hospitals WHERE orgId = ? ORDER BY createdAt ASC').all(orgId);
    },
    async createDepartment(dep){
      db.prepare(`INSERT INTO departments (id, hospitalId, name, specialty, createdAt) VALUES (?, ?, ?, ?, ?)`)
        .run(dep.id, dep.hospitalId, dep.name, dep.specialty || 'ortho', dep.createdAt || Date.now());
    },
    async getDepartment(id){
      return db.prepare('SELECT * FROM departments WHERE id = ?').get(id) || null;
    },
    async listDepartmentsByHospital(hospitalId){
      return db.prepare('SELECT * FROM departments WHERE hospitalId = ? ORDER BY createdAt ASC').all(hospitalId);
    },
    async createWard(ward){
      db.prepare(`INSERT INTO wards (id, departmentId, name, createdAt) VALUES (?, ?, ?, ?)`)
        .run(ward.id, ward.departmentId, ward.name, ward.createdAt || Date.now());
    },
    async getWard(id){ return db.prepare('SELECT * FROM wards WHERE id = ?').get(id) || null; },
    async listWardsByDepartment(departmentId){
      return db.prepare('SELECT * FROM wards WHERE departmentId = ? ORDER BY createdAt ASC').all(departmentId);
    },
    async createUnit(unit){
      db.prepare(`INSERT INTO units (id, wardId, name, createdAt) VALUES (?, ?, ?, ?)`)
        .run(unit.id, unit.wardId, unit.name, unit.createdAt || Date.now());
    },
    async getUnit(id){ return db.prepare('SELECT * FROM units WHERE id = ?').get(id) || null; },
    async listUnitsByWard(wardId){
      return db.prepare('SELECT * FROM units WHERE wardId = ? ORDER BY createdAt ASC').all(wardId);
    },

    async begin(){ db.exec('BEGIN'); },
    async commit(){ db.exec('COMMIT'); },
    async rollback(){ db.exec('ROLLBACK'); },

    async saveImage(buffer, ext){
      mkdirSync(IMAGES_DIR, { recursive: true });
      const name = crypto.randomBytes(12).toString('hex') + ext;
      writeFileSync(path.join(IMAGES_DIR, name), buffer);
      return `/api/images/${name}`;
    },
    async getImage(name){
      const filePath = path.join(IMAGES_DIR, name);
      if(!filePath.startsWith(IMAGES_DIR) || !existsSync(filePath)) return null;
      const ext = path.extname(filePath).toLowerCase();
      return { buffer: readFileSync(filePath), contentType: extToContentType(ext) };
    },
    async deleteImage(name){
      const filePath = path.join(IMAGES_DIR, name);
      if(!filePath.startsWith(IMAGES_DIR) || !existsSync(filePath)) return false;
      try{
        unlinkSync(filePath);
        return true;
      }catch{
        return false;
      }
    },

    // SQLite backup is the raw DB file; the server streams it directly.
    backupFilePath(){ return existsSync(DB_PATH) ? DB_PATH : null; },

    async autoBackup(){
      if(!existsSync(DB_PATH)) return null;
      const backupDir = path.join(dataDir, 'backups');
      mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const dest = path.join(backupDir, `ortho-${stamp}.db`);
      try{
        copyFileSync(DB_PATH, dest);
        const files = readdirSync(backupDir)
          .filter(f => f.startsWith('ortho-') && f.endsWith('.db'))
          .map(f => ({ name: f, time: statSync(path.join(backupDir, f)).mtimeMs }))
          .sort((a, b) => b.time - a.time);
        for(const old of files.slice(MAX_BACKUPS)){
          try{ unlinkSync(path.join(backupDir, old.name)); }catch{ /* ignore */ }
        }
        return dest;
      }catch(err){
        logWarn('auto_backup_failed', { errMessage: err.message });
        return null;
      }
    },

    async close(){ try{ db && db.close(); }catch{ /* ignore */ } }
  };
}

/* ---------------- MongoDB ---------------- */

function dbNameFromUri(uri){
  try{
    const u = new URL(uri.replace(/^mongodb\+srv:\/\//, 'https://').replace(/^mongodb:\/\//, 'https://'));
    const p = decodeURIComponent(u.pathname.replace(/^\//, ''));
    if(p) return p;
  }catch{ /* ignore */ }
  return 'ortho';
}

async function createMongoStore({ mongoUri }){
  const { MongoClient, Binary } = await import('mongodb');
  const client = new MongoClient(mongoUri);
  await client.connect();
  const database = client.db(dbNameFromUri(mongoUri));
  const patients = database.collection('patients');
  const configCol = database.collection('config');
  const images = database.collection('images');
  const users = database.collection('users');
  const pushSubscriptions = database.collection('pushSubscriptions');
  // Multi-tenant hierarchy (roadmap Phase 1) — see DESIGN-multitenant.md.
  // Collections exist from the start (cheap, schemaless) but stay empty
  // unless something behind the MULTI_TENANT flag writes to them.
  const organizations = database.collection('organizations');
  const hospitals = database.collection('hospitals');
  const departments = database.collection('departments');
  const wards = database.collection('wards');
  const units = database.collection('units');
  await patients.createIndex({ updatedAt: 1 });
  await users.createIndex({ username: 1 }, { unique: true });
  await pushSubscriptions.createIndex({ endpoint: 1 }, { unique: true });
  await pushSubscriptions.createIndex({ userId: 1 });
  await hospitals.createIndex({ orgId: 1 });
  await departments.createIndex({ hospitalId: 1 });
  await wards.createIndex({ departmentId: 1 });
  await units.createIndex({ wardId: 1 });

  const freshStart = (await patients.estimatedDocumentCount()) === 0;
  const mapRow = d => d ? { id: d._id, updatedAt: d.updatedAt, deleted: d.deleted ? 1 : 0, data: d.data } : null;
  const mapUser = d => d ? {
    id: d._id, username: d.username, passwordHash: d.passwordHash, passwordSalt: d.passwordSalt,
    role: d.role || 'member', active: d.active === false ? 0 : 1,
    tokenVersion: d.tokenVersion || 0, createdAt: d.createdAt,
    orgId: d.orgId || null, wardId: d.wardId || null
  } : null;
  const mapSubscription = d => d ? {
    id: d._id, userId: d.userId, endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth,
    createdAt: d.createdAt, lastDigestAt: d.lastDigestAt || 0
  } : null;

  return {
    kind: 'mongo',
    location: `MongoDB (${database.databaseName})`,
    get freshStart(){ return freshStart; },

    async init(){ /* connection established above */ },

    async loadRawConfig(){
      const doc = await configCol.findOne({ _id: 'config' });
      if(!doc) return {};
      const { _id, ...rest } = doc;
      return rest;
    },
    async saveRawConfig(cfg){
      await configCol.updateOne({ _id: 'config' }, { $set: cfg }, { upsert: true });
    },

    async getPatientRaw(id){
      const d = await patients.findOne({ _id: id }, { projection: { updatedAt: 1, data: 1 } });
      return d ? { updatedAt: d.updatedAt, data: d.data } : null;
    },
    async upsertPatient(id, updatedAt, deleted, dataStr){
      await patients.updateOne(
        { _id: id },
        { $set: { updatedAt, deleted: deleted ? 1 : 0, data: dataStr } },
        { upsert: true }
      );
    },
    async getChangedSince(since){
      const arr = await patients.find({ updatedAt: { $gt: since } }).toArray();
      return arr.map(mapRow);
    },
    async getActive(){
      const arr = await patients.find({ deleted: 0 }).toArray();
      return arr.map(mapRow);
    },
    async getAll(){
      const arr = await patients.find({}).toArray();
      return arr.map(mapRow);
    },
    async deleteAllPatients(){ await patients.deleteMany({}); },
    async countPatients(){ return await patients.countDocuments(); },

    async getUserByUsername(username){
      return mapUser(await users.findOne({ username }));
    },
    async getUserById(id){
      return mapUser(await users.findOne({ _id: id }));
    },
    async getAllUsers(){
      const arr = await users.find({}).sort({ createdAt: 1 }).toArray();
      return arr.map(mapUser);
    },
    async listUsersByOrg(orgId){
      const arr = await users.find({ orgId }).sort({ createdAt: 1 }).toArray();
      return arr.map(mapUser);
    },
    async hasInstanceAdmin(){
      const row = await users.findOne({ role: 'admin', active: 1, $or: [{ orgId: null }, { orgId: { $exists: false } }] });
      return !!row;
    },
    async countUsers(){ return await users.countDocuments(); },
    async createUser(user){
      await users.insertOne({
        _id: user.id, username: user.username, passwordHash: user.passwordHash,
        passwordSalt: user.passwordSalt, role: user.role || 'member',
        active: user.active === false ? 0 : 1, tokenVersion: user.tokenVersion || 0,
        createdAt: user.createdAt || Date.now(),
        orgId: user.orgId ?? null, wardId: user.wardId ?? null
      });
    },
    async updateUser(id, patch){
      const fields = Object.keys(patch || {}).filter(k => USER_PATCH_FIELDS.includes(k));
      if(!fields.length) return;
      const set = {};
      for(const f of fields) set[f] = f === 'active' ? (patch[f] ? 1 : 0) : patch[f];
      await users.updateOne({ _id: id }, { $set: set });
    },

    async createSubscription(sub){
      // $set only the mutable fields; _id/createdAt/lastDigestAt are fixed at
      // insert time and must never be touched on a re-subscribe (same
      // endpoint) — $set-ing _id on an existing doc would throw.
      await pushSubscriptions.updateOne(
        { endpoint: sub.endpoint },
        {
          $set: { userId: sub.userId, p256dh: sub.p256dh, auth: sub.auth },
          $setOnInsert: {
            _id: sub.id, endpoint: sub.endpoint,
            createdAt: sub.createdAt || Date.now(), lastDigestAt: sub.lastDigestAt || 0
          }
        },
        { upsert: true }
      );
    },
    async getSubscriptionsByUserId(userId){
      const arr = await pushSubscriptions.find({ userId }).toArray();
      return arr.map(mapSubscription);
    },
    async getAllSubscriptions(){
      const arr = await pushSubscriptions.find({}).toArray();
      return arr.map(mapSubscription);
    },
    async deleteSubscription(endpoint){
      await pushSubscriptions.deleteOne({ endpoint });
    },
    async updateSubscription(endpoint, patch){
      const fields = Object.keys(patch || {}).filter(k => SUBSCRIPTION_PATCH_FIELDS.includes(k));
      if(!fields.length) return;
      const set = {};
      for(const f of fields) set[f] = patch[f];
      await pushSubscriptions.updateOne({ endpoint }, { $set: set });
    },

    // ---- multi-tenant hierarchy (roadmap Phase 1) — unused until MULTI_TENANT is on ----
    async createOrganization(org){
      await organizations.insertOne({
        _id: org.id, name: org.name, plan: org.plan || 'free', createdAt: org.createdAt || Date.now()
      });
    },
    async getOrganization(id){
      const d = await organizations.findOne({ _id: id });
      return d ? { id: d._id, name: d.name, plan: d.plan, createdAt: d.createdAt } : null;
    },
    async listOrganizations(){
      const arr = await organizations.find({}).sort({ createdAt: 1 }).toArray();
      return arr.map(d => ({ id: d._id, name: d.name, plan: d.plan, createdAt: d.createdAt }));
    },
    async createHospital(hospital){
      await hospitals.insertOne({
        _id: hospital.id, orgId: hospital.orgId, name: hospital.name, createdAt: hospital.createdAt || Date.now()
      });
    },
    async getHospital(id){
      const d = await hospitals.findOne({ _id: id });
      return d ? { id: d._id, orgId: d.orgId, name: d.name, createdAt: d.createdAt } : null;
    },
    async listHospitalsByOrg(orgId){
      const arr = await hospitals.find({ orgId }).sort({ createdAt: 1 }).toArray();
      return arr.map(d => ({ id: d._id, orgId: d.orgId, name: d.name, createdAt: d.createdAt }));
    },
    async createDepartment(dep){
      await departments.insertOne({
        _id: dep.id, hospitalId: dep.hospitalId, name: dep.name,
        specialty: dep.specialty || 'ortho', createdAt: dep.createdAt || Date.now()
      });
    },
    async getDepartment(id){
      const d = await departments.findOne({ _id: id });
      return d ? { id: d._id, hospitalId: d.hospitalId, name: d.name, specialty: d.specialty, createdAt: d.createdAt } : null;
    },
    async listDepartmentsByHospital(hospitalId){
      const arr = await departments.find({ hospitalId }).sort({ createdAt: 1 }).toArray();
      return arr.map(d => ({ id: d._id, hospitalId: d.hospitalId, name: d.name, specialty: d.specialty, createdAt: d.createdAt }));
    },
    async createWard(ward){
      await wards.insertOne({ _id: ward.id, departmentId: ward.departmentId, name: ward.name, createdAt: ward.createdAt || Date.now() });
    },
    async getWard(id){
      const d = await wards.findOne({ _id: id });
      return d ? { id: d._id, departmentId: d.departmentId, name: d.name, createdAt: d.createdAt } : null;
    },
    async listWardsByDepartment(departmentId){
      const arr = await wards.find({ departmentId }).sort({ createdAt: 1 }).toArray();
      return arr.map(d => ({ id: d._id, departmentId: d.departmentId, name: d.name, createdAt: d.createdAt }));
    },
    async createUnit(unit){
      await units.insertOne({ _id: unit.id, wardId: unit.wardId, name: unit.name, createdAt: unit.createdAt || Date.now() });
    },
    async getUnit(id){
      const d = await units.findOne({ _id: id });
      return d ? { id: d._id, wardId: d.wardId, name: d.name, createdAt: d.createdAt } : null;
    },
    async listUnitsByWard(wardId){
      const arr = await units.find({ wardId }).sort({ createdAt: 1 }).toArray();
      return arr.map(d => ({ id: d._id, wardId: d.wardId, name: d.name, createdAt: d.createdAt }));
    },

    // MongoDB upserts are individually atomic; multi-doc transactions aren't
    // needed for this app's small sync batches, so these are no-ops.
    async begin(){}, async commit(){}, async rollback(){},

    async saveImage(buffer, ext){
      const name = crypto.randomBytes(12).toString('hex') + ext;
      await images.insertOne({ _id: name, contentType: extToContentType(ext), data: new Binary(buffer) });
      return `/api/images/${name}`;
    },
    async getImage(name){
      const d = await images.findOne({ _id: name });
      if(!d) return null;
      const raw = d.data && d.data.buffer ? d.data.buffer : d.data;
      return { buffer: Buffer.from(raw), contentType: d.contentType || 'image/jpeg' };
    },
    async deleteImage(name){
      const res = await images.deleteOne({ _id: name });
      return res.deletedCount > 0;
    },

    backupFilePath(){ return null; },

    async autoBackup(){ /* the managed database handles durability */ return null; },

    async close(){ try{ await client.close(); }catch{ /* ignore */ } }
  };
}
