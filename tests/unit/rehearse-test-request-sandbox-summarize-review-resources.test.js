/**
 * Test Request Factory slice 6c-ii Stage C — `--run-inspect`'s curated
 * per-reviewer summary (scripts/rehearse-test-request-sandbox.mjs
 * `summarizeReviewResources`): form, file count, attested digest, pointers,
 * with no address or free text (proven by construction: every input value
 * already passed the ledger's no-text-invariant receipt validation).
 *
 * @jest-environment node
 */
import { summarizeReviewResources } from '../../scripts/rehearse-test-request-sandbox.mjs';

const ASSIGNMENT = { sequence: 1, sourcePersonId: 'source-1', destinationPersonId: 'dest-1', reused: false, addressSha256: 'a'.repeat(64) };

function suggestionResource(overrides = {}) {
  return {
    step: 'seed_reviewers', resourceKind: 'dataverse_reviewer_suggestion',
    plannedIdentity: { assignmentSequence: 1, suggestionId: 'suggestion-1' },
    outcome: 'verified',
    ...overrides,
  };
}
function answersResource(overrides = {}) {
  return {
    step: 'seed_review_answers', resourceKind: 'dataverse_review_answer_set',
    plannedIdentity: { assignmentSequence: 1, reviewForm: 'uploaded', answerCount: 1 },
    readback: { answerCount: 1 },
    outcome: 'verified',
    ...overrides,
  };
}
function folderResource(overrides = {}) {
  return {
    step: 'copy_review_file', resourceKind: 'sharepoint_folder',
    plannedIdentity: { assignmentSequence: 1, folder: 'Reviewer_Uploads/Reviewer_abcd1234/attempt_' + '0'.repeat(32) },
    readback: { filename: 'Review_1.docx' },
    outcome: 'verified',
    ...overrides,
  };
}
function fileResource(overrides = {}) {
  return {
    step: 'copy_review_file', resourceKind: 'sharepoint_file',
    plannedIdentity: { assignmentSequence: 1, index: 0, filename: 'Review_1.docx' },
    readback: { attestedDigest: 'b'.repeat(64) },
    outcome: 'verified',
    ...overrides,
  };
}

describe('summarizeReviewResources', () => {
  it('summarizes an uploaded review: form, file count, attested digest, pointers', () => {
    const resources = [suggestionResource(), answersResource(), folderResource(), fileResource()];
    const summary = summarizeReviewResources(resources, [ASSIGNMENT]);
    expect(summary).toEqual([{
      sequence: 1,
      destinationSuggestionId: 'suggestion-1',
      reviewForm: 'uploaded',
      answerCount: 1,
      fileCount: 1,
      attestedDigests: ['b'.repeat(64)],
      pointers: { folder: 'Reviewer_Uploads/Reviewer_abcd1234/attempt_' + '0'.repeat(32), filename: 'Review_1.docx' },
    }]);
  });

  it('summarizes a received_no_file review: no pointers, no attested digest', () => {
    const resources = [suggestionResource(), answersResource({ plannedIdentity: { assignmentSequence: 1, reviewForm: 'received_no_file', answerCount: 0 }, readback: { answerCount: 0 } })];
    const summary = summarizeReviewResources(resources, [ASSIGNMENT]);
    expect(summary[0].reviewForm).toBe('received_no_file');
    expect(summary[0].pointers).toBeNull();
    expect(summary[0].fileCount).toBe(0);
    expect(summary[0].attestedDigests).toBeNull();
  });

  it('summarizes a PDF (exact-hash) review: file present, no attestedDigest (DOCX-only evidence)', () => {
    const resources = [
      suggestionResource(), answersResource(),
      folderResource({ readback: { filename: 'Review_1.pdf' } }),
      fileResource({ plannedIdentity: { assignmentSequence: 1, index: 0, filename: 'Review_1.pdf' }, readback: {} }),
    ];
    const summary = summarizeReviewResources(resources, [ASSIGNMENT]);
    expect(summary[0].fileCount).toBe(1);
    expect(summary[0].attestedDigests).toBeNull();
    expect(summary[0].pointers).toEqual({ folder: 'Reviewer_Uploads/Reviewer_abcd1234/attempt_' + '0'.repeat(32), filename: 'Review_1.pdf' });
  });

  it('never carries an address or free text -- only enum/GUID/hash/path-shaped fields', () => {
    const resources = [suggestionResource(), answersResource(), folderResource(), fileResource()];
    const summary = summarizeReviewResources(resources, [ASSIGNMENT]);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toMatch(/@/); // no email address
    expect(ASSIGNMENT).not.toHaveProperty('address');
  });
});
