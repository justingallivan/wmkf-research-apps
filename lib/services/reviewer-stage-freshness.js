/**
 * Server-owned Reviewer Find stage freshness contract. This module is pure:
 * callers supply authoritative request/version reads and a bounded roster DTO;
 * browser input cannot mark a stage current or choose invalidation scope.
 */

const STAGES = Object.freeze([
  'applicant_anchor', 'identity', 'institution_domains', 'institution_coi', 'coauthor_coi',
  'eligibility', 'contact', 'address_trust', 'roster_persistence',
]);
const {
  canonicalStoredReviewerCandidateKey,
  reviewerSuggestionCandidateKey,
} = require('../utils/reviewer-candidate-key');
const {
  isCandidateIdentityAuthoritySatisfied,
} = require('../utils/reviewer-identity-authority');
const {
  normalizeAddress,
  buildAttestation,
} = require('../utils/reviewer-address-trust');
const { mapLegacyStageEvidence } = require('./reviewer-legacy-evidence-compatibility');
const STATES = new Set(['current', 'stale', 'refreshing', 'incomplete', 'failed', 'not_applicable']);
const REASONS = new Set([
  'no_roster_history', 'candidate_added', 'candidate_missing', 'candidate_input_changed',
  'applicant_set_changed', 'proposal_binding_changed', 'proposal_content_changed',
  'warm_cache_version_changed', 'stage_contract_changed', 'stage_missing',
  'stage_incomplete', 'prior_write_incomplete', 'prior_refresh_incomplete',
  'authority_stale', 'engagement_changed', 'roster_snapshot_changed', 'manual_refresh',
  'unclassified_miss',
]);

const CONTRACT_VERSIONS = Object.freeze({
  applicant_anchor: 1, identity: 4, institution_domains: 1, institution_coi: 1, coauthor_coi: 1,
  eligibility: 1, contact: 1, address_trust: 1, roster_persistence: 1,
});
const DOWNSTREAM = Object.freeze({
  applicant_anchor: ['identity', 'institution_domains', 'institution_coi', 'coauthor_coi', 'eligibility', 'contact', 'address_trust', 'roster_persistence'],
  identity: ['institution_domains', 'institution_coi', 'coauthor_coi', 'eligibility', 'contact', 'address_trust', 'roster_persistence'],
  institution_domains: ['eligibility', 'contact', 'address_trust', 'roster_persistence'],
  institution_coi: ['roster_persistence'], coauthor_coi: ['roster_persistence'],
  eligibility: ['roster_persistence'], contact: ['address_trust', 'roster_persistence'],
  address_trust: ['roster_persistence'], roster_persistence: [],
});
// Configurable/versioned policy. Deliberately no default identity TTL.
const DEFAULT_AGE_POLICY = Object.freeze({ version: 1, leaseMs: 15 * 60 * 1000, stages: {} });
const WARM_CACHE_VERSION = 1;
// A display-only bridge for pre-stage-freshness roster rows. This version is
// intentionally distinct from WARM_CACHE_VERSION: it never certifies current
// stage evidence or promotion authority.
const LEGACY_SELECTION_PROJECTION_VERSION = 1;
function canonicalIso(value) { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false; try { return new Date(value).toISOString() === value; } catch { return false; } }
function boundedVersion(value) { return typeof value === 'string' && value.length > 0 && value.length <= 160; }

function candidateIdentity(candidate) {
  const key = typeof candidate?.candidateKey === 'string' ? candidate.candidateKey.trim() : '';
  if (key) return canonicalStoredReviewerCandidateKey(key);
  const suggestionId = typeof candidate?.suggestionId === 'string' ? candidate.suggestionId.trim() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suggestionId)
    ? reviewerSuggestionCandidateKey(suggestionId) : null;
}
function validReason(reason) { return REASONS.has(reason) ? reason : 'unclassified_miss'; }

