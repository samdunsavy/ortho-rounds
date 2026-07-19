/* Feature flags — scaffolding for cloud/multi-tenant features that don't
   exist yet (billing, org management, data pooling, etc).

   Every flag defaults OFF. A self-hosted install that never sets any of
   these env vars behaves exactly as it does today — this file changes
   nothing about current behavior by itself. It exists so later work
   (roadmap Phase 1+) can gate new, cloud-only code paths without touching
   or risking the self-host path at all.

   Usage:
     import { isEnabled } from './flags.js';
     if(isEnabled('MULTI_TENANT')) { ... }
*/

const KNOWN_FLAGS = [
  'MULTI_TENANT',      // org/hospital/ward hierarchy (roadmap Phase 1)
  'BILLING',           // Stripe billing scaffold (roadmap Phase 1)
  'AI_METERING',       // per-org AI usage metering (roadmap Phase 2)
  'DATA_POOLING',      // opt-in de-identified data pooling (roadmap Phase 3)
  'TELEMETRY_EXPORT'   // send anonymized usage counts to ORTHO_TELEMETRY_URL (roadmap Phase 0)
];

function envKey(flag){
  return `ORTHO_FLAG_${flag}`;
}

export function isEnabled(flag){
  const key = envKey(flag);
  const val = process.env[key];
  return val === '1' || val === 'true';
}

export function listFlags(){
  return KNOWN_FLAGS.reduce((acc, flag) => {
    acc[flag] = isEnabled(flag);
    return acc;
  }, {});
}
