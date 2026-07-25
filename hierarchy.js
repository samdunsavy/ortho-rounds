/* Tree walking for the MULTI_TENANT hierarchy:
   organizations → hospitals → departments → units → wards.
   Unit is the scoping leaf; ward is an optional location under a unit. */

export async function resolveAncestry(store, unitId){
  if(!unitId) return null;
  const unit = await store.getUnit(unitId);
  if(!unit) return null;
  const dep = await store.getDepartment(unit.departmentId);
  if(!dep) return null;
  const hospital = await store.getHospital(dep.hospitalId);
  if(!hospital) return null;
  return { unitId: unit.id, departmentId: dep.id, hospitalId: hospital.id, orgId: hospital.orgId };
}

export async function wardUnitId(store, wardId){
  if(!wardId) return null;
  const ward = await store.getWard(wardId);
  return ward ? ward.unitId : null;
}

async function unitsUnderDepartment(store, depId, out){
  for(const u of await store.listUnitsByDepartment(depId)) out.add(u.id);
}
async function unitsUnderHospital(store, hospitalId, out){
  for(const d of await store.listDepartmentsByHospital(hospitalId)) await unitsUnderDepartment(store, d.id, out);
}
async function unitsUnderOrg(store, orgId, out){
  for(const h of await store.listHospitalsByOrg(orgId)) await unitsUnderHospital(store, h.id, out);
}

export async function listUnitIdsUnder(store, node){
  const out = new Set();
  if(!node || !node.id) return out;
  switch(node.type){
    case 'unit': out.add(node.id); break;
    case 'ward': { const uid = await wardUnitId(store, node.id); if(uid) out.add(uid); break; }
    case 'department': await unitsUnderDepartment(store, node.id, out); break;
    case 'hospital': await unitsUnderHospital(store, node.id, out); break;
    case 'org': await unitsUnderOrg(store, node.id, out); break;
  }
  return out;
}
