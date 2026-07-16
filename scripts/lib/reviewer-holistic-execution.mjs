/**
 * Pure durable-artifact contracts for the M1.2 paid execution and blinded
 * scoring handoff. File/network/LLM access stays in run-reviewer-holistic-m1.
 */
import { createHash, createHmac } from 'node:crypto';

import { normalizeReviewerName } from '../../lib/utils/reviewer-name-match.js';

export const REVIEWER_HOLISTIC_EXECUTION_SCRIPT_VERSION = 'reviewer-holistic-m1-executor-v2';
export const REVIEWER_HOLISTIC_EXECUTION_ARTIFACT_VERSION = 'reviewer-holistic-m1-execution-v1';
export const REVIEWER_HOLISTIC_SCORING_PACKAGE_VERSION = 'reviewer-holistic-m1-scoring-package-v1';

const RUN_STATUSES = new Set(['pending', 'running', 'completed', 'failed']);
const SLOT_FIELDS = [
  'runId',
  'proposalId',
  'blindProposalId',
  'documentHash',
  'arm',
  'replicate',
  'pipelineVersion',
  'pipelineCommit',
];
const SHA256_RE = /^[0-9a-f]{64}$/;

function nowIso(now) {
  const value = typeof now === 'function' ? now() : new Date().toISOString();
  if (Number.isNaN(Date.parse(value))) throw new Error('now must produce an ISO-compatible timestamp');
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cleanError(error) {
  return String(error?.message || error || 'Unknown execution failure').slice(0, 2000);
}

function runMap(plan) {
  return new Map(plan.runs.map((run) => [run.runId, run]));
}

export function buildReviewerHolisticExecutionArtifact(plan, { now } = {}) {
  if (plan?.runCount !== 60 || !Array.isArray(plan.runs) || plan.runs.length !== 60) {
    throw new Error('A frozen 60-slot run plan is required');
  }
  const timestamp = nowIso(now);
  return {
    schemaVersion: 1,
    artifactVersion: REVIEWER_HOLISTIC_EXECUTION_ARTIFACT_VERSION,
    executionScriptVersion: REVIEWER_HOLISTIC_EXECUTION_SCRIPT_VERSION,
    manifestFingerprint: plan.manifestFingerprint,
    status: 'running',
    createdAt: timestamp,
    updatedAt: timestamp,
    runCount: plan.runCount,
    runs: plan.runs.map((slot) => ({
      ...slot,
      status: 'pending',
      attempts: [],
      result: null,
    })),
  };
}

export function validateReviewerHolisticExecutionArtifact(artifact, plan) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return { ok: false, errors: [{ path: '$', message: 'execution artifact must be an object' }] };
  }
  if (artifact.schemaVersion !== 1) add('schemaVersion', 'must equal 1');
  if (artifact.artifactVersion !== REVIEWER_HOLISTIC_EXECUTION_ARTIFACT_VERSION) {
    add('artifactVersion', `must equal ${REVIEWER_HOLISTIC_EXECUTION_ARTIFACT_VERSION}`);
  }
  if (artifact.executionScriptVersion !== REVIEWER_HOLISTIC_EXECUTION_SCRIPT_VERSION) {
    add('executionScriptVersion', `must equal ${REVIEWER_HOLISTIC_EXECUTION_SCRIPT_VERSION}`);
  }
  if (artifact.manifestFingerprint !== plan?.manifestFingerprint) {
    add('manifestFingerprint', 'must match the frozen run plan');
  }
  if (!['running', 'complete', 'invalid'].includes(artifact.status)) {
    add('status', 'must be running, complete, or invalid');
  }
  if (artifact.runCount !== 60) add('runCount', 'must equal 60');
  if (!Array.isArray(artifact.runs)) add('runs', 'must be an array');

  const expected = runMap(plan);
  const seen = new Set();
  for (const [index, run] of (Array.isArray(artifact.runs) ? artifact.runs : []).entries()) {
    const base = `runs[${index}]`;
    if (!run || typeof run !== 'object' || Array.isArray(run)) {
      add(base, 'must be an object');
      continue;
    }
    if (seen.has(run.runId)) add(`${base}.runId`, 'must be unique');
    seen.add(run.runId);
    const slot = expected.get(run.runId);
    if (!slot) {
      add(`${base}.runId`, 'must belong to the frozen run plan');
      continue;
    }
    for (const field of SLOT_FIELDS) {
      if (run[field] !== slot[field]) add(`${base}.${field}`, 'must match the frozen run slot');
    }
    if (!RUN_STATUSES.has(run.status)) add(`${base}.status`, 'is unknown');
    if (!Array.isArray(run.attempts)) add(`${base}.attempts`, 'must be an array');
    if (run.status === 'completed') {
      if (!run.result || typeof run.result !== 'object') add(`${base}.result`, 'is required when completed');
      if (!Array.isArray(run.result?.reviewerSuggestions)) {
        add(`${base}.result.reviewerSuggestions`, 'must be an array when completed');
      }
    } else if (run.result !== null) {
      add(`${base}.result`, 'must be null unless completed');
    }
  }
  if (seen.size !== 60 || [...expected.keys()].some((runId) => !seen.has(runId))) {
    add('runs', 'must contain every frozen run slot exactly once');
  }
  const completed = (artifact.runs || []).filter((run) => run.status === 'completed').length;
  if (artifact.status === 'complete' && completed !== 60) {
    add('status', 'cannot be complete until all 60 runs are completed');
  }
  if (completed === 60 && artifact.status === 'running') {
    add('status', 'must be complete when all 60 runs are completed');
  }
  return { ok: errors.length === 0, errors };
}

