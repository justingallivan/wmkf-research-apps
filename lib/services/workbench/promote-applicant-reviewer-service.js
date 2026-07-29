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
 * PARTIAL SUCCESS is a 200: promotion flips selected FIRST; the contact
 * hand-correction write and the B1 enriched-email backfill are non-fatal and
 * report through { partialSuccess, contactError, savedFields } (accumulators
 * live outside the failing writes — P1m note 5).
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
import { findCandidateBySuggestion } from '../reviewer-roster-store';
import { requiresStaffIdentityConfirmation } from '../../utils/reviewer-provenance';
import { pickVettedEmail } from '../../utils/reviewer-vetted-email';
import { ServiceHttpError } from '../service-http-error';

// Persist the PD's hand-corrections (the ONLY fields the client marked manual) to
// the suggestion's OWN person record, then report what landed. Mirrors the
// my-candidates hand-edit contract: conflict-safe fields first, the alt-key-
// constrained email LAST and isolated, source FORCED to 'manual' server-side (never
// trust a client source label — Codex/save-candidates trust-boundary defense). The
// row is already promoted by the time this runs, so a contact failure is reported,
// never fatal: the promoted-but-conflicted row resolves on the Invite tab merge flow.
async function writePromotedContact(personId, contact, { actingUserSystemId }) {
  const savedFields = [];
  if (!personId || !contact || typeof contact !== 'object') return { savedFields, contactError: null };

  const affiliation = typeof contact.affiliation === 'string' ? contact.affiliation : undefined;
  const website = typeof contact.website === 'string' ? contact.website : undefined;
  const hIndex = contact.hIndex === undefined ? undefined : contact.hIndex;
  const email = typeof contact.email === 'string' ? contact.email.trim() : '';

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
    // Non-email writes don't alt-key conflict; a failure here is unexpected but
    // must not unwind the promotion. Report it.
    console.error('promote-applicant-reviewer contact write (safe fields) failed:', err);
    return { savedFields, contactError: { code: 'contact_write_failed', message: 'Promoted, but the contact correction could not be saved — re-enter it on the Invite Reviewers tab.' } };
  }

  // Email LAST, isolated. The address and its 'manual' provenance go in ONE PATCH (S387
  // adversarial review finding 3) so a rejected address cannot leave the row labelled
  // with a source that describes a different address. A duplicate-key here means the
  // address is owned by another record → report (the staffer resolves it via the
  // Invite-tab merge), but the promotion already stuck.
  if (email) {
    try {
      await potentialReviewerAdapter.update(personId, { email, emailSource: 'manual' }, { actingUserSystemId });
      savedFields.push('email');
    } catch (err) {
      const translated = translateDuplicateKeyError(err);
      if (translated) {
        return { savedFields, contactError: { code: 'email_conflict', field: 'wmkf_emailaddress', value: translated.value || email, message: 'That email is already used by another reviewer record — resolve it on the Invite Reviewers tab.' } };
      }
      console.error('promote-applicant-reviewer email write failed:', err);
      return { savedFields, contactError: { code: 'contact_write_failed', message: 'Promoted, but the email correction could not be saved — re-enter it on the Invite Reviewers tab.' } };
    }
  }

  return { savedFields, contactError: null };
}

