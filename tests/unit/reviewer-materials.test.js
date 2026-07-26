/**
 * Security contract for reviewer-visible SharePoint material.
 *
 * The list and download endpoints must expose exactly one request-bound file:
 * `Reviewer Materials/Proposal_{requestNumber}.pdf`. Other files in that same
 * folder can contain internal-only information and must remain invisible.
 *
 * @jest-environment node
 */

import {
  expectedReviewerProposalFilename,
  getReviewerMaterialFolders,
  isReviewerProposalFile,
  listReviewerMaterials,
} from '../../lib/external/reviewer-materials.js';

describe('reviewer proposal file policy', () => {
  test('constructs the exact request-bound filename', () => {
    expect(expectedReviewerProposalFilename('1002379')).toBe('Proposal_1002379.pdf');
    expect(expectedReviewerProposalFilename(' REQ-001 ')).toBe('Proposal_REQ-001.pdf');
    expect(expectedReviewerProposalFilename('')).toBeNull();
    expect(expectedReviewerProposalFilename(null)).toBeNull();
  });

  test('matches only the exact proposal file in Reviewer Materials', () => {
    expect(isReviewerProposalFile(
      '1002379_GUID/Reviewer Materials',
      'Proposal_1002379.pdf',
      '1002379',
    )).toBe(true);
  });

  test('matches the folder case-insensitively but keeps the filename exact', () => {
    expect(isReviewerProposalFile(
      '1002379_GUID/reviewer materials',
      'Proposal_1002379.pdf',
      '1002379',
    )).toBe(true);
    expect(isReviewerProposalFile(
      '1002379_GUID/Reviewer Materials',
      'proposal_1002379.pdf',
      '1002379',
    )).toBe(false);
  });

  test('rejects the timestamped internal application in the same folder', () => {
    expect(isReviewerProposalFile(
      '1002379_GUID/Reviewer Materials',
      'Research Phase I Application_2026-05-01T18-44-00Z.pdf',
      '1002379',
    )).toBe(false);
  });

  test('rejects the right filename outside the canonical folder', () => {
    expect(isReviewerProposalFile(
      '1002379_GUID/Reviewer_Downloads',
      'Proposal_1002379.pdf',
      '1002379',
    )).toBe(false);
    expect(isReviewerProposalFile(
      '1002379_GUID/Phase II',
      'Proposal_1002379.pdf',
      '1002379',
    )).toBe(false);
    expect(isReviewerProposalFile(
      '1002379_GUID/Reviewer Materials/Internal',
      'Proposal_1002379.pdf',
      '1002379',
    )).toBe(false);
  });

  test('rejects a proposal file bound to a different request', () => {
    expect(isReviewerProposalFile(
      '1002379_GUID/Reviewer Materials',
      'Proposal_1009999.pdf',
      '1002379',
    )).toBe(false);
  });

  test('rejects sibling folders that merely contain the canonical name', () => {
    expect(isReviewerProposalFile(
      '1002379_GUID/My Reviewer Materials Old',
      'Proposal_1002379.pdf',
      '1002379',
    )).toBe(false);
  });

  test('rejects empty, null, and non-string path or filename input', () => {
    expect(isReviewerProposalFile('', 'Proposal_1002379.pdf', '1002379')).toBe(false);
    expect(isReviewerProposalFile(null, 'Proposal_1002379.pdf', '1002379')).toBe(false);
    expect(isReviewerProposalFile('Reviewer Materials', null, '1002379')).toBe(false);
    expect(isReviewerProposalFile('Reviewer Materials', 42, '1002379')).toBe(false);
  });

  test('reports the single canonical folder', () => {
    expect(getReviewerMaterialFolders()).toEqual(['Reviewer Materials']);
  });
});

describe('listReviewerMaterials', () => {
  test('returns only the exact proposal while excluding internal files present in the same folder', async () => {
    const result = await listReviewerMaterials('request-id', '1002379', {
      getRequestSharePointBuckets: jest.fn().mockResolvedValue([
        { library: 'akoya_request', folder: '1002379_GUID', source: 'dynamics' },
      ]),
      listFiles: jest.fn().mockResolvedValue([
        {
          id: 'proposal',
          name: 'Proposal_1002379.pdf',
          folder: '1002379_GUID/Reviewer Materials',
          size: 100,
          mimeType: 'application/pdf',
        },
        {
          id: 'internal-application',
          name: 'Research Phase I Application_2026-05-01T18-44-00Z.pdf',
          folder: '1002379_GUID/Reviewer Materials',
          size: 200,
          mimeType: 'application/pdf',
        },
        {
          id: 'wrong-folder',
          name: 'Proposal_1002379.pdf',
          folder: '1002379_GUID/Phase II',
          size: 300,
          mimeType: 'application/pdf',
        },
      ]),
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'proposal',
        name: 'Proposal_1002379.pdf',
        folder: '1002379_GUID/Reviewer Materials',
      }),
    ]);
  });
});
