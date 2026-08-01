/**
 * Workbench — manual reviewer add / referral capture service
 * (Route→Service Consolidation Plan, Stage 4 wave).
 *
 * Holds ALL business logic for POST /api/workbench/manual-reviewer; the route
 * is a thin shell (method dispatch, auth, input parsing/validation, DAL
 * context, HTTP mapping). Adds one sparse staff-entered reviewer into a
 * request's durable candidate pool (Phase 1 only: no enrichment runs here).
 *
 * Also captures REFERRALS (S249): when `referredBy` is supplied (a contacted
 * reviewer suggested this person), the candidate is tagged provenance
 * `referred` — a strong human signal, selectable-with-verify and
 * grounded-rank-bonused like proposal_named — and the referrer is recorded in
 * the durable match reason. The free-text → identity resolution
 * (lookup → resolve/confirm/409) is the SAME abstain-or-confirm flow as
 * manual add; only the provenance + referrer differ.
 * Design: docs/REVIEWER_FINDER_REFERRAL_CAPTURE_DESIGN.md.
 *
 * Contract (plan Decision 3): plain args, plain 200 body; throws
 * ManualReviewerError (extends ServiceHttpError) with an explicit `body` —
 * this route's non-2xx envelopes carry `code`/`details`/`lookup`/
 * `suggestionId` beyond `{ error }`; typed-error passthrough in the pipeline
 * precedes any provider-error translation (P1m note 4). ASSUMES a trusted
 * DAL context already exists.
 */

import { normalizeOrcid } from '../../utils/orcid-normalize';
import { meetingDateToCycleCode } from '../../utils/cycle-code';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import * as potentialReviewerAdapter from '../../dataverse/adapters/potential-reviewer';
import * as contactAdapter from '../../dataverse/adapters/contact';
import * as researcherAdapter from '../../dataverse/adapters/researcher';
import * as reviewerSuggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { lookupReviewerIdentity } from '../reviewer-identity-lookup';
import { ServiceHttpError } from '../service-http-error';

const MAX_EMAIL = 254;

/**
 * Typed domain error carrying the exact JSON envelope the shell must send
 * (these envelopes are `{ error, code?, details?, lookup?, suggestionId? }`,
 * not the bare `{ error }` default).
 */
export class ManualReviewerError extends ServiceHttpError {
  constructor(httpStatus, body) {
    super(body.error, { httpStatus, body, code: body.code });
    this.name = 'ManualReviewerError';
  }
}

function conflictError(reason, details) {
  return new ManualReviewerError(409, { error: 'Manual reviewer identity conflict', code: reason, details });
}

