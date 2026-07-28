#!/usr/bin/env node
/**
 * Validate the frozen-input contract for the reviewer holistic redesign.
 *
 * This script is pure and read-only: it never calls Dataverse, an LLM, or the
 * network. Draft manifests may retain null/empty freeze fields while the
 * evaluation set is assembled. `--require-frozen` is the hard precondition for
 * any baseline-vs-redesign run and rejects every incomplete freeze field.
 *
 * Usage:
 *   node scripts/validate-reviewer-holistic-evaluation-manifest.js \
 *     --manifest-file=/secure/path/manifest.json [--require-frozen]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SHA1_RE = /^[0-9a-f]{40}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_STRING_RE = /^[1-9]\d*$/;
const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'status',
  'freezePoint',
  'createdAt',
  'baseline',
  'redesign',
  'execution',
  'identityBenchmark',
  'proposalEvaluation',
  'runtimeConfig',
  'rubric',
  'adjudicator',
  'artifactSchemaVersion',
  'evaluationScriptVersion',
]);
const NESTED_KEYS = {
  baseline: new Set(['origin', 'commit', 'runtimeBehavior']),
  redesign: new Set(['startingCommit', 'implementationCommit', 'pipelineVersion']),
  execution: new Set(['implementationCommit', 'scriptVersion', 'artifactVersion']),
  identityBenchmark: new Set([
    'fixtureVersion',
    'minimumCases',
    'hazardMinimum',
    'cleanPositiveMinimum',
    'labelingPolicy',
  ]),
  proposalEvaluation: new Set([
    'proposalIds',
    'documentHashes',
    'replicatesPerArm',
    'selectionPolicy',
  ]),
  runtimeConfig: new Set([
    'promptRowId',
    'promptVersion',
    'promptPayloadHash',
    'modelIds',
    'modelOverridesHash',
    'reviewerCount',
    'temperature',
    'exclusionsHash',
  ]),
  rubric: new Set(['version', 'identityHardGates', 'proposalPilotGates']),
  'rubric.identityHardGates': new Set([
    'hazardFalseBindingsMax',
    'unsafeActionsMax',
    'correctionIntegrityRequired',
    'cleanPositiveAbstentionIncreaseMaxCases',
  ]),
  'rubric.proposalPilotGates': new Set([
    'wrongPersonIncreaseMax',
    'lossesMax',
    'winsMin',
    'winMarginMin',
    'eligibleShortlistNonInferior',
  ]),
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateManifest(manifest, { requireFrozen = false } = {}) {
  const errors = [];
  const add = (pathName, message) => errors.push({ path: pathName, message });

  if (!isObject(manifest)) {
    return { ok: false, errors: [{ path: '$', message: 'manifest must be an object' }] };
  }

  for (const key of Object.keys(manifest)) {
    if (!TOP_LEVEL_KEYS.has(key)) add(key, 'unknown top-level field');
  }
  const rejectUnknown = (value, keyPath) => {
    if (!isObject(value)) return;
    for (const key of Object.keys(value)) {
      if (!NESTED_KEYS[keyPath].has(key)) add(`${keyPath}.${key}`, 'unknown field');
    }
  };

  if (manifest.schemaVersion !== 1) add('schemaVersion', 'must equal 1');
  if (!['draft', 'frozen'].includes(manifest.status)) add('status', 'must be draft or frozen');
  if (manifest.freezePoint !== 'after_shared_c0_containment') {
    add('freezePoint', 'must equal after_shared_c0_containment');
  }
  if (!nonEmptyString(manifest.createdAt) || Number.isNaN(Date.parse(manifest.createdAt))) {
    add('createdAt', 'must be an ISO-compatible timestamp');
  }
  if (manifest.artifactSchemaVersion !== 1) add('artifactSchemaVersion', 'must equal 1');
  if (manifest.evaluationScriptVersion != null && !nonEmptyString(manifest.evaluationScriptVersion)) {
    add('evaluationScriptVersion', 'must be null or non-empty');
  }

  const baseline = isObject(manifest.baseline) ? manifest.baseline : {};
  if (!isObject(manifest.baseline)) add('baseline', 'must be an object');
  rejectUnknown(manifest.baseline, 'baseline');
  if (baseline.origin !== 'origin/main') add('baseline.origin', 'must equal origin/main');
  if (baseline.runtimeBehavior !== 'legacy-default') {
    add('baseline.runtimeBehavior', 'must equal legacy-default');
  }
  if (baseline.commit != null && !SHA1_RE.test(String(baseline.commit))) {
    add('baseline.commit', 'must be null or a 40-character commit SHA');
  }

  const redesign = isObject(manifest.redesign) ? manifest.redesign : {};
  if (!isObject(manifest.redesign)) add('redesign', 'must be an object');
  rejectUnknown(manifest.redesign, 'redesign');
  if (redesign.startingCommit != null && !SHA1_RE.test(String(redesign.startingCommit))) {
    add('redesign.startingCommit', 'must be null or a 40-character commit SHA');
  }
  if (redesign.implementationCommit != null && !SHA1_RE.test(String(redesign.implementationCommit))) {
    add('redesign.implementationCommit', 'must be null or a 40-character commit SHA');
  }
  if (redesign.pipelineVersion != null && !nonEmptyString(redesign.pipelineVersion)) {
    add('redesign.pipelineVersion', 'must be null or non-empty');
  }

  const execution = isObject(manifest.execution) ? manifest.execution : {};
  if (!isObject(manifest.execution)) add('execution', 'must be an object');
  rejectUnknown(manifest.execution, 'execution');
  if (execution.implementationCommit != null && !SHA1_RE.test(String(execution.implementationCommit))) {
    add('execution.implementationCommit', 'must be null or a 40-character commit SHA');
  }
  if (execution.scriptVersion != null && !nonEmptyString(execution.scriptVersion)) {
    add('execution.scriptVersion', 'must be null or non-empty');
  }
  if (execution.artifactVersion != null && !nonEmptyString(execution.artifactVersion)) {
    add('execution.artifactVersion', 'must be null or non-empty');
  }

  const identity = isObject(manifest.identityBenchmark) ? manifest.identityBenchmark : {};
  if (!isObject(manifest.identityBenchmark)) add('identityBenchmark', 'must be an object');
  rejectUnknown(manifest.identityBenchmark, 'identityBenchmark');
  if (identity.minimumCases !== 40) add('identityBenchmark.minimumCases', 'must equal 40');
  if (identity.hazardMinimum !== 20) add('identityBenchmark.hazardMinimum', 'must equal 20');
  if (identity.cleanPositiveMinimum !== 20) {
    add('identityBenchmark.cleanPositiveMinimum', 'must equal 20');
  }
  if (identity.labelingPolicy !== 'single_reviewer_blinded') {
    add('identityBenchmark.labelingPolicy', 'must equal single_reviewer_blinded');
  }
  if (identity.fixtureVersion != null && !nonEmptyString(identity.fixtureVersion)) {
    add('identityBenchmark.fixtureVersion', 'must be null or non-empty');
  }

  const proposals = isObject(manifest.proposalEvaluation) ? manifest.proposalEvaluation : {};
  if (!isObject(manifest.proposalEvaluation)) add('proposalEvaluation', 'must be an object');
  rejectUnknown(manifest.proposalEvaluation, 'proposalEvaluation');
  if (!Array.isArray(proposals.proposalIds)) {
    add('proposalEvaluation.proposalIds', 'must be an array');
  }
  if (!isObject(proposals.documentHashes)) {
    add('proposalEvaluation.documentHashes', 'must be an object');
  }
  if (proposals.replicatesPerArm !== 3) {
    add('proposalEvaluation.replicatesPerArm', 'must equal 3');
  }
  if (proposals.selectionPolicy !== 'held_out_stratified_thin_and_full_signal') {
    add('proposalEvaluation.selectionPolicy', 'must equal held_out_stratified_thin_and_full_signal');
  }

  const runtime = isObject(manifest.runtimeConfig) ? manifest.runtimeConfig : {};
  if (!isObject(manifest.runtimeConfig)) add('runtimeConfig', 'must be an object');
  rejectUnknown(manifest.runtimeConfig, 'runtimeConfig');
  if (!Array.isArray(runtime.modelIds)) add('runtimeConfig.modelIds', 'must be an array');
  if (runtime.promptRowId != null && !GUID_RE.test(String(runtime.promptRowId))) {
    add('runtimeConfig.promptRowId', 'must be null or a GUID');
  }
  if (runtime.promptVersion != null && !POSITIVE_INTEGER_STRING_RE.test(String(runtime.promptVersion))) {
    add('runtimeConfig.promptVersion', 'must be null or a positive-integer string');
  }
  if (runtime.promptPayloadHash != null && !SHA256_RE.test(String(runtime.promptPayloadHash))) {
    add('runtimeConfig.promptPayloadHash', 'must be null or a SHA-256 hash');
  }
  if (Array.isArray(runtime.modelIds) && runtime.modelIds.some((x) => !nonEmptyString(x))) {
    add('runtimeConfig.modelIds', 'must contain only non-empty model IDs');
  }
  if (runtime.modelOverridesHash != null && !SHA256_RE.test(String(runtime.modelOverridesHash))) {
    add('runtimeConfig.modelOverridesHash', 'must be null or a SHA-256 hash');
  }
  if (runtime.reviewerCount != null && (!Number.isInteger(runtime.reviewerCount) || runtime.reviewerCount <= 0)) {
    add('runtimeConfig.reviewerCount', 'must be null or a positive integer');
  }
  if (
    runtime.temperature != null
    && (
      typeof runtime.temperature !== 'number'
      || !Number.isFinite(runtime.temperature)
      || runtime.temperature < 0
      || runtime.temperature > 1
    )
  ) {
    add('runtimeConfig.temperature', 'must be null or a finite number from 0 through 1');
  }
  if (runtime.exclusionsHash != null && !SHA256_RE.test(String(runtime.exclusionsHash))) {
    add('runtimeConfig.exclusionsHash', 'must be null or a SHA-256 hash');
  }

  const rubric = isObject(manifest.rubric) ? manifest.rubric : {};
  if (!isObject(manifest.rubric)) add('rubric', 'must be an object');
  rejectUnknown(manifest.rubric, 'rubric');
  if (rubric.version !== 'reviewer-holistic-v1') add('rubric.version', 'must equal reviewer-holistic-v1');
  const identityGates = isObject(rubric.identityHardGates) ? rubric.identityHardGates : {};
  const proposalGates = isObject(rubric.proposalPilotGates) ? rubric.proposalPilotGates : {};
  rejectUnknown(rubric.identityHardGates, 'rubric.identityHardGates');
  rejectUnknown(rubric.proposalPilotGates, 'rubric.proposalPilotGates');
  if (identityGates.hazardFalseBindingsMax !== 0) {
    add('rubric.identityHardGates.hazardFalseBindingsMax', 'must equal 0');
  }
  if (identityGates.unsafeActionsMax !== 0) {
    add('rubric.identityHardGates.unsafeActionsMax', 'must equal 0');
  }
  if (identityGates.correctionIntegrityRequired !== 1) {
    add('rubric.identityHardGates.correctionIntegrityRequired', 'must equal 1');
  }
  if (identityGates.cleanPositiveAbstentionIncreaseMaxCases !== 1) {
    add('rubric.identityHardGates.cleanPositiveAbstentionIncreaseMaxCases', 'must equal 1');
  }
  if (proposalGates.wrongPersonIncreaseMax !== 0) {
    add('rubric.proposalPilotGates.wrongPersonIncreaseMax', 'must equal 0');
  }
  if (proposalGates.lossesMax !== 2) add('rubric.proposalPilotGates.lossesMax', 'must equal 2');
  if (proposalGates.winsMin !== 4) add('rubric.proposalPilotGates.winsMin', 'must equal 4');
  if (proposalGates.winMarginMin !== 2) add('rubric.proposalPilotGates.winMarginMin', 'must equal 2');
  if (proposalGates.eligibleShortlistNonInferior !== true) {
    add('rubric.proposalPilotGates.eligibleShortlistNonInferior', 'must equal true');
  }
  if (manifest.adjudicator !== null) {
    add('adjudicator', 'must be null for the single-reviewer identity benchmark');
  }

  const mustBeFrozen = requireFrozen || manifest.status === 'frozen';
  if (mustBeFrozen) {
    if (manifest.status !== 'frozen') add('status', 'must be frozen');
    if (!SHA1_RE.test(String(baseline.commit || ''))) add('baseline.commit', 'must be a 40-character commit SHA');
    if (!SHA1_RE.test(String(redesign.startingCommit || ''))) {
      add('redesign.startingCommit', 'must be a 40-character commit SHA');
    }
    if (!SHA1_RE.test(String(redesign.implementationCommit || ''))) {
      add('redesign.implementationCommit', 'must be a 40-character commit SHA');
    }
    if (!nonEmptyString(redesign.pipelineVersion)) {
      add('redesign.pipelineVersion', 'must be non-empty');
    }
    if (!SHA1_RE.test(String(execution.implementationCommit || ''))) {
      add('execution.implementationCommit', 'must be a 40-character commit SHA');
    }
    if (!nonEmptyString(execution.scriptVersion)) add('execution.scriptVersion', 'must be non-empty');
    if (!nonEmptyString(execution.artifactVersion)) add('execution.artifactVersion', 'must be non-empty');
    if (!nonEmptyString(identity.fixtureVersion)) {
      add('identityBenchmark.fixtureVersion', 'must be non-empty');
    }
    if (!nonEmptyString(manifest.evaluationScriptVersion)) {
      add('evaluationScriptVersion', 'must be non-empty');
    }

    const ids = Array.isArray(proposals.proposalIds) ? proposals.proposalIds : [];
    if (ids.length !== 10) add('proposalEvaluation.proposalIds', 'must contain exactly 10 proposals');
    if (ids.some((id) => !nonEmptyString(id))) {
      add('proposalEvaluation.proposalIds', 'must contain non-empty string IDs');
    }
    if (new Set(ids).size !== ids.length) add('proposalEvaluation.proposalIds', 'must be unique');
    const hashes = isObject(proposals.documentHashes) ? proposals.documentHashes : {};
    for (const id of ids) {
      if (!SHA256_RE.test(String(hashes[id] || ''))) {
        add(`proposalEvaluation.documentHashes.${id}`, 'must be a SHA-256 hash');
      }
    }
    for (const id of Object.keys(hashes)) {
      if (!ids.includes(id)) add(`proposalEvaluation.documentHashes.${id}`, 'has no matching proposalId');
    }

    if (!GUID_RE.test(String(runtime.promptRowId || ''))) add('runtimeConfig.promptRowId', 'must be a GUID');
    if (!POSITIVE_INTEGER_STRING_RE.test(String(runtime.promptVersion || ''))) {
      add('runtimeConfig.promptVersion', 'must be a positive-integer string');
    }
    if (!SHA256_RE.test(String(runtime.promptPayloadHash || ''))) {
      add('runtimeConfig.promptPayloadHash', 'must be a SHA-256 hash');
    }
    if (!Array.isArray(runtime.modelIds) || runtime.modelIds.length === 0 || runtime.modelIds.some((x) => !nonEmptyString(x))) {
      add('runtimeConfig.modelIds', 'must contain non-empty model IDs');
    }
    if (!SHA256_RE.test(String(runtime.modelOverridesHash || ''))) {
      add('runtimeConfig.modelOverridesHash', 'must be a SHA-256 hash');
    }
    if (!Number.isInteger(runtime.reviewerCount) || runtime.reviewerCount <= 0) {
      add('runtimeConfig.reviewerCount', 'must be a positive integer');
    }
    if (
      typeof runtime.temperature !== 'number'
      || !Number.isFinite(runtime.temperature)
      || runtime.temperature < 0
      || runtime.temperature > 1
    ) {
      add('runtimeConfig.temperature', 'must be a finite number from 0 through 1');
    }
    if (!SHA256_RE.test(String(runtime.exclusionsHash || ''))) {
      add('runtimeConfig.exclusionsHash', 'must be a SHA-256 hash');
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateCommitReferences(manifest, { repoRoot = path.join(__dirname, '..') } = {}) {
  const errors = [];
  for (const [pathName, commit] of [
    ['baseline.commit', manifest?.baseline?.commit],
    ['redesign.startingCommit', manifest?.redesign?.startingCommit],
    ['redesign.implementationCommit', manifest?.redesign?.implementationCommit],
    ['execution.implementationCommit', manifest?.execution?.implementationCommit],
  ]) {
    if (commit == null) continue;
    try {
      execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
    } catch {
      errors.push({ path: pathName, message: 'must resolve to a commit in the local repository' });
    }
  }
  return { ok: errors.length === 0, errors };
}

const REPO_ROOT = path.resolve(__dirname, '..');

function resolveExternalInput(value, flag) {
  const candidate = path.resolve(value);
  if (candidate === REPO_ROOT || candidate.startsWith(`${REPO_ROOT}${path.sep}`)) {
    throw new Error(`${flag} must resolve outside the repository`);
  }
  return candidate;
}

function parseCli(argv) {
  const out = { requireFrozen: false, manifestPath: null };
  for (const arg of argv) {
    if (arg === '--require-frozen') {
      out.requireFrozen = true;
    } else if (arg.startsWith('--manifest-file=')) {
      const value = arg.slice('--manifest-file='.length);
      if (!value) throw new Error('--manifest-file=<path> requires a non-empty path');
      out.manifestPath = resolveExternalInput(value, '--manifest-file');
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!out.manifestPath) throw new Error('--manifest-file=<path> is required');
  return out;
}

function main() {
  let requireFrozen;
  let manifestPath;
  let manifest;
  try {
    ({ requireFrozen, manifestPath } = parseCli(process.argv.slice(2)));
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`manifest read failed: ${error.message}`);
    process.exit(1);
  }
  const result = validateManifest(manifest, { requireFrozen });
  if (!result.ok) {
    console.error(`reviewer holistic evaluation manifest INVALID (${manifestPath})`);
    for (const error of result.errors) console.error(`  - ${error.path}: ${error.message}`);
    process.exit(1);
  }
  if (
    requireFrozen
    || manifest.status === 'frozen'
    || manifest?.baseline?.commit != null
    || manifest?.redesign?.startingCommit != null
  ) {
    const commitResult = validateCommitReferences(manifest);
    if (!commitResult.ok) {
      console.error(`reviewer holistic evaluation manifest has unresolved commits (${manifestPath})`);
      for (const error of commitResult.errors) console.error(`  - ${error.path}: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`reviewer holistic evaluation manifest OK (${manifest.status}; ${manifestPath})`);
}

if (require.main === module) main();

module.exports = { parseCli, validateCommitReferences, validateManifest };
