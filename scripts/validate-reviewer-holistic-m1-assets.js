#!/usr/bin/env node
/**
 * Validate the M1 identity-label and blinded proposal-evaluation assets.
 * Draft assets may be empty; any populated row must already satisfy its full
 * data-entry contract. Freeze/scored modes add the M1 cohort and completion
 * gates. This script is pure and performs no network or Dataverse access.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  validateIdentityBenchmark,
  validateIdentityLabelingImport,
  validateProposalCohortProposal,
  validateProposalEvaluation,
} = require('./lib/reviewer-holistic-m1');

const ROOT = path.join(__dirname, '..');
const DEFAULT_IDENTITY_PATH = path.join(
  ROOT,
  'docs/audits/reviewer-holistic-identity-benchmark-v1.json',
);
const DEFAULT_PROPOSAL_PATH = path.join(
  ROOT,
  'docs/audits/reviewer-holistic-proposal-evaluation-v1.json',
);
const DEFAULT_COHORT_PROPOSAL_PATH = path.join(
  ROOT,
  'docs/audits/reviewer-holistic-proposal-cohort-proposal-v1.json',
);
const IDENTITY_IMPORT_FILE = 'reviewer-holistic-identity-labeling-import-v1.json';
const DEFAULT_IDENTITY_IMPORT_PATH = path.join(ROOT, 'docs/audits', IDENTITY_IMPORT_FILE);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseCli(argv) {
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
  const identityPath = positional[0] || DEFAULT_IDENTITY_PATH;
  return {
    requireFrozen,
    requireScored,
    identityPath,
    identityImportPath: path.join(path.dirname(identityPath), IDENTITY_IMPORT_FILE),
    proposalPath: positional[1] || DEFAULT_PROPOSAL_PATH,
  };
}

function main() {
  const options = parseCli(process.argv.slice(2));
  let identity;
  let identityImport;
  let cohortProposal;
  let proposals;
  try {
    identity = readJson(options.identityPath);
    cohortProposal = readJson(DEFAULT_COHORT_PROPOSAL_PATH);
    proposals = readJson(options.proposalPath);
    if (identity.status === 'frozen') identityImport = readJson(options.identityImportPath);
  } catch (error) {
    console.error(`M1 asset read failed: ${error.message}`);
    process.exit(1);
  }

  const results = [
    ['identity benchmark', validateIdentityBenchmark(identity, { requireFrozen: options.requireFrozen })],
    ['proposal evaluation', validateProposalEvaluation(proposals, {
      requireFrozen: options.requireFrozen,
      requireScored: options.requireScored,
    })],
    ['proposal cohort proposal', validateProposalCohortProposal(cohortProposal)],
  ];
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
  DEFAULT_IDENTITY_PATH,
  DEFAULT_IDENTITY_IMPORT_PATH,
  DEFAULT_COHORT_PROPOSAL_PATH,
  DEFAULT_PROPOSAL_PATH,
  parseCli,
};
