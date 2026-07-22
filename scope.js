/* Pure scoping logic for MULTI_TENANT auth/sync (roadmap Phase 1).
   Terminology: the `wards` table entity is the DEPARTMENT (access boundary);
   patient `unit`/`ward` strings are metadata with no access semantics.
   See docs/superpowers/specs/2026-07-22-auth-sync-scoping-design.md. */

/** Resolve the set of departments an actor may read/write.
 *  Scope = { unrestricted, wardIds: Set, includeUnassigned }.
 *  Unassigned patients (no wardId) are instance-admin-only: an unassigned
 *  patient cannot be attributed to an org, so org admins never see them. */
export async function resolveScope(actor, store){
  const isAdmin = actor?.role === 'admin';
  if(isAdmin && !actor.orgId){
    return { unrestricted: true, wardIds: new Set(), includeUnassigned: true };
  }
  if(isAdmin){
    const wardIds = new Set();
    const hospitals = await store.listHospitalsByOrg(actor.orgId);
    for(const h of hospitals){
      for(const w of await store.listDepartmentsByHospital(h.id)) wardIds.add(w.id);
    }
    return { unrestricted: false, wardIds, includeUnassigned: false };
  }
  const wardIds = new Set(actor?.wardId ? [actor.wardId] : []);
  return { unrestricted: false, wardIds, includeUnassigned: false };
}

export function canRead(patient, scope){
  if(scope.unrestricted) return true;
  if(!patient?.wardId) return scope.includeUnassigned;
  return scope.wardIds.has(patient.wardId);
}

/** Decide whether a sync write is allowed and which wardId the stored
 *  record must carry. wardId === undefined means "do not force a value". */
export function decideWrite({ incoming, existing, actor, scope }){
  const isAdmin = actor?.role === 'admin';

  if(existing){
    if(!canRead(existing, scope)) return { allow: false };
    if(!isAdmin) return { allow: true, wardId: existing.wardId ?? null };
    const requested = incoming?.wardId;
    if(requested && (scope.unrestricted || scope.wardIds.has(requested))){
      return { allow: true, wardId: requested };
    }
    return { allow: true, wardId: existing.wardId ?? null };
  }

  // New patient
  if(!isAdmin){
    if(!actor?.wardId) return { allow: false };
    return { allow: true, wardId: actor.wardId };
  }
  if(scope.unrestricted){
    return { allow: true, wardId: incoming?.wardId ?? null };
  }
  const requested = incoming?.wardId;
  if(requested) return scope.wardIds.has(requested) ? { allow: true, wardId: requested } : { allow: false };
  if(actor.wardId && scope.wardIds.has(actor.wardId)) return { allow: true, wardId: actor.wardId };
  return { allow: false };
}
