/**
 * External Reviewer Portal — final review submission service
 * (Route→Service Consolidation Plan, Stage 5, fail-closed batch).
 *
 * Holds the post-verification pipeline for
 * POST /api/external/review/[token]/submit (see the route header for the
 * caller-facing contract); the route is a thin shell that keeps the ENTIRE
 * token boundary byte-untouched (rate limit → verify → outcome recording →
 * failure envelopes → `tokenHasOp('upload_review')` fail-closed ops gate).
 *
 * Pipeline (moved verbatim): engagement gate → FINALITY precheck →
 * set_changed reload signal → sanitize → validate → buildReviewSubmission →
 * ATOMIC changeset (N answer upserts by alternate key + If-Match-guarded
 * parent PATCH) → best-effort post-commit draft delete.
 *
 * Contract (plan Decision 3):
 *   - plain argument object, never req/res;
 *   - returns the exact 200 body { ok:true, receivedAt };
 *   - throws ServiceHttpError with explicit { ok:false, reason, ... } bodies
 *     for every historical non-2xx envelope (400 validation, 409
 *     review_received_locked / materials_not_sent / set_changed / conflict,
 *     500 changeset server_error);
 *   - DAL context: the historical route wrapped ONLY the changeset block in
 *     the legacy bypass 'external-review-submit'. Converted
 *     bypass→withDalContext per Decision 4 with the label kept and scope
 *     IDENTICAL, preserved inside this service — the declared Stage 5
 *     deviation pattern for narrow historical scopes.
 */

import { withDalContext } from '../../dataverse/core/context';
import ReviewDraftService from '../review-draft-service';
import { computeEngagementState } from '../../external/review-engagement-state';
import { getActiveQuestionSet, questionSetVersion } from '../../external/review-question-fetcher';
import { sanitizeReviewHtml } from '../../external/sanitize-review-html';
import { validateReviewSubmission, buildReviewSubmission } from '../../external/build-review-submission';
import { getForSubmitFinalityCheck, ENTITY_SET_NAME as SUGGESTION_ENTITY_SET } from '../../dataverse/adapters/reviewer-suggestion';
import { answerUpsertDescriptor } from '../../dataverse/adapters/review-answer';
import { runChangeset, atomicParentWithChildren } from '../../dataverse/core/changeset';
import { ServiceHttpError } from '../service-http-error';

const PARENT_ENTITY_SET = SUGGESTION_ENTITY_SET;
const REVIEW_RECEIVED_LOCKED_MESSAGE =
  'This review has already been submitted. To make a change, please contact your Program Director.';

/** Server-sanitize every rich-text answer before validation/build — the write is the boundary. */
function sanitizeRichText(answers, richtextKeys) {
  const out = { ...answers };
  for (const key of richtextKeys) {
    if (typeof out[key] === 'string') out[key] = sanitizeReviewHtml(out[key]);
    else if (out[key] != null) out[key] = ''; // non-string → drop to empty
  }
  return out;
}

function reviewReceivedLockedError() {
  return new ServiceHttpError('review_received_locked', {
    httpStatus: 409,
    body: {
      ok: false,
      reason: 'review_received_locked',
      message: REVIEW_RECEIVED_LOCKED_MESSAGE,
    },
  });
}

/**
 * Submit the verified reviewer's final review.
 *
 * @param {Object} args
 * @param {Object} args.suggestion - the verifier's suggestion row
 * @param {Object} args.body - request body ({ answers, setVersion? })
 * @returns {Promise<{ ok: true, receivedAt: string }>}
 * @throws {ServiceHttpError} explicit { ok:false, reason, ... } bodies
 */
