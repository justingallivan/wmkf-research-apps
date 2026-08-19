'use strict';

/**
 * Shadow-only source-aware affiliation relationship and consumer policy.
 *
 * This module deliberately has no runtime caller. It separates organization
 * relationship truth from evidence-time interpretation and from the action a
 * particular consumer may take. Affiliation evidence never establishes person
 * identity, and unknown inputs fail closed for high-authority policy consumers.
 */

const { parseOrganizationSpans } = require('./ror-institution-evidence');

const SCHEMA_VERSION = 'institution-affiliation-assessment/v1';
const POLICY_VERSION = 'institution-affiliation-policy/v1';
const RELATIONSHIPS = Object.freeze([
  'same',
  'parent_child',
  'sibling',
  'related_other',
  'distinct',
  'unresolved',
]);
const SOURCE_TYPES = new Set([
  'publication',
  'orcid_employment',
  'official_profile',
  'applicant_record',
  'staff_record',
  'reviewer_self_report',
]);
const CURRENTNESS = new Set(['current', 'historical', 'unknown']);
const AUTHOR_SPECIFIC = new Set([true, false, 'unknown']);
const EVIDENCE_CONTEXTS = new Set([
  'compatible',
  'compatible_with_additional',
  'current_conflict',
  'current_related_unclear',
  'historical_difference',
  'historical_related',
  'difference_unknown_time',
  'related_unknown_time',
  'unresolved',
]);
const CONSUMERS = new Set([
  'staff_notification',
  'candidate_card',
  'candidate_selectability',
  'automated_write',
  'identity_anchor',
]);
const HIGH_AUTHORITY_CONSUMERS = new Set([
  'candidate_selectability',
  'automated_write',
  'identity_anchor',
]);
const ROR_ID = /^https:\/\/ror\.org\/[0-9a-z]{9}$/;

