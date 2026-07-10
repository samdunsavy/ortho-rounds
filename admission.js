/** WhatsApp admission note formatting — shared by tests and the browser bridge. */

export function formatSexLabel(sex){
  if(sex === 'M') return 'Male';
  if(sex === 'F') return 'Female';
  if(sex === 'O') return 'Other';
  return '';
}

export function resolvePatientUnit(patient, defaultUnit = ''){
  const unit = String(patient?.unit || '').trim();
  if(unit) return unit;
  const fallback = String(defaultUnit || '').trim();
  if(fallback) return fallback;
  return 'IV';
}

export function resolveWardType(patient, defaultWardType = ''){
  const wt = String(patient?.wardType || '').trim();
  if(wt) return wt;
  const fallback = String(defaultWardType || '').trim();
  if(fallback) return fallback;
  return 'Free ward';
}

export function formatDiagnosisForWhatsApp(diagnosis){
  const raw = String(diagnosis || '').trim();
  if(!raw) return '—';
  const parts = raw
    .split(/\s*\+\s*|\n+/)
    .map(s => s.trim().replace(/^Imp\s*:\s*/i, ''))
    .filter(Boolean);
  if(!parts.length) return '—';
  if(parts.length === 1) return parts[0];
  return parts[0] + '+\n' + parts.slice(1).join('+\n');
}

export function formatAdmissionWhatsApp(patient, opts = {}){
  const name = String(patient?.name || '').trim() || '—';
  const age = String(patient?.age || '').trim() || '?';
  const sex = formatSexLabel(patient?.sex);
  const sexLine = sex ? `${age} years / ${sex}` : `${age} years`;
  const diagnosisBody = formatDiagnosisForWhatsApp(patient?.diagnosis);
  const impLine = diagnosisBody === '—' ? 'Imp : —' : `Imp : ${diagnosisBody}`;
  const unit = resolvePatientUnit(patient, opts.defaultUnit);
  const wardType = resolveWardType(patient, opts.defaultWardType);

  return [
    'New admission sir',
    '',
    name,
    sexLine,
    '',
    impLine,
    '',
    `Admitted under ortho unit - ${unit}`,
    wardType,
    '',
    'Thank you sir'
  ].join('\n');
}