function receiptlessLegacyCandidate(candidate) {
  const stageFreshness = candidate?.stageFreshness;
  const stageRefresh = candidate?.stageRefresh;
  const noCompletedReceipts = stageFreshness === undefined
    || (stageFreshness && typeof stageFreshness === 'object'
      && !Array.isArray(stageFreshness) && Object.keys(stageFreshness).length === 0);
  const noLiveLease = stageRefresh === undefined
    || (stageRefresh && typeof stageRefresh === 'object'
      && !Array.isArray(stageRefresh) && Object.keys(stageRefresh).length === 0);
  // Rows from the new producer contract that merely lost one receipt must use
  // normal targeted repair. This bridge is only for unversioned, pre-contract
  // history and cannot be used to bypass a missing modern receipt.
  return noCompletedReceipts
    && noLiveLease
    && candidate?.warmCacheVersion === undefined
    && candidate?.applicantInputVersion === undefined
    && candidate?.proposalContentVersion === undefined;
}

function legacyAddressAttestation(candidate, { requestId, candidateKey, email } = {}) {
  const receipt = candidate?.addressTrustReceipt;
  const normalizedEmail = normalizeAddress(email);
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.personConfirmed !== true
    || typeof receipt.receiptId !== 'string' || !/^[0-9a-f-]{36}$/i.test(receipt.receiptId)
    || receipt.requestId !== requestId
    || receipt.candidateKey !== candidateKey
    || normalizeAddress(receipt.email) !== normalizedEmail
    || !normalizedEmail
    || typeof receipt.actorProfileId !== 'string' || receipt.actorProfileId.trim().length === 0
    || receipt.actorProfileId.trim().length > 128
    || typeof receipt.actorSystemUserId !== 'string' || receipt.actorSystemUserId.trim().length === 0
    || receipt.actorSystemUserId.trim().length > 128
    || typeof receipt.canonicalPersonId !== 'string' || receipt.canonicalPersonId.trim().length === 0
    || receipt.canonicalPersonId.trim().length > 80
    || typeof receipt.canonicalPersonEtag !== 'string' || receipt.canonicalPersonEtag.trim().length === 0
    || receipt.canonicalPersonEtag.trim().length > 240) return null;
  try {
    const attestation = buildAttestation({
      actorProfileId: receipt.actorProfileId,
      actorSystemUserId: receipt.actorSystemUserId,
      requestId,
      candidateKey,
      evidenceType: receipt.evidenceType,
      evidenceUrl: receipt.evidenceUrl,
      note: receipt.note,
      attestedAt: receipt.attestedAt,
    });
    return { evidenceCheckedAt: attestation.attestedAt };
  } catch {
    return null;
  }
}

function legacyAutomatedAttestation(candidate, automatedAttestation) {
  const resolvedAt = candidate?.contactEnrichment?.identity?.resolvedAt;
  if (
    automatedAttestation?.valid !== true
    || automatedAttestation?.historicalSelection !== true
    || automatedAttestation?.identityDecisionBound !== true
    || automatedAttestation?.eligibilityEvidenceBound !== true
    || !canonicalIso(automatedAttestation?.issuedAt)
    || !canonicalIso(resolvedAt)
  ) return null;
  return { evidenceCheckedAt: automatedAttestation.issuedAt };
}

function legacySelectionCandidateKey(candidate, contact) {
  const candidateKey = candidateIdentity(candidate);
  const storedEmail = normalizeAddress(candidate?.email || candidate?.contactEnrichment?.email);
  if (!candidateKey || !receiptlessLegacyCandidate(candidate)
    || !isCandidateIdentityAuthoritySatisfied(candidate)
    || contact?.decision !== 'ready'
    || !storedEmail
    || storedEmail !== normalizeAddress(contact?.email)) return null;
  return candidateKey;
}

/**
 * Strict compatibility projection for a pre-stage-freshness roster row.
 *
 * `contact` must be an independently computed, server-side contact projection
 * from the stored candidate. The returned marker is presentation/selection
 * only: callers must keep promotion authority blocked and never persist it.
 */
