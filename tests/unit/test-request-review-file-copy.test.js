/** @jest-environment node */
import crypto from 'node:crypto';
import {
  REVIEW_FILE_COPY_POLICY, reviewFileCopyPolicyDigest, planReviewFileCopies,
} from '../../lib/services/test-requests/review-file-copy.js';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC_MIME = 'application/msword';

function reviewFile(over = {}) {
  return {
    id: 'sugg-1:item-1', kind: 'reviewerUpload', library: 'akoya_request',
    folder: 'source/Reviewer_Uploads/smith_abcd1234/attempt_11111111111111111111111111111111',
    name: 'MyReview.pdf', driveId: 'src-drive', graphItemId: 'item-1',
    sharePointSite: { key: 'akoyago-shared', hostname: 'x.sharepoint.com', pathname: '/sites/akoyago' },
    size: 1000, mimeType: PDF_MIME, eTag: '"e1"', versionId: '1.0',
    contentHash: hash('pdf-bytes'), suggestionId: 'sugg-1',
    ...over,
  };
}

function bundleWith(reviewers) {
  return { reviewers };
}

const REVIEW = {
  sourcePersonId: 'person-1',
  destinationSuggestionId: 'DDDDDDDD-1111-2222-3333-444444444444',
  destinationPersonName: { wmkf_lastname: 'Smith', wmkf_name: 'TEST · Dr. Jane Smith' },
  attemptId: 'a'.repeat(32),
};

