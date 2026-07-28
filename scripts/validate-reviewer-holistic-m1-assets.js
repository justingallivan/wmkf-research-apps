#!/usr/bin/env node
/**
 * Validate the M1 identity-label and blinded proposal-evaluation assets,
 * including approved-cohort and manifest consistency for an explicitly supplied
 * external freeze.
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
function resolveExternalInput(value, flag) {
  const candidate = path.resolve(value);
  const root = path.resolve(ROOT);
  if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${flag} must resolve outside the repository`);
  }
  return candidate;
}

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
  const out = {
    requireFrozen: false,
    requireScored: false,
    manifestPath: null,
    proposalPath: null,
    cohortProposalPath: null,
    identityPath: null,
    identityImportPath: null,
  };
  for (const arg of argv) {
    if (arg === '--require-frozen') {
      out.requireFrozen = true;
    } else if (arg === '--require-scored') {
      out.requireScored = true;
    } else if (arg.startsWith('--manifest-file=')) {
      const value = arg.slice('--manifest-file='.length);
      if (!value) throw new Error('--manifest-file=<path> requires a non-empty path');
      out.manifestPath = resolveExternalInput(value, '--manifest-file');
    } else if (arg.startsWith('--proposal-evaluation-file=')) {
      const value = arg.slice('--proposal-evaluation-file='.length);
      if (!value) throw new Error('--proposal-evaluation-file=<path> requires a non-empty path');
      out.proposalPath = resolveExternalInput(value, '--proposal-evaluation-file');
    } else if (arg.startsWith('--cohort-file=')) {
      const value = arg.slice('--cohort-file='.length);
      if (!value) throw new Error('--cohort-file=<path> requires a non-empty path');
      out.cohortProposalPath = resolveExternalInput(value, '--cohort-file');
    } else if (arg.startsWith('--identity-file=')) {
      const value = arg.slice('--identity-file='.length);
      if (!value) throw new Error('--identity-file=<path> requires a non-empty path');
      out.identityPath = path.resolve(value);
    } else if (arg.startsWith('--identity-import-file=')) {
      const value = arg.slice('--identity-import-file='.length);
      if (!value) throw new Error('--identity-import-file=<path> requires a non-empty path');
      out.identityImportPath = path.resolve(value);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!out.manifestPath) throw new Error('--manifest-file=<path> is required');
  if (!out.proposalPath) throw new Error('--proposal-evaluation-file=<path> is required');
  if (!out.cohortProposalPath) throw new Error('--cohort-file=<path> is required');
  if (out.identityImportPath && !out.identityPath) {
    throw new Error('--identity-import-file requires --identity-file');
  }

  const usesDefaultIdentity = out.identityPath == null;
  const activeManifest = manifest;
  const identityPath = out.identityPath || (
    activeManifest
      ? path.join(
        ROOT,
        'docs/audits',
        identityFileForFixtureVersion(activeManifest?.identityBenchmark?.fixtureVersion),
      )
      : null
  );
  return {
    ...out,
    usesDefaultIdentity,
    identityPath,
    identityImportPath: out.identityImportPath || (
      identityPath
        ? path.join(path.dirname(identityPath), identityImportFileFor(identityPath))
        : null
    ),
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
    options = parseCli(process.argv.slice(2));
    manifest = readJson(options.manifestPath);
    options = parseCli(process.argv.slice(2), { manifest });
    identity = readJson(options.identityPath);
    cohortProposal = readJson(options.cohortProposalPath);
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
    results.push([
      'proposal manifest consistency',
      validateProposalManifestConsistency(manifest, proposals),
    ]);
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
  identityFileForFixtureVersion,
  identityImportFileFor,
  parseCli,
  validateIdentityManifestConsistency,
};
