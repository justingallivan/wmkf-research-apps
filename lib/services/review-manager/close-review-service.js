/**
 * Compatibility re-export. The implementation moved to
 * `lib/services/reviewer-engagement/close-review.js` (Stage 3A). This module
 * re-exports the same objects — `instanceof` and reference identity (`toBe`)
 * hold across both import paths.
 */
export { closeReview, _closeReviewInternals, ServiceHttpError } from '../reviewer-engagement/close-review';
