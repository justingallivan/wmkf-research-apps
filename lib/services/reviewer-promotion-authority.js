/**
 * Pure Reviewer Find promotion-authority policy.
 *
 * A roster card is historical state, not authority. In particular, this
 * module never regards `state: 'current'`, a browser-provided timestamp, or a
 * non-empty sourceVersion as sufficient. A mutation caller must supply the
 * separately derived, server-owned `authoritative` snapshot for the same
 * request immediately before it mutates a reviewer.
 */

const {
  boundedVersion,
  canonicalIso,
} = require('./reviewer-stage-freshness');
const {
  isCandidateIdentityAuthoritySatisfied,
} = require('../utils/reviewer-identity-authority');

const REQUIRED_STAGES = Object.freeze([
  'applicant_anchor', 'identity', 'institution_domains', 'institution_coi', 'coauthor_coi',
  'eligibility', 'contact', 'address_trust', 'roster_persistence',
]);

const STAGE_CONTRACT_VERSIONS = Object.freeze({
  applicant_anchor: 1, identity: 4, institution_domains: 1, institution_coi: 1,
  coauthor_coi: 1, eligibility: 1, contact: 1, address_trust: 1, roster_persistence: 1,
});

const STALE_STATES = new Set(['stale', 'refreshing']);
const INCOMPLETE_STATES = new Set(['incomplete', 'failed', 'error']);
const ELIGIBILITY_RESULTS = new Set(['unknown', 'emeritus']);
const NOT_APPLICABLE_REASONS = Object.freeze({
  applicant_anchor: new Set(['server_not_applicable']),
  institution_domains: new Set(['identity_not_authoritative']),
  institution_coi: new Set(['identity_not_authoritative']),
  coauthor_coi: new Set(['identity_not_authoritative', 'no_proposal_authors']),
  eligibility: new Set(['identity_not_authoritative', 'no_trusted_domains']),
  contact: new Set(['identity_not_authoritative']),
  address_trust: new Set(['identity_not_authoritative', 'missing_email']),
});

function candidateValue(candidate, field) {
  if (candidate && Object.prototype.hasOwnProperty.call(candidate, field)) {
    return candidate[field];
  }
  const enrichment = candidate?.contactEnrichment;
  if (enrichment && Object.prototype.hasOwnProperty.call(enrichment, field)) {
    return enrichment[field];
  }
  return undefined;
}

function failure(code, {
  stage = null,
  reason = null,
} = {}) {
  return {
    decision: 'blocked',
    code,
    stage,
    reason: reason || code,
  };
}

function serverSnapshotIsCurrent(authoritative, candidate, requestId) {
  if (!authoritative || typeof authoritative !== 'object' || Array.isArray(authoritative)) return false;
  if (authoritative.authorityState !== 'current') return false;
  if (typeof requestId !== 'string' || !requestId || authoritative.requestId !== requestId) return false;
  if (typeof candidate?.candidateKey !== 'string' || authoritative.candidateKey !== candidate.candidateKey) return false;
  if (!authoritative.versions || typeof authoritative.versions !== 'object' || Array.isArray(authoritative.versions)) return false;
  return REQUIRED_STAGES.every((stage) => boundedVersion(authoritative.versions[stage]));
}

function receiptIsCanonical(receipt, stage, authoritative) {
  return receipt?.contractVersion === STAGE_CONTRACT_VERSIONS[stage]
    && boundedVersion(receipt?.sourceVersion)
    && receipt.sourceVersion === authoritative.versions[stage]
    && boundedVersion(receipt?.resultVersion)
    && canonicalIso(receipt?.completedAt);
}

function receiptReason(receipt) {
  return receipt?.reasonCode ?? receipt?.reason ?? null;
}

function candidateIdentityAuthoritySatisfied(candidate) {
  return isCandidateIdentityAuthoritySatisfied(candidate);
}

function stageDecision(candidate, stage, { serverAuthoritative = false, authoritative } = {}) {
  const receipt = candidate?.stageFreshness?.[stage];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return failure('stage_authority_missing', { stage });
  }
  if (STALE_STATES.has(receipt.state)) return failure('stage_authority_stale', { stage });
  if (INCOMPLETE_STATES.has(receipt.state)) return failure('stage_authority_incomplete', { stage });
  if (receipt.state !== 'current' && receipt.state !== 'not_applicable') {
    return failure('stage_authority_unrecognized', { stage });
  }
  if (!serverAuthoritative) {
    // A browser can display this conservative result but cannot establish
    // that the receipt corresponds to current request/proposal dependencies.
    return failure('promotion_authority_unavailable', { stage });
  }
  if (!receiptIsCanonical(receipt, stage, authoritative)) {
    return failure('stage_authority_stale', { stage });
  }
  if (receipt.state === 'current') return null;
  if (
    NOT_APPLICABLE_REASONS[stage]?.has(receiptReason(receipt))
  ) {
    return null;
  }
  return failure('stage_authority_missing', { stage });
}

