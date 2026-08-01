/**
 * Reviewer Finder — save-candidates service
 * (Route→Service Consolidation Plan, Stage 3 wave).
 *
 * Holds ALL business logic for POST /api/reviewer-finder/save-candidates;
 * the route is a thin shell (method dispatch, auth, input validation, DAL
 * context, HTTP mapping). Saves selected candidates to Dataverse for a
 * proposal: three adapters (potential reviewer → researcher overlay →
 * reviewer suggestion), keyed by email and request GUID.
 *
 * PARTIAL-SUCCESS SEMANTICS ARE THE CONTRACT (clients depend on the exact
 * shapes — plan wave-table warning):
 *   - per-candidate try/catch: one row's failure never aborts the batch;
 *   - identity-unresolved and institution-COI rows are REJECTED pre-write
 *     and accumulate rejectedUnresolved / rejectedInstitutionCOI /
 *     rejectedIneligible + errors;
 *   - ALL rejected (rejections == batch size) → SaveCandidatesError 422
 *     with the full explicit body (incl. all rejected counts, always);
 *   - nothing saved for other reasons → SaveCandidatesError 500 with the
 *     historical body (rejected* keys present only when non-zero);
 *   - otherwise the 200 payload, rejected-count and errors keys present ONLY when
 *     non-zero (undefined-valued keys are dropped by res.json, matching
 *     the historical serialization byte-for-byte).
 *
 * Contract (plan Decision 3): plain args, never req/res; throws
 * SaveCandidatesError (extends ServiceHttpError) with explicit `body` for
 * the non-`{ error }` 422/500 envelopes; unexpected failures propagate
 * untyped for the shell's timestamped 500; ASSUMES a trusted DAL context.
 */

import * as potentialReviewerAdapter from '../../dataverse/adapters/potential-reviewer';
import * as contactAdapter from '../../dataverse/adapters/contact';
import * as accountAdapter from '../../dataverse/adapters/account';
import * as researcherAdapter from '../../dataverse/adapters/researcher';
import * as reviewerSuggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import { DeduplicationService } from '../deduplication-service';
import { mayPersistIdentity, RESOLVER_SOURCED_FIELDS } from '../reviewer-identity-resolver';
import { lookupReviewerIdentity } from '../reviewer-identity-lookup';
import NotificationService from '../notification-service';
import { saveSourceListForCandidate, withReviewerProvenance, buildReviewerProvenance, isIdentityReviewExemptProvenance } from '../../utils/reviewer-provenance';
import { ContactParser } from '../../utils/contact-parser';
import {
  findIdentityConfirmation,
  findAddressTrustReceipt,
  findCandidatesByKeys,
  findEligibilityByCandidateKey,
  finalizeCandidatePromotion,
  markPromotionBlocked,
} from '../reviewer-roster-store';
import { verifyAutomatedIdentityAttestation } from '../reviewer-candidate-attestation';
import { manualConfirmationMatches } from '../../utils/reviewer-manual-confirmation';
import { projectReviewerContact } from '../../utils/reviewer-vetted-email';
import { ServiceHttpError } from '../service-http-error';
import { loadCoiContext } from '../reviewer-request-context';
import { CLIENT_ID_RE, reviewerSaveKey } from '../../utils/reviewer-save-key';
import { createInstitutionIdentityResolver } from '../institution-identity-resolver';
import { emailConfidence } from '../../utils/reviewer-invite';
import {
  createStaffVerifiedState,
  parseAddressTrustState,
  receiptCanResolveConflict,
} from '../../utils/reviewer-address-trust';
import { withRemediation } from '../../utils/reviewer-remediation';
import { translateDuplicateKeyError } from '../../dataverse/duplicate-key';

/**
 * Domain error carrying the exact non-`{ error }` JSON body the shell must
 * send (plan Decision 3, `body` set explicitly).
 */
export class SaveCandidatesError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'SaveCandidatesError';
  }
}

const PI_RESOLUTION_UNAVAILABLE_MESSAGE = 'Could not verify institution conflicts right now (PI institution lookup temporarily unavailable). Please retry.';
// The resolver and the discovery verifier use related but intentionally distinct
// vocabularies. `verified` is a valid top-level discovery result (for example,
// a PubMed full-name match), but it is NOT a resolver verdict and must not be
// accepted inside contactEnrichment.identity. Keep the validation boundaries
// separate so discovery candidates can be saved without broadening the resolver
// contract that gates identity-derived fields below.
const RESOLVER_IDENTITY_STATUSES = new Set(['confirmed', 'probable', 'ambiguous', 'unresolved', 'rejected']);
// Kept as a literal array so check:status-enum-parity can statically verify that
// every discovery VERIFICATION_STATUSES value remains accepted at this boundary.
const DISCOVERY_IDENTITY_STATUSES = ['unresolved', 'ambiguous', 'probable', 'verified'];
const CANDIDATE_IDENTITY_STATUSES = new Set([...RESOLVER_IDENTITY_STATUSES, ...DISCOVERY_IDENTITY_STATUSES]);
const ELIGIBILITY_STATUSES = new Set(['unknown', 'emeritus', 'deceased']);
const MAX_CANDIDATE_NAME_LENGTH = 500;
const MAX_CONTACT_ENRICHMENT_BYTES = 100000;
const MAX_IDENTITY_ANCHORS = 50;

export function validateCandidateInput(rawCandidate, index) {
  const candidateKey = reviewerSaveKey(rawCandidate);
  const name = typeof rawCandidate?.name === 'string' ? rawCandidate.name.trim() : '';
  const fail = (error) => ({
    ok: false,
    candidateKey,
    error: {
      name: name || null,
      candidateKey,
      index,
      code: 'invalid_candidate',
      error,
    },
  });

  if (!rawCandidate || typeof rawCandidate !== 'object' || Array.isArray(rawCandidate)) {
    return fail('Candidate must be an object.');
  }
  if (!name) return fail('Candidate name is required.');
  if (name.length > MAX_CANDIDATE_NAME_LENGTH) {
    return fail(`Candidate name exceeds ${MAX_CANDIDATE_NAME_LENGTH} characters.`);
  }
  if (rawCandidate.clientCandidateId !== undefined) {
    const clientId = typeof rawCandidate.clientCandidateId === 'string'
      ? rawCandidate.clientCandidateId.trim()
      : '';
    if (!CLIENT_ID_RE.test(clientId)) {
      return fail('clientCandidateId must be 1–128 letters, numbers, dots, underscores, colons, or hyphens.');
    }
  }
  if (rawCandidate.identityStatus !== undefined && !CANDIDATE_IDENTITY_STATUSES.has(rawCandidate.identityStatus)) {
    return fail('identityStatus is not supported.');
  }
  if (rawCandidate.eligibilityStatus !== undefined && !ELIGIBILITY_STATUSES.has(rawCandidate.eligibilityStatus)) {
    return fail('eligibilityStatus is not supported.');
  }
  if (
    rawCandidate.contactEnrichment !== undefined
    && (!rawCandidate.contactEnrichment
      || typeof rawCandidate.contactEnrichment !== 'object'
      || Array.isArray(rawCandidate.contactEnrichment))
  ) {
    return fail('contactEnrichment must be an object.');
  }
  if (rawCandidate.contactEnrichment) {
    const bytes = Buffer.byteLength(JSON.stringify(rawCandidate.contactEnrichment), 'utf8');
    if (bytes > MAX_CONTACT_ENRICHMENT_BYTES) {
      return fail(`contactEnrichment exceeds ${MAX_CONTACT_ENRICHMENT_BYTES} bytes.`);
    }
    const identity = rawCandidate.contactEnrichment.identity;
    if (identity != null) {
      if (typeof identity !== 'object' || Array.isArray(identity)) {
        return fail('contactEnrichment.identity must be an object.');
      }
      if (identity.status !== undefined && !RESOLVER_IDENTITY_STATUSES.has(identity.status)) {
        return fail('contactEnrichment.identity.status is not supported.');
      }
      if (identity.anchors !== undefined && (!Array.isArray(identity.anchors) || identity.anchors.length > MAX_IDENTITY_ANCHORS)) {
        return fail(`contactEnrichment.identity.anchors must contain at most ${MAX_IDENTITY_ANCHORS} entries.`);
      }
    }
    const eligibilityStatus = rawCandidate.contactEnrichment.eligibilityStatus;
    if (eligibilityStatus !== undefined && !ELIGIBILITY_STATUSES.has(eligibilityStatus)) {
      return fail('contactEnrichment.eligibilityStatus is not supported.');
    }
  }
  if (!candidateKey) return fail('Candidate could not be assigned a stable correlation key.');
  return { ok: true, candidateKey, candidate: { ...rawCandidate, name } };
}

