/* OpenAI proxy for Ortho Rounds AI assistants. */

import {
  normalizePatientClinicalFields,
  extractLabsFromText,
  sanitizeLabs,
  sanitizeAntibioticCourses,
  mergeLabs
} from './clinical-normalize.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS) || 350;
const OPENAI_TIMEOUT_MS = 25000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const rateBuckets = new Map();

const BASE_SYSTEM = `You assist orthopedic postgraduate doctors on ward rounds in India.
Use British/Indian ward English. Be concise and telegraphic.
Never invent labs, results, or clinical facts not present in the JSON.
Do not give definitive medical advice beyond what the data supports.
Output plain text only — no markdown, bullets, or headings unless asked.`;

export function isAiEnabled(){
  return !!OPENAI_API_KEY;
}

export function getAiConfig(){
  return {
    enabled: isAiEnabled(),
    model: isAiEnabled() ? OPENAI_MODEL : null
  };
}

export function checkRateLimit(token){
  if(!token) return { ok: true };
  const now = Date.now();
  let bucket = rateBuckets.get(token);
  if(!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS){
    bucket = { start: now, count: 0 };
    rateBuckets.set(token, bucket);
  }
  bucket.count++;
  if(bucket.count > RATE_LIMIT_MAX){
    return { ok: false, retryAfterSec: Math.ceil((bucket.start + RATE_LIMIT_WINDOW_MS - now) / 1000) };
  }
  return { ok: true };
}

export function sanitizePatientSnapshot(p){
  if(!p || typeof p !== 'object') return {};
  const out = {};
  const allow = [
    'bed', 'ward', 'name', 'age', 'sex', 'status', 'diagnosis', 'procedure', 'surgeon', 'implant',
    'surgeryDate', 'admissionDate', 'dailyPlan', 'dailyPlanDate', 'handoverPin', 'handoverNote',
    'clinicalDay', 'pod', 'labsLine', 'yesterdayPlan', 'planHistory', 'investigations',
    'fitness', 'milestonesOverdue', 'milestonesDue', 'milestones', 'dischargeChecks',
    'therapy', 'antibioticsDay', 'antibioticCourses',
    'dvtProphylaxis', 'dvtDays', 'complications', 'notes'
  ];
  for(const key of allow){
    if(p[key] !== undefined && p[key] !== null && p[key] !== '') out[key] = p[key];
  }
  return out;
}

/* ---------------- pseudonymization ----------------
   Patient names never leave the server: each snapshot's name is replaced
   with a stable alias ("Patient A") before the OpenAI call, and aliases are
   swapped back in the response. Free-text inputs that ride along (seed
   scripts, ward notes) get the same substitution. */

function aliasFor(i){
  const letter = String.fromCharCode(65 + (i % 26));
  return i < 26 ? `Patient ${letter}` : `Patient ${letter}${Math.floor(i / 26) + 1}`;
}

function deepAliasify(value, mapping){
  if(typeof value === 'string') return aliasifyText(value, mapping);
  if(Array.isArray(value)) return value.map(v => deepAliasify(v, mapping));
  if(value && typeof value === 'object'){
    for(const key of Object.keys(value)) value[key] = deepAliasify(value[key], mapping);
    return value;
  }
  return value;
}

function pseudonymizeSnapshots(snapshots){
  const mapping = [];
  for(const s of snapshots){
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    if(!name) continue;
    const alias = aliasFor(mapping.length);
    mapping.push({ alias, name });
    s.name = alias;
  }
  // Names can also hide inside free-text fields (plans, notes, handover) —
  // scrub every string in every snapshot, not just the name field.
  for(const s of snapshots) deepAliasify(s, mapping);
  return mapping;
}

function aliasifyText(text, mapping){
  let out = String(text || '');
  for(const { alias, name } of mapping){
    if(name.length < 3) continue; // avoid mangling text on 1–2 letter names
    out = out.split(name).join(alias);
  }
  return out;
}

