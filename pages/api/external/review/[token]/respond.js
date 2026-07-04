/**
 * POST /api/external/review/[token]/respond
 *
 * Unified accept/decline endpoint for Stage 2a. Discriminated by `action`
 * in the request body — single endpoint because the server-side guards (token
 * verify, state machine, idempotency, optimistic locking, audit) are shared.
 * Email triggers (decline-ack, referral handoff) are deferred to a follow-up build.
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
 *   400  malformed body / missing acks / invalid picklist value / invalid action
 *   401  token verification failed (use the verifier's reason codes)
 *   404  token not found
 *   409  state-machine guard violation: materials_sent_locked, review_received_locked,
 *        withdrawn_sufficient
 *   412  optimistic-lock conflict (suggestion row changed underneath)
 *   500  active-child sanity violation (staff misconfiguration) or unexpected
 *
 * Reversibility: decline → accept is permitted while the engagement is in
 * pre-materials state (`wmkf_reviewstatus < materials_sent` and no review
 * received). Once accepted, exit is PD-only; a reviewer cannot self-decline
 * through this portal.
 */

import { randomUUID } from 'crypto';
import { verifySuggestionToken } from '../../../../../lib/external/verify-suggestion-token';
import { applyStage2aResponse } from '../../../../../lib/dataverse/adapters/reviewer-suggestion';
import { getActivePolicies } from '../../../../../lib/external/policy-fetcher';
import { missingRequiredAddressFields, validateAddress } from '../../../../../lib/external/required-address';
import { bypassDynamicsRestrictions } from '../../../../../lib/services/dynamics-context';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { captureSelfReportedReviewerOrcid } from '../../../../../lib/services/capture-self-reported-orcid';
import {
  enqueueReviewerAcceptanceJob,
  markReviewerAcceptanceJobQueued,
  cancelReviewerAcceptanceJob,
} from '../../../../../lib/services/reviewer-acceptance-job-service';
import {
  renderAcceptanceConfirmationEmail,
} from '../../../../../lib/services/reviewer-acceptance-email';

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

// Mailing-address VALIDITY (`validateAddress`, shape/length/country-ISO2 → 400) and
// PRESENCE (`missingRequiredAddressFields`, full payment-contact set → 422) both now
// live in lib/external/required-address.js so the fresh-accept guard (below) and the
// capture-only backfill enforce the SAME two-part contract — the backfill mints from
// reconstructed historical contacts and must reject the same addresses this route
// does. `validateAddress` stays lenient on emptiness (an absent field passes it and
// is owned by the presence check). Re-exported so existing importers/tests keep
// resolving them from this route.
export { missingRequiredAddressFields, validateAddress };
const REVIEW_STATUS_MATERIALS_SENT = 100000001;
const RESPONSE_TYPE_WITHDRAWN_SUFFICIENT = 100000003;

export { renderAcceptanceConfirmationEmail };

// The reviewer's self-reported ORCID for this response: the value they typed
// this time (delta) OR the one already persisted on the engagement row (which
// was their prefill — the client sends only CHANGED fields, so a confirm-without-
// edit sends nothing) (Codex S217 #3).
function selfReportedOrcidOf(body, suggestion) {
  return body?.contactEdits?.orcid || suggestion?.wmkf_reviewerorcid || null;
}

function suggestionWithAppliedContactEdits(suggestion, body) {
  const next = {
    wmkf_reviewerfirstname: suggestion?.wmkf_reviewerfirstname ?? null,
    wmkf_reviewerlastname: suggestion?.wmkf_reviewerlastname ?? null,
    wmkf_reviewernickname: suggestion?.wmkf_reviewernickname ?? null,
    wmkf_reviewertitle: suggestion?.wmkf_reviewertitle ?? null,
    wmkf_revieweraffiliation: suggestion?.wmkf_revieweraffiliation ?? null,
    wmkf_revieweremail: suggestion?.wmkf_revieweremail ?? null,
  };
  const edits = body?.contactEdits || {};
  const editMap = {
    firstName: 'wmkf_reviewerfirstname',
    lastName: 'wmkf_reviewerlastname',
    nickname: 'wmkf_reviewernickname',
    title: 'wmkf_reviewertitle',
    affiliation: 'wmkf_revieweraffiliation',
    email: 'wmkf_revieweremail',
  };
  for (const [key, column] of Object.entries(editMap)) {
    if (!Object.prototype.hasOwnProperty.call(edits, key)) continue;
    const value = edits[key];
    next[column] = (value === null || value === '') ? null : value;
  }
  return next;
}

