/**
 * @jest-environment node
 */
import draftManifest from '../../docs/audits/reviewer-holistic-evaluation-manifest-v1.json';
import proposalEvaluation from '../../docs/audits/reviewer-holistic-proposal-evaluation-v1.json';
import {
  REVIEWER_HOLISTIC_EVALUATION_SCRIPT_VERSION,
  buildReviewerHolisticRunPlan,
} from '../../scripts/lib/reviewer-holistic-run-plan.mjs';
import { REVIEWER_HOLISTIC_REDESIGN_PIPELINE_VERSION } from '../../scripts/lib/reviewer-holistic-pipelines.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runnableManifest() {
  const manifest = clone(draftManifest);
  manifest.status = 'frozen';
  manifest.evaluationScriptVersion = REVIEWER_HOLISTIC_EVALUATION_SCRIPT_VERSION;
  manifest.redesign.pipelineVersion = REVIEWER_HOLISTIC_REDESIGN_PIPELINE_VERSION;
  manifest.redesign.implementationCommit = 'a'.repeat(40);
  return manifest;
}

describe('reviewer holistic M1.2 run plan', () => {
  test('builds 60 deterministic, unique, attributable slots', () => {
    const manifest = runnableManifest();
    const first = buildReviewerHolisticRunPlan({ manifest, proposalEvaluation });
    const second = buildReviewerHolisticRunPlan({ manifest, proposalEvaluation });
    expect(first).toEqual(second);
    expect(first.runCount).toBe(60);
    expect(new Set(first.runs.map((run) => run.runId)).size).toBe(60);
    expect(first.runs.filter((run) => run.arm === 'baseline')).toHaveLength(30);
    expect(first.runs.filter((run) => run.arm === 'redesign')).toHaveLength(30);
    expect(first.runs.every((run) => run.pipelineCommit && run.pipelineVersion)).toBe(true);
  });

  test('fails closed on draft state, version drift, and proposal drift', () => {
    expect(() => buildReviewerHolisticRunPlan({
      manifest: draftManifest,
      proposalEvaluation,
    })).toThrow('evaluation manifest is not runnable');

    const versionDrift = runnableManifest();
    versionDrift.redesign.pipelineVersion = 'unknown-redesign';
    expect(() => buildReviewerHolisticRunPlan({
      manifest: versionDrift,
      proposalEvaluation,
    })).toThrow('redesign pipelineVersion');

    const proposalDrift = clone(proposalEvaluation);
    proposalDrift.proposals[0].documentHash = 'f'.repeat(64);
    expect(() => buildReviewerHolisticRunPlan({
      manifest: runnableManifest(),
      proposalEvaluation: proposalDrift,
    })).toThrow('manifest/proposal consistency');
  });
});
