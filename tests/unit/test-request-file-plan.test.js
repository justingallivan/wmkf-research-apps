import {
  compileBasicCloneFilePlan,
  resolveTestRequestDocumentDestination,
  TEST_REQUEST_DOCUMENT_KINDS,
} from '../../lib/services/test-requests/file-plan.js';
import {
  expectedProposalBibliographyFilename,
} from '../../lib/utils/proposal-document-names.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function policy(overrides = {}) {
  return {
    allowedMimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    maxFileBytes: 20_000_000,
    maxFiles: 4,
    maxTotalBytes: 40_000_000,
    ...overrides,
  };
}

function document(overrides = {}) {
  return {
    contentHash: HASH_A,
    folder: '1000123_GUID/Phase I',
    id: 'project-description',
    kind: TEST_REQUEST_DOCUMENT_KINDS.projectDescription,
    library: 'Documents',
    mimeType: 'application/pdf',
    name: 'ProjectDescription.pdf',
    size: 1_000,
    versionId: 'version-1',
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    filePolicy: policy(),
    selectedDocumentIds: ['project-description'],
    sourceDocuments: [document()],
    sourceRequestNumber: '1000123',
    ...overrides,
  };
}

describe('compileBasicCloneFilePlan', () => {
  test('plans only the explicitly selected, identity-pinned Phase I files', () => {
    const unselected = document({
      contentHash: HASH_B,
      id: 'biosketches',
      kind: TEST_REQUEST_DOCUMENT_KINDS.biosketches,
      name: 'Biosketches.pdf',
    });
    const result = compileBasicCloneFilePlan(input({ sourceDocuments: [document(), unselected] }));

    expect(result.blockers).toEqual([]);
    expect(result.planReady).toBe(true);
    expect(result.executionReady).toBe(false);
    expect(result.plannedFiles).toEqual([{
      destination: { folder: 'Phase I', filename: 'ProjectDescription.pdf' },
      kind: 'projectDescription',
      operation: 'copy',
      source: expect.objectContaining({
        contentHash: HASH_A,
        id: 'project-description',
        versionId: 'version-1',
      }),
    }]);
    expect(result.plannedFiles).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: expect.objectContaining({ id: 'biosketches' }) }),
    ]));
    expect(result.disclosures).toHaveLength(2);
  });

  test('uses deterministic selection ordering independent of browser order', () => {
    const bio = document({
      contentHash: HASH_B,
      id: 'biosketches',
      kind: TEST_REQUEST_DOCUMENT_KINDS.biosketches,
      name: 'Biosketches.pdf',
    });
    const result = compileBasicCloneFilePlan(input({
      selectedDocumentIds: ['project-description', 'biosketches'],
      sourceDocuments: [document(), bio],
    }));
    expect(result.plannedFiles.map(file => file.source.id)).toEqual(['biosketches', 'project-description']);
  });

  test('shows new-number filename templates but blocks generated artifacts without a transformer', () => {
    const reviewer = document({
      folder: '1000123_GUID/Reviewer Materials',
      id: 'reviewer-proposal',
      kind: TEST_REQUEST_DOCUMENT_KINDS.reviewerProposal,
      name: 'Proposal_1000123.pdf',
    });
    const result = compileBasicCloneFilePlan(input({
      selectedDocumentIds: ['reviewer-proposal'],
      sourceDocuments: [reviewer],
    }));

    expect(result.planReady).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: 'DOCUMENT_TRANSFORMER_REQUIRED',
      field: 'reviewer-proposal',
    }));
    expect(result.plannedFiles[0]).toEqual(expect.objectContaining({
      destination: {
        folder: 'Reviewer Materials',
        filename: 'Proposal_{new-request-number}.pdf',
      },
      operation: 'transform',
    }));
  });

  test.each([
    ['reviewerProposal', 'Reviewer Materials', 'Proposal_1000999.pdf'],
    ['proposalNarrative', 'AI Materials', 'ProposalNarrative_1000999.pdf'],
    ['proposalBibliography', 'AI Materials', 'ProposalBibliography_1000999.pdf'],
  ])('materializes %s only from the destination request number', (kind, folder, filename) => {
    expect(resolveTestRequestDocumentDestination(kind, '1000999')).toEqual({ folder, filename });
  });

  test('rejects unsafe request numbers instead of creating path-like filenames', () => {
    expect(resolveTestRequestDocumentDestination('reviewerProposal', '../1000999')).toBeNull();
    expect(resolveTestRequestDocumentDestination('proposalNarrative', '1000999/evil')).toBeNull();
    expect(expectedProposalBibliographyFilename('')).toBeNull();
  });

  test.each([
    ['missing policy', { filePolicy: undefined }, 'FILE_POLICY_UNKNOWN'],
    ['unknown selection', { selectedDocumentIds: ['not-in-inventory'] }, 'FILE_SELECTION_UNKNOWN'],
    ['duplicate selection', { selectedDocumentIds: ['project-description', 'project-description'] }, 'FILE_SELECTION_DUPLICATE'],
    ['too many files', { filePolicy: policy({ maxFiles: 1 }), selectedDocumentIds: ['project-description', 'project-description'] }, 'FILE_COUNT_EXCEEDED'],
    ['oversized file', { sourceDocuments: [document({ size: 20_000_001 })] }, 'FILE_SIZE_EXCEEDED'],
    ['unsupported type', { sourceDocuments: [document({ mimeType: 'text/html' })] }, 'FILE_TYPE_UNSUPPORTED'],
    ['total too large', { filePolicy: policy({ maxTotalBytes: 999 }) }, 'FILE_TOTAL_SIZE_EXCEEDED'],
  ])('fails closed for %s', (_label, overrides, code) => {
    const result = compileBasicCloneFilePlan(input(overrides));
    expect(result.planReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  test('rejects unknown file shapes, kinds, hashes, and source filename mismatches', () => {
    const cases = [
      document({ unexpected: true }),
      document({ kind: 'arbitraryAttachment' }),
      document({ contentHash: 'not-a-hash' }),
      document({ name: 'renamed.pdf' }),
    ];
    const expectedCodes = [
      'SOURCE_DOCUMENT_INVALID',
      'SOURCE_DOCUMENT_KIND_UNSUPPORTED',
      'SOURCE_DOCUMENT_INVALID',
      'SOURCE_DOCUMENT_MISMATCH',
    ];
    cases.forEach((source, index) => {
      const result = compileBasicCloneFilePlan(input({ sourceDocuments: [source] }));
      expect(result.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: expectedCodes[index] }),
      ]));
    });
  });

  test('requires the source canonical name to match the source request number', () => {
    const narrative = document({
      folder: '1000123_GUID/AI Materials',
      id: 'narrative',
      kind: TEST_REQUEST_DOCUMENT_KINDS.proposalNarrative,
      name: 'ProposalNarrative_9999999.pdf',
    });
    const result = compileBasicCloneFilePlan(input({
      selectedDocumentIds: ['narrative'],
      sourceDocuments: [narrative],
    }));
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: 'SOURCE_DOCUMENT_MISMATCH',
      field: 'narrative',
    }));
    expect(result.plannedFiles).toEqual([]);
  });

  test.each([null, [], false, 'bad'])('rejects non-object input %p without throwing', value => {
    const result = compileBasicCloneFilePlan(value);
    expect(result.planReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.blockers[0].code).toBe('FILE_PLAN_INPUT_INVALID');
  });
});