function normalizeCoiContextLoadError(error) {
  if (error instanceof ServiceHttpError) return error;
  const statusCode = error?.statusCode;
  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
    const message = error.message || 'Reviewer request context is unavailable.';
    return new SaveCandidatesError(message, statusCode, { error: message });
  }
  return error;
}

// Slice E (server hard-reject): a candidate the system EXPLICITLY could not
// identity-resolve must NOT be persisted as a vetted reviewer (anchor-or-abstain at the
// persistence boundary). The clients hide these rows, but the standalone Reviewer Finder
// and any bypassed/direct caller can still POST them, so the field-level gate alone is
// insufficient — the server rejects the whole row (write neither person nor suggestion).
//
// Keyed on the EXPLICIT unresolved markers, NOT the broader
// `provenanceGroupOf === 'needs_identity_review'`. provenanceGroupOf also routes a
// BARRED/unknown-kind row with no positive identity to needs_identity_review, but such
// rows are LEGITIMATELY saved here from other paths (e.g. a contact-enriched person with
// a resolver verdict but no top-level identityStatus — see reviewer-route-identity-gate
// tests) with field-level gating, so gating on provenanceGroupOf would wrongly reject
// them. The client (FIND/Workbench select list) is intentionally stricter than this save
// gate: it hides ungrounded rows from selection; the save route accepts an
// explicitly-resolved-or-field-gated row.
function isUnresolvedIdentity(candidate) {
  // Exemption (S235): a cited-in-proposal / PI-named candidate (human/document-grounded — the
  // proposal author named this specific person) is NOT hard-rejected even when unresolved. It
  // reaches the later promotion projection so the UI receives the more specific
  // "keep for identity review" outcome. It no longer creates a name-only Invite row.
  // Only system-discovered unresolved rows are rejected at this earlier gate.
  if (isIdentityReviewExemptProvenance(buildReviewerProvenance(candidate).kind)) return false;
  return candidate?.needsIdentification === true
    || candidate?.identityStatus === 'unresolved'
    || candidate?.verificationStatus === 'unresolved';
}

function sameId(a, b) {
  return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function reviewerReuseAffiliation(row) {
  return row?.wmkf_primaryaffiliation || row?.wmkf_organizationname || null;
}

function shouldLinkMatchedContact(contactMatch) {
  return contactMatch?.outcome === 'confident'
    && !!contactMatch.match?.contactId
    && (contactMatch.match.matchKey === 'orcid' || contactMatch.match.matchKey === 'email');
}

function stableMatchedReviewerId(contactMatch) {
  if (
    contactMatch?.outcome !== 'confident'
    || contactMatch.match?.nameConsistent !== true
    || !contactMatch.match?.reviewerId
    || !['email', 'orcid'].includes(contactMatch.match?.matchKey)
  ) return null;
  return trimmedString(contactMatch.match.reviewerId) || null;
}

function addReviewerIdentity(identityMap, reviewerId, affiliation) {
  const id = trimmedString(reviewerId);
  if (!id) return;
  const key = id.toLowerCase();
  const aff = trimmedString(affiliation);
  const existing = identityMap.get(key);
  if (existing) {
    if (aff && !existing.affiliations.includes(aff)) existing.affiliations.push(aff);
    if (!trimmedString(existing.affiliation) && aff) existing.affiliation = aff;
    return;
  }
  identityMap.set(key, {
    reviewerId: id,
    affiliation: aff || null,
    affiliations: aff ? [aff] : [],
  });
}

async function resolveReviewerAffiliations(identityMap) {
  const affiliations = [];
  for (const { reviewerId, affiliations: inHandAffiliations = [] } of identityMap.values()) {
    if (inHandAffiliations.length > 0) {
      affiliations.push(...inHandAffiliations);
      continue;
    }

    let reviewer = null;
    try {
      reviewer = await potentialReviewerAdapter.getById(reviewerId);
    } catch (err) {
      return {
        affiliations,
        screeningFailure: {
          decisionSource: 'reviewer_identity_affiliation_lookup_failed',
          reviewerId,
          error: err,
        },
      };
    }
    if (!reviewer) {
      return {
        affiliations,
        screeningFailure: {
          decisionSource: 'reviewer_identity_affiliation_lookup_missing',
          reviewerId,
        },
      };
    }
    const trimmed = trimmedString(reviewerReuseAffiliation(reviewer));
    if (trimmed) affiliations.push(trimmed);
  }

  return { affiliations };
}

async function resolveMatchedContactInstitution(contactMatch) {
  const affiliations = [];
  const seen = new Set();
  for (const referenced of contactMatch?.referencedContacts || []) {
    if (referenced?.viaNameMatch) continue;
    const contactId = trimmedString(referenced?.contactId);
    if (!contactId) continue;
    const dedupeKey = contactId.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    let contact = null;
    try {
      contact = await contactAdapter.getInstitutionById(contactId);
    } catch (err) {
      return {
        affiliations,
        screeningFailure: {
          decisionSource: 'reviewer_contact_institution_lookup_failed',
          contactId,
          error: err,
        },
      };
    }

    const contactInstitution = trimmedString(contact?.adx_organizationname);
    if (contactInstitution) {
      affiliations.push(contactInstitution);
      continue;
    }

    const parentAccountId = trimmedString(contact?._parentcustomerid_value);
    if (!parentAccountId) continue;

    try {
      const parentAccount = await accountAdapter.getById(parentAccountId, { select: 'name' });
      const parentAccountName = trimmedString(parentAccount?.name);
      if (parentAccountName) affiliations.push(parentAccountName);
    } catch (err) {
      return {
        affiliations,
        screeningFailure: {
          decisionSource: 'reviewer_contact_institution_lookup_failed',
          contactId,
          accountId: parentAccountId,
          error: err,
        },
      };
    }
  }
  return { affiliations };
}

async function screenCandidateInstitutionCOI({
  candidate,
  contactMatch,
  candidateEmail,
  hasSeedAnchor,
  coiInstitutionEntries,
  institutionIdentityResolver,
}) {
  let existing = null;
  if (contactMatch === null) {
    return {
      existing,
      screeningFailure: {
        decisionSource: 'reviewer_identity_lookup_failed',
      },
    };
  }

  const identities = new Map();
  for (const referenced of contactMatch?.referencedReviewers || []) {
    // A name-only namesake is not the reuse/link target — persistence reuses by
    // email/ORCID/seed/link, never by a fallback name match. Screening its CRM
    // affiliation would hard-reject a distinct new reviewer merely for sharing a
    // name with someone at the applicant institution. The candidate's OWN claimed
    // affiliation (payload decision) and the actual getByEmail reuse target below
    // remain screened, so excluding weak namesakes cannot save a same-institution
    // reviewer that persistence would actually reuse.
    if (referenced?.viaNameMatch) continue;
    addReviewerIdentity(identities, referenced?.reviewerId, referenced?.affiliation);
  }

  if (!hasSeedAnchor && candidateEmail) {
    existing = await potentialReviewerAdapter.getByEmail(candidateEmail);
    if (existing) {
      const existingReviewerId = trimmedString(existing.wmkf_potentialreviewersid);
      if (!existingReviewerId) {
        return {
          existing,
          screeningFailure: {
            decisionSource: 'reviewer_identity_affiliation_lookup_missing',
          },
        };
      }
      addReviewerIdentity(identities, existingReviewerId, reviewerReuseAffiliation(existing));
    }
  }

  const resolved = await resolveReviewerAffiliations(identities);
  if (resolved.screeningFailure) return { existing, ...resolved };
  const contactInstitution = await resolveMatchedContactInstitution(contactMatch);
  if (contactInstitution.screeningFailure) return { existing, ...contactInstitution };
  const affiliations = [
    ...resolved.affiliations,
    ...contactInstitution.affiliations,
  ];

  const recomputed = await recomputeInstitutionCOI(
    candidate,
    coiInstitutionEntries,
    affiliations,
    institutionIdentityResolver,
  );
  return {
    existing,
    affiliations,
    recomputedInstitutionCOI: recomputed.decision,
    payloadInstitutionCOIRefuted: recomputed.payloadRefuted,
  };
}

async function recomputeInstitutionCOI(
  candidate,
  institutionEntries,
  serverAffiliations = [],
  institutionIdentityResolver,
) {
  const decisions = [];
  const payloadResolution = await DeduplicationService.institutionCOIResolution(
    candidate,
    institutionEntries,
    { resolver: institutionIdentityResolver },
  );
  const payloadDecision = payloadResolution.decision;
  // Only explicit, server-observed id contradictions suppress stale client
  // flags. A lexical non-match or provider abstention does not.
  const payloadRefuted = payloadResolution.status === 'refuted_by_existing_ids'
    || payloadResolution.status === 'refuted_by_resolved_ids';
  if (payloadDecision) decisions.push({ ...payloadDecision, decisionSource: 'candidate_payload' });

  for (const serverAffiliation of serverAffiliations) {
    if (!serverAffiliation) continue;
    const serverAffiliationDecision = await DeduplicationService.institutionCOIDecisionResolved(
      {
        ...candidate,
        affiliation: serverAffiliation,
        affiliationSource: 'staff_manual',
        primaryAffiliation: serverAffiliation,
        primaryAffiliationSource: 'staff_manual',
        contactEnrichment: {
          ...(candidate.contactEnrichment || {}),
          affiliation: serverAffiliation,
          affiliationSource: 'staff_manual',
        },
      },
      institutionEntries,
      { resolver: institutionIdentityResolver },
    );
    if (serverAffiliationDecision) {
      decisions.push({
        ...serverAffiliationDecision,
        decisionSource: 'server_reviewer_identity_affiliation',
      });
    }
  }
  // A direct shared campus always outranks a Broad/HHMI exemption. This closes
  // the complement where a payload says "Broad" but the reused CRM reviewer is
  // directly at the PI's MIT/Harvard institution.
  return {
    decision: decisions.find((decision) => decision.dropDecision !== 'exempt')
      || decisions.find((decision) => decision.dropDecision === 'exempt')
      || null,
    payloadRefuted,
  };
}

function buildInstitutionCoiError(candidate, {
  error = 'Candidate is at the proposal PI’s institution (institution COI); not saved.',
  recomputedInstitutionCOI = null,
  decisionSource = null,
  candidateKey = null,
  index = null,
} = {}) {
  const institutionCoiError = {
    name: candidate.name,
    candidateKey,
    index,
    error,
    code: 'institution_coi',
  };
  if (recomputedInstitutionCOI) {
    institutionCoiError.serverRecomputed = true;
    institutionCoiError.decisionSource = recomputedInstitutionCOI.decisionSource;
    institutionCoiError.institutionCOIDetails = recomputedInstitutionCOI.candidate?.institutionCOIDetails || null;
  } else if (decisionSource) {
    institutionCoiError.serverRecomputed = true;
    institutionCoiError.decisionSource = decisionSource;
  }
  return institutionCoiError;
}

function promotionResults(savedResults, errors) {
  const withheldCodes = new Set([
    'identity_unresolved',
    'identity_confirmation_required',
    'identity_attestation_required',
    'missing_verified_email',
  ]);
  return [
    ...savedResults,
    ...errors.map((error) => withRemediation({
      ...error,
      outcome: error.outcome || (withheldCodes.has(error.code) ? 'withheld' : 'failed'),
      code: error.code || 'candidate_save_failed',
    })),
  ].sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER));
}