/**
 * Return the deterministic promotion decision for a server-read candidate.
 *
 * `authoritative` is intentionally required in server mode. It is not part of
 * any route body or persisted candidate projection: the caller must derive it
 * from current request/proposal/provider inputs. If that resolver is not
 * available, promotion is unavailable rather than fail-open.
 *
 * `checkInstitution` remains false only while a mutation service performs the
 * stronger trusted-context institution recomputation immediately afterward.
 */
function getCandidatePromotionAuthority(candidate, {
  serverAuthoritative = false,
  authoritative = null,
  requestId = null,
  checkInstitution = true,
  allowedRosterStatuses = ['active'],
} = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return failure('promotion_authority_missing');
  }
  if (typeof candidate.candidateKey !== 'string' || !candidate.candidateKey.trim()) {
    return failure('promotion_authority_missing');
  }
  if (
    serverAuthoritative
    && !allowedRosterStatuses.includes(candidate.rosterStatus)
  ) {
    return failure('roster_status_not_promotable');
  }

  const eligibilityStatus = candidateValue(candidate, 'eligibilityStatus') || 'unknown';
  if (candidate.rosterStatus === 'ineligible' || ['deceased', 'ineligible'].includes(eligibilityStatus)) {
    return failure('candidate_ineligible', { stage: 'eligibility' });
  }
  if (checkInstitution && candidate.hasInstitutionCOI === true) {
    return failure('institution_coi', { stage: 'institution_coi' });
  }
  if (
    candidate.hasCoauthorCOI === true
    || ['possible', 'likely'].includes(candidate.coauthorCOIStrength)
  ) {
    return failure('coauthor_conflict', { stage: 'coauthor_coi' });
  }
  if (serverAuthoritative && !serverSnapshotIsCurrent(authoritative, candidate, requestId)) {
    return failure('promotion_authority_unavailable');
  }

  const identityStage = stageDecision(candidate, 'identity', { serverAuthoritative, authoritative });
  if (identityStage) return identityStage;
  if (serverAuthoritative && !candidateIdentityAuthoritySatisfied(candidate)) {
    return failure('identity_not_authoritative', { stage: 'identity' });
  }

  for (const stage of REQUIRED_STAGES) {
    if (stage === 'identity') continue;
    const decision = stageDecision(candidate, stage, { serverAuthoritative, authoritative });
    if (decision) return decision;
  }

  const coauthorCheckStatus = candidateValue(candidate, 'coauthorCheckStatus');
  const coauthorNotApplicable = serverAuthoritative
    && candidate?.stageFreshness?.coauthor_coi?.state === 'not_applicable'
    && receiptReason(candidate?.stageFreshness?.coauthor_coi) === 'no_proposal_authors'
    && coauthorCheckStatus === 'not_applicable';
  if (
    !coauthorNotApplicable
    && (
      coauthorCheckStatus !== 'complete'
      || (Array.isArray(candidateValue(candidate, 'coauthorCheckFailures'))
        && candidateValue(candidate, 'coauthorCheckFailures').length > 0)
    )
  ) {
    return failure('coauthor_check_incomplete', { stage: 'coauthor_coi' });
  }

  const eligibilityCheckStatus = candidateValue(candidate, 'eligibilityCheckStatus');
  const eligibilityNotApplicable = serverAuthoritative
    && candidate?.stageFreshness?.eligibility?.state === 'not_applicable'
    && receiptReason(candidate?.stageFreshness?.eligibility) === 'no_trusted_domains'
    && eligibilityCheckStatus === 'not_applicable';
  if (eligibilityNotApplicable) {
    return failure('eligibility_no_trusted_domains', { stage: 'eligibility' });
  }
  if (eligibilityCheckStatus !== 'complete') {
    return failure('eligibility_check_incomplete', { stage: 'eligibility' });
  }

  if (!ELIGIBILITY_RESULTS.has(eligibilityStatus)) {
    return failure('eligibility_result_unrecognized', { stage: 'eligibility' });
  }

  if (candidateValue(candidate, 'emailAction') !== 'ready') {
    return failure('contact_not_promotable', { stage: 'contact' });
  }
  if (!['ready', 'quick_check', 'staff_verified'].includes(candidateValue(candidate, 'addressTrustStatus'))) {
    return failure('address_trust_not_promotable', { stage: 'address_trust' });
  }

  return {
    decision: 'ready',
    code: null,
    stage: null,
    reason: null,
  };
}

module.exports = {
  REQUIRED_STAGES,
  STAGE_CONTRACT_VERSIONS,
  NOT_APPLICABLE_REASONS,
  getCandidatePromotionAuthority,
};
