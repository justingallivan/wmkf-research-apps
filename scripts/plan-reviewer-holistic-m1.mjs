#!/usr/bin/env node
/**
 * Read-only M1.2 preflight. Prints the frozen 60-slot execution plan; it never
 * downloads documents, calls Dataverse, invokes an LLM, or writes artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReviewerHolisticRunPlan } from './lib/reviewer-holistic-run-plan.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'docs/audits/reviewer-holistic-evaluation-manifest-v1.json');
const proposalPath = path.join(root, 'docs/audits/reviewer-holistic-proposal-evaluation-v1.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

try {
  const plan = buildReviewerHolisticRunPlan({
    manifest: readJson(manifestPath),
    proposalEvaluation: readJson(proposalPath),
  });
  const counts = plan.runs.reduce((acc, run) => {
    acc[run.arm] = (acc[run.arm] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({
    evaluationScriptVersion: plan.evaluationScriptVersion,
    manifestFingerprint: plan.manifestFingerprint,
    runCount: plan.runCount,
    counts,
    firstRunId: plan.runs[0].runId,
    lastRunId: plan.runs.at(-1).runId,
    mode: 'READ_ONLY_PLAN',
  }, null, 2));
} catch (error) {
  console.error(`reviewer holistic M1.2 run plan blocked: ${error.message}`);
  process.exit(1);
}

