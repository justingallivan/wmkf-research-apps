/**
 * @jest-environment node
 */
import { createHash } from 'node:crypto';

import {
  buildReviewerHolisticBlindedArtifacts,
  buildReviewerHolisticExecutionArtifact,
  completeReviewerHolisticRun,
  failReviewerHolisticRun,
  startReviewerHolisticRun,
  summarizeReviewerHolisticExecution,
  validateReviewerHolisticExecutionArtifact,
} from '../../scripts/lib/reviewer-holistic-execution.mjs';

const SEED = 'a'.repeat(64);
const now = () => '2026-07-16T18:00:00.000Z';

function plan() {
  const runs = [];
  for (let proposal = 1; proposal <= 10; proposal += 1) {
    for (const arm of ['baseline', 'redesign']) {
      for (let replicate = 1; replicate <= 3; replicate += 1) {
        runs.push({
          runId: `run-${proposal}-${arm}-${replicate}`,
          proposalId: `proposal-${proposal}`,
          blindProposalId: `RPE-${String(proposal).padStart(10, '0')}`,
          documentHash: String(proposal % 10).repeat(64),
          arm,
          replicate,
          pipelineVersion: arm === 'baseline' ? 'legacy-default' : 'redesign-v1',
          pipelineCommit: arm === 'baseline' ? 'b'.repeat(40) : 'r'.repeat(40),
        });
      }
    }
  }
  return { manifestFingerprint: 'f'.repeat(64), runCount: 60, runs };
}

function proposalEvaluation() {
  return {
    evaluationVersion: 'reviewer-proposal-head-to-head-v1',
    scorer: 'Justin',
    randomizationSeedHash: createHash('sha256').update(SEED).digest('hex'),
    proposals: Array.from({ length: 10 }, (_, index) => ({
      proposalId: `proposal-${index + 1}`,
      blindProposalId: `RPE-${String(index + 1).padStart(10, '0')}`,
      programArea: index % 2 ? 'Medical' : 'Science',
      signalLevel: index % 2 ? 'full' : 'thin',
    })),
  };
}

function completeAll(artifact) {
  for (const run of artifact.runs) {
    startReviewerHolisticRun(artifact, run.runId, { now });
    completeReviewerHolisticRun(artifact, run.runId, {
      reviewerSuggestions: [{
        name: run.arm === 'baseline' ? 'Dr. Shared Person' : 'Shared Person',
        suggestedInstitution: 'Example University',
        expertiseAreas: ['Example field'],
        reasoning: `Candidate reasoning ${run.replicate}`,
      }],
    }, { now });
  }
}

describe('reviewer holistic execution artifacts', () => {
  test('initial artifact contains every frozen slot and no implicit success', () => {
    const frozenPlan = plan();
    const artifact = buildReviewerHolisticExecutionArtifact(frozenPlan, { now });
    expect(validateReviewerHolisticExecutionArtifact(artifact, frozenPlan)).toEqual({ ok: true, errors: [] });
    expect(summarizeReviewerHolisticExecution(artifact)).toEqual({
      pending: 60,
      running: 0,
      completed: 0,
      failed: 0,
    });
  });

  test('completed runs are immutable and failed/interrupted retries require explicit permission', () => {
    const artifact = buildReviewerHolisticExecutionArtifact(plan(), { now });
    const [completed, failed, interrupted] = artifact.runs;

    startReviewerHolisticRun(artifact, completed.runId, { now });
    completeReviewerHolisticRun(artifact, completed.runId, { reviewerSuggestions: [] }, { now });
    expect(() => startReviewerHolisticRun(artifact, completed.runId, { now })).toThrow('already completed');

    startReviewerHolisticRun(artifact, failed.runId, { now });
    failReviewerHolisticRun(artifact, failed.runId, new Error('provider unavailable'), { now });
    expect(() => startReviewerHolisticRun(artifact, failed.runId, { now })).toThrow('--retry-failed');
    expect(() => startReviewerHolisticRun(artifact, failed.runId, { retryFailed: true, now })).not.toThrow();

    startReviewerHolisticRun(artifact, interrupted.runId, { now });
    expect(() => startReviewerHolisticRun(artifact, interrupted.runId, { now })).toThrow('explicit retry');
    expect(() => startReviewerHolisticRun(artifact, interrupted.runId, { retryInterrupted: true, now })).not.toThrow();

    artifact.status = 'invalid';
    expect(() => startReviewerHolisticRun(artifact, artifact.runs[3].runId, { now })).toThrow('cannot resume');
  });

  test('validation rejects slot drift, unknown slots, and false complete status', () => {
    const frozenPlan = plan();
    const artifact = buildReviewerHolisticExecutionArtifact(frozenPlan, { now });
    artifact.runs[0].pipelineCommit = 'changed';
    artifact.runs[1].runId = 'unknown-run';
    artifact.status = 'complete';
    const result = validateReviewerHolisticExecutionArtifact(artifact, frozenPlan);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'runs[0].pipelineCommit' }),
      expect.objectContaining({ path: 'runs[1].runId' }),
      expect.objectContaining({ path: 'status' }),
    ]));
  });

  test('validation rejects a completed batch left in running state', () => {
    const frozenPlan = plan();
    const artifact = buildReviewerHolisticExecutionArtifact(frozenPlan, { now });
    completeAll(artifact);
    artifact.status = 'running';
    expect(validateReviewerHolisticExecutionArtifact(artifact, frozenPlan).errors).toContainEqual({
      path: 'status',
      message: 'must be complete when all 60 runs are completed',
    });
  });

  test('blinding exact-dedupes name variants without exposing arms', () => {
    const frozenPlan = plan();
    const artifact = buildReviewerHolisticExecutionArtifact(frozenPlan, { now });
    completeAll(artifact);
    expect(artifact.status).toBe('complete');
    const { scoringPackage, unblindingMap } = buildReviewerHolisticBlindedArtifacts({
      executionArtifact: artifact,
      plan: frozenPlan,
      proposalEvaluation: proposalEvaluation(),
      randomizationSeed: SEED,
    });
    expect(scoringPackage.proposals).toHaveLength(10);
    expect(scoringPackage.proposals[0].candidates).toHaveLength(1);
    expect(scoringPackage.proposals[0].candidates[0]).not.toHaveProperty('arms');
    expect(JSON.stringify(scoringPackage)).not.toContain('baseline');
    expect(JSON.stringify(scoringPackage)).not.toContain('redesign');
    expect(unblindingMap.proposals[0].candidates[0].arms).toEqual(['baseline', 'redesign']);
  });

  test('blinding fails closed for incomplete execution and the wrong secret seed', () => {
    const frozenPlan = plan();
    const artifact = buildReviewerHolisticExecutionArtifact(frozenPlan, { now });
    expect(() => buildReviewerHolisticBlindedArtifacts({
      executionArtifact: artifact,
      plan: frozenPlan,
      proposalEvaluation: proposalEvaluation(),
      randomizationSeed: SEED,
    })).toThrow('all 60 runs');
    completeAll(artifact);
    expect(() => buildReviewerHolisticBlindedArtifacts({
      executionArtifact: artifact,
      plan: frozenPlan,
      proposalEvaluation: proposalEvaluation(),
      randomizationSeed: 'b'.repeat(64),
    })).toThrow('frozen commitment');
  });
});
