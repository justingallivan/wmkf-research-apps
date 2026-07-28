/**
 * @jest-environment node
 */
import trackedManifest from '../fixtures/reviewer-holistic-evaluation-manifest-v1.synthetic.json';
import proposalEvaluation from '../fixtures/reviewer-holistic-proposal-evaluation.synthetic.json';
import {
  REVIEWER_HOLISTIC_EVALUATION_SCRIPT_VERSION,
  buildReviewerHolisticRunPlan,
} from '../../scripts/lib/reviewer-holistic-run-plan.mjs';
import { REVIEWER_HOLISTIC_REDESIGN_PIPELINE_VERSION } from '../../scripts/lib/reviewer-holistic-pipelines.mjs';
import { parseArgs as parsePlanArgs } from '../../scripts/plan-reviewer-holistic-m1.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runnableManifest() {
  const manifest = clone(trackedManifest);
  manifest.status = 'frozen';
  manifest.evaluationScriptVersion = REVIEWER_HOLISTIC_EVALUATION_SCRIPT_VERSION;
  manifest.redesign.pipelineVersion = REVIEWER_HOLISTIC_REDESIGN_PIPELINE_VERSION;
  manifest.redesign.implementationCommit = 'a'.repeat(40);
  return manifest;
}

describe('reviewer holistic M1.2 run plan', () => {
  test('planner requires explicit external manifest and proposal paths', () => {
    expect(() => parsePlanArgs([])).toThrow('--manifest-file');
    expect(() => parsePlanArgs(['--manifest-file=/secure/manifest.json'])).toThrow(
      '--proposal-evaluation-file',
    );
    expect(parsePlanArgs([
      '--manifest-file=/secure/manifest.json',
      '--proposal-evaluation-file=/secure/proposals.json',
    ])).toEqual(expect.objectContaining({
      manifestPath: '/secure/manifest.json',
      proposalEvaluationPath: '/secure/proposals.json',
    }));
    expect(() => parsePlanArgs([
      `--manifest-file=${process.cwd()}/tests/fixtures/reviewer-holistic-evaluation-manifest-v2.synthetic.json`,
      '--proposal-evaluation-file=/secure/proposals.json',
    ])).toThrow('outside the repository');
  });

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
    const draftManifest = clone(trackedManifest);
    draftManifest.status = 'draft';
    draftManifest.redesign.implementationCommit = null;
    draftManifest.redesign.pipelineVersion = null;
    draftManifest.evaluationScriptVersion = null;
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
