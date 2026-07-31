/**
 * Workbench — applicant-reviewer promotion service
 * (Route→Service Consolidation Plan, Stage 4 wave).
 *
 * Holds ALL business logic for POST /api/workbench/promote-applicant-reviewer;
 * the route is a thin shell (method dispatch, auth, GUID validation, DAL
 * context, HTTP mapping). Explicitly promotes one applicant-recommended
 * reviewer into the request's candidate pool by selecting the existing
 * wmkf_appreviewersuggestion junction row (applicant ingestion creates these
 * rows unselected; this is the PD action that flips wmkf_selected=true).
 *
 * Contact is resolved FIRST. The suggestion enters Invite only after its
 * canonical person has an authoritative email. The server then finalizes the
 * roster transition; a roster-anchor failure is the only non-fatal partial
 * success because the canonical suggestion is already selected.
 *
 * Contract (plan Decision 3): plain args, plain 200 body; throws
 * ServiceHttpError 404 (suggestion not for this request) / 400 (not
 * applicant-recommended; adapter's applicant-excluded refusal translated to
 * the same 400) with the default `{ error }` envelope. Typed-error
 * passthrough precedes the applicant-excluded translation (P1m note 4).
 * ASSUMES a trusted DAL context already exists.
 */

import * as reviewerSuggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { APPLICANT_DISPOSITION_MAP } from '../../dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../../dataverse/adapters/potential-reviewer';
import * as researcherAdapter from '../../dataverse/adapters/researcher';
import { translateDuplicateKeyError } from '../../dataverse/duplicate-key';
import {
  findCandidateBySuggestion,
  findAddressTrustReceipt,
  finalizeCandidatePromotion,
} from '../reviewer-roster-store';
import { requiresStaffIdentityConfirmation } from '../../utils/reviewer-provenance';
import { isAntiScrapeMunge, pickVettedEmail } from '../../utils/reviewer-vetted-email';
import { ServiceHttpError } from '../service-http-error';
import NotificationService from '../notification-service';
import { loadApplicantKnownReviewerContext } from './applicant-known-reviewer-service';
import { projectCanonicalApplicantContact } from '../../utils/applicant-known-reviewer';
import { emailConfidence } from '../../utils/reviewer-invite';
import {
  createStaffVerifiedState,
  parseAddressTrustState,
} from '../../utils/reviewer-address-trust';
import { withRemediation } from '../../utils/reviewer-remediation';

// Persist the PD's hand-corrections (the ONLY fields the client marked manual) to
// the suggestion's OWN person record, then report what landed. Mirrors the
// my-candidates hand-edit contract: conflict-safe fields first, the alt-key-
// constrained email LAST and isolated, source FORCED to 'manual' server-side (never
// trust a client source label — Codex/save-candidates trust-boundary defense). The
// A contact failure blocks promotion: selected Invite rows must never be created
// with a missing or conflicted canonical address.
async function writePromotedContact(personId, contact, { actingUserSystemId }) {
  const savedFields = [];
  if (!personId || !contact || typeof contact !== 'object') return { savedFields, contactError: null };

  const affiliation = typeof contact.affiliation === 'string' ? contact.affiliation : undefined;
  const website = typeof contact.website === 'string' ? contact.website : undefined;
  const hIndex = contact.hIndex === undefined ? undefined : contact.hIndex;

  try {
    if (affiliation !== undefined) {
      await potentialReviewerAdapter.update(personId, { affiliation }, { actingUserSystemId });
      savedFields.push('affiliation');
    }
    const researcherUpdates = {};
    if (affiliation !== undefined) researcherUpdates.affiliation = affiliation;
    if (website !== undefined) researcherUpdates.website = website;
    if (hIndex !== undefined) researcherUpdates.hIndex = hIndex;
    if (Object.keys(researcherUpdates).length > 0) {
      await researcherAdapter.updateById(personId, researcherUpdates, { actingUserSystemId });
      if (website !== undefined) savedFields.push('website');
      if (hIndex !== undefined) savedFields.push('hIndex');
    }
  } catch (err) {
    // Non-email writes do not alt-key conflict; report unexpected write failure
    // to the caller before lifecycle promotion.
    console.error('promote-applicant-reviewer contact write (safe fields) failed:', err);
    return { savedFields, contactError: { code: 'contact_write_failed', message: 'The contact correction could not be saved; retry before promoting.' } };
  }

  return { savedFields, contactError: null };
}

