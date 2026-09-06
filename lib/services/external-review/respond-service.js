/**
 * External Reviewer Portal — Stage 2a accept/decline service
 * (Route→Service Consolidation Plan, Stage 5, fail-closed batch).
 *
 * Holds the post-verification business logic for
 * POST /api/external/review/[token]/respond; the route is a thin shell that
 * keeps the ENTIRE token boundary byte-untouched and calls this with the
 * verifier's { suggestion, request, reviewer }, the request body, and the
 * client's If-Match header value.
 *
 * DRAIN CONTRACT (do not change): the reviewer_acceptance_jobs drain consumes
 * the staged job — status values ('accept_pending' → 'queued'), field names,
 * and write ORDERING (stage durable job BEFORE the Dataverse PATCH; mark
 * queued after; cancel on 412) are pinned by the route characterization suite
 * and move here verbatim.
 *
 * Contract (plan Decision 3):
 *   - plain argument object, never req/res;
 *   - returns the exact 200 bodies ({ ok:true, idempotent, engagementState,
 *     acceptanceJobId? });
 *   - throws ServiceHttpError with explicit { ok:false, reason, ... } bodies
 *     for every historical non-2xx envelope (this route is the plan's
 *     canonical non-{error} example) — 400/409/412/422/500;
 *   - DAL contexts: the historical route used THREE narrow legacy-bypass
 *     scopes ('external-respond' around each Stage-2a PATCH,
 *     'external-orcid-selfreport' around the ORCID capture). Converted
 *     bypass→withDalContext per Decision 4 with labels kept and scope
 *     IDENTICAL (per-write), preserved inside this service — the declared
 *     Stage 5 deviation pattern (widening one context over the job-staging
 *     Postgres work would change the historical trust boundaries).
 */

import { randomUUID } from 'crypto';
import {
  applyStage2aResponse,
  deselectLegacyDeclinedSuggestion,
} from '../../dataverse/adapters/reviewer-suggestion';
import { getActivePolicies } from '../../external/policy-fetcher';
import { missingRequiredAddressFields, validateAddress } from '../../external/required-address';
import { withDalContext } from '../../dataverse/core/context';
import { captureSelfReportedReviewerOrcid } from '../capture-self-reported-orcid';
import {
  enqueueReviewerAcceptanceJob,
  markReviewerAcceptanceJobQueued,
  cancelReviewerAcceptanceJob,
  cancelReviewerAcceptanceJobsForSuggestion,
} from '../reviewer-acceptance-job-service';
import {
  deleteLateHonorariumForWithdrawnReviewer,
  notifyProgramDirectorOfReviewerWithdrawal,
} from '../reviewer-withdrawal';
import { ServiceHttpError } from '../service-http-error';
import { normalizeDeclineReferrals } from '../../../shared/utils/decline-referrals';

const STAGE_2A_POLICY_SLOTS = ['reviewer-coi', 'reviewer-ai-use'];

// Per-field caps for reviewer-supplied contact corrections. Dataverse enforces
// its own column limits (an oversized value would surface as a 500 from the
// PATCH), so this is defense-in-depth that returns a clean 400 instead. The
// affiliation cap matches review-form-schema.js (`maxLength: 300`).
const CONTACT_EDIT_MAX = {
  firstName: 100, lastName: 100, nickname: 100, title: 200,
  affiliation: 300, email: 320, orcid: 64,
};

const REVIEW_STATUS_MATERIALS_SENT = 100000001;
const RESPONSE_TYPE_WITHDRAWN_SUFFICIENT = 100000003;

function envelopeError(httpStatus, body) {
  return new ServiceHttpError(body.reason || 'external_respond_error', { httpStatus, body });
}

/**
 * Validate reviewer-supplied contactEdits. Returns null if valid, or a
 * { reason, field } describing the first violation (mapped to 400).
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
// the acceptance-validated contact when present, else an existing reviewer
// pointer supplied by a bounded maintenance caller; absent → person-only
// capture. Invitation send does not promote.
async function captureReviewerSelfReportedOrcid({ reviewer, contactId, rawOrcid }) {
  if (!rawOrcid) return;
  try {
    await withDalContext('external-orcid-selfreport', () =>
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

/**
 * Apply a verified reviewer's accept/decline response.
 *
 * @param {Object} args
 * @param {Object} args.suggestion - verifier row
 * @param {Object} args.request - verifier row
 * @param {Object} args.reviewer - verifier row
 * @param {Object} args.body - request body ({ action, contactEdits?, ... })
 * @param {string|undefined} args.ifMatch - the client's If-Match header value
 * @returns {Promise<Object>} the historical 200 body
 * @throws {ServiceHttpError} explicit { ok:false, reason, ... } bodies
 */
