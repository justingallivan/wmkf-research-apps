#!/usr/bin/env node
/**
 * Read-only M1.2 preflight. Prints the frozen 60-slot execution plan; it never
 * downloads documents, calls Dataverse, invokes an LLM, or writes artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildReviewerHolisticRunPlan } from './lib/reviewer-holistic-run-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveExternalInput(value, flag) {
  const candidate = path.resolve(value);
  if (candidate === ROOT || candidate.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`${flag} must resolve outside the repository`);
  }
  return candidate;
}

export function parseArgs(argv) {
  const out = { manifestPath: null, proposalEvaluationPath: null, help: false };
  for (const arg of argv) {
    if (arg.startsWith('--manifest-file=')) {
      const value = arg.slice('--manifest-file='.length);
      if (!value) throw new Error('--manifest-file=<path> requires a non-empty path');
      out.manifestPath = resolveExternalInput(value, '--manifest-file');
    } else if (arg.startsWith('--proposal-evaluation-file=')) {
      const value = arg.slice('--proposal-evaluation-file='.length);
      if (!value) throw new Error('--proposal-evaluation-file=<path> requires a non-empty path');
      out.proposalEvaluationPath = resolveExternalInput(value, '--proposal-evaluation-file');
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!out.help && !out.manifestPath) throw new Error('--manifest-file=<path> is required');
  if (!out.help && !out.proposalEvaluationPath) {
    throw new Error('--proposal-evaluation-file=<path> is required');
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/plan-reviewer-holistic-m1.mjs --manifest-file=<path> --proposal-evaluation-file=<path>');
    return;
  }
  const plan = buildReviewerHolisticRunPlan({
    manifest: readJson(args.manifestPath),
    proposalEvaluation: readJson(args.proposalEvaluationPath),
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
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    main();
  } catch (error) {
    console.error(`reviewer holistic M1.2 run plan blocked: ${error.message}`);
    process.exit(1);
  }
}
