/**
 * POST /api/external/review/[token]/submit
 *
 * Final submission for the in-browser reviewer authoring surface
 * (docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md §5/§9). Submit is FINAL —
 * the form locks read-only afterward; there is no edit/re-submit (diverges from
 * the legacy "replace your submission" upload grace, removed with the upload UI).
 *
 * Pipeline:
 *   1. token verify + rate-limit + recordTokenOutcome (same boundary as /draft).
 *   2. engagement gate — must be in the authoring stage (stage2b).
 *   3. FINALITY precheck — 409 if wmkf_reviewreceivedat is already set. (Belt and
 *      suspenders with the in-changeset If-Match: a client can fetch a fresh
 *      post-submit etag and replay, so the precheck is the authoritative finality
 *      guard; §9 #C-conc / Codex P0-2.)
 *   4. server-sanitize every rich-text answer (the write is the security boundary,
 *      not render), then validateReviewSubmission against the CURRENT schema.
 *   5. buildReviewSubmission → { parentPatch, answerRows } (the single producer).
 *   6. ATOMIC write via DynamicsService.executeChangeset: upsert the N answer rows
 *      by the (suggestion, questionkey) alternate key + PATCH the parent
 *      (affiliation, 3 ratings, receivedat) guarded by If-Match. All-or-nothing.
 *   7. ONLY after the changeset commits: delete the Postgres draft (best-effort —
 *      a stale draft is harmless, GET returns null post-submit and GC sweeps it).
 *
 * Responses:
 *   200  { ok: true, receivedAt }
 *   400  validation { ok:false, reason:'validation', errors }
 *   401  token verification failed
 *   404  token not found
 *   409  review_received_locked (already submitted) | materials_not_sent (not in
 *        the authoring stage) | conflict (concurrent change — If-Match 412)
 *   405  method not POST
 *   429  rate limited
 *   500  internal
 */

import { verifySuggestionToken } from '../../../../../lib/external/verify-suggestion-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { DynamicsService } from '../../../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../../../lib/services/dynamics-context';
import ReviewDraftService from '../../../../../lib/services/review-draft-service';
import { computeEngagementState } from '../../../../../lib/external/review-engagement-state';
import { reviewFormSchema } from '../../../../../lib/external/review-form-schema';
import { sanitizeReviewHtml } from '../../../../../lib/external/sanitize-review-html';
import { validateReviewSubmission, buildReviewSubmission } from '../../../../../lib/external/build-review-submission';

const PARENT_ENTITY_SET = 'wmkf_appreviewersuggestions';
// Alternate-key lookup component in the upsert URL. The lookup must be addressed
// by its VALUE attribute (`_wmkf_appreviewersuggestion_value`), NOT the bare
// logical name or the navigation property — both of those are rejected with
// 0x80060888. [VERIFIED in prod via scripts/probe-altkey-upsert-changeset.mjs,
// S302: this form CREATEs on first upsert and UPDATEs idempotently on retry.]
const ANSWER_KEY_LOOKUP_ATTR = '_wmkf_appreviewersuggestion_value';

const RICHTEXT_KEYS = reviewFormSchema.fields.filter((f) => f.type === 'richtext').map((f) => f.key);

// Rich-text answers can be sizeable; cap the JSON body (mirrors /draft).
export const config = {
  api: {
    bodyParser: { sizeLimit: '2mb' },
  },
};

/** Server-sanitize every rich-text answer before validation/build — the write is the boundary. */
function sanitizeRichText(answers) {
  const out = { ...answers };
  for (const key of RICHTEXT_KEYS) {
    if (typeof out[key] === 'string') out[key] = sanitizeReviewHtml(out[key]);
    else if (out[key] != null) out[key] = ''; // non-string → drop to empty
  }
  return out;
}

/** Single source for the alternate-key upsert URL of one answer row. */
function answerRowUrl(entitySet, suggestionId, questionKey) {
  return `${entitySet}(${ANSWER_KEY_LOOKUP_ATTR}=${suggestionId},wmkf_questionkey='${encodeURIComponent(questionKey)}')`;
}

