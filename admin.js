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
      out.push({ unitId: obj?.unitId, status: obj?.status, updatedAt: row.updatedAt });
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
  const hospitals = await store.listHospitalsByOrg(orgId);
  const users = await store.listUsersByOrg(orgId);
  const patients = parseLivePatients(await store.getActive());

  const outHospitals = [];
  const departmentStats = new Map(); // departmentId -> stats object (shared with output)
  const wardStats = new Map();       // wardId -> stats object
  const unitStats = new Map();       // unitId -> stats object
  const unitToWard = new Map();
  const unitToDepartment = new Map();

  let wardCount = 0, unitCount = 0;

  for(const h of hospitals){
    const departments = await store.listDepartmentsByHospital(h.id);
    const outDepartments = [];
    for(const dep of departments){
      const depStats = emptyStats();
      departmentStats.set(dep.id, depStats);

      const wards = await store.listWardsByDepartment(dep.id);
      const outWards = [];
      for(const ward of wards){
        wardCount++;
        const wStats = emptyStats();
        wardStats.set(ward.id, wStats);

        const units = await store.listUnitsByWard(ward.id);
        const outUnits = [];
        for(const unit of units){
          unitCount++;
          const uStats = emptyStats();
          unitStats.set(unit.id, uStats);
          unitToWard.set(unit.id, ward.id);
          unitToDepartment.set(unit.id, dep.id);
          outUnits.push({ id: unit.id, name: unit.name, stats: uStats });
        }
        outWards.push({ id: ward.id, name: ward.name, stats: wStats, units: outUnits });
      }
      outDepartments.push({ id: dep.id, name: dep.name, specialty: dep.specialty, stats: depStats, wards: outWards });
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
    const wardId = unitToWard.get(p.unitId);
    if(wardId) addPatientToStats(wardStats.get(wardId), p);
    const depId = unitToDepartment.get(p.unitId);
    if(depId) addPatientToStats(departmentStats.get(depId), p);
  }

  let departments = 0;
  for(const h of outHospitals) departments += h.departments.length;

  return {
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
