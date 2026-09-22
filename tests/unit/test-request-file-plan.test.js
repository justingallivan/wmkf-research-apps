import { readFileSync } from 'fs';
import path from 'path';
import {
  compileBasicCloneFilePlan,
  TEST_REQUEST_DOCUMENT_KINDS,
} from '../../lib/services/test-requests/file-plan.js';
import { expectedProposalBibliographyFilename } from '../../lib/utils/proposal-document-names.js';

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
    eTag: 'etag-1',
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

function trusted(overrides = {}) {
  return {
    filePolicy: policy(),
    sourceDocuments: [document()],
    sourceRequestNumber: '1000123',
    ...overrides,
  };
}

function selection(overrides = {}) {
  return {
    selectedDocumentIds: ['project-description'],
    ...overrides,
  };
}

function compile(trustedOverrides = {}, selectionOverrides = {}) {
  return compileBasicCloneFilePlan(trusted(trustedOverrides), selection(selectionOverrides));
}

describe('compileBasicCloneFilePlan', () => {
  test('plans only explicitly selected, identity-pinned Phase I files', () => {
    const unselected = document({
      contentHash: HASH_B,
      id: 'biosketches',
      kind: TEST_REQUEST_DOCUMENT_KINDS.biosketches,
      name: 'Biosketches.pdf',
    });
    const result = compile({ sourceDocuments: [document(), unselected] });

    expect(result.blockers).toEqual([]);
    expect(result.planReady).toBe(true);
    expect(result.executionReady).toBe(false);
    expect(result.plannedFiles).toEqual([{
      destination: { folder: 'Phase I', filename: 'ProjectDescription.pdf', filenameTemplate: null },
      kind: 'projectDescription',
      operation: 'copy',
      source: expect.objectContaining({
        contentHash: HASH_A,
        eTag: 'etag-1',
        id: 'project-description',
        versionId: 'version-1',
      }),
    }]);
    expect(result.previewFiles[0].operation).toBe('would-copy');
    expect(result.disclosures).toHaveLength(2);
  });

  test('uses deterministic selection ordering independent of browser order', () => {
    const bio = document({
      contentHash: HASH_B,
      id: 'biosketches',
      kind: TEST_REQUEST_DOCUMENT_KINDS.biosketches,
      name: 'Biosketches.pdf',
    });
    const result = compile(
      { sourceDocuments: [document(), bio] },
      { selectedDocumentIds: ['project-description', 'biosketches'] },
    );
    expect(result.plannedFiles.map(file => file.source.id)).toEqual(['biosketches', 'project-description']);
  });

  test('shows a non-executable template and blocks generated artifacts without a transformer', () => {
    const reviewer = document({
      folder: '1000123_GUID/Reviewer Materials',
      id: 'reviewer-proposal',
      kind: TEST_REQUEST_DOCUMENT_KINDS.reviewerProposal,
      name: 'Proposal_1000123.pdf',
    });
    const result = compile(
      { sourceDocuments: [reviewer] },
      { selectedDocumentIds: ['reviewer-proposal'] },
    );

    expect(result.planReady).toBe(false);
    expect(result.plannedFiles).toEqual([]);
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: 'DOCUMENT_TRANSFORMER_REQUIRED',
      field: 'reviewer-proposal',
    }));
    expect(result.previewFiles[0]).toEqual(expect.objectContaining({
      destination: {
        folder: 'Reviewer Materials',
        filename: null,
        filenameTemplate: 'Proposal_{new-request-number}.pdf',
      },
      operation: 'requires-transform',
    }));
  });

  test.each([
    ['reviewerProposal', 'Reviewer Materials', 'Proposal_1000999.pdf'],
    ['proposalNarrative', 'AI Materials', 'ProposalNarrative_1000999.pdf'],
    ['proposalBibliography', 'AI Materials', 'ProposalBibliography_1000999.pdf'],
  ])('materializes %s in the generated preview from the trusted destination number', (kind, folder, filename) => {
    const sourceName = kind === 'reviewerProposal'
      ? 'Proposal_1000123.pdf'
      : kind === 'proposalNarrative'
        ? 'ProposalNarrative_1000123.pdf'
        : 'ProposalBibliography_1000123.pdf';
    const sourceFolder = kind === 'reviewerProposal' ? 'Reviewer Materials' : 'AI Materials';
    const generated = document({
      folder: `1000123_GUID/${sourceFolder}`,
      id: kind,
      kind,
      name: sourceName,
    });
    const result = compile(
      { destinationRequestNumber: '1000999', sourceDocuments: [generated] },
      { selectedDocumentIds: [kind] },
    );
    expect(result.previewFiles[0].destination).toEqual({ folder, filename, filenameTemplate: null });
    expect(result.previewFiles[0].operation).toBe('requires-transform');
    expect(result.plannedFiles).toEqual([]);
  });

  test('rejects unsafe destination request numbers on the generated-document path', () => {
    const reviewer = document({
      folder: '1000123_GUID/Reviewer Materials',
      id: 'reviewer-proposal',
      kind: TEST_REQUEST_DOCUMENT_KINDS.reviewerProposal,
      name: 'Proposal_1000123.pdf',
    });
    const result = compile(
      { destinationRequestNumber: '../1000999', sourceDocuments: [reviewer] },
      { selectedDocumentIds: ['reviewer-proposal'] },
    );
    expect(result.planReady).toBe(false);
    expect(result.plannedFiles).toEqual([]);
    expect(result.previewFiles[0].destination).toBeNull();
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: 'DESTINATION_REQUEST_NUMBER_INVALID',
    }));
    expect(expectedProposalBibliographyFilename('')).toBeNull();
  });

  test.each([
    ['missing policy', { filePolicy: undefined }, {}, 'FILE_POLICY_UNKNOWN'],
    ['unknown selection', {}, { selectedDocumentIds: ['not-in-inventory'] }, 'FILE_SELECTION_UNKNOWN'],
    ['duplicate selection', {}, { selectedDocumentIds: ['project-description', 'project-description'] }, 'FILE_SELECTION_DUPLICATE'],
    ['oversized file', { sourceDocuments: [document({ size: 20_000_001 })] }, {}, 'FILE_SIZE_EXCEEDED'],
    ['unsupported type', { sourceDocuments: [document({ mimeType: 'text/html' })] }, {}, 'FILE_TYPE_UNSUPPORTED'],
    ['total too large', { filePolicy: policy({ maxTotalBytes: 999 }) }, {}, 'FILE_TOTAL_SIZE_EXCEEDED'],
  ])('fails closed for %s and emits no actionable copy plan', (_label, trustedOverrides, selectionOverrides, code) => {
    const result = compile(trustedOverrides, selectionOverrides);
    expect(result.planReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.plannedFiles).toEqual([]);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  test('enforces maxFiles with two distinct valid selections', () => {
    const bio = document({
      contentHash: HASH_B,
      id: 'biosketches',
      kind: TEST_REQUEST_DOCUMENT_KINDS.biosketches,
      name: 'Biosketches.pdf',
    });
    const result = compile(
      { filePolicy: policy({ maxFiles: 1 }), sourceDocuments: [document(), bio] },
      { selectedDocumentIds: ['project-description', 'biosketches'] },
    );
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'FILE_COUNT_EXCEEDED' }));
    expect(result.blockers).not.toContainEqual(expect.objectContaining({ code: 'FILE_SELECTION_DUPLICATE' }));
    expect(result.plannedFiles).toEqual([]);
  });

  test('blocks distinct source files that resolve to the same destination', () => {
    const duplicateDestination = document({
      contentHash: HASH_B,
      eTag: 'etag-2',
      folder: '1000123_ARCHIVE/Phase I',
      id: 'archived-project-description',
      versionId: null,
    });
    const result = compile(
      { sourceDocuments: [document(), duplicateDestination] },
      { selectedDocumentIds: ['project-description', 'archived-project-description'] },
    );

    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: 'DESTINATION_COLLISION',
      field: 'selectedDocumentIds',
    }));
    expect(result.plannedFiles).toEqual([]);
    expect(result.previewFiles.every(file => file.operation === 'blocked')).toBe(true);
  });

  test('marks policy-rejected previews blocked rather than copyable', () => {
    const result = compile({ sourceDocuments: [document({ mimeType: 'text/html', size: 20_000_001 })] });
    expect(result.previewFiles[0].operation).toBe('blocked');
    expect(result.plannedFiles).toEqual([]);
  });

  test('marks unevaluated and aggregate-blocked preview rows blocked', () => {
    const missingPolicy = compile({ filePolicy: undefined });
    expect(missingPolicy.previewFiles[0].operation).toBe('blocked');

    const totalExceeded = compile({ filePolicy: policy({ maxTotalBytes: 999 }) });
    expect(totalExceeded.previewFiles[0].operation).toBe('blocked');
  });

  test('rejects unknown file shapes, kinds, hashes, and source filename mismatches', () => {
    const cases = [
      [document({ unexpected: true }), 'SOURCE_DOCUMENT_INVALID'],
      [document({ kind: 'arbitraryAttachment' }), 'SOURCE_DOCUMENT_KIND_UNSUPPORTED'],
      [document({ contentHash: 'not-a-hash' }), 'SOURCE_DOCUMENT_INVALID'],
      [document({ name: 'renamed.pdf' }), 'SOURCE_DOCUMENT_MISMATCH'],
    ];
    cases.forEach(([source, code]) => {
      const result = compile({ sourceDocuments: [source] });
      expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
      expect(result.plannedFiles).toEqual([]);
    });
  });

  test('requires the source canonical name to match the source request number', () => {
    const narrative = document({
      folder: '1000123_GUID/AI Materials',
      id: 'narrative',
      kind: TEST_REQUEST_DOCUMENT_KINDS.proposalNarrative,
      name: 'ProposalNarrative_9999999.pdf',
    });
    const result = compile(
      { sourceDocuments: [narrative] },
      { selectedDocumentIds: ['narrative'] },
    );
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: 'SOURCE_DOCUMENT_MISMATCH',
      field: 'narrative',
    }));
    expect(result.plannedFiles).toEqual([]);
  });

  test.each([null, [], false, 'bad'])('rejects non-object trusted input %p without throwing', value => {
    const result = compileBasicCloneFilePlan(value, selection());
    expect(result.planReady).toBe(false);
    expect(result.blockers[0].code).toBe('FILE_PLAN_TRUSTED_INPUT_INVALID');
  });

  test.each([null, [], false, 'bad'])('rejects non-object browser input %p without throwing', value => {
    const result = compileBasicCloneFilePlan(trusted(), value);
    expect(result.planReady).toBe(false);
    expect(result.blockers[0].code).toBe('FILE_SELECTION_INPUT_INVALID');
  });

  test('invalid non-JSON selection values never enter sorting or throw', () => {
    const result = compile({}, { selectedDocumentIds: [Symbol('bad'), null, {}, 'project-description'] });
    expect(result.blockers.filter(item => item.code === 'FILE_SELECTION_INVALID')).toHaveLength(3);
    expect(result.previewFiles).toHaveLength(1);
    expect(result.plannedFiles).toEqual([]);
  });

  test('keeps the planner import graph pure and leaf-only', () => {
    const source = readFileSync(path.join(__dirname, '../../lib/services/test-requests/file-plan.js'), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
    expect(imports).toEqual(['../../utils/proposal-document-names.js']);
    expect(source).not.toMatch(/GraphService|DynamicsService|fetch\s*\(|@vercel\/blob|database-service|\brequire\s*\(|\bimport\s*\(/);
  });

  test('keeps the preview composer and policy import graph pure', () => {
    const preview = readFileSync(path.join(__dirname, '../../lib/services/test-requests/preview.js'), 'utf8');
    const policySource = readFileSync(path.join(__dirname, '../../lib/services/test-requests/policy.js'), 'utf8');
    const imports = [...preview.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
    expect(imports).toEqual(['./policy.js', './file-plan.js']);
    expect(preview).not.toMatch(/GraphService|DynamicsService|fetch\s*\(|@vercel\/blob|database-service|\brequire\s*\(|\bimport\s*\(/);
    expect(policySource).not.toMatch(/GraphService|DynamicsService|fetch\s*\(|@vercel\/blob|database-service|\brequire\s*\(|\bimport\s*\(/);
  });
});
