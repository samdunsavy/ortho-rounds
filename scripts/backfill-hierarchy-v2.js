/* v2 migration: re-derive the org/hospital/department/unit/ward tree in the
   NEW shape (Department -> Unit -> optional Ward) directly from each active
   patient's free-text `unit`/`ward` labels, and stamp each patient's
   denormalized ancestry { unitId, departmentId, hospitalId, orgId } plus an
   optional `wardId`.

   Supersedes scripts/backfill-hierarchy.js. That v1 script modeled the OLD
   shape (Ward -> Unit) and, critically, minted one Unit per distinct Ward
   label — fragmenting a single clinical team across many Units whenever they
   covered more than one ward. v2 consolidates: one Unit per distinct unit
   label under the department, with an optional Ward nested under it per
   distinct ward label. A blank ward label means the patient simply has no
   wardId — ward is optional, unit is not.

   Store-agnostic: works against either the SQLite or Mongo backend behind
   the same store interface used by server.js. Idempotent: unit/ward ids are
   deterministic, so re-running never creates duplicates and re-stamps
   patients identically.

   Usage:
     node scripts/backfill-hierarchy-v2.js [--single-bucket]

   Env (mirrors how server.js builds its store):
     MONGODB_URI     — when set, uses the Mongo backend.
     ORTHO_DATA_DIR  — SQLite data directory (defaults to ./data).
*/

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../storage.js';
import { resolveAncestry } from '../hierarchy.js';

const DEFAULT_ORG_ID = 'bfv2-org';
const DEFAULT_HOSPITAL_ID = 'bfv2-hosp';
const DEFAULT_DEPARTMENT_ID = 'bfv2-dep';

function norm(s){
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
}

async function ensureDefaultTree(store){
  const created = { hospitals: 0, departments: 0, units: 0, wards: 0 };

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

  return { orgId: org.id, departmentId: department.id, created };
}

async function ensureUnit(store, departmentId, unitKey, unitName, created){
  const id = `bfv2-unit-${unitKey}`;
  let unit = await store.getUnit(id);
  if(!unit){
    await store.createUnit({ id, departmentId, name: unitName, createdAt: Date.now() });
    unit = await store.getUnit(id);
    created.units++;
  }
  return unit;
}

async function ensureWard(store, unitId, unitKey, wardKey, wardName, created){
  const id = `bfv2-ward-${unitKey}-${wardKey}`;
  let ward = await store.getWard(id);
  if(!ward){
    await store.createWard({ id, unitId, name: wardName, createdAt: Date.now() });
    ward = await store.getWard(id);
    created.wards++;
  }
  return ward;
}

// -- user re-pointing -------------------------------------------------------

const NODE_GETTERS = {
  unit: (store, id) => store.getUnit(id),
  ward: (store, id) => store.getWard(id),
  department: (store, id) => store.getDepartment(id),
  hospital: (store, id) => store.getHospital(id),
  org: (store, id) => store.getOrganization(id),
};

async function assignmentResolves(store, type, id){
  if(!type || !id) return false;
  switch(type){
    case 'unit':
      return !!(await resolveAncestry(store, id));
    case 'ward': {
      const ward = await store.getWard(id);
      return ward ? !!(await resolveAncestry(store, ward.unitId)) : false;
    }
    case 'department': {
      const dep = await store.getDepartment(id);
      return dep ? !!(await store.getHospital(dep.hospitalId)) : false;
    }
    case 'hospital': {
      const hosp = await store.getHospital(id);
      return hosp ? !!(await store.getOrganization(hosp.orgId)) : false;
    }
    case 'org':
      return !!(await store.getOrganization(id));
    default:
      return false;
  }
}

// Best-effort recovery of the label a stale (pre-migration) node was
// carrying, so a re-pointed user can land on the consolidated Unit that now
// represents that same label rather than being dumped straight to org root.
async function labelForStaleAssignment(store, type, id){
  const getter = NODE_GETTERS[type];
  if(!getter) return null;
  const node = await getter(store, id);
  return node && node.name ? norm(node.name) : null;
}

export async function backfillV2(store, { singleBucket = false } = {}){
  const { orgId, departmentId, created } = await ensureDefaultTree(store);

  // unitKey -> { unit, wardCache: Map(wardKey -> ward) }, so re-runs and
  // repeated labels within a single run only look up / create once.
  const unitCache = new Map();

  async function getOrCreateUnit(rawUnit){
    const unitKey = singleBucket ? 'general' : (norm(rawUnit) || 'general');
    let entry = unitCache.get(unitKey);
    if(!entry){
      const unitName = unitKey === 'general' ? 'General' : String(rawUnit).trim();
      const unit = await ensureUnit(store, departmentId, unitKey, unitName, created);
      entry = { unitKey, unit, wardCache: new Map() };
      unitCache.set(unitKey, entry);
    }
    return entry;
  }

  async function getOrCreateWard(entry, rawWard){
    const wardKey = norm(rawWard);
    if(!wardKey) return null;
    let ward = entry.wardCache.get(wardKey);
    if(!ward){
      const wardName = String(rawWard).trim();
      ward = await ensureWard(store, entry.unit.id, entry.unitKey, wardKey, wardName, created);
      entry.wardCache.set(wardKey, ward);
    }
    return ward;
  }

  const patients = await store.getActive();
  let stamped = 0;

  for(const row of patients){
    if(row.deleted) continue; // getActive() already filters, but be defensive.
    const data = JSON.parse(row.data);

    const rawUnit = singleBucket ? '' : data.unit;
    const rawWard = singleBucket ? '' : data.ward;

    const entry = await getOrCreateUnit(rawUnit);
    const ward = norm(rawWard) ? await getOrCreateWard(entry, rawWard) : null;

    const ancestry = await resolveAncestry(store, entry.unit.id);
    data.unitId = ancestry.unitId;
    data.departmentId = ancestry.departmentId;
    data.hospitalId = ancestry.hospitalId;
    data.orgId = ancestry.orgId;
    data.unit = entry.unit.name;

    if(ward){
      data.wardId = ward.id;
      data.ward = ward.name;
    } else {
      delete data.wardId;
      data.ward = '';
    }

    await store.upsertPatient(row.id, row.updatedAt, row.deleted, JSON.stringify(data));
    stamped++;
  }

  // No user ever gets stranded: any existing non-instance-admin user whose
  // assignment doesn't resolve under the new tree (stale v1 node, or none at
  // all) must land somewhere before MULTI_TENANT flips on. Prefer the
  // consolidated Unit that now carries their old node's label; fall back to
  // the org root.
  let assignedUsers = 0;
  const users = await store.getAllUsers();
  for(const user of users){
    const isInstanceAdmin = user.role === 'admin' && !user.orgId;
    if(isInstanceAdmin) continue;

    const hasAssignment = !!(user.assignmentType && user.assignmentId);
    if(hasAssignment && await assignmentResolves(store, user.assignmentType, user.assignmentId)) continue;

    let targetType = 'org';
    let targetId = orgId;

    if(hasAssignment){
      const label = await labelForStaleAssignment(store, user.assignmentType, user.assignmentId);
      if(label){
        const candidate = await store.getUnit(`bfv2-unit-${label}`);
        if(candidate){
          targetType = 'unit';
          targetId = candidate.id;
        }
      }
    }

    await store.updateUser(user.id, { assignmentType: targetType, assignmentId: targetId });
    assignedUsers++;
  }

  return {
    orgId,
    created,
    stamped,
    assignedUsers
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
    const result = await backfillV2(store, { singleBucket });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await store.close();
  }
}
