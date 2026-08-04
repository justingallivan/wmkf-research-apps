/**
 * Bounded server-side recovery for durable Reviewer Find roster evidence.
 *
 * This is deliberately an explicit staff/preflight operation, not part of the
 * warm roster GET. It never runs cold reviewer discovery, creates a reviewer
 * suggestion, selects a candidate, promotes one, or sends mail. It composes
 * the existing one-candidate/one-stage refresher, whose roster CAS and
 * candidate-wide lease remain the durable coordination mechanism. Repeating a
 * partial run re-plans from the current row and resumes at the first stale
 * stage; no request-level job row is needed for this bounded operation.
 */

import { listForRequest, PER_REQUEST_ACTIVE_CAP } from '../reviewer-roster-store';
import { canonicalStoredReviewerCandidateKey } from '../../utils/reviewer-candidate-key';
import {
  createReviewerStageRefreshRequestContext,
  planReviewerCandidateRefresh,
  refreshReviewerCandidateStage,
} from './reviewer-stage-refresh-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The roster store evicts active/saved rows above this authoritative cap. A
// reconciliation continuation can therefore carry every plausible active row
// without silently dropping work between bounded calls.
export const MAX_REQUEST_CANDIDATES = PER_REQUEST_ACTIVE_CAP;
const MAX_STAGE_ATTEMPTS = 16;
const MAX_RECONCILIATION_MS = 210_000;
const STAGE_ORDER = Object.freeze([
  'applicant_anchor',
  'identity',
  'institution_domains',
  'institution_coi',
  'coauthor_coi',
  'eligibility',
  'contact',
  'address_trust',
  'roster_persistence',
]);
const RETRYABLE_RECONCILIATION_OUTCOMES = new Set([
  'failed_retryable',
  'refresh_in_progress',
  'lease_recovery_required',
  // A roster compare-and-swap lost to a newer row. Re-plan from that row;
  // this is not a policy/manual block.
  'skipped_stale',
]);
const RETRYABLE_RECONCILIATION_DRIFT_CODES = new Set([
  'roster_snapshot_changed',
  'authority_changed',
]);

