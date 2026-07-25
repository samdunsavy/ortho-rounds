/* Pure builders for the MULTI_TENANT admin console: org tree + stats.
   Stats are computed app-layer from getActive() + patient JSON (unitId,
   status) — same pattern as the sync scope filter; no schema changes.
   See docs/superpowers/specs/2026-07-22-hierarchy-expansion-design.md. */

const STATUS_BUCKETS = ['postop', 'preop', 'conservative', 'fordischarge'];

function parseLivePatients(rows){
  const out = [];
  for(const row of rows){
    try{
      const obj = JSON.parse(row.data);
      out.push({ unitId: obj?.unitId, wardId: obj?.wardId, status: obj?.status, updatedAt: row.updatedAt });
    }catch{ /* malformed row — skip */ }
  }
  return out;
}

function emptyStats(){
  const byStatus = {};
  for(const s of STATUS_BUCKETS) byStatus[s] = 0;
  return { livePatients: 0, byStatus, users: 0, lastActivity: null };
}

function addPatientToStats(stats, p){
  stats.livePatients++;
  if(STATUS_BUCKETS.includes(p.status)) stats.byStatus[p.status]++;
  if(stats.lastActivity === null || p.updatedAt > stats.lastActivity) stats.lastActivity = p.updatedAt;
}

export async function buildOrgTree(store, orgId){
  const org = await store.getOrganization(orgId);
  const hospitals = await store.listHospitalsByOrg(orgId);
  const users = await store.listUsersByOrg(orgId);
  const patients = parseLivePatients(await store.getActive());

  const outHospitals = [];
  const departmentStats = new Map(); // departmentId -> stats object (shared with output)
  const unitStats = new Map();       // unitId -> stats object
  const wardStats = new Map();       // wardId -> stats object
  const unitToDepartment = new Map();

  let unitCount = 0, wardCount = 0;

  for(const h of hospitals){
    const departments = await store.listDepartmentsByHospital(h.id);
    const outDepartments = [];
    for(const dep of departments){
      const depStats = emptyStats();
      departmentStats.set(dep.id, depStats);

      const units = await store.listUnitsByDepartment(dep.id);
      const outUnits = [];
      for(const unit of units){
        unitCount++;
        const uStats = emptyStats();
        unitStats.set(unit.id, uStats);
        unitToDepartment.set(unit.id, dep.id);

        const wards = await store.listWardsByUnit(unit.id);
        const outWards = [];
        for(const ward of wards){
          wardCount++;
          const wStats = emptyStats();
          wardStats.set(ward.id, wStats);
          outWards.push({ id: ward.id, name: ward.name, stats: wStats });
        }
        outUnits.push({ id: unit.id, name: unit.name, stats: uStats, wards: outWards });
      }
      outDepartments.push({ id: dep.id, name: dep.name, specialty: dep.specialty, stats: depStats, units: outUnits });
    }
    outHospitals.push({ id: h.id, name: h.name, departments: outDepartments });
  }

  for(const u of users){
    // Legacy per-department assignment (predates node-based assignment).
    const depStats = u.wardId ? departmentStats.get(u.wardId) : null;
    if(depStats) depStats.users++;
    // Node-based assignment (Task 6): counts exactly at the assigned node.
    if(u.assignmentType === 'unit' && unitStats.has(u.assignmentId)) unitStats.get(u.assignmentId).users++;
    else if(u.assignmentType === 'ward' && wardStats.has(u.assignmentId)) wardStats.get(u.assignmentId).users++;
    else if(u.assignmentType === 'department' && departmentStats.has(u.assignmentId)) departmentStats.get(u.assignmentId).users++;
  }

  let livePatients = 0;
  for(const p of patients){
    const uStats = p.unitId ? unitStats.get(p.unitId) : null;
    if(!uStats) continue; // other orgs' units, or unassigned
    livePatients++;
    addPatientToStats(uStats, p);
    const depId = unitToDepartment.get(p.unitId);
    if(depId) addPatientToStats(departmentStats.get(depId), p);
    // Ward is an optional location under the unit — only patients carrying
    // that specific wardId count at the ward level (a subset of the unit's
    // patients, not everyone under the unit).
    if(p.wardId && wardStats.has(p.wardId)) addPatientToStats(wardStats.get(p.wardId), p);
  }

  let departments = 0;
  for(const h of outHospitals) departments += h.departments.length;

  return {
    org: org ? { id: org.id, name: org.name } : null,
    totals: {
      hospitals: outHospitals.length,
      departments,
      wards: wardCount,
      units: unitCount,
      usersActive: users.filter(u => !!u.active).length,
      usersDisabled: users.filter(u => !u.active).length,
      livePatients
    },
    hospitals: outHospitals
  };
}

