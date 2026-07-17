#!/usr/bin/env node
/**
 * Validate the M1 identity-label and blinded proposal-evaluation assets,
 * including approved-cohort and manifest consistency for the tracked freeze.
 * Draft assets may be empty; any populated row must already satisfy its full
 * data-entry contract. Freeze/scored modes add the M1 cohort and completion
 * gates. This script is pure and performs no network or Dataverse access.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  validateIdentityBenchmark,
  validateIdentityLabelingImport,
  validateProposalCohortFreeze,
  validateProposalCohortProposal,
  validateProposalEvaluation,
  validateProposalManifestConsistency,
} = require('./lib/reviewer-holistic-m1');
const {
  validateManifest,
} = require('./validate-reviewer-holistic-evaluation-manifest');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PROPOSAL_PATH = path.join(
  ROOT,
  'docs/audits/reviewer-holistic-proposal-evaluation-v1.json',
);
const DEFAULT_COHORT_PROPOSAL_PATH = path.join(
  ROOT,
  'docs/audits/reviewer-holistic-proposal-cohort-proposal-v1.json',
);
const DEFAULT_MANIFEST_PATH = path.join(
  ROOT,
  'docs/audits/reviewer-holistic-evaluation-manifest-v2.json',
);

function identityFileForFixtureVersion(fixtureVersion) {
  const match = String(fixtureVersion || '').match(/^reviewer-identity-(v\d+)$/);
  if (!match) {
    throw new Error(
      'manifest identityBenchmark.fixtureVersion must match reviewer-identity-vN',
    );
  }
  return `reviewer-holistic-identity-benchmark-${match[1]}.json`;
}

function identityImportFileFor(identityPath) {
  const match = path.basename(identityPath).match(/reviewer-holistic-identity-benchmark-(v\d+)\.json$/);
  if (!match) {
    throw new Error(
      'identity benchmark path must be named reviewer-holistic-identity-benchmark-vN.json',
    );
  }
  return `reviewer-holistic-identity-labeling-import-${match[1]}.json`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseCli(argv, { manifest } = {}) {
  const allowedFlags = new Set(['--require-frozen', '--require-scored']);
  const unknownFlags = argv.filter((arg) => arg.startsWith('--') && !allowedFlags.has(arg));
  if (unknownFlags.length > 0) {
    throw new Error(`unknown arguments: ${unknownFlags.join(', ')}`);
  }
  const requireFrozen = argv.includes('--require-frozen');
  const requireScored = argv.includes('--require-scored');
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  if (positional.length > 2) {
    throw new Error(`unknown positional arguments: ${positional.slice(2).join(', ')}`);
  }
  const usesDefaultIdentity = positional[0] == null;
  const activeManifest = manifest || readJson(DEFAULT_MANIFEST_PATH);
  const identityPath = positional[0] || path.join(
    ROOT,
    'docs/audits',
    identityFileForFixtureVersion(activeManifest?.identityBenchmark?.fixtureVersion),
  );
  return {
    requireFrozen,
    requireScored,
    usesDefaultIdentity,
    identityPath,
    identityImportPath: path.join(path.dirname(identityPath), identityImportFileFor(identityPath)),
    proposalPath: positional[1] || DEFAULT_PROPOSAL_PATH,
  };
}

function validateIdentityManifestConsistency(manifest, identity) {
  const errors = [];
  const fixtureVersion = manifest?.identityBenchmark?.fixtureVersion;
  if (typeof fixtureVersion !== 'string' || fixtureVersion.trim().length === 0) {
    errors.push({
      path: 'manifest.identityBenchmark.fixtureVersion',
      message: 'must be a non-empty string',
    });
  }
  if (identity?.status !== 'frozen') {
    errors.push({
      path: 'identity.status',
      message: 'active manifest fixture must be frozen',
    });
  }
  if (identity?.benchmarkVersion !== fixtureVersion) {
    errors.push({
      path: 'identity.benchmarkVersion',
      message: 'must match manifest.identityBenchmark.fixtureVersion',
    });
  }
  return { ok: errors.length === 0, errors };
}

function main() {
  let options;
  let identity;
  let identityImport;
  let cohortProposal;
  let manifest;
  let proposals;
  try {
    manifest = readJson(DEFAULT_MANIFEST_PATH);
    options = parseCli(process.argv.slice(2), { manifest });
    identity = readJson(options.identityPath);
    cohortProposal = readJson(DEFAULT_COHORT_PROPOSAL_PATH);
    proposals = readJson(options.proposalPath);
    if (identity.status === 'frozen') identityImport = readJson(options.identityImportPath);
  } catch (error) {
    console.error(`M1 asset read failed: ${error.message}`);
    process.exit(1);
  }

  const results = [
    ['evaluation manifest', validateManifest(manifest, { requireFrozen: true })],
    ['identity benchmark', validateIdentityBenchmark(identity, { requireFrozen: options.requireFrozen })],
    ['proposal evaluation', validateProposalEvaluation(proposals, {
      requireFrozen: options.requireFrozen,
      requireScored: options.requireScored,
    })],
    ['proposal cohort proposal', validateProposalCohortProposal(cohortProposal)],
  ];
  if (options.usesDefaultIdentity) {
    results.splice(1, 0, [
      'identity manifest consistency',
      validateIdentityManifestConsistency(manifest, identity),
    ]);
  }
  if (proposals.status === 'frozen' || proposals.status === 'scored') {
    results.push([
      'proposal cohort freeze consistency',
      validateProposalCohortFreeze(cohortProposal, proposals),
    ]);
    if (path.resolve(options.proposalPath) === path.resolve(DEFAULT_PROPOSAL_PATH)) {
      results.push([
        'proposal manifest consistency',
        validateProposalManifestConsistency(manifest, proposals),
      ]);
    }
  }
  if (identity.status === 'frozen') {
    results.splice(1, 0, [
      'identity labeling import',
      validateIdentityLabelingImport(identityImport, identity),
    ]);
  }
  let failed = false;
  for (const [label, result] of results) {
    if (result.ok) continue;
    failed = true;
    console.error(`${label} INVALID`);
    for (const error of result.errors) console.error(`  - ${error.path}: ${error.message}`);
  }
  if (failed) process.exit(1);
  console.log(`reviewer holistic M1 assets OK (${identity.status}; ${proposals.status}; ${cohortProposal.status})`);
}

if (require.main === module) main();

module.exports = {
  DEFAULT_COHORT_PROPOSAL_PATH,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_PROPOSAL_PATH,
  identityFileForFixtureVersion,
  identityImportFileFor,
  parseCli,
  validateIdentityManifestConsistency,
};