export async function submitReview({ suggestion, body }) {
  const suggestionId = suggestion.wmkf_appreviewersuggestionid;
  const engagement = computeEngagementState(suggestion);

  // Finality first: a submitted review never accepts another submit. This is
  // the authoritative finality guard (the If-Match below can be defeated by a
  // client re-reading a fresh post-submit etag).
  if (suggestion.wmkf_reviewreceivedat) {
    throw reviewReceivedLockedError();
  }
  // Authoring-stage gate: submit only while the form is open (materials
  // released, not withdrawn). Mirrors the /draft PUT gate.
  if (engagement.view !== 'stage2b') {
    throw new ServiceHttpError('materials_not_sent', {
      httpStatus: 409,
      body: {
        ok: false,
        reason: 'materials_not_sent',
        message: 'The review form is not open for this engagement.',
      },
    });
  }

  // Load the CURRENT question set (Dataverse-authored, fail-closed). The whole
  // pipeline — sanitize, validate, build, snapshot-key allowlist — uses it.
  const questionSet = await getActiveQuestionSet();
  const richtextKeys = questionSet.filter((f) => f.type === 'richtext').map((f) => f.key);
  const snapshotKeys = new Set(
    questionSet.filter((f) => f.type === 'picklist' || f.type === 'richtext').map((f) => f.key),
  );

  // set_changed reload signal (Codex P1): if the client submitted against an
  // older question set than the live one, tell it to reload rather than
  // returning a confusing field-level validation error. The client echoes the
  // setVersion it rendered; an absent setVersion skips the check (older clients).
  const clientSetVersion = body && typeof body === 'object' ? body.setVersion : undefined;
  if (typeof clientSetVersion === 'string' && clientSetVersion !== questionSetVersion(questionSet)) {
    throw new ServiceHttpError('set_changed', {
      httpStatus: 409,
      body: {
        ok: false,
        reason: 'set_changed',
        message: 'The review questions changed since you opened this form. Please reload to see the current questions.',
      },
    });
  }

  // Sanitize → validate against the current set.
  const answers = (body && typeof body === 'object' && body.answers) || {};
  const sanitized = sanitizeRichText(answers, richtextKeys);
  const validation = validateReviewSubmission(sanitized, questionSet);
  if (!validation.ok) {
    throw new ServiceHttpError('validation', {
      httpStatus: 400,
      body: { ok: false, reason: 'validation', errors: validation.errors },
    });
  }

  // Single producer of parent PATCH + answer rows.
  const receivedAt = new Date().toISOString();
  const { parentPatch, answerRows } = buildReviewSubmission(validation.normalized, { receivedAt, questionSet });

  // Atomic write: N answer upserts (by alternate key) + the parent PATCH
  // (If-Match-guarded) in one changeset.
  try {
    await withDalContext('external-review-submit', async () => {
      // The parent PATCH MUST carry a row-version If-Match — it is the only
      // guard against a true pre-commit race (two submits that both passed the
      // finality precheck). Fail closed if we can't get one (Codex S302 P1).
      let parentEtag = suggestion._etag;
      if (!parentEtag) {
        // Re-read for a fresh etag — AND re-check finality in the SAME read.
        // The verify-time receivedat is stale here; without re-checking it, a
        // racing submit that committed between our verify and this re-read
        // would hand us a fresh (non-stale) etag whose If-Match then PASSES,
        // letting us overwrite the already-submitted review (Codex S302 P1b).
        const fresh = await getForSubmitFinalityCheck(suggestionId);
        if (fresh?.wmkf_reviewreceivedat) {
          const err = new Error('Review was submitted concurrently');
          err.code = 'ALREADY_SUBMITTED';
          throw err;
        }
        parentEtag = fresh?._etag || null;
      }
      if (!parentEtag) {
        const err = new Error('Could not obtain a row-version etag for the parent If-Match guard');
        err.code = 'NO_ETAG';
        throw err;
      }

      const children = answerRows.map((row) => answerUpsertDescriptor(suggestionId, row, snapshotKeys));
      const parent = {
        method: 'PATCH',
        entitySet: PARENT_ENTITY_SET,
        key: suggestionId,
        body: parentPatch,
        ifMatch: parentEtag,
      };
      await runChangeset(atomicParentWithChildren({ parent, children }));
    });
  } catch (e) {
    // ALREADY_SUBMITTED = a racing submit committed before ours (caught by the
    // fallback finality re-read). Surface the same locked reason as the
    // up-front precheck so the client shows the final, no-retry message.
    if (e.code === 'ALREADY_SUBMITTED') {
      throw reviewReceivedLockedError();
    }
    // 412 = concurrent change since page load (a staff edit, or a racing
    // submit). NO_ETAG = we refused to write without a lock. Both mean nothing
    // was written (the changeset is atomic) — surface a 409 so the client
    // reloads rather than retrying blindly.
    if (e.status === 412 || e.code === 'NO_ETAG') {
      throw new ServiceHttpError('conflict', {
        httpStatus: 409,
        body: {
          ok: false,
          reason: 'conflict',
          message: 'This review changed since you opened it. Please reload and try again.',
        },
      });
    }
    console.error('[external review submit] changeset failed:', e.message);
    throw new ServiceHttpError('server_error', {
      httpStatus: 500,
      body: { ok: false, reason: 'server_error' },
    });
  }

  // Commit succeeded → delete the draft. Best-effort: a lingering draft is
  // harmless (GET returns null once submitted; GC sweeps it) and must never
  // turn a successful submit into a user-visible error.
  try {
    await ReviewDraftService.deleteBySuggestion(suggestionId);
  } catch (e) {
    console.error('[external review submit] post-commit draft delete failed (non-fatal):', e.message);
  }

  return { ok: true, receivedAt };
}
