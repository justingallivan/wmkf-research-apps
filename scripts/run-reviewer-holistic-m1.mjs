#!/usr/bin/env node
/**
 * Fail-closed M1.2 paid executor.
 *
 * Default/--preflight performs production reads and exact document/runtime
 * checks but no LLM generation. Paid execution additionally requires the
 * literal `--execute --confirm-paid-runs=60` acknowledgement. Results are
 * checkpointed after every slot under ignored outputs/ for safe resume.
 */
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  REVIEWER_HOLISTIC_EXECUTION_ARTIFACT_VERSION,
  REVIEWER_HOLISTIC_EXECUTION_SCRIPT_VERSION,
  buildReviewerHolisticBlindedArtifacts,
  buildReviewerHolisticExecutionArtifact,
  completeReviewerHolisticRun,
  failReviewerHolisticRun,
  startReviewerHolisticRun,
  summarizeReviewerHolisticExecution,
  validateReviewerHolisticExecutionArtifact,
} from './lib/reviewer-holistic-execution.mjs';
import {
  applicantRecommendationNames,
  loadApplicantRecommendationSeeds,
  runReviewerHolisticPipelineArm,
} from './lib/reviewer-holistic-pipelines.mjs';
import { buildReviewerHolisticRunPlan } from './lib/reviewer-holistic-run-plan.mjs';
import {
  observeRuntimeConfig,
  runtimeConfigDiff,
  sha256Canonical,
} from './probe-reviewer-holistic-runtime-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'docs/audits/reviewer-holistic-evaluation-manifest-v1.json');
const EVALUATION_PATH = join(ROOT, 'docs/audits/reviewer-holistic-proposal-evaluation-v1.json');
const COHORT_PATH = join(ROOT, 'docs/audits/reviewer-holistic-proposal-cohort-proposal-v1.json');
const OUTPUT_DIR = join(ROOT, 'outputs/reviewer-holistic-m1');
const EXECUTION_PATH = join(OUTPUT_DIR, 'execution-v1.json');
const SCORING_PATH = join(OUTPUT_DIR, 'scoring-package-v1.json');
const UNBLINDING_PATH = join(OUTPUT_DIR, 'unblinding-map-v1.json');
const LOCK_PATH = join(OUTPUT_DIR, 'execution-v1.lock');

const COMMON_RUNTIME_FILES = [
  'lib/services/claude-reviewer-service.js',
  'lib/services/reviewer-prompt-composer.js',
  'shared/config/prompts/reviewer-finder.js',
  'lib/services/reviewer-prompt-resolver.js',
  'lib/services/llm-client.js',
  'shared/config/baseConfig.js',
  'lib/services/reviewer-request-context.js',
  'lib/utils/reviewer-name-match.js',
  'lib/dataverse/adapters/grant-request.js',
  'lib/dataverse/adapters/potential-reviewer.js',
];
const REDESIGN_FILES = [
  ...COMMON_RUNTIME_FILES,
  'scripts/lib/reviewer-holistic-pipelines.mjs',
];
const EXECUTOR_FILES = [
  ...REDESIGN_FILES,
  'scripts/lib/reviewer-holistic-run-plan.mjs',
  'scripts/lib/reviewer-holistic-execution.mjs',
  'scripts/probe-reviewer-holistic-runtime-config.mjs',
  'scripts/run-reviewer-holistic-m1.mjs',
];

function loadEnvFile(filePath) {
  try {
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  } catch { /* environment may already be exported */ }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, filePath);
}

