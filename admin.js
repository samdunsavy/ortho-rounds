/* Pure builders for the MULTI_TENANT admin console: org tree + stats.
   Stats are computed app-layer from getActive() + patient JSON (wardId,
   status) — same pattern as the sync scope filter; no schema changes.
   See docs/superpowers/specs/2026-07-22-admin-console-design.md. */

const STATUS_BUCKETS = ['postop', 'preop', 'conservative', 'fordischarge'];

function parseLivePatients(rows){
  const out = [];
  for(const row of rows){
    try{
      const obj = JSON.parse(row.data);
      out.push({ wardId: obj?.wardId, status: obj?.status, updatedAt: row.updatedAt });
    }catch{ /* malformed row — skip */ }
  }
  return out;
}

function emptyWardStats(){
  const byStatus = {};
  for(const s of STATUS_BUCKETS) byStatus[s] = 0;
  return { livePatients: 0, byStatus, users: 0, lastActivity: null };
}

export async function buildOrgTree(store, orgId){
  const hospitals = await store.listHospitalsByOrg(orgId);
  const users = await store.listUsersByOrg(orgId);
  const patients = parseLivePatients(await store.getActive());

  const outHospitals = [];
  const wardStats = new Map(); // wardId -> stats object (shared with output)
  for(const h of hospitals){
    const wards = await store.listDepartmentsByHospital(h.id);
    outHospitals.push({
      id: h.id, name: h.name,
      wards: wards.map(w => {
        const stats = emptyWardStats();
        wardStats.set(w.id, stats);
        return { id: w.id, name: w.name, specialty: w.specialty, stats };
      })
    });
  }

  for(const u of users){
    const stats = u.wardId ? wardStats.get(u.wardId) : null;
    if(stats) stats.users++;
  }

  let livePatients = 0;
  for(const p of patients){
    const stats = p.wardId ? wardStats.get(p.wardId) : null;
    if(!stats) continue; // other orgs' wards or unassigned
    livePatients++;
    stats.livePatients++;
    if(STATUS_BUCKETS.includes(p.status)) stats.byStatus[p.status]++;
    if(stats.lastActivity === null || p.updatedAt > stats.lastActivity) stats.lastActivity = p.updatedAt;
  }

  let departments = 0;
  for(const h of outHospitals) departments += h.wards.length;

  return {
    totals: {
      hospitals: outHospitals.length,
      departments,
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