function findRun(artifact, runId) {
  const run = artifact.runs.find((item) => item.runId === runId);
  if (!run) throw new Error(`Unknown frozen run ID ${runId}`);
  return run;
}

export function startReviewerHolisticRun(artifact, runId, {
  retryFailed = false,
  retryInterrupted = false,
  now,
} = {}) {
  if (artifact.status === 'invalid') throw new Error('invalidated execution artifacts cannot resume');
  const run = findRun(artifact, runId);
  if (run.status === 'completed') throw new Error(`${runId} is already completed`);
  if (run.status === 'failed' && !retryFailed) throw new Error(`${runId} failed previously; --retry-failed is required`);
  if (run.status === 'running' && !retryInterrupted) throw new Error(`${runId} has an interrupted attempt; explicit retry is required`);
  const timestamp = nowIso(now);
  run.status = 'running';
  run.result = null;
  run.attempts.push({
    attempt: run.attempts.length + 1,
    status: 'running',
    startedAt: timestamp,
    completedAt: null,
    error: null,
  });
  artifact.status = 'running';
  artifact.updatedAt = timestamp;
  return run;
}

export function completeReviewerHolisticRun(artifact, runId, result, { now } = {}) {
  const run = findRun(artifact, runId);
  const attempt = run.attempts.at(-1);
  if (run.status !== 'running' || attempt?.status !== 'running') {
    throw new Error(`${runId} must have a running attempt before completion`);
  }
  if (!result || !Array.isArray(result.reviewerSuggestions)) {
    throw new Error(`${runId} result must contain reviewerSuggestions`);
  }
  const timestamp = nowIso(now);
  attempt.status = 'completed';
  attempt.completedAt = timestamp;
  run.status = 'completed';
  run.result = result;
  artifact.updatedAt = timestamp;
  if (artifact.runs.every((item) => item.status === 'completed')) artifact.status = 'complete';
  return run;
}

export function failReviewerHolisticRun(artifact, runId, error, { now } = {}) {
  const run = findRun(artifact, runId);
  const attempt = run.attempts.at(-1);
  if (run.status !== 'running' || attempt?.status !== 'running') {
    throw new Error(`${runId} must have a running attempt before failure`);
  }
  const timestamp = nowIso(now);
  attempt.status = 'failed';
  attempt.completedAt = timestamp;
  attempt.error = cleanError(error);
  run.status = 'failed';
  run.result = null;
  artifact.status = 'running';
  artifact.updatedAt = timestamp;
  return run;
}

export function summarizeReviewerHolisticExecution(artifact) {
  const summary = { pending: 0, running: 0, completed: 0, failed: 0 };
  for (const run of artifact.runs || []) {
    if (RUN_STATUSES.has(run.status)) summary[run.status] += 1;
  }
  return summary;
}