// B1 (S317): recover the VETTED enrichment email that `enrich-recommended` wrote to
// the durable roster but never to Dataverse (its writeback via
// `researcherAdapter.upsertByPotentialReviewer` has no email param — researcher.js:94),
// so an applicant reviewer promoted WITHOUT a manual correction used to land on the
// Invite tab with an empty `wmkf_emailaddress`. The email is read SERVER-SIDE from the
// roster keyed by the server-derived `requestId + suggestionId` (an exact id anchor —
// never a client-supplied value, never a normalized name), so no new trust boundary.
// Persisted through the SAME envelope save-candidates uses: only when enrichment marked
// it persistable (`emailPersistAllowed===true` — enrichment sets this false on any
// identity/domain abstain) and identity is not unresolved, and ONLY when the person has
// no email yet (idempotent; never overrides a manual correction or a prior address). The
// source is forced to the roster's VETTED provenance server-side, not 'manual'. A
// duplicate-email collision is non-fatal (mirrors the manual path) → reported, promotion
// stands. Returns { savedField, contactError }.
async function backfillEnrichedEmail(requestId, suggestionId, personId, { actingUserSystemId }) {
  if (!personId) return { savedField: false, contactError: null };
  let candidate = null;
  try {
    candidate = await findCandidateBySuggestion(requestId, suggestionId);
  } catch (err) {
    console.error('promote-applicant-reviewer roster read failed (non-fatal):', err);
    return { savedField: false, contactError: null };
  }
  if (!candidate) return { savedField: false, contactError: null };

  // Shared persist gate (mirrors save-candidates): vetted, persistable, resolved
  // identity. Null → not persistable, skip.
  const vetted = pickVettedEmail(candidate);
  if (!vetted) return { savedField: false, contactError: null };
  const { email, source } = vetted;

  // Idempotency: only write when the person currently has NO email — never clobber a
  // manual correction (already handled above) or a pre-existing address.
  let current = null;
  try {
    current = await potentialReviewerAdapter.getById(personId);
  } catch (err) {
    console.error('promote-applicant-reviewer person read failed (non-fatal):', err);
    return { savedField: false, contactError: null };
  }
  if (current && current.wmkf_emailaddress) return { savedField: false, contactError: null };

  try {
    // Address + its vetted provenance in ONE patch (S387 adversarial review finding 3):
    // as two calls, a landed address whose source write failed left the row describing
    // the new address under whatever source was there before.
    await potentialReviewerAdapter.update(
      personId,
      source ? { email, emailSource: source } : { email },
      { actingUserSystemId },
    );
    return { savedField: true, contactError: null };
  } catch (err) {
    const translated = translateDuplicateKeyError(err);
    if (translated) {
      return { savedField: false, contactError: { code: 'email_conflict', field: 'wmkf_emailaddress', value: translated.value || email, message: 'That email is already used by another reviewer record — resolve it on the Invite Reviewers tab.' } };
    }
    console.error('promote-applicant-reviewer enriched-email write failed (non-fatal):', err);
    return { savedField: false, contactError: null };
  }
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

/**
 * Promote one applicant-recommended suggestion (flip selected), persist the
 * PD's hand-corrections, then backfill the vetted enrichment email when no
 * manual email was attempted.
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

    // Flip selected FIRST — promotion is a valid decision regardless of whether a
    // contact correction can be saved (Codex Q1). Contact write happens after and
    // is non-fatal, so the current client (which treats any non-OK as a failed
    // promote) still records this row as promoted.
    await reviewerSuggestionAdapter.updateLifecycle(
      suggestionId,
      { selected: true },
      { actingUserSystemId },
    );

    // Persist the PD's hand-corrections to the suggestion's OWN person record
    // (row._wmkf_potentialreviewer_value — never a client-supplied id). The client
    // sends ONLY the fields it explicitly marked manual (contact.*).
    const { savedFields, contactError } = await writePromotedContact(
      row._wmkf_potentialreviewer_value,
      contact,
      { actingUserSystemId },
    );

    // B1: if the PD did NOT hand-correct an email, backfill the vetted enrichment
    // email from the roster (server-side, id-anchored). Gate on whether a manual
    // email was ATTEMPTED, not just whether one persisted: a manual email that
    // COLLIDED (409, not in savedFields) is an explicit PD choice that must route to
    // the Invite-tab merge — never get silently overwritten by the enrichment email.
    const manualEmailAttempted = typeof contact?.email === 'string'
      && contact.email.trim().length > 0;
    let backfillError = null;
    if (!manualEmailAttempted && !savedFields.includes('email')) {
      const { savedField, contactError: bfError } = await backfillEnrichedEmail(
        requestId,
        suggestionId,
        row._wmkf_potentialreviewer_value,
        { actingUserSystemId },
      );
      if (savedField) savedFields.push('email');
      backfillError = bfError;
    }

    // Prefer the manual-write error (the PD's explicit action) over the backfill's.
    const finalContactError = contactError || backfillError;
    return {
      success: true,
      suggestionId,
      savedFields,
      partialSuccess: !!finalContactError,
      contactError: finalContactError,
    };
  } catch (err) {
    // Typed-error passthrough FIRST (P1m note 4) — domain errors must not be
    // eaten by the applicant-excluded translation below.
    if (err instanceof ServiceHttpError) throw err;
    if (/applicant-excluded/i.test(err?.message || '')) {
      throw new ServiceHttpError('Only applicant-recommended reviewers can be promoted', { httpStatus: 400 });
    }
    throw err;
  }
}
