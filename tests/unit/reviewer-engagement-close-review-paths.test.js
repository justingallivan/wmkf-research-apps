/** @jest-environment node */

/**
 * Stage 3A pilot: `lib/services/review-manager/close-review-service.js` is now
 * a pure compatibility re-export of `lib/services/reviewer-engagement/close-review.js`.
 * Both import paths must resolve to the exact same objects — reference
 * identity (`toBe`) for the functions — so existing callers/tests on the old
 * path keep working unmodified. `ServiceHttpError` is not re-exported by
 * either close-review module (it never was, on main); the canonical import
 * is `lib/services/service-http-error.js`, used here only to assert the
 * error class thrown by the new-path `closeReview`.
 */

import {
  closeReview as newCloseReview,
  _closeReviewInternals as newInternals,
} from '../../lib/services/reviewer-engagement/close-review';
import {
  closeReview as oldCloseReview,
  _closeReviewInternals as oldInternals,
} from '../../lib/services/review-manager/close-review-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

describe('reviewer-engagement close-review compatibility paths', () => {
  it('exports the same closeReview function object from both paths', () => {
    expect(oldCloseReview).toBe(newCloseReview);
  });

  it('exports the same _closeReviewInternals object from both paths', () => {
    expect(oldInternals).toBe(newInternals);
  });

  it('an error thrown by the new-path closeReview is instanceof ServiceHttpError', async () => {
    await expect(newCloseReview({
      suggestionId: '11111111-1111-4111-8111-111111111111',
      disposition: 'not_a_real_disposition',
      actingUserSystemId: '22222222-2222-4222-8222-222222222222',
      authorizedRequestId: '33333333-3333-4333-8333-333333333333',
    })).rejects.toBeInstanceOf(ServiceHttpError);
  });
});
