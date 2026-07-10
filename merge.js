/* Field-aware sync merge for patient records, plus server-authoritative
   attribution stamping (who did what, verified against the logged-in
   account — never trusted from client-supplied text). */

export function mergeChecklistById(localItems, remoteItems){
  const byId = new Map();
  for(const c of (remoteItems || [])){
    if(c && c.id) byId.set(c.id, Object.assign({}, c));
  }
  for(const c of (localItems || [])){
    if(!c || !c.id) continue;
    const r = byId.get(c.id);
    if(!r){ byId.set(c.id, Object.assign({}, c)); continue; }
    const lt = Number(c.updatedAt) || 0;
    const rt = Number(r.updatedAt) || 0;
    byId.set(c.id, lt >= rt ? Object.assign({}, c) : Object.assign({}, r));
  }
  return [...byId.values()];
}

export function mergePlanHistory(localHist, remoteHist){
  const byDate = new Map();
  for(const h of (remoteHist || [])){
    if(h && h.date) byDate.set(h.date, h);
  }
  for(const h of (localHist || [])){
    if(h && h.date) byDate.set(h.date, h);
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function mergeLabsHistory(localHist, remoteHist){
  const byDate = new Map();
  for(const h of (remoteHist || [])){
    if(h && h.date) byDate.set(h.date, h);
  }
  for(const h of (localHist || [])){
    if(h && h.date) byDate.set(h.date, h);
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function mergePatientRecords(local, remote){
  if(!local) return Object.assign({}, remote);
  if(!remote) return Object.assign({}, local);
  const merged = Object.assign({}, remote, local);
  const localTs = Number(local.updatedAt) || 0;
  const remoteTs = Number(remote.updatedAt) || 0;
  if(localTs >= remoteTs){
    merged.postOpChecks = (local.postOpChecks || []).map(c => Object.assign({}, c));
    merged.dischargeChecks = (local.dischargeChecks || []).map(c => Object.assign({}, c));
  }else{
    merged.postOpChecks = mergeChecklistById(local.postOpChecks, remote.postOpChecks);
    merged.dischargeChecks = mergeChecklistById(local.dischargeChecks, remote.dischargeChecks);
  }
  merged.planHistory = mergePlanHistory(local.planHistory, remote.planHistory);
  merged.labs = Object.assign({}, remote.labs || {}, local.labs || {});
  merged.labsHistory = mergeLabsHistory(local.labsHistory, remote.labsHistory);
  const localPlanTs = Number(local.planUpdatedAt) || 0;
  const remotePlanTs = Number(remote.planUpdatedAt) || 0;
  if(remotePlanTs > localPlanTs){
    merged.dailyPlan = remote.dailyPlan;
    merged.dailyPlanDate = remote.dailyPlanDate;
    merged.planUpdatedAt = remotePlanTs;
  }else if(localPlanTs >= remotePlanTs){
    merged.dailyPlan = local.dailyPlan;
    merged.dailyPlanDate = local.dailyPlanDate;
    merged.planUpdatedAt = localPlanTs || merged.planUpdatedAt;
  }
  const localStatusTs = Number(local.statusUpdatedAt) || 0;
  const remoteStatusTs = Number(remote.statusUpdatedAt) || 0;
  if(remoteStatusTs > localStatusTs){
    merged.status = remote.status;
    merged.statusBeforeDischarge = remote.statusBeforeDischarge;
    merged.statusUpdatedAt = remoteStatusTs;
    merged.statusUpdatedBy = remote.statusUpdatedBy;
  }else if(localStatusTs > remoteStatusTs){
    merged.status = local.status;
    merged.statusBeforeDischarge = local.statusBeforeDischarge;
    merged.statusUpdatedAt = localStatusTs;
    merged.statusUpdatedBy = local.statusUpdatedBy;
  }
  merged.updatedAt = Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0);
  return merged;
}

function stampChecklist(items, existingItems, who){
  const existingById = new Map();
  for(const c of (existingItems || [])){
    if(c && c.id) existingById.set(c.id, c);
  }
  for(const item of (items || [])){
    if(!item || item.status !== 'done') continue;
    const prior = existingById.get(item.id);
    // Already done before this request — keep the ORIGINAL attribution,
    // ignoring whatever the client sent (it cannot rewrite history).
    // Newly done in this request — attribute it to who actually made the
    // authenticated request, ignoring whatever the client sent for doneBy.
    item.doneBy = (prior && prior.status === 'done') ? prior.doneBy : who;
  }
}

/**
 * Fills in "who did this" fields on an incoming patient payload using the
 * AUTHENTICATED actor for the current request, diffed against the
 * previously stored record. This is what makes attribution a fact rather
 * than a client-editable string: a client can flip a checklist item to
 * "done" or append a complication, but it can never choose who gets
 * credited for a transition it didn't already have credit for, and it
 * can never rewrite the attribution of something already recorded.
 * `existing` may be null for a brand-new patient record.
 */
export function stampAttribution(patient, existing, actor){
  if(!patient || !actor || !actor.username) return patient;
  const who = actor.username;

  stampChecklist(patient.postOpChecks, existing && existing.postOpChecks, who);
  stampChecklist(patient.dischargeChecks, existing && existing.dischargeChecks, who);

  const existingComplications = (existing && existing.complications) || [];
  (patient.complications || []).forEach((entry, i) => {
    if(!entry) return;
    // Complications are append-only from the client's point of view — an
    // entry beyond the previously stored length is new; anything within
    // that range keeps its original attribution.
    entry.by = i < existingComplications.length ? existingComplications[i].by : who;
  });

  const existingByDate = new Map();
  for(const h of ((existing && existing.planHistory) || [])){
    if(h && h.date) existingByDate.set(h.date, h);
  }
  for(const entry of (patient.planHistory || [])){
    if(!entry || !entry.date) continue;
    const prior = existingByDate.get(entry.date);
    entry.by = prior ? prior.by : who;
  }

  const existingStatus = existing ? existing.status : undefined;
  if(patient.status !== existingStatus){
    if(patient.statusUpdatedAt) patient.statusUpdatedBy = who;
  }else if(existing){
    patient.statusUpdatedBy = existing.statusUpdatedBy;
  }

  return patient;
}
