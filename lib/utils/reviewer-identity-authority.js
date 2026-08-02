/**
 * Client-safe Reviewer Find identity-authority predicate.
 *
 * This deliberately has no runtime/provider/persistence dependency so shared
 * selection logic can reuse the same positive-authority rule as server stage
 * producers without pulling Node-only modules into a browser bundle.
 */

function boundedText(value, maxLength = 240) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function canonicalIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

const CANONICAL_PERSON_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalPersonId(value) {
  const id = boundedText(value, 80);
  return id && CANONICAL_PERSON_GUID_RE.test(id) ? id.toLowerCase() : null;
}

function recordOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * A manual identity decision is authoritative only when it names the exact
 * Dataverse person/version that staff reviewed, and the authenticated actor
 * and decision time are retained with it.  Keep this predicate client-safe so
 * every consumer of a persisted roster projection applies the same rule.
 */
function isStaffIdentityConfirmationSatisfied(staff) {
  if (!staff || typeof staff !== 'object' || Array.isArray(staff)) return false;
  return staff.state === 'confirmed'
    && canonicalPersonId(staff.canonicalPersonId) !== null
    && boundedText(staff.canonicalPersonEtag, 240) !== null
    && boundedText(staff.actorId, 120) !== null
    && canonicalIso(staff.confirmedAt);
}

function hasCandidateStaffIdentityConfirmation(candidate = {}) {
  const safeCandidate = recordOrEmpty(candidate);
  const confirmationId = boundedText(safeCandidate.pdIdentityConfirmationId, 240);
  const staff = recordOrEmpty(safeCandidate.staffIdentityConfirmation);
  return safeCandidate.pdIdentityConfirmed === true
    && !!confirmationId
    && staff?.source === 'staff_confirmed'
    && staff?.confirmationId === confirmationId
    && isStaffIdentityConfirmationSatisfied(staff);
}

function normalizedDecision(value) {
  const decision = boundedText(value, 80);
  return decision ? decision.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('en-US') : null;
}

/**
 * Freshness is not identity authority. A complete identity stage becomes
 * promotable only for a confirmed/probable resolver decision or a bounded,
 * server-issued staff confirmation.
 */
function isIdentityAuthoritySatisfied(input = {}) {
  const {
    candidate: rawCandidate,
    identityEvidence: rawIdentityEvidence,
    identityResult: rawIdentityResult,
  } = recordOrEmpty(input);
  const candidate = recordOrEmpty(rawCandidate);
  const identityEvidence = recordOrEmpty(rawIdentityEvidence);
  const identityResult = recordOrEmpty(rawIdentityResult);
  const candidateIdentityEvidence = recordOrEmpty(candidate.identityEvidence);
  const candidateContactEnrichment = recordOrEmpty(candidate.contactEnrichment);
  const candidateContactIdentity = recordOrEmpty(candidateContactEnrichment.identity);
  const decision = String(
    identityEvidence.decision
      || identityEvidence.status
      || identityResult.status
      || identityResult.resolverStatus
      || candidateIdentityEvidence.decision
      || candidateIdentityEvidence.status
      || candidateContactIdentity.status
      || '',
  ).toLowerCase();
  if (decision === 'confirmed' || decision === 'probable') return true;
  const staff = identityEvidence.staffConfirmation || candidateIdentityEvidence.staffConfirmation;
  return isStaffIdentityConfirmationSatisfied(staff);
}

/**
 * Preserve the warm-source contract for persisted candidate projections.
 * In contrast to the stage predicate above, a staff confirmation here is
 * bound to a canonical record, its ETag, and the confirming actor.
 */
function isCandidateIdentityAuthoritySatisfied(candidate = {}) {
  const safeCandidate = recordOrEmpty(candidate);
  const identityEvidence = recordOrEmpty(safeCandidate.identityEvidence);
  const contactEnrichment = recordOrEmpty(safeCandidate.contactEnrichment);
  const contactIdentity = recordOrEmpty(contactEnrichment.identity);
  const decision = normalizedDecision(
    safeCandidate.identityDecision
      || identityEvidence.decision
      || identityEvidence.status
      || safeCandidate.identityStatus
      || contactIdentity.status,
  );
  if (isIdentityAuthoritySatisfied({ identityEvidence: { decision } })) return true;

  const staff = safeCandidate.staffIdentityConfirmation
    || identityEvidence.staffConfirmation
    || identityEvidence.staffIdentityConfirmation;
  return isStaffIdentityConfirmationSatisfied(staff);
}

module.exports = {
  isIdentityAuthoritySatisfied,
  isCandidateIdentityAuthoritySatisfied,
  isStaffIdentityConfirmationSatisfied,
  hasCandidateStaffIdentityConfirmation,
  _internals: {
    boundedText,
    canonicalIso,
    canonicalPersonId,
    normalizedDecision,
    recordOrEmpty,
  },
};
