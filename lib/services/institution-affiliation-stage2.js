'use strict';

/**
 * Stage 2 institution presentation orchestration.
 *
 * This service may decide notification and explanatory-card copy only. It does
 * not expose a selection, identity, or write decision to runtime callers.
 */

const {
  assessAffiliationRelationship,
  evaluateAffiliationPolicy,
} = require('./institution-affiliation-assessment');
const {
  createRorAffiliationAssertionResolver,
} = require('./ror-affiliation-assertion-resolver');
const {
  createRorCandidateUnionAdapter,
} = require('./ror-institution-candidate-adapter');
const {
  INSTITUTION_STAGE2_PRESENTATION_VERSION,
} = require('../../shared/utils/institution-stage2-presentation');

const REMEDIES = new Set([
  'confirm_identity',
  'correct_current_institution',
  'record_joint_appointment',
  'not_a_fit',
  'retry_enrichment',
  'add_authoritative_evidence',
  'operator_review',
]);

function bounded(value, max = 180) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safeRemedies(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => REMEDIES.has(value)))];
}

function hasProviderFailure(assessment) {
  return [
    ...(assessment?.evidenceAssertion?.segments || []),
    ...(assessment?.recordedAssertion?.segments || []),
  ].some((segment) => segment?.resolution?.reason === 'provider_failure');
}

function compactBase({ assessment, policy, legacyHold = false }) {
  return {
    version: INSTITUTION_STAGE2_PRESENTATION_VERSION,
    relationship: assessment?.relationship || 'unresolved',
    evidenceContext: assessment?.evidenceContext || 'unresolved',
    evidenceInstitution: bounded(assessment?.evidenceAssertion?.rawText) || null,
    recordedInstitution: bounded(assessment?.recordedAssertion?.rawText) || null,
    remedies: safeRemedies(policy?.remedies),
    legacyHold: legacyHold === true,
  };
}

function institutionPair(base) {
  const evidence = base.evidenceInstitution || 'the source affiliation';
  const recorded = base.recordedInstitution || 'the recorded affiliation';
  return { evidence, recorded };
}

function projectCandidateCard({ assessment, policy, legacyHold }) {
  const base = compactBase({ assessment, policy, legacyHold });
  const { evidence, recorded } = institutionPair(base);
  const providerFailure = hasProviderFailure(assessment);

  if (policy?.action === 'clear_institution_warning') {
    if (!base.legacyHold) {
      return { ...base, visible: false, kind: 'compatible', tone: 'neutral', heading: null, detail: null };
    }
    return {
      ...base,
      visible: true,
      kind: 'compatible',
      tone: 'neutral',
      heading: 'Affiliations appear compatible',
      detail: `${evidence} and ${recorded} resolve as compatible. Existing identity verification still requires confirmation before Invite.`,
      remedies: ['confirm_identity', 'not_a_fit'],
    };
  }

  if (policy?.action === 'show_additional_affiliation_note') {
    const additional = (assessment?.additionalAffiliations || [])
      .map((segment) => bounded(segment?.rawText))
      .filter(Boolean);
    return {
      ...base,
      visible: true,
      kind: 'additional',
      tone: 'neutral',
      heading: 'Additional affiliation',
      detail: additional.length > 0
        ? `${evidence} is compatible with ${recorded}; additional affiliation${additional.length === 1 ? '' : 's'}: ${additional.join('; ')}.`
        : `${evidence} is compatible with ${recorded} and includes additional affiliation evidence.`,
    };
  }

  if (policy?.action === 'show_current_conflict') {
    return {
      ...base,
      visible: true,
      kind: 'current_conflict',
      tone: 'warning',
      heading: 'Current affiliations conflict',
      detail: `Current evidence lists ${evidence}, while the recorded affiliation is ${recorded}. Confirm the person and correct or explain the affiliation before Invite.`,
    };
  }

  if (policy?.action === 'show_career_history_note') {
    return {
      ...base,
      visible: true,
      kind: 'historical',
      tone: 'neutral',
      heading: 'Earlier affiliation',
      detail: `Earlier work lists ${evidence}; the recorded affiliation is ${recorded}. No institution correction is required from this evidence alone.`,
    };
  }

  if (providerFailure) {
    return {
      ...base,
      visible: true,
      kind: 'provider_failure',
      tone: 'warning',
      heading: 'Institution comparison unavailable',
      detail: `The institution service could not compare ${evidence} with ${recorded}. Retry enrichment; this is not a confirmed mismatch.`,
      remedies: ['retry_enrichment'],
    };
  }

  return {
    ...base,
    visible: true,
    kind: 'unresolved',
    tone: 'neutral',
    heading: 'Institution comparison unresolved',
    detail: `The available evidence could not establish whether ${evidence} and ${recorded} are compatible. This is not a confirmed mismatch.`,
  };
}

