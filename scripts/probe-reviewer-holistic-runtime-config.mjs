#!/usr/bin/env node
/**
 * Read-only M1.2 runtime-configuration probe.
 *
 * This performs Dataverse and Anthropic model-catalog reads, but no LLM
 * generation and no writes. It derives the exact manifest runtimeConfig from
 * the production prompt, reviewer-finder model overrides, production defaults,
 * and the server-authoritative exclusions for all ten frozen proposals.
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/probe-reviewer-holistic-runtime-config.mjs --target=prod \
 *     --proposal-evaluation-file=/secure/path/proposal-evaluation.json
 *   node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/probe-reviewer-holistic-runtime-config.mjs --target=prod --check-manifest \
 *     --proposal-evaluation-file=/secure/path/proposal-evaluation.json \
 *     --manifest-file=/secure/path/manifest.json
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function resolveExternalInput(value, flag) {
  const candidate = resolve(value);
  if (candidate === ROOT || candidate.startsWith(`${ROOT}${sep}`)) {
    throw new Error(`${flag} must resolve outside the repository`);
  }
  return candidate;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function sha256Canonical(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function runtimeConfigDiff(expected, actual) {
  const keys = new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})]);
  return [...keys]
    .sort()
    .filter((key) => JSON.stringify(canonicalize(expected?.[key]))
      !== JSON.stringify(canonicalize(actual?.[key])))
    .map((key) => ({ key, expected: expected?.[key], actual: actual?.[key] }));
}

function loadEnvLocal() {
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2]
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .replace(/^'(.*)'$/, '$1');
    }
  } catch { /* environment may already be exported */ }
}