function hasServerIdentityConfirmation(candidate) {
  const confirmationId = candidate?.pdIdentityConfirmationId;
  return candidate?.pdIdentityConfirmed === true
    && typeof confirmationId === 'string'
    && confirmationId.length > 0
    && candidate?.staffIdentityConfirmation?.confirmationId === confirmationId;
}

// Canonical predicate now lives in lib/utils/reviewer-provenance.js so the Find-tab
// card grouping/selectability reads the SAME four clauses this gate enforces. Behavior
// here is unchanged — the local copy was byte-identical.
const requiresIdentityConfirmation = requiresStaffIdentityConfirmation;

function promotionError(message, httpStatus, code, extra = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    body: withRemediation({ error: message, message, code, ...extra }),
  });
}

async function prepareApplicantAddressTrust({
  requestId,
  personId,
  rosterCandidate,
  contact,
}) {
  let currentPerson;
  try {
    currentPerson = await potentialReviewerAdapter.getById(personId);
  } catch {
    throw promotionError(
      'Reviewer contact could not be verified; retry the promotion',
      503,
      'identity_unavailable',
    );
  }
  const manualEmail = typeof contact?.email === 'string' ? contact.email.trim().toLowerCase() : '';
  const vetted = pickVettedEmail(rosterCandidate);
  const storedEmail = typeof currentPerson?.wmkf_emailaddress === 'string'
    ? currentPerson.wmkf_emailaddress.trim().toLowerCase()
    : '';
  const foundEmail = typeof vetted?.email === 'string' ? vetted.email.trim().toLowerCase() : '';
  let receipt = null;
  let verifiedConflictEmail = '';

  if (!manualEmail && storedEmail && rosterCandidate?.applicantContactMismatch === true
    && foundEmail && foundEmail !== storedEmail) {
    receipt = await findAddressTrustReceipt(requestId, rosterCandidate.candidateKey).catch(() => null);
    const receiptEmail = typeof receipt?.email === 'string' ? receipt.email.trim().toLowerCase() : '';
    if (receipt?.personConfirmed === true && (receiptEmail === storedEmail || receiptEmail === foundEmail)) {
      verifiedConflictEmail = receiptEmail;
    } else {
      throw promotionError(
        'The stored and newly found addresses differ. Review both addresses before promotion.',
        409,
        'email_mismatch',
        { storedEmail, foundEmail },
      );
    }
  }

  const email = manualEmail || verifiedConflictEmail || storedEmail || foundEmail;
  const source = manualEmail
    ? 'manual'
    : (storedEmail ? currentPerson?.wmkf_emailsource : vetted?.source);
  if (!email) {
    throw promotionError(
      'Add and verify an email before promoting this reviewer',
      422,
      'missing_verified_email',
      { decision: 'missing_email' },
    );
  }

  const desiredReadiness = emailConfidence({ email, emailSource: source });
  const currentReadiness = emailConfidence(currentPerson || {});
  const needsAttestation = desiredReadiness.action === 'quick_check'
    || desiredReadiness.action === 'research_only'
    || currentReadiness.action === 'blocked'
    // A staff-selected side of a stored/found mismatch is always an explicit
    // adjudication, even if the earlier conflict-state write failed and the
    // stored source would otherwise classify as ready.
    || !!verifiedConflictEmail;

  if (needsAttestation) {
    if (!receipt) {
      try {
        receipt = await findAddressTrustReceipt(requestId, rosterCandidate.candidateKey);
      } catch {
        throw promotionError(
          'Could not verify the saved address attestation. Retry before promotion.',
          503,
          'identity_unavailable',
        );
      }
    }
    const receiptEmail = typeof receipt?.email === 'string' ? receipt.email.trim().toLowerCase() : '';
    if (!receipt?.receiptId || receipt.personConfirmed !== true || receiptEmail !== email) {
      throw promotionError(
        'Verify this exact address from the Find card before promoting the reviewer.',
        422,
        'address_verification_required',
        { decision: 'needs_address_verification' },
      );
    }
  }

  let addressTrustStateJson;
  let persistedSource = source;
  if (needsAttestation) {
    const currentTrust = parseAddressTrustState(
      currentPerson?.wmkf_addresstruststatejson,
      { storedEmail: currentPerson?.wmkf_emailaddress },
    );
    const resolution = currentTrust.valid && currentTrust.state.status === 'conflict_pending'
      ? {
          conflict: currentTrust.state.conflict,
          decision: email === currentTrust.state.email ? 'keep_stored' : 'use_found',
          actorProfileId: receipt.actorProfileId || null,
          actorSystemUserId: receipt.actorSystemUserId || null,
          resolvedAt: new Date().toISOString(),
        }
      : null;
    addressTrustStateJson = JSON.stringify(createStaffVerifiedState({
      email,
      actorProfileId: receipt.actorProfileId,
      actorSystemUserId: receipt.actorSystemUserId,
      requestId,
      candidateKey: rosterCandidate.candidateKey,
      evidenceType: receipt.evidenceType,
      evidenceUrl: receipt.evidenceUrl,
      note: receipt.note,
      attestedAt: receipt.attestedAt,
      resolution,
    }));
    persistedSource = 'staff_verified';
  }

  return {
    currentPerson,
    email,
    source: persistedSource,
    addressTrustStateJson,
    shouldWrite: manualEmail.length > 0 || !storedEmail || !!addressTrustStateJson,
    attested: needsAttestation,
    receipt: needsAttestation ? receipt : null,
  };
}

