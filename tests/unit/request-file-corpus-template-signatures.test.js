/**
 * Request file corpus template signatures (plan section 2, tier 2). Pins the
 * templates found in the content pilot, the guards on Type-only signatures, and
 * how content and filename results combine. Text is synthetic.
 *
 * @jest-environment node
 */

import {
  classifyByContent,
  normalizeHead,
  resolveClassification,
} from '../../lib/services/request-file-corpus/template-signatures.js';
import { classifyByFilename } from '../../lib/services/request-file-corpus/filename-rules.js';

const template = (text) => classifyByContent(text)?.templateId ?? null;
const type = (text) => classifyByContent(text)?.type ?? null;

describe('staff documents are Read', () => {
  test.each([
    ['Example University\nExample City, CA\n\nPhase I Summary and Rationale: June 2020\nProgram: Medical Research', 'staff-review'],
    ['Example University Example City, CA Phase II Review Program: Medical Research Requested Amount: $1,000,000', 'staff-review'],
    ['PHASE II REVIEW\nOrganization: Example Institute', 'staff-review'],
    ['REFEREE REVIEW\nIn its Medical Research and Science and Engineering Programs, the W. M. Keck Foundation', 'external-review'],
    ['W. M. Keck Foundation Tracking Overview Organization: Example University Grant Cycle: June 2017', 'staff-writeup'],
    ['Memorandum To: Pending Proposal File Date: March 31, 2017 To: Example University File', 'staff-writeup'],
    ['W. M. Keck Foundation 1995 Grant File Memorandum Date: September 25, 1997', 'staff-writeup'],
  ])('%#', (text, expected) => {
    expect(type(text)).toBe(expected);
    expect(classifyByContent(text).priority).toBe('read');
  });
});

describe('proposal and report forms are Read', () => {
  test.each([
    ['Research Program Phase I - J20 3033200.00000000 0x0101 Research Program', 'goapply-phase-i-form'],
    ['Medical Research Program Phase I Application Meeting Date December 2025 Applicant Institution', 'compiled-phase-i-application'],
    ['W. M. Keck Foundation – Phase II Proposal – Abstract Example University Cells', 'phase-ii-proposal-abstract'],
    ['PROJECT DESCRIPTION Context: an example', 'project-description-heading'],
    ['Interim Progress Report - Research Program 4049000.00000000', 'interim-progress-report-form'],
    ['Grantee Organization/Institution Name: Example University Project Description/Title: Example Grant Award Date: June 2017 Final Report Date:', 'grantee-narrative-report-form'],
  ])('%#', (text, expected) => {
    expect(template(text)).toBe(expected);
    expect(classifyByContent(text).priority).toBe('read');
  });
});

describe('Type-only signatures need a specific template phrase', () => {
  test.each([
    ['January 13, 2017 Dr. Example Person President Example University 1 Main Street Example, CA Dear Dr. Person:', 'dated-letter'],
    ['18 August 2016 Dear Dr. Person: Thank you for your email.', 'dated-letter'],
    ['Dr. Example Person Professor Example University 1 Main Street', 'address-block'],
    ['From: Example Sender To: Example Recipient Subject: RE: Grant report', 'email-printout'],
    ['Organization Name: Project Title: CategoryTotals Personnel (Salary + Fringe Benefits)', 'budget-form'],
    ['YearCorporationsIndividualsTotals FY2019 1,000$', 'other-funding-table'],
    ['EXAMPLE UNIVERSITY Consolidated Financial Statements June 30, 2019 and 2018', 'audited-financial-statements'],
    ['Board of Trustees Example University System', 'board-roster'],
    ['GRANTEE INFORMATION SHEET Organization: Example University Grant Number: 950000', 'grantee-information-sheet'],
  ])('%#', (text, expected) => {
    expect(template(text)).toBe(expected);
    expect(classifyByContent(text).priority).toBe('type-only');
  });

  test('a board named as the applicant does not make a proposal a board roster', () => {
    expect(template('Applicant Institution: Board of Trustees of Example University Project Objectives /Aims Improve')).not.toBe('board-roster');
  });

  test('a dated staff note without a salutation is not a letter', () => {
    expect(classifyByContent('November 7, 1995 Example State University Office Visit On November 7, 1995, the president met')).toBeNull();
  });

  test('an address block on a long document is not an envelope', () => {
    expect(template(`Dr. Example Person Professor Example University ${'text '.repeat(200)}`)).not.toBe('address-block');
  });

  test('empty or unknown text is undecided', () => {
    expect(classifyByContent('')).toBeNull();
    expect(classifyByContent('Some unrelated opening line about nothing in particular')).toBeNull();
  });
});

describe('resolveClassification', () => {
  test('content decides an uncertain filename', () => {
    const byName = classifyByFilename({ name: '13100818.doc' });
    const byContent = classifyByContent('Example University Example City, CA Phase I Summary and Rationale: June 2020');
    expect(resolveClassification(byName, byContent)).toEqual({ type: 'staff-review', priority: 'read', source: 'template:phase-i-summary-rationale' });
  });

  test('a Read signature overrides a Type-only filename label', () => {
    const byName = classifyByFilename({ name: 'Example Correspondence.pdf' });
    expect(byName.priority).toBe('type-only');
    const byContent = classifyByContent('REFEREE REVIEW In its Medical Research and Science and Engineering Programs');
    expect(resolveClassification(byName, byContent).source).toBe('template:referee-review');
  });

  test('otherwise the filename result stands', () => {
    const byName = classifyByFilename({ name: 'No Cost Extension Request.pdf' });
    const byContent = classifyByContent('From: Example Sender To: Example Recipient Subject: RE: extension');
    expect(resolveClassification(byName, byContent)).toEqual({ type: 'no-cost-extension', priority: 'type-only', source: 'rule:no-cost-extension' });
    expect(resolveClassification(byName, null).source).toBe('rule:no-cost-extension');
  });
});

test('normalizeHead lowercases, straightens dashes and collapses whitespace', () => {
  expect(normalizeHead('  A–B\n\n  C  ')).toBe('a-b c');
});
