/* READ-ONLY pre-flag-flip verification for the Department → Unit → Ward re-model.
   Checks the invariants that decide whether clinicians see patients or an empty
   list once ORTHO_FLAG_MULTI_TENANT=1. Writes NOTHING.

     MONGODB_URI="mongodb+srv://..." node scripts/verify-remodel.js
*/

import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if(!uri){ console.error('Set MONGODB_URI first.'); process.exit(1); }

function dbNameFromUri(u){
  try{ const p = new URL(u).pathname.replace(/^\//,''); return p || 'ortho'; }
  catch{ return 'ortho'; }
}

const TARGET_ORG = 'bfv2-org';
const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbNameFromUri(uri));

const units = await db.collection('units').find({}).toArray();
const wards = await db.collection('wards').find({}).toArray();
const departments = await db.collection('departments').find({}).toArray();
const hospitals = await db.collection('hospitals').find({}).toArray();

const hospById = new Map(hospitals.map(h => [h._id, h]));
const depById = new Map(departments.map(d => [d._id, d]));
const unitById = new Map(units.map(u => [u._id, u]));
const wardById = new Map(wards.map(w => [w._id, w]));

// unit -> orgId, walking the NEW shape (unit.departmentId -> dep.hospitalId -> hosp.orgId)
function unitOrg(unitId){
  const u = unitById.get(unitId); if(!u || !u.departmentId) return null;
  const d = depById.get(u.departmentId); if(!d) return null;
  const h = hospById.get(d.hospitalId); if(!h) return null;
  return h.orgId || null;
}

console.log('--- Units in the NEW shape (have departmentId) ---');
const newUnits = units.filter(u => u.departmentId);
const staleUnits = units.filter(u => !u.departmentId);
console.log(`new-shape units: ${newUnits.length}  |  stale v1 units (no departmentId): ${staleUnits.length}`);
for(const u of newUnits) console.log(`  ${u._id}  name=${u.name}  org=${unitOrg(u._id)}`);

console.log('\n--- Wards in the NEW shape (have unitId) ---');
const newWards = wards.filter(w => w.unitId);
const staleWards = wards.filter(w => !w.unitId);
console.log(`new-shape wards: ${newWards.length}  |  stale/legacy ward docs (no unitId): ${staleWards.length}`);

console.log('\n--- Patient invariants ---');
const patients = await db.collection('patients').find({ deleted: { $ne: 1 } }).toArray();
let ok = 0, noUnit = 0, unitMissing = 0, unitWrongOrg = 0, wardNotUnderUnit = 0, wardMissing = 0, noWard = 0;
const problems = [];
for(const row of patients){
  let o = {}; try{ o = JSON.parse(row.data); }catch{ problems.push(`${row._id}: unparseable data`); continue; }
  if(!o.unitId){ noUnit++; problems.push(`${row._id}: NO unitId`); continue; }
  const u = unitById.get(o.unitId);
  if(!u){ unitMissing++; problems.push(`${row._id}: unitId ${o.unitId} does not exist`); continue; }
  const org = unitOrg(o.unitId);
  if(org !== TARGET_ORG){ unitWrongOrg++; problems.push(`${row._id}: unit ${o.unitId} resolves to org ${org} (expected ${TARGET_ORG})`); continue; }
  if(o.wardId){
    const w = wardById.get(o.wardId);
    if(!w){ wardMissing++; problems.push(`${row._id}: wardId ${o.wardId} does not exist`); continue; }
    if(w.unitId !== o.unitId){ wardNotUnderUnit++; problems.push(`${row._id}: ward ${o.wardId} is under unit ${w.unitId}, patient is unit ${o.unitId}`); continue; }
  } else { noWard++; }
  ok++;
}
console.log(`active patients      : ${patients.length}`);
console.log(`  fully valid        : ${ok}   (of which ward-less: ${noWard})`);
console.log(`  no unitId          : ${noUnit}`);
console.log(`  unitId missing     : ${unitMissing}`);
console.log(`  unit in wrong org  : ${unitWrongOrg}`);
console.log(`  wardId missing     : ${wardMissing}`);
console.log(`  ward not under unit: ${wardNotUnderUnit}`);
if(problems.length){
  console.log('\nProblems (first 20):');
  for(const p of problems.slice(0, 20)) console.log('  - ' + p);
}

console.log('\n--- User scope simulation (who will see what) ---');
const usersCol = await db.collection('users').find({}).toArray();
const unitsUnderOrg = new Set(newUnits.filter(u => unitOrg(u._id) === TARGET_ORG).map(u => u._id));
const patientUnit = new Map();
for(const row of patients){ let o={}; try{o=JSON.parse(row.data)}catch{}; if(o.unitId) patientUnit.set(row._id, o.unitId); }
for(const u of usersCol){
  const isInstanceAdmin = u.role === 'admin' && !u.orgId;
  if(isInstanceAdmin){ console.log(`  ${u.username.padEnd(16)} INSTANCE ADMIN -> unrestricted (${patients.length} patients)`); continue; }
  let scope = new Set();
  if(u.assignmentType === 'org' && u.assignmentId === TARGET_ORG) scope = unitsUnderOrg;
  else if(u.assignmentType === 'unit') scope = new Set([u.assignmentId]);
  else if(u.assignmentType === 'department') scope = new Set(newUnits.filter(x => x.departmentId === u.assignmentId).map(x => x._id));
  else if(u.assignmentType === 'ward'){ const w = wardById.get(u.assignmentId); if(w) scope = new Set([w.unitId]); }
  let visible = 0;
  for(const [, uid] of patientUnit) if(scope.has(uid)) visible++;
  const flag = visible === 0 ? '  <-- WILL SEE AN EMPTY LIST' : '';
  console.log(`  ${u.username.padEnd(16)} ${String(u.assignmentType)}:${String(u.assignmentId)} -> ${visible} patients${flag}`);
}

await client.close();
console.log('\nDone (read-only, nothing modified).');