describe('REVIEW_FILE_COPY_POLICY', () => {
  it('binds every extension to exactly one MIME type and states a defensible total', () => {
    expect(REVIEW_FILE_COPY_POLICY.extensionMimeTypes).toEqual({ pdf: PDF_MIME, docx: DOCX_MIME, doc: DOC_MIME });
    expect(REVIEW_FILE_COPY_POLICY.maxFilesPerReview).toBe(5);
    expect(REVIEW_FILE_COPY_POLICY.maxReviewers).toBe(100);
    expect(REVIEW_FILE_COPY_POLICY.maxFileBytes).toBe(25 * 1024 * 1024);
    // NOT maxReviewers * maxFilesPerReview * maxFileBytes (12.5 GB).
    expect(REVIEW_FILE_COPY_POLICY.maxTotalBytes).toBeLessThan(
      REVIEW_FILE_COPY_POLICY.maxReviewers * REVIEW_FILE_COPY_POLICY.maxFilesPerReview * REVIEW_FILE_COPY_POLICY.maxFileBytes,
    );
    expect(reviewFileCopyPolicyDigest()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('planReviewFileCopies', () => {
  it('plans one entry per file with the deterministic folder/filename grammar, primary file first', () => {
    const bundle = bundleWith([{
      personId: 'person-1', suggestionId: 'sugg-1',
      files: [reviewFile({ name: 'PrimaryReview.pdf' }), reviewFile({ name: 'Appendix.docx', mimeType: DOCX_MIME, id: 'sugg-1:item-2', graphItemId: 'item-2' })],
    }]);
    const plan = planReviewFileCopies(bundle, { reviews: [REVIEW] });
    expect(plan).toHaveLength(2);
    expect(plan[0].destination).toEqual({
      library: 'akoya_request',
      folder: `Reviewer_Uploads/Smith_DDDDDDDD/attempt_${'a'.repeat(32)}`,
      filename: 'Review_1.pdf',
    });
    expect(plan[1].destination.filename).toBe('Review_2.docx');
    expect(plan[0].kind).toBe('reviewerUpload');
    expect(plan[0].source.name).toBe('PrimaryReview.pdf');
  });

  it('is a no-op for a reviewer with no files (received_no_file/unreceived)', () => {
    const bundle = bundleWith([{ personId: 'person-1', suggestionId: 'sugg-1', files: [] }]);
    expect(planReviewFileCopies(bundle, { reviews: [REVIEW] })).toEqual([]);
  });

  it('refuses a MIME type that does not match its extension (kind<->extension<->MIME binding)', () => {
    const bundle = bundleWith([{ personId: 'person-1', suggestionId: 'sugg-1', files: [reviewFile({ name: 'Sneaky.pdf', mimeType: DOCX_MIME })] }]);
    expect(() => planReviewFileCopies(bundle, { reviews: [REVIEW] })).toThrow(/MIME type .* does not match its extension/);
  });

  it('refuses an unsupported extension', () => {
    const bundle = bundleWith([{ personId: 'person-1', suggestionId: 'sugg-1', files: [reviewFile({ name: 'Sneaky.exe', mimeType: PDF_MIME })] }]);
    expect(() => planReviewFileCopies(bundle, { reviews: [REVIEW] })).toThrow(/unsupported extension/);
  });

  it('refuses a file over the per-file byte ceiling', () => {
    const bundle = bundleWith([{ personId: 'person-1', suggestionId: 'sugg-1', files: [reviewFile({ size: REVIEW_FILE_COPY_POLICY.maxFileBytes + 1 })] }]);
    expect(() => planReviewFileCopies(bundle, { reviews: [REVIEW] })).toThrow(/size is invalid or exceeds/);
  });

  it('refuses more than maxFilesPerReview files', () => {
    const files = Array.from({ length: 6 }, (_, i) => reviewFile({ name: `F${i}.pdf`, graphItemId: `item-${i}` }));
    const bundle = bundleWith([{ personId: 'person-1', suggestionId: 'sugg-1', files }]);
    expect(() => planReviewFileCopies(bundle, { reviews: [REVIEW] })).toThrow(/file-per-review ceiling/);
  });

  it('refuses more than maxReviewers reviews', () => {
    const bundle = bundleWith([{ personId: 'person-1', suggestionId: 'sugg-1', files: [reviewFile()] }]);
    const reviews = Array.from({ length: REVIEW_FILE_COPY_POLICY.maxReviewers + 1 }, () => REVIEW);
    expect(() => planReviewFileCopies(bundle, { reviews }, REVIEW_FILE_COPY_POLICY)).toThrow(/reviewer\(s\) exceeds/);
  });

  it('refuses when the total plan exceeds maxTotalBytes', () => {
    const tinyPolicy = { ...REVIEW_FILE_COPY_POLICY, maxTotalBytes: 500 };
    const bundle = bundleWith([{ personId: 'person-1', suggestionId: 'sugg-1', files: [reviewFile({ size: 1000 })] }]);
    expect(() => planReviewFileCopies(bundle, { reviews: [REVIEW] }, tinyPolicy)).toThrow(/exceeding the 500-byte ceiling/);
  });

  it('refuses without a 32-hex attempt id', () => {
    const bundle = bundleWith([{ personId: 'person-1', suggestionId: 'sugg-1', files: [reviewFile()] }]);
    expect(() => planReviewFileCopies(bundle, { reviews: [{ ...REVIEW, attemptId: 'not-hex' }] }))
      .toThrow(/32-hex attempt id/);
  });

  it('refuses a reviewer missing from the bundle', () => {
    const bundle = bundleWith([]);
    expect(() => planReviewFileCopies(bundle, { reviews: [REVIEW] })).toThrow(/no reviewer for person/);
  });

  it('refuses two reviewers resolving to the same destination folder', () => {
    const bundle = bundleWith([
      { personId: 'person-1', suggestionId: 'sugg-1', files: [reviewFile()] },
      { personId: 'person-2', suggestionId: 'sugg-2', files: [reviewFile({ id: 'sugg-2:item-1' })] },
    ]);
    const reviews = [REVIEW, { ...REVIEW, sourcePersonId: 'person-2' }];
    expect(() => planReviewFileCopies(bundle, { reviews })).toThrow(/same destination folder/);
  });
});
