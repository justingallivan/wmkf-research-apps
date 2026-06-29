/**
 * GET/PUT /api/external/review/[token]/draft
 *
 * Postgres-backed autosave for the in-browser reviewer authoring surface
 * (docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md §5). The draft is a
 * scratchpad; the system of record for a SUBMITTED review is the Dataverse
 * wmkf_appreviewanswer snapshot (+ parent ratings), written by /submit (Phase 3).
 *
 *   GET  → returns the saved draft_json so the editor rehydrates on return
 *          visits. Returns an empty draft once the review is submitted (no
 *          draft after finality).
 *   PUT  → debounced autosave. Sanitizes every rich-text answer server-side
 *          (§4) BEFORE persisting — the autosave path is the security boundary,
 *          not just render. Gated on the authoring stage; refuses with 409 once
 *          the review is submitted (wmkf_reviewreceivedat set).
 *
 * Auth: public magic-link token — verifySuggestionToken + checkRateLimit +
 * recordTokenOutcome, identical to /respond and /upload. The engagement gate
 * reuses computeEngagementState (the single source of truth in
 * lib/external/review-engagement-state.js) so draft writes can't drift from the
 * rendered view.
 *
 * Responses:
 *   200 GET  { ok: true, draftJson, submitted }
 *   200 PUT  { ok: true, draftId, updatedAt }
 *   400 PUT  draftJson missing / not an object
 *   401      token verification failed (verifier reason codes)
 *   404      token not found
 *   409 PUT  review_received_locked (submitted) | materials_not_sent (not yet
 *            in the authoring stage)
 *   405      method not GET/PUT
 *   429      rate limited
 *   500      internal (pg failure)
 */

import { verifySuggestionToken } from '../../../../../lib/external/verify-suggestion-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import ReviewDraftService from '../../../../../lib/services/review-draft-service';
import { reviewFormSchema } from '../../../../../lib/external/review-form-schema';
import { sanitizeReviewHtml } from '../../../../../lib/external/sanitize-review-html';
import { computeEngagementState } from '../../../../../lib/external/review-engagement-state';

// Rich-text answers can be sizeable; cap the JSON body so a single autosave
// can't buffer an arbitrary payload. Comfortably above the worst-case set of
// answers, well below abuse territory.
export const config = {
  api: {
    bodyParser: { sizeLimit: '2mb' },
  },
};

// Schema fields indexed by stable key, for the whitelist + per-type handling.
const FIELD_BY_KEY = new Map(reviewFormSchema.fields.map((f) => [f.key, f]));

/**
 * Reduce a client-supplied draft body to a sanitized, whitelisted object:
 *   - only keys defined in review-form-schema survive (no arbitrary blobs);
 *   - richtext answers are server-sanitized (the stored-XSS boundary) and
 *     length-checked against the field's maxLength (the server is the boundary —
 *     the editor cap is convenience). Oversize answers are reported so the PUT
 *     can 400 rather than store a draft Phase-3 submit would later reject.
 *   - picklist/string answers pass through (full validation happens at submit).
 * Drafts are partial by design, so missing/empty values are allowed here.
 *
 * @returns {{ draftJson: object, oversized: Array<{ key, length, maxLength }> }}
 */
function buildSanitizedDraftJson(input) {
  const out = {};
  const oversized = [];
  for (const [key, value] of Object.entries(input)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) continue; // drop unknown keys
    if (field.type === 'richtext') {
      const html = typeof value === 'string' ? sanitizeReviewHtml(value) : '';
      if (field.maxLength && html.length > field.maxLength) {
        oversized.push({ key, length: html.length, maxLength: field.maxLength });
      }
      out[key] = html;
    } else {
      out[key] = value;
    }
  }
  return { draftJson: out, oversized };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
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
    const submitted = engagement.view === 'submitted';

    if (req.method === 'GET') {
      // No draft surfaced once the review is final — the submitted view is
      // reconstructed from the Dataverse snapshot, not this scratchpad.
      if (submitted) {
        return res.status(200).json({ ok: true, draftJson: null, submitted: true });
      }
      const row = await ReviewDraftService.getBySuggestion(suggestionId);
      return res.status(200).json({
        ok: true,
        draftJson: row?.draft_json ?? null,
        submitted: false,
      });
    }

    // ── PUT (autosave) ──────────────────────────────────────────────────────
    const { draftJson } = req.body || {};
    if (draftJson == null || typeof draftJson !== 'object' || Array.isArray(draftJson)) {
      return res.status(400).json({ ok: false, reason: 'draftJson must be an object' });
    }

    // Finality first: a submitted review never accepts another draft write.
    if (submitted) {
      return res.status(409).json({
        ok: false,
        reason: 'review_received_locked',
        message: 'This review has already been submitted. To make a change, please contact your Program Director.',
      });
    }
    // Authoring stage gate: drafts only exist while the review form is active
    // (materials released, not yet submitted/withdrawn).
    if (engagement.view !== 'stage2b') {
      return res.status(409).json({
        ok: false,
        reason: 'materials_not_sent',
        message: 'The review form is not open yet for this engagement.',
      });
    }

    const { draftJson: sanitized, oversized } = buildSanitizedDraftJson(draftJson);
    if (oversized.length > 0) {
      return res.status(400).json({
        ok: false,
        reason: 'answer_too_long',
        fields: oversized,
        message: 'One or more answers exceed the maximum length.',
      });
    }
    const row = await ReviewDraftService.upsertDraftJson({ suggestionId, draftJson: sanitized });

    return res.status(200).json({ ok: true, draftId: row.id, updatedAt: row.updated_at });
  } catch (e) {
    console.error('[external review draft] error:', e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
