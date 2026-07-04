/**
 * Adapter: wmkf_reviewquestions (external-reviewer review-form question set).
 *
 * `wmkf_reviewquestion` rows are the system of record for WHICH questions the
 * external review form asks. The active set (`statecode eq 0`) is resolved,
 * ordered by `wmkf_questionorder`, normalized, and cached by
 * `lib/external/review-question-fetcher.js`; the admin save route reads the same
 * set to hash it for optimistic concurrency.
 *
 * This adapter mirrors the single live read those callers make (Wave-3 buildout)
 * so a later conversion commit can swap it in place without changing the
 * select/filter/order/top shape.
 *
 * Restriction-context posture is CALLER-OWNED: `review-question-fetcher` wraps
 * this read in its own `bypassDynamicsRestrictions('review-question-fetcher', …)`
 * scope. This adapter issues the raw transport call and leaves the trust boundary
 * to the caller — it does NOT establish or bypass restriction context here.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import * as odata from '../core/odata.js';
import { entitySet } from '../core/entity-registry.js';

const QUESTION_ENTITY = entitySet('wmkf_reviewquestions');

// The projection the fetcher normalizes into the review-form field shape.
const QUESTION_SELECT = [
  'wmkf_reviewquestionid',
  'wmkf_questionkey',
  'wmkf_questionorder',
  'wmkf_questiontext',
  'wmkf_questiontype',
  'wmkf_required',
  'wmkf_maxlength',
  'wmkf_hint',
  'wmkf_options',
];

/**
 * Fetch the active review-question set, ordered by question order (top:100).
 * Mirrors review-question-fetcher.fetchActiveQuestionSet. Returns the raw
 * queryRecords result (`{ records, totalCount, hasMore }`) so the caller can keep
 * its 100-row-cap / partial-set fail-closed check.
 */
export async function queryActiveQuestions() {
  return DynamicsService.queryRecords(QUESTION_ENTITY, {
    select: odata.select(QUESTION_SELECT),
    filter: odata.eqRaw('statecode', 0),
    orderby: 'wmkf_questionorder',
    top: 100,
  });
}

export const QUESTION_ENTITY_NAME = QUESTION_ENTITY;
