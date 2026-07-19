/* Opt-in feature-usage telemetry.
   ------------------------------------------------------------
   Local-only by default, always. This module counts *which features get
   used* (sync calls, which AI endpoint, login) — never patient data, never
   free text, never anything from a patient record.

   Three ways this can be read, in increasing order of exposure:
     1. In-process only (default): counts live in memory for this run and
        are visible to the instance's own admin via GET /api/admin/telemetry.
        Nothing leaves the machine. This is the state for every self-hosted
        install unless the operator does BOTH of the following:
     2. + ORTHO_TELEMETRY_URL set: still nothing is sent anywhere by itself.
     3. + ORTHO_FLAG_TELEMETRY_EXPORT=1 set (double opt-in, alongside #2):
        an anonymized counts-only snapshot is POSTed on an interval to the
        configured URL. Missing either #2 or #3 means no network call is
        ever made — this mirrors the commitment in POLICY.md.

   This is the measurement tool referenced in ROADMAP.md Phase 0 — it exists
   so future engineering time (Phase 1+) is spent on features people already
   use heavily, not guesses.
*/

import { isEnabled } from './flags.js';
import { logWarn } from './logger.js';

const startedAt = Date.now();
const counts = Object.create(null);

export function recordEvent(name){
  if(typeof name !== 'string' || !name) return;
  counts[name] = (counts[name] || 0) + 1;
}

export function getSnapshot(){
  return {
    startedAt,
    now: Date.now(),
    counts: { ...counts }
  };
}

function exportConfigured(){
  return !!process.env.ORTHO_TELEMETRY_URL && isEnabled('TELEMETRY_EXPORT');
}

export function isExportEnabled(){
  return exportConfigured();
}

let timer = null;

export function startExportLoop(intervalMs = 1000 * 60 * 60){
  if(!exportConfigured() || timer) return;
  const url = process.env.ORTHO_TELEMETRY_URL;
  timer = setInterval(async () => {
    try{
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: 'ortho-rounds', ...getSnapshot() })
      });
    }catch(err){
      logWarn('telemetry_export_failed', { errMessage: err.message });
    }
  }, intervalMs);
  if(timer.unref) timer.unref();
}

export function stopExportLoop(){
  if(timer){ clearInterval(timer); timer = null; }
}
