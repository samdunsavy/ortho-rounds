/* ============================================================
   ORTHO ROUNDS — milestone & template library (ward-synced)
   Loaded before app.js
   ============================================================ */

const TEMPLATE_LIBRARY_ID = '__template_library__';
const CHECKLIST_CATEGORIES = ['nv','mobilization','imaging','antibiotics','drain','wound','other'];
const CHECKLIST_STATUSES = ['pending','done','skipped','na'];

let wardTemplateLibrary = {
  templates: [],
  disabledIds: [],
  updatedAt: 0,
  defaultPostOpTemplateId: null,
  autoApplyPostOp: true
};

function itemDef(id, label, duePod, opts){
  opts = opts || {};
  return {
    id, label,
    duePod: duePod ?? 0,
    duePodEnd: opts.duePodEnd ?? null,
    exactPod: !!opts.exactPod,
    category: opts.category || 'other',
    required: opts.required !== false,
    notes: opts.notes || ''
  };
}

function dischargeItemDef(id, label, opts){
  opts = opts || {};
  return {
    id, label,
    category: opts.category || 'other',
    required: opts.required !== false,
    notes: opts.notes || ''
  };
}

/* ---------- built-in pathway templates ---------- */

function getBuiltinTemplates(){
  const upperOrifItems = [
    itemDef('nv0', 'NV status documented', 0, { category: 'nv' }),
    itemDef('drain0', 'Drain output charted', 0, { category: 'drain', required: false }),
    itemDef('abx0', 'Antibiotics started', 0, { category: 'antibiotics' }),
    itemDef('dvt0', 'DVT prophylaxis', 0, { category: 'antibiotics' }),
    itemDef('mob1', 'Mobilization started', 1, { category: 'mobilization' }),
    itemDef('dress1', 'Dressing check', 1, { category: 'wound' }),
    itemDef('xr3', 'Follow-up X-ray', 3, { exactPod: true, duePodEnd: 3, category: 'imaging' }),
    itemDef('xrout6', 'Outpatient X-ray at 6 weeks', 42, { exactPod: false, category: 'imaging', required: false })
  ];
  const lowerOrifItems = [
    itemDef('nv0', 'NV status documented', 0, { category: 'nv' }),
    itemDef('wb0', 'Weight-bearing status documented', 0, { category: 'mobilization' }),
    itemDef('abx0', 'Antibiotics / DVT prophylaxis', 0, { category: 'antibiotics' }),
    itemDef('mob1', 'Mobilization / knee ROM', 1, { category: 'mobilization' }),
    itemDef('xr3', 'Follow-up X-ray', 3, { exactPod: true, duePodEnd: 4, category: 'imaging' }),
    itemDef('pt5', 'Physio referral', 5, { category: 'mobilization', required: false })
  ];
  const thaItems = [
    itemDef('nv0', 'NV status documented', 0, { category: 'nv' }),
    itemDef('ho0', 'Hip precautions explained', 0, { category: 'mobilization' }),
    itemDef('mob1', 'Mobilization with walker', 1, { category: 'mobilization' }),
    itemDef('dress1', 'Wound review', 1, { category: 'wound' }),
    itemDef('xr3', 'Post-op X-ray', 3, { exactPod: true, duePodEnd: 3, category: 'imaging' }),
    itemDef('pt3', 'Physio assessment', 3, { category: 'mobilization' })
  ];
  const tkaItems = [
    itemDef('nv0', 'NV status documented', 0, { category: 'nv' }),
    itemDef('cpm1', 'CPM / knee ROM', 1, { category: 'mobilization', required: false }),
    itemDef('mob1', 'Mobilization', 1, { category: 'mobilization' }),
    itemDef('xr3', 'Post-op X-ray', 3, { exactPod: true, duePodEnd: 3, category: 'imaging' }),
    itemDef('pt3', 'Physio referral', 3, { category: 'mobilization' })
  ];
  const spineItems = [
    itemDef('nv0', 'NV status documented', 0, { category: 'nv' }),
    itemDef('log0', 'Log roll / spine precautions', 0, { category: 'mobilization' }),
    itemDef('mob2', 'Sit out / ambulate', 2, { category: 'mobilization' }),
    itemDef('dress2', 'Wound review', 2, { category: 'wound' }),
    itemDef('xr3', 'Post-op X-ray', 3, { exactPod: true, duePodEnd: 5, category: 'imaging' }),
    itemDef('drain1', 'Drain removed when appropriate', 1, { category: 'drain', required: false })
  ];
  const exfixItems = [
    itemDef('nv0', 'NV status documented', 0, { category: 'nv' }),
    itemDef('pin0', 'Pin site care', 0, { category: 'wound' }),
    itemDef('xr3', 'Follow-up X-ray', 3, { exactPod: true, duePodEnd: 3, category: 'imaging' }),
    itemDef('mob5', 'Start joint mobilization', 5, { category: 'mobilization' })
  ];
  const softTissueItems = [
    itemDef('wound0', 'Wound inspection', 0, { category: 'wound' }),
    itemDef('abx0', 'Antibiotics', 0, { category: 'antibiotics' }),
    itemDef('dress1', 'Dressing change', 1, { category: 'wound' }),
    itemDef('mob2', 'Mobilization as tolerated', 2, { category: 'mobilization' })
  ];
  const amputationItems = [
    itemDef('stump0', 'Stump inspection / dressing', 0, { category: 'wound' }),
    itemDef('nv0', 'NV status documented', 0, { category: 'nv' }),
    itemDef('pt3', 'Stump physio / shaping', 3, { category: 'mobilization' }),
    itemDef('fit6', 'Prosthetic fitment planning', 14, { category: 'mobilization', required: false })
  ];
  const pedsOrifItems = [
    itemDef('nv0', 'NV status documented', 0, { category: 'nv' }),
    itemDef('cast0', 'Cast / splint check', 0, { category: 'wound' }),
    itemDef('xr3', 'Follow-up X-ray', 3, { exactPod: true, duePodEnd: 3, category: 'imaging' }),
    itemDef('mob7', 'Mobilization review', 7, { category: 'mobilization' })
  ];
  const dischargeStd = [
    dischargeItemDef('meds', 'Discharge medications prescribed', { category: 'other' }),
    dischargeItemDef('f/u', 'Follow-up appointment given', { category: 'other' }),
    dischargeItemDef('implant', 'Implant card / details given', { category: 'other' }),
    dischargeItemDef('physio', 'Physio referral', { category: 'mobilization', required: false }),
    dischargeItemDef('summary', 'Discharge summary done', { category: 'other' })
  ];
  const dischargeTrauma = [
    dischargeItemDef('meds', 'Discharge medications prescribed'),
    dischargeItemDef('implant', 'Implant card / fixation details given'),
    dischargeItemDef('f/u', 'Follow-up / fracture clinic'),
    dischargeItemDef('summary', 'Discharge summary done'),
    dischargeItemDef('mlc', 'MLC / police documentation if applicable', { required: false })
  ];
  const dischargeDaycase = [
    dischargeItemDef('meds', 'Take-home medications'),
    dischargeItemDef('f/u', 'Follow-up given'),
    dischargeItemDef('summary', 'Discharge summary done')
  ];

  return [
    { id: 'orif-upper-pathway', builtin: true, type: 'postop_pathway', name: 'ORIF upper limb — full pathway',
      tags: ['orif','radius','ulna','wrist','humerus','forearm','upper'],
      items: upperOrifItems,
      planByPod: { '0': 'NV checks, limb elevation, analgesia, drain charting.', '1': 'Dressing check, start mobilization, continue antibiotics.', '3': 'Follow-up X-ray, assess alignment, advance ROM.' } },
    { id: 'orif-lower-pathway', builtin: true, type: 'postop_pathway', name: 'ORIF lower limb — full pathway',
      tags: ['orif','femur','tibia','fibula','ankle','lower','leg'],
      items: lowerOrifItems,
      planByPod: { '0': 'NV checks, limb elevation, WB status, DVT prophylaxis.', '1': 'Mobilization / ROM, wound check.', '3': 'Follow-up X-ray, assess fixation.' } },
    { id: 'tha-pathway', builtin: true, type: 'postop_pathway', name: 'THA — post-op pathway',
      tags: ['tha','hip','arthroplasty','replacement'],
      items: thaItems,
      planByPod: { '0': 'Hip precautions, NV checks, analgesia.', '1': 'Mobilize with walker, wound review.', '3': 'Post-op X-ray, advance ambulation.' } },
    { id: 'tka-pathway', builtin: true, type: 'postop_pathway', name: 'TKA — post-op pathway',
      tags: ['tka','knee','arthroplasty','replacement'],
      items: tkaItems,
      planByPod: { '0': 'NV checks, knee ROM goals, analgesia.', '1': 'Mobilization, CPM if ordered.', '3': 'Post-op X-ray, physio.' } },
    { id: 'spine-pathway', builtin: true, type: 'postop_pathway', name: 'Spine fixation — pathway',
      tags: ['spine','lumbar','cervical','pedicle','fusion','fixation'],
      items: spineItems,
      planByPod: { '0': 'Log roll, NV checks, pain control.', '2': 'Sit out / ambulate per protocol.', '3': 'Post-op imaging review.' } },
    { id: 'exfix-pathway', builtin: true, type: 'postop_pathway', name: 'External fixator — pathway',
      tags: ['exfix','external','fixator','pin'],
      items: exfixItems,
      planByPod: { '0': 'Pin site care, NV checks.', '3': 'Follow-up X-ray.', '5': 'Consider joint mobilization.' } },
    { id: 'soft-tissue-pathway', builtin: true, type: 'postop_pathway', name: 'Soft tissue / debridement',
      tags: ['debridement','soft','tissue','wound','infection'],
      items: softTissueItems,
      planByPod: { '0': 'Wound inspection, antibiotics.', '1': 'Dressing change.', '2': 'Mobilize as tolerated.' } },
    { id: 'amputation-pathway', builtin: true, type: 'postop_pathway', name: 'Amputation — pathway',
      tags: ['amputation','stump','amputee'],
      items: amputationItems,
      planByPod: { '0': 'Stump dressing, NV checks.', '3': 'Stump physio / shaping.' } },
    { id: 'peds-orif-pathway', builtin: true, type: 'postop_pathway', name: 'Pediatric ORIF — simplified',
      tags: ['pediatric','peds','child','orif'],
      items: pedsOrifItems,
      planByPod: { '0': 'Cast check, NV status, elevation.', '3': 'Follow-up X-ray.' } },
    { id: 'discharge-standard', builtin: true, type: 'discharge', name: 'Discharge — standard elective',
      tags: ['discharge','elective'],
      items: dischargeStd },
    { id: 'discharge-trauma', builtin: true, type: 'discharge', name: 'Discharge — trauma / implant',
      tags: ['discharge','trauma','implant'],
      items: dischargeTrauma },
    { id: 'discharge-daycase', builtin: true, type: 'discharge', name: 'Discharge — day case',
      tags: ['discharge','daycase','day case'],
      items: dischargeDaycase },
    { id: 'preop-await', builtin: true, type: 'preop', name: 'Pre-op — awaiting OT',
      tags: ['preop','pre-op','awaiting'],
      items: [],
      plan: 'NPO from midnight, consent, mark limb, repeat labs if needed.' },
    { id: 'conservative-upper', builtin: true, type: 'conservative_pathway', name: 'Conservative — upper limb fracture',
      tags: ['conservative','non-operative','non operative','cast','slab','radius','ulna','humerus','conservative management'],
      items: [
        itemDef('nv0', 'NV status documented', 0, { category: 'nv' }),
        itemDef('cast1', 'Cast / slab check & NV status', 1, { category: 'wound' }),
        itemDef('mob2', 'Finger / shoulder mobilization', 2, { category: 'mobilization' }),
        itemDef('xr7', 'Repeat X-ray', 7, { exactPod: true, duePodEnd: 7, category: 'imaging' }),
        itemDef('review7', 'Review alignment — continue conservative vs OT', 7, { category: 'other' }),
        itemDef('pt14', 'Physio referral if stiff', 14, { category: 'mobilization', required: false })
      ],
      planByPod: {
        '0': 'Conservative management. NV check, elevation, analgesia. Cast/slab in situ.',
        '1': 'Cast check, document NV status, mobilize fingers.',
        '7': 'Repeat X-ray — review alignment. Continue conservative if acceptable.'
      }},
    { id: 'conservative-lower', builtin: true, type: 'conservative_pathway', name: 'Conservative — lower limb fracture',
      tags: ['conservative','non-operative','cast','tibia','fibula','ankle','foot','conservative management'],
      items: [
        itemDef('nv0', 'NV status documented', 0, { category: 'nv' }),
        itemDef('wb0', 'Weight-bearing status documented', 0, { category: 'mobilization' }),
        itemDef('cast1', 'Cast check & NV status', 1, { category: 'wound' }),
        itemDef('mob3', 'Mobilization / knee ROM if applicable', 3, { category: 'mobilization' }),
        itemDef('xr10', 'Repeat X-ray', 10, { exactPod: true, duePodEnd: 14, category: 'imaging' }),
        itemDef('review10', 'Orthopaedic review — alignment & WB plan', 10, { category: 'other' })
      ],
      planByPod: {
        '0': 'Conservative management. NV check, elevation, DVT prophylaxis as per protocol.',
        '1': 'Cast check, confirm NV status and WB instructions.',
        '10': 'Repeat X-ray — assess union / alignment.'
      }}
  ];
}