function projectStaffNotification({ assessment, policy }) {
  const base = compactBase({ assessment, policy });
  const { evidence, recorded } = institutionPair(base);
  const providerFailure = hasProviderFailure(assessment);

  if (policy?.action === 'suppress_mismatch') {
    return { ...base, notify: false, kind: 'compatible', severity: 'info', title: null, detail: null };
  }
  if (policy?.action === 'alert_with_correction_path') {
    return {
      ...base,
      notify: true,
      kind: 'current_conflict',
      severity: 'warning',
      title: 'Reviewer reported a current affiliation conflict',
      detail: `The reviewer reported ${evidence}, while the linked CRM contact lists ${recorded}. Confirm the correct current institution, record a joint appointment, or correct the linked record.`,
    };
  }
  if (policy?.action === 'informational_career_history') {
    return {
      ...base,
      notify: true,
      kind: 'historical',
      severity: 'info',
      title: 'Reviewer affiliation may reflect career history',
      detail: `Earlier evidence lists ${evidence}; the linked CRM contact lists ${recorded}. This is informational and not a confirmed current mismatch.`,
    };
  }
  if (providerFailure) {
    return {
      ...base,
      notify: true,
      kind: 'provider_failure',
      severity: 'warning',
      title: 'Reviewer affiliation comparison unavailable',
      detail: `The institution service could not compare ${evidence} with ${recorded}. Retry the comparison; no institution mismatch was confirmed.`,
      remedies: ['retry_enrichment'],
    };
  }
  return {
    ...base,
    notify: true,
    kind: 'unresolved',
    severity: 'info',
    title: 'Reviewer affiliation could not be compared',
    detail: `The available evidence could not establish whether ${evidence} and ${recorded} are compatible. This is nonblocking operational information, not a confirmed mismatch.`,
  };
}

function projectInstitutionStage2Presentation({ assessment, policy, consumer, legacyHold = false }) {
  if (consumer === 'candidate_card') {
    return projectCandidateCard({ assessment, policy, legacyHold });
  }
  if (consumer === 'staff_notification') {
    return projectStaffNotification({ assessment, policy });
  }
  throw new Error(`Stage 2 presentation does not support consumer ${consumer}`);
}

function createInstitutionStage2Evaluator({ assertionResolver, candidateAdapter } = {}) {
  const resolver = assertionResolver || createRorAffiliationAssertionResolver({
    candidateAdapter: candidateAdapter || createRorCandidateUnionAdapter({
      requestTimeoutMs: 4000,
      resolutionTimeoutMs: 8000,
      maxProviderRequestsPerResolution: 12,
    }),
  });

  async function evaluate({
    evidenceAssertion,
    recordedAssertion,
    consumer,
    independentIdentity,
    legacyHold = false,
  } = {}, { signal } = {}) {
    if (!evidenceAssertion?.rawText || !recordedAssertion?.rawText) {
      const missing = evidenceAssertion?.rawText ? 'recorded affiliation' : 'source affiliation';
      const base = {
        version: INSTITUTION_STAGE2_PRESENTATION_VERSION,
        relationship: 'unresolved',
        evidenceContext: 'unresolved',
        evidenceInstitution: bounded(evidenceAssertion?.rawText) || null,
        recordedInstitution: bounded(recordedAssertion?.rawText) || null,
        remedies: [],
        legacyHold: legacyHold === true,
      };
      if (consumer === 'staff_notification') {
        return {
          assessment: null,
          policy: null,
          presentation: {
            ...base,
            notify: true,
            kind: 'unresolved',
            severity: 'info',
            title: 'Reviewer affiliation could not be compared',
            detail: `The ${missing} is missing. This is nonblocking operational information, not a confirmed mismatch.`,
          },
        };
      }
      return {
        assessment: null,
        policy: null,
        presentation: {
          ...base,
          visible: true,
          kind: 'unresolved',
          tone: 'neutral',
          heading: 'Institution comparison unresolved',
          detail: `The ${missing} is missing. This is not a confirmed mismatch.`,
        },
      };
    }

    const [evidence, recorded] = await Promise.all([
      resolver.resolve(evidenceAssertion, { signal }),
      resolver.resolve(recordedAssertion, { signal }),
    ]);
    const assessment = assessAffiliationRelationship({
      evidenceAssertion: evidence,
      recordedAssertion: recorded,
    });
    const policy = evaluateAffiliationPolicy({ assessment, consumer, independentIdentity });
    return {
      assessment,
      policy,
      presentation: projectInstitutionStage2Presentation({
        assessment,
        policy,
        consumer,
        legacyHold,
      }),
    };
  }

  return Object.freeze({ evaluate });
}

module.exports = {
  PRESENTATION_VERSION: INSTITUTION_STAGE2_PRESENTATION_VERSION,
  createInstitutionStage2Evaluator,
  projectInstitutionStage2Presentation,
};