function cleanString(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function sameEmail(a, b) {
  return cleanString(a, MAX_EMAIL).toLowerCase() === cleanString(b, MAX_EMAIL).toLowerCase();
}

function sameId(a, b) {
  return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
}

function contactName(row) {
  return row?.fullname || [row?.firstname, row?.lastname].filter(Boolean).join(' ');
}

function contactOrcidConflict(typedOrcid, contact) {
  if (!typedOrcid || !contact?.wmkf_orcid) return null;
  const existing = normalizeOrcid(contact.wmkf_orcid);
  if (existing.state === 'valid' && existing.id !== typedOrcid) {
    return { existing: existing.id, incoming: typedOrcid };
  }
  return null;
}

function resolutionFromLookup(lookup) {
  if (lookup?.outcome !== 'confident' || lookup.match?.nameConsistent === false) return null;
  if (lookup.match.reviewerId) {
    return { mode: 'reuse_reviewer', reviewerId: lookup.match.reviewerId, contactId: lookup.match.contactId || undefined };
  }
  if (lookup.match.contactId) {
    return { mode: 'reuse_contact', contactId: lookup.match.contactId };
  }
  return null;
}

/**
 * Add one staff-entered (or referred) reviewer to the request's pool.
 *
 * @param {Object} args - shell-normalized inputs (cleaned/validated strings)
 * @param {string} args.requestId - GUID
 * @param {string} args.name
 * @param {string} args.email - lowercased, '' when absent
 * @param {string} args.affiliation
 * @param {string} args.note
 * @param {string} args.referredBy
 * @param {string|null} args.orcid - normalized valid ORCID or null
 * @param {Object|null} args.resolution - { mode, reviewerId?, contactId? } (shape pre-validated)
 * @param {string|null} args.actingUserSystemId
 * @returns {Promise<Object>} the 200 response body
 * @throws {ManualReviewerError|ServiceHttpError} 400/404/409 per the historical envelopes
 */
export async function addManualReviewer({
  requestId, name, email, affiliation, note, referredBy, orcid, resolution, actingUserSystemId,
}) {
  let request;
  try {
    request = await grantRequestAdapter.getById(requestId, {
      select: 'akoya_requestid,akoya_title,wmkf_meetingdate,_wmkf_programareaserved_value',
    });
  } catch {
    request = null;
  }
  if (!request?.akoya_requestid) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  const cycleCode = request.wmkf_meetingdate ? meetingDateToCycleCode(request.wmkf_meetingdate) : null;
  const programArea = request._wmkf_programareaserved_value_formatted || null;
  // Durable home of the referrer (D1: no new Dataverse field) — encode it in the
  // match reason staff already read on the suggestion/person rows.
  const matchReason = referredBy
    ? `Referred by ${referredBy}.${note ? ` ${note}` : ''}`
    : (note || 'Manually added by staff.');

  let selectedResolution = resolution;
  const lookup = await lookupReviewerIdentity({ name, email: email || null, affiliation: affiliation || null, orcid });
  if (!selectedResolution) {
    const auto = resolutionFromLookup(lookup);
    if (auto) {
      selectedResolution = auto;
    } else if (lookup.outcome === 'none') {
      selectedResolution = { mode: 'create_new' };
    } else {
      throw new ManualReviewerError(409, {
        error: 'Reviewer identity needs staff confirmation before adding.',
        code: lookup.outcome === 'conflict' ? lookup.reason : 'resolution_required',
        lookup,
      });
    }
  } else if (lookup.outcome === 'conflict' && selectedResolution.mode !== 'create_new') {
    throw conflictError(lookup.reason, lookup.details);
  } else if (lookup.outcome === 'candidates' && selectedResolution.mode !== 'create_new') {
    const ids = new Set((lookup.candidates || []).flatMap((c) => [c.reviewerId, c.contactId].filter(Boolean).map((id) => String(id).toLowerCase())));
    const chosenId = selectedResolution.mode === 'reuse_reviewer' ? selectedResolution.reviewerId : selectedResolution.contactId;
    if (!ids.has(String(chosenId || '').toLowerCase())) {
      throw new ManualReviewerError(409, { error: 'Selected reviewer/contact is stale or not in the current lookup candidates.', code: 'stale_resolution', lookup });
    }
  }

  let potentialReviewerId = null;
  let personCreated = false;
  let contactToLink = null;
  let contactRow = null;
  let responseEmail = email || null;
  let responseAffiliation = affiliation || null;
  let responseName = name;

  if (selectedResolution.mode === 'reuse_reviewer') {
    if (!selectedResolution.reviewerId) throw new ServiceHttpError('resolution.reviewerId is required for reuse_reviewer', { httpStatus: 400 });
    const reviewer = await potentialReviewerAdapter.getById(selectedResolution.reviewerId).catch(() => null);
    if (!reviewer?.wmkf_potentialreviewersid) throw new ManualReviewerError(409, { error: 'Selected reviewer no longer exists.', code: 'stale_resolution' });
    potentialReviewerId = reviewer.wmkf_potentialreviewersid;
    personCreated = false;
    contactToLink = selectedResolution.contactId || reviewer._wmkf_contact_value || null;
    if (contactToLink) {
      contactRow = await contactAdapter.getById(contactToLink).catch(() => null);
      if (!contactRow?.contactid) throw new ManualReviewerError(409, { error: 'Selected contact no longer exists.', code: 'stale_resolution' });
      if (reviewer._wmkf_contact_value && !sameId(reviewer._wmkf_contact_value, contactRow.contactid)) {
        throw conflictError('contact_linked_elsewhere', { reviewerId: potentialReviewerId, existingContactId: reviewer._wmkf_contact_value, contactId: contactRow.contactid });
      }
    }
  } else if (selectedResolution.mode === 'reuse_contact') {
    if (!selectedResolution.contactId) throw new ServiceHttpError('resolution.contactId is required for reuse_contact', { httpStatus: 400 });
    contactRow = await contactAdapter.getById(selectedResolution.contactId).catch(() => null);
    if (!contactRow?.contactid) throw new ManualReviewerError(409, { error: 'Selected contact no longer exists.', code: 'stale_resolution' });
    if (email && contactRow.emailaddress1 && !sameEmail(email, contactRow.emailaddress1)) {
      throw conflictError('email_mismatch', { contactId: contactRow.contactid, typedEmail: email, contactEmail: contactRow.emailaddress1 });
    }
    const orcidConflict = contactOrcidConflict(orcid, contactRow);
    if (orcidConflict) throw conflictError('orcid_mismatch', { contactId: contactRow.contactid, ...orcidConflict });

    const filledEmail = email || contactRow.emailaddress1 || null;
    responseEmail = filledEmail;
    responseName = name || contactName(contactRow);
    const created = await potentialReviewerAdapter.create({
      name: responseName,
      email: filledEmail,
      // S387: an address is created with its provenance, never leaving the later
      // researcher upsert as the only record of where it came from.
      emailSource: filledEmail ? 'manual' : undefined,
      affiliation: affiliation || null,
      whyChosen: matchReason,
    }, { actingUserSystemId });
    potentialReviewerId = created.id;
    personCreated = true;
    contactToLink = contactRow.contactid;
  } else {
    const created = await potentialReviewerAdapter.create({
      name,
      email: email || null,
      emailSource: email ? 'manual' : undefined, // S387: address + provenance together
      affiliation: affiliation || null,
      whyChosen: matchReason,
    }, { actingUserSystemId });
    potentialReviewerId = created.id;
    personCreated = true;
  }

  // Resolve the per-request candidate row FIRST, so the applicant-exclusion
  // gate fires before any identity-bearing enrichment write below. If this
  // reviewer is excluded for this request we return 409 without touching the
  // person's contact metadata (emailSource / ORCID). The person row created
  // above is acceptable on an excluded reviewer — they are a real human
  // and exclusion is per-request, not a global "never record" — but we stop
  // short of relabeling or filling contact identity for a row we're rejecting.
  // A referral persists `referred` alongside `staff_manual` so the provenance kind
  // survives a my-candidates reload (it was staff-entered AND referred). A plain
  // manual add stays `staff_manual` only.
  const sourceTokens = referredBy ? ['staff_manual', 'referred'] : ['staff_manual'];
  const suggestion = await reviewerSuggestionAdapter.ensureStaffManualCandidate({
    potentialReviewerId,
    requestId,
    suggestionLabel: request.akoya_title ? `${request.akoya_title} — ${name}` : null,
    grantCycleCode: cycleCode,
    programArea,
    matchReason,
    sources: sourceTokens,
  }, { actingUserSystemId });

  if (suggestion.skippedExcluded) {
    throw new ManualReviewerError(409, {
      error: 'This reviewer is excluded for this request and was not added.',
      code: 'applicant_excluded',
      suggestionId: suggestion.id,
    });
  }

  if (['promotion_required', 'restore_required', 'already_handled'].includes(suggestion.outcome)) {
    const remedy = suggestion.outcome === 'restore_required'
      ? 'Restore this previously declined reviewer from Removed.'
      : suggestion.outcome === 'already_handled'
        ? suggestion.stage === 'selected'
          ? 'Open Invite Reviewers to continue from the selected stage.'
          : 'Open Track Reviewers to continue from the current engagement stage.'
        : 'Promote this applicant-recommended reviewer from Find.';
    return {
      success: true,
      outcome: suggestion.outcome,
      suggestionId: suggestion.id,
      stage: suggestion.stage,
      remedy,
    };
  }

  // Fill-only contact/identity enrichment on the global person row. Both
  // emailSource and a staff-provided ORCID (looked up via /orcid-lookup or
  // typed) go through upsertByPotentialReviewer, which writes each field ONLY
  // when the existing value is empty. So staff input — lower-trust than a
  // reviewer self-report — never overwrites a resolver-sourced or
  // reviewer-attested (sticky `confirmed`) email source / ORCID, and
  // wmkf_identitystatus is never touched. Single round-trip.
  const contactOrcid = normalizeOrcid(contactRow?.wmkf_orcid);
  const carryOrcid = orcid || (contactOrcid.state === 'valid' ? contactOrcid.id : null);
  const carryOrcidUrl = carryOrcid ? `https://orcid.org/${carryOrcid}` : null;
  if (responseEmail || carryOrcid) {
    await researcherAdapter.upsertByPotentialReviewer(potentialReviewerId, {
      emailSource: responseEmail ? 'manual' : undefined,
      orcid: carryOrcid || undefined,
      orcidUrl: carryOrcidUrl || undefined,
    }, { actingUserSystemId });
  }

  if (contactToLink) {
    try {
      await potentialReviewerAdapter.setContactLink(potentialReviewerId, contactToLink, { actingUserSystemId });
    } catch (err) {
      // Typed-error translation for the adapter's structured link conflicts;
      // anything else propagates untyped for the shell's 500 mapping.
      if (err?.status === 409 || err?.code) {
        throw conflictError(err.code || 'contact_linked_elsewhere', err.details || { contactId: contactToLink, potentialReviewerId });
      }
      throw err;
    }
  }

  return {
    success: true,
    candidate: {
      suggestionId: suggestion.id,
      potentialReviewerId,
      contactId: contactToLink || null,
      name: responseName,
      email: responseEmail || null,
      affiliation: responseAffiliation || null,
      orcid: carryOrcid || null,
      orcidUrl: carryOrcidUrl,
      sources: sourceTokens,
      // `referredBy` + `provenanceKind` drive the client's provenance (kind `referred`,
      // selectable-with-verify, grounded-rank bonus, "Referred by X" card label).
      referredBy: referredBy || null,
      provenanceKind: referredBy ? 'referred' : undefined,
      manualAdded: true,
      applicantRecommended: false,
      invitable: !!responseEmail,
      reasoning: matchReason,
    },
    created: {
      person: personCreated,
      suggestion: suggestion.created,
    },
  };
}
