/**
 * POST /api/external/review/[token]/respond
 *
 * Unified accept/decline/hold endpoint for Stage 2a. Discriminated by `action`
 * in the request body — single endpoint because the server-side guards (token
 * verify, state machine, idempotency, optimistic locking, audit) are shared.
 * Email triggers (decline-ack, referral handoff) are deferred to a follow-up build.
 *
 * `hold` is the pre-accept "agree in principle" step: sets wmkf_responsetype=held
 * + wmkf_heldat, with NO acks / payment / honorarium and NO wmkf_accepted. It is
 * allowed ONLY while the proposal is not yet released (readiness); once released the
 * reviewer must finalize via `accept`. Readiness also gates a FRESH `accept` (incl.
 * held→finalize): refused with 409 not_ready until release. A REPEAT accept
 * (already accepted) is exempt so its idempotent honorarium retry still runs.
 *
 * Request body:
 *   {
 *     action: 'accept' | 'decline' | 'hold',
 *     // For accept:
 *     contactEdits?: {
 *       firstName?, lastName?, nickname?, title?, affiliation?, email?, orcid?
 *     },
 *     honorariumOptOut?: boolean,
 *     policyAcks?: { 'reviewer-coi': true, 'reviewer-ai-use': true },
 *     // For decline (all optional):
 *     decline?: { reasonPicklist?, reasonText?, referral? },
 *     // For hold: contactEdits only (optional).
 *   }
 *
 * Response:
 *   200 OK { ok: true, idempotent?: boolean, engagementState }
 *   400  malformed body / missing acks / invalid picklist value / invalid action
 *   401  token verification failed (use the verifier's reason codes)
 *   404  token not found
 *   409  state-machine guard violation: materials_sent_locked, review_received_locked,
 *        withdrawn_sufficient, already_accepted (hold on an accepted row),
 *        already_released (hold after release), not_ready (fresh accept before release)
 *   412  optimistic-lock conflict (suggestion row changed underneath)
 *   500  active-child sanity violation (staff misconfiguration) or unexpected
 *
 * Reversibility: a flip among accepted / declined / held is permitted while the
 * engagement is in pre-materials state (`wmkf_reviewstatus < materials_sent` and no
 * review received). On flip, response stamps refresh; wmkf_heldat is preserved across
 * a later finalize (owned by the hold path, never re-stamped on repeat hold).
 */

import { verifySuggestionToken } from '../../../../../lib/external/verify-suggestion-token';
import { isProposalReadyForReviewers } from '../../../../../lib/external/proposal-readiness';
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
// (phone → address1_telephone1) and fed to BILL vendor onboarding. `validateAddress`
// owns SHAPE/LENGTH/country-code validity only — it stays lenient on emptiness (a
// malformed/oversized field returns a clean 400; an absent/empty field passes here).
// PRESENCE of the full payment-contact set (mailing address + phone) is enforced
// separately on a non-opted-out accept by missingRequiredAddressFields below (422),
// so manual honorarium payment this cycle always has a contact address + phone.
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

