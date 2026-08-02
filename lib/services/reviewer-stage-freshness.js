/**
 * Server-owned Reviewer Find stage freshness contract. This module is pure:
 * callers supply authoritative request/version reads and a bounded roster DTO;
 * browser input cannot mark a stage current or choose invalidation scope.
 */

const STAGES = Object.freeze([
  'applicant_anchor', 'identity', 'institution_coi', 'coauthor_coi',
  'eligibility', 'contact', 'address_trust', 'roster_persistence',
]);
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
const DEFAULT_AGE_POLICY = Object.freeze({ version: 1, stages: {
  institution_coi: { maxAgeMs: 180 * 24 * 60 * 60 * 1000 },
  coauthor_coi: { maxAgeMs: 180 * 24 * 60 * 60 * 1000 },
  eligibility: { maxAgeMs: 180 * 24 * 60 * 60 * 1000 },
  contact: { maxAgeMs: 180 * 24 * 60 * 60 * 1000 },
  address_trust: { maxAgeMs: 180 * 24 * 60 * 60 * 1000 },
}});

function candidateIdentity(candidate) {
  const key = typeof candidate?.candidateKey === 'string' ? candidate.candidateKey.trim() : '';
  if (key) return key;
  const suggestionId = typeof candidate?.suggestionId === 'string' ? candidate.suggestionId.trim() : '';
  return suggestionId ? `suggestion:${suggestionId}` : null;
}
function validReason(reason) { return REASONS.has(reason) ? reason : 'unclassified_miss'; }
function stageReceipt(candidate, stage, authoritative) {
  const direct = candidate?.stageFreshness?.[stage];
  if (direct && typeof direct === 'object') return direct;
  return mapLegacyStage(candidate, stage, authoritative);
}
// Legacy is current only with an explicit, versioned equivalence certificate.
function mapLegacyStage(candidate, stage, authoritative = {}) {
  const legacy = candidate?.legacyStageReceipts?.[stage];
  if (!legacy || legacy.equivalenceVersion !== 1 || legacy.stage !== stage) return null;
  if (legacy.contractVersion !== CONTRACT_VERSIONS[stage]) return null;
  if (!legacy.completedAt || legacy.sourceVersion !== authoritative?.versions?.[stage]) return null;
  return { ...legacy, state: 'current', mappedFromLegacy: true };
}
function isExpired(receipt, stage, now, policy) {
  if (stage === 'identity' || stage === 'applicant_anchor' || stage === 'roster_persistence') return false;
  const maxAgeMs = policy?.stages?.[stage]?.maxAgeMs;
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
  const invalidated = new Map();
  const mark = (stage, reason) => { if (!invalidated.has(stage)) invalidated.set(stage, validReason(reason)); };
  const warmVersion = candidate?.warmCacheVersion;
  if (warmVersion !== 1) STAGES.forEach((stage) => mark(stage, 'warm_cache_version_changed'));
  for (const stage of STAGES) {
    const receipt = stageReceipt(candidate, stage, authoritative);
    if (!receipt) { mark(stage, 'stage_missing'); continue; }
    if (!STATES.has(receipt.state)) { mark(stage, 'unclassified_miss'); continue; }
    if (receipt.state !== 'current' && receipt.state !== 'not_applicable') {
      mark(stage, receipt.state === 'refreshing' ? 'prior_refresh_incomplete' : 'stage_incomplete');
      continue;
    }
    if (receipt.contractVersion !== CONTRACT_VERSIONS[stage]) { mark(stage, 'stage_contract_changed'); continue; }
    if (receipt.sourceVersion !== authoritative?.versions?.[stage]) { mark(stage, 'stage_contract_changed'); continue; }
    if (isExpired(receipt, stage, now, policy)) { mark(stage, 'stage_incomplete'); continue; }
    currentStages.push(stage);
  }
  if (candidate?.applicantInputVersion && authoritative.applicantInputVersion && candidate.applicantInputVersion !== authoritative.applicantInputVersion) {
    addInvalidation({ add: (stage) => mark(stage, 'candidate_input_changed') }, 'applicant_anchor');
  }
  if (candidate?.proposalContentVersion && authoritative.proposalContentVersion && candidate.proposalContentVersion !== authoritative.proposalContentVersion) {
    mark('coauthor_coi', 'proposal_content_changed');
  }
  // Expand downstream only for a true upstream invalidation, preserving proposal's narrow scope.
  for (const [stage, reason] of Array.from(invalidated)) {
    for (const downstream of DOWNSTREAM[stage] || []) if (!invalidated.has(downstream)) mark(downstream, reason);
  }
  for (const [stage, reason] of invalidated) refreshes.push({ stage, reason });
  const checked = Object.fromEntries(STAGES.map((stage) => [stage, stageReceipt(candidate, stage, authoritative)?.completedAt || null]));
  return {
    candidateKey, currentStages: currentStages.filter((stage) => !invalidated.has(stage)), refreshes,
    cacheOutcome: refreshes.length === 0 ? 'hit' : (currentStages.length ? 'partial_hit' : 'miss'),
    evidenceCheckedDates: checked,
    promotionAuthority: refreshes.length === 0 && authoritative.authorityState === 'current' ? 'qualified' : 'blocked_refresh_required',
  };
}

function planRosterFreshness(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  return candidates.map((candidate) => planCandidateFreshness({ ...input, candidate }));
}

module.exports = { STAGES, STATES, REASONS, CONTRACT_VERSIONS, DOWNSTREAM, DEFAULT_AGE_POLICY, candidateIdentity, validReason, mapLegacyStage, planCandidateFreshness, planRosterFreshness };
