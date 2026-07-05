/**
 * classifyFile — SharePoint filename → 'proposal' | 'report' | 'other'.
 * Shared by Grant Reporting (goals assessment) and Reviewer Finder's
 * load-proposal auto-pick. Pins the front-matter exclusion: cover/face/title
 * pages and application forms must NOT classify as the proposal narrative, even
 * though they contain "Application" (reported bug: Reviewer Finder auto-loaded
 * "Application Cover Page.docx").
 *
 * @jest-environment node
 */

// Import path retargeted to the canonical home (Stage 5 batch 2 plumbing-only
// change): classifyFile moved from the lookup-grant route to the shared
// grant-reporting service module.
import { classifyFile } from '../../lib/services/grant-reporting/classify-file.js';

describe('classifyFile — front-matter is never the proposal', () => {
  test.each([
    'Application Cover Page.docx',
    'Application_Cover_Page.pdf',
    'Cover Page.docx',
    'Cover Sheet.pdf',
    'Cover Letter.docx',
    'Face Page.docx',
    'Title Page.pdf',
    'Signature Page.docx',
    'Application Form.pdf',
  ])('%s → other (not auto-picked as proposal)', (name) => {
    expect(classifyFile(name)).toBe('other');
  });
});

describe('classifyFile — real proposals still classify', () => {
  test.each([
    'Project Narrative.docx',
    'Project_Narrative.pdf',
    'Project Narrative Phase II - FINAL.docx',
    'ProjectDescription.pdf',
    'Project Description.docx',
    'Project_Description.pdf',
    'Phase II Application.docx',
    'Phase II Proposal.pdf',
    'Phase_II_Proposal_v3.docx',
  ])('%s → proposal', (name) => {
    expect(classifyFile(name)).toBe('proposal');
  });

  test('a project narrative wins even if the name also says cover', () => {
    expect(classifyFile('Project Narrative Cover Page.docx')).toBe('proposal');
  });
});

describe('classifyFile — reports + other (regression guard)', () => {
  test.each([
    ['Annual Report.docx', 'report'],
    ['Interim Report.pdf', 'report'],
    ['Final Report.docx', 'report'],
    ['Progress Report 2026.pdf', 'report'],
    ['Final Narrative.docx', 'report'],
  ])('%s → %s', (name, expected) => {
    expect(classifyFile(name)).toBe(expected);
  });

  test('Phase I application is the wrong document → other', () => {
    expect(classifyFile('Phase I Application.docx')).toBe('other');
  });

  test('budget / unrelated attachments → other', () => {
    expect(classifyFile('Budget.xlsx')).toBe('other');
    expect(classifyFile('References.pdf')).toBe('other');
  });
});
