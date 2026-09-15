'use strict';

/**
 * Dormant Phase 1 composition contract for reviewer institution auto-resolution.
 *
 * This module has no runtime caller. It keeps institution clearance separate
 * from the final candidate decision, and distinguishes a supported clearance
 * from conditional neutrality when institution evidence is unavailable.
 */

const {
  EVIDENCE_CONTEXTS,
  RELATIONSHIPS,
  normalizeIndependentIdentity,
} = require('./institution-affiliation-assessment');

const POLICY_VERSION = 'institution-affiliation-policy/v2';
const ADDITIONAL_COI = new Set(['clear', 'conflict', 'incomplete', 'not_screened']);
const BINDING_STATES = new Set(['current', 'stale', 'invalid']);
const PARENT_CHILD_KINDS = new Set([
  'verified_constituent',
  'system_campus',
  'unclassified',
  'not_applicable',
]);
const PROVIDER_STATES = new Set(['complete', 'partial', 'failed']);
const INDEPENDENT_IDENTITY_RESULTS = new Set([
  'sufficient',
  'insufficient',
  'contradicted',
  'not_evaluable',
]);
const INDEPENDENT_IDENTITY_METHODS = new Set([
  'pubmed_multi_work_author',
  'exact_work_unique_author',
  'forename_work_grounding',
  'hard_id_join',
]);
const INDEPENDENT_IDENTITY_RESOLVERS = new Set([
  'independentReviewerIdentity@1.0.0',
]);
const INDEPENDENT_IDENTITY_MAX_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function identityDisposition(independentIdentity) {
  if (independentIdentity?.version === 'independent-identity/v1') {
    const result = independentIdentity.result;
    const evaluatedAt = Date.parse(independentIdentity.evaluatedAt || '');
    const providerObservedAt = Date.parse(independentIdentity.providerObservedAt || '');
    const expiresAt = Date.parse(independentIdentity.expiresAt || '');
    const temporalClaimsValid = Number.isFinite(evaluatedAt)
      && Number.isFinite(providerObservedAt)
      && Number.isFinite(expiresAt)
      && providerObservedAt <= evaluatedAt + 5 * 60 * 1000
      && expiresAt > evaluatedAt
      && expiresAt <= providerObservedAt + INDEPENDENT_IDENTITY_MAX_TTL_MS;
    const requiredClaimsPresent = INDEPENDENT_IDENTITY_RESULTS.has(result)
      && independentIdentity.excludesAffiliation === true
      && INDEPENDENT_IDENTITY_METHODS.has(independentIdentity.method)
      && INDEPENDENT_IDENTITY_RESOLVERS.has(independentIdentity.resolverVersion)
      && typeof independentIdentity.requestBinding === 'string'
      && independentIdentity.requestBinding.length > 0
      && typeof independentIdentity.candidateKey === 'string'
      && independentIdentity.candidateKey.length > 0
      && /^[a-f0-9]{64}$/i.test(independentIdentity.identityInputDigest || '')
      && temporalClaimsValid
      && PROVIDER_STATES.has(independentIdentity.providerState)
      && !(['sufficient', 'contradicted'].includes(result)
        && independentIdentity.providerState !== 'complete');
    return {
      identity: requiredClaimsPresent
        ? independentIdentity
        : { available: false, sufficient: false, result: 'not_evaluable' },
      disposition: requiredClaimsPresent ? result : 'not_evaluable',
    };
  }
  const identity = normalizeIndependentIdentity(independentIdentity);
  if (!identity.available) return { identity, disposition: 'not_evaluable' };
  return { identity, disposition: identity.sufficient ? 'sufficient' : 'insufficient' };
}

function withIdentityGate(base, independentIdentity) {
  const { identity, disposition } = identityDisposition(independentIdentity);
  if (disposition === 'sufficient') {
    return {
      ...base,
      independentIdentity: identity,
      finalCandidateEffect: 'continue_other_gates',
      finalReason: 'independent_identity_sufficient',
    };
  }
  if (disposition === 'contradicted') {
    return {
      ...base,
      independentIdentity: identity,
      finalCandidateEffect: 'reject',
      finalReason: 'independent_identity_contradicted',
      remedies: ['not_a_fit'],
    };
  }
  return {
    ...base,
    independentIdentity: identity,
    finalCandidateEffect: 'hold',
    finalReason: disposition === 'insufficient'
      ? 'independent_identity_insufficient'
      : 'independent_identity_unavailable',
    remedies: [...new Set([...(base.remedies || []), 'confirm_identity', 'not_a_fit'])],
  };
}

function contractHold(reason) {
  return {
    policyVersion: POLICY_VERSION,
    institutionEffect: 'hold',
    institutionAction: 'block_invalid_contract',
    reason,
    finalCandidateEffect: 'hold',
    finalReason: reason,
    remedies: ['operator_review'],
  };
}

