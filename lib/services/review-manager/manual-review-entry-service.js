/**
 * Staff manual review-entry rescue.
 *
 * This is the authenticated staff analogue of the external review submit
 * producer, not an extension of the retained partial/file-era
 * mark-received-no-file contract. It loads the live question set, sanitizes
 * and fully validates the answers, builds the canonical parent + answer-row
 * snapshot, and commits them atomically with a parent row-version guard.
 */

import ReviewDraftService from '../review-draft-service';
import { ServiceHttpError } from '../service-http-error';
import {
  getActiveQuestionSet,
  questionSetVersion,
} from '../../external/review-question-fetcher';
import { sanitizeReviewHtml } from '../../external/sanitize-review-html';
import {
  validateReviewSubmission,
  buildReviewSubmission,
} from '../../external/build-review-submission';
import {
  getByIdWithSelect,
  ENTITY_SET_NAME as SUGGESTION_ENTITY_SET,
} from '../../dataverse/adapters/reviewer-suggestion';
import { answerUpsertDescriptor } from '../../dataverse/adapters/review-answer';
import { runChangeset, atomicParentWithChildren } from '../../dataverse/core/changeset';
import {
  authorizeReviewReceipt,
  ReviewReceiptEligibilityError,
} from '../review-receipt-guard';

const SUGGESTION_FIELDS = [
  'wmkf_appreviewersuggestionid',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_reviewreceivedat',
  'wmkf_reviewstatus',
  'wmkf_revieweraffiliation',
].join(',');

export class ManualReviewEntryError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'ManualReviewEntryError';
  }
}

function domainError(reason, httpStatus, message, extra = {}) {
  return new ManualReviewEntryError(reason, httpStatus, {
    ok: false,
    reason,
    message,
    ...extra,
  });
}

function isNotFound(error) {
  return error?.status === 404
    || error?.response?.status === 404
    || /(?:get|update|changeset).*404|not found/i.test(error?.message || '');
}

async function loadEligibleSuggestion(suggestionId) {
  let suggestion;
  try {
    suggestion = await getByIdWithSelect(suggestionId, SUGGESTION_FIELDS);
  } catch (error) {
    if (isNotFound(error)) {
      throw domainError('not_found', 404, 'Reviewer suggestion not found.');
    }
    throw error;
  }

  if (!suggestion) {
    throw domainError('not_found', 404, 'Reviewer suggestion not found.');
  }
  try {
    authorizeReviewReceipt(suggestion);
  } catch (error) {
    if (!(error instanceof ReviewReceiptEligibilityError)) throw error;
    if (error.reason === 'engagement_ended') {
      throw domainError('engagement_ended', 409, 'This reviewer engagement has ended.');
    }
    if (error.reason === 'review_received_locked') {
      throw domainError('review_received_locked', 409, 'A review has already been recorded for this reviewer.');
    }
    if (error.reason === 'not_eligible') {
      throw domainError(
        'not_eligible',
        409,
        'Manual review entry is available only for an accepted reviewer with no recorded review.',
      );
    }
    throw domainError(
      'conflict',
      409,
      'The reviewer row could not be locked for a safe update. Reload and try again.',
    );
  }
  return suggestion;
}

function sanitizeRichText(answers, questionSet) {
  const output = { ...(answers && typeof answers === 'object' ? answers : {}) };
  for (const field of questionSet) {
    if (field.type !== 'richtext') continue;
    output[field.key] = typeof output[field.key] === 'string'
      ? sanitizeReviewHtml(output[field.key])
      : '';
  }
  return output;
}

export async function getManualReviewEntryForm({ suggestionId }) {
  const suggestion = await loadEligibleSuggestion(suggestionId);
  const questions = await getActiveQuestionSet();
  return {
    ok: true,
    questions,
    setVersion: questionSetVersion(questions),
    affiliation: suggestion.wmkf_revieweraffiliation || '',
  };
}

export async function submitManualReviewEntry({
  suggestionId,
  answers,
  setVersion,
  actingUserSystemId,
}) {
  // Re-read immediately before building the changeset. The returned etag is
  // the optimistic-concurrency guard on the parent PATCH.
  const suggestion = await loadEligibleSuggestion(suggestionId);
  const questionSet = await getActiveQuestionSet();
  const currentVersion = questionSetVersion(questionSet);

  if (setVersion !== currentVersion) {
    throw domainError(
      'set_changed',
      409,
      'The review questions changed while this form was open. Reload the current questions before submitting.',
    );
  }

  const sanitized = sanitizeRichText(answers, questionSet);
  const validation = validateReviewSubmission(sanitized, questionSet);
  if (!validation.ok) {
    throw domainError('validation', 400, 'The review is incomplete or invalid.', {
      errors: validation.errors,
    });
  }

  const receivedAt = new Date().toISOString();
  const { parentPatch, answerRows } = buildReviewSubmission(validation.normalized, {
    receivedAt,
    questionSet,
  });
  parentPatch.wmkf_reviewuploadedbystaff = true;

  const snapshotKeys = new Set(
    questionSet
      .filter((field) => field.type === 'picklist' || field.type === 'richtext')
      .map((field) => field.key),
  );
  const children = answerRows.map((row) =>
    answerUpsertDescriptor(suggestionId, row, snapshotKeys));
  const parent = {
    method: 'PATCH',
    entitySet: SUGGESTION_ENTITY_SET,
    key: suggestionId,
    body: parentPatch,
    ifMatch: authorizeReviewReceipt(suggestion).ifMatch,
  };

  try {
    await runChangeset(
      atomicParentWithChildren({ parent, children }),
      { actingUserSystemId },
    );
  } catch (error) {
    if (isNotFound(error)) {
      throw domainError('not_found', 404, 'Reviewer suggestion not found.');
    }
    if (error?.status === 412 || error?.response?.status === 412) {
      throw domainError(
        'conflict',
        409,
        'This reviewer changed while the review was being recorded. Reload and try again.',
      );
    }
    throw error;
  }

  // A reviewer may have started a portal draft before staff used the rescue.
  // The Dataverse commit is authoritative; cleanup is deliberately best-effort.
  try {
    await ReviewDraftService.deleteBySuggestion(suggestionId);
  } catch (error) {
    console.error('[manual review entry] post-commit draft delete failed (non-fatal):', error.message);
  }

  return { ok: true, receivedAt };
}
