/**
 * Request file corpus filename rules (plan section 2, tier 1). Pins the
 * asymmetry: Type-only labels fire only on specific phrases, opaque names stay
 * uncertain, and a readable document copied into an app folder stays Read.
 * Names are synthetic.
 *
 * @jest-environment node
 */

import {
  classifyByFilename,
  phaseOf,
  priorityOf,
  normalizeName,
} from '../../lib/services/request-file-corpus/filename-rules.js';

const type = (name, subfolder = '') => classifyByFilename({ name, subfolder }).type;

describe('opaque and unknown names are uncertain, never typed', () => {
  test.each([
    '13100818.doc',
    '6f6ccccb-9b1a-4a5a-b7f2-f93bb09cdf0f.doc',
    'EEC6F39CE7D4EF118EE96045BD082F70.html',
    'misc scan.pdf',
  ])('%s', (name) => {
    const result = classifyByFilename({ name });
    expect(result.type).toBe('uncertain');
    expect(result.priority).toBe('uncertain');
  });
});

describe('Read documents', () => {
  test.each([
    ['ProjectDescription.pdf', 'project-description'],
    ['Project_Narrative_final.docx', 'project-description'],
    ['summary+description.docx', 'project-description'],
    ['ProjectSummary.pdf', 'project-summary'],
    ['Proposal Abstract.docx', 'project-summary'],
    ['Research Phase I Application_2026-05-01T10-00-00Z.pdf', 'application-form'],
    ['Application2.html', 'application-form'],
    ['Research Phase II Proposal_2025-01-01T00-00-00Z.pdf', 'compiled-proposal'],
    ['Example University_MR_Phase_II_staff_version.pdf', 'compiled-proposal'],
    ['Keck References.docx', 'bibliography'],
    ['Example University - Phase II Review.doc', 'external-review'],
    ['Federal Agency Reviews (optional).pdf', 'agency-reviews'],
    ['Example University - Phase I Rationale (SE - J24).docx', 'staff-review'],
    ['SV memo D23 MR Ph2 Example.docx', 'site-visit-report'],
    ['Example D22 MR site visit WU v2.docx', 'site-visit-report'],
    ['Interim Report 2 Narrative.pdf', 'interim-report'],
    ['Research Final Report_2024-07-01T00-00-00Z.pdf', 'final-report'],
  ])('%s → %s', (name, expected) => {
    expect(type(name)).toBe(expected);
    expect(priorityOf(expected)).toBe('read');
  });

  test('a proposal copied into an AI folder stays Read', () => {
    expect(type('ProposalNarrative_1003000.pdf', 'AI Materials')).toBe('project-description');
    expect(type('model-input.json', 'AI Materials')).toBe('ai-material');
  });
});

describe('Type-only labels need a specific phrase', () => {
  test.each([
    ['Proposal Cover Page.docx', 'cover-page'],
    ['Financial Narrative.pdf', 'financial-narrative'],
    ['Interim Report 2 Financial.pdf', 'financial-report'],
    ['Interim Report 2 CVs or Resumes.pdf', 'biosketches'],
    ['Project Budget Spreadsheet.xlsx', 'budget-spreadsheet'],
    ['Governing BoardList.pdf', 'governing-board'],
    ['Example (BOT) tax exemption letter.pdf', 'status-letter'],
    ['IRS Determination Letter.pdf', 'status-letter'],
    ['No Cost Extension Request.pdf', 'no-cost-extension'],
    ['Grant Award Letter.pdf', 'correspondence'],
  ])('%s → %s', (name, expected) => {
    expect(type(name)).toBe(expected);
    expect(priorityOf(expected)).toBe('type-only');
  });

  test('generic words alone do not produce a Type-only label', () => {
    expect(priorityOf(type('Example University Annual Report 2019.pdf'))).toBe('uncertain');
    expect(priorityOf(type('Signed letter.pdf'))).toBe('uncertain');
  });
});

describe('app-generated Site Visit artifacts', () => {
  test.each([
    ['1003000-staff-discussion-summary-1-1-v1.txt', 'Site Visit - Staff Discussion Summary', 'staff-discussion-summary'],
    ['1003000-presentation-transcript-ends-1h2m3s.txt', 'Site Visit - Presentation Transcript', 'site-visit-transcript'],
    ['1003000 Site Visit Presentation.pptx', 'Site Visit - Slides', 'site-visit-slides'],
    ['1003000 initial assessment 1a-2b.docx', 'Artifacts/Initial Assessment', 'staff-writeup'],
  ])('%s → %s', (name, subfolder, expected) => {
    expect(type(name, subfolder)).toBe(expected);
  });
});

describe('helpers', () => {
  test('normalizeName treats separators as spaces and drops the extension', () => {
    expect(normalizeName('Research_Phase-I.Cover_Page.docx')).toBe('research phase i cover page');
  });

  test('phaseOf reads folder and name', () => {
    expect(phaseOf({ name: 'Project Narrative.pdf', subfolder: 'Phase II' })).toBe('phase-ii');
    expect(phaseOf({ name: 'Interim Report 1 Narrative.pdf' })).toBe('post-award');
    expect(phaseOf({ name: '13100818.doc' })).toBe('unknown');
  });
});
