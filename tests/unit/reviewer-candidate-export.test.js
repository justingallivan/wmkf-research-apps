/**
 * @jest-environment node
 *
 * Reviewer-candidate Excel export — column formatting + workbook shape.
 */

import ExcelJS from 'exceljs';
import {
  buildReviewerCandidateWorkbook,
  formatConflicts,
  extractOrcidId,
  whySelected,
  sourceLabel,
} from '../../lib/services/reviewer-candidate-export';

describe('formatConflicts', () => {
  it('reports none when there is no COI', () => {
    expect(formatConflicts({})).toBe('None noted');
  });
  it('names the reviewer institution for an institution COI', () => {
    expect(formatConflicts({ hasInstitutionCOI: true, institutionCOIDetails: { reviewerInstitution: 'MIT' } }))
      .toBe('Institution COI: MIT');
  });
  it('grades coauthor overlap and SUMS paperCount across authors (not author count)', () => {
    // Two authors, 2 + 3 shared papers → 5 shared papers (not "2").
    expect(formatConflicts({
      hasCoauthorCOI: true,
      coauthorCOIStrength: 'possible',
      coauthorships: [{ proposalAuthor: 'A', paperCount: 2 }, { proposalAuthor: 'B', paperCount: 3 }],
    })).toBe('Co-author overlap (possible, 5 shared papers)');
    // One author with 10 shared papers → "10", not "1".
    expect(formatConflicts({ hasCoauthorCOI: true, coauthorships: [{ proposalAuthor: 'A', paperCount: 10 }] }))
      .toBe('Co-author overlap (likely, 10 shared papers)');
    expect(formatConflicts({ hasCoauthorCOI: true, coauthorships: [{ proposalAuthor: 'A', paperCount: 1 }] }))
      .toBe('Co-author overlap (likely, 1 shared paper)');
  });
  it('joins multiple conflicts', () => {
    const s = formatConflicts({ hasInstitutionCOI: true, hasCoauthorCOI: true, coauthorships: [] });
    expect(s).toContain('Institution COI');
    expect(s).toContain('Co-author overlap');
  });
});

describe('extractOrcidId', () => {
  it('pulls the bare iD from an orcid.org url', () => {
    expect(extractOrcidId('https://orcid.org/0000-0002-1825-0097')).toBe('0000-0002-1825-0097');
  });
  it('handles the trailing-X checksum', () => {
    expect(extractOrcidId('https://orcid.org/0000-0002-1825-009X')).toBe('0000-0002-1825-009X');
  });
  it('returns empty for nothing', () => {
    expect(extractOrcidId(null)).toBe('');
  });
});

describe('whySelected / sourceLabel', () => {
  it('uses Claude reasoning when present', () => {
    expect(whySelected({ reasoning: 'Leading expert in X.' })).toBe('Leading expert in X.');
  });
  it('falls back to applicant-named note', () => {
    expect(whySelected({ isApplicantRecommended: true })).toBe('Named by the applicant');
  });
  it('labels applicant rows even without a provenance object', () => {
    expect(sourceLabel({ isApplicantRecommended: true })).toBe('Applicant-Referred');
  });
});

describe('buildReviewerCandidateWorkbook', () => {
  it('produces a two-sheet workbook with metadata + candidate rows', async () => {
    const buf = await buildReviewerCandidateWorkbook({
      meta: {
        requestNumber: '1002836',
        institution: 'Stanford University',
        pi: 'Jane Smith',
        exportedDate: '2026-06-16',
      },
      candidates: [
        {
          name: 'Dr A',
          affiliation: 'MIT',
          email: 'a@mit.edu',
          reasoning: 'Expert in catalysis.',
          keywords: 'catalysis; surface chemistry',
          orcidUrl: 'https://orcid.org/0000-0002-1825-0097',
          scholarUrl: 'https://scholar.google.com/citations?user=abc',
          hasRealScholar: true,
          hasInstitutionCOI: true,
          institutionCOIDetails: { reviewerInstitution: 'Stanford University' },
          hIndex: 42,
          publicationCount5yr: 17,
          seniorityEstimate: 'Senior',
        },
        { name: 'Dr B', isApplicantRecommended: true },
      ],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.getWorksheet('Request Info')).toBeTruthy();
    const sheet = wb.getWorksheet('Candidates');
    expect(sheet).toBeTruthy();
    // header + 2 data rows
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(1).getCell(1).value).toBe('Reviewer name');
    expect(sheet.getRow(2).getCell(1).value).toBe('Dr A');
    // expertise tags column (col 6) carries the candidate's keywords verbatim
    expect(sheet.getRow(1).getCell(6).value).toBe('Expertise tags');
    expect(sheet.getRow(2).getCell(6).value).toBe('catalysis; surface chemistry');
    // conflicts column composed (now col 7, after the expertise-tags column)
    const conflictsCol = sheet.getRow(2).getCell(7).value;
    expect(String(conflictsCol)).toContain('Institution COI: Stanford University');
    // applicant row gets the named-by note
    expect(sheet.getRow(3).getCell(5).value).toBe('Named by the applicant');
    // metric columns: numeric h-index/pub-count, string seniority; blank (not 0) when absent
    expect(sheet.getRow(1).getCell(10).value).toBe('h-index');
    expect(sheet.getRow(2).getCell(10).value).toBe(42);
    expect(sheet.getRow(2).getCell(11).value).toBe(17);
    expect(sheet.getRow(2).getCell(12).value).toBe('Senior');
    // Dr B has no h-index → blank, NOT 0 (the whole point of num()'s '' return)
    expect([null, '', undefined]).toContain(sheet.getRow(3).getCell(10).value);
  });
});
