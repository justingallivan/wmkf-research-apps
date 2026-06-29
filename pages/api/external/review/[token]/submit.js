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
// Allowlist of valid snapshot question keys — answer rows only ever carry these
// (buildReviewSubmission iterates the schema), but the URL builder asserts it as
// defense in depth before interpolating the key into an OData predicate.
const SNAPSHOT_QUESTION_KEYS = new Set(
  reviewFormSchema.fields.filter((f) => typeof f.order === 'number').map((f) => f.key),
);

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

/**
 * Single source for the alternate-key upsert URL of one answer row. The question
 * key goes into an OData single-quoted key predicate, so it is escaped by
 * doubling apostrophes (the OData rule — NOT percent-encoding, which Dataverse
 * does not decode inside a quoted literal). Keys are also asserted against the
 * schema allowlist so an unexpected value can't address the wrong row.
 */
function answerRowUrl(entitySet, suggestionId, questionKey) {
  if (!SNAPSHOT_QUESTION_KEYS.has(questionKey)) {
    throw new Error(`answerRowUrl: "${questionKey}" is not a known snapshot question key`);
  }
  const literal = String(questionKey).replace(/'/g, "''");
  return `${entitySet}(${ANSWER_KEY_LOOKUP_ATTR}=${suggestionId},wmkf_questionkey='${literal}')`;
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
          const fresh = await DynamicsService.getRecord(PARENT_ENTITY_SET, suggestionId, {
            select: 'wmkf_appreviewersuggestionid,wmkf_reviewreceivedat',
          });
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
          ifMatch: parentEtag,
        });
        await DynamicsService.executeChangeset(operations);
      });
    } catch (e) {
      // ALREADY_SUBMITTED = a racing submit committed before ours (caught by the
      // fallback finality re-read). Surface the same locked reason as the
      // up-front precheck so the client shows the final, no-retry message.
      if (e.code === 'ALREADY_SUBMITTED') {
        return res.status(409).json({
          ok: false,
          reason: 'review_received_locked',
          message: 'This review has already been submitted. To make a change, please contact your Program Director.',
        });
      }
      // 412 = concurrent change since page load (a staff edit, or a racing
      // submit). NO_ETAG = we refused to write without a lock. Both mean nothing
      // was written (the changeset is atomic) — surface a 409 so the client
      // reloads rather than retrying blindly.
      if (e.status === 412 || e.code === 'NO_ETAG') {
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
