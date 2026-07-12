/* OT list — hospital Word template fields only + DOCX builder. */

import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType, BorderStyle, VerticalAlign
} from 'docx';

/** Default operating team from the hospital OT list template. */
export const DEFAULT_OT_DOCTORS = [
  'DR MAHESH',
  'DR BALAKRISHNA',
  'DR JACOB',
  'DR DEEPAK'
];

const THIN = { style: BorderStyle.SINGLE, size: 8, color: '000000' };
const BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
};

export function normalizeOtDoctors(value){
  if(Array.isArray(value)){
    return value.map(s => String(s || '').trim()).filter(Boolean);
  }
  if(typeof value === 'string'){
    return value.split(/\n+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

export function resolveOtDoctors(patient, defaultDoctors){
  const own = normalizeOtDoctors(patient?.otDoctors);
  if(own.length) return own;
  const ward = normalizeOtDoctors(defaultDoctors);
  if(ward.length) return ward;
  return [...DEFAULT_OT_DOCTORS];
}

export function formatOtListDate(iso){
  if(!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

export function formatOtAge(age){
  const raw = String(age || '').trim();
  if(!raw) return '';
  if(/yr/i.test(raw)) return raw.toUpperCase().replace(/\s+/g, ' ');
  return `${raw} YR`;
}

export function formatOtSex(sex){
  if(sex === 'M' || sex === 'F' || sex === 'O') return sex;
  return String(sex || '').trim().toUpperCase();
}

export function formatOtUnitLabel(unit){
  const u = String(unit || '').trim();
  if(!u) return 'OT LIST';
  const cleaned = u.replace(/^unit\s+/i, '').trim();
  return `OT LIST UNIT ${cleaned.toUpperCase()}`;
}

function cellParagraphs(text, opts = {}){
  const bold = !!opts.bold;
  const center = opts.center !== false; // default centered for template columns
  const size = opts.size || 20; // half-points (20 = 10pt)
  const lines = String(text ?? '').split(/\n/).map(l => l.trimEnd());
  if(!lines.length) lines.push('');
  return lines.map(line => new Paragraph({
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [new TextRun({ text: line, bold, size, font: 'Times New Roman' })]
  }));
}

function headerCell(text, width){
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children: cellParagraphs(text, { bold: true, center: true, size: 18 })
  });
}

function bodyCell(text, width, opts = {}){
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children: cellParagraphs(text, { center: true, size: 20, ...opts })
  });
}

/**
 * Build a hospital-style OT list DOCX.
 * @param {{ date: string, unit?: string, patients: object[], defaultOtDoctors?: string[] }} opts
 * @returns {Promise<Buffer>}
 */
export async function buildOtListDocx(opts){
  const dateIso = opts.date || '';
  const unit = opts.unit || '';
  const defaults = opts.defaultOtDoctors || DEFAULT_OT_DOCTORS;
  const patients = Array.isArray(opts.patients) ? opts.patients : [];

  // A4 landscape content width with ~0.7" margins ≈ 14800 DXA
  const widths = {
    sl: 620,
    ip: 1300,
    name: 1700,
    age: 820,
    sex: 620,
    ward: 1100,
    dx: 2600,
    proc: 2600,
    docs: 1800,
    anaes: 1200
  };
  const total = Object.values(widths).reduce((a, b) => a + b, 0);

  const headerRow = new TableRow({
    children: [
      headerCell('SL\nNO', widths.sl),
      headerCell('IP NO', widths.ip),
      headerCell('PATIENT NAME', widths.name),
      headerCell('AGE', widths.age),
      headerCell('SEX', widths.sex),
      headerCell('WARD', widths.ward),
      headerCell('DIAGNOSIS', widths.dx),
      headerCell('PROCEDURE', widths.proc),
      headerCell('DOCTORS NAME', widths.docs),
      headerCell('ANAESTHESIA', widths.anaes)
    ]
  });

  const dataRows = patients.map((p, i) => {
    const doctors = resolveOtDoctors(p, defaults);
    const nameLines = [String(p.name || '').trim().toUpperCase()];
    const payer = String(p.payer || '').trim();
    if(payer) nameLines.push(`(${payer.toUpperCase()})`);
    const ward = String(p.ward || p.bed || '').trim().toUpperCase();
    return new TableRow({
      children: [
        bodyCell(String(p.otOrder || (i + 1)), widths.sl, { bold: true, size: 22 }),
        bodyCell(String(p.uhid || ''), widths.ip, { size: 20 }),
        bodyCell(nameLines.join('\n'), widths.name, { bold: true, size: 20 }),
        bodyCell(formatOtAge(p.age), widths.age, { size: 20 }),
        bodyCell(formatOtSex(p.sex), widths.sex, { size: 20 }),
        bodyCell(ward, widths.ward, { size: 20 }),
        bodyCell(String(p.diagnosis || '').toUpperCase(), widths.dx, { size: 18 }),
        bodyCell(String(p.procedure || '').toUpperCase(), widths.proc, { size: 18 }),
        bodyCell(doctors.join('\n'), widths.docs, { size: 18 }),
        bodyCell(String(p.anaesthesia || '').toUpperCase(), widths.anaes, { size: 18 })
      ]
    });
  });

  const table = new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: Object.values(widths),
    rows: [headerRow, ...dataRows]
  });

  // A4 landscape; ~18mm margins on all sides
  const PAGE_W = 16838;
  const PAGE_H = 11906;
  const MARGIN = 1020;

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }
        }
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: 'ORTHOPAEDICS DEPARTMENT', bold: true, size: 32, font: 'Times New Roman' })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: formatOtUnitLabel(unit), bold: true, size: 28, font: 'Times New Roman' })]
        }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 240 },
          children: [new TextRun({ text: `Date : ${formatOtListDate(dateIso)}`, bold: true, size: 24, font: 'Times New Roman' })]
        }),
        table,
        new Paragraph({ spacing: { before: 400 }, children: [] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
          children: [new TextRun({ text: 'THE CHIEF OPERATING OFFICER', bold: true, size: 20, font: 'Times New Roman' })]
        }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 300 },
          children: [new TextRun({ text: 'UNIT CHIEF SIGNATURE', bold: true, size: 20, font: 'Times New Roman' })]
        }),
        new Table({
          width: { size: total, type: WidthType.DXA },
          columnWidths: [Math.floor(total / 2), Math.ceil(total / 2)],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: NO_BORDER,
                  width: { size: Math.floor(total / 2), type: WidthType.DXA },
                  children: [
                    new Paragraph({
                      children: [new TextRun({
                        text: 'DEPT. OF ANAESTHESIA AND OT STAFF',
                        bold: true, size: 18, font: 'Times New Roman'
                      })]
                    }),
                    new Paragraph({
                      spacing: { before: 120 },
                      children: [new TextRun({
                        text: 'DEPT. OF MRD AND CONCERNED WARD',
                        bold: true, size: 18, font: 'Times New Roman'
                      })]
                    })
                  ]
                }),
                new TableCell({
                  borders: NO_BORDER,
                  width: { size: Math.ceil(total / 2), type: WidthType.DXA },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      children: [new TextRun({
                        text: 'DEPT OF ORTHOPAEDIC',
                        bold: true, size: 18, font: 'Times New Roman'
                      })]
                    })
                  ]
                })
              ]
            })
          ]
        })
      ]
    }]
  });

  return Packer.toBuffer(doc);
}

/** Snapshot shape sent from the browser for export. */
export function sanitizeOtExportPatient(p){
  if(!p || typeof p !== 'object') return null;
  return {
    id: p.id,
    name: p.name || '',
    age: p.age || '',
    sex: p.sex || '',
    ward: p.ward || '',
    bed: p.bed || '',
    uhid: p.uhid || '',
    diagnosis: p.diagnosis || '',
    procedure: p.procedure || '',
    payer: p.payer || '',
    anaesthesia: p.anaesthesia || '',
    otDoctors: normalizeOtDoctors(p.otDoctors),
    otOrder: Number(p.otOrder) || 0,
    unit: p.unit || '',
    surgeryDate: p.surgeryDate || ''
  };
}
