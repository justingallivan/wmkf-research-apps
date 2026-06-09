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
import { ensureHonorariumOnboarding } from '../../../../../lib/bill/honorarium-onboard-orchestrator';
import { captureSelfReportedReviewerOrcid } from '../../../../../lib/services/capture-self-reported-orcid';
import { normalizeOrcid } from '../../../../../lib/utils/orcid-normalize';
import NotificationService from '../../../../../lib/services/notification-service';

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

// Reviewer mailing-address caps (chunk-4). Address is PATCHed to contact.address1_*
// (phone → address1_telephone1) and fed to BILL vendor onboarding. Absent address is
// allowed here (the honorarium row + provenance are still created; BILL onboarding
// degrades/alerts on missing address); a malformed/oversized field returns a clean 400.
// `phone` is required client-side (Stage2aView) for manual-payment contact this cycle;
// server stays lenient on emptiness, consistent with the other address fields.
const ADDRESS_MAX = { line1: 200, line2: 200, city: 100, state: 100, postalCode: 20, country: 2, phone: 40 };
function validateAddress(address) {
  if (address === undefined || address === null) return null;
  if (typeof address !== 'object' || Array.isArray(address)) return { reason: 'invalid_address' };
  for (const [k, v] of Object.entries(address)) {
    if (!(k in ADDRESS_MAX)) return { reason: 'unknown_address_field', field: k };
    if (v === null || v === undefined || v === '') continue;
    if (typeof v !== 'string') return { reason: 'invalid_address_field', field: k };
    if (v.length > ADDRESS_MAX[k]) return { reason: 'address_field_too_long', field: k };
  }
  const c = address.country;
  if (c !== undefined && c !== null && c !== '' && c.length !== 2) {
    return { reason: 'invalid_country', field: 'country' };
  }
  return null;
}
const REVIEW_STATUS_MATERIALS_SENT = 100000001;
const RESPONSE_TYPE_ACCEPTED = 100000000;
const RESPONSE_TYPE_DECLINED = 100000001;
const RESPONSE_TYPE_WITHDRAWN_SUFFICIENT = 100000003;

// The reviewer's self-reported ORCID for this response: the value they typed
// this time (delta) OR the one already persisted on the engagement row (which
// was their prefill — the client sends only CHANGED fields, so a confirm-without-
// edit sends nothing) (Codex S217 #3).
function selfReportedOrcidOf(body, suggestion) {
  return body?.contactEdits?.orcid || suggestion?.wmkf_reviewerorcid || null;
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

    // ── Decline ────────────────────────────────────────────────────────────
    if (body.action === 'decline') {
      // Idempotent repeat: already declined and not flipping → no re-stamp.
      if (declined && !accepted) {
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
    // A fresh accept stamps the suggestion row; a REPEAT accept (already
    // accepted, not flipping) skips the stamp but STILL runs the honorarium
    // step, which may not have completed on the first attempt (Codex pre-impl
    // P1 #2). The honorarium step is itself idempotent.
    const isAcceptRepeat = accepted && !declined;

    if (!isAcceptRepeat) {
      const policyAcks = body.policyAcks || {};
      for (const slot of STAGE_2A_POLICY_SLOTS) {
        if (policyAcks[slot] !== true) {
          return res.status(400).json({ ok: false, reason: 'policy_ack_required', slot });
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
        return res.status(500).json({ ok: false, reason: 'policy_misconfigured', message: e.message });
      }
      const acks = {
        coiVersionId: policies['reviewer-coi'].activeVersionId,
        aiUseVersionId: policies['reviewer-ai-use'].activeVersionId,
        ackedAt: new Date().toISOString(),
      };
      try {
        await bypassDynamicsRestrictions('external-respond', () =>
          applyStage2aResponse(suggestion.wmkf_appreviewersuggestionid, {
            action: 'accept',
            contactEdits: body.contactEdits,
            honorariumOptOut: body.honorariumOptOut === true,
            acks,
          }, {
            // Optimistic lock — caller must round-trip the _etag from /context.
            ifMatch: req.headers['if-match'] || undefined,
          }),
        );
      } catch (e) {
        const msg = e.message || '';
        if (e.status === 412 || /\b412\b/.test(msg)) {
          return res.status(412).json({ ok: false, reason: 'concurrent_modification' });
        }
        throw e;
      }
    }

    // Reflect a valid self-reported ORCID onto the in-memory reviewer BEFORE
    // honorarium (Codex S217 #2), so honorarium's contact back-prop carries the
    // self-report (highest trust, 'confirmed') rather than a stale resolver iD —
    // avoiding a needless fill-then-conflict on the contact. If the contact was
    // already filled with a DIFFERENT corroborated iD in a prior session, the §4
    // conflict policy still (correctly) surfaces rather than clobbers.
    const acceptOrcidRaw = selfReportedOrcidOf(body, suggestion);
    const acceptOrcidNorm = normalizeOrcid(acceptOrcidRaw);
    if (acceptOrcidNorm.state === 'valid' && reviewer) {
      reviewer.wmkf_orcid = acceptOrcidNorm.id;
      reviewer.wmkf_identitystatus = 'confirmed';
    }

    // ── Honorarium onboarding (NON-FATAL to the accept) ────────────────────
    // Runs on both fresh accept and re-accept; gated on opt-out. Any failure
    // alerts and is left for the resume sweep / a later re-accept — it never
    // converts a committed accept into a 500.
    //
    // Opt-out honors BOTH the request body AND the persisted flag (Codex
    // post-impl F2): a re-accept whose body omits honorariumOptOut must not
    // mint a honorarium for a reviewer who opted out on the original accept.
    const optedOut = body.honorariumOptOut === true || suggestion.wmkf_honorariumoptout === true;
    let honContactId = null;
    if (!optedOut) {
      try {
        const honResult = await bypassDynamicsRestrictions('external-honorarium', () =>
          ensureHonorariumOnboarding({ suggestion, request, reviewer, body }),
        );
        honContactId = honResult?.contactId || null;
      } catch (honErr) {
        console.error('[external respond] honorarium onboarding failed (non-fatal):', honErr?.message || honErr);
        try {
          await NotificationService.notify({
            type: 'honorarium_onboard_failed',
            severity: 'warning',
            emailAdmins: true,
            title: 'Honorarium onboarding failed after reviewer accept',
            message: honErr?.message || String(honErr),
            metadata: {
              suggestionId: suggestion.wmkf_appreviewersuggestionid,
              requestNumber: request?.akoya_requestnum || null,
              code: honErr?.code || null,
            },
            source: 'external/review/respond',
            category: 'spend',
          });
        } catch (notifyErr) {
          console.error('[external respond] honorarium alert failed:', notifyErr?.message || notifyErr);
        }
      }
    }

    // Self-reported ORCID → person + contact (twin of PR3). Uses the just-created
    // honorarium contact when present, else the invite-time pointer. Runs on fresh
    // and repeat accepts (idempotent); independent of honorarium opt-out. Sourced
    // from the typed delta OR the persisted engagement value (confirm-without-edit).
    await captureReviewerSelfReportedOrcid({ reviewer, contactId: honContactId, rawOrcid: acceptOrcidRaw });

    return res.status(200).json({
      ok: true,
      idempotent: isAcceptRepeat,
      engagementState: { view: 'accepted-pre-materials', accepted: true, declined: false },
    });
  } catch (e) {
    console.error('[external respond] unexpected error:', e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