function evaluateReviewerInstitutionAutoResolution({
  assessment,
  independentIdentity,
  additionalCoi = 'not_screened',
  bindingState = 'invalid',
  parentChildKind = 'not_applicable',
  providerState = 'failed',
} = {}) {
  if (!RELATIONSHIPS.includes(assessment?.relationship)) {
    return contractHold('unknown_relationship');
  }
  if (!EVIDENCE_CONTEXTS.has(assessment?.evidenceContext)) {
    return contractHold('unknown_evidence_context');
  }
  if (!ADDITIONAL_COI.has(additionalCoi)) return contractHold('unknown_additional_coi');
  if (!BINDING_STATES.has(bindingState)) return contractHold('unknown_binding_state');
  if (!PARENT_CHILD_KINDS.has(parentChildKind)) return contractHold('unknown_parent_child_kind');
  if (!PROVIDER_STATES.has(providerState)) return contractHold('unknown_provider_state');
  if (bindingState !== 'current') return contractHold(`binding_${bindingState}`);

  const providerUnavailable = providerState === 'failed' || providerState === 'partial';
  if (providerUnavailable) {
    return withIdentityGate({
      policyVersion: POLICY_VERSION,
      institutionEffect: 'neutral',
      institutionAction: 'neutral_without_institution_evidence',
      reason: providerState === 'failed' ? 'provider_failure_neutral' : 'provider_partial_neutral',
      remedies: ['retry_enrichment'],
    }, independentIdentity);
  }

  const compatible = (
    assessment.relationship === 'same' || assessment.relationship === 'parent_child'
  ) && (
    assessment.evidenceContext === 'compatible'
      || assessment.evidenceContext === 'compatible_with_additional'
  );

  if (compatible && assessment.relationship === 'parent_child'
      && parentChildKind !== 'verified_constituent') {
    return {
      policyVersion: POLICY_VERSION,
      institutionEffect: 'hold',
      institutionAction: 'hold_for_relationship_review',
      reason: 'parent_child_not_verified_constituent',
      finalCandidateEffect: 'hold',
      finalReason: 'institution_relationship_unverified',
      remedies: ['add_authoritative_evidence', 'not_a_fit'],
    };
  }

  if (compatible) {
    const hasAdditional = Array.isArray(assessment.additionalAffiliations)
      && assessment.additionalAffiliations.length > 0;
    const base = {
      policyVersion: POLICY_VERSION,
      institutionEffect: 'clear',
      institutionAction: 'clear_institution_concern',
      reason: assessment.evidenceContext,
      remedies: [],
    };
    if (hasAdditional && additionalCoi === 'conflict') {
      return {
        ...base,
        finalCandidateEffect: 'hold',
        finalReason: 'additional_affiliation_coi',
        remedies: ['show_coi_disposition'],
      };
    }
    if (hasAdditional && additionalCoi !== 'clear') {
      return {
        ...base,
        finalCandidateEffect: 'hold',
        finalReason: 'additional_affiliation_coi_incomplete',
        remedies: ['complete_coi_screen'],
      };
    }
    return withIdentityGate(base, independentIdentity);
  }

  const currentConflict = assessment.evidenceContext === 'current_conflict'
    || assessment.evidenceContext === 'current_related_unclear';
  if (currentConflict) {
    return {
      policyVersion: POLICY_VERSION,
      institutionEffect: 'surface',
      institutionAction: 'surface_current_discrepancy',
      reason: assessment.evidenceContext,
      finalCandidateEffect: 'hold',
      finalReason: 'current_institution_discrepancy',
      remedies: ['confirm_identity', 'correct_current_institution', 'record_joint_appointment', 'not_a_fit'],
    };
  }

  if (assessment.reason === 'shared_parent_subunit_identity_unresolved') {
    return {
      policyVersion: POLICY_VERSION,
      institutionEffect: 'hold',
      institutionAction: 'hold_for_relationship_review',
      reason: 'unidentifiable_subunits',
      finalCandidateEffect: 'hold',
      finalReason: 'institution_relationship_unverified',
      remedies: ['add_authoritative_evidence', 'not_a_fit'],
    };
  }

  const historical = assessment.evidenceContext === 'historical_difference'
    || assessment.evidenceContext === 'historical_related';
  return withIdentityGate({
    policyVersion: POLICY_VERSION,
    institutionEffect: 'neutral',
    institutionAction: 'neutral_without_institution_clearance',
    reason: historical ? assessment.evidenceContext : 'comparison_inconclusive',
    remedies: [],
  }, independentIdentity);
}

module.exports = {
  POLICY_VERSION,
  evaluateReviewerInstitutionAutoResolution,
};