export function parseArgs(argv) {
  const out = {
    target: null,
    checkManifest: false,
    proposalEvaluationPath: null,
    manifestPath: null,
  };
  for (const arg of argv) {
    if (arg.startsWith('--target=')) {
      out.target = arg.slice('--target='.length);
    } else if (arg === '--check-manifest') {
      out.checkManifest = true;
    } else if (arg.startsWith('--proposal-evaluation-file=')) {
      const value = arg.slice('--proposal-evaluation-file='.length);
      if (!value) throw new Error('--proposal-evaluation-file=<path> requires a non-empty path');
      out.proposalEvaluationPath = resolveExternalInput(value, '--proposal-evaluation-file');
    } else if (arg.startsWith('--manifest-file=')) {
      const value = arg.slice('--manifest-file='.length);
      if (!value) throw new Error('--manifest-file=<path> requires a non-empty path');
      out.manifestPath = resolveExternalInput(value, '--manifest-file');
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!out.proposalEvaluationPath) {
    throw new Error('--proposal-evaluation-file=<path> is required before production reads');
  }
  if (out.checkManifest && !out.manifestPath) {
    throw new Error('--manifest-file=<path> is required with --check-manifest');
  }
  if (!out.checkManifest && out.manifestPath) {
    throw new Error('--manifest-file is valid only with --check-manifest');
  }
  return out;
}

function isCliEntrypoint() {
  return import.meta.url === pathToFileURL(process.argv[1] || '').href;
}

export async function observeRuntimeConfig({ target, proposalEvaluation, proposalEvaluationPath }) {
  if (target !== 'prod') {
    throw new Error('Explicit --target=prod is required for the frozen production cohort');
  }
  const evaluation = proposalEvaluation || (
    proposalEvaluationPath
      ? JSON.parse(readFileSync(proposalEvaluationPath, 'utf8'))
      : null
  );
  if (!evaluation) {
    throw new Error('An explicit proposal evaluation is required before production reads');
  }
  if (evaluation.status !== 'frozen' || evaluation.proposals?.length !== 10) {
    throw new Error('The M1.2 proposal evaluation must be frozen with exactly ten proposals');
  }

  loadEnvLocal();
  if (!process.env.DYNAMICS_URL) throw new Error('DYNAMICS_URL is not configured');
  if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY is not configured');
  delete process.env.DYNAMICS_SANDBOX_URL;
  process.env.DATAVERSE_ALLOW_PROD_READS = 'yes';

  const [
    { enterDynamicsBypassForScript },
    { DynamicsService },
    { fetchCurrentPrompt },
    { buildExclusionSets },
    { loadReviewerRequestContext },
    { applicantRecommendationNames, loadApplicantRecommendationSeeds },
    { PRODUCTION_HOSTS },
    baseConfig,
  ] = await Promise.all([
    import('../lib/services/dynamics-context.js'),
    import('../lib/services/dynamics-service.js'),
    import('../lib/services/prompt-store.js'),
    import('../lib/services/reviewer-prompt-composer.js'),
    import('../lib/services/reviewer-request-context.js'),
    import('./lib/reviewer-holistic-pipelines.mjs'),
    import('../lib/dataverse/core/target-registry.js'),
    import('../shared/config/baseConfig.js'),
  ]);
  const {
    getCachedAvailableModels,
    isTier,
    loadAvailableModels,
    resolveModel,
  } = require('../lib/services/model-resolver.js');

  const targetHost = new URL(process.env.DYNAMICS_URL).hostname.toLowerCase();
  if (!PRODUCTION_HOSTS.includes(targetHost)) {
    throw new Error(`DYNAMICS_URL host ${targetHost} is not the tracked production target`);
  }

  enterDynamicsBypassForScript('probe-reviewer-holistic-runtime-config');
  const prompt = await fetchCurrentPrompt('reviewer-finder.analyze');
  const settingsResult = await DynamicsService.queryRecords('wmkf_appsystemsettings', {
    select: 'wmkf_settingkey,wmkf_settingvalue',
    filter: "startswith(wmkf_settingkey,'model_override:reviewer-finder:')",
    top: 100,
  });
  const relevantOverrides = Object.fromEntries(
    (settingsResult.records || [])
      .map((row) => [row.wmkf_settingkey, row.wmkf_settingvalue])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const overrideMap = new Map(
    Object.entries(relevantOverrides)
      .map(([key, value]) => [key.replace('model_override:', ''), value]),
  );
  baseConfig._setOverridesCache(overrideMap);
  baseConfig._setModelResolver(resolveModel);
  await loadAvailableModels({ force: true });

  const rawPrimary = baseConfig._getModelForAppRaw('reviewer-finder', 'model');
  const rawFallback = baseConfig._getModelForAppRaw('reviewer-finder', 'fallback');
  if ([rawPrimary, rawFallback].some(isTier) && getCachedAvailableModels().length === 0) {
    throw new Error('Anthropic model catalog was unavailable; refusing fallback-based model pinning');
  }
  const resolvedPrimary = baseConfig.getModelForApp('reviewer-finder');
  const resolvedFallback = baseConfig.getFallbackModelForApp('reviewer-finder');

  const exclusionEntries = await Promise.all(evaluation.proposals.map(async (proposal) => {
    const [requestContext, applicantSeeds] = await Promise.all([
      loadReviewerRequestContext(proposal.proposalId, {
        includeCoPIs: true,
        requireCompleteInstitutions: true,
      }),
      loadApplicantRecommendationSeeds(proposal.proposalId),
    ]);
    return {
      proposalId: proposal.proposalId,
      exclusions: buildExclusionSets({
        excludedNames: applicantRecommendationNames(applicantSeeds),
        requestContext,
      }),
      applicantSeedCount: applicantSeeds.length,
    };
  }));

  const runtimeConfig = {
    promptRowId: prompt.wmkf_ai_promptid,
    promptVersion: String(prompt.wmkf_promptversion),
    promptPayloadHash: sha256Canonical({
      system: prompt.wmkf_ai_systemprompt ?? null,
      body: prompt.wmkf_ai_promptbody ?? null,
      variables: prompt.wmkf_ai_promptvariables ?? null,
      outputSchema: prompt.wmkf_ai_promptoutputschema ?? null,
    }),
    modelIds: [...new Set([resolvedPrimary, resolvedFallback])],
    modelOverridesHash: sha256Canonical(relevantOverrides),
    reviewerCount: 15,
    temperature: 0.3,
    exclusionsHash: sha256Canonical(exclusionEntries.map(({ proposalId, exclusions }) => ({
      proposalId,
      exclusions,
    }))),
  };
  const diagnostics = {
    targetHost,
    promptPayloadHash: runtimeConfig.promptPayloadHash,
    rawModels: { primary: rawPrimary, fallback: rawFallback },
    resolvedModels: { primary: resolvedPrimary, fallback: resolvedFallback },
    exclusionCounts: exclusionEntries.map(({ proposalId, exclusions, applicantSeedCount }) => ({
      proposalId,
      people: exclusions.people.length,
      institutions: exclusions.institutions.length,
      applicantSeeds: applicantSeedCount,
    })),
  };
  return { runtimeConfig, diagnostics };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const observed = await observeRuntimeConfig(args);
  if (args.checkManifest) {
    const manifest = JSON.parse(readFileSync(args.manifestPath, 'utf8'));
    const diffs = runtimeConfigDiff(manifest.runtimeConfig, observed.runtimeConfig);
    if (diffs.length > 0) {
      console.error(JSON.stringify({ status: 'drift', diffs, observed }, null, 2));
      process.exit(1);
    }
  }
  console.log(JSON.stringify({ status: args.checkManifest ? 'match' : 'observed', ...observed }, null, 2));
}

if (isCliEntrypoint()) {
  main().catch((error) => {
    console.error(`reviewer holistic runtime-config probe failed: ${error.message}`);
    process.exit(1);
  });
}
