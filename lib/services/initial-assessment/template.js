/**
 * Versioned DOCX template for the Initial Assessment.
 *
 * Design preset: standard_business_brief. Foundation Opportunity is always a
 * visible staff-owned placeholder and is never accepted from model output.
 */

import { INITIAL_ASSESSMENT_CONTRACT } from '../../../shared/config/requestDocument.js';

const BODY_FONT = 'Calibri';
const BODY_SIZE = 21; // 10.5 pt
const ACCENT = '1F4E79';
const LIGHT_BLUE = 'D9EAF7';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export async function renderInitialAssessmentDocx({
  requestNumber,
  title,
  institution,
  generated,
}) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    ShadingType,
    TextRun,
  } = await import('docx');

  const bodyRun = (text, options = {}) => {
    const raw = String(text || '');
    const normalized = `${/^\s/.test(raw) ? ' ' : ''}${cleanText(raw)}`;
    return new TextRun({
      text: normalized,
      font: BODY_FONT,
      size: BODY_SIZE,
      color: '222222',
      ...options,
    });
  };

  const section = (label, text) => new Paragraph({
    spacing: { before: 90, after: 70, line: 240 },
    children: [
      bodyRun(`${label}:`, { bold: true, color: ACCENT }),
      bodyRun(` ${text}`),
    ],
  });

  const doc = new Document({
    creator: 'W. M. Keck Foundation Request Workbench',
    title: `Initial Assessment — ${cleanText(title)}`,
    description: `${INITIAL_ASSESSMENT_CONTRACT.templateId} v${INITIAL_ASSESSMENT_CONTRACT.templateVersion}`,
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: BODY_SIZE, color: '222222' },
          paragraph: { spacing: { after: 80, line: 240 } },
        },
      },
      paragraphStyles: [
        {
          id: 'IAHeading1',
          name: 'Initial Assessment Heading',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: BODY_FONT, size: 25, bold: true, color: ACCENT },
          paragraph: { spacing: { before: 120, after: 55 }, keepNext: true },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({
            text: 'INITIAL ASSESSMENT',
            font: BODY_FONT,
            size: 31,
            bold: true,
            color: ACCENT,
          })],
        }),
        new Paragraph({
          spacing: { after: 35 },
          children: [
            bodyRun('Applicant:', { bold: true }),
            bodyRun(` ${cleanText(title) || 'Untitled request'}`),
          ],
        }),
        new Paragraph({
          spacing: { after: 120 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 4 },
          },
          children: [
            bodyRun('Institution:', { bold: true }),
            bodyRun(` ${cleanText(institution) || 'Institution not recorded'}`),
            ...(requestNumber ? [bodyRun(`   •   Request #${requestNumber}`, { color: '666666' })] : []),
          ],
        }),
        new Paragraph({
          style: 'IAHeading1',
          heading: HeadingLevel.HEADING_1,
          children: [bodyRun('Summary', { bold: true, size: 25, color: ACCENT })],
        }),
        new Paragraph({
          spacing: { after: 100, line: 240 },
          children: [bodyRun(generated.summary)],
        }),
        new Paragraph({
          style: 'IAHeading1',
          heading: HeadingLevel.HEADING_1,
          children: [bodyRun('Rationale', { bold: true, size: 25, color: ACCENT })],
        }),
        section('Significance & Impact', generated.significance_impact),
        section('Research Plan', generated.research_plan),
        section('Team Expertise', generated.team_expertise),
        new Paragraph({
          spacing: { before: 110, after: 70, line: 240 },
          shading: { type: ShadingType.CLEAR, fill: LIGHT_BLUE, color: 'auto' },
          border: {
            top: { style: BorderStyle.SINGLE, size: 5, color: ACCENT },
            bottom: { style: BorderStyle.SINGLE, size: 5, color: ACCENT },
            left: { style: BorderStyle.SINGLE, size: 5, color: ACCENT },
            right: { style: BorderStyle.SINGLE, size: 5, color: ACCENT },
          },
          indent: { left: 110, right: 110 },
          children: [
            bodyRun('Foundation Opportunity:', { bold: true, color: ACCENT }),
            bodyRun(' [STAFF INPUT REQUIRED — add Foundation-specific judgment here.]', {
              italics: true,
              color: '555555',
            }),
          ],
        }),
      ],
    }],
  });

  return Packer.toBuffer(doc);
}
