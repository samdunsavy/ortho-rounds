/* OpenAI proxy for Ortho Rounds AI assistants. */

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

function pseudonymizeSnapshots(snapshots){
  const mapping = [];
  snapshots.forEach((s, i)=>{
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    if(!name) return;
    const alias = aliasFor(mapping.length);
    mapping.push({ alias, name });
    s.name = alias;
  });
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

export async function parseAdmission(text){
  const systemPrompt = `You extract structured data from orthopedic admission notes written in Indian ward English (may mix abbreviations and dictated speech).
Return ONLY a JSON object with these keys (use null when the note does not state a value — never guess):
name, age (string of digits), sex ("M"|"F"|"O"), bed, ward, uhid,
diagnosis, procedure, surgeon, implant,
status ("preop"|"postop"|"conservative"|"fordischarge"),
admissionDate, surgeryDate (ISO YYYY-MM-DD; resolve relative phrases like "yesterday" using today's date given below),
theatreTime (e.g. "09:30"), dailyPlan, handoverNote, notes.
status rules: operated → "postop"; awaiting surgery → "preop"; non-operative management → "conservative".
Do not put content in notes that already fits another field.`;

  const userContent = `Today's date: ${new Date().toISOString().slice(0, 10)}\n\nAdmission note:\n${String(text || '').slice(0, 6000)}\n\nExtract the JSON.`;
  const fields = await callOpenAiJson(systemPrompt, userContent, { maxTokens: 500, temperature: 0.1 });
  const allow = [
    'name', 'age', 'sex', 'bed', 'ward', 'uhid', 'diagnosis', 'procedure', 'surgeon', 'implant',
    'status', 'admissionDate', 'surgeryDate', 'theatreTime', 'dailyPlan', 'handoverNote', 'notes'
  ];
  const out = {};
  for(const key of allow){
    const val = fields?.[key];
    if(val === undefined || val === null) continue;
    const str = String(val).trim();
    if(str && str.toLowerCase() !== 'null') out[key] = str;
  }
  if(out.sex && !['M', 'F', 'O'].includes(out.sex)) delete out.sex;
  if(out.status && !['preop', 'postop', 'conservative', 'fordischarge'].includes(out.status)) delete out.status;
  for(const key of ['admissionDate', 'surgeryDate']){
    if(out[key] && !/^\d{4}-\d{2}-\d{2}$/.test(out[key])) delete out[key];
  }
  return out;
}