/* ---------- normalize & due engine ---------- */

function normalizePostOpItem(c){
  if(!c) return null;
  return {
    id: c.id || ('chk_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)),
    label: c.label || 'Milestone',
    duePod: c.duePod ?? 0,
    duePodEnd: c.duePodEnd ?? null,
    exactPod: !!c.exactPod,
    category: CHECKLIST_CATEGORIES.includes(c.category) ? c.category : 'other',
    required: c.required !== false,
    status: CHECKLIST_STATUSES.includes(c.status) ? c.status : 'pending',
    doneAt: c.doneAt || '',
    notes: c.notes || '',
    sourceTemplateId: c.sourceTemplateId || ''
  };
}

function normalizeDischargeItem(c){
  if(!c) return null;
  return {
    id: c.id || ('dchk_' + Date.now()),
    label: c.label || 'Item',
    category: CHECKLIST_CATEGORIES.includes(c.category) ? c.category : 'other',
    required: c.required !== false,
    status: CHECKLIST_STATUSES.includes(c.status) ? c.status : 'pending',
    doneAt: c.doneAt || '',
    notes: c.notes || '',
    sourceTemplateId: c.sourceTemplateId || ''
  };
}

function normalizePatientChecklists(p){
  if(p.postOpChecks) p.postOpChecks = p.postOpChecks.map(normalizePostOpItem).filter(Boolean);
  if(p.dischargeChecks) p.dischargeChecks = p.dischargeChecks.map(normalizeDischargeItem).filter(Boolean);
}

function getPatientPod(p){
  if(!p) return null;
  if((p.status === 'postop' || p.status === 'fordischarge') && p.surgeryDate){
    return calcPOD(p.surgeryDate);
  }
  if(p.status === 'conservative' && p.admissionDate){
    return calcPOD(p.admissionDate);
  }
  return null;
}

function isConservativePatient(p){
  return p && p.status === 'conservative';
}

function milestoneDayPrefix(p){
  return isConservativePatient(p) ? 'Day' : 'POD';
}

function isPostOpItemActive(c){
  return c && c.status === 'pending';
}

function isItemInDueWindow(c, pod){
  if(!isPostOpItemActive(c) || pod === null) return false;
  const due = c.duePod ?? 0;
  if(c.exactPod) return pod === due;
  const end = c.duePodEnd != null ? c.duePodEnd : null;
  if(end != null) return pod >= due && pod <= end;
  return pod >= due;
}

function isItemOverdue(c, pod){
  if(!isPostOpItemActive(c) || pod === null) return false;
  if(c.duePodEnd == null) return false;
  return pod > c.duePodEnd;
}

function isItemUpcoming(c, pod, withinPods){
  withinPods = withinPods ?? 2;
  if(!isPostOpItemActive(c) || pod === null) return false;
  const due = c.duePod ?? 0;
  if(c.exactPod) return pod < due && due - pod <= withinPods;
  if(pod < due && due - pod <= withinPods) return true;
  return false;
}

function getMilestoneBuckets(p, withinPods){
  const pod = getPatientPod(p);
  const buckets = { overdue: [], due: [], upcoming: [] };
  if(pod === null) return buckets;
  for(const c of (p.postOpChecks || [])){
    if(!isPostOpItemActive(c)) continue;
    if(isItemOverdue(c, pod)) buckets.overdue.push(c);
    else if(isItemInDueWindow(c, pod)) buckets.due.push(c);
    else if(isItemUpcoming(c, pod, withinPods)) buckets.upcoming.push(c);
  }
  return buckets;
}

function getDuePostOpChecks(p){
  const b = getMilestoneBuckets(p);
  return b.due;
}

function getOverduePostOpChecks(p){
  return getMilestoneBuckets(p).overdue;
}

function getUpcomingPostOpChecks(p, withinPods){
  return getMilestoneBuckets(p, withinPods).upcoming;
}

function hasIncompleteDischargeChecks(p){
  if(p.status !== 'fordischarge') return false;
  return (p.dischargeChecks || []).some(c => c.required !== false && c.status === 'pending');
}

function getPendingRequiredDischargeChecks(p){
  return (p.dischargeChecks || []).filter(c => c.required !== false && c.status === 'pending');
}

function cycleChecklistStatus(status){
  const order = ['pending','done','skipped','na'];
  const i = order.indexOf(status);
  return order[(i + 1) % order.length];
}

function formatMilestonePodLabel(c){
  return formatMilestonePodLabelForPatient(c, null);
}

function formatMilestonePodLabelForPatient(c, p){
  const pre = p ? milestoneDayPrefix(p) : 'POD';
  if(c.exactPod) return `${pre} ${c.duePod} only`;
  if(c.duePodEnd != null) return `${pre} ${c.duePod}–${c.duePodEnd}`;
  return `${pre} ${c.duePod}+`;
}

/* ---------- template library sync ---------- */

function loadTemplateLibraryFromRecord(rec){
  if(!rec){
    wardTemplateLibrary = {
      templates: [],
      disabledIds: [],
      updatedAt: 0,
      defaultPostOpTemplateId: null,
      autoApplyPostOp: true
    };
    return;
  }
  wardTemplateLibrary = {
    templates: Array.isArray(rec.templates) ? rec.templates : [],
    disabledIds: Array.isArray(rec.disabledIds) ? rec.disabledIds : [],
    updatedAt: rec.updatedAt || 0,
    defaultPostOpTemplateId: rec.defaultPostOpTemplateId || null,
    autoApplyPostOp: rec.autoApplyPostOp !== false
  };
}

function shouldAutoApplyPostOp(){
  return wardTemplateLibrary.autoApplyPostOp !== false;
}

function getDefaultPostOpTemplateId(p){
  const wardDefault = wardTemplateLibrary.defaultPostOpTemplateId;
  if(wardDefault && getTemplateById(wardDefault)) return wardDefault;
  if(p){
    const suggested = suggestTemplatesForPatient(p, 'postop_pathway', 1)[0];
    if(suggested) return suggested.id;
  }
  return 'orif-upper-pathway';
}

function getDefaultPostOpTemplateLabel(p){
  const tpl = getTemplateById(getDefaultPostOpTemplateId(p));
  return tpl ? tpl.name : 'ORIF upper limb';
}

function getMergedTemplates(){
  const builtins = getBuiltinTemplates();
  const disabled = new Set(wardTemplateLibrary.disabledIds || []);
  const wardById = new Map();
  for(const t of wardTemplateLibrary.templates || []){
    if(t && t.id) wardById.set(t.id, t);
  }
  const out = [];
  const seen = new Set();
  for(const b of builtins){
    if(disabled.has(b.id)) continue;
    const ward = wardById.get(b.id);
    if(ward && !b.builtin){
      out.push(ward);
    }else if(ward){
      out.push(Object.assign({}, b, ward, { builtin: false }));
    }else{
      out.push(Object.assign({}, b));
    }
    seen.add(b.id);
  }
  for(const t of wardTemplateLibrary.templates || []){
    if(!t || !t.id || seen.has(t.id) || disabled.has(t.id)) continue;
    out.push(Object.assign({}, t, { builtin: !!t.builtin }));
  }
  return out;
}

function getWardTemplateRecord(id){
  return (wardTemplateLibrary.templates || []).find(t => t && t.id === id) || null;
}

function getTemplateById(id){
  return getMergedTemplates().find(t => t.id === id) || null;
}

function getTemplatesByType(type){
  return getMergedTemplates().filter(t => t.type === type);
}

function templateItemToPatientItem(def, templateId, isDischarge){
  if(isDischarge){
    return normalizeDischargeItem(Object.assign({}, def, { status: 'pending', doneAt: '', sourceTemplateId: templateId }));
  }
  return normalizePostOpItem(Object.assign({}, def, { status: 'pending', doneAt: '', sourceTemplateId: templateId }));
}

function itemMatchesScope(def, pod, scope){
  if(scope !== 'due_now' || pod === null) return true;
  const fake = normalizePostOpItem(Object.assign({}, def, { status: 'pending' }));
  return isItemInDueWindow(fake, pod) || isItemUpcoming(fake, pod, 0);
}

function getTemplatePlanForPod(tpl, pod, patient){
  if(!tpl) return null;
  if(tpl.type === 'preop' && tpl.plan){
    return { text: tpl.plan, podLabel: 'pre-op' };
  }
  if(tpl.plan && !tpl.planByPod){
    return { text: tpl.plan, podLabel: null };
  }
  if(!tpl.planByPod || pod === null) return null;

  const key = String(pod);
  const dayPre = (patient && isConservativePatient(patient)) || tpl.type === 'conservative_pathway' ? 'Day' : 'POD';
  if(tpl.planByPod[key]){
    return { text: tpl.planByPod[key], podLabel: `${dayPre} ${pod}` };
  }
  const pods = Object.keys(tpl.planByPod).map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
  let nearest = null;
  for(const pNum of pods){
    if(pNum <= pod) nearest = pNum;
    else break;
  }
  if(nearest != null){
    return { text: tpl.planByPod[String(nearest)], podLabel: `${dayPre} ${nearest}` };
  }
  if(pods.length){
    return { text: tpl.planByPod[String(pods[0])], podLabel: `${dayPre} ${pods[0]}` };
  }
  return null;
}

function previewPlanForPod(tpl, pod){
  const info = getTemplatePlanForPod(tpl, pod);
  return info ? info.text : '';
}

function applyTemplateToPatient(p, templateId, options){
  options = Object.assign({
    merge: true,
    preserveDone: true,
    scope: 'all',
    fillPlan: 'current_pod'
  }, options || {});
  const tpl = getTemplateById(templateId);
  if(!tpl) return { ok: false, message: 'Template not found' };

  const pod = options.podOverride !== undefined ? options.podOverride : getPatientPod(p);
  const isDischarge = tpl.type === 'discharge';
  const field = isDischarge ? 'dischargeChecks' : 'postOpChecks';
  p[field] = p[field] || [];
  const byId = new Map(p[field].map(c => [c.id, c]));
  let added = 0;

  for(const def of (tpl.items || [])){
    if(!isDischarge && !itemMatchesScope(def, pod, options.scope)) continue;
    const cur = byId.get(def.id);
    if(cur){
      if(options.preserveDone && cur.status === 'done') continue;
      if(!options.merge) continue;
      continue;
    }
    const item = templateItemToPatientItem(def, tpl.id, isDischarge);
    p[field].push(item);
    byId.set(item.id, item);
    added++;
  }

  let planApplied = false;
  if((tpl.type === 'postop_pathway' || tpl.type === 'conservative_pathway' || tpl.type === 'preop') && options.fillPlan !== 'none'){
    const planInfo = getTemplatePlanForPod(tpl, pod, p);
    if(planInfo && planInfo.text){
      p.dailyPlan = planInfo.text;
      p.dailyPlanDate = todayISO();
      planApplied = true;
    }
  }

  return { ok: true, added, tpl, planApplied };
}

function applyPlanFromTemplate(p, templateId, podOverride){
  const tpl = getTemplateById(templateId);
  if(!tpl) return { ok: false, message: 'Template not found' };
  const pod = podOverride !== undefined ? podOverride : getPatientPod(p);
  const planInfo = getTemplatePlanForPod(tpl, pod, p);
  if(!planInfo){
    const hint = p.status === 'conservative'
      ? 'Set admission date and conservative status for day-based plan'
      : 'Set surgery date and post-op status for POD plan';
    return { ok: false, message: pod === null ? hint : 'No plan text for this day in template' };
  }
  p.dailyPlan = planInfo.text;
  p.dailyPlanDate = todayISO();
  return { ok: true, planInfo, tpl };
}

function previewTemplateApply(p, templateId, options){
  options = Object.assign({ merge: true, preserveDone: true, scope: 'all' }, options || {});
  const tpl = getTemplateById(templateId);
  if(!tpl) return { adds: 0, skips: 0, tpl: null, planInfo: null };
  const pod = options.podOverride !== undefined ? options.podOverride : getPatientPod(p);
  const isDischarge = tpl.type === 'discharge';
  const existing = isDischarge ? (p.dischargeChecks || []) : (p.postOpChecks || []);
  const byId = new Map(existing.map(c => [c.id, c]));
  let adds = 0, skips = 0;
  for(const def of (tpl.items || [])){
    if(!isDischarge && !itemMatchesScope(def, pod, options.scope)) continue;
    const cur = byId.get(def.id);
    if(cur){
      if(options.preserveDone && cur.status === 'done') skips++;
      else skips++;
    }else adds++;
  }
  const planInfo = getTemplatePlanForPod(tpl, pod);
  return { adds, skips, tpl, planInfo };
}

function scoreTemplate(tpl, p){
  const text = ((p.procedure || '') + ' ' + (p.diagnosis || '')).toLowerCase();
  let score = 0;
  for(const tag of (tpl.tags || [])){
    if(text.includes(String(tag).toLowerCase())) score += 2;
  }
  if(tpl.type === 'postop_pathway' && (p.status === 'postop' || p.surgeryDate)) score += 1;
  if(tpl.type === 'conservative_pathway' && p.status === 'conservative') score += 3;
  if(tpl.type === 'conservative_pathway' && /conservative|non.?op|cast|slab/i.test(text)) score += 2;
  if(tpl.type === 'discharge' && p.status === 'fordischarge') score += 3;
  if(tpl.type === 'preop' && p.status === 'preop') score += 2;
  return score;
}

function suggestTemplatesForPatient(p, type, limit){
  limit = limit || 3;
  let list = getMergedTemplates();
  if(type) list = list.filter(t => t.type === type);
  return list
    .map(t => ({ tpl: t, score: scoreTemplate(t, p) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.tpl);
}

function defaultPostOpChecks(){
  const tpl = getTemplateById(getDefaultPostOpTemplateId(null));
  if(!tpl) return [];
  return (tpl.items || []).map(d => templateItemToPatientItem(d, tpl.id, false));
}

function defaultDischargeChecks(){
  const tpl = getTemplateById('discharge-standard');
  if(!tpl) return [];
  return (tpl.items || []).map(d => templateItemToPatientItem(d, tpl.id, true));
}

function applyConservativeTemplate(p){
  if(!p.postOpChecks || !p.postOpChecks.length){
    const suggestions = suggestTemplatesForPatient(p, 'conservative_pathway', 1);
    const tplId = suggestions[0]?.id || 'conservative-upper';
    applyTemplateToPatient(p, tplId, { merge: false, fillPlan: 'current_pod' });
  }
}

function applyPostOpTemplate(p){
  if(!shouldAutoApplyPostOp()) return;
  if(!p.postOpChecks || !p.postOpChecks.length){
    applyTemplateToPatient(p, getDefaultPostOpTemplateId(p), { fillPlan: 'none' });
  }
}

function applyDischargeTemplate(p){
  if(!p.dischargeChecks || !p.dischargeChecks.length){
    applyTemplateToPatient(p, 'discharge-standard', { fillPlan: 'none' });
  }
}

function buildTemplateLibraryExport(){
  return {
    id: TEMPLATE_LIBRARY_ID,
    version: 1,
    exportedAt: new Date().toISOString(),
    templates: wardTemplateLibrary.templates || [],
    disabledIds: wardTemplateLibrary.disabledIds || [],
    defaultPostOpTemplateId: wardTemplateLibrary.defaultPostOpTemplateId || null,
    autoApplyPostOp: wardTemplateLibrary.autoApplyPostOp !== false
  };
}
