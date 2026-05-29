/**
 * POST /api/external/review/[token]/respond
 *
 * Unified accept/decline endpoint for Stage 2a. Discriminated by `action`
 * in the request body — single endpoint instead of two because the
 * server-side guards (token verify, state machine, idempotency, optimistic
 * locking, audit) are identical for both. Email triggers (decline-ack,
 * referral handoff) are deferred to a follow-up build.
 *
 * Request body:
 *   {
 *     action: 'accept' | 'decline',
 *     // For accept:
 *     contactEdits?: {
 *       firstName?, lastName?, nickname?, title?, affiliation?, email?, orcid?
 *     },
 *     honorariumOptOut?: boolean,
 *     policyAcks?: { 'reviewer-coi': true, 'reviewer-ai-use': true },
 *     // For decline (all optional):
 *     decline?: { reasonPicklist?, reasonText?, referral? },
 *   }
 *
 * Response:
 *   200 OK { ok: true, idempotent?: boolean, engagementState }
 *   400  malformed body / missing acks / invalid picklist value
 *   401  token verification failed (use the verifier's reason codes)
 *   404  token not found
 *   409  state-machine guard violation (e.g., flip after materials_sent)
 *   412  optimistic-lock conflict (suggestion row changed underneath)
 *   500  active-child sanity violation (staff misconfiguration) or unexpected
 *
 * Reversibility: a flip from accepted → declined or declined → accepted is
 * a permitted transition while the engagement is in pre-materials state
 * (`wmkf_reviewstatus < materials_sent`). On flip, response stamps refresh;
 * policy ack lookups remain on the row but aren't load-bearing while
 * `wmkf_responsetype = declined`.
 */

import { verifySuggestionToken } from '../../../../../lib/external/verify-suggestion-token';
import { applyStage2aResponse } from '../../../../../lib/dataverse/adapters/reviewer-suggestion';
import { getActivePolicies } from '../../../../../lib/external/policy-fetcher';
import { bypassDynamicsRestrictions } from '../../../../../lib/services/dynamics-context';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';

const STAGE_2A_POLICY_SLOTS = ['reviewer-coi', 'reviewer-ai-use'];

// Per-field caps for reviewer-supplied contact corrections. Dataverse enforces
// its own column limits (an oversized value would surface as a 500 from the
// PATCH), so this is defense-in-depth that returns a clean 400 instead. The
// affiliation cap matches review-form-schema.js (`maxLength: 300`).
const CONTACT_EDIT_MAX = {
  firstName: 100, lastName: 100, nickname: 100, title: 200,
  affiliation: 300, email: 320, orcid: 64,
};

/**
 * Validate reviewer-supplied contactEdits. Returns null if valid, or a
 * { reason, field } describing the first violation (caller sends 400).
 * Only fields actually present are checked; null/'' are allowed (they clear).
 */