function actionableErrors(errors) {
  return errors.map((error) => withRemediation(error));
}

const APPLICANT_REVIEWER_SLOT_FIELDS = [1, 2, 3, 4, 5]
  .map((slot) => `_wmkf_potentialreviewer${slot}_value`);

/**
 * Delete only the exact person created by this promotion attempt, and only
 * after fresh reads prove it is still unreferenced. Any uncertainty is a
 * fail-closed abstention; the caller alerts with the exact orphan ID.
 */
async function compensateNewPotentialReviewer(
  potentialReviewerId,
  { actingUserSystemId } = {},
) {
  const slotFilter = APPLICANT_REVIEWER_SLOT_FIELDS
    .map((field) => `${field} eq ${potentialReviewerId}`)
    .join(' or ');
  const [person, suggestions, slotRefs] = await Promise.all([
    potentialReviewerAdapter.getByIdForMerge(potentialReviewerId),
    reviewerSuggestionAdapter.findAllByPotentialReviewer(potentialReviewerId),
    grantRequestAdapter.queryAllRequests({
      select: ['akoya_requestid', ...APPLICANT_REVIEWER_SLOT_FIELDS].join(','),
      filter: slotFilter,
    }),
  ]);

  if (!person) return { compensated: true, reason: 'already_absent' };
  if (!person._etag) return { compensated: false, reason: 'missing_person_etag' };
  if (person._wmkf_contact_value) return { compensated: false, reason: 'contact_reference' };
  if (Array.isArray(suggestions) && suggestions.length > 0) {
    return { compensated: false, reason: 'suggestion_reference' };
  }
  if (slotRefs?.capped) return { compensated: false, reason: 'applicant_slot_scan_capped' };
  if (Array.isArray(slotRefs?.records) && slotRefs.records.length > 0) {
    return { compensated: false, reason: 'applicant_slot_reference' };
  }

  await potentialReviewerAdapter.deleteExactNew(potentialReviewerId, {
    actingUserSystemId,
    ifMatch: person._etag,
  });
  return { compensated: true, reason: 'deleted_unreferenced_new_person' };
}

async function alertFailedPersonCompensation({
  requestId,
  candidateName,
  candidateKey,
  potentialReviewerId,
  failure,
  compensation,
}) {
  try {
    await NotificationService.notify({
      type: 'reviewer_person_compensation_failed',
      severity: 'warning',
      title: 'New reviewer person may require cleanup',
      message: `A newly-created reviewer person could not be safely compensated after promotion failed for request ${requestId}.`,
      metadata: {
        requestId,
        candidateName: candidateName || null,
        candidateKey,
        potentialReviewerId,
        promotionFailure: failure?.message || String(failure || 'unknown'),
        compensationReason: compensation?.reason || 'compensation_failed',
        compensationError: compensation?.error || null,
      },
      source: 'reviewer-finder/save-candidates',
      category: 'reviewers',
      autoResolveKey: `reviewer-person-compensation:${potentialReviewerId}`,
    });
  } catch (notifyErr) {
    console.warn('[save-candidates] person compensation alert failed (non-fatal):', notifyErr?.message || notifyErr);
  }
}

async function resolveValidatedReferredSeedAnchor(candidate, enrichment) {
  const provenance = buildReviewerProvenance(candidate);
  if (provenance.kind !== 'referred') return null;
  const potentialReviewerId = typeof candidate.seedResolvedPotentialReviewerId === 'string'
    ? candidate.seedResolvedPotentialReviewerId.trim()
    : '';
  if (!potentialReviewerId) return null;

  const email = candidate.email || enrichment?.email || null;
  const orcid = candidate.orcid || enrichment?.orcidId || enrichment?.orcid || null;
  if (!email && !orcid) return null;

  let current = null;
  try {
    current = await potentialReviewerAdapter.getById(potentialReviewerId);
  } catch {
    return null;
  }
  if (!current) return null;

  const lookup = await lookupReviewerIdentity({
    name: candidate.name,
    email,
    orcid,
  });
  if (
    lookup?.outcome === 'confident'
    && sameId(lookup.match?.reviewerId, potentialReviewerId)
    && (lookup.match?.matchKey === 'email' || lookup.match?.matchKey === 'orcid')
  ) {
    return {
      potentialReviewerId,
      contactId: lookup.match?.contactId || current._wmkf_contact_value || null,
      lookup,
    };
  }
  return null;
}

/**
 * Save a batch of selected reviewer candidates for a request.
 *
 * @param {Object} args - proposalTitle, programArea, requestId, grantCycleCode,
 *   candidates[], summaryBlobUrl (shell validated requestId + non-empty array),
 *   actingUserSystemId
 * @returns {Promise<Object>} the exact 200 payload (conditional rejected-count and errors keys)
 * @throws {SaveCandidatesError} 422 all-rejected / 500 nothing-saved, explicit bodies
 */