function reidentifyText(text, mapping){
  let out = String(text || '');
  for(const { alias, name } of mapping){
    out = out.split(alias).join(name);
  }
  return out;
}

async function callOpenAi(systemPrompt, userContent, opts = {}){
  if(!OPENAI_API_KEY){
    const err = new Error('AI not configured');
    err.statusCode = 503;
    throw err;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(()=> ctrl.abort(), OPENAI_TIMEOUT_MS);
  try{
    const payload = {
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: opts.maxTokens || OPENAI_MAX_TOKENS,
      temperature: opts.temperature ?? 0.3
    };
    if(opts.json) payload.response_format = { type: 'json_object' };
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      signal: ctrl.signal,
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(()=> ({}));
    if(!res.ok){
      const msg = data?.error?.message || `OpenAI error (${res.status})`;
      const err = new Error(msg);
      err.statusCode = res.status >= 500 ? 502 : 400;
      throw err;
    }
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    if(!text){
      const err = new Error('Empty AI response');
      err.statusCode = 502;
      throw err;
    }
    return text;
  }catch(err){
    if(err.name === 'AbortError'){
      const e = new Error('AI request timed out');
      e.statusCode = 504;
      throw e;
    }
    throw err;
  }finally{
    clearTimeout(timer);
  }
}

async function callOpenAiJson(systemPrompt, userContent, opts = {}){
  const text = await callOpenAi(systemPrompt, userContent, { ...opts, json: true });
  try{
    return JSON.parse(text);
  }catch{
    const err = new Error('AI returned malformed data');
    err.statusCode = 502;
    throw err;
  }
}

export async function draftPlan(patient){
  const snapshot = sanitizePatientSnapshot(patient);
  const systemPrompt = `${BASE_SYSTEM}

Write today's ward round plan for this patient.
Use 2–5 short lines in telegraphic style (mobilisation, investigations, antibiotics, discharge planning).
Reference overdue or due milestones and abnormal labs if present.
Milestone checklist labels (e.g. "DVT prophylaxis") are tasks to document — do not assume a specific drug unless dvtProphylaxis or dvtDays is in the JSON.
Do not mention LMWH or DVT prophylaxis unless dvtProphylaxis, dvtDays, or therapy includes it.
If yesterday's plan mentions DVT/LMWH but those fields are absent today, omit DVT from the new plan.
If yesterday's plan exists and is still appropriate, evolve it rather than rewriting from scratch.`;

  const mapping = pseudonymizeSnapshots([snapshot]);
  const userContent = `Patient data:\n${JSON.stringify(snapshot, null, 2)}\n\nWrite today's plan.`;
  const text = await callOpenAi(systemPrompt, userContent);
  return reidentifyText(text, mapping);
}

export async function polishPresentation(patient, style, seedScript){
  const snapshot = sanitizePatientSnapshot(patient);
  const compact = style === 'compact';
  const systemPrompt = `${BASE_SYSTEM}

Polish this ward-round presentation script for speaking aloud to a consultant.
${compact ? 'Keep it to 3–5 bullet-style short lines suitable for a quick update.' : 'Keep it to 30–45 seconds when read aloud (roughly 4–8 sentences).'}
Preserve all clinical facts from the seed script and JSON. Do not add new findings.`;

  const mapping = pseudonymizeSnapshots([snapshot]);
  const seed = aliasifyText(seedScript || '', mapping);
  const userContent = `Patient data:\n${JSON.stringify(snapshot, null, 2)}\n\nSeed script to polish:\n${seed}`;
  const text = await callOpenAi(systemPrompt, userContent);
  return reidentifyText(text, mapping);
}

export async function handoverSummary(patients, wardNote){
  const snapshots = (Array.isArray(patients) ? patients : [])
    .slice(0, 25)
    .map(sanitizePatientSnapshot);
  const systemPrompt = `${BASE_SYSTEM}

Write a unit handover note for the night/on-call team covering these inpatients.
Structure: brief intro, then patient-by-patient (bed, name, key issue, plan/action).
Highlight handover pins, antibiotics stopping, and overdue milestones.
Keep it scannable — short lines, not essays.`;

  const mapping = pseudonymizeSnapshots(snapshots);
  let userContent = `Patients (${snapshots.length}):\n${JSON.stringify(snapshots, null, 2)}`;
  if(wardNote && String(wardNote).trim()){
    userContent += `\n\nExisting unit note to incorporate or refine:\n${aliasifyText(String(wardNote).trim(), mapping)}`;
  }
  userContent += '\n\nWrite the handover note.';
  const text = await callOpenAi(systemPrompt, userContent);
  return reidentifyText(text, mapping);
}

export async function dischargeSummary(patient){
  const snapshot = sanitizePatientSnapshot(patient);
  const systemPrompt = `${BASE_SYSTEM}

Draft a discharge summary for this orthopedic inpatient.
Use these plain-text section headings, each on its own line:
DIAGNOSIS / PROCEDURE / HOSPITAL COURSE / CONDITION AT DISCHARGE / MEDICATIONS & ADVICE / FOLLOW-UP.
Hospital course: 2–5 short sentences synthesised from the plan history, milestones, and complications.
Medications & advice: only mention drugs present in the JSON (antibiotics, DVT prophylaxis) with their documented durations; otherwise write "As per discharge prescription".
Follow-up: use pending milestones or discharge checklist items if present, else standard suture-removal/OPD review phrasing.
This is a draft for a doctor to edit — leave [square-bracket placeholders] where information is missing rather than inventing it.`;

  const mapping = pseudonymizeSnapshots([snapshot]);
  const userContent = `Patient data:\n${JSON.stringify(snapshot, null, 2)}\n\nDraft the discharge summary.`;
  const text = await callOpenAi(systemPrompt, userContent, { maxTokens: 700 });
  return reidentifyText(text, mapping);
}

export async function wardBrief(patients){
  const snapshots = (Array.isArray(patients) ? patients : [])
    .slice(0, 40)
    .map(sanitizePatientSnapshot);
  const systemPrompt = `${BASE_SYSTEM}

Write a morning ward brief for the orthopedic team before rounds.
Structure (plain-text headings):
TOP PRIORITIES — the 3–5 patients needing attention first and one line why (overdue milestones, abnormal labs, antibiotics to stop, handover pins).
DISCHARGE FLOW — who can go home today and what is blocking the rest of the for-discharge list.
WATCH LIST — brief line each for fresh post-ops (POD 0–1) and anyone with complications.
Reference patients as "Bed <bed> — <name>". Keep the whole brief under 250 words.`;

  const mapping = pseudonymizeSnapshots(snapshots);
  const userContent = `Ward census (${snapshots.length} inpatients):\n${JSON.stringify(snapshots, null, 2)}\n\nWrite the morning brief.`;
  const text = await callOpenAi(systemPrompt, userContent, { maxTokens: 700 });
  return reidentifyText(text, mapping);
}

export async function wardRiskFlags(patients){
  const list = (Array.isArray(patients) ? patients : []).slice(0, 40);
  if(!list.length) return [];
  const snapshots = list.map(sanitizePatientSnapshot);
  const systemPrompt = `${BASE_SYSTEM}

Scan this ward census for patients with a genuine clinical risk worth flagging right now — do not flag every patient, only ones with something concerning.
Look for: overdue milestones, abnormal labs, a stated complication, antibiotics due to stop or overdue, or a handover pin suggesting an unresolved issue.
Return ONLY a JSON object: {"flags": [{"bed": string, "type": "bad"|"warn", "text": string}]}.
"bed" must exactly match a "bed" value from the input JSON. "text" is one short telegraphic line (under 15 words) explaining the risk. "type" is "bad" for something urgent/serious, "warn" for something to watch. Omit patients with nothing worth flagging — most patients should not appear.`;

  const mapping = pseudonymizeSnapshots(snapshots);
  const userContent = `Ward census (${snapshots.length} inpatients):\n${JSON.stringify(snapshots, null, 2)}\n\nReturn the risk flags JSON.`;
  const raw = await callOpenAiJson(systemPrompt, userContent, { maxTokens: 600, temperature: 0.2 });

  // Beds (not ids) go to OpenAI, matching every other ai.js function's
  // "Bed <bed> — <name>" convention — resolve back to real patient ids here,
  // server-side, using data that never left the server.
  const bedToId = new Map();
  for(const p of list){
    if(p && p.bed != null && p.id) bedToId.set(String(p.bed), p.id);
  }

  return (Array.isArray(raw.flags) ? raw.flags : [])
    .map(f => {
      if(!f || typeof f !== 'object') return null;
      const patientId = bedToId.get(String(f.bed));
      if(!patientId) return null;
      const text = reidentifyText(String(f.text || '').trim(), mapping).slice(0, 160);
      if(!text) return null;
      return { patientId, flag: { type: f.type === 'bad' ? 'bad' : 'warn', text } };
    })
    .filter(Boolean);
}

export async function scribeRoundNote(patient, transcript){
  const snapshot = sanitizePatientSnapshot(patient);
  const systemPrompt = `You convert a doctor's spoken bedside note from an orthopedic ward round into structured record updates.

Ward speech conventions:
- POST-OP patients: the speaker states the POD (post-op day), the procedure that was done, and the plans — discharge planning, physiotherapy, mobilisation, dressing, investigations.
- PRE-OP and CONSERVATIVE patients: the speaker states the diagnosis and the plan.

Use the patient JSON only as context to resolve references (e.g. which milestone "drain removed" matches). Extract ONLY what the transcript actually says — never invent items.

Return ONLY a JSON object with these keys:
"dailyPlan": string|null — today's plan in short telegraphic ward style, combining all plan items spoken (physiotherapy, discharge planning, dressings, investigations). Null if no plan is spoken.
"handoverNote": string|null — only if the speaker flags something to watch for / pending / inform the on-call team.
"milestonesDone": string[] — ids from the milestones array that the speaker states are completed now.
"dischargeChecksDone": string[] — ids from the dischargeChecks array stated as completed.
"complication": {"type": string, "note": string}|null — only if an adverse event or complication is stated (e.g. wound gape, discharge from wound, DVT).
"markForDischarge": boolean — true ONLY if the speaker clearly says the patient is fit for / to be marked for discharge (planning discharge "tomorrow" is a plan item, not a status change).

Use British/Indian ward English. Do not put the POD or diagnosis into dailyPlan — they are context, not plan items.`;

  const mapping = pseudonymizeSnapshots([snapshot]);
  const spoken = aliasifyText(String(transcript || '').slice(0, 4000), mapping);
  const userContent = `Patient data:\n${JSON.stringify(snapshot, null, 2)}\n\nSpoken bedside note:\n${spoken}\n\nExtract the JSON.`;
  const raw = await callOpenAiJson(systemPrompt, userContent, { maxTokens: 500, temperature: 0.1 });

  const milestoneIds = new Set((patient?.milestones || []).map(m => m && m.id).filter(Boolean));
  const dischargeIds = new Set((patient?.dischargeChecks || []).map(c => c && c.id).filter(Boolean));
  const out = {
    dailyPlan: typeof raw.dailyPlan === 'string' && raw.dailyPlan.trim() ? reidentifyText(raw.dailyPlan.trim(), mapping) : null,
    handoverNote: typeof raw.handoverNote === 'string' && raw.handoverNote.trim() ? reidentifyText(raw.handoverNote.trim(), mapping) : null,
    milestonesDone: (Array.isArray(raw.milestonesDone) ? raw.milestonesDone : []).filter(id => milestoneIds.has(id)),
    dischargeChecksDone: (Array.isArray(raw.dischargeChecksDone) ? raw.dischargeChecksDone : []).filter(id => dischargeIds.has(id)),
    complication: null,
    markForDischarge: raw.markForDischarge === true
  };
  if(raw.complication && typeof raw.complication === 'object' && (raw.complication.type || raw.complication.note)){
    out.complication = {
      type: reidentifyText(String(raw.complication.type || 'Complication').trim(), mapping),
      note: reidentifyText(String(raw.complication.note || '').trim(), mapping)
    };
  }
  return out;
}

export async function parseAdmission(text){
  const systemPrompt = `You extract structured data from orthopedic admission notes written in Indian ward English (may mix abbreviations and dictated speech).
Common WhatsApp format: salutation, name, "53 years / Male", "Imp : diagnosis+", "Admitted under ortho unit - IV", "Free ward", closing thanks — ignore salutations and thanks.
Return ONLY a JSON object with these keys (use null when the note does not state a value — never guess):
name, age (string of digits), sex ("M"|"F"|"O"), bed, ward, uhid,
unit (ortho unit number or label only, e.g. "IV" from "ortho unit - IV"),
wardType (e.g. "Free ward", "Paid ward", "Private ward"),
diagnosis, procedure, surgeon, implant,
status ("preop"|"postop"|"conservative"|"fordischarge"),
admissionDate, surgeryDate (ISO YYYY-MM-DD; resolve relative phrases like "yesterday" using today's date given below),
theatreTime (e.g. "09:30"), dailyPlan, handoverNote, notes,
labs: object with optional keys hb, crp, wcc, creatinine (string numbers only, Indian report units),
antibioticCourses: array of {name, days (integer), start (ISO date or null)} — e.g. "Inj Augmentin 1.2g BD x 5 days",
dvtProphylaxis (e.g. "LMWH"), dvtDays (integer course length if stated).
Capitalization: use standard orthopedic style — spine levels as L3/C5, sides as Right/Left, names in title case, common abbreviations as ORIF/IM/LMWH.
diagnosis: join multiple injuries; keep "+" between items or use newlines; strip leading "Imp :".
status rules: operated → "postop"; awaiting surgery → "preop"; non-operative management → "conservative".
Do not put content in notes that already fits another field.`;

  const noteText = String(text || '').slice(0, 6000);
  const userContent = `Today's date: ${new Date().toISOString().slice(0, 10)}\n\nAdmission note:\n${noteText}\n\nExtract the JSON.`;
  const fields = await callOpenAiJson(systemPrompt, userContent, { maxTokens: 700, temperature: 0.1 });
  const allow = [
    'name', 'age', 'sex', 'bed', 'ward', 'uhid', 'unit', 'wardType', 'diagnosis', 'procedure', 'surgeon', 'implant',
    'status', 'admissionDate', 'surgeryDate', 'theatreTime', 'dailyPlan', 'handoverNote', 'notes',
    'dvtProphylaxis', 'dvtDays'
  ];
  const out = {};
  for(const key of allow){
    const val = fields?.[key];
    if(val === undefined || val === null) continue;
    const str = String(val).trim();
    if(str && str.toLowerCase() !== 'null') out[key] = str;
  }
  if(fields?.dvtDays != null){
    const days = parseInt(String(fields.dvtDays), 10);
    if(days > 0) out.dvtDays = days;
  }
  if(out.sex && !['M', 'F', 'O'].includes(out.sex)) delete out.sex;
  if(out.status && !['preop', 'postop', 'conservative', 'fordischarge'].includes(out.status)) delete out.status;
  for(const key of ['admissionDate', 'surgeryDate']){
    if(out[key] && !/^\d{4}-\d{2}-\d{2}$/.test(out[key])) delete out[key];
  }

  const defaultStart = out.admissionDate || out.surgeryDate || new Date().toISOString().slice(0, 10);
  const aiLabs = sanitizeLabs(fields?.labs);
  const regexLabs = extractLabsFromText(noteText);
  const labs = mergeLabs(aiLabs, regexLabs);
  if(Object.keys(labs).length) out.labs = labs;

  const antibioticCourses = sanitizeAntibioticCourses(fields?.antibioticCourses, { start: defaultStart });
  if(antibioticCourses.length) out.antibioticCourses = antibioticCourses;

  return normalizePatientClinicalFields(out);
}