function projectLegacySelectionProjection(candidate, { requestId, contact, automatedAttestation } = {}) {
  const candidateKey = legacySelectionCandidateKey(candidate, contact);
  if (!candidateKey) return null;
  const attestation = legacyAutomatedAttestation(candidate, automatedAttestation)
    || legacyAddressAttestation(candidate, {
      requestId,
      candidateKey,
      email: contact.email,
    });
  if (!attestation) return null;
  return {
    version: LEGACY_SELECTION_PROJECTION_VERSION,
    state: 'selectable',
    evidenceCheckedAt: attestation.evidenceCheckedAt,
  };
}

function stageReceipt(candidate, stage, authoritative) {
  const direct = candidate?.stageFreshness?.[stage];
  if (direct && typeof direct === 'object') return direct;
  return mapLegacyStage(candidate, stage, authoritative);
}
function stageLease(candidate, stage) {
  const lease = candidate?.stageRefresh?.[stage];
  return lease && typeof lease === 'object' && !Array.isArray(lease) ? lease : null;
}
function validLeaseAttemptId(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.trim().length <= 128
    && !/[\u0000-\u001f\u007f]/.test(value);
}
function candidateStageLease(candidate, { now = Date.now(), policy = DEFAULT_AGE_POLICY } = {}) {
  const stageRefresh = candidate?.stageRefresh;
  if (!stageRefresh || typeof stageRefresh !== 'object' || Array.isArray(stageRefresh)) return null;
  const stageOrder = [
    ...STAGES,
    ...Object.keys(stageRefresh).filter((stage) => !STAGES.includes(stage)).sort(),
  ];
  for (const stage of stageOrder) {
    if (!Object.prototype.hasOwnProperty.call(stageRefresh, stage)) continue;
    const lease = stageRefresh[stage];
    // Only the current canonical lease fields can be recovered.  Historical
    // aliases are displayable corruption, not authority to clear a row lock.
    const startedAt = lease?.refreshStartedAt;
    const attemptId = lease?.refreshAttemptId;
    const leaseMs = policy?.leaseMs;
    const valid = STAGES.includes(stage)
      && lease && typeof lease === 'object' && !Array.isArray(lease)
      && canonicalIso(startedAt)
      && validLeaseAttemptId(attemptId)
      && Number.isFinite(leaseMs)
      && leaseMs > 0;
    return {
      stage,
      lease,
      valid,
      expired: valid && now - Date.parse(startedAt) > leaseMs,
    };
  }
  return null;
}
// Legacy is current only through the strict, versioned compatibility mapper.
function mapLegacyStage(candidate, stage, authoritative = {}) {
  return mapLegacyStageEvidence({
    candidate,
    stage,
    authoritative,
    contractVersion: CONTRACT_VERSIONS[stage],
  }).receipt;
}
function isExpired(receipt, stage, now, policy) {
  if (stage === 'identity' || stage === 'applicant_anchor' || stage === 'roster_persistence' || stage === 'coauthor_coi') return false;
  const maxAgeMs = policy?.stages?.[stage]?.maxAgeMs;
  if (Object.prototype.hasOwnProperty.call(policy?.stages?.[stage] || {}, 'maxAgeMs') && (!Number.isFinite(maxAgeMs) || maxAgeMs < 0)) return null;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) return false;
  const completed = Date.parse(receipt?.completedAt || '');
  return !Number.isFinite(completed) || now - completed > maxAgeMs;
}
function addInvalidation(set, stage) {
  set.add(stage);
  for (const downstream of DOWNSTREAM[stage] || []) set.add(downstream);
}

