/* Reports what fraction of non-discharged patients have at least one
   uploaded film. Read-only: opens the same store the server uses and
   prints counts. No patient identifiers are printed.

   Run: node --no-warnings scripts/imaging-coverage.js

   Mirrors server.js's store setup exactly (see createStore call in
   main()): ORTHO_DATA_DIR (or ./data) for SQLite, MONGODB_URI for Mongo.
   storage.js exports a single `createStore(opts)` — there is no
   `openStore`, and the store has no `listPatients()`. Instead:
     - store.init() must be called before use (creates tables/dirs if
       the database doesn't exist yet — this is schema setup, not data
       mutation, and is what server.js does on every boot too).
     - store.getActive() returns raw rows { id, updatedAt, deleted, data }
       where `data` is the patient JSON string (deleted=0 rows only).
   This script parses each row's `data` the same way server.js's
   rowToPatient() does. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ORTHO_DATA_DIR
  ? path.resolve(process.env.ORTHO_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const MONGODB_URI = process.env.MONGODB_URI || '';

function rowToPatient(row){
  let obj;
  try{ obj = JSON.parse(row.data); }
  catch{ obj = {}; }
  obj.id = row.id;
  obj.updatedAt = row.updatedAt;
  obj.deleted = !!row.deleted;
  return obj;
}

const store = await createStore({ dataDir: DATA_DIR, mongoUri: MONGODB_URI });
await store.init();

const rows = await store.getActive();
const all = rows.map(rowToPatient);
// Patient records carry no `discharged` boolean — status lifecycle is
// tracked via `status: 'preop' | 'conservative' | 'postop' | 'fordischarge'
// | 'discharged'` (see public/app.js, e.g. `p.status !== 'discharged'`
// gating used throughout for "active" patient lists). "Live" here mirrors
// that existing convention.
const live = all.filter(p => p.status !== 'discharged');
const withFilm = live.filter(p => Array.isArray(p.images) && p.images.length > 0);
const byStatus = {};
for(const p of live){
  const k = p.status || 'unknown';
  byStatus[k] ??= { total: 0, filmed: 0 };
  byStatus[k].total++;
  if(p.images?.length) byStatus[k].filmed++;
}

const pct = (a, b) => b ? Math.round((a / b) * 1000) / 10 : 0;
console.log(`live patients      ${live.length}`);
console.log(`with >=1 film      ${withFilm.length}  (${pct(withFilm.length, live.length)}%)`);
console.log('');
for(const [k, v] of Object.entries(byStatus)){
  console.log(`  ${k.padEnd(14)} ${String(v.filmed).padStart(3)}/${String(v.total).padEnd(3)} (${pct(v.filmed, v.total)}%)`);
}
console.log('');
if(live.length === 0){
  console.log('NO GO — 0 live patients in this environment; measurement must be re-run against production before Task 5.');
} else {
  console.log(pct(withFilm.length, live.length) >= 40
    ? 'GO — film-as-hero is viable.'
    : 'NO GO — demote the film to row scale and lead with identity (spec §8.3).');
}

await store.close?.();