function bounded(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function assertRorId(value, field) {
  if (value != null && !ROR_ID.test(String(value))) {
    throw new Error(`${field} must be a ROR id`);
  }
  return value == null ? null : String(value);
}

function normalizeResolution(value) {
  if (!value || value.status !== 'resolved') {
    return {
      status: 'unresolved',
      reason: bounded(value?.reason, 120) || 'not_resolved',
      provider: bounded(value?.provider, 80) || null,
      sourceRorId: null,
      canonicalRorId: null,
      relationships: [],
      canonicalization: null,
      confidence: bounded(value?.confidence, 40) || 'unknown',
    };
  }
  const organizationScope = value.organizationScope === 'subunit' ? 'subunit' : 'ror_entity';
  const sourceRorId = assertRorId(value.sourceRorId, 'sourceRorId');
  const canonicalRorId = assertRorId(value.canonicalRorId || sourceRorId, 'canonicalRorId');
  const parentRorId = assertRorId(value.parentRorId, 'parentRorId');
  if (!canonicalRorId || (organizationScope === 'ror_entity' && !sourceRorId)) {
    throw new Error('resolved organization requires a canonical ROR id and ROR entities require a source ROR id');
  }
  if (organizationScope === 'subunit' && !parentRorId) {
    throw new Error('resolved subunit requires parentRorId');
  }
  const relationships = (Array.isArray(value.relationships) ? value.relationships : [])
    .flatMap((relationship) => {
      const type = bounded(relationship?.type, 60).toLowerCase();
      const rorId = relationship?.rorId || relationship?.ror_id;
      if (!type || !rorId) return [];
      return [{ type, rorId: assertRorId(rorId, 'relationship.rorId') }];
    });
  return {
    status: 'resolved',
    reason: bounded(value.reason, 120) || 'resolved',
    provider: bounded(value.provider, 80) || null,
    sourceRorId,
    canonicalRorId,
    organizationScope,
    parentRorId,
    relationships,
    canonicalization: value.canonicalization && typeof value.canonicalization === 'object'
      ? {
          type: bounded(value.canonicalization.type, 60) || null,
          fromRorId: assertRorId(value.canonicalization.fromRorId, 'canonicalization.fromRorId'),
          toRorId: assertRorId(value.canonicalization.toRorId, 'canonicalization.toRorId'),
        }
      : null,
    confidence: bounded(value.confidence, 40) || 'unknown',
  };
}

function normalizeSegments(assertion) {
  if (Array.isArray(assertion.segments) && assertion.segments.length > 0) {
    return assertion.segments.map((segment, index) => {
      const rawText = bounded(segment?.rawText, 1000);
      if (!rawText) throw new Error(`assertion segment ${index} requires rawText`);
      return {
        rawText,
        role: segment.role === 'additional' ? 'additional' : 'primary_or_unknown',
        resolution: normalizeResolution(segment.resolution),
      };
    });
  }
  const parsed = parseOrganizationSpans(assertion.rawText);
  if (parsed.issue) {
    return [{
      rawText: assertion.rawText,
      role: 'primary_or_unknown',
      resolution: normalizeResolution({ reason: parsed.issue }),
    }];
  }
  return parsed.spans.map((rawText) => ({
    rawText,
    role: 'primary_or_unknown',
    resolution: normalizeResolution({ reason: 'resolution_not_run' }),
  }));
}

function createAffiliationAssertion(value = {}) {
  const rawText = bounded(value.rawText, 2000);
  if (!rawText) throw new Error('affiliation assertion requires rawText');
  if (!SOURCE_TYPES.has(value.sourceType)) {
    throw new Error(`invalid affiliation sourceType ${value.sourceType}`);
  }
  const currentness = CURRENTNESS.has(value.currentness) ? value.currentness : 'unknown';
  const authorSpecific = AUTHOR_SPECIFIC.has(value.authorSpecific)
    ? value.authorSpecific
    : 'unknown';
  const assertion = {
    rawText,
    sourceType: value.sourceType,
    sourceReference: bounded(value.sourceReference, 500) || null,
    observedAt: bounded(value.observedAt, 80) || null,
    currentness,
    authorSpecific,
    segments: [],
  };
  assertion.segments = normalizeSegments({ ...value, rawText });
  return assertion;
}

function relationshipIds(resolution, type) {
  return new Set(resolution.relationships
    .filter((relationship) => relationship.type === type)
    .map((relationship) => relationship.rorId));
}

function directRelationship(left, right) {
  const rightIds = new Set([right.sourceRorId, right.canonicalRorId].filter(Boolean));
  const leftIds = new Set([left.sourceRorId, left.canonicalRorId].filter(Boolean));
  if (left.organizationScope === 'subunit' && rightIds.has(left.parentRorId)) {
    return 'left_child_of_right';
  }
  if (right.organizationScope === 'subunit' && leftIds.has(right.parentRorId)) {
    return 'left_parent_of_right';
  }
  const leftHas = (type) => [...relationshipIds(left, type)].some((id) => rightIds.has(id));
  const rightHas = (type) => [...relationshipIds(right, type)].some((id) => leftIds.has(id));

  if (leftHas('parent') || rightHas('child')) return 'left_child_of_right';
  if (leftHas('child') || rightHas('parent')) return 'left_parent_of_right';
  return null;
}

function relatedOther(left, right) {
  const rightIds = new Set([right.sourceRorId, right.canonicalRorId].filter(Boolean));
  const leftIds = new Set([left.sourceRorId, left.canonicalRorId].filter(Boolean));
  const weakTypes = new Set(['related', 'successor', 'predecessor']);
  return left.relationships.some((relationship) => (
    weakTypes.has(relationship.type) && rightIds.has(relationship.rorId)
  )) || right.relationships.some((relationship) => (
    weakTypes.has(relationship.type) && leftIds.has(relationship.rorId)
  ));
}

function relationshipBetween(leftResolution, rightResolution) {
  const left = normalizeResolution(leftResolution);
  const right = normalizeResolution(rightResolution);
  if (left.status !== 'resolved' || right.status !== 'resolved') {
    return { relationship: 'unresolved', direction: null, reason: 'operand_unresolved' };
  }

  // Source identity is checked before canonical identity so a
  // successor/predecessor canonicalization cannot silently become `same`.
  if (left.sourceRorId && left.sourceRorId === right.sourceRorId) {
    return { relationship: 'same', direction: null, reason: 'same_source_ror' };
  }
  if (
    left.organizationScope === 'subunit'
    && right.organizationScope === 'subunit'
    && left.parentRorId === right.parentRorId
  ) {
    return {
      relationship: 'unresolved',
      direction: null,
      reason: 'shared_parent_subunit_identity_unresolved',
    };
  }
  const direction = directRelationship(left, right);
  if (direction) {
    return { relationship: 'parent_child', direction, reason: 'typed_parent_child' };
  }

  const leftParents = relationshipIds(left, 'parent');
  const rightParents = relationshipIds(right, 'parent');
  if ([...leftParents].some((id) => rightParents.has(id))) {
    return { relationship: 'sibling', direction: null, reason: 'shared_parent' };
  }

  if (left.canonicalRorId === right.canonicalRorId || relatedOther(left, right)) {
    return { relationship: 'related_other', direction: null, reason: 'typed_related' };
  }
  return { relationship: 'distinct', direction: null, reason: 'resolved_without_relationship' };
}

function evidenceContext(relationship, left, right, hasAdditionalAffiliations) {
  if (left.authorSpecific !== true) return 'unresolved';
  if (relationship === 'same' || relationship === 'parent_child') {
    return hasAdditionalAffiliations ? 'compatible_with_additional' : 'compatible';
  }
  if (relationship === 'unresolved') return 'unresolved';
  if (left.currentness === 'historical' || right.currentness === 'historical') {
    return relationship === 'related_other' ? 'historical_related' : 'historical_difference';
  }
  if (left.currentness === 'current' && right.currentness === 'current') {
    return relationship === 'related_other' ? 'current_related_unclear' : 'current_conflict';
  }
  return relationship === 'related_other' ? 'related_unknown_time' : 'difference_unknown_time';
}

function relationshipPriority(value) {
  return ({ same: 0, parent_child: 1, sibling: 2, related_other: 3, distinct: 4, unresolved: 5 })[value] ?? 99;
}

function assessAffiliationRelationship({ evidenceAssertion, recordedAssertion } = {}) {
  const evidence = createAffiliationAssertion(evidenceAssertion);
  const recorded = createAffiliationAssertion(recordedAssertion);
  const comparisons = [];
  for (let leftIndex = 0; leftIndex < evidence.segments.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < recorded.segments.length; rightIndex += 1) {
      comparisons.push({
        leftIndex,
        rightIndex,
        ...relationshipBetween(
          evidence.segments[leftIndex].resolution,
          recorded.segments[rightIndex].resolution,
        ),
      });
    }
  }

  const compatible = comparisons
    .filter((item) => item.relationship === 'same' || item.relationship === 'parent_child')
    .sort((a, b) => relationshipPriority(a.relationship) - relationshipPriority(b.relationship))[0];
  let selected = compatible || null;
  if (!selected) {
    const hasUnresolved = comparisons.some((item) => item.relationship === 'unresolved');
    const decided = comparisons.filter((item) => item.relationship !== 'unresolved')
      .sort((a, b) => relationshipPriority(a.relationship) - relationshipPriority(b.relationship));
    // A partially failed multi-organization assertion cannot be declared
    // distinct merely because another cross-product happened to resolve.
    selected = hasUnresolved
      ? { relationship: 'unresolved', direction: null, reason: 'partial_resolution', leftIndex: null, rightIndex: null }
      : decided[0] || { relationship: 'unresolved', direction: null, reason: 'no_comparisons', leftIndex: null, rightIndex: null };
  }

  const additionalAffiliations = compatible
    ? evidence.segments.filter((_segment, index) => index !== compatible.leftIndex)
    : [];
  const context = evidenceContext(
    selected.relationship,
    evidence,
    recorded,
    additionalAffiliations.length > 0,
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    relationship: selected.relationship,
    direction: selected.direction,
    reason: selected.reason,
    evidenceContext: context,
    matchedSegments: selected.leftIndex == null ? null : {
      evidenceIndex: selected.leftIndex,
      recordedIndex: selected.rightIndex,
    },
    evidenceAssertion: evidence,
    recordedAssertion: recorded,
    additionalAffiliations,
    comparisons,
  };
}

