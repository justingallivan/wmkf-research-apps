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
 *     and accumulate rejectedUnresolved / rejectedInstitutionCOI + errors;
 *   - ALL rejected (rejections == batch size) → SaveCandidatesError 422
 *     with the full explicit body (incl. BOTH rejected counts, always);
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
import { DeduplicationService } from '../deduplication-service';
import { mayPersistIdentity, RESOLVER_SOURCED_FIELDS } from '../reviewer-identity-resolver';
import { lookupReviewerIdentity } from '../reviewer-identity-lookup';
import NotificationService from '../notification-service';
import { saveSourceListForCandidate, withReviewerProvenance, buildReviewerProvenance, isIdentityReviewExemptProvenance } from '../../utils/reviewer-provenance';
import { ContactParser } from '../../utils/contact-parser';
import { findIdentityConfirmation, stampSuggestionAnchor } from '../reviewer-roster-store';
import { verifyAutomatedIdentityAttestation } from '../reviewer-candidate-attestation';
import { manualConfirmationMatches } from '../../utils/reviewer-manual-confirmation';
import { isAntiScrapeMunge } from '../../utils/reviewer-vetted-email';
import { ServiceHttpError } from '../service-http-error';
import { loadCoiContext } from '../reviewer-request-context';
import { CLIENT_ID_RE, reviewerSaveKey } from '../../utils/reviewer-save-key';

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
const IDENTITY_STATUSES = new Set(['confirmed', 'probable', 'ambiguous', 'unresolved', 'rejected']);
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
  if (rawCandidate.identityStatus !== undefined && !IDENTITY_STATUSES.has(rawCandidate.identityStatus)) {
    return fail('identityStatus is not supported.');
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
      if (identity.status !== undefined && !IDENTITY_STATUSES.has(identity.status)) {
        return fail('contactEnrichment.identity.status is not supported.');
      }
      if (identity.anchors !== undefined && (!Array.isArray(identity.anchors) || identity.anchors.length > MAX_IDENTITY_ANCHORS)) {
        return fail(`contactEnrichment.identity.anchors must contain at most ${MAX_IDENTITY_ANCHORS} entries.`);
      }
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

function fieldPersistFlag(candidate, enrichment, flagName) {
  if (candidate?.[flagName] === false || enrichment?.[flagName] === false) return false;
  if (candidate?.[flagName] === true || enrichment?.[flagName] === true) return true;
  return undefined;
}

function paidSearchSource(source) {
  return source === 'claude_search' || source === 'serp_search' || source === 'search_contested';
}

function contactFieldAllowed(candidate, enrichment, flagName, source) {
  if (candidate?.contactStatus === 'unresolved' || enrichment?.contactStatus === 'unresolved') return false;
  const flag = fieldPersistFlag(candidate, enrichment, flagName);
  if (flag === false) return false;
  if (flag === true) return true;
  return !paidSearchSource(source);
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
  // saves as a name/identity-review row, but with ALL contact + identity-derived fields
  // force-nulled (see contactBlockedForUnresolvedExempt) so anchor-or-abstain still holds — a
  // selectable-but-unverified row cannot carry a wrong-person email/ORCID. Only SYSTEM-discovered
  // unresolved rows are rejected.
  if (isIdentityReviewExemptProvenance(buildReviewerProvenance(candidate).kind)) return false;
  return candidate?.needsIdentification === true
    || candidate?.identityStatus === 'unresolved'
    || candidate?.verificationStatus === 'unresolved';
}

function hasResolvedIdentity(candidate, enrichment) {
  const status = enrichment?.identity?.status || null;
  return status === 'confirmed' || status === 'probable';
}

// Codex HIGH (S235): when a cited/PI-named candidate is allowed through save WITHOUT a resolved
// identity (the exemption above), NO contact or identity-derived field may persist — it could be
// a namesake of the named person. Force email/website/faculty-page/affiliation/ORCID/Scholar/
// bibliometrics to null until identity is confirmed/probable. This turns "no silent wrong email"
// from an assumption into an enforced invariant at the persistence boundary.
function contactBlockedForUnresolvedExempt(candidate, enrichment) {
  return isIdentityReviewExemptProvenance(buildReviewerProvenance(candidate).kind)
    && !hasResolvedIdentity(candidate, enrichment);
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

  return {
    existing,
    affiliations,
    recomputedInstitutionCOI: recomputeInstitutionCOI(
      candidate,
      coiInstitutionEntries,
      affiliations,
    ),
  };
}

function recomputeInstitutionCOI(candidate, institutionEntries, serverAffiliations = []) {
  const payloadDecision = DeduplicationService.institutionCOIDecision(candidate, institutionEntries);
  if (payloadDecision) {
    return { ...payloadDecision, decisionSource: 'candidate_payload' };
  }

  for (const serverAffiliation of serverAffiliations) {
    if (!serverAffiliation) continue;
    const serverAffiliationDecision = DeduplicationService.institutionCOIDecision({
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
    }, institutionEntries);
    if (serverAffiliationDecision) {
      return { ...serverAffiliationDecision, decisionSource: 'server_reviewer_identity_affiliation' };
    }
  }
  return null;
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
  let rejectedInvalid = 0;
  const errors = [];
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
      if (requestedPdConfirmation) {
        const confirmationId = typeof rawCandidate?.pdIdentityConfirmationId === 'string'
          ? rawCandidate.pdIdentityConfirmationId
          : '';
        const storedConfirmation = confirmationId
          ? await findIdentityConfirmation(requestId, confirmationId)
          : null;
        pdConfirmed = manualConfirmationMatches(storedConfirmation, candidate);
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
      // Codex HIGH: an unresolved cited/PI-named row saves as a name row only — force ALL
      // contact + identity-derived fields to null (it could be a namesake of the named person).
      const contactBlocked = !pdConfirmed && !validatedSeedAnchor && contactBlockedForUnresolvedExempt(candidate, enrichment);
      // PD-confirmed contact is hand-entered by definition — FORCE source 'manual'
      // server-side rather than trusting the client's `emailSource`. Otherwise a
      // forged/stale payload could send emailSource:'orcid' (or another high-confidence
      // source) and mark this email trusted, skipping confirm-before-invite at send.
      let candidateEmailSource = pdConfirmed ? 'manual' : (candidate.emailSource || enrichment.emailSource || null);
      const candidateWebsiteSource = pdConfirmed ? 'manual' : (candidate.websiteSource || enrichment.websiteSource || null);
      // PD-confirmed: persist the hand-typed contact directly (it's stamped 'manual'
      // client-side → confirm-before-invite still fires at send). Otherwise the normal
      // resolver-derived persist gates apply.
      const emailAllowed = pdConfirmed ? true : (!contactBlocked && contactFieldAllowed(candidate, enrichment, 'emailPersistAllowed', candidateEmailSource));
      const websiteAllowed = pdConfirmed ? true : (!contactBlocked && contactFieldAllowed(candidate, enrichment, 'websitePersistAllowed', candidateWebsiteSource));
      const affiliationAllowed = pdConfirmed ? true : (!contactBlocked && contactFieldAllowed(candidate, enrichment, 'affiliationPersistAllowed', null));
      // PD-confirmed rows source contact ONLY from the PD-typed candidate.* values —
      // NEVER the enrichment fallback. The enrichment email/website are the very values
      // the PD is overriding; if the PD blanks one, it must persist as null, not silently
      // fall back to the wrong auto-suggested value.
      let candidateEmail = emailAllowed ? (pdConfirmed ? (candidate.email || null) : (candidate.email || enrichment.email || null)) : null;
      const candidateAffiliation = affiliationAllowed ? (pdConfirmed ? (candidate.affiliation || null) : (candidate.affiliation || enrichment.affiliation || null)) : null;

      // Tier-0 affiliation-email rescue (S317). When contact enrichment ran but did NOT
      // capture an email (a partial / timed-out run — verified live for req 1003020:
      // `wmkf_lastchecked` set but `wmkf_metricsupdatedat`/`hIndex` empty), a PubMed-style
      // affiliation that embeds the reviewer's own corresponding address
      // ("… Boston Children's Hospital. christopher.walsh@childrens.harvard.edu.") would
      // otherwise be persisted with the email ORPHANED inside the affiliation string and
      // an empty email field ("no email — can't invite"). Mirror enrichment Tier 0
      // (contact-enrichment-service.js:439-450): extract the embedded email and persist it
      // as `affiliation`-sourced — a grounded, name-adjacent address that enrichment itself
      // trusts unconditionally (Tier 0 returns before domain validation, so it is immune to
      // the paid-search domain-contradiction drop). Same safety envelope as the normal email
      // persist: skipped for a contact-blocked (unresolved cited/PI-named) row and for
      // PD-confirmed rows (whose contact is PD-typed only), and only when the affiliation is
      // itself allowed to persist (candidateAffiliation non-null). Only fills a GAP — never
      // overrides an email the normal path already captured.
      if (!candidateEmail && !pdConfirmed && !contactBlocked && candidateAffiliation) {
        const affiliationEmail = ContactParser.extractPrimaryEmail(candidateAffiliation);
        if (affiliationEmail) {
          candidateEmail = affiliationEmail;
          candidateEmailSource = 'affiliation';
        }
      }
      // Reject anti-scrape MUNGED addresses (e.g. name@nospam.uni.edu) that paid
      // search can capture verbatim — undeliverable and not auto-de-mungeable. Mirrors
      // the shared `pickVettedEmail` gate the automated paths (A reconciler / B1 promote)
      // use, closing the same class on this interactive save path. Enrichment-/auto-sourced
      // only — a PD's hand-typed contact (pdConfirmed) is the human's call. Nulling the
      // email also nulls its persisted source (the researcher upsert gates source on email).
      if (candidateEmail && !pdConfirmed && isAntiScrapeMunge(candidateEmail)) {
        candidateEmail = null;
      }
      // Enrichment stores the ORCID iD as `orcidId` (not `orcid`); read that key
      // so a candidate carrying only contactEnrichment doesn't drop a real ORCID.
      const candidateOrcid = contactBlocked ? null : (candidate.orcid || enrichment.orcidId || null);
      const candidateGoogleScholarId = contactBlocked ? null : (candidate.googleScholarId || enrichment.googleScholarId || null);
      const rawCandidateWebsite = websiteAllowed ? (pdConfirmed ? (candidate.website || null) : (candidate.website || enrichment.website || null)) : null;
      const candidateWebsite = ContactParser.sanitizeWebsiteForCandidate(rawCandidateWebsite, candidate.name);
      const rawCandidateFacultyPageUrl = (websiteAllowed && !pdConfirmed) ? (candidate.facultyPageUrl || enrichment.facultyPageUrl || null) : null;
      const candidateFacultyPageUrl = rawCandidateFacultyPageUrl && !ContactParser.isDocumentUrl(rawCandidateFacultyPageUrl) ? rawCandidateFacultyPageUrl : null;

      const expertiseForDv = Array.isArray(candidate.expertiseAreas)
        ? candidate.expertiseAreas.filter(Boolean).join('; ')
        : (candidate.expertise || null);
      const gatedExpertiseForDv = contactBlocked ? null : expertiseForDv;

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
        || candidate.identityPersistAllowed === false
        || contactBlocked; // unresolved cited/PI-named exempt row → null ORCID/Scholar/metrics too
      const blockScholar = pdConfirmed || scholarSkipped || blockByIdentity
        || candidate.scholarPersistAllowed === false;
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

      // S240/F2: current same-institution is a HARD policy conflict at save. Discovery
      // hard-drops by default but Phase C can surface a contradicted low-trust match
      // as a read-only flag; post-enrichment can also promote a current affiliation
      // that matches a PI institution. Reject any hasInstitutionCOI row here — the
      // authoritative gate — so it can never be saved even if a stale client selected it.
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
      if (recomputedInstitutionCOI) {
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
      if (candidate.hasInstitutionCOI || enrichmentInstitutionCOI || recomputedInstitutionCOI) {
        rejectedInstitutionCOI += 1;
        errors.push(buildInstitutionCoiError(candidate, {
          recomputedInstitutionCOI,
          candidateKey: validation.candidateKey,
          index: candidateIndex,
        }));
        continue;
      }

      const potentialReviewerId = validatedSeedAnchor?.potentialReviewerId || (await potentialReviewerAdapter.upsertByEmail({
        name: candidate.name,
        email: candidateEmail,
        affiliation: candidateAffiliation,
        expertise: gatedExpertiseForDv,
        // Proposal-scoped reasoning is retained even when contact/profile fields are blocked.
        whyChosen: matchReason || null,
      }, { actingUserSystemId, existing: institutionCoiScreen.existing })).id;

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
        emailSource: candidateEmail ? candidateEmailSource : null,
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
        department: contactBlocked ? null : (candidate.department || enrichment.department || null),
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
        if (automatedIdentityReceipt.valid) {
          await researcherAdapter.writeIdentityDecision(potentialReviewerId, identity, {
            actingUserSystemId,
            identityOrigin: 'automated',
          });
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

      try {
        await stampSuggestionAnchor(requestId, candidate.name, {
          suggestionId: suggestionResult?.id,
          potentialReviewerId,
        });
      } catch (stampErr) {
        console.warn('[save-candidates] roster suggestion anchor stamp failed (non-fatal):', stampErr?.message || stampErr);
      }

      savedCount++;
      savedNames.push(candidate.name);
      savedKeys.push(validation.candidateKey);
    } catch (candidateError) {
      console.error(`Error saving candidate ${rawCandidate?.name}:`, candidateError.message);
      errors.push({
        name: rawCandidate?.name || null,
        candidateKey: validation.candidateKey,
        index: candidateIndex,
        error: candidateError.message,
      });
    }
  }

    // If every row was rejected before its save completed, this is a validation
    // failure (422), not a generic empty/500. Mixed policy/shape rejections still
    // report each row independently.
    if (savedCount === 0 && (rejectedInvalid + rejectedUnresolved + rejectedInstitutionCOI) === candidates.length) {
      throw new SaveCandidatesError('all candidates rejected', 422, {
        error: rejectedInvalid > 0
          ? 'Selected candidates were not saved; see row errors for invalid or ineligible candidates.'
          : 'Selected candidates were not saved — they need identity review or are at the PI’s institution.',
      success: false,
      savedCount: 0,
      savedNames,
      savedKeys,
      totalRequested: candidates.length,
      rejectedInvalid,
      rejectedUnresolved,
      rejectedInstitutionCOI,
      errors,
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
      rejectedInstitutionCOI: rejectedInstitutionCOI > 0 ? rejectedInstitutionCOI : undefined,
      errors,
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
    rejectedInstitutionCOI: rejectedInstitutionCOI > 0 ? rejectedInstitutionCOI : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}