/**
 * Promote one applicant-recommended suggestion (flip selected), persist the
 * PD's safe hand-corrections, bind an exact verified address (using the
 * server-owned roster receipt when required), verify canonical contact, then
 * select the suggestion.
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @param {string} args.suggestionId - GUID (already validated by the shell)
 * @param {Object|undefined} args.contact - client-marked manual fields only
 * @param {string|null} args.actingUserSystemId
 * @returns {Promise<{ success: true, suggestionId: string, savedFields: string[],
 *   partialSuccess: boolean, contactError: Object|null }>}
 * @throws {ServiceHttpError} 404 not-for-this-request; 400 not-recommended /
 *   applicant-excluded refusal
 */
export async function promoteApplicantReviewer({ requestId, suggestionId, contact, actingUserSystemId }) {
  try {
    const row = await reviewerSuggestionAdapter.findById(suggestionId);
    if (!row || String(row._wmkf_request_value || '').toLowerCase() !== requestId.toLowerCase()) {
      throw new ServiceHttpError('Applicant reviewer suggestion not found for this request', { httpStatus: 404 });
    }
    if (row.wmkf_applicantdisposition !== APPLICANT_DISPOSITION_MAP.recommended) {
      throw new ServiceHttpError('Only applicant-recommended reviewers can be promoted', { httpStatus: 400 });
    }

    // The enrichment path records direct deceased evidence in the
    // request-scoped roster before this action can be offered. Treat that
    // server-side evidence as authoritative. This read is a pre-mutation safety
    // boundary, so infrastructure failure must ask the caller to retry rather
    // than permitting an irreversible promotion without the check.
    let rosterCandidate = null;
    try {
      rosterCandidate = await findCandidateBySuggestion(requestId, suggestionId);
    } catch (err) {
      console.error('promote-applicant-reviewer eligibility read failed:', err);
      throw new ServiceHttpError('Reviewer eligibility could not be verified; retry the promotion', {
        httpStatus: 503,
        body: {
          error: 'Reviewer eligibility could not be verified; retry the promotion',
          code: 'eligibility_unavailable',
        },
      });
    }
    if (!rosterCandidate) {
      throw new ServiceHttpError('Verify this reviewer before promoting them', {
        httpStatus: 422,
        body: {
          error: 'Verify this reviewer before promoting them',
          code: 'identity_verification_required',
        },
      });
    }
    if (typeof rosterCandidate.candidateKey !== 'string' || !rosterCandidate.candidateKey.trim()) {
      throw new ServiceHttpError('Verify this reviewer before promoting them', {
        httpStatus: 422,
        body: {
          error: 'Verify this reviewer before promoting them',
          code: 'identity_verification_required',
        },
      });
    }
    const eligibilityStatus = rosterCandidate?.eligibilityStatus
      || rosterCandidate?.contactEnrichment?.eligibilityStatus
      || 'unknown';
    if (rosterCandidate?.rosterStatus === 'ineligible' || eligibilityStatus === 'deceased') {
      throw new ServiceHttpError('This reviewer is not eligible because an official source reports the person is deceased', {
        httpStatus: 422,
        body: { error: 'This reviewer is not eligible because an official source reports the person is deceased', code: 'candidate_ineligible' },
      });
    }
    if (requiresIdentityConfirmation(rosterCandidate) && !hasServerIdentityConfirmation(rosterCandidate)) {
      throw new ServiceHttpError('Confirm this reviewer’s identity before promoting them', {
        httpStatus: 422,
        body: {
          error: 'Confirm this reviewer’s identity before promoting them',
          code: 'identity_confirmation_required',
        },
      });
    }

    const manualEmailAttempted = typeof contact?.email === 'string'
      && contact.email.trim().length > 0;
    if (manualEmailAttempted && isAntiScrapeMunge(contact.email)) {
      throw new ServiceHttpError('Enter a deliverable email address before promoting this reviewer', {
        httpStatus: 422,
        body: {
          error: 'Enter a deliverable email address before promoting this reviewer',
          code: 'anti_scrape_email',
        },
      });
    }
    const personId = row._wmkf_potentialreviewer_value;
    const addressPlan = await prepareApplicantAddressTrust({
      requestId,
      personId,
      rosterCandidate,
      contact,
    });
    const preflight = await loadApplicantKnownReviewerContext(personId);
    const preflightKnown = preflight.applicantKnownReviewer;
    if (preflightKnown.status === 'unavailable') {
      throw new ServiceHttpError('Reviewer contact could not be verified; retry the promotion', {
        httpStatus: 503,
        body: {
          error: 'Reviewer contact could not be verified; retry the promotion',
          code: 'contact_verification_unavailable',
        },
      });
    }
    if (preflightKnown.status === 'inactive') {
      throw new ServiceHttpError('This reviewer record is inactive and must be repaired before promotion', {
        httpStatus: 422,
        body: {
          error: 'This reviewer record is inactive and must be repaired before promotion',
          code: 'person_inactive',
          decision: 'person_inactive',
        },
      });
    }
    if (preflightKnown.status === 'email_conflict' && !manualEmailAttempted) {
      throw new ServiceHttpError('The stored email is owned by another or ambiguous reviewer record', {
        httpStatus: 409,
        body: {
          error: 'The stored email is owned by another or ambiguous reviewer record',
          code: 'email_conflict',
          decision: 'email_conflict',
        },
      });
    }

    // Resolve contact BEFORE promotion. Applicant rows already own a canonical
    // person/suggestion, but they must not enter Invite until that person has an
    // authoritative email. A duplicate-email conflict therefore withholds the
    // promotion instead of creating a selected-but-unsendable row.
    const { savedFields, contactError } = await writePromotedContact(
      personId,
      contact,
      { actingUserSystemId },
    );

    let addressWriteError = null;
    if (!contactError && addressPlan.shouldWrite) {
      try {
        const currentForWrite = await potentialReviewerAdapter.getById(personId);
        if (!currentForWrite?._etag) {
          throw Object.assign(new Error('Reviewer address trust write requires a current person ETag.'), {
            code: 'conflict_record_unavailable',
          });
        }
        let currentAddressTrustStateJson = addressPlan.addressTrustStateJson;
        if (addressPlan.attested && addressPlan.receipt) {
          const currentTrust = parseAddressTrustState(
            currentForWrite.wmkf_addresstruststatejson,
            { storedEmail: currentForWrite.wmkf_emailaddress },
          );
          const resolution = currentTrust.valid && currentTrust.state.status === 'conflict_pending'
            ? {
                conflict: currentTrust.state.conflict,
                decision: addressPlan.email === currentTrust.state.email ? 'keep_stored' : 'use_found',
                actorProfileId: addressPlan.receipt.actorProfileId || null,
                actorSystemUserId: addressPlan.receipt.actorSystemUserId || null,
                resolvedAt: new Date().toISOString(),
              }
            : null;
          currentAddressTrustStateJson = JSON.stringify(createStaffVerifiedState({
            email: addressPlan.email,
            actorProfileId: addressPlan.receipt.actorProfileId,
            actorSystemUserId: addressPlan.receipt.actorSystemUserId,
            requestId,
            candidateKey: rosterCandidate.candidateKey,
            evidenceType: addressPlan.receipt.evidenceType,
            evidenceUrl: addressPlan.receipt.evidenceUrl,
            note: addressPlan.receipt.note,
            attestedAt: addressPlan.receipt.attestedAt,
            resolution,
          }));
        }
        await potentialReviewerAdapter.update(personId, {
          email: addressPlan.email,
          emailSource: addressPlan.source,
          ...(currentAddressTrustStateJson
            ? { addressTrustStateJson: currentAddressTrustStateJson }
            : {}),
        }, { actingUserSystemId, ifMatch: currentForWrite._etag });
        savedFields.push('email');
      } catch (err) {
        const translated = translateDuplicateKeyError(err);
        addressWriteError = translated
          ? {
              code: 'email_conflict',
              field: 'wmkf_emailaddress',
              value: translated.value || addressPlan.email,
              message: 'That email is already used by another reviewer record — merge or correct it before promoting.',
            }
          : {
              code: err?.code || 'contact_write_failed',
              message: 'The verified address could not be saved; retry or create a repair request.',
            };
      }
    }

    const finalContactError = contactError || addressWriteError;
    if (finalContactError) {
      throw new ServiceHttpError(finalContactError.message, {
        httpStatus: finalContactError.code === 'email_conflict' ? 409 : 503,
        body: {
          error: finalContactError.message,
          code: finalContactError.code,
          contactError: finalContactError,
        },
      });
    }

    const { applicantKnownReviewer } = await loadApplicantKnownReviewerContext(personId);
    if (applicantKnownReviewer.status === 'unavailable') {
      throw new ServiceHttpError('Reviewer contact could not be verified; retry the promotion', {
        httpStatus: 503,
        body: {
          error: 'Reviewer contact could not be verified; retry the promotion',
          code: 'contact_verification_unavailable',
        },
      });
    }

    const rosterContactForDecision = (
      addressPlan.shouldWrite && savedFields.includes('email')
    ) ? {
        ...rosterCandidate,
        email: addressPlan.email,
        emailSource: addressPlan.source,
        applicantContactMismatch: false,
        contactEnrichment: {
          ...(rosterCandidate.contactEnrichment || {}),
          email: addressPlan.email,
          emailSource: addressPlan.source,
        },
      }
      : rosterCandidate;
    const canonicalContact = projectCanonicalApplicantContact({
      applicantKnownReviewer,
      candidate: rosterContactForDecision,
    });
    if (canonicalContact.decision === 'person_inactive') {
      throw new ServiceHttpError('This reviewer record is inactive and must be repaired before promotion', {
        httpStatus: 422,
        body: {
          error: 'This reviewer record is inactive and must be repaired before promotion',
          code: 'person_inactive',
          decision: canonicalContact.decision,
        },
      });
    }
    if (canonicalContact.decision === 'email_conflict') {
      throw new ServiceHttpError('The stored email is owned by another or ambiguous reviewer record', {
        httpStatus: 409,
        body: {
          error: 'The stored email is owned by another or ambiguous reviewer record',
          code: 'email_conflict',
          decision: canonicalContact.decision,
        },
      });
    }
    if (canonicalContact.decision === 'contact_claim_mismatch') {
      throw new ServiceHttpError('The stored and enriched email claims disagree; review the contact before promotion', {
        httpStatus: 409,
        body: {
          error: 'The stored and enriched email claims disagree; review the contact before promotion',
          code: 'contact_claim_mismatch',
          decision: canonicalContact.decision,
        },
      });
    }
    if (canonicalContact.decision !== 'ready') {
      throw new ServiceHttpError('Add or verify an email before promoting this reviewer', {
        httpStatus: 422,
        body: {
          error: 'Add or verify an email before promoting this reviewer',
          code: 'missing_verified_email',
          decision: 'missing_email',
        },
      });
    }

    await reviewerSuggestionAdapter.updateLifecycle(
      suggestionId,
      { selected: true },
      { actingUserSystemId },
    );

    let rosterFinalized = false;
    try {
      const finalized = await finalizeCandidatePromotion(requestId, rosterCandidate, {
        candidateKey: rosterCandidate.candidateKey,
        suggestionId,
        potentialReviewerId: personId,
      });
      rosterFinalized = finalized?.saved === true;
    } catch (err) {
      console.error('promote-applicant-reviewer roster finalization failed (non-fatal):', err);
    }
    if (!rosterFinalized) {
      try {
        await NotificationService.notify({
          type: 'reviewer_roster_promotion_finalize_failed',
          severity: 'warning',
          title: 'Applicant reviewer promoted without roster finalization',
          message: `Applicant reviewer suggestion ${suggestionId} was selected for request ${requestId}, but its Find roster row was not finalized.`,
          metadata: {
            requestId,
            suggestionId,
            candidateKey: rosterCandidate.candidateKey,
            potentialReviewerId: personId,
          },
          source: 'workbench/promote-applicant-reviewer',
          category: 'reviewers',
          autoResolveKey: `reviewer-roster-promotion:${requestId}:${rosterCandidate.candidateKey}`,
        });
      } catch (notifyErr) {
        console.warn('promote-applicant-reviewer roster finalization alert failed (non-fatal):', notifyErr?.message || notifyErr);
      }
    }

    return {
      success: true,
      suggestionId,
      candidateKey: rosterCandidate.candidateKey,
      savedFields,
      rosterFinalized,
      partialSuccess: !rosterFinalized,
      contactError: null,
      emailAction: canonicalContact.emailReadiness.action,
      emailActionReason: canonicalContact.emailReadiness.reason,
    };
  } catch (err) {
    // Typed-error passthrough FIRST (P1m note 4) — domain errors must not be
    // eaten by the applicant-excluded translation below.
    if (err instanceof ServiceHttpError) {
      const body = err.body && typeof err.body === 'object'
        ? err.body
        : { error: err.message };
      err.body = withRemediation({
        ...body,
        message: body.message || body.error || err.message,
        code: body.code || 'reviewer_promotion_failed',
      });
      throw err;
    }
    if (/applicant-excluded/i.test(err?.message || '')) {
      throw new ServiceHttpError('Only applicant-recommended reviewers can be promoted', { httpStatus: 400 });
    }
    throw err;
  }
}
