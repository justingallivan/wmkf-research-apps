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
 *     scripts/probe-reviewer-holistic-runtime-config.mjs --target=prod
 *   node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/probe-reviewer-holistic-runtime-config.mjs --target=prod --check-manifest
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

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

function parseArgs(argv) {
  const targetArg = argv.find((arg) => arg.startsWith('--target='));
  return {
    target: targetArg?.slice('--target='.length) || null,
    checkManifest: argv.includes('--check-manifest'),
  };
}

function isCliEntrypoint() {
  return import.meta.url === pathToFileURL(process.argv[1] || '').href;
}

export async function observeRuntimeConfig({ target }) {
  if (target !== 'prod') {
    throw new Error('Explicit --target=prod is required for the frozen production cohort');
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
    { PRODUCTION_HOSTS },
    baseConfig,
  ] = await Promise.all([
    import('../lib/services/dynamics-context.js'),
    import('../lib/services/dynamics-service.js'),
    import('../lib/services/prompt-store.js'),
    import('../lib/services/reviewer-prompt-composer.js'),
    import('../lib/services/reviewer-request-context.js'),
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
  const evaluation = JSON.parse(readFileSync(
    new URL('../docs/audits/reviewer-holistic-proposal-evaluation-v1.json', import.meta.url),
    'utf8',
  ));
  if (evaluation.status !== 'frozen' || evaluation.proposals?.length !== 10) {
    throw new Error('The M1.2 proposal evaluation must be frozen with exactly ten proposals');
  }

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
    const requestContext = await loadReviewerRequestContext(proposal.proposalId, {
      includeCoPIs: true,
      requireCompleteInstitutions: true,
    });
    return {
      proposalId: proposal.proposalId,
      exclusions: buildExclusionSets({ excludedNames: [], requestContext }),
    };
  }));

  const runtimeConfig = {
    promptRowId: prompt.wmkf_ai_promptid,
    promptVersion: String(prompt.wmkf_promptversion),
    modelIds: [...new Set([resolvedPrimary, resolvedFallback])],
    modelOverridesHash: sha256Canonical(relevantOverrides),
    reviewerCount: 15,
    temperature: 0.3,
    exclusionsHash: sha256Canonical(exclusionEntries),
  };
  const diagnostics = {
    targetHost,
    promptPayloadHash: sha256Canonical({
      system: prompt.wmkf_ai_systemprompt ?? null,
      body: prompt.wmkf_ai_promptbody ?? null,
      variables: prompt.wmkf_ai_promptvariables ?? null,
      outputSchema: prompt.wmkf_ai_promptoutputschema ?? null,
    }),
    rawModels: { primary: rawPrimary, fallback: rawFallback },
    resolvedModels: { primary: resolvedPrimary, fallback: resolvedFallback },
    exclusionCounts: exclusionEntries.map(({ proposalId, exclusions }) => ({
      proposalId,
      people: exclusions.people.length,
      institutions: exclusions.institutions.length,
    })),
  };
  return { runtimeConfig, diagnostics };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const observed = await observeRuntimeConfig(args);
  if (args.checkManifest) {
    const manifest = JSON.parse(readFileSync(
      new URL('../docs/audits/reviewer-holistic-evaluation-manifest-v1.json', import.meta.url),
      'utf8',
    ));
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