function normalizeIndependentIdentity(value) {
  const valid = value
    && typeof value.sufficient === 'boolean'
    && value.excludesAffiliation === true
    && bounded(value.evaluatorVersion, 100);
  return {
    available: Boolean(valid),
    sufficient: valid ? value.sufficient : false,
    excludesAffiliation: value?.excludesAffiliation === true,
    evaluatorVersion: valid ? bounded(value.evaluatorVersion, 100) : null,
    evidence: Array.isArray(value?.evidence)
      ? value.evidence.slice(0, 12).map((item) => bounded(item, 120)).filter(Boolean)
      : [],
  };
}

function remedyFor(reason) {
  if (reason === 'provider_failure') return ['retry_enrichment'];
  if (reason === 'current_conflict' || reason === 'current_related_unclear') {
    return ['confirm_identity', 'correct_current_institution', 'record_joint_appointment', 'not_a_fit'];
  }
  return ['confirm_identity', 'add_authoritative_evidence', 'not_a_fit'];
}

function evaluateAffiliationPolicy({ assessment, consumer, independentIdentity } = {}) {
  const identity = normalizeIndependentIdentity(independentIdentity);
  const relationshipKnown = RELATIONSHIPS.includes(assessment?.relationship);
  const relationship = relationshipKnown
    ? assessment.relationship
    : 'unresolved';
  const suppliedContext = bounded(assessment?.evidenceContext, 80);
  const contextKnown = EVIDENCE_CONTEXTS.has(suppliedContext);
  const context = contextKnown ? suppliedContext : 'unresolved';
  const providerFailure = [
    ...(assessment?.evidenceAssertion?.segments || []),
    ...(assessment?.recordedAssertion?.segments || []),
  ].some((segment) => segment?.resolution?.reason === 'provider_failure');
  const knownConsumer = CONSUMERS.has(consumer);
  const highAuthority = HIGH_AUTHORITY_CONSUMERS.has(consumer) || !knownConsumer;

  const base = {
    policyVersion: POLICY_VERSION,
    consumer: knownConsumer ? consumer : 'unknown',
    relationship,
    evidenceContext: context,
    independentIdentity: identity,
    effect: 'neutral',
    action: 'none',
    reason: 'affiliation_neutral',
    remedies: [],
  };

  if (!knownConsumer) {
    return {
      ...base,
      effect: 'hold',
      action: 'block_unknown_consumer',
      reason: 'unknown_consumer',
      remedies: ['operator_review'],
    };
  }

  if (highAuthority && (!relationshipKnown || !contextKnown)) {
    return {
      ...base,
      effect: 'hold',
      action: 'block_unknown_relationship_contract',
      reason: !relationshipKnown ? 'unknown_relationship' : 'unknown_evidence_context',
      remedies: ['operator_review'],
    };
  }

  const compatible = (
    relationship === 'same' || relationship === 'parent_child'
  ) && (
    context === 'compatible' || context === 'compatible_with_additional'
  );
  const currentConflict = context === 'current_conflict' || context === 'current_related_unclear';
  const historical = context === 'historical_difference' || context === 'historical_related';

  if (consumer === 'staff_notification') {
    if (compatible) return { ...base, effect: 'neutral', action: 'suppress_mismatch', reason: context };
    if (currentConflict) return { ...base, effect: 'hold', action: 'alert_with_correction_path', reason: context, remedies: remedyFor(context) };
    if (historical) return { ...base, action: 'informational_career_history', reason: context };
    return { ...base, action: providerFailure ? 'operational_retry_note' : 'comparison_unavailable_note', reason: providerFailure ? 'provider_failure' : context, remedies: providerFailure ? remedyFor('provider_failure') : [] };
  }

  if (consumer === 'candidate_card') {
    if (compatible) return { ...base, action: context === 'compatible_with_additional' ? 'show_additional_affiliation_note' : 'clear_institution_warning', reason: context };
    if (currentConflict) return { ...base, effect: 'hold', action: 'show_current_conflict', reason: context, remedies: remedyFor(context) };
    if (historical) return { ...base, action: 'show_career_history_note', reason: context };
    if (identity.available && identity.sufficient) return { ...base, action: providerFailure ? 'show_retry_without_identity_hold' : 'show_unresolved_nonblocking', reason: providerFailure ? 'provider_failure' : context, remedies: providerFailure ? remedyFor('provider_failure') : [] };
    return { ...base, effect: 'hold', action: providerFailure ? 'show_retry_hold' : 'show_identity_remedy', reason: providerFailure ? 'provider_failure' : 'independent_identity_insufficient', remedies: remedyFor(providerFailure ? 'provider_failure' : context) };
  }

  if (consumer === 'identity_anchor') {
    if (compatible) return { ...base, effect: 'corroborating_only', action: relationship === 'same' ? 'add_same_affiliation_weight' : 'add_parent_child_affiliation_weight', reason: context };
    if (currentConflict) return { ...base, effect: 'veto', action: 'record_current_contradiction', reason: context, remedies: remedyFor(context) };
    return { ...base, action: 'no_affiliation_weight', reason: providerFailure ? 'provider_failure' : context };
  }

  if (compatible) {
    return { ...base, action: 'allow_if_other_identity_gates_pass', reason: context };
  }
  if (currentConflict) {
    return { ...base, effect: 'veto', action: 'hold_for_identity_or_institution_correction', reason: context, remedies: remedyFor(context) };
  }
  if (identity.available && identity.sufficient) {
    return { ...base, action: 'allow_if_other_identity_gates_pass', reason: providerFailure ? 'provider_failure_neutral' : context };
  }
  return {
    ...base,
    effect: highAuthority ? 'hold' : 'neutral',
    action: providerFailure ? 'hold_for_provider_retry' : 'hold_for_independent_identity',
    reason: providerFailure ? 'provider_failure' : (identity.available ? 'independent_identity_insufficient' : 'independent_identity_unavailable'),
    remedies: remedyFor(providerFailure ? 'provider_failure' : context),
  };
}

module.exports = {
  CONSUMERS,
  POLICY_VERSION,
  RELATIONSHIPS,
  SCHEMA_VERSION,
  assessAffiliationRelationship,
  createAffiliationAssertion,
  evaluateAffiliationPolicy,
  normalizeIndependentIdentity,
  relationshipBetween,
};