function candidateIdFor(seed, blindProposalId, normalizedName) {
  return `RPC-${createHmac('sha256', seed)
    .update(`${blindProposalId}\0${normalizedName}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase()}`;
}

function candidateScore(candidate) {
  return [
    candidate?.name,
    candidate?.suggestedInstitution,
    candidate?.seniorityEstimate,
    ...(Array.isArray(candidate?.expertiseAreas) ? candidate.expertiseAreas : []),
    candidate?.reasoning,
  ].filter((value) => String(value || '').trim()).join(' ').length;
}

function representativeCandidate(occurrences) {
  return [...occurrences]
    .sort((a, b) => candidateScore(b.candidate) - candidateScore(a.candidate)
      || JSON.stringify(a.candidate).localeCompare(JSON.stringify(b.candidate)))[0].candidate;
}

export function buildReviewerHolisticBlindedArtifacts({
  executionArtifact,
  plan,
  proposalEvaluation,
  randomizationSeed,
}) {
  const validation = validateReviewerHolisticExecutionArtifact(executionArtifact, plan);
  if (!validation.ok) {
    throw new Error(`execution artifact is invalid: ${validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  if (executionArtifact.status !== 'complete') throw new Error('all 60 runs must complete before blinding');
  if (!SHA256_RE.test(String(randomizationSeed || ''))) {
    throw new Error('randomization seed must be 64 lowercase hexadecimal characters');
  }
  if (sha256(randomizationSeed) !== proposalEvaluation.randomizationSeedHash) {
    throw new Error('randomization seed does not match the frozen commitment');
  }

  const proposalRows = new Map(proposalEvaluation.proposals.map((item) => [item.proposalId, item]));
  const scoringProposals = [];
  const unblindingProposals = [];
  for (const proposalId of plan.runs.filter((run) => run.arm === 'baseline' && run.replicate === 1).map((run) => run.proposalId)) {
    const proposal = proposalRows.get(proposalId);
    const grouped = new Map();
    for (const run of executionArtifact.runs.filter((item) => item.proposalId === proposalId)) {
      for (const candidate of run.result.reviewerSuggestions) {
        const normalizedName = normalizeReviewerName(candidate?.name);
        if (!normalizedName) throw new Error(`${run.runId} contains a candidate without a usable name`);
        const entries = grouped.get(normalizedName) || [];
        entries.push({ arm: run.arm, runId: run.runId, candidate });
        grouped.set(normalizedName, entries);
      }
    }
    const candidates = [];
    const memberships = [];
    const candidateIds = new Set();
    for (const [normalizedName, occurrences] of grouped) {
      const blindCandidateId = candidateIdFor(randomizationSeed, proposal.blindProposalId, normalizedName);
      if (candidateIds.has(blindCandidateId)) throw new Error(`blind candidate ID collision in ${proposal.blindProposalId}`);
      candidateIds.add(blindCandidateId);
      const candidate = representativeCandidate(occurrences);
      candidates.push({
        blindCandidateId,
        name: candidate.name,
        institution: candidate.suggestedInstitution || null,
        expertiseAreas: Array.isArray(candidate.expertiseAreas) ? candidate.expertiseAreas : [],
        seniorityEstimate: candidate.seniorityEstimate || null,
        reasoning: candidate.reasoning || null,
      });
      memberships.push({
        blindCandidateId,
        normalizedName,
        arms: [...new Set(occurrences.map((item) => item.arm))].sort(),
        runIds: [...new Set(occurrences.map((item) => item.runId))].sort(),
      });
    }
    candidates.sort((a, b) => a.blindCandidateId.localeCompare(b.blindCandidateId));
    memberships.sort((a, b) => a.blindCandidateId.localeCompare(b.blindCandidateId));
    scoringProposals.push({
      blindProposalId: proposal.blindProposalId,
      programArea: proposal.programArea,
      signalLevel: proposal.signalLevel,
      candidates,
    });
    unblindingProposals.push({
      proposalId,
      blindProposalId: proposal.blindProposalId,
      candidates: memberships,
    });
  }

  const scoringPackage = {
    schemaVersion: 1,
    packageVersion: REVIEWER_HOLISTIC_SCORING_PACKAGE_VERSION,
    evaluationVersion: proposalEvaluation.evaluationVersion,
    manifestFingerprint: plan.manifestFingerprint,
    scorer: proposalEvaluation.scorer,
    proposals: scoringProposals,
  };
  return {
    scoringPackage,
    unblindingMap: {
      schemaVersion: 1,
      packageVersion: `${REVIEWER_HOLISTIC_SCORING_PACKAGE_VERSION}-unblinding`,
      evaluationVersion: proposalEvaluation.evaluationVersion,
      manifestFingerprint: plan.manifestFingerprint,
      scoringPackageHash: sha256(JSON.stringify(scoringPackage)),
      proposals: unblindingProposals,
    },
  };
}