function planCandidateFreshness({ candidate, authoritative = {}, now = Date.now(), policy = DEFAULT_AGE_POLICY } = {}) {
  const candidateKey = candidateIdentity(candidate);
  const refreshes = [];
  const currentStages = [];
  if (!candidateKey) return {
    candidateKey: null, currentStages, refreshes: STAGES.map((stage) => ({ stage, reason: 'candidate_missing' })),
    cacheOutcome: 'miss', evidenceCheckedDates: {}, promotionAuthority: 'blocked_refresh_required',
  };
  const invalidated = new Map(); const pendingStages = [];
  const policyValid = policy && policy.version === 1 && policy.stages && typeof policy.stages === 'object';
  const mark = (stage, reason) => { if (!invalidated.has(stage)) invalidated.set(stage, validReason(reason)); };
  const warmVersion = candidate?.warmCacheVersion;
  if (warmVersion !== WARM_CACHE_VERSION) STAGES.forEach((stage) => mark(stage, 'warm_cache_version_changed'));
  for (const stage of STAGES) {
    // Refresh leases are separate from completed evidence. Older rows can
    // still carry a legacy `refreshing` receipt; read it below only to recover
    // safely, but all new writes use `candidate.stageRefresh`.
    const lease = stageLease(candidate, stage);
    if (lease) {
      const leaseStartedAt = lease.refreshStartedAt || lease.startedAt;
      const leaseAttemptId = lease.refreshAttemptId || lease.attemptId;
      if (!canonicalIso(leaseStartedAt) || !validLeaseAttemptId(leaseAttemptId)) {
        mark(stage, 'stage_incomplete');
        continue;
      }
      const leaseMs = policy?.leaseMs;
      if (Number.isFinite(leaseMs) && leaseMs > 0 && now - Date.parse(leaseStartedAt) > leaseMs) {
        mark(stage, 'prior_refresh_incomplete');
      } else {
        pendingStages.push(stage);
      }
      continue;
    }
    const receipt = stageReceipt(candidate, stage, authoritative);
    if (!receipt) { mark(stage, 'stage_missing'); continue; }
    if (!STATES.has(receipt.state)) { mark(stage, 'unclassified_miss'); continue; }
    if (receipt.state === 'refreshing') {
      const leaseMs = policy?.leaseMs;
      if (!canonicalIso(receipt.refreshStartedAt)) { mark(stage, 'stage_incomplete'); continue; }
      if (Number.isFinite(leaseMs) && leaseMs > 0 && now - Date.parse(receipt.refreshStartedAt) > leaseMs) mark(stage, 'prior_refresh_incomplete');
      else pendingStages.push(stage);
      continue;
    }
    if (receipt.state !== 'current' && receipt.state !== 'not_applicable') {
      mark(stage, 'stage_incomplete');
      continue;
    }
    if (receipt.contractVersion !== CONTRACT_VERSIONS[stage]) { mark(stage, 'stage_contract_changed'); continue; }
    if (!boundedVersion(receipt.sourceVersion) || !boundedVersion(receipt.resultVersion) || !boundedVersion(authoritative?.versions?.[stage]) || receipt.sourceVersion !== authoritative.versions[stage]) { mark(stage, 'stage_contract_changed'); continue; }
    if (!policyValid) { mark(stage, 'stage_contract_changed'); continue; }
    const expiry = isExpired(receipt, stage, now, policy);
    if (expiry === null) { mark(stage, 'stage_contract_changed'); continue; }
    if (expiry) { mark(stage, 'stage_incomplete'); continue; }
    currentStages.push(stage);
  }
  // A server-owned `not_applicable` applicant anchor deliberately has no
  // request-wide applicant-input dependency. In particular, an ordinary
  // search candidate must not be invalidated merely because a different
  // applicant recommendation slot changed.
  const applicantAnchorNotApplicable = stageReceipt(candidate, 'applicant_anchor', authoritative)?.state === 'not_applicable';
  if (!applicantAnchorNotApplicable && (!boundedVersion(candidate?.applicantInputVersion) || !boundedVersion(authoritative.applicantInputVersion) || candidate.applicantInputVersion !== authoritative.applicantInputVersion)) {
    addInvalidation({ add: (stage) => mark(stage, 'candidate_input_changed') }, 'applicant_anchor');
  }
  if (!boundedVersion(candidate?.proposalContentVersion) || !boundedVersion(authoritative.proposalContentVersion) || candidate.proposalContentVersion !== authoritative.proposalContentVersion) {
    mark('coauthor_coi', 'proposal_content_changed');
  }
  // Expand downstream only for a true upstream invalidation, preserving proposal's narrow scope.
  for (const [stage, reason] of Array.from(invalidated)) {
    for (const downstream of DOWNSTREAM[stage] || []) if (!invalidated.has(downstream)) mark(downstream, reason);
  }
  for (const [stage, reason] of invalidated) refreshes.push({ stage, reason });
  // An expired candidate-wide lease must be the next explicit staff target,
  // even when a newly invalidated upstream stage would otherwise sort first.
  // The refresh route may then recover only the same stage named by this plan;
  // after reload, ordinary dependency ordering resumes.
  const owningLease = candidateStageLease(candidate, { now, policy });
  let leaseRepairRequired = false;
  if (owningLease?.valid && owningLease.expired) {
    const ownerIndex = refreshes.findIndex((refresh) => refresh.stage === owningLease.stage);
    if (ownerIndex > 0) refreshes.unshift(...refreshes.splice(ownerIndex, 1));
    if (refreshes[0]?.stage === owningLease.stage) {
      // The expired lease is the material reason for this action even if an
      // earlier broad invalidation (for example warm cache format) marked the
      // same stage first.  The browser accepts recovery only under this exact
      // reason, so the server plan must canonicalize it here.
      refreshes[0] = {
        ...refreshes[0],
        reason: 'prior_refresh_incomplete',
        action: 'recover_expired_lease',
      };
    }
  } else if (owningLease && !owningLease.valid) {
    leaseRepairRequired = true;
    const ownerIndex = refreshes.findIndex((refresh) => refresh.stage === owningLease.stage);
    if (ownerIndex >= 0) {
      refreshes[ownerIndex] = {
        ...refreshes[ownerIndex],
        reason: 'stage_incomplete',
        action: 'operator_repair_required',
      };
    }
  }
  const checked = Object.fromEntries(STAGES.map((stage) => [stage, stageReceipt(candidate, stage, authoritative)?.completedAt || null]));
  const filteredCurrentStages = currentStages.filter((stage) => !invalidated.has(stage));
  return {
    candidateKey, currentStages: filteredCurrentStages, pendingStages, refreshes,
    cacheOutcome: leaseRepairRequired
      ? 'miss'
      : refreshes.length === 0 && pendingStages.length === 0
        ? 'hit'
        : (filteredCurrentStages.length ? 'partial_hit' : 'miss'),
    evidenceCheckedDates: checked,
    leaseRepairRequired,
    promotionAuthority: !leaseRepairRequired
      && refreshes.length === 0
      && pendingStages.length === 0
      && authoritative.authorityState === 'current'
      ? 'requires_promotion_checks'
      : 'blocked_refresh_required',
  };
}

function planRosterFreshness(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  return candidates.map((candidate) => planCandidateFreshness({ ...input, candidate }));
}

module.exports = { STAGES, STATES, REASONS, CONTRACT_VERSIONS, DOWNSTREAM, DEFAULT_AGE_POLICY, WARM_CACHE_VERSION, LEGACY_SELECTION_PROJECTION_VERSION, canonicalIso, boundedVersion, candidateIdentity, validReason, receiptlessLegacyCandidate, legacyAddressAttestation, legacySelectionCandidateKey, projectLegacySelectionProjection, stageReceipt, stageLease, validLeaseAttemptId, candidateStageLease, mapLegacyStage, planCandidateFreshness, planRosterFreshness };
