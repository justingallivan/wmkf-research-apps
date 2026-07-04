/**
 * Shared reader for reviewer answer-snapshot child rows (`wmkf_appreviewanswers`).
 *
 * Hoisted out of `pages/api/review-manager/reviewers.js` (its original home) so
 * BOTH the workbench Reviews-tab GET and the thank-you sweep
 * (`lib/services/reviewer-thankyou-sweep.js`) read the report-ready answer shape
 * through ONE code path instead of duplicating the keyed query + re-sanitize.
 *
 * Wave 3 (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md) converted this module to a
 * thin delegate over `lib/dataverse/adapters/review-answer.js`, which now owns
 * the read contract (keyed query, 20-id OR-chunking, fail-loud 5000-row cap,
 * re-sanitized answerHtml, questionOrder sort). This file's exported API stays
 * byte-stable for its existing callers
 * (`pages/api/review-manager/reviewers.js`, `lib/services/reviewer-thankyou-sweep.js`,
 * `shared/utils/review-report.js`).
 */

export {
  ANSWER_FIELDS,
  fetchAnswersBySuggestion,
} from '../dataverse/adapters/review-answer.js';