export async function applyReviewerResponse({
  suggestion,
  request,
  reviewer,
  body,
  ifMatch,
  reviewerPortalToken,
}) {
  if (body.action !== 'accept' && body.action !== 'decline') {
    throw envelopeError(400, { ok: false, reason: 'invalid_action' });
  }

  // Validate reviewer-supplied contact corrections before any write.
  const contactErr = validateContactEdits(body.contactEdits);
  if (contactErr) {
    throw envelopeError(400, { ok: false, ...contactErr });
  }
  // Validate the optional mailing address (used by honorarium onboarding).
  const addrErr = validateAddress(body.address);
  if (addrErr) {
    throw envelopeError(400, { ok: false, ...addrErr });
  }

  let normalizedDecline = body.decline;
  if (body.action === 'decline') {
    if (normalizedDecline !== undefined
      && (normalizedDecline === null
        || typeof normalizedDecline !== 'object'
        || Array.isArray(normalizedDecline))) {
      throw envelopeError(400, { ok: false, reason: 'invalid_decline' });
    }
    normalizedDecline = normalizedDecline || {};
    if (Object.prototype.hasOwnProperty.call(normalizedDecline, 'referrals')) {
      const referralResult = normalizeDeclineReferrals(normalizedDecline.referrals);
      if (!referralResult.ok) {
        throw envelopeError(400, { ok: false, ...referralResult });
      }
      normalizedDecline = {
        ...normalizedDecline,
        referral: referralResult.storedValue,
      };
      delete normalizedDecline.referrals;
    }
  }

  // ── State machine guard ────────────────────────────────────────────────
  const reviewStatus = suggestion.wmkf_reviewstatus ?? null;
  const responseType = suggestion.wmkf_responsetype ?? null;
  const accepted = suggestion.wmkf_accepted === true;
  const declined = suggestion.wmkf_declined === true;

  if (responseType === RESPONSE_TYPE_WITHDRAWN_SUFFICIENT) {
    throw envelopeError(409, { ok: false, reason: 'withdrawn_sufficient' });
  }
  if (reviewStatus !== null && reviewStatus >= REVIEW_STATUS_MATERIALS_SENT) {
    throw envelopeError(409, {
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
    throw envelopeError(409, {
      ok: false,
      reason: 'review_received_locked',
      message: 'A review has already been received for this engagement. To change your response, please contact your Program Director.',
    });
  }

  // ── Decline ────────────────────────────────────────────────────────────
  if (body.action === 'decline') {
    // Idempotent repeat: already declined and not flipping → no re-stamp.
    if (declined) {
      if (suggestion._wmkf_honorariumrequest_value) {
        try {
          await withDalContext(
            'external-respond',
            () => deleteLateHonorariumForWithdrawnReviewer(
              suggestion.wmkf_appreviewersuggestionid,
            ),
          );
        } catch (e) {
          const msg = e.message || '';
          if (e.status === 412 || /\b412\b/.test(msg)) {
            throw envelopeError(412, { ok: false, reason: 'concurrent_modification' });
          }
          throw e;
        }
      } else if (suggestion.wmkf_selected === true) {
        // Repair a legacy declined row that still sits in the active proposal
        // pool. This changes only the selection flag and binds the repair to
        // the freshly verified row.
        try {
          await withDalContext(
            'external-respond',
            () => deselectLegacyDeclinedSuggestion(
              suggestion.wmkf_appreviewersuggestionid,
              { ifMatch: suggestion._etag || undefined },
            ),
          );
        } catch (e) {
          const msg = e.message || '';
          if (e.status === 412 || /\b412\b/.test(msg)) {
            throw envelopeError(412, { ok: false, reason: 'concurrent_modification' });
          }
          throw e;
        }
      }
      return {
        ok: true,
        idempotent: true,
        engagementState: { view: 'declined', accepted: false, declined: true },
      };
    }
    const linkedHonorariumRequestId = accepted
      ? suggestion._wmkf_honorariumrequest_value || null
      : null;
    try {
      await withDalContext('external-respond', () =>
        applyStage2aResponse(suggestion.wmkf_appreviewersuggestionid, {
          action: 'decline',
          contactEdits: body.contactEdits,
          honorariumOptOut: body.honorariumOptOut === true,
          decline: normalizedDecline,
        }, {
          ifMatch: ifMatch || suggestion._etag || undefined,
          deleteHonorariumRequestId: linkedHonorariumRequestId,
        }),
      );
    } catch (e) {
      const msg = e.message || '';
      if (e.status === 412 || /\b412\b/.test(msg)) {
        throw envelopeError(412, { ok: false, reason: 'concurrent_modification' });
      }
      if (/unknown declineReason value/.test(msg)) {
        throw envelopeError(400, { ok: false, reason: 'invalid_decline_reason' });
      }
      throw e;
    }
    if (accepted) {
      await cancelReviewerAcceptanceJobsForSuggestion(
        suggestion.wmkf_appreviewersuggestionid,
        'reviewer_withdrew_before_materials',
      ).catch((cancelErr) => {
        console.warn(
          '[external respond] acceptance-job cancellation after withdrawal failed (non-fatal):',
          cancelErr?.message || cancelErr,
        );
      });
      await notifyProgramDirectorOfReviewerWithdrawal({
        suggestion,
        request,
        reviewer,
        decline: normalizedDecline || {},
        honorariumDeleted: Boolean(linkedHonorariumRequestId),
      }).catch((notifyErr) => {
        console.warn(
          '[external respond] PD withdrawal notification failed after committed withdrawal (non-fatal):',
          notifyErr?.message || notifyErr,
        );
      });
    }
    // A declining reviewer still gives us their ORCID for free — capture it
    // (person + contact-if-promoted). No honorarium on decline → no new contact.
    await captureReviewerSelfReportedOrcid({ reviewer, contactId: null, rawOrcid: selfReportedOrcidOf(body, suggestion) });
    return {
      ok: true,
      idempotent: false,
      engagementState: { view: 'declined', accepted: false, declined: true },
    };
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
        throw envelopeError(400, { ok: false, reason: 'policy_ack_required', slot });
      }
    }
    const boardIdentity = body.boardIdentity || {};
    const missingIdentity = ['academicRank', 'primaryDepartment', 'mainInstitution']
      .filter((k) => !(typeof boardIdentity[k] === 'string' && boardIdentity[k].trim()));
    if (missingIdentity.length) {
      throw envelopeError(400, { ok: false, reason: 'board_identity_required', fields: missingIdentity });
    }
    if (!optedOut) {
      const missingAddress = missingRequiredAddressFields(body.address);
      if (missingAddress.length) {
        throw envelopeError(422, { ok: false, reason: 'payment_contact_required', fields: missingAddress });
      }
    }
    let policies;
    try {
      policies = await getActivePolicies(STAGE_2A_POLICY_SLOTS);
    } catch (e) {
      console.error('[external respond] policy sanity failed:', e.message);
      throw envelopeError(500, { ok: false, reason: 'policy_misconfigured', message: e.message });
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
    reviewerPortalToken,
    status: isAcceptRepeat ? 'queued' : 'accept_pending',
  });

  if (!isAcceptRepeat) {
    try {
      await withDalContext('external-respond', () =>
        applyStage2aResponse(suggestion.wmkf_appreviewersuggestionid, {
          action: 'accept',
          contactEdits: body.contactEdits,
          honorariumOptOut: body.honorariumOptOut === true,
          acks,
          responseReceivedAt: acceptedAt,
        }, {
          // Optimistic lock: caller must round-trip the _etag from /context.
          ifMatch: ifMatch || undefined,
        }),
      );
    } catch (e) {
      const msg = e.message || '';
      if (e.status === 412 || /\b412\b/.test(msg)) {
        await cancelReviewerAcceptanceJob(acceptanceJob.id, e?.message || 'accept_patch_conflict').catch((cancelErr) => {
          console.warn('[external respond] failed to cancel staged acceptance job:', cancelErr?.message || cancelErr);
        });
        throw envelopeError(412, { ok: false, reason: 'concurrent_modification' });
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

  return {
    ok: true,
    idempotent: isAcceptRepeat,
    acceptanceJobId: acceptanceJob.id,
    engagementState: { view: 'accepted-pre-materials', accepted: true, declined: false },
  };
}
