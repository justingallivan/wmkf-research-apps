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

const REQUIRED_STAGES = Object.freeze([
  'identity',
  'institution_coi',
  'coauthor_coi',
  'eligibility',
  'contact',
  'address_trust',
]);

const STAGE_CONTRACT_VERSIONS = Object.freeze({
  identity: 4,
  institution_coi: 1,
  coauthor_coi: 1,
  eligibility: 1,
  contact: 1,
  address_trust: 1,
});

const STALE_STATES = new Set(['stale', 'refreshing']);
const INCOMPLETE_STATES = new Set(['incomplete', 'failed', 'error']);
const ELIGIBILITY_RESULTS = new Set(['unknown', 'emeritus']);
const NOT_APPLICABLE_STAGES = new Set(['coauthor_coi', 'eligibility']);

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

function serverSnapshotIsCurrent(authoritative) {
  if (!authoritative || typeof authoritative !== 'object' || Array.isArray(authoritative)) return false;
  if (authoritative.authorityState !== 'current') return false;
  if (!authoritative.versions || typeof authoritative.versions !== 'object' || Array.isArray(authoritative.versions)) return false;
  return REQUIRED_STAGES.every((stage) => boundedVersion(authoritative.versions[stage]));
}

function receiptIsCanonical(receipt, stage, authoritative) {
  return receipt?.contractVersion === STAGE_CONTRACT_VERSIONS[stage]
    && boundedVersion(receipt?.sourceVersion)
    && receipt.sourceVersion === authoritative.versions[stage]
    && canonicalIso(receipt?.completedAt);
}

function stageDecision(candidate, stage, { serverAuthoritative = false, authoritative } = {}) {
  const receipt = candidate?.stageFreshness?.[stage];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return failure('stage_authority_missing', { stage });
  }
  if (STALE_STATES.has(receipt.state)) return failure('stage_authority_stale', { stage });
  if (INCOMPLETE_STATES.has(receipt.state)) return failure('stage_authority_incomplete', { stage });
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
    NOT_APPLICABLE_STAGES.has(stage)
    && receipt.state === 'not_applicable'
    && receipt.reason === 'server_not_applicable'
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
  if (serverAuthoritative && !serverSnapshotIsCurrent(authoritative)) {
    return failure('promotion_authority_unavailable');
  }

  for (const stage of REQUIRED_STAGES) {
    const decision = stageDecision(candidate, stage, { serverAuthoritative, authoritative });
    if (decision) return decision;
  }

  const coauthorCheckStatus = candidateValue(candidate, 'coauthorCheckStatus');
  const coauthorNotApplicable = serverAuthoritative
    && candidate?.stageFreshness?.coauthor_coi?.state === 'not_applicable'
    && candidate?.stageFreshness?.coauthor_coi?.reason === 'server_not_applicable'
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
    && candidate?.stageFreshness?.eligibility?.reason === 'server_not_applicable'
    && eligibilityCheckStatus === 'not_applicable';
  if (!eligibilityNotApplicable && eligibilityCheckStatus !== 'complete') {
    return failure('eligibility_check_incomplete', { stage: 'eligibility' });
  }

  if (!ELIGIBILITY_RESULTS.has(eligibilityStatus)) {
    return failure('eligibility_result_unrecognized', { stage: 'eligibility' });
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
  getCandidatePromotionAuthority,
};
