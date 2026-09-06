/** @jest-environment node */

/**
 * Stage 3C: `lib/services/review-manager/reviewers-service.js` re-exports
 * `patchReviewers` and `ReviewerStatusMutationError` from the new
 * `lib/services/reviewer-engagement/correct-status.js` module (a partial-file
 * extraction — `getReviewers` and its projections stay in the old module).
 * Both import paths must resolve to the exact same objects — reference
 * identity (`toBe`) for the function and the class — so existing
 * callers/tests on the old path keep working unmodified.
 */

const updateLifecycle = jest.fn(async () => {
  throw new Error('adapter rejected the write');
});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  updateLifecycle: (...a) => updateLifecycle(...a),
}));

import {
  patchReviewers as newPatchReviewers,
  ReviewerStatusMutationError as NewReviewerStatusMutationError,
} from '../../lib/services/reviewer-engagement/correct-status';
import {
  patchReviewers as oldPatchReviewers,
  ReviewerStatusMutationError as OldReviewerStatusMutationError,
} from '../../lib/services/review-manager/reviewers-service';

describe('reviewer-engagement correct-status compatibility paths', () => {
  it('exports the same patchReviewers function object from both paths', () => {
    expect(oldPatchReviewers).toBe(newPatchReviewers);
  });

  it('exports the same ReviewerStatusMutationError class from both paths', () => {
    expect(OldReviewerStatusMutationError).toBe(NewReviewerStatusMutationError);
  });

  it('an error thrown by the new-path patchReviewers is instanceof the old path\'s error class', async () => {
    await expect(newPatchReviewers({
      suggestionId: '11111111-1111-4111-8111-111111111111',
      lifecycle: { reviewStatus: 'under_review' },
      actingUserSystemId: null,
    })).rejects.toBeInstanceOf(OldReviewerStatusMutationError);
  });
});