// Capture the reviewer's self-confirmed ORCID onto the person + contact (the
// reviewer-side twin of PR3 — highest-trust source, persisted as a sticky
// 'confirmed'). NON-FATAL: the accept/decline already committed. contactId is
// the just-created honorarium contact when present, else the pointer promoted at
// invite time; absent → person-only capture.
async function captureReviewerSelfReportedOrcid({ reviewer, contactId, rawOrcid }) {
  if (!rawOrcid) return;
  try {
    await bypassDynamicsRestrictions('external-orcid-selfreport', () =>
      captureSelfReportedReviewerOrcid({
        potentialReviewerId: reviewer?.wmkf_potentialreviewersid || null,
        rawOrcid,
        contactId: contactId || reviewer?._wmkf_contact_value || null,
      }),
    );
  } catch (orcidErr) {
    console.warn('[external respond] self-reported ORCID capture failed (non-fatal):', orcidErr?.message || orcidErr);
  }
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
        ok: false, reason: verified.reason,
      });
    }
    const { suggestion, request, reviewer } = verified;

    const body = req.body || {};
    if (body.action !== 'accept' && body.action !== 'decline') {
      return res.status(400).json({ ok: false, reason: 'invalid_action' });
    }

    // Validate reviewer-supplied contact corrections before any write.
    const contactErr = validateContactEdits(body.contactEdits);
    if (contactErr) {
      return res.status(400).json({ ok: false, ...contactErr });
    }
    // Validate the optional mailing address (used by honorarium onboarding).
    const addrErr = validateAddress(body.address);
    if (addrErr) {
      return res.status(400).json({ ok: false, ...addrErr });
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
    // A received review is terminal for response transitions (accept/decline).
    // Normal flow already 409s above via materials_sent (receipt follows release), but
    // side-channel writers (review-upload.js, mark-received-no-file.js) can stamp
    // wmkf_reviewreceivedat WITHOUT wmkf_reviewstatus — this closes that gap for all
    // three actions. Re-upload is a different endpoint and is unaffected.
    if (suggestion.wmkf_reviewreceivedat) {
      return res.status(409).json({
        ok: false,
        reason: 'review_received_locked',
        message: 'A review has already been received for this engagement. To change your response, please contact your Program Director.',
      });
    }

    // ── Decline ────────────────────────────────────────────────────────────
    if (body.action === 'decline') {
      if (accepted) {
        return res.status(409).json({
          ok: false,
          reason: 'accepted_decline_locked',
          message: 'You are already confirmed as a reviewer. To withdraw, please contact your Program Director.',
        });
      }
      // Idempotent repeat: already declined and not flipping → no re-stamp.
      if (declined) {
        return res.status(200).json({
          ok: true,
          idempotent: true,
          engagementState: { view: 'declined', accepted: false, declined: true },
        });
      }
      try {
        await bypassDynamicsRestrictions('external-respond', () =>
          applyStage2aResponse(suggestion.wmkf_appreviewersuggestionid, {
            action: 'decline',
            contactEdits: body.contactEdits,
            honorariumOptOut: body.honorariumOptOut === true,
            decline: body.decline,
          }, { ifMatch: req.headers['if-match'] || undefined }),
        );
      } catch (e) {
        const msg = e.message || '';
        if (e.status === 412 || /\b412\b/.test(msg)) {
          return res.status(412).json({ ok: false, reason: 'concurrent_modification' });
        }
        if (/unknown declineReason value/.test(msg)) {
          return res.status(400).json({ ok: false, reason: 'invalid_decline_reason' });
        }
        throw e;
      }
      // A declining reviewer still gives us their ORCID for free — capture it
      // (person + contact-if-promoted). No honorarium on decline → no new contact.
      await captureReviewerSelfReportedOrcid({ reviewer, contactId: null, rawOrcid: selfReportedOrcidOf(body, suggestion) });
      return res.status(200).json({
        ok: true,
        idempotent: false,
        engagementState: { view: 'declined', accepted: false, declined: true },
      });
    }

    // ── Accept ─────────────────────────────────────────────────────────────
    // Fresh accept writes Dataverse after the durable follow-up job is staged.
    // Repeat accept skips the suggestion PATCH but still queues the same follow-up
    // work, because an earlier tail may have failed before honorarium/contact sync.
    const isAcceptRepeat = accepted && !declined;
    let acceptedSuggestion = suggestion;
    const optedOut = body.honorariumOptOut === true || suggestion.wmkf_honorariumoptout === true;
    const acceptedAt = isAcceptRepeat
      ? (suggestion.wmkf_responsereceivedat || new Date().toISOString())
      : new Date().toISOString();
    const acceptOrcidRaw = selfReportedOrcidOf(body, suggestion);
    let acks = null;

    if (!isAcceptRepeat) {
      const policyAcks = body.policyAcks || {};
      for (const slot of STAGE_2A_POLICY_SLOTS) {
        if (policyAcks[slot] !== true) {
          return res.status(400).json({ ok: false, reason: 'policy_ack_required', slot });
        }
      }
      const boardIdentity = body.boardIdentity || {};
      const missingIdentity = ['academicRank', 'primaryDepartment', 'mainInstitution']
        .filter((k) => !(typeof boardIdentity[k] === 'string' && boardIdentity[k].trim()));
      if (missingIdentity.length) {
        return res.status(400).json({ ok: false, reason: 'board_identity_required', fields: missingIdentity });
      }
      if (!optedOut) {
        const missingAddress = missingRequiredAddressFields(body.address);
        if (missingAddress.length) {
          return res
            .status(422)
            .json({ ok: false, reason: 'payment_contact_required', fields: missingAddress });
        }
      }
      let policies;
      try {
        policies = await getActivePolicies(STAGE_2A_POLICY_SLOTS);
      } catch (e) {
        console.error('[external respond] policy sanity failed:', e.message);
        return res.status(500).json({ ok: false, reason: 'policy_misconfigured', message: e.message });
      }
      acks = {
        coiVersionId: policies['reviewer-coi'].activeVersionId || policies['reviewer-coi'].versionId,
        aiUseVersionId: policies['reviewer-ai-use'].activeVersionId || policies['reviewer-ai-use'].versionId,
        ackedAt: acceptedAt,
      };
      acceptedSuggestion = suggestionWithAppliedContactEdits(suggestion, body);
    }

    const acceptanceJob = await enqueueReviewerAcceptanceJob({
      acceptanceKey: randomUUID(),
      acceptedAt,
      suggestion,
      request,
      reviewer,
      body,
      acks,
      isAcceptRepeat,
      optedOut,
      acceptedSuggestion,
      acceptOrcidRaw,
      status: isAcceptRepeat ? 'queued' : 'accept_pending',
    });

    if (!isAcceptRepeat) {
      try {
        await bypassDynamicsRestrictions('external-respond', () =>
          applyStage2aResponse(suggestion.wmkf_appreviewersuggestionid, {
            action: 'accept',
            contactEdits: body.contactEdits,
            honorariumOptOut: body.honorariumOptOut === true,
            acks,
            responseReceivedAt: acceptedAt,
          }, {
            // Optimistic lock: caller must round-trip the _etag from /context.
            ifMatch: req.headers['if-match'] || undefined,
          }),
        );
      } catch (e) {
        const msg = e.message || '';
        if (e.status === 412 || /\b412\b/.test(msg)) {
          await cancelReviewerAcceptanceJob(acceptanceJob.id, e?.message || 'accept_patch_conflict').catch((cancelErr) => {
            console.warn('[external respond] failed to cancel staged acceptance job:', cancelErr?.message || cancelErr);
          });
          return res.status(412).json({ ok: false, reason: 'concurrent_modification' });
        }
        throw e;
      }
    }

    await markReviewerAcceptanceJobQueued(acceptanceJob.id).catch((queueErr) => {
      // The row is already durable. The drain also claims accept_pending jobs once
      // Dataverse shows accepted, so a queue-marker blip must not make the reviewer
      // wait on the slow tail again.
      console.warn('[external respond] acceptance job queued marker failed (non-fatal):', queueErr?.message || queueErr);
    });

    return res.status(200).json({
      ok: true,
      idempotent: isAcceptRepeat,
      acceptanceJobId: acceptanceJob.id,
      engagementState: { view: 'accepted-pre-materials', accepted: true, declined: false },
    });
  } catch (e) {
    console.error('[external respond] unexpected error:', e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
