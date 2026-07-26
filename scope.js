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

/** Narrow an effective scope to the intersection with a set of unit ids
 *  (the caller's chosen activeScope subtree). Narrow-only: an unrestricted
 *  scope collapses to exactly activeUnitIds; a restricted scope keeps only
 *  the units it already allowed. Unassigned patients are never in an
 *  activeScope subtree, so includeUnassigned is always false. */
export function intersectScope(scope, activeUnitIds){
  if(scope.unrestricted){
    return { unrestricted: false, unitIds: new Set(activeUnitIds), includeUnassigned: false };
  }
  const out = new Set();
  for(const u of scope.unitIds){ if(activeUnitIds.has(u)) out.add(u); }
  return { unrestricted: false, unitIds: out, includeUnassigned: false };
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
    if(requested && requested !== existing.unitId
       && (scope.unrestricted || scope.unitIds.has(requested))){
      const target = await resolveAncestry(store, requested);
      // Org clamp: a move never crosses organizations. First placement of a
      // patient with no org yet is allowed (placement, not a cross-org move).
      const sameOrgOrUnassigned = !existing.orgId || (target && target.orgId === existing.orgId);
      if(target && sameOrgOrUnassigned){
        return { allow: true, ancestry: target, moved: { from: existing.unitId || null, to: requested } };
      }
    }
    // Not a legitimate re-assignment (out of scope, or would cross orgs):
    // force-stamp ancestry from server truth so a client-supplied unitId can
    // never relabel the patient's tree position.
    return { allow: true, ancestry: await resolveAncestry(store, existing.unitId) };
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