function isGuid(value) { return typeof value === 'string' && GUID_RE.test(value); }
function asStoredKey(value) { return canonicalStoredReviewerCandidateKey(value); }
function stageRank(stage) {
  const index = STAGE_ORDER.indexOf(stage);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function boundedKeys(candidateKeys) {
  if (candidateKeys === undefined) return { valid: true, keys: null };
  if (!Array.isArray(candidateKeys) || candidateKeys.length === 0 || candidateKeys.length > MAX_REQUEST_CANDIDATES) {
    return { valid: false, keys: [] };
  }
  const keys = Array.from(new Set(candidateKeys.map(asStoredKey).filter(Boolean)));
  return keys.length === candidateKeys.length
    ? { valid: true, keys }
    : { valid: false, keys: [] };
}

function executableRefresh(plan, { allowDeterministicAddressTrust = false } = {}) {
  const refreshes = Array.isArray(plan?.refreshes) ? plan.refreshes.slice() : [];
  refreshes.sort((left, right) => stageRank(left?.stage) - stageRank(right?.stage));
  const next = refreshes[0] || null;
  if (!next) return null;
  if (next.action === 'refresh_stage'
    || next.action === 'recover_expired_lease'
    || next.action === 'finalize_cached_evidence') return next;
  if (!allowDeterministicAddressTrust) return null;
  // Address trust is normally a dedicated staff action.  Request-level
  // reconciliation may offer it to the private stage primitive only so that
  // primitive can apply its server-read deterministic projection.  Ambiguous,
  // contested, corrected, and stale-person cases return action_required there
  // without writing address authority.
  return next.stage === 'address_trust' && next.action === 'dedicated_address_action'
    ? next
    : null;
}

function manualRequirement(plan) {
  const refreshes = Array.isArray(plan?.refreshes) ? plan.refreshes : [];
  return refreshes.find((entry) => entry?.action === 'dedicated_address_action'
    || entry?.action === 'operator_repair_required') || null;
}

function retryableReconciliationCandidate(candidate) {
  const evidence = [candidate, ...(Array.isArray(candidate?.stages) ? candidate.stages : [])];
  return evidence.some((entry) => (
    RETRYABLE_RECONCILIATION_OUTCOMES.has(entry?.outcome)
    || RETRYABLE_RECONCILIATION_DRIFT_CODES.has(entry?.code)
    || RETRYABLE_RECONCILIATION_DRIFT_CODES.has(entry?.reasonCode)
  ));
}

function resumableReconciliationCandidate(candidate) {
  // Policy/manual terminals must never reappear behind “Continue”. A rejected
  // one-stage response can be caused by a stale snapshot, but a fresh initial
  // request-level pass is the only safe way to replan that row.
  return candidate?.outcome !== 'rejected' && (
    candidate?.outcome === 'budget_exhausted' || retryableReconciliationCandidate(candidate)
  );
}

function compactStageResult(result) {
  return {
    stage: result?.stage || result?.requestedStage || null,
    outcome: result?.outcome || 'failed_retryable',
    ...(result?.code ? { code: result.code } : {}),
    ...(result?.reasonCode ? { reasonCode: result.reasonCode } : {}),
  };
}

async function keysForRequest(requestId, candidateKeys) {
  if (candidateKeys) return { keys: candidateKeys, deferredKeys: [] };
  const roster = await listForRequest(requestId);
  const all = Array.from(new Set((roster?.active || [])
    .map((candidate) => asStoredKey(candidate?.candidateKey))
    .filter(Boolean)));
  return {
    keys: all.slice(0, MAX_REQUEST_CANDIDATES),
    deferredKeys: [],
    capacityExceeded: all.length > MAX_REQUEST_CANDIDATES,
  };
}

async function reconcileOneCandidate({ requestId, candidateKey, context, remainingBudget, deadlineAt }) {
  const stages = [];
  let attempts = 0;
  let lastPlan = null;
  while (attempts < remainingBudget) {
    if (Date.now() >= deadlineAt) {
      return {
        candidateKey,
        outcome: 'budget_exhausted',
        code: 'reconciliation_deadline_exhausted',
        stages,
        attempts,
      };
    }
    const planned = await planReviewerCandidateRefresh({
      requestId,
      candidateKey,
      reconciliationContext: context,
    });
    if (planned.outcome !== 'planned') {
      return {
        candidateKey,
        outcome: planned.outcome,
        ...(planned.code ? { code: planned.code } : {}),
        stages,
        attempts,
      };
    }
    lastPlan = planned.plan;
    if (lastPlan?.cacheOutcome === 'hit' && (lastPlan?.pendingStages || []).length === 0) {
      return { candidateKey, outcome: 'current', stages, attempts };
    }
    const next = executableRefresh(lastPlan, { allowDeterministicAddressTrust: true });
    if (!next) {
      const manual = manualRequirement(lastPlan);
      return {
        candidateKey,
        outcome: manual ? 'action_required' : 'blocked',
        ...(manual ? { code: manual.action, stage: manual.stage } : { code: 'no_executable_refresh' }),
        stages,
        attempts,
      };
    }
    if (!planned.expectedUpdatedAt) {
      return { candidateKey, outcome: 'failed_retryable', code: 'missing_roster_version', stages, attempts };
    }
    // Intentional concurrency = 1. The underlying primitive has a
    // candidate-wide lease, and sequential dependency order prevents two
    // stages from consuming a stale predecessor in parallel.
    let refreshed;
    try {
      refreshed = await refreshReviewerCandidateStage({
        requestId,
        candidateKey,
        stage: next.stage,
        expectedUpdatedAt: planned.expectedUpdatedAt,
        reconciliationContext: context,
        deadlineAt,
      });
    } catch {
      return {
        candidateKey,
        outcome: 'failed_retryable',
        code: 'stage_refresh_unavailable',
        stages,
        attempts,
      };
    }
    stages.push(compactStageResult(refreshed));
    attempts += 1;
    if (!['recorded', 'not_required'].includes(refreshed.outcome)) {
      return {
        candidateKey,
        outcome: refreshed.outcome || 'failed_retryable',
        ...(refreshed.code ? { code: refreshed.code } : {}),
        stages,
        attempts,
      };
    }
  }
  return {
    candidateKey,
    outcome: 'budget_exhausted',
    code: 'reconciliation_work_budget_exhausted',
    stages,
    attempts,
    ...(lastPlan ? { pendingStages: lastPlan.pendingStages || [] } : {}),
  };
}

/**
 * Reconcile either an exact server-owned subset or the first bounded active
 * request roster. Results are per candidate/stage so a caller can retry only
 * unfinished work. `candidateKeys` are correlation handles; planner/refresh
 * always re-read the active server row and never use client candidate data.
 */
export async function reconcileReviewerStages({ requestId, candidateKeys } = {}) {
  if (!isGuid(requestId)) return { outcome: 'rejected', code: 'invalid_request_id', candidates: [] };
  const selected = boundedKeys(candidateKeys);
  if (!selected.valid) return { outcome: 'rejected', code: 'invalid_candidate_keys', candidates: [] };

  let context;
  let target;
  try {
    [context, target] = await Promise.all([
      createReviewerStageRefreshRequestContext(requestId),
      keysForRequest(requestId, selected.keys),
    ]);
  } catch {
    return { outcome: 'failed_retryable', code: 'request_authority_unavailable', candidates: [] };
  }
  if (!context) return { outcome: 'failed_retryable', code: 'request_authority_unavailable', candidates: [] };
  if (target.capacityExceeded) {
    return {
      outcome: 'blocked',
      code: 'roster_active_cap_exceeded',
      requestId,
      candidates: [],
      counts: { blocked: 0 },
      remainingStageBudget: MAX_STAGE_ATTEMPTS,
    };
  }

  // An all-request reconciliation with no active roster is a successful
  // no-op. It must not look like a policy block or ask the caller to retry a
  // non-existent candidate.
  if (target.keys.length === 0) {
    return {
      outcome: 'current',
      requestId,
      candidates: [],
      counts: { current: 0 },
      remainingStageBudget: MAX_STAGE_ATTEMPTS,
    };
  }

  const candidates = [];
  let remainingBudget = MAX_STAGE_ATTEMPTS;
  const deadlineAt = Date.now() + MAX_RECONCILIATION_MS;
  for (const candidateKey of target.keys) {
    if (remainingBudget <= 0) {
      candidates.push({
        candidateKey,
        outcome: 'budget_exhausted',
        code: 'reconciliation_work_budget_exhausted',
        stages: [],
        attempts: 0,
      });
      continue;
    }
    const result = await reconcileOneCandidate({
      requestId,
      candidateKey,
      context,
      remainingBudget,
      deadlineAt,
    });
    remainingBudget -= result.attempts || 0;
    candidates.push(result);
  }
  const counts = candidates.reduce((accumulator, candidate) => {
    const key = candidate.outcome || 'failed_retryable';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
  const currentCount = counts.current || 0;
  const complete = candidates.length > 0 && currentCount === candidates.length;
  const hasRetryableCandidate = candidates.some(retryableReconciliationCandidate);
  const continuationCandidateKeys = Array.from(new Set([
    ...candidates.filter(resumableReconciliationCandidate).map((candidate) => candidate.candidateKey),
    ...target.deferredKeys,
  ])).slice(0, MAX_REQUEST_CANDIDATES);
  const aggregateOutcome = complete
    ? 'current'
    : currentCount > 0
      ? 'partial'
      : counts.action_required
        ? 'action_required'
        : hasRetryableCandidate
          ? 'failed_retryable'
          : counts.budget_exhausted
            ? 'budget_exhausted'
            : 'blocked';
  return {
    outcome: aggregateOutcome,
    requestId,
    candidates,
    counts,
    ...(continuationCandidateKeys.length ? { continuationCandidateKeys } : {}),
    remainingStageBudget: remainingBudget,
  };
}

export const _internals = {
  boundedKeys,
  executableRefresh,
  manualRequirement,
  resumableReconciliationCandidate,
  reconcileOneCandidate,
  MAX_REQUEST_CANDIDATES,
  MAX_STAGE_ATTEMPTS,
  MAX_RECONCILIATION_MS,
};