// Payment-contact fields a reviewer MUST supply when taking the honorarium —
// mirrors REQUIRED_ADDRESS_FIELDS in Stage2aView (line2/state stay optional).
// Enforced server-side on a non-opted-out FRESH accept (below) so manual payment
// this cycle always has a mailing address + phone, even on a non-form (direct)
// POST that bypasses the client's own completeness check. `validateAddress` above
// still owns shape/length/country-code validity; this owns presence.
const REQUIRED_ADDRESS_FIELDS = ['line1', 'city', 'postalCode', 'country', 'phone'];
export function missingRequiredAddressFields(address) {
  const a = address && typeof address === 'object' && !Array.isArray(address) ? address : {};
  return REQUIRED_ADDRESS_FIELDS.filter((k) => !String(a[k] ?? '').trim());
}
const REVIEW_STATUS_MATERIALS_SENT = 100000001;
const RESPONSE_TYPE_ACCEPTED = 100000000;
const RESPONSE_TYPE_DECLINED = 100000001;
const RESPONSE_TYPE_WITHDRAWN_SUFFICIENT = 100000003;
const RESPONSE_TYPE_HELD = 100000004;

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

    // Proposal readiness gates hold vs finalize at the WRITE boundary (not just the
    // view): when not ready, a fresh finalize accept is refused and hold is the only
    // forward move; when ready, hold is refused (the reviewer should finalize). Read
    // from the single shared predicate so the view and write layers can't disagree.
    const ready = isProposalReadyForReviewers(request);

    const body = req.body || {};
    if (body.action !== 'accept' && body.action !== 'decline' && body.action !== 'hold') {
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
    // A received review is terminal for response transitions (accept/decline/hold).
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

    // ── Hold (pre-accept "agree in principle") ──────────────────────────────
    if (body.action === 'hold') {
      // Row-state truth precedes readiness: a finalized accept can't downgrade to hold
      // regardless of release state (Codex chunk-3: an accepted+ready hold must report
      // `already_accepted`, not `already_released`).
      if (accepted) {
        return res.status(409).json({ ok: false, reason: 'already_accepted' });
      }
      // Once the proposal is released, a not-yet-accepted reviewer should FINALIZE, not hold.
      if (ready) {
        return res.status(409).json({
          ok: false,
          reason: 'already_released',
          message: 'This proposal has been released for review — please complete your response.',
        });
      }
      // Idempotent repeat hold: already held → return without re-stamping wmkf_heldat
      // (the adapter would overwrite it). Mirrors the decline idempotency short-circuit.
      if (responseType === RESPONSE_TYPE_HELD) {
        return res.status(200).json({
          ok: true,
          idempotent: true,
          engagementState: { view: 'held', accepted: false, declined: false, held: true },
        });
      }
      // Fresh hold, or a flip from declined → held.
      try {
        await bypassDynamicsRestrictions('external-respond', () =>
          applyStage2aResponse(suggestion.wmkf_appreviewersuggestionid, {
            action: 'hold',
            contactEdits: body.contactEdits,
          }, { ifMatch: req.headers['if-match'] || undefined }),
        );
      } catch (e) {
        const msg = e.message || '';
        if (e.status === 412 || /\b412\b/.test(msg)) {
          return res.status(412).json({ ok: false, reason: 'concurrent_modification' });
        }
        throw e;
      }
      // A holding reviewer may give us their ORCID — capture it (non-fatal), as on decline.
      await captureReviewerSelfReportedOrcid({ reviewer, contactId: null, rawOrcid: selfReportedOrcidOf(body, suggestion) });
      return res.status(200).json({
        ok: true,
        idempotent: false,
        engagementState: { view: 'held', accepted: false, declined: false, held: true },
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
    // Opt-out honors BOTH the request body AND the persisted flag (a reviewer who
    // declined-with-opt-out then returns to accept stays opted out; and a re-accept
    // whose body omits the flag must not mint a honorarium for someone who opted
    // out on the original accept — Codex post-impl F2). Computed once here so the
    // fresh-accept payment-contact guard and the honorarium step below agree.
    const optedOut = body.honorariumOptOut === true || suggestion.wmkf_honorariumoptout === true;

    if (!isAcceptRepeat) {
      // Readiness write-layer gate (fresh finalize only). A fresh accept — including
      // a held→finalize accept (held never sets wmkf_accepted, so isAcceptRepeat is
      // false) — is refused until the proposal is released; the reviewer should hold
      // instead. A REPEAT accept (isAcceptRepeat) is EXEMPT: already-accepted rows
      // exist pre-release and their honorarium retry must still run regardless of
      // readiness (Codex chunk-3 #1).
      if (!ready) {
        return res.status(409).json({
          ok: false,
          reason: 'not_ready',
          message: 'This proposal is not yet released for review.',
        });
      }
      const policyAcks = body.policyAcks || {};
      for (const slot of STAGE_2A_POLICY_SLOTS) {
        if (policyAcks[slot] !== true) {
          return res.status(400).json({ ok: false, reason: 'policy_ack_required', slot });
        }
      }
      // A non-opted-out reviewer MUST supply a complete mailing address + phone so
      // staff can pay the honorarium manually this cycle (BILL onboarding deferred).
      // The client enforces this too, but the server is the only guarantee on a
      // public token endpoint — a direct POST could otherwise create a honorarium
      // with no contact info. Fresh accept only: a re-accept is an idempotent
      // honorarium retry and must not be re-blocked once the first (guarded) accept
      // already captured these. validateAddress (above) already rejected a malformed
      // address with a 400; this rejects an incomplete one with a 422.
      if (!optedOut) {
        const missingAddress = missingRequiredAddressFields(body.address);
        if (missingAddress.length) {
          return res
            .status(422)
            .json({ ok: false, reason: 'payment_contact_required', fields: missingAddress });
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
    // Runs on both fresh accept and re-accept; gated on opt-out (computed above).
    // Any failure alerts and is left for the resume sweep / a later re-accept — it
    // never converts a committed accept into a 500.
    let honContactId = null;
    if (!optedOut) {
      try {
        const honResult = await bypassDynamicsRestrictions('external-honorarium', () =>
          ensureHonorariumOnboarding({ suggestion, request, reviewer, body }),
        );
        honContactId = honResult?.contactId || null;

        // Capture-only mode: the orchestrator captured contact + mailing address
        // but the honorarium payment record / BILL onboarding is deferred (not
        // built this cycle). Posture depends on the outcome, in priority order:
        //   1. address PATCH failed → the one thing capture-only exists to capture
        //      was LOST and there is no downstream copy → emailing WARNING, deduped
        //      per suggestion (Codex S274 P1). Fires on re-accepts too: a persistent
        //      capture failure must keep surfacing until resolved.
        //   2. partial discriminator config (some-but-not-all GUIDs, no explicit
        //      defer flag) → likely a botched go-live → emailing WARNING, deduped to
        //      ONE recurring alert (Codex S274 P2).
        //   3. clean capture → ONE non-emailing info worklist record, fresh accept
        //      only (a re-accept is an idempotent retry; don't duplicate the notice).
        if (honResult?.status === 'deferred') {
          const suggestionId = suggestion.wmkf_appreviewersuggestionid;
          let notifyArgs = null;
          if (honResult.addressCaptureError) {
            notifyArgs = {
              type: 'honorarium_capture_failed',
              severity: 'warning',
              emailAdmins: true,
              autoResolveKey: `honorarium_capture_failed:${suggestionId}`,
              title: 'Reviewer honorarium: mailing address NOT captured',
              message:
                'Reviewer accepted with the honorarium pipeline deferred, but writing the ' +
                'mailing address to the contact failed — staff must capture the payment ' +
                `address manually. Error: ${honResult.addressCaptureError}`,
              metadata: {
                suggestionId,
                requestNumber: request?.akoya_requestnum || null,
                contactId: honResult?.contactId || null,
              },
              source: 'external/review/respond',
              category: 'spend',
            };
          } else if (honResult.partialDiscriminatorConfig) {
            notifyArgs = {
              type: 'honorarium_discriminator_partial_config',
              severity: 'warning',
              emailAdmins: true,
              autoResolveKey: 'honorarium_discriminator_partial_config',
              title: 'Honorarium discriminators only partially configured',
              message:
                'Some but not all of HONORARIUM_PROGRAM_ID / HONORARIUM_GRANTPROGRAM_ID / ' +
                'HONORARIUM_TYPE_ID are set, and HONORARIUM_ONBOARDING_DEFERRED is not set. ' +
                'Reviewers are being captured in capture-only mode instead of having ' +
                'honorarium records created. Set all three GUIDs to go live, or set ' +
                'HONORARIUM_ONBOARDING_DEFERRED=true to defer intentionally.',
              metadata: {
                suggestionId,
                requestNumber: request?.akoya_requestnum || null,
              },
              source: 'external/review/respond',
              category: 'spend',
            };
          } else if (!isAcceptRepeat) {
            notifyArgs = {
              type: 'honorarium_capture_only',
              severity: 'info',
              emailAdmins: false,
              title: 'Reviewer honorarium captured (onboarding deferred)',
              message:
                'Reviewer accepted and provided payment-contact info; the honorarium ' +
                'payment record and BILL onboarding are deferred and must be completed ' +
                'manually once the pipeline is enabled.',
              metadata: {
                suggestionId,
                requestNumber: request?.akoya_requestnum || null,
                contactId: honResult?.contactId || null,
              },
              source: 'external/review/respond',
              category: 'spend',
            };
          }
          if (notifyArgs) {
            try {
              await NotificationService.notify(notifyArgs);
            } catch (notifyErr) {
              console.warn('[external respond] honorarium deferred notice failed (non-fatal):', notifyErr?.message || notifyErr);
            }
          }
        }
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
