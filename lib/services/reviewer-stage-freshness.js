/**
 * Server-owned Reviewer Find stage freshness contract. This module is pure:
 * callers supply authoritative request/version reads and a bounded roster DTO;
 * browser input cannot mark a stage current or choose invalidation scope.
 */

const STAGES = Object.freeze([
  'applicant_anchor', 'identity', 'institution_coi', 'coauthor_coi',
  'eligibility', 'contact', 'address_trust', 'roster_persistence',
]);
const { reviewerSuggestionCandidateKey } = require('../utils/reviewer-candidate-key');
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
  applicant_anchor: 1, identity: 4, institution_coi: 1, coauthor_coi: 1,
  eligibility: 1, contact: 1, address_trust: 1, roster_persistence: 1,
});
const DOWNSTREAM = Object.freeze({
  applicant_anchor: ['identity', 'institution_coi', 'coauthor_coi', 'eligibility', 'contact', 'address_trust', 'roster_persistence'],
  identity: ['institution_coi', 'coauthor_coi', 'eligibility', 'contact', 'address_trust', 'roster_persistence'],
  institution_coi: ['roster_persistence'], coauthor_coi: ['roster_persistence'],
  eligibility: ['roster_persistence'], contact: ['address_trust', 'roster_persistence'],
  address_trust: ['roster_persistence'], roster_persistence: [],
});
// Configurable/versioned policy. Deliberately no default identity TTL.
const DEFAULT_AGE_POLICY = Object.freeze({ version: 1, leaseMs: 15 * 60 * 1000, stages: {} });
const WARM_CACHE_VERSION = 1;
function canonicalIso(value) { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false; try { return new Date(value).toISOString() === value; } catch { return false; } }
function boundedVersion(value) { return typeof value === 'string' && value.length > 0 && value.length <= 160; }

function candidateIdentity(candidate) {
  const key = typeof candidate?.candidateKey === 'string' ? candidate.candidateKey.trim() : '';
  if (key) return /^(suggestion|person|orcid|openalex|scholar|seed):[^\s:]{1,512}$/.test(key) ? key : null;
  const suggestionId = typeof candidate?.suggestionId === 'string' ? candidate.suggestionId.trim() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suggestionId)
    ? reviewerSuggestionCandidateKey(suggestionId) : null;
}
function validReason(reason) { return REASONS.has(reason) ? reason : 'unclassified_miss'; }
function stageReceipt(candidate, stage, authoritative) {
  const direct = candidate?.stageFreshness?.[stage];
  if (direct && typeof direct === 'object') return direct;
  return mapLegacyStage(candidate, stage, authoritative);
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
    if (!boundedVersion(receipt.sourceVersion) || !boundedVersion(authoritative?.versions?.[stage]) || receipt.sourceVersion !== authoritative.versions[stage]) { mark(stage, 'stage_contract_changed'); continue; }
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
  const checked = Object.fromEntries(STAGES.map((stage) => [stage, stageReceipt(candidate, stage, authoritative)?.completedAt || null]));
  const filteredCurrentStages = currentStages.filter((stage) => !invalidated.has(stage));
  return {
    candidateKey, currentStages: filteredCurrentStages, pendingStages, refreshes,
    cacheOutcome: refreshes.length === 0 && pendingStages.length === 0 ? 'hit' : (filteredCurrentStages.length ? 'partial_hit' : 'miss'),
    evidenceCheckedDates: checked,
    promotionAuthority: refreshes.length === 0 && pendingStages.length === 0 && authoritative.authorityState === 'current' ? 'requires_promotion_checks' : 'blocked_refresh_required',
  };
}

function planRosterFreshness(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  return candidates.map((candidate) => planCandidateFreshness({ ...input, candidate }));
}

module.exports = { STAGES, STATES, REASONS, CONTRACT_VERSIONS, DOWNSTREAM, DEFAULT_AGE_POLICY, WARM_CACHE_VERSION, canonicalIso, boundedVersion, candidateIdentity, validReason, mapLegacyStage, planCandidateFreshness, planRosterFreshness };
