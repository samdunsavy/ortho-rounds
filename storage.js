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

const MAX_BACKUPS = 7;

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
        console.warn('  Auto-backup failed:', err.message);
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
  await patients.createIndex({ updatedAt: 1 });

  const freshStart = (await patients.estimatedDocumentCount()) === 0;
  const mapRow = d => d ? { id: d._id, updatedAt: d.updatedAt, deleted: d.deleted ? 1 : 0, data: d.data } : null;

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

    backupFilePath(){ return null; },

    async autoBackup(){ /* the managed database handles durability */ return null; },

    async close(){ try{ await client.close(); }catch{ /* ignore */ } }
  };
}