function validateContactEdits(edits) {
  if (edits === undefined || edits === null) return null;
  if (typeof edits !== 'object' || Array.isArray(edits)) {
    return { reason: 'invalid_contact_edits' };
  }
  for (const [k, v] of Object.entries(edits)) {
    if (!(k in CONTACT_EDIT_MAX)) return { reason: 'unknown_contact_field', field: k };
    if (v === null || v === undefined || v === '') continue; // clears the field
    if (typeof v !== 'string') return { reason: 'invalid_contact_field', field: k };
    if (v.length > CONTACT_EDIT_MAX[k]) return { reason: 'contact_field_too_long', field: k };
    // Minimal email shape check: a single @ with non-empty local + domain.
    if (k === 'email' && !/^[^@\s]+@[^@\s]+$/.test(v)) {
      return { reason: 'invalid_email', field: k };
    }
  }
  return null;
}
const REVIEW_STATUS_MATERIALS_SENT = 100000001;
const RESPONSE_TYPE_ACCEPTED = 100000000;
const RESPONSE_TYPE_DECLINED = 100000001;
const RESPONSE_TYPE_WITHDRAWN_SUFFICIENT = 100000003;

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
        ok: false, reason: verified.reason,
      });
    }
    const { suggestion } = verified;

    const body = req.body || {};
    if (body.action !== 'accept' && body.action !== 'decline') {
      return res.status(400).json({ ok: false, reason: 'invalid_action' });
    }

    // Validate reviewer-supplied contact corrections before any write.
    const contactErr = validateContactEdits(body.contactEdits);
    if (contactErr) {
      return res.status(400).json({ ok: false, ...contactErr });
    }

    // ── State machine guard ────────────────────────────────────────────────
    const reviewStatus = suggestion.wmkf_reviewstatus ?? null;
    const responseType = suggestion.wmkf_responsetype ?? null;
    const accepted = suggestion.wmkf_accepted === true;
    const declined = suggestion.wmkf_declined === true;

    if (responseType === RESPONSE_TYPE_WITHDRAWN_SUFFICIENT) {
      return res.status(409).json({ ok: false, reason: 'withdrawn_sufficient' });
    }
    if (reviewStatus !== null && reviewStatus >= REVIEW_STATUS_MATERIALS_SENT) {
      return res.status(409).json({
        ok: false,
        reason: 'materials_sent_locked',
        message: 'Materials have already been released for this review. To change your response, please contact your Program Director.',
      });
    }

    // ── Idempotency: repeat of current action ──────────────────────────────
    // If reviewer is already in the requested state and not flipping, return
    // success without re-stamping. Two-device clicks and double-submits land
    // on the same outcome.
    if (body.action === 'accept' && accepted && !declined) {
      return res.status(200).json({
        ok: true,
        idempotent: true,
        engagementState: { view: 'accepted-pre-materials', accepted: true, declined: false },
      });
    }
    if (body.action === 'decline' && declined && !accepted) {
      return res.status(200).json({
        ok: true,
        idempotent: true,
        engagementState: { view: 'declined', accepted: false, declined: true },
      });
    }

    // ── Accept-specific validation ─────────────────────────────────────────
    let acks = null;
    if (body.action === 'accept') {
      const policyAcks = body.policyAcks || {};
      for (const slot of STAGE_2A_POLICY_SLOTS) {
        if (policyAcks[slot] !== true) {
          return res.status(400).json({
            ok: false,
            reason: 'policy_ack_required',
            slot,
          });
        }
      }
      // Active-child sanity: re-fetch active versions at accept time.
      // Misconfiguration here is staff error, not user error → 500 with
      // explicit reason so the page can show "this is on us" + log alert.
      let policies;
      try {
        policies = await getActivePolicies(STAGE_2A_POLICY_SLOTS);
      } catch (e) {
        console.error('[external respond] policy sanity failed:', e.message);
        return res.status(500).json({
          ok: false,
          reason: 'policy_misconfigured',
          message: e.message,
        });
      }
      acks = {
        coiVersionId: policies['reviewer-coi'].activeVersionId,
        aiUseVersionId: policies['reviewer-ai-use'].activeVersionId,
        ackedAt: new Date().toISOString(),
      };
    }

    // ── Apply via adapter (single transaction-shaped PATCH) ────────────────
    try {
      await bypassDynamicsRestrictions('external-respond', () =>
        applyStage2aResponse(suggestion.wmkf_appreviewersuggestionid, {
          action: body.action,
          contactEdits: body.contactEdits,
          honorariumOptOut: body.honorariumOptOut === true,
          acks,
          decline: body.decline,
        }, {
          // Optimistic lock — caller must round-trip the _etag from /context.
          ifMatch: req.headers['if-match'] || undefined,
        }),
      );
    } catch (e) {
      // Surface 412 (optimistic-lock conflict) cleanly. DynamicsService throws
      // a generic Error with status code in the message; check both.
      const msg = e.message || '';
      if (e.status === 412 || /\b412\b/.test(msg)) {
        return res.status(412).json({ ok: false, reason: 'concurrent_modification' });
      }
      // Picklist-mapping errors from the adapter (unknown decline-reason value)
      if (/unknown declineReason value/.test(msg)) {
        return res.status(400).json({ ok: false, reason: 'invalid_decline_reason' });
      }
      throw e;
    }

    return res.status(200).json({
      ok: true,
      idempotent: false,
      engagementState: {
        view: body.action === 'accept' ? 'accepted-pre-materials' : 'declined',
        accepted: body.action === 'accept',
        declined: body.action === 'decline',
      },
    });
  } catch (e) {
    console.error('[external respond] unexpected error:', e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