/* Builds a nested department->unit->ward tree scoped to a single node in the
   hierarchy (as opposed to buildOrgTree, which always returns a whole org).
   Used by GET /api/me/scope so a non-admin member (or a dept/org admin) can
   fetch just their own subtree for the patient-form unit picker, without the
   admin-only /api/admin/org route's org-wide access check. Names + ids only
   — no stats, this isn't the admin console. */
async function unitBranch(store, unit, onlyWardId){
  const wards = await store.listWardsByUnit(unit.id);
  const outWards = onlyWardId ? wards.filter(w => w.id === onlyWardId) : wards;
  return { id: unit.id, name: unit.name, wards: outWards.map(w => ({ id: w.id, name: w.name })) };
}

async function departmentBranch(store, dep, onlyUnitId, onlyWardId){
  const units = await store.listUnitsByDepartment(dep.id);
  const outUnits = [];
  for(const unit of units){
    if(onlyUnitId && unit.id !== onlyUnitId) continue;
    outUnits.push(await unitBranch(store, unit, onlyWardId));
  }
  return { id: dep.id, name: dep.name, units: outUnits };
}

export async function buildScopeTree(store, node){
  const empty = { departments: [] };
  if(!node || !node.id) return empty;
  switch(node.type){
    case 'ward': {
      const ward = await store.getWard(node.id);
      if(!ward) return empty;
      const unit = await store.getUnit(ward.unitId);
      if(!unit) return empty;
      const dep = await store.getDepartment(unit.departmentId);
      if(!dep) return empty;
      return { departments: [await departmentBranch(store, dep, unit.id, ward.id)] };
    }
    case 'unit': {
      const unit = await store.getUnit(node.id);
      if(!unit) return empty;
      const dep = await store.getDepartment(unit.departmentId);
      if(!dep) return empty;
      return { departments: [await departmentBranch(store, dep, unit.id, null)] };
    }
    case 'department': {
      const dep = await store.getDepartment(node.id);
      if(!dep) return empty;
      return { departments: [await departmentBranch(store, dep, null, null)] };
    }
    case 'hospital': {
      const hospital = await store.getHospital(node.id);
      if(!hospital) return empty;
      const deps = await store.listDepartmentsByHospital(hospital.id);
      const out = [];
      for(const dep of deps) out.push(await departmentBranch(store, dep, null, null));
      return { departments: out };
    }
    case 'org': {
      const hospitals = await store.listHospitalsByOrg(node.id);
      const out = [];
      for(const h of hospitals){
        const deps = await store.listDepartmentsByHospital(h.id);
        for(const dep of deps) out.push(await departmentBranch(store, dep, null, null));
      }
      return { departments: out };
    }
    default:
      return empty;
  }
}

export async function buildOrgRollups(store){
  const orgs = await store.listOrganizations();
  const out = [];
  for(const org of orgs){
    const tree = await buildOrgTree(store, org.id);
    out.push({
      id: org.id, name: org.name, plan: org.plan, createdAt: org.createdAt,
      stats: {
        hospitals: tree.totals.hospitals,
        departments: tree.totals.departments,
        users: tree.totals.usersActive + tree.totals.usersDisabled,
        livePatients: tree.totals.livePatients
      }
    });
  }
  return out;
}