/** Map one answerRow to the Dataverse column body for the upsert (key columns come from the URL). */
function answerRowBody(row) {
  return {
    wmkf_questionorder: row.questionOrder,
    wmkf_questiontext: row.questionText,
    wmkf_questiontype: row.questionType,
    wmkf_answerhtml: row.answerHtml,
    wmkf_answertext: row.answerText,
    wmkf_answervalue: row.answerValue,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    const token = req.query.token;
    const rl = await checkRateLimit(req, token);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ ok: false, reason: 'rate_limited' });
    }

    const verified = await verifySuggestionToken(token);
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({
        ok: false,
        reason: verified.reason,
      });
    }

    const { suggestion } = verified;
    const suggestionId = suggestion.wmkf_appreviewersuggestionid;
    const engagement = computeEngagementState(suggestion);

    // Finality first: a submitted review never accepts another submit. This is
    // the authoritative finality guard (the If-Match below can be defeated by a
    // client re-reading a fresh post-submit etag).
    if (suggestion.wmkf_reviewreceivedat) {
      return res.status(409).json({
        ok: false,
        reason: 'review_received_locked',
        message: 'This review has already been submitted. To make a change, please contact your Program Director.',
      });
    }
    // Authoring-stage gate: submit only while the form is open (materials
    // released, not withdrawn). Mirrors the /draft PUT gate.
    if (engagement.view !== 'stage2b') {
      return res.status(409).json({
        ok: false,
        reason: 'materials_not_sent',
        message: 'The review form is not open for this engagement.',
      });
    }

    // Sanitize → validate against the current schema.
    const answers = (req.body && typeof req.body === 'object' && req.body.answers) || {};
    const sanitized = sanitizeRichText(answers);
    const validation = validateReviewSubmission(sanitized);
    if (!validation.ok) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: validation.errors });
    }

    // Single producer of parent PATCH + answer rows.
    const receivedAt = new Date().toISOString();
    const { parentPatch, answerRows } = buildReviewSubmission(validation.normalized, { receivedAt });

    // Atomic write: N answer upserts (by alternate key) + the parent PATCH
    // (If-Match-guarded) in one changeset.
    try {
      await bypassDynamicsRestrictions('external-review-submit', async () => {
        const answerEntitySet = await DynamicsService.resolveEntitySetName('wmkf_appreviewanswer');
        const operations = answerRows.map((row) => ({
          method: 'PATCH',
          url: answerRowUrl(answerEntitySet, suggestionId, row.questionKey),
          body: answerRowBody(row),
        }));
        operations.push({
          method: 'PATCH',
          url: `${PARENT_ENTITY_SET}(${suggestionId})`,
          body: parentPatch,
          ...(suggestion._etag ? { ifMatch: suggestion._etag } : {}),
        });
        await DynamicsService.executeChangeset(operations);
      });
    } catch (e) {
      // 412 = concurrent change since page load (a staff edit, or a racing
      // submit). The changeset is atomic, so nothing was written — surface a
      // 409 so the client can reload rather than retry blindly.
      if (e.status === 412) {
        return res.status(409).json({
          ok: false,
          reason: 'conflict',
          message: 'This review changed since you opened it. Please reload and try again.',
        });
      }
      console.error('[external review submit] changeset failed:', e.message);
      return res.status(500).json({ ok: false, reason: 'server_error' });
    }

    // Commit succeeded → delete the draft. Best-effort: a lingering draft is
    // harmless (GET returns null once submitted; GC sweeps it) and must never
    // turn a successful submit into a user-visible error.
    try {
      await ReviewDraftService.deleteBySuggestion(suggestionId);
    } catch (e) {
      console.error('[external review submit] post-commit draft delete failed (non-fatal):', e.message);
    }

    return res.status(200).json({ ok: true, receivedAt });
  } catch (e) {
    console.error('[external review submit] error:', e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
