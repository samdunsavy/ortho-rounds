/* OpenAI proxy for Ortho Rounds AI assistants. */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
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
    'fitness', 'milestonesOverdue', 'milestonesDue', 'therapy', 'antibioticsDay',
    'dvtProphylaxis', 'dvtDays', 'complications', 'notes'
  ];
  for(const key of allow){
    if(p[key] !== undefined && p[key] !== null && p[key] !== '') out[key] = p[key];
  }
  return out;
}

async function callOpenAi(systemPrompt, userContent){
  if(!OPENAI_API_KEY){
    const err = new Error('AI not configured');
    err.statusCode = 503;
    throw err;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(()=> ctrl.abort(), OPENAI_TIMEOUT_MS);
  try{
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: OPENAI_MAX_TOKENS,
        temperature: 0.3
      })
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

  const userContent = `Patient data:\n${JSON.stringify(snapshot, null, 2)}\n\nWrite today's plan.`;
  return callOpenAi(systemPrompt, userContent);
}

export async function polishPresentation(patient, style, seedScript){
  const snapshot = sanitizePatientSnapshot(patient);
  const compact = style === 'compact';
  const systemPrompt = `${BASE_SYSTEM}

Polish this ward-round presentation script for speaking aloud to a consultant.
${compact ? 'Keep it to 3–5 bullet-style short lines suitable for a quick update.' : 'Keep it to 30–45 seconds when read aloud (roughly 4–8 sentences).'}
Preserve all clinical facts from the seed script and JSON. Do not add new findings.`;

  const userContent = `Patient data:\n${JSON.stringify(snapshot, null, 2)}\n\nSeed script to polish:\n${seedScript || ''}`;
  return callOpenAi(systemPrompt, userContent);
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

  let userContent = `Patients (${snapshots.length}):\n${JSON.stringify(snapshots, null, 2)}`;
  if(wardNote && String(wardNote).trim()){
    userContent += `\n\nExisting unit note to incorporate or refine:\n${String(wardNote).trim()}`;
  }
  userContent += '\n\nWrite the handover note.';
  return callOpenAi(systemPrompt, userContent);
}
