/**
 * Pure compatibility boundary for pre-stageFreshness Reviewer Find evidence.
 *
 * A legacy row is display history, not promotion authority.  This mapper mints
 * a current receipt only when the legacy payload carries a versioned proof of
 * the same candidate identity, required authoritative dependencies,
 * completeness, source contract, and checked date as the new receipt.  It has
 * no database, clock, or network dependency.
 */

const LEGACY_EVIDENCE_MAPPER_VERSION = 1;

const LEGACY_EVIDENCE_REASONS = Object.freeze([
  'legacy_stage_unknown',
  'legacy_evidence_missing',
  'legacy_evidence_invalid',
  'legacy_identity_missing',
  'legacy_identity_mismatch',
  'legacy_dependency_missing',
  'legacy_dependency_mismatch',
  'legacy_completeness_missing',
  'legacy_evidence_incomplete',
  'legacy_source_contract_mismatch',
  'legacy_result_version_missing',
  'legacy_receipt_state_invalid',
  'legacy_reason_invalid',
  'legacy_checked_at_invalid',
  'legacy_evidence_equivalent',
]);
const REASON_SET = new Set(LEGACY_EVIDENCE_REASONS);

// These keys are the minimum dependency proofs that cannot be inferred from a
// legacy display DTO.  The authoritative caller supplies their expected values
// under `legacyEvidenceDependencies[stage]`; missing authoritative values fail
// closed.  Request/proposal-bound evidence is deliberately never mapped from
// a recent timestamp alone.
const REQUIRED_DEPENDENCIES = Object.freeze({
  applicant_anchor: ['candidateKey', 'requestId', 'applicantInputVersion'],
  identity: ['candidateKey', 'applicantAnchorResultVersion', 'proposalContentVersion'],
  institution_domains: ['candidateKey', 'identityResultVersion'],
  institution_coi: ['candidateKey', 'requestId', 'identityResultVersion', 'requestCoiContextVersion'],
  coauthor_coi: ['candidateKey', 'requestId', 'identityResultVersion', 'proposalContentVersion', 'proposalAuthorVersion'],
  eligibility: ['candidateKey', 'identityResultVersion', 'institutionDomainsResultVersion', 'trustedDomainsVersion'],
  contact: ['candidateKey', 'identityResultVersion', 'institutionDomainsResultVersion', 'canonicalPersonVersion'],
  address_trust: ['candidateKey', 'identityResultVersion', 'contactResultVersion', 'canonicalPersonVersion'],
  roster_persistence: ['candidateKey', 'rosterProjectionVersion'],
});
const SUPPORTED_STAGES = new Set(Object.keys(REQUIRED_DEPENDENCIES));
const LEGACY_RECEIPT_STATES = new Set(['current', 'not_applicable']);
const NOT_APPLICABLE_REASONS = Object.freeze({
  applicant_anchor: new Set(['server_not_applicable']),
  institution_domains: new Set(['identity_not_authoritative']),
  institution_coi: new Set(['identity_not_authoritative']),
  coauthor_coi: new Set(['identity_not_authoritative', 'no_proposal_authors']),
  eligibility: new Set(['identity_not_authoritative', 'no_trusted_domains']),
  contact: new Set(['identity_not_authoritative']),
  address_trust: new Set(['identity_not_authoritative', 'missing_email']),
});

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function canonicalIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function boundedVersion(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160;
}

