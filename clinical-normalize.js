/** Orthopedic ward text normalization — shared by server, tests, and browser. */

const ABBREV_PHRASES = [
  ['im nailing', 'IM nailing'],
  ['orif', 'ORIF'],
  ['crif', 'CRIF'],
  ['lmwh', 'LMWH'],
  ['dhs', 'DHS'],
  ['pfn', 'PFN'],
  ['tkr', 'TKR'],
  ['thr', 'THR'],
  ['acl', 'ACL'],
  ['pcl', 'PCL'],
  ['mcl', 'MCL'],
  ['lcl', 'LCL'],
  ['rom', 'ROM'],
  ['pop', 'POP'],
  ['spica', 'spica']
];

function normalizeSpineLevels(text){
  let out = String(text || '');
  out = out.replace(/\bl(\d{1,2})\s*[-–]\s*l?(\d{1,2})\b/gi, (_, a, b) => `L${a}-L${b}`);
  out = out.replace(/\bc(\d{1,2})\s*[-–]\s*c?(\d{1,2})\b/gi, (_, a, b) => `C${a}-C${b}`);
  out = out.replace(/\bt(\d{1,2})\s*[-–]\s*t?(\d{1,2})\b/gi, (_, a, b) => `T${a}-T${b}`);
  out = out.replace(/\bs(\d{1,2})\s*[-–]\s*s?(\d{1,2})\b/gi, (_, a, b) => `S${a}-S${b}`);
  out = out.replace(/\bl(\d{1,2})\b/gi, (_, n) => `L${n}`);
  out = out.replace(/\bc(\d{1,2})\b/gi, (_, n) => `C${n}`);
  out = out.replace(/\bt(\d{1,2})\b/gi, (_, n) => `T${n}`);
  out = out.replace(/\bs(\d{1,2})\b/gi, (_, n) => `S${n}`);
  return out;
}

