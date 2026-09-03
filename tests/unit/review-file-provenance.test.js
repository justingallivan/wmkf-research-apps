/** @jest-environment node */

const {
  REVIEW_FILE_PROVENANCE,
  classifyReviewFileProvenance,
  isGeneratedReviewFile,
} = require('../../shared/utils/review-file-provenance');

test.each([
  [null, REVIEW_FILE_PROVENANCE.NONE],
  ['', REVIEW_FILE_PROVENANCE.NONE],
  ['100_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/Reviews', REVIEW_FILE_PROVENANCE.GENERATED],
  ['100_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\\Reviews\\', REVIEW_FILE_PROVENANCE.GENERATED],
  // Retain recognition for the one Production proof file until it is repaired.
  ['100_A/Reviewer_Uploads/Generated/11111111111141118111111111111111', REVIEW_FILE_PROVENANCE.GENERATED],
  ['100_A\\Reviewer_Uploads\\Generated\\11111111111141118111111111111111\\', REVIEW_FILE_PROVENANCE.GENERATED],
  ['100_A/Reviewer_Uploads/Smith/attempt_11111111111141118111111111111111', REVIEW_FILE_PROVENANCE.ATTEMPT_UPLOAD],
  ['100_A/Reviewer_Uploads/Smith/review.pdf', REVIEW_FILE_PROVENANCE.LEGACY],
  ['100_A/Generated/11111111111141118111111111111111', REVIEW_FILE_PROVENANCE.LEGACY],
  ['100_A/Reviews', REVIEW_FILE_PROVENANCE.LEGACY],
  ['100_A/Reviewer_Uploads/Generated/not-a-guid', REVIEW_FILE_PROVENANCE.LEGACY],
])('classifies %p as %s', (folder, expected) => {
  expect(classifyReviewFileProvenance(folder)).toBe(expected);
  expect(isGeneratedReviewFile(folder)).toBe(expected === REVIEW_FILE_PROVENANCE.GENERATED);
});