function deterministicResultVersion(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function incomplete(reason, evidence = null) {
  return {
    state: 'incomplete',
    reason: REASON_SET.has(reason) ? reason : 'legacy_evidence_invalid',
    // A valid historical check date is display-only context.  It never turns
    // incomplete legacy evidence into authority.
    completedAt: canonicalIso(evidence?.checkedAt) ? evidence.checkedAt : null,
    mappedFromLegacy: true,
    legacyMapperVersion: LEGACY_EVIDENCE_MAPPER_VERSION,
  };
}

/**
 * Convert one legacy evidence payload into a stage receipt result.
 *
 * The result has `receipt: null` only when no legacy payload exists at all;
 * present-but-unprovable payloads produce an explicit incomplete receipt so
 * callers can distinguish `stage_missing` from `stage_incomplete`.
 */
function mapLegacyStageEvidence({ candidate, stage, authoritative = {}, contractVersion } = {}) {
  if (!SUPPORTED_STAGES.has(stage)) {
    return { receipt: incomplete('legacy_stage_unknown'), reason: 'legacy_stage_unknown' };
  }
  const evidence = candidate?.legacyStageReceipts?.[stage];
  if (evidence === undefined || evidence === null) {
    return { receipt: null, reason: 'legacy_evidence_missing' };
  }
  if (!isRecord(evidence) || evidence.mapperVersion !== LEGACY_EVIDENCE_MAPPER_VERSION || evidence.stage !== stage) {
    return { receipt: incomplete('legacy_evidence_invalid', evidence), reason: 'legacy_evidence_invalid' };
  }
  if (!isRecord(evidence.identity) || !boundedVersion(evidence.identity.candidateKey)) {
    return { receipt: incomplete('legacy_identity_missing', evidence), reason: 'legacy_identity_missing' };
  }
  const candidateKey = typeof candidate?.candidateKey === 'string' ? candidate.candidateKey.trim() : '';
  if (!candidateKey || evidence.identity.candidateKey !== candidateKey) {
    return { receipt: incomplete('legacy_identity_mismatch', evidence), reason: 'legacy_identity_mismatch' };
  }
  if (evidence.completeness === undefined || evidence.completeness === null) {
    return { receipt: incomplete('legacy_completeness_missing', evidence), reason: 'legacy_completeness_missing' };
  }
  if (evidence.completeness !== 'complete') {
    return { receipt: incomplete('legacy_evidence_incomplete', evidence), reason: 'legacy_evidence_incomplete' };
  }
  if (!isRecord(evidence.source)
    || evidence.source.contractVersion !== contractVersion
    || !boundedVersion(evidence.source.sourceVersion)
    || !boundedVersion(authoritative?.versions?.[stage])
    || evidence.source.sourceVersion !== authoritative.versions[stage]) {
    return { receipt: incomplete('legacy_source_contract_mismatch', evidence), reason: 'legacy_source_contract_mismatch' };
  }
  if (!deterministicResultVersion(evidence.source.resultVersion)) {
    return { receipt: incomplete('legacy_result_version_missing', evidence), reason: 'legacy_result_version_missing' };
  }
  if (!LEGACY_RECEIPT_STATES.has(evidence.state)) {
    return { receipt: incomplete('legacy_receipt_state_invalid', evidence), reason: 'legacy_receipt_state_invalid' };
  }
  const reasonCode = evidence.reasonCode ?? evidence.reason ?? null;
  if (
    (evidence.state === 'current' && reasonCode !== null)
    || (evidence.state === 'not_applicable' && !NOT_APPLICABLE_REASONS[stage]?.has(reasonCode))
  ) {
    return { receipt: incomplete('legacy_reason_invalid', evidence), reason: 'legacy_reason_invalid' };
  }
  if (!canonicalIso(evidence.checkedAt)) {
    return { receipt: incomplete('legacy_checked_at_invalid', evidence), reason: 'legacy_checked_at_invalid' };
  }

  const expectedDependencies = authoritative?.legacyEvidenceDependencies?.[stage];
  const requiredKeys = REQUIRED_DEPENDENCIES[stage];
  if (!Array.isArray(requiredKeys) || !isRecord(evidence.dependencies) || !isRecord(expectedDependencies)) {
    return { receipt: incomplete('legacy_dependency_missing', evidence), reason: 'legacy_dependency_missing' };
  }
  for (const key of requiredKeys) {
    if (!boundedVersion(evidence.dependencies[key]) || !boundedVersion(expectedDependencies[key])) {
      return { receipt: incomplete('legacy_dependency_missing', evidence), reason: 'legacy_dependency_missing' };
    }
    if (evidence.dependencies[key] !== expectedDependencies[key]) {
      return { receipt: incomplete('legacy_dependency_mismatch', evidence), reason: 'legacy_dependency_mismatch' };
    }
  }

  return {
    reason: 'legacy_evidence_equivalent',
    receipt: {
      state: evidence.state,
      contractVersion,
      sourceVersion: evidence.source.sourceVersion,
      resultVersion: evidence.source.resultVersion,
      completedAt: evidence.checkedAt,
      reasonCode,
      failureCode: null,
      mappedFromLegacy: true,
      legacyMapperVersion: LEGACY_EVIDENCE_MAPPER_VERSION,
      equivalenceReason: 'legacy_evidence_equivalent',
    },
  };
}

module.exports = {
  LEGACY_EVIDENCE_MAPPER_VERSION,
  LEGACY_EVIDENCE_REASONS,
  REQUIRED_DEPENDENCIES,
  SUPPORTED_STAGES,
  NOT_APPLICABLE_REASONS,
  mapLegacyStageEvidence,
};