function normalizeSides(text){
  return String(text || '').replace(/\b(right|left|bilateral|rt|lt)\b/gi, (m) => {
    const w = m.toLowerCase();
    if(w === 'rt') return 'Right';
    if(w === 'lt') return 'Left';
    if(w === 'bilateral') return 'Bilateral';
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
}

function normalizeAbbreviations(text){
  let out = String(text || '');
  for(const [from, to] of ABBREV_PHRASES){
    const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(re, to);
  }
  return out;
}

function normalizeAnatomyText(text){
  return normalizeAbbreviations(normalizeSides(normalizeSpineLevels(text)));
}

export function normalizePersonName(name){
  const raw = String(name || '').trim();
  if(!raw) return raw;
  return raw.split(/\s+/).map((word) => {
    const clean = word.replace(/[.,]+$/g, '');
    const suffix = word.slice(clean.length);
    if(/^[a-z]{1,2}$/i.test(clean)) return clean.toUpperCase() + suffix;
    return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() + suffix;
  }).join(' ');
}

export function normalizeDiagnosis(text){
  const raw = String(text || '').trim();
  if(!raw) return raw;
  return raw.split(/\n+/).map((line) => normalizeAnatomyText(line)).join('\n');
}

export function normalizeProcedure(text){
  const raw = String(text || '').trim();
  if(!raw) return raw;
  return normalizeAnatomyText(raw);
}

export function normalizeImplant(text){
  const raw = String(text || '').trim();
  if(!raw) return raw;
  return normalizeAnatomyText(raw);
}

export function normalizeSurgeon(text){
  const raw = String(text || '').trim();
  if(!raw) return raw;
  if(/^dr\.?\s+/i.test(raw)){
    const rest = raw.replace(/^dr\.?\s+/i, '');
    return 'Dr ' + normalizePersonName(rest);
  }
  return normalizePersonName(raw);
}

export function normalizeClinicalNote(text){
  const raw = String(text || '').trim();
  if(!raw) return raw;
  return normalizeAnatomyText(raw);
}

export function normalizePatientClinicalFields(patient){
  if(!patient || typeof patient !== 'object') return patient;
  const out = Object.assign({}, patient);
  if(out.name) out.name = normalizePersonName(out.name);
  if(out.diagnosis) out.diagnosis = normalizeDiagnosis(out.diagnosis);
  if(out.procedure) out.procedure = normalizeProcedure(out.procedure);
  if(out.implant) out.implant = normalizeImplant(out.implant);
  if(out.surgeon) out.surgeon = normalizeSurgeon(out.surgeon);
  if(out.dailyPlan) out.dailyPlan = normalizeClinicalNote(out.dailyPlan);
  if(out.handoverNote) out.handoverNote = normalizeClinicalNote(out.handoverNote);
  if(out.notes) out.notes = normalizeClinicalNote(out.notes);
  if(out.dvtProphylaxis) out.dvtProphylaxis = normalizeAbbreviations(out.dvtProphylaxis);
  if(Array.isArray(out.antibioticCourses)){
    out.antibioticCourses = out.antibioticCourses.map(c => Object.assign({}, c, {
      name: c?.name ? normalizeAbbreviations(String(c.name).trim()) : c?.name
    }));
  }
  return out;
}

/** Regex fallback when AI misses common Indian lab shorthand. */
export function extractLabsFromText(text){
  const src = String(text || '');
  const labs = {};
  const patterns = [
    ['hb', /\bhb\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i],
    ['crp', /\bcrp\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i],
    ['wcc', /\b(?:tlc|wcc|wbc)\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i],
    ['creatinine', /\b(?:creat|creatinine|sr\.?\s*creatinine)\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i]
  ];
  for(const [key, re] of patterns){
    const m = src.match(re);
    if(m) labs[key] = m[1];
  }
  return labs;
}

function parseTherapyDays(val){
  const n = parseInt(String(val ?? '').trim(), 10);
  return n > 0 ? n : 0;
}

export function sanitizeAntibioticCourses(courses, defaults = {}){
  if(!Array.isArray(courses)) return [];
  const out = [];
  for(const raw of courses){
    if(!raw || typeof raw !== 'object') continue;
    const name = normalizeAbbreviations(String(raw.name || '').trim());
    const days = parseTherapyDays(raw.days);
    const start = String(raw.start || defaults.start || '').trim();
    if(!name && !days) continue;
    out.push({ name, days, start });
  }
  return out;
}

export const KNOWN_LAB_KEYS = [
  'hb', 'crp', 'wcc', 'creatinine', 'platelets', 'esr', 'urea',
  'sodium', 'potassium', 'ptinr', 'rbs',
  'calcium', 'phosphate', 'alp', 'albumin'
];

export function sanitizeLabs(raw){
  if(!raw || typeof raw !== 'object') return {};
  const out = {};
  for(const key of KNOWN_LAB_KEYS){
    const val = raw[key];
    if(val === undefined || val === null) continue;
    const str = String(val).trim();
    if(str && str.toLowerCase() !== 'null') out[key] = str;
  }
  return out;
}

const OTHER_LABS_MAX = 12;
const OTHER_LAB_NAME_MAX = 40;
const OTHER_LAB_VALUE_MAX = 20;

/** Harvest analytes the AI read that aren't in the known panel.
 *  `raw` is the whole AI response object: unknown keys inside raw.labs
 *  plus entries of raw.otherLabs ([{name, value}]). Capture-don't-drop. */
export function extractOtherLabs(raw){
  const out = [];
  const seen = new Set();
  const push = (name, value) => {
    const n = String(name ?? '').trim().slice(0, OTHER_LAB_NAME_MAX);
    const v = String(value ?? '').trim().slice(0, OTHER_LAB_VALUE_MAX);
    if(!n || !v || v.toLowerCase() === 'null') return;
    const dedupeKey = n.toLowerCase();
    if(seen.has(dedupeKey) || out.length >= OTHER_LABS_MAX) return;
    seen.add(dedupeKey);
    out.push({ name: n, value: v });
  };
  if(!raw || typeof raw !== 'object') return out;
  if(raw.labs && typeof raw.labs === 'object'){
    for(const [k, v] of Object.entries(raw.labs)){
      if(!KNOWN_LAB_KEYS.includes(k)) push(k, v);
    }
  }
  if(Array.isArray(raw.otherLabs)){
    for(const entry of raw.otherLabs){
      if(entry && typeof entry === 'object'){
        const knownKey = KNOWN_LAB_KEYS.includes(String(entry.name ?? '').trim().toLowerCase());
        if(!knownKey) push(entry.name, entry.value);
      }
    }
  }
  return out;
}

export function mergeLabs(primary, fallback){
  const merged = Object.assign({}, fallback || {}, primary || {});
  const pOther = Array.isArray(primary?.otherLabs) ? primary.otherLabs : [];
  const fOther = Array.isArray(fallback?.otherLabs) ? fallback.otherLabs : [];
  if(pOther.length || fOther.length){
    const seen = new Set();
    const union = [];
    for(const e of [...pOther, ...fOther]){
      if(!e || !e.name) continue;
      const k = String(e.name).toLowerCase();
      if(seen.has(k)) continue;
      seen.add(k);
      union.push(e);
    }
    merged.otherLabs = union;
  }else{
    delete merged.otherLabs;
  }
  return merged;
}
