/* Structural operations for the MULTI_TENANT hierarchy: node resolution,
   emptiness checks, and idempotent server-authoritative re-stamping of
   patient ancestry. Pure store-interface consumers.
   See docs/superpowers/specs/2026-07-23-structural-operations-design.md. */
import { resolveAncestry, listUnitIdsUnder, wardUnitId } from './hierarchy.js';

export const NODE_TYPES = ['org','hospital','department','ward','unit'];
export const PARENT_TYPE = { department: 'hospital', unit: 'department', ward: 'unit' };
const PARENT_FIELD = { department: 'hospitalId', unit: 'departmentId', ward: 'unitId' };

export async function getNode(store, type, id){
  switch(type){
    case 'org': return await store.getOrganization(id);
    case 'hospital': return await store.getHospital(id);
    case 'department': return await store.getDepartment(id);
    case 'ward': return await store.getWard(id);
    case 'unit': return await store.getUnit(id);
    default: return null;
  }
}

export async function nodeOrgId(store, type, id){
  const node = await getNode(store, type, id);
  if(!node) return null;
  switch(type){
    case 'org': return node.id;
    case 'hospital': return node.orgId;
    case 'department': return nodeOrgId(store, 'hospital', node.hospitalId);
    case 'unit': return nodeOrgId(store, 'department', node.departmentId);
    case 'ward': return nodeOrgId(store, 'unit', node.unitId);
    default: return null;
  }
}

// Department -> Unit -> Ward. Unit is the scoping/patient-pinning node;
// ward is an optional leaf location under a unit (Task 4).
export async function childrenOf(store, type, id){
  switch(type){
    case 'org': return await store.listHospitalsByOrg(id);
    case 'hospital': return await store.listDepartmentsByHospital(id);
    case 'department': return await store.listUnitsByDepartment(id);
    case 'unit': return await store.listWardsByUnit(id);
    case 'ward': return [];
    default: return [];
  }
}

export async function unitIdsUnder(store, type, id){
  return await listUnitIdsUnder(store, { type, id });
}

async function labelStamp(store, o, a){
  Object.assign(o, a); // sets unitId/departmentId/hospitalId/orgId from the 4-key ancestry; never touches o.wardId
  const unit = await store.getUnit(a.unitId);
  if(unit) o.unit = unit.name;
  // Ward is optional and not part of ancestry: keep the patient's own wardId
  // only if it still sits under the (possibly new) unit; else drop it.
  if(o.wardId && (await wardUnitId(store, o.wardId)) === a.unitId){
    const ward = await store.getWard(o.wardId);
    if(ward) o.ward = ward.name; else { delete o.wardId; delete o.ward; }
  } else {
    delete o.wardId;
    delete o.ward;
  }
  return o;
}

export async function restampUnits(store, unitIdSet){
  if(!unitIdSet || unitIdSet.size === 0) return 0;
  const rows = await store.getActive();
  let n = 0;
  for(const row of rows){
    let o; try{ o = JSON.parse(row.data); }catch{ continue; }
    if(!o.unitId || !unitIdSet.has(o.unitId)) continue;
    const a = await resolveAncestry(store, o.unitId);
    if(!a) continue;
    await labelStamp(store, o, a);
    const now = Date.now();
    o.updatedAt = now;
    await store.upsertPatient(row.id, now, row.deleted ? 1 : 0, JSON.stringify(o));
    n++;
  }
  return n;
}

export async function restampPatient(store, patientRow, unitId){
  let o; try{ o = JSON.parse(patientRow.data); }catch{ return false; }
  const a = await resolveAncestry(store, unitId);
  if(!a) return false;
  await labelStamp(store, o, a);
  const now = Date.now();
  o.updatedAt = now;
  await store.upsertPatient(patientRow.id, now, patientRow.deleted ? 1 : 0, JSON.stringify(o));
  return true;
}

export async function updateNode(store, type, id, patch){
  const m = { org: 'updateOrganization', hospital: 'updateHospital', department: 'updateDepartment', ward: 'updateWard', unit: 'updateUnit' }[type];
  if(m) await store[m](id, patch);
}
export async function deleteNode(store, type, id){
  const m = { org: 'deleteOrganization', hospital: 'deleteHospital', department: 'deleteDepartment', ward: 'deleteWard', unit: 'deleteUnit' }[type];
  if(m) await store[m](id);
}
export { PARENT_FIELD };
