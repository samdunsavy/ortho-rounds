/* OT list — hospital Word template fields only + DOCX builder. */

import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType, BorderStyle, VerticalAlign, VerticalMergeType
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

export const C_ARM_BANNER = '<--------------------------------------------- C ARM REQUIRED ---------------------------------------------->';
export const ARTHRO_MONITOR_BANNER = '<--------------------------------------------- ARTHROSCOPIC MONITOR REQUIRED ---------------------------------------------->';

/** True if any patient on the list needs a C-arm (one banner at bottom). */
export function listNeedsCArm(patients){
  return (Array.isArray(patients) ? patients : []).some(p => !!p?.cArmRequired);
}

/** True if any patient needs an arthroscopic monitor (one banner at bottom). */
export function listNeedsArthroMonitor(patients){
  return (Array.isArray(patients) ? patients : []).some(p => !!p?.arthroMonitorRequired);
}

/** Patient data rows only (doctors rowspan); equipment banners sit below the list. */
export function countOtBodyRows(patients){
  return Array.isArray(patients) ? patients.length : 0;
}

function otBannerRow(totalWidth, colCount, text){
  return new TableRow({
    children: [
      new TableCell({
        borders: BORDERS,
        columnSpan: colCount,
        width: { size: totalWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: cellParagraphs(text, { bold: true, center: true, size: 18 })
      })
    ]
  });
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
  const { verticalMerge, ...paraOpts } = opts;
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    verticalMerge,
    children: verticalMerge === VerticalMergeType.CONTINUE
      ? [new Paragraph({ children: [] })]
      : cellParagraphs(text, { center: true, size: 20, ...paraOpts })
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

  const dataRows = [];
  const colCount = Object.keys(widths).length;
  // Same operating team for the list — merge DOCTORS NAME once when 2+ patients.
  const mergeDocs = patients.length > 1;
  const listDoctors = patients.length
    ? resolveOtDoctors(patients[0], defaults)
    : [...DEFAULT_OT_DOCTORS];

  patients.forEach((p, i) => {
    const doctors = mergeDocs ? listDoctors : resolveOtDoctors(p, defaults);
    const nameLines = [String(p.name || '').trim().toUpperCase()];
    const payer = String(p.payer || '').trim();
    if(payer) nameLines.push(`(${payer.toUpperCase()})`);
    const ward = String(p.ward || p.bed || '').trim().toUpperCase();
    const docsOpts = mergeDocs
      ? (i === 0
        ? { size: 18, verticalMerge: VerticalMergeType.RESTART }
        : { size: 18, verticalMerge: VerticalMergeType.CONTINUE })
      : { size: 18 };
    dataRows.push(new TableRow({
      children: [
        bodyCell(String(p.otOrder || (i + 1)), widths.sl, { bold: true, size: 22 }),
        bodyCell(String(p.uhid || ''), widths.ip, { size: 20 }),
        bodyCell(nameLines.join('\n'), widths.name, { bold: true, size: 20 }),
        bodyCell(formatOtAge(p.age), widths.age, { size: 20 }),
        bodyCell(formatOtSex(p.sex), widths.sex, { size: 20 }),
        bodyCell(ward, widths.ward, { size: 20 }),
        bodyCell(String(p.diagnosis || '').toUpperCase(), widths.dx, { size: 18 }),
        bodyCell(String(p.procedure || '').toUpperCase(), widths.proc, { size: 18 }),
        bodyCell(i === 0 || !mergeDocs ? doctors.join('\n') : '', widths.docs, docsOpts),
        bodyCell(String(p.anaesthesia || '').toUpperCase(), widths.anaes, { size: 18 })
      ]
    }));
  });

  // Equipment banners once at the bottom if any patient needs them.
  if(listNeedsCArm(patients)){
    dataRows.push(otBannerRow(total, colCount, C_ARM_BANNER));
  }
  if(listNeedsArthroMonitor(patients)){
    dataRows.push(otBannerRow(total, colCount, ARTHRO_MONITOR_BANNER));
  }

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
        // Clear gap between patient table and signature block
        new Paragraph({ spacing: { before: 900, after: 0 }, children: [] }),
        // Two-column signature grid so left/right labels share exact edges
        new Table({
          width: { size: total, type: WidthType.DXA },
          columnWidths: [Math.floor(total * 0.55), Math.ceil(total * 0.45)],
          rows: [
            // COO alone, centered across the full signature width
            new TableRow({
              children: [
                new TableCell({
                  borders: NO_BORDER,
                  columnSpan: 2,
                  width: { size: total, type: WidthType.DXA },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { after: 40 },
                      children: [new TextRun({
                        text: 'THE CHIEF OPERATING OFFICER',
                        bold: true, size: 20, font: 'Times New Roman'
                      })]
                    })
                  ]
                })
              ]
            }),
            new TableRow({
              children: [
                sigCell(Math.floor(total * 0.55), '', { before: 120, after: 0 }),
                sigCell(Math.ceil(total * 0.45), 'UNIT CHIEF SIGNATURE', {
                  align: AlignmentType.RIGHT, size: 20, before: 120, after: 40
                })
              ]
            }),
            new TableRow({
              children: [
                sigCell(Math.floor(total * 0.55), '', { before: 140, after: 0 }),
                sigCell(Math.ceil(total * 0.45), '', { before: 140, after: 0 })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: NO_BORDER,
                  width: { size: Math.floor(total * 0.55), type: WidthType.DXA },
                  children: [
                    new Paragraph({
                      spacing: { after: 40 },
                      children: [new TextRun({
                        text: 'DEPT. OF ANAESTHESIA AND OT STAFF',
                        bold: true, size: 18, font: 'Times New Roman'
                      })]
                    }),
                    new Paragraph({
                      spacing: { before: 20, after: 0 },
                      children: [new TextRun({
                        text: 'DEPT. OF MRD AND CONCERNED WARD',
                        bold: true, size: 18, font: 'Times New Roman'
                      })]
                    })
                  ]
                }),
                new TableCell({
                  borders: NO_BORDER,
                  width: { size: Math.ceil(total * 0.45), type: WidthType.DXA },
                  verticalAlign: VerticalAlign.TOP,
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      spacing: { after: 0 },
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

function sigCell(width, text, opts = {}){
  const children = text
    ? [new Paragraph({
        alignment: opts.align || AlignmentType.LEFT,
        spacing: { before: opts.before || 0, after: opts.after || 0 },
        children: [new TextRun({
          text,
          bold: true,
          size: opts.size || 18,
          font: 'Times New Roman'
        })]
      })]
    : [new Paragraph({
        spacing: { before: opts.before || 0, after: opts.after || 0 },
        children: []
      })];
  return new TableCell({
    borders: NO_BORDER,
    width: { size: width, type: WidthType.DXA },
    children
  });
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
    cArmRequired: !!p.cArmRequired,
    arthroMonitorRequired: !!p.arthroMonitorRequired,
    unit: p.unit || '',
    surgeryDate: p.surgeryDate || ''
  };
}