export async function saveCandidates({
  proposalTitle,
  programArea,
  requestId,
  grantCycleCode,
  candidates,
  summaryBlobUrl,
  actingUserSystemId,
}) {
  let savedCount = 0;
  let rejectedUnresolved = 0;
  let rejectedInstitutionCOI = 0;
  let rejectedIneligible = 0;
  let rejectedInvalid = 0;
  let rejectedMissingEmail = 0;
  let rejectedExcluded = 0;
  const errors = [];
  const savedResults = [];
  // The exact display names that saved successfully — the client flips ONLY
  // these to status='saved' in the Find-tab roster (S224), so a partial-failure
  // save never marks a failed row saved.
  const savedNames = [];
  const savedKeys = [];
  const seenCandidateKeys = new Set();
  let coiContext;
  try {
    coiContext = await loadCoiContext(requestId, {
      includeCoPIs: false,
      requireCompleteInstitutions: true,
    });
  } catch (error) {
    throw normalizeCoiContextLoadError(error);
  }
  const coiInstitutionEntries = Array.isArray(coiContext.institutionEntries)
    ? coiContext.institutionEntries
    : [];
  const piResolution = coiContext.piResolution || { state: 'ok', reason: null };
  if (piResolution.state === 'failed') {
    throw new SaveCandidatesError(PI_RESOLUTION_UNAVAILABLE_MESSAGE, 503, {
      error: PI_RESOLUTION_UNAVAILABLE_MESSAGE,
      code: 'pi_institution_lookup_unavailable',
      retryable: true,
      reason: piResolution.reason || 'pi_resolve_failed',
      requestId,
    });
  }
  const institutionIdentityResolver = createInstitutionIdentityResolver();

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const rawCandidate = candidates[candidateIndex];
    const validation = validateCandidateInput(rawCandidate, candidateIndex);
    if (!validation.ok) {
      rejectedInvalid += 1;
      errors.push(validation.error);
      continue;
    }
    if (seenCandidateKeys.has(validation.candidateKey)) {
      rejectedInvalid += 1;
      errors.push({
        name: validation.candidate.name,
        candidateKey: validation.candidateKey,
        index: candidateIndex,
        code: 'invalid_candidate',
        error: 'Duplicate candidate correlation key in this save request.',
      });
      continue;
    }
    seenCandidateKeys.add(validation.candidateKey);
    let newlyCreatedPotentialReviewerId = null;
    try {
      const candidate = withReviewerProvenance(validation.candidate);

      // PD identity override: the browser carries only an opaque confirmation id.
      // Authority comes from the exact request-scoped server roster record created
      // by the authenticated confirm_identity action, never from the boolean flag.
      // An authenticated PD asserts the resolved
      // person is correct and supplies hand-typed contact. This skips the identity
      // hard-reject below AND the resolver-derived contact/bibliometric gates further
      // down — but ONLY persists the PD's manual email/website/affiliation; ORCID /
      // Scholar / metrics from the (unconfirmed) auto-resolver are force-nulled, never
      // blessed. Institution-COI is still enforced (identity confirmation ≠ COI waiver).
      const requestedPdConfirmation = rawCandidate?.pdIdentityConfirmed === true
        || !!rawCandidate?.pdIdentityConfirmationId;
      let pdConfirmed = false;
      let staffConfirmedRosterCandidateKey = null;
      if (requestedPdConfirmation) {
        const confirmationId = typeof rawCandidate?.pdIdentityConfirmationId === 'string'
          ? rawCandidate.pdIdentityConfirmationId
          : '';
        const storedConfirmation = confirmationId
          ? await findIdentityConfirmation(requestId, confirmationId)
          : null;
        pdConfirmed = manualConfirmationMatches(storedConfirmation, candidate);
        staffConfirmedRosterCandidateKey = pdConfirmed
          && typeof storedConfirmation?.rosterCandidateKey === 'string'
          ? storedConfirmation.rosterCandidateKey.trim()
          : null;
        if (!pdConfirmed) {
          rejectedInvalid += 1;
          errors.push({
            name: candidate.name,
            candidateKey: validation.candidateKey,
            index: candidateIndex,
            code: 'invalid_candidate',
            error: 'Staff identity confirmation is missing, stale, or does not match this candidate.',
          });
          continue;
        }
      }

      // Automated resolver fields need a server-signed receipt bound to this
      // request and exact identity bundle. Unsigned client statuses may tighten
      // the gate below, but can never grant ORCID/Scholar/metrics persistence.
      const automatedIdentityReceipt = await verifyAutomatedIdentityAttestation(
        rawCandidate?.automatedIdentityAttestation,
        { requestId, candidate },
      );

      const candidateEligibilityStatus = candidate.eligibilityStatus
        || candidate.contactEnrichment?.eligibilityStatus
        || 'unknown';
      if (
        candidateEligibilityStatus === 'deceased'
        || automatedIdentityReceipt.eligibilityStatus === 'deceased'
      ) {
        rejectedIneligible += 1;
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: 'Official institutional evidence reports this candidate is deceased; not saved.',
          code: 'candidate_ineligible',
        });
        continue;
      }

      // New Find-tab rows are roster-managed and must carry either a valid
      // automated receipt or a request-scoped stored staff confirmation that
      // binds the immutable roster key. Without one, mutable email/affiliation
      // fields could redirect the durable eligibility lookup.
      // Bare legacy payloads without an explicit roster key or automated
      // receipt keep the pre-roster compatibility path. Use the raw payload
      // here: validation derives a correlation key for every candidate, so the
      // normalized candidate cannot distinguish old callers from roster rows.
      const submittedRosterCandidateKey = typeof rawCandidate?.candidateKey === 'string'
        ? rawCandidate.candidateKey.trim()
        : '';
      const rosterManaged = !!submittedRosterCandidateKey
        || typeof rawCandidate?.automatedIdentityAttestation === 'string';
      const automatedRosterCandidateKey = automatedIdentityReceipt.valid
        && automatedIdentityReceipt.rosterCandidateKey
        ? automatedIdentityReceipt.rosterCandidateKey
        : null;
      if (
        staffConfirmedRosterCandidateKey
        && automatedRosterCandidateKey
        && staffConfirmedRosterCandidateKey !== automatedRosterCandidateKey
      ) {
        rejectedInvalid += 1;
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: 'Staff confirmation and automated verification refer to different roster candidates.',
          code: 'invalid_candidate',
        });
        continue;
      }
      if (
        rosterManaged
        && !staffConfirmedRosterCandidateKey
        && !automatedRosterCandidateKey
      ) {
        rejectedUnresolved += 1;
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: 'Candidate verification has expired or is incomplete; rerun contact enrichment before saving.',
          code: 'identity_attestation_required',
        });
        continue;
      }
      // Keep the save-correlation key (`validation.candidateKey`) in response
      // rows so the browser can reconcile the exact selection it submitted,
      // but use only the receipt-bound immutable roster key for durable roster
      // transitions. Legacy non-roster callers continue to use their derived
      // save key because they have no pre-existing roster row to transition.
      const authoritativeRosterCandidateKey = rosterManaged
        ? (staffConfirmedRosterCandidateKey || automatedRosterCandidateKey)
        : validation.candidateKey;

      if (rosterManaged) {
        let authoritativeRosterCandidate;
        try {
          [authoritativeRosterCandidate] = await findCandidatesByKeys(
            requestId,
            [authoritativeRosterCandidateKey],
          );
        } catch (rosterError) {
          rejectedUnresolved += 1;
          errors.push({
            name: candidate.name,
            candidateKey: validation.candidateKey,
            index: candidateIndex,
            error: 'Could not verify the current reviewer address state. Retry the check before promoting.',
            code: 'identity_unavailable',
            outcome: 'withheld',
          });
          continue;
        }
        if (!authoritativeRosterCandidate) {
          rejectedUnresolved += 1;
          errors.push({
            name: candidate.name,
            candidateKey: validation.candidateKey,
            index: candidateIndex,
            error: 'The authoritative reviewer card is no longer available. Rerun contact enrichment before promoting.',
            code: 'identity_attestation_required',
            outcome: 'withheld',
          });
          continue;
        }
        if (authoritativeRosterCandidate.conflictRecordUnavailable === true) {
          rejectedUnresolved += 1;
          errors.push({
            name: candidate.name,
            candidateKey: validation.candidateKey,
            index: candidateIndex,
            error: 'The reviewer address conflict was not recorded. Retry the check or create a repair request before promoting.',
            code: 'conflict_record_unavailable',
            outcome: 'withheld',
          });
          continue;
        }
      }

      let storedEligibility = null;
      try {
        storedEligibility = await findEligibilityByCandidateKey(
          requestId,
          authoritativeRosterCandidateKey,
        );
      } catch (eligibilityError) {
        console.warn('[save-candidates] roster eligibility lookup failed (fail-open):', eligibilityError?.message || eligibilityError);
      }
      const isDeceased = storedEligibility?.rosterStatus === 'ineligible'
        || storedEligibility?.eligibilityStatus === 'deceased';
      if (isDeceased) {
        rejectedIneligible += 1;
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: 'Official institutional evidence reports this candidate is deceased; not saved.',
          code: 'candidate_ineligible',
        });
        continue;
      }

      // Slice E hard-reject: never persist a candidate whose identity is unresolved.
      // Skip BEFORE any adapter write (neither person nor suggestion) and record it
      // so a partial batch (mixed resolved/unresolved) still saves the resolved rows.
      // The PD override (above) is the one sanctioned bypass of this gate.
      if (!pdConfirmed && isUnresolvedIdentity(candidate)) {
        rejectedUnresolved += 1;
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: 'Candidate identity is unresolved (needs identity review); not saved.',
          code: 'identity_unresolved',
          outcome: 'withheld',
        });
        continue;
      }

      const normalizedName = candidate.name
        .toLowerCase()
        .replace(/^(dr\.?|prof\.?|professor)\s+/i, '')
        .replace(/[^a-z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const enrichment = candidate.contactEnrichment || {};
      let validatedSeedAnchor = null;
      if (!pdConfirmed) {
        try {
          validatedSeedAnchor = await resolveValidatedReferredSeedAnchor(candidate, enrichment);
        } catch (anchorErr) {
          console.warn('[save-candidates] referred seed anchor validation failed (non-fatal):', anchorErr?.message || anchorErr);
        }
      }
      // Promotion is stricter than roster retention. Compute the exact contact
      // projection before ANY person/suggestion write: unresolved cited/proposal/
      // referred rows remain in Find rather than silently becoming name-only Invite
      // rows. A validated referred seed may satisfy identity through its exact
      // email/ORCID anchor; staff confirmation remains exact-value/manual.
      const contactProjection = projectReviewerContact(candidate, {
        staffConfirmed: pdConfirmed,
        identityConfirmed: !!validatedSeedAnchor
          || (
            automatedIdentityReceipt.valid === true
            && automatedIdentityReceipt.identityDecisionBound === true
          ),
      });

      const candidateEmailSource = contactProjection.emailSource;
      const websiteAllowed = contactProjection.websitePersistAllowed === true;
      const candidateEmail = contactProjection.email;
      const candidateAffiliation = contactProjection.affiliationPersistAllowed === true
        ? contactProjection.affiliation
        : null;
      // Enrichment stores the ORCID iD as `orcidId` (not `orcid`); read that key
      // so a candidate carrying only contactEnrichment doesn't drop a real ORCID.
      const candidateOrcid = candidate.orcid || enrichment.orcidId || null;
      const candidateGoogleScholarId = candidate.googleScholarId || enrichment.googleScholarId || null;
      const rawCandidateWebsite = websiteAllowed ? (pdConfirmed ? (candidate.website || null) : (candidate.website || enrichment.website || null)) : null;
      const candidateWebsite = ContactParser.sanitizeWebsiteForCandidate(rawCandidateWebsite, candidate.name);
      const rawCandidateFacultyPageUrl = (websiteAllowed && !pdConfirmed) ? (candidate.facultyPageUrl || enrichment.facultyPageUrl || null) : null;
      const candidateFacultyPageUrl = rawCandidateFacultyPageUrl && !ContactParser.isDocumentUrl(rawCandidateFacultyPageUrl) ? rawCandidateFacultyPageUrl : null;

      const expertiseForDv = Array.isArray(candidate.expertiseAreas)
        ? candidate.expertiseAreas.filter(Boolean).join('; ')
        : (candidate.expertise || null);

      const sources = saveSourceListForCandidate(candidate);
      if (sources.length === 0) sources.push('unknown');

      // Persist the recency-weighted relevance score (0–100), attached by
      // rankByRelevance at /discover + the Workbench re-rank. Prefer it over
      // the 0–1 verificationConfidence so `wmkf_relevancescore` reflects the
      // recency ranking for verified (Track A) candidates too — previously
      // Track A stored verificationConfidence (0–1) while Track B stored
      // relevanceScore (0–100), mixing scales in one field (S223). isFinite so
      // a legitimate 0 (dormant candidate) is kept; verificationConfidence is
      // the fallback only when no rank score is present.
      const relevanceScore = Number.isFinite(candidate.relevanceScore)
        ? candidate.relevanceScore
        : (candidate.verificationConfidence || 0.5);

      // The S240/F2 save gate below rejects same-institution rows before any
      // write, so no institution-COI annotation is appended to persisted reasoning.
      let matchReason = candidate.reasoning || candidate.generatedReasoning || '';
      if (pdConfirmed) {
        // Audit trail: this row entered the pool on a PD's explicit identity
        // confirmation, not the auto-resolver. Visible in the candidate's "Why".
        matchReason += ' [Identity confirmed by PD; contact entered manually]';
      }
      if (candidate.hasCoauthorCOI) {
        matchReason += candidate.coauthorCOIStrength === 'possible'
          ? ' [Possible coauthor overlap: shared paper(s) with proposal author(s) — may be incidental]'
          : ' [Coauthor COI: Has co-authored with proposal authors]';
      }

      // Identity gate (Phase 2 — REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md).
      // The resolver's verdict (attached to contactEnrichment.identity) is the
      // gate: bibliometrics/ORCID persist only when status ∈ {confirmed,probable}.
      //   - blockByIdentity: resolver verdict below probable → block ALL
      //     resolver-sourced fields (scholar id/url, metrics, ORCID id/url).
      //   - scholarSkipped: Phase-1 fallback when no resolver verdict is present
      //     (enrichment didn't run) — blocks the scholar id/url + metrics only.
      // Passing null is a safe no-op in the adapter (pruneEmpty drops it); a true
      // downgrade additionally CLEARS any stale value below via clearIdentityFields.
      const scholarSkipped = !!enrichment.tierResults?.openalex_author?.skipped;
      const identity = enrichment.identity || null;
      // A candidate loaded from the durable Find-tab roster has had its
      // identity/tierResults pruned away, but `pruneCandidateForRoster` left
      // safe boolean persist flags so the gate still holds after a reload
      // (Codex post-impl HIGH). `=== false` so they only ever TIGHTEN the gate,
      // never loosen it for fresh (full-object) candidates that lack the flags.
      // PD-confirmed rows force ALL resolver-sourced identity fields null: the PD
      // vouched for WHO the person is + supplied contact, but the auto-fetched ORCID/
      // Scholar/metrics were never identity-confirmed and may belong to a namesake.
      const identityReceiptTrusted = automatedIdentityReceipt.valid || !!validatedSeedAnchor;
      const blockByIdentity = pdConfirmed
        || !identityReceiptTrusted
        || (!!identity && !mayPersistIdentity(identity.status))
        || candidate.identityPersistAllowed === false;
      const blockScholar = pdConfirmed || scholarSkipped || blockByIdentity
        || candidate.scholarPersistAllowed === false;
      const gatedExpertiseForDv = blockByIdentity ? null : expertiseForDv;
      const effectiveLookupOrcid = (pdConfirmed || blockByIdentity) ? null : candidateOrcid;

      let contactMatch = validatedSeedAnchor?.lookup || null;
      try {
        if (!contactMatch) {
          contactMatch = await lookupReviewerIdentity({
            name: candidate.name,
            email: candidateEmail || null,
            orcid: effectiveLookupOrcid || null,
          }) || null;
        }
      } catch (lookupErr) {
        console.warn('[save-candidates] reviewer identity lookup failed:', lookupErr?.message || lookupErr);
      }

      if (
        rosterManaged
        && !pdConfirmed
        && (contactMatch?.outcome === 'conflict' || contactMatch?.outcome === 'candidates')
      ) {
        rejectedUnresolved += 1;
        const lookupCode = contactMatch.outcome === 'conflict'
          ? (contactMatch.reason || 'identity_confirmation_required')
          : 'ambiguous_or_name_mismatch';
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: 'Dataverse identity evidence conflicts or is ambiguous. Review and confirm the exact person and address before promoting.',
          code: lookupCode,
          outcome: 'withheld',
          decision: 'identity_choice_required',
        });
        continue;
      }

      // S240/F2: current same-institution is a HARD policy conflict at save. Discovery
      // hard-drops by default but Phase C can surface a contradicted low-trust match
      // as a read-only flag; post-enrichment can also promote a current affiliation
      // that matches a PI institution. Reject any direct institution COI here — the
      // authoritative gate — even if a stale client selected it. Owner-approved
      // Broad/HHMI-only overlap stays visible but is explicitly exempt from hard reject.
      // The server recomputes against trusted applicant/PI institution context and
      // against the CRM affiliation of the reviewer persistence will REUSE — from the
      // single server reuse read threaded into upsertByEmail below — before any
      // potential-reviewer/researcher/suggestion write.
      const enrichmentInstitutionCOI = candidate.contactEnrichment?.coiRecomputed
        && !!candidate.contactEnrichment?.hasInstitutionCOI;
      const institutionCoiScreen = await screenCandidateInstitutionCOI({
        candidate,
        contactMatch,
        candidateEmail,
        hasSeedAnchor: !!validatedSeedAnchor,
        coiInstitutionEntries,
        institutionIdentityResolver,
      });
      if (institutionCoiScreen.screeningFailure) {
        console.warn('[save-candidates] reviewer_identity_affiliation_screening_failed', {
          requestId,
          candidateName: candidate.name || null,
          decisionSource: institutionCoiScreen.screeningFailure.decisionSource,
          reviewerId: institutionCoiScreen.screeningFailure.reviewerId || null,
          error: institutionCoiScreen.screeningFailure.error?.message || institutionCoiScreen.screeningFailure.error || null,
        });
        rejectedInstitutionCOI += 1;
        errors.push(buildInstitutionCoiError(candidate, {
          error: 'Candidate reviewer identity could not be screened for institution COI; not saved.',
          decisionSource: institutionCoiScreen.screeningFailure.decisionSource,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
        }));
        continue;
      }
      const recomputedInstitutionCOI = institutionCoiScreen.recomputedInstitutionCOI;
      const institutionCoiExempt = recomputedInstitutionCOI?.dropDecision === 'exempt';
      const staleClientCoiRefuted = institutionCoiScreen.payloadInstitutionCOIRefuted === true
        && !recomputedInstitutionCOI;
      if (recomputedInstitutionCOI && !institutionCoiExempt) {
        console.warn('[save-candidates] server_recomputed_institution_coi_rejected', {
          requestId,
          candidateName: candidate.name || null,
          decisionSource: recomputedInstitutionCOI.decisionSource,
          applicantInstitutionContextState: coiContext.applicantInstitutionContext?.state || null,
          dropDecision: recomputedInstitutionCOI.dropDecision || null,
          reviewerInstitution: recomputedInstitutionCOI.candidate?.institutionCOIDetails?.reviewerInstitution || null,
          piInstitution: recomputedInstitutionCOI.candidate?.institutionCOIDetails?.piInstitution || null,
        });
      }
      if (!institutionCoiExempt && (
        (!staleClientCoiRefuted && (
          candidate.hasInstitutionCOI
          || enrichmentInstitutionCOI
        ))
        || recomputedInstitutionCOI
      )) {
        rejectedInstitutionCOI += 1;
        errors.push(buildInstitutionCoiError(candidate, {
          recomputedInstitutionCOI,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
        }));
        continue;
      }

      if (contactProjection?.decision !== 'ready') {
        const missingEmail = contactProjection?.decision === 'missing_email';
        if (missingEmail) rejectedMissingEmail += 1;
        else rejectedUnresolved += 1;
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: missingEmail
            ? 'Candidate does not have an authoritative email; add or verify one before promoting.'
            : 'Candidate needs identity confirmation before promoting to Invite.',
          code: missingEmail ? 'missing_verified_email' : 'identity_confirmation_required',
          outcome: 'withheld',
          decision: contactProjection?.decision || 'needs_identity_confirmation',
          reason: contactProjection?.reason || 'contact_projection_unavailable',
        });
        continue;
      }
      if (
        rosterManaged
        && !pdConfirmed
        && !validatedSeedAnchor
        && automatedIdentityReceipt.contactAuthorityBound !== true
      ) {
        rejectedUnresolved += 1;
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: 'Contact verification predates the current promotion contract; rerun contact enrichment before promoting.',
          code: 'identity_attestation_required',
          outcome: 'withheld',
          decision: 'needs_identity_confirmation',
          reason: 'contact_attestation_required',
        });
        continue;
      }


      const addressReadiness = emailConfidence({
        email: candidateEmail,
        emailSource: candidateEmailSource,
      });
      const stablePotentialReviewerId = validatedSeedAnchor?.potentialReviewerId
        || stableMatchedReviewerId(contactMatch);
      const existingPersonForTrust = stablePotentialReviewerId
        ? await potentialReviewerAdapter.getById(stablePotentialReviewerId)
        : institutionCoiScreen.existing;
      if (existingPersonForTrust?.statecode !== undefined && existingPersonForTrust.statecode !== 0) {
        rejectedUnresolved += 1;
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: 'The exact reviewer person is inactive and must be repaired or replaced before promotion.',
          code: 'person_inactive',
          outcome: 'withheld',
          decision: 'identity_choice_required',
        });
        continue;
      }
      const existingTrustDecision = emailConfidence(existingPersonForTrust || {}).action;
      const normalizedCandidateEmail = typeof candidateEmail === 'string'
        ? candidateEmail.trim().toLowerCase()
        : '';
      const normalizedStoredEmail = typeof existingPersonForTrust?.wmkf_emailaddress === 'string'
        ? existingPersonForTrust.wmkf_emailaddress.trim().toLowerCase()
        : '';
      const stablePersonAddressChanged = !!stablePotentialReviewerId
        && !!normalizedCandidateEmail
        && normalizedCandidateEmail !== normalizedStoredEmail;
      const needsExactStaffAttestation = rosterManaged
        && (
          addressReadiness.action === 'quick_check'
          || addressReadiness.action === 'research_only'
          || existingTrustDecision === 'blocked'
          || stablePersonAddressChanged
        );
      let addressTrustReceipt = null;
      if (needsExactStaffAttestation) {
        try {
          addressTrustReceipt = await findAddressTrustReceipt(
            requestId,
            authoritativeRosterCandidateKey,
          );
        } catch (receiptError) {
          rejectedUnresolved += 1;
          errors.push({
            name: candidate.name,
            candidateKey: validation.candidateKey,
            index: candidateIndex,
            error: 'Could not verify the saved address attestation. Retry the check before promoting.',
            code: 'identity_unavailable',
            outcome: 'withheld',
          });
          continue;
        }
      }
      const normalizedReceiptEmail = typeof addressTrustReceipt?.email === 'string'
        ? addressTrustReceipt.email.trim().toLowerCase()
        : '';
      if (needsExactStaffAttestation && (
        !addressTrustReceipt?.receiptId
        || addressTrustReceipt.personConfirmed !== true
        || normalizedReceiptEmail !== normalizedCandidateEmail
      )) {
        rejectedUnresolved += 1;
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: 'Verify this exact address from the Find card before promoting the reviewer.',
          code: 'address_verification_required',
          outcome: 'withheld',
          decision: 'needs_address_verification',
          reason: addressReadiness.action,
        });
        continue;
      }

      const initialTrustState = parseAddressTrustState(
        existingPersonForTrust?.wmkf_addresstruststatejson,
        { storedEmail: existingPersonForTrust?.wmkf_emailaddress },
      );
      if (
        initialTrustState.valid
        && initialTrustState.state.status === 'conflict_pending'
        && !receiptCanResolveConflict(addressTrustReceipt, initialTrustState.state.conflict)
      ) {
        rejectedUnresolved += 1;
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: 'The saved verification predates the current address conflict. Review both addresses again.',
          code: 'address_verification_required',
          outcome: 'withheld',
          decision: 'needs_address_verification',
          reason: 'stale_address_attestation',
        });
        continue;
      }

      let addressTrustStateJson;
      let persistedEmailSource = candidateEmailSource;
      const buildAddressTrustBundle = (currentPerson) => {
        let resolution = null;
        const currentTrust = parseAddressTrustState(
          currentPerson?.wmkf_addresstruststatejson,
          { storedEmail: currentPerson?.wmkf_emailaddress },
        );
        if (currentTrust.valid && currentTrust.state.status === 'conflict_pending') {
          const allowed = new Set([
            currentTrust.state.conflict.storedEmail,
            currentTrust.state.conflict.foundEmail,
          ]);
          if (!allowed.has(normalizedCandidateEmail)) {
            throw Object.assign(new Error('The address conflict changed; review both addresses again.'), {
              code: 'address_verification_required',
            });
          }
          if (!receiptCanResolveConflict(addressTrustReceipt, currentTrust.state.conflict)) {
            throw Object.assign(new Error('The address verification predates the current conflict.'), {
              code: 'address_verification_required',
            });
          }
          resolution = {
            conflict: currentTrust.state.conflict,
            decision: normalizedCandidateEmail === currentTrust.state.email ? 'keep_stored' : 'use_found',
            actorProfileId: addressTrustReceipt.actorProfileId || null,
            actorSystemUserId: addressTrustReceipt.actorSystemUserId || null,
            resolvedAt: new Date().toISOString(),
          };
        }
        return JSON.stringify(createStaffVerifiedState({
          email: candidateEmail,
          actorProfileId: addressTrustReceipt.actorProfileId,
          actorSystemUserId: addressTrustReceipt.actorSystemUserId,
          requestId,
          candidateKey: authoritativeRosterCandidateKey,
          evidenceType: addressTrustReceipt.evidenceType,
          evidenceUrl: addressTrustReceipt.evidenceUrl,
          note: addressTrustReceipt.note,
          attestedAt: addressTrustReceipt.attestedAt,
          resolution,
        }));
      };
      if (needsExactStaffAttestation) {
        addressTrustStateJson = buildAddressTrustBundle(existingPersonForTrust);
        persistedEmailSource = 'staff_verified';
      }

      const potentialReviewerResult = stablePotentialReviewerId
        ? { id: stablePotentialReviewerId, created: false }
        : await potentialReviewerAdapter.upsertByEmail({
            name: candidate.name,
            email: candidateEmail,
            // Provenance travels with the address (S387): the researcher upsert below still
            // owns the fill/upgrade semantics, but the person row must never exist holding
            // this address with no source because that second write failed.
            emailSource: candidateEmail ? persistedEmailSource : undefined,
            addressTrustStateJson,
            affiliation: candidateAffiliation,
            expertise: gatedExpertiseForDv,
            // Proposal-scoped reasoning is retained even when contact/profile fields are blocked.
            whyChosen: matchReason || null,
          }, { actingUserSystemId, existing: institutionCoiScreen.existing });
      const potentialReviewerId = potentialReviewerResult.id;
      if (potentialReviewerResult.created === true) {
        newlyCreatedPotentialReviewerId = potentialReviewerId;
      }

      if (addressTrustStateJson) {
        const personForTrust = await potentialReviewerAdapter.getById(potentialReviewerId);
        if (!personForTrust?._etag) {
          throw Object.assign(new Error('Reviewer address trust write requires a current person ETag.'), {
            code: 'conflict_record_unavailable',
          });
        }
        const currentAddressTrustStateJson = buildAddressTrustBundle(personForTrust);
        await potentialReviewerAdapter.update(potentialReviewerId, {
          email: candidateEmail,
          emailSource: 'staff_verified',
          addressTrustStateJson: currentAddressTrustStateJson,
        }, { actingUserSystemId, ifMatch: personForTrust._etag });
        addressTrustStateJson = currentAddressTrustStateJson;
      }

      if (
        shouldLinkMatchedContact(contactMatch)
      ) {
        try {
          await potentialReviewerAdapter.setContactLink(potentialReviewerId, contactMatch.match.contactId, { actingUserSystemId });
        } catch (linkErr) {
          if (linkErr?.code === 'reviewer_linked_elsewhere') {
            console.warn(
              `[save-candidates] potentialReviewer ${potentialReviewerId} already linked elsewhere; keeping live link authoritative.`
            );
          } else {
            console.warn('[save-candidates] setContactLink failed (non-fatal):', linkErr?.message || linkErr);
          }
        }
      } else if (contactMatch?.outcome === 'candidates' || contactMatch?.outcome === 'conflict') {
        try {
          await NotificationService.notify({
            type: 'reviewer_contact_match_needs_review',
            severity: 'warning',
            title: 'Reviewer saved without CRM contact link',
            message: `Reviewer candidate "${candidate.name}" was saved for request ${requestId}, but CRM contact matching returned ${contactMatch.outcome}${contactMatch.reason ? ` (${contactMatch.reason})` : ''}. The reviewer remains unlinked for staff review.`,
            metadata: {
              requestId,
              potentialReviewerId,
              candidateName: candidate.name || null,
              candidateEmail: candidateEmail || null,
              candidateOrcid: effectiveLookupOrcid || null,
              candidateAffiliation: candidateAffiliation || null,
              lookupOutcome: contactMatch.outcome,
              conflictReason: contactMatch.outcome === 'conflict' ? contactMatch.reason : null,
              conflictDetails: contactMatch.outcome === 'conflict' ? contactMatch.details : null,
              candidates: contactMatch.outcome === 'candidates' ? contactMatch.candidates : [],
              policyDecision: 'save_unlinked_staff_review',
            },
            source: 'reviewer-finder/save-candidates',
            category: 'reviewers',
            autoResolveKey: `reviewer-contact-match:${potentialReviewerId}:${requestId}`,
          });
        } catch (notifyErr) {
          console.warn('[save-candidates] contact match review alert failed (non-fatal):', notifyErr?.message || notifyErr);
        }
      }

      await researcherAdapter.upsertByPotentialReviewer(potentialReviewerId, {
        name: candidate.name,
        normalizedName,
        email: candidateEmail,
        emailSource: candidateEmail ? persistedEmailSource : null,
        orcid: blockByIdentity ? null : candidateOrcid,
        orcidUrl: blockByIdentity ? null : (candidate.orcidUrl || candidate.contactEnrichment?.orcidUrl || null),
        googleScholarId: blockScholar ? null : candidateGoogleScholarId,
        googleScholarUrl: blockScholar ? null : (candidate.googleScholarUrl || candidate.contactEnrichment?.googleScholarUrl || null),
        // Fall back to contactEnrichment like every other field above —
        // enrichment writes bibliometrics there, and not all callers promote
        // them to the candidate top-level (the standalone Reviewer Finder does
        // not), so reading candidate.* only would silently drop fetched metrics.
        hIndex: blockScholar ? null : (candidate.hIndex ?? enrichment.hIndex ?? null),
        i10Index: blockScholar ? null : (candidate.i10Index ?? enrichment.i10Index ?? null),
        totalCitations: blockScholar ? null : (candidate.totalCitations ?? enrichment.totalCitations ?? null),
        affiliation: candidateAffiliation,
        department: blockByIdentity ? null : (candidate.department || enrichment.department || null),
        website: candidateWebsite,
        facultyPageUrl: candidateFacultyPageUrl,
        keywords: gatedExpertiseForDv,
      }, { actingUserSystemId });

      // Persist only a server-attested resolver decision on the person; unsigned
      // client identity remains deny-only. On a downgrade, also CLEAR
      // any stale resolver-sourced identity fields (upsert's null is a no-op, so
      // an explicit null-PATCH is required to remove a previously-wrong value).
      // Skip for PD-confirmed rows: the resolver verdict was NOT 'confirmed', and a
      // manual PD assertion shouldn't be written as a resolver decision. Leave
      // wmkf_identitystatus untouched (mirrors the manual-add path) while the
      // blockByIdentity gate above still keeps resolver-sourced fields out.
      if (!pdConfirmed && identity) {
        if (
          automatedIdentityReceipt.valid
          && automatedIdentityReceipt.identityDecisionBound !== false
        ) {
          const identityWrite = await researcherAdapter.writeIdentityDecision(potentialReviewerId, identity, {
            actingUserSystemId,
            identityOrigin: 'automated',
          });
          if (identityWrite?.reason === 'binding_conflict') {
            try {
              await NotificationService.notify({
                type: 'reviewer_cross_request_identity_conflict',
                severity: 'warning',
                title: 'Reviewer identity evidence conflicts across requests',
                message: `Automated identity evidence for reviewer "${candidate.name}" on request ${requestId} did not match the stored shared-person binding and was not persisted.`,
                metadata: {
                  requestId,
                  candidateKey: validation.candidateKey,
                  potentialReviewerId,
                  storedDecisionPreserved: true,
                },
                source: 'reviewer-finder/save-candidates',
                category: 'reviewers',
                autoResolveKey: `reviewer-identity-conflict:${potentialReviewerId}:${requestId}`,
              });
            } catch (notifyErr) {
              console.warn('[save-candidates] cross-request identity conflict alert failed (non-fatal):', notifyErr?.message || notifyErr);
            }
          }
        }
        if (blockByIdentity) {
          await researcherAdapter.clearIdentityFields(potentialReviewerId, RESOLVER_SOURCED_FIELDS, {
            actingUserSystemId,
            identityOrigin: 'automated',
          });
        }
      }

      const suggestionResult = await reviewerSuggestionAdapter.upsert({
        potentialReviewerId,
        requestId,
        suggestionLabel: proposalTitle ? `${proposalTitle} — ${candidate.name}` : null,
        grantCycleCode: grantCycleCode || null,
        programArea: programArea || null,
        relevanceScore,
        matchReason,
        sources: sources.join(','),
        selected: true,
        summaryBlobUrl: summaryBlobUrl || null,
      }, { actingUserSystemId });

      if (suggestionResult?.skippedExcluded) {
        rejectedExcluded += 1;
        const blockedReason = 'This reviewer is applicant-excluded for the request and cannot be promoted.';
        try {
          const blocked = await markPromotionBlocked(requestId, authoritativeRosterCandidateKey, {
            decision: 'blocked_applicant_excluded',
            code: 'applicant_excluded',
            reason: blockedReason,
          });
          if (blocked?.blocked !== true) {
            throw new Error('authoritative roster row was not active or blocked');
          }
        } catch (blockedErr) {
          console.warn('[save-candidates] applicant-excluded roster finalization failed (non-fatal):', blockedErr?.message || blockedErr);
          try {
            await NotificationService.notify({
              type: 'reviewer_roster_promotion_block_failed',
              severity: 'warning',
              title: 'Applicant-excluded reviewer was not finalized in Find',
              message: `Reviewer candidate "${candidate.name}" is applicant-excluded for request ${requestId}, but its Find roster row could not be marked terminal.`,
              metadata: {
                requestId,
                candidateKey: authoritativeRosterCandidateKey,
                potentialReviewerId,
                code: 'applicant_excluded',
              },
              source: 'reviewer-finder/save-candidates',
              category: 'reviewers',
              autoResolveKey: `reviewer-roster-block:${requestId}:${authoritativeRosterCandidateKey}`,
            });
          } catch (notifyErr) {
            console.warn('[save-candidates] applicant-excluded roster alert failed (non-fatal):', notifyErr?.message || notifyErr);
          }
        }
        errors.push({
          name: candidate.name,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
          error: blockedReason,
          code: 'applicant_excluded',
          outcome: 'failed',
          decision: 'blocked_applicant_excluded',
        });
        continue;
      }

      let rosterFinalized = false;
      try {
        const finalized = await finalizeCandidatePromotion(requestId, candidate, {
          candidateKey: authoritativeRosterCandidateKey,
          suggestionId: suggestionResult?.id,
          potentialReviewerId,
        });
        rosterFinalized = finalized?.saved === true;
        if (!rosterFinalized) {
          throw new Error('authoritative roster row was not active or saved');
        }
      } catch (finalizeErr) {
        console.warn('[save-candidates] roster promotion finalization failed (non-fatal):', finalizeErr?.message || finalizeErr);
        try {
          await NotificationService.notify({
            type: 'reviewer_roster_promotion_finalize_failed',
            severity: 'warning',
            title: 'Reviewer promotion saved without roster finalization',
            message: `Reviewer candidate "${candidate.name}" was saved for request ${requestId}, but its Find roster row could not be finalized.`,
            metadata: {
              requestId,
              candidateKey: authoritativeRosterCandidateKey,
              suggestionId: suggestionResult?.id || null,
              potentialReviewerId,
            },
            source: 'reviewer-finder/save-candidates',
            category: 'reviewers',
            autoResolveKey: `reviewer-roster-promotion:${requestId}:${authoritativeRosterCandidateKey}`,
          });
        } catch (notifyErr) {
          console.warn('[save-candidates] roster promotion alert failed (non-fatal):', notifyErr?.message || notifyErr);
        }
      }

      savedCount++;
      savedNames.push(candidate.name);
      savedKeys.push(validation.candidateKey);
      savedResults.push({
        outcome: 'saved',
        name: candidate.name,
        candidateKey: validation.candidateKey,
        index: candidateIndex,
        suggestionId: suggestionResult?.id || null,
        potentialReviewerId,
        rosterFinalized,
      });
    } catch (candidateError) {
      console.error(`Error saving candidate ${rawCandidate?.name}:`, candidateError.message);
      if (newlyCreatedPotentialReviewerId) {
        let compensation;
        try {
          compensation = await compensateNewPotentialReviewer(newlyCreatedPotentialReviewerId, {
            actingUserSystemId,
          });
        } catch (compensationError) {
          compensation = {
            compensated: false,
            reason: 'compensation_error',
            error: compensationError?.message || String(compensationError),
          };
        }
        if (!compensation.compensated) {
          await alertFailedPersonCompensation({
            requestId,
            candidateName: rawCandidate?.name,
            candidateKey: validation.candidateKey,
            potentialReviewerId: newlyCreatedPotentialReviewerId,
            failure: candidateError,
            compensation,
          });
        }
      }
      const duplicate = translateDuplicateKeyError(candidateError);
      errors.push({
        name: rawCandidate?.name || null,
        candidateKey: validation.candidateKey,
        index: candidateIndex,
        error: duplicate
          ? 'That email belongs to another reviewer record. Request repair before promoting.'
          : candidateError.message,
        code: duplicate ? 'email_conflict' : (candidateError?.code || 'candidate_save_failed'),
        outcome: 'failed',
      });
    }
  }

    // If every row was rejected before its save completed, this is a validation
    // failure (422), not a generic empty/500. Mixed policy/shape rejections still
    // report each row independently.
    if (savedCount === 0 && (
      rejectedInvalid
      + rejectedUnresolved
      + rejectedMissingEmail
      + rejectedInstitutionCOI
      + rejectedIneligible
      + rejectedExcluded
    ) === candidates.length) {
      throw new SaveCandidatesError('all candidates rejected', 422, {
        error: rejectedInvalid > 0
          ? 'Selected candidates were not saved; see row errors for invalid or ineligible candidates.'
          : rejectedIneligible > 0
            ? 'Selected candidates were not saved; official evidence identifies one or more as ineligible.'
            : 'Selected candidates were not saved — they need identity review or are at the PI’s institution.',
      success: false,
      savedCount: 0,
      savedNames,
      savedKeys,
      totalRequested: candidates.length,
      rejectedInvalid,
      rejectedUnresolved,
      rejectedMissingEmail,
      rejectedInstitutionCOI,
      rejectedIneligible,
      rejectedExcluded,
      errors: actionableErrors(errors),
      results: promotionResults(savedResults, errors),
    });
  }

  if (savedCount === 0) {
    throw new SaveCandidatesError('no candidates saved', 500, {
      error: 'No candidates were saved.',
      success: false,
      savedCount: 0,
      savedNames,
      savedKeys,
      totalRequested: candidates.length,
      rejectedInvalid: rejectedInvalid > 0 ? rejectedInvalid : undefined,
      rejectedUnresolved: rejectedUnresolved > 0 ? rejectedUnresolved : undefined,
      rejectedMissingEmail: rejectedMissingEmail > 0 ? rejectedMissingEmail : undefined,
      rejectedInstitutionCOI: rejectedInstitutionCOI > 0 ? rejectedInstitutionCOI : undefined,
      rejectedIneligible: rejectedIneligible > 0 ? rejectedIneligible : undefined,
      rejectedExcluded: rejectedExcluded > 0 ? rejectedExcluded : undefined,
      errors: actionableErrors(errors),
      results: promotionResults(savedResults, errors),
    });
  }

  return {
    success: true,
    savedCount,
    savedNames,
    savedKeys,
    totalRequested: candidates.length,
    rejectedInvalid: rejectedInvalid > 0 ? rejectedInvalid : undefined,
    rejectedUnresolved: rejectedUnresolved > 0 ? rejectedUnresolved : undefined,
    rejectedMissingEmail: rejectedMissingEmail > 0 ? rejectedMissingEmail : undefined,
    rejectedInstitutionCOI: rejectedInstitutionCOI > 0 ? rejectedInstitutionCOI : undefined,
    rejectedIneligible: rejectedIneligible > 0 ? rejectedIneligible : undefined,
    rejectedExcluded: rejectedExcluded > 0 ? rejectedExcluded : undefined,
    errors: errors.length > 0 ? actionableErrors(errors) : undefined,
    results: promotionResults(savedResults, errors),
  };
}
