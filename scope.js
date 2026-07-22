/* Unit-based subtree scoping for MULTI_TENANT. A patient is pinned to a Unit
   (leaf) carrying denormalized ancestry; a user is assigned to any node and
   scoped to that node's subtree of units. See
   docs/superpowers/specs/2026-07-22-hierarchy-expansion-design.md. */
import { listUnitIdsUnder, resolveAncestry } from './hierarchy.js';

export async function resolveScope(actor, store){
  const isAdmin = actor?.role === 'admin';
  if(isAdmin && !actor.orgId){
    return { unrestricted: true, unitIds: new Set(), includeUnassigned: true };
  }
  const node = actor?.assignment || (isAdmin && actor.orgId ? { type: 'org', id: actor.orgId } : null);
  const unitIds = node ? await listUnitIdsUnder(store, node) : new Set();
  return { unrestricted: false, unitIds, includeUnassigned: false };
}

export function canRead(patient, scope){
  if(scope.unrestricted) return true;
  if(!patient?.unitId) return scope.includeUnassigned;
  return scope.unitIds.has(patient.unitId);
}

/** Decide whether a write is allowed and the ancestry to stamp.
 *  ancestry === undefined means "leave stored ancestry as-is". */
export async function decideWrite({ incoming, existing, actor, scope, store }){
  const isAdmin = actor?.role === 'admin';

  if(existing){
    if(!canRead(existing, scope)) return { allow: false };
    const requested = incoming?.unitId;
    if(isAdmin && requested && (scope.unrestricted || scope.unitIds.has(requested))){
      return { allow: true, ancestry: await resolveAncestry(store, requested) };
    }
    return { allow: true }; // keep existing ancestry
  }

  // New patient
  const requested = incoming?.unitId;
  if(scope.unrestricted){
    return requested ? { allow: true, ancestry: await resolveAncestry(store, requested) }
                     : { allow: true, ancestry: undefined };
  }
  if(requested){
    return scope.unitIds.has(requested)
      ? { allow: true, ancestry: await resolveAncestry(store, requested) }
      : { allow: false };
  }
  // No explicit unit: only auto-resolvable when the actor is scoped to exactly one unit.
  if(scope.unitIds.size === 1){
    const only = [...scope.unitIds][0];
    return { allow: true, ancestry: await resolveAncestry(store, only) };
  }
  return { allow: false };
}
