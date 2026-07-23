/* READ-ONLY production inspection for the Phase 1 → Phase 2 hierarchy migration.
   Reports what's actually in the DB so we can pick a safe cutover path.
   Writes NOTHING. Run against production Mongo:

     MONGODB_URI="mongodb+srv://..." node scripts/inspect-prod.js

   (Uses the mongodb driver already in package.json.) */

import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if(!uri){ console.error('Set MONGODB_URI first.'); process.exit(1); }

function dbNameFromUri(u){
  try{ const p = new URL(u).pathname.replace(/^\//,''); return p || 'ortho'; }
  catch{ return 'ortho'; }
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbNameFromUri(uri));

const names = (await db.listCollections().toArray()).map(c => c.name).sort();
console.log('Collections present:', names.join(', ') || '(none)');

async function count(name){ try{ return await db.collection(name).countDocuments(); }catch{ return 'n/a'; } }

console.log('\n--- Tree collections ---');
for(const c of ['organizations','hospitals','wards','departments','units']){
  console.log(`${c.padEnd(14)} ${await count(c)}`);
}

console.log('\n--- Users ---');
const users = await db.collection('users').find({}).toArray();
console.log('total users:', users.length);
const uSummary = users.map(u => ({
  username: u.username, role: u.role || 'member',
  orgId: u.orgId ?? null, wardId: u.wardId ?? null,
  assignmentType: u.assignmentType ?? null, assignmentId: u.assignmentId ?? null
}));
console.log('with Phase-1 wardId set   :', uSummary.filter(u => u.wardId).length);
console.log('with Phase-2 assignment   :', uSummary.filter(u => u.assignmentId).length);
console.log('instance admins (no orgId):', uSummary.filter(u => u.role === 'admin' && !u.orgId).length);
console.table(uSummary);

console.log('\n--- Patients (active) ---');
const patients = await db.collection('patients').find({ deleted: { $ne: 1 } }).toArray();
let withUnitId = 0, withWardId = 0;
const wardVals = {}, unitVals = {};
for(const row of patients){
  let o = {}; try{ o = JSON.parse(row.data); }catch{}
  if(o.unitId) withUnitId++;
  if(o.wardId) withWardId++;
  const w = (String(o.ward||'').trim()) || '(blank)'; wardVals[w] = (wardVals[w]||0)+1;
  const u = (String(o.unit||'').trim()) || '(blank)'; unitVals[u] = (unitVals[u]||0)+1;
}
console.log('active patients            :', patients.length);
console.log('  with Phase-2 unitId      :', withUnitId);
console.log('  with Phase-1 wardId only :', withWardId);
console.log('distinct free-text ward values:', JSON.stringify(wardVals));
console.log('distinct free-text unit values:', JSON.stringify(unitVals));

await client.close();
console.log('\nDone (read-only, nothing modified).');
