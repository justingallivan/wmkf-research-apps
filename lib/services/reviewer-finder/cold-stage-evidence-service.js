/**
 * Reviewer Find cold stage-evidence coordinator.
 *
 * This is deliberately a server-only, provider-free seam.  A route adapter
 * must first verify the request-scoped discovery-candidate attestation and
 * supply server-computed stage results as injected projectors.  Browser DTOs,
 * browser receipts, and browser source versions are not inputs to this
 * module.  The coordinator then derives the only accepted source version from
 * the shared dependency snapshot immediately before each projection.
 */

const { reviewerCandidateKey } = require('../../utils/reviewer-candidate-key');
const { projectStageEnvelope } = require('../workbench/reviewer-stage-projector');
const {
  buildReviewerStageDependencySnapshot,
} = require('../workbench/reviewer-stage-source-versions');

const COLD_STAGE_ORDER = Object.freeze([
  'applicant_anchor',
  'identity',
  'institution_domains',
  'institution_coi',
  'coauthor_coi',
  'eligibility',
  'contact',
  'address_trust',
]);

const CANONICAL_CANDIDATE_KEY = /^(?:suggestion|person|orcid|openalex|scholar|seed):[^\s:]{1,512}$/;
const SOURCE_INPUT_KEYS = Object.freeze({
  institution_domains: Object.freeze(['institutionDomainEvidence']),
  coauthor_coi: Object.freeze(['proposalAuthorVersion']),
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isOpaqueHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function canonicalCandidate(candidate) {
  if (!isPlainObject(candidate)) return null;
  const candidateKey = reviewerCandidateKey(candidate);
  if (!candidateKey || !CANONICAL_CANDIDATE_KEY.test(candidateKey)) return null;

  // Stale/browser-provided receipts must never contribute to a cold snapshot.
  // Identity/domain/author values are reconstructed only by accepted envelopes
  // (or narrowly declared source preflight inputs below).
  const {
    stageFreshness,
    stageEvidence,
    stageRefresh,
    applicantInputVersion,
    proposalContentVersion,
    proposalAuthorVersion,
    institutionDomainEvidence,
    identityEvidence,
    identityDecision,
    identityStatus,
    identityResolverVersion,
    identityResolvedAt,
    canonicalPersonId,
    canonicalPersonEtag,
    personEtag,
    staffIdentityConfirmation,
    pdIdentityConfirmed,
    pdIdentityConfirmationId,
    addressTrustReceipt,
    ...serverProjection
  } = candidate;
  return { ...serverProjection, candidateKey };
}

function sourceInputCandidate(candidate, stage, sourceInputPatch) {
  if (sourceInputPatch === undefined || sourceInputPatch === null) return { ok: true, candidate };
  if (!isPlainObject(sourceInputPatch)) return { ok: false, code: 'invalid_source_input' };
  const allowed = SOURCE_INPUT_KEYS[stage] || [];
  const keys = Object.keys(sourceInputPatch);
  if (keys.length === 0 || keys.some((key) => !allowed.includes(key))) {
    return { ok: false, code: 'invalid_source_input' };
  }
  if (stage === 'institution_domains') {
    const fingerprint = sourceInputPatch?.institutionDomainEvidence?.inputFingerprint;
    if (!isPlainObject(sourceInputPatch.institutionDomainEvidence) || !isOpaqueHash(fingerprint)) {
      return { ok: false, code: 'invalid_source_input' };
    }
  }
  if (stage === 'coauthor_coi' && !isOpaqueHash(sourceInputPatch.proposalAuthorVersion)) {
    return { ok: false, code: 'invalid_source_input' };
  }
  return { ok: true, candidate: { ...candidate, ...sourceInputPatch } };
}

function sourceInputSurvivesProjection(stage, sourceInputPatch, evidencePatch) {
  if (!sourceInputPatch) return true;
  if (stage === 'institution_domains') {
    return sourceInputPatch.institutionDomainEvidence.inputFingerprint
      === evidencePatch?.institutionDomainEvidence?.inputFingerprint;
  }
  if (stage === 'coauthor_coi') {
    return sourceInputPatch.proposalAuthorVersion === evidencePatch?.proposalAuthorVersion;
  }
  return false;
}

function toBoundedEnvelope(projected) {
  return {
    outcome: projected.receipt.state,
    evidencePatch: projected.evidencePatch,
    receipt: projected.receipt,
  };
}

function mergeProjectedStage(candidate, stage, projected) {
  return {
    ...candidate,
    ...projected.evidencePatch,
    stageFreshness: {
      ...(candidate.stageFreshness || {}),
      [stage]: projected.receipt,
    },
  };
}

function stagePlanIndex(stage) {
  return COLD_STAGE_ORDER.indexOf(stage);
}

function validStagePlans(stagePlans) {
  if (!Array.isArray(stagePlans) || stagePlans.length !== COLD_STAGE_ORDER.length) return false;
  return stagePlans.every((plan, index) => (
    isPlainObject(plan)
    && plan.stage === COLD_STAGE_ORDER[index]
    && typeof plan.project === 'function'
  ));
}

function result({ candidate, stageEvidence, snapshot, outcome, code = null, failedStage = null }) {
  return {
    candidate,
    stageEvidence,
    snapshot,
    outcome,
    // Incomplete/failed envelopes are valuable durable state: they preserve
    // work that completed before the first failed dependency and let warm
    // planning resume at the exact stage.  Terminal authority remains absent
    // unless every upstream receipt is current or not-applicable.
    persistable: !!(
      isPlainObject(candidate)
      && CANONICAL_CANDIDATE_KEY.test(candidate.candidateKey || '')
      && isPlainObject(stageEvidence)
      && Object.keys(stageEvidence).length > 0
    ),
    ...(code ? { code } : {}),
    ...(failedStage ? { failedStage } : {}),
  };
}

/**
 * Sequentially project the complete cold evidence chain for one candidate.
 * Every stage projector receives the snapshot-computed `expectedSourceVersion`
 * and must return a producer envelope using that exact source version.
 */
async function projectColdStageEvidence({
  candidate: suppliedCandidate,
  stagePlans,
  requestId,
  applicantInputVersion = null,
  proposalContentVersion = null,
  requestCoiContextVersion = null,
  completedAt,
} = {}) {
  const baseCandidate = canonicalCandidate(suppliedCandidate);
  if (!baseCandidate) {
    return result({
      candidate: isPlainObject(suppliedCandidate) ? suppliedCandidate : null,
      stageEvidence: {},
      snapshot: null,
      outcome: 'partial',
      code: 'canonical_candidate_unavailable',
    });
  }
  if (!validStagePlans(stagePlans)) {
    return result({
      candidate: baseCandidate,
      stageEvidence: {},
      snapshot: null,
      outcome: 'partial',
      code: 'invalid_stage_plan',
    });
  }

  let workingCandidate = baseCandidate;
  const stageEvidence = {};
  let latestSnapshot = null;

  for (const plan of stagePlans) {
    const stage = plan.stage;
    if (stagePlanIndex(stage) < 0) {
      return result({
        candidate: workingCandidate,
        stageEvidence,
        snapshot: latestSnapshot,
        outcome: 'partial',
        code: 'invalid_stage_plan',
        failedStage: stage,
      });
    }
    const prepared = sourceInputCandidate(workingCandidate, stage, plan.sourceInputPatch);
    if (!prepared.ok) {
      return result({
        candidate: workingCandidate,
        stageEvidence,
        snapshot: latestSnapshot,
        outcome: 'partial',
        code: prepared.code,
        failedStage: stage,
      });
    }
    latestSnapshot = buildReviewerStageDependencySnapshot({
      candidate: prepared.candidate,
      requestId,
      applicantInputVersion,
      proposalContentVersion,
      requestCoiContextVersion,
    });
    const expectedSourceVersion = latestSnapshot.stageInputVersions[stage];
    if (!expectedSourceVersion) {
      return result({
        candidate: workingCandidate,
        stageEvidence,
        snapshot: latestSnapshot,
        outcome: 'partial',
        code: 'stage_source_unavailable',
        failedStage: stage,
      });
    }

    let envelope;
    try {
      envelope = await plan.project({
        candidate: prepared.candidate,
        stage,
        expectedSourceVersion,
        requestId,
        applicantInputVersion,
        proposalContentVersion,
        requestCoiContextVersion,
        completedAt,
      });
    } catch {
      return result({
        candidate: workingCandidate,
        stageEvidence,
        snapshot: latestSnapshot,
        outcome: 'partial',
        code: 'stage_projection_failed',
        failedStage: stage,
      });
    }
    if (envelope?.receipt?.sourceVersion !== expectedSourceVersion) {
      return result({
        candidate: workingCandidate,
        stageEvidence,
        snapshot: latestSnapshot,
        outcome: 'partial',
        code: 'stage_source_version_mismatch',
        failedStage: stage,
      });
    }
    const projected = projectStageEnvelope({ stage, mode: 'cold_emit', envelope });
    if (!projected.ok) {
      return result({
        candidate: workingCandidate,
        stageEvidence,
        snapshot: latestSnapshot,
        outcome: 'partial',
        code: projected.code,
        failedStage: stage,
      });
    }
    if (!sourceInputSurvivesProjection(stage, plan.sourceInputPatch, projected.value.evidencePatch)) {
      return result({
        candidate: workingCandidate,
        stageEvidence,
        snapshot: latestSnapshot,
        outcome: 'partial',
        code: 'stage_source_input_mismatch',
        failedStage: stage,
      });
    }
    stageEvidence[stage] = toBoundedEnvelope(projected.value);
    workingCandidate = mergeProjectedStage(workingCandidate, stage, projected.value);
    if (!['current', 'not_applicable'].includes(projected.value.receipt.state)) {
      return result({
        candidate: workingCandidate,
        stageEvidence,
        snapshot: latestSnapshot,
        outcome: 'partial',
        code: 'stage_incomplete',
        failedStage: stage,
      });
    }
  }

  return result({
    candidate: workingCandidate,
    stageEvidence,
    snapshot: buildReviewerStageDependencySnapshot({
      candidate: workingCandidate,
      requestId,
      applicantInputVersion,
      proposalContentVersion,
      requestCoiContextVersion,
    }),
    outcome: 'ready',
  });
}

/**
 * Return only entries safe to hand to `recordSurfacedWithStageEvidence`.
 * Noncanonical and empty rows remain display-only. A partial canonical row may
 * persist the bounded receipts it completed so warm planning resumes at the
 * first missing stage; it never receives terminal roster authority.
 */
function coldPersistenceEntry(projected, { expectedUpdatedAt = null } = {}) {
  if (!projected?.persistable || !isPlainObject(projected.candidate)
    || !CANONICAL_CANDIDATE_KEY.test(projected.candidate.candidateKey || '')
    || !isPlainObject(projected.stageEvidence) || Object.keys(projected.stageEvidence).length === 0) {
    return null;
  }
  return {
    candidate: projected.candidate,
    stageEvidence: projected.stageEvidence,
    ...(typeof expectedUpdatedAt === 'string' && expectedUpdatedAt.trim()
      ? { expectedUpdatedAt: expectedUpdatedAt.trim() }
      : {}),
  };
}

async function projectColdStageEvidenceBatch({ entries, ...shared } = {}) {
  return Promise.all((Array.isArray(entries) ? entries : []).map(async (entry) => {
    const projected = await projectColdStageEvidence({
      ...shared,
      candidate: entry?.candidate,
      stagePlans: entry?.stagePlans,
    });
    return {
      ...projected,
      persistenceEntry: coldPersistenceEntry(projected, { expectedUpdatedAt: entry?.expectedUpdatedAt }),
    };
  }));
}

module.exports = {
  COLD_STAGE_ORDER,
  SOURCE_INPUT_KEYS,
  canonicalCandidate,
  projectColdStageEvidence,
  projectColdStageEvidenceBatch,
  coldPersistenceEntry,
};
