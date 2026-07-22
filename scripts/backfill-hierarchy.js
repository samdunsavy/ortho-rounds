/* One-time, idempotent migration: reconstruct the org/hospital/department/
   ward/unit tree from existing patients' free-text `ward`/`unit` strings,
   and stamp each active patient's denormalized ancestry
   { unitId, wardId, departmentId, hospitalId, orgId }.

   Store-agnostic: works against either the SQLite or Mongo backend behind
   the same store interface used by server.js.

   Usage:
     node scripts/backfill-hierarchy.js [--single-bucket]

   Env (mirrors how server.js builds its store):
     MONGODB_URI     — when set, uses the Mongo backend.
     ORTHO_DATA_DIR  — SQLite data directory (defaults to ./data).
*/

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../storage.js';
import { resolveAncestry } from '../hierarchy.js';

const DEFAULT_ORG_ID = 'backfill-org';
const DEFAULT_HOSPITAL_ID = 'backfill-hosp';
const DEFAULT_DEPARTMENT_ID = 'backfill-dep';

function norm(s){
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
}

async function ensureDefaultTree(store){
  const created = { hospitals: 0, departments: 0, wards: 0, units: 0 };

  let org = await store.getOrganization(DEFAULT_ORG_ID);
  if(!org){
    await store.createOrganization({ id: DEFAULT_ORG_ID, name: 'Default', plan: 'free', createdAt: Date.now() });
    org = await store.getOrganization(DEFAULT_ORG_ID);
  }

  let hospital = await store.getHospital(DEFAULT_HOSPITAL_ID);
  if(!hospital){
    await store.createHospital({ id: DEFAULT_HOSPITAL_ID, orgId: DEFAULT_ORG_ID, name: 'Default', createdAt: Date.now() });
    hospital = await store.getHospital(DEFAULT_HOSPITAL_ID);
    created.hospitals++;
  }

  let department = await store.getDepartment(DEFAULT_DEPARTMENT_ID);
  if(!department){
    await store.createDepartment({ id: DEFAULT_DEPARTMENT_ID, hospitalId: DEFAULT_HOSPITAL_ID, name: 'Ortho', specialty: 'ortho', createdAt: Date.now() });
    department = await store.getDepartment(DEFAULT_DEPARTMENT_ID);
    created.departments++;
  }

  return { orgId: org.id, hospitalId: hospital.id, departmentId: department.id, created };
}

async function ensureWard(store, departmentId, wardKey, wardName, created){
  const id = `backfill-ward-${wardKey}`;
  let ward = await store.getWard(id);
  if(!ward){
    await store.createWard({ id, departmentId, name: wardName, createdAt: Date.now() });
    ward = await store.getWard(id);
    created.wards++;
  }
  return ward;
}

async function ensureUnit(store, wardId, wardKey, unitKey, unitName, created){
  const id = `backfill-unit-${wardKey}-${unitKey}`;
  let unit = await store.getUnit(id);
  if(!unit){
    await store.createUnit({ id, wardId, name: unitName, createdAt: Date.now() });
    unit = await store.getUnit(id);
    created.units++;
  }
  return unit;
}

export async function backfill(store, { singleBucket = false } = {}){
  const { orgId, departmentId, created } = await ensureDefaultTree(store);

  // Cache of wardKey/unitKey -> unit id, so we only look up / create once
  // per bucket per run, and re-runs stay idempotent.
  const wardCache = new Map(); // wardKey -> { ward, unitCache: Map(unitKey -> unit) }

  async function getOrCreateUnit(rawWard, rawUnit){
    const wardKey = singleBucket ? 'general' : (norm(rawWard) || 'general');
    const unitKey = singleBucket ? 'general' : (norm(rawUnit) || 'general');

    let entry = wardCache.get(wardKey);
    if(!entry){
      const wardName = wardKey === 'general' ? 'General' : String(rawWard).trim();
      const ward = await ensureWard(store, departmentId, wardKey, wardName, created);
      entry = { ward, unitCache: new Map() };
      wardCache.set(wardKey, entry);
    }

    let unit = entry.unitCache.get(unitKey);
    if(!unit){
      const unitName = unitKey === 'general' ? 'General' : String(rawUnit).trim();
      unit = await ensureUnit(store, entry.ward.id, wardKey, unitKey, unitName, created);
      entry.unitCache.set(unitKey, unit);
    }

    return { ward: entry.ward, unit };
  }

  const patients = await store.getActive();
  let stamped = 0;

  for(const row of patients){
    if(row.deleted) continue; // getActive() already filters, but be defensive.
    const data = JSON.parse(row.data);

    const rawWard = singleBucket ? '' : data.ward;
    const rawUnit = singleBucket ? '' : data.unit;
    const { ward, unit } = await getOrCreateUnit(rawWard, rawUnit);

    const ancestry = await resolveAncestry(store, unit.id);
    data.unitId = ancestry.unitId;
    data.wardId = ancestry.wardId;
    data.departmentId = ancestry.departmentId;
    data.hospitalId = ancestry.hospitalId;
    data.orgId = ancestry.orgId;
    data.ward = ward.name;
    data.unit = unit.name;

    await store.upsertPatient(row.id, row.updatedAt, row.deleted, JSON.stringify(data));
    stamped++;
  }

  return {
    orgId,
    created,
    stamped
  };
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}` ||
      import.meta.url === `file://${path.resolve(process.argv[1] || '')}`;
  } catch {
    return false;
  }
})();

if(isMain){
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const DATA_DIR = process.env.ORTHO_DATA_DIR
    ? path.resolve(process.env.ORTHO_DATA_DIR)
    : path.join(__dirname, '..', 'data');
  const MONGODB_URI = process.env.MONGODB_URI || '';
  const singleBucket = process.argv.includes('--single-bucket');

  const store = await createStore({ dataDir: DATA_DIR, mongoUri: MONGODB_URI });
  await store.init();
  try {
    const result = await backfill(store, { singleBucket });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await store.close();
  }
}
