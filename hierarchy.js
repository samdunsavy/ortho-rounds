/* Tree walking for the MULTI_TENANT hierarchy:
   organizations → hospitals → departments → wards → units.
   Pure store-interface consumers; no backend specifics. */

export async function resolveAncestry(store, unitId){
  if(!unitId) return null;
  const unit = await store.getUnit(unitId);
  if(!unit) return null;
  const ward = await store.getWard(unit.wardId);
  if(!ward) return null;
  const dep = await store.getDepartment(ward.departmentId);
  if(!dep) return null;
  const hospital = await store.getHospital(dep.hospitalId);
  if(!hospital) return null;
  return { unitId: unit.id, wardId: ward.id, departmentId: dep.id, hospitalId: hospital.id, orgId: hospital.orgId };
}

// NOTE (Ward/Unit Re-model Task 1, step 5): mechanical rename only — the
// tree walk here still assumes the OLD ward-holds-units shape (only the
// method names were swapped to ones that exist post-flip so this module
// loads). Task 2 owns rewriting this to unit->department->hospital->org.
async function unitsUnderWard(store, wardId, out){
  for(const u of await store.listWardsByUnit(wardId)) out.add(u.id);
}
async function unitsUnderDepartment(store, depId, out){
  for(const w of await store.listUnitsByDepartment(depId)) await unitsUnderWard(store, w.id, out);
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
    case 'ward': await unitsUnderWard(store, node.id, out); break;
    case 'department': await unitsUnderDepartment(store, node.id, out); break;
    case 'hospital': await unitsUnderHospital(store, node.id, out); break;
    case 'org': await unitsUnderOrg(store, node.id, out); break;
  }
  return out;
}