export function parseArgs(argv) {
  const out = {
    mode: 'preflight',
    confirmPaidRuns: null,
    maxRuns: 60,
    retryFailed: false,
    help: false,
  };
  let explicitMode = null;
  for (const arg of argv) {
    if (arg === '--preflight' || arg === '--execute') {
      const mode = arg.slice(2);
      if (explicitMode && explicitMode !== mode) throw new Error('choose exactly one of --preflight or --execute');
      explicitMode = mode;
      out.mode = mode;
    } else if (arg.startsWith('--confirm-paid-runs=')) {
      out.confirmPaidRuns = arg.slice('--confirm-paid-runs='.length);
    } else if (arg.startsWith('--max-runs=')) {
      const value = Number(arg.slice('--max-runs='.length));
      if (!Number.isInteger(value) || value < 1 || value > 60) throw new Error('--max-runs must be an integer from 1 through 60');
      out.maxRuns = value;
    } else if (arg === '--retry-failed') {
      out.retryFailed = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (out.mode === 'execute' && out.confirmPaidRuns !== '60') {
    throw new Error('paid execution requires --confirm-paid-runs=60');
  }
  if (out.mode === 'preflight' && (out.confirmPaidRuns || out.retryFailed || out.maxRuns !== 60)) {
    throw new Error('paid-run, retry, and max-run flags are valid only with --execute');
  }
  return out;
}

function gitQuiet(args, label) {
  try {
    execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' });
  } catch {
    throw new Error(label);
  }
}

function assertSourceAttribution(manifest) {
  const execution = manifest.execution || {};
  if (execution.scriptVersion !== REVIEWER_HOLISTIC_EXECUTION_SCRIPT_VERSION) {
    throw new Error(`manifest execution.scriptVersion must equal ${REVIEWER_HOLISTIC_EXECUTION_SCRIPT_VERSION}`);
  }
  if (execution.artifactVersion !== REVIEWER_HOLISTIC_EXECUTION_ARTIFACT_VERSION) {
    throw new Error(`manifest execution.artifactVersion must equal ${REVIEWER_HOLISTIC_EXECUTION_ARTIFACT_VERSION}`);
  }
  if (!/^[0-9a-f]{40}$/.test(String(execution.implementationCommit || ''))) {
    throw new Error('manifest execution.implementationCommit must be a full commit SHA');
  }
  gitQuiet(
    ['diff', '--quiet', manifest.baseline.commit, manifest.redesign.implementationCommit, '--', ...COMMON_RUNTIME_FILES],
    'baseline and redesign commits differ outside the approved applicant-seed treatment',
  );
  gitQuiet(
    ['diff', '--quiet', manifest.redesign.implementationCommit, 'HEAD', '--', ...REDESIGN_FILES],
    'redesign runtime files have drifted since the pinned redesign commit',
  );
  gitQuiet(
    ['merge-base', '--is-ancestor', execution.implementationCommit, 'HEAD'],
    'pinned execution commit is not an ancestor of HEAD',
  );
  gitQuiet(
    ['diff', '--quiet', execution.implementationCommit, 'HEAD', '--', ...EXECUTOR_FILES],
    'executor files have drifted since the pinned execution commit',
  );
  gitQuiet(['diff', '--quiet', '--', ...EXECUTOR_FILES], 'unstaged execution/runtime changes block paid execution');
  gitQuiet(['diff', '--cached', '--quiet', '--', ...EXECUTOR_FILES], 'staged execution/runtime changes block paid execution');
}

function parseDocumentFileKey(value) {
  const parts = String(value || '').split('::');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error(`malformed frozen documentFileKey: ${value}`);
  return { library: parts[0], folder: parts[1], filename: parts[2] };
}

function serializeArmResult(armResult) {
  const result = armResult.result;
  return {
    pipelineVersion: armResult.pipelineVersion,
    applicantSeedCount: armResult.applicantSeedCount,
    applicantSeedsHash: armResult.applicantSeedsHash,
    excludedNames: armResult.excludedNames,
    model: result.model || null,
    usedFallback: result.usedFallback === true,
    stopReason: result.stopReason || null,
    attempt: result.attempt || null,
    maxTokens: result.maxTokens || null,
    promptProvenance: result.promptProvenance || null,
    proposalInfo: result.proposalInfo || null,
    reviewerSuggestions: result.reviewerSuggestions || [],
    validation: result.validation ? {
      valid: result.validation.valid === true,
      severity: result.validation.severity || null,
      issues: result.validation.issues || [],
    } : null,
    suggestionShortfall: result.suggestionShortfall || null,
    topUp: result.topUp || null,
  };
}

function assertRunOutputFrozen(result, slot, manifest) {
  if (result.pipelineVersion !== slot.pipelineVersion) throw new Error(`${slot.runId} pipeline version drifted`);
  if (!manifest.runtimeConfig.modelIds.includes(result.model)) throw new Error(`${slot.runId} used unpinned model ${result.model}`);
  if (result.promptProvenance?.promptId !== manifest.runtimeConfig.promptRowId) {
    throw new Error(`${slot.runId} used an unpinned prompt row`);
  }
  if (String(result.promptProvenance?.version) !== manifest.runtimeConfig.promptVersion) {
    throw new Error(`${slot.runId} used an unpinned prompt version`);
  }
}

function acquireLock() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (existsSync(LOCK_PATH)) {
    const previousPid = Number(readFileSync(LOCK_PATH, 'utf8').trim());
    if (Number.isInteger(previousPid)) {
      try {
        process.kill(previousPid, 0);
        throw new Error(`execution lock is held by PID ${previousPid}`);
      } catch (error) {
        if (error.message.startsWith('execution lock')) throw error;
      }
    }
    unlinkSync(LOCK_PATH);
  }
  const fd = openSync(LOCK_PATH, 'wx', 0o600);
  writeFileSync(fd, `${process.pid}\n`);
  closeSync(fd);
  return () => {
    try { unlinkSync(LOCK_PATH); } catch { /* already removed */ }
  };
}

async function loadFrozenInputs({ manifest, proposalEvaluation, cohort, plan }) {
  const observed = await observeRuntimeConfig({ target: 'prod' });
  const diffs = runtimeConfigDiff(manifest.runtimeConfig, observed.runtimeConfig);
  if (diffs.length > 0) throw new Error(`live runtime drift: ${JSON.stringify(diffs)}`);

  const [
    { GraphService },
    { extractTextFromBuffer },
    { loadReviewerRequestContext },
    { buildExclusionSets },
  ] = await Promise.all([
    import('../lib/services/graph-service.js'),
    import('../lib/utils/file-loader.js'),
    import('../lib/services/reviewer-request-context.js'),
    import('../lib/services/reviewer-prompt-composer.js'),
  ]);
  const cohortById = new Map(cohort.proposals.map((item) => [item.proposalId, item]));
  const inputByProposal = new Map();
  const exclusionEntries = [];
  for (const proposalId of manifest.proposalEvaluation.proposalIds) {
    const cohortProposal = cohortById.get(proposalId);
    if (!cohortProposal) throw new Error(`frozen cohort is missing ${proposalId}`);
    const ref = parseDocumentFileKey(cohortProposal.documentFileKey);
    const [downloaded, requestContext, seeds] = await Promise.all([
      GraphService.downloadFileByPath(ref.library, ref.folder, ref.filename),
      loadReviewerRequestContext(proposalId, { includeCoPIs: true, requireCompleteInstitutions: true }),
      loadApplicantRecommendationSeeds(proposalId),
    ]);
    const documentHash = createHash('sha256').update(downloaded.buffer).digest('hex');
    const plannedHash = plan.runs.find((run) => run.proposalId === proposalId)?.documentHash;
    if (documentHash !== cohortProposal.documentHash || documentHash !== plannedHash) {
      throw new Error(`document hash drift for ${proposalId}`);
    }
    if (downloaded.buffer.length !== cohortProposal.documentBytes) {
      throw new Error(`document byte-count drift for ${proposalId}`);
    }
    const proposalText = await extractTextFromBuffer(downloaded.buffer, ref.filename, downloaded.mimeType);
    if (!proposalText || proposalText.trim().length < 100) throw new Error(`document text is unusable for ${proposalId}`);
    const seedNames = applicantRecommendationNames(seeds);
    exclusionEntries.push({
      proposalId,
      exclusions: buildExclusionSets({ excludedNames: seedNames, requestContext }),
    });
    inputByProposal.set(proposalId, { proposalText, requestContext, seeds, ref });
    console.log(`  document ${proposalId}: ${downloaded.buffer.length} bytes, ${proposalText.length} chars, ${seeds.length} seeds`);
  }
  const exclusionsHash = sha256Canonical(exclusionEntries);
  if (exclusionsHash !== manifest.runtimeConfig.exclusionsHash) throw new Error('cached execution exclusions drifted after runtime preflight');
  return { inputByProposal, observed };
}

async function postflightRuntime(manifest) {
  const observed = await observeRuntimeConfig({ target: 'prod' });
  const diffs = runtimeConfigDiff(manifest.runtimeConfig, observed.runtimeConfig);
  if (diffs.length > 0) throw new Error(`postflight runtime drift: ${JSON.stringify(diffs)}`);
  return observed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/run-reviewer-holistic-m1.mjs [--preflight | --execute --confirm-paid-runs=60] [--max-runs=N] [--retry-failed]');
    return;
  }
  loadEnvFile(join(ROOT, '.env.local'));
  loadEnvFile(join(ROOT, '.env.m1.local'));
  const manifest = readJson(MANIFEST_PATH);
  const proposalEvaluation = readJson(EVALUATION_PATH);
  const cohort = readJson(COHORT_PATH);
  const plan = buildReviewerHolisticRunPlan({ manifest, proposalEvaluation });
  assertSourceAttribution(manifest);
  if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY is required');
  if (!process.env.REVIEWER_HOLISTIC_M1_RANDOMIZATION_SEED) throw new Error('REVIEWER_HOLISTIC_M1_RANDOMIZATION_SEED is required');

  console.log(`M1.2 ${args.mode}: validating ${plan.runCount} frozen slots`);
  const preflight = await loadFrozenInputs({ manifest, proposalEvaluation, cohort, plan });
  console.log(`Preflight complete: runtime + 10 documents + 10 request contexts match ${plan.manifestFingerprint}`);
  if (args.mode === 'preflight') return;

  const releaseLock = acquireLock();
  try {
    const artifact = existsSync(EXECUTION_PATH)
      ? readJson(EXECUTION_PATH)
      : buildReviewerHolisticExecutionArtifact(plan);
    const validation = validateReviewerHolisticExecutionArtifact(artifact, plan);
    if (!validation.ok) throw new Error(`execution artifact invalid: ${JSON.stringify(validation.errors)}`);
    if (artifact.status === 'invalid') throw new Error(`execution artifact was invalidated: ${artifact.invalidReason || 'unknown drift'}`);
    artifact.runtimeChecks = artifact.runtimeChecks || {};
    artifact.runtimeChecks.before = {
      checkedAt: new Date().toISOString(),
      runtimeConfig: preflight.observed.runtimeConfig,
    };
    writeJsonAtomic(EXECUTION_PATH, artifact);

    const eligible = artifact.runs
      .filter((run) => run.status === 'pending' || run.status === 'running' || (args.retryFailed && run.status === 'failed'))
      .sort((a, b) => a.runId.localeCompare(b.runId))
      .slice(0, args.maxRuns);
    let attempted = 0;
    for (const slot of eligible) {
      attempted += 1;
      startReviewerHolisticRun(artifact, slot.runId, {
        retryFailed: args.retryFailed,
        retryInterrupted: slot.status === 'running',
      });
      writeJsonAtomic(EXECUTION_PATH, artifact);
      const input = preflight.inputByProposal.get(slot.proposalId);
      console.log(`[${attempted}/${eligible.length}] ${slot.runId} ${slot.arm} replicate ${slot.replicate}`);
      try {
        const armResult = await runReviewerHolisticPipelineArm({
          arm: slot.arm,
          proposalText: input.proposalText,
          apiKey: process.env.CLAUDE_API_KEY,
          requestId: slot.proposalId,
          requestContext: input.requestContext,
          reviewerCount: manifest.runtimeConfig.reviewerCount,
          temperature: manifest.runtimeConfig.temperature,
          loadSeeds: async () => input.seeds,
          onProgress: (event) => {
            if (['prompt_resolved', 'model_resolved', 'fallback', 'complete', 'analysis_invalid'].includes(event.status)) {
              console.log(`  ${slot.runId}: ${event.message}`);
            }
          },
        });
        const result = serializeArmResult(armResult);
        assertRunOutputFrozen(result, slot, manifest);
        completeReviewerHolisticRun(artifact, slot.runId, result);
        console.log(`  ${slot.runId}: completed with ${result.reviewerSuggestions.length} candidates`);
      } catch (error) {
        failReviewerHolisticRun(artifact, slot.runId, error);
        console.error(`  ${slot.runId}: FAILED — ${error.message}`);
      }
      writeJsonAtomic(EXECUTION_PATH, artifact);
    }

    const summary = summarizeReviewerHolisticExecution(artifact);
    console.log(`Execution checkpoint: ${JSON.stringify(summary)}`);
    if (artifact.status === 'complete') {
      try {
        const after = await postflightRuntime(manifest);
        artifact.runtimeChecks.after = {
          checkedAt: new Date().toISOString(),
          runtimeConfig: after.runtimeConfig,
        };
        writeJsonAtomic(EXECUTION_PATH, artifact);
      } catch (error) {
        artifact.status = 'invalid';
        artifact.invalidReason = error.message;
        writeJsonAtomic(EXECUTION_PATH, artifact);
        throw error;
      }
      const { scoringPackage, unblindingMap } = buildReviewerHolisticBlindedArtifacts({
        executionArtifact: artifact,
        plan,
        proposalEvaluation,
        randomizationSeed: process.env.REVIEWER_HOLISTIC_M1_RANDOMIZATION_SEED,
      });
      writeJsonAtomic(SCORING_PATH, scoringPackage);
      writeJsonAtomic(UNBLINDING_PATH, unblindingMap);
      console.log(`Blinded scoring package: ${SCORING_PATH}`);
      console.log(`Separate unblinding map: ${UNBLINDING_PATH}`);
    }
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    releaseLock();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`reviewer holistic M1.2 executor failed: ${error.message}`);
    process.exit(1);
  });
}
