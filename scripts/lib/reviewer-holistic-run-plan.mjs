/**
 * Pure M1.2 run-plan contract. This module performs no network, Dataverse, file,
 * or LLM access. It converts the frozen manifest + proposal asset into exactly
 * 60 attributable run slots (10 proposals x 2 arms x 3 replicates).
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import {
  REVIEWER_HOLISTIC_BASELINE_PIPELINE_VERSION,
  REVIEWER_HOLISTIC_REDESIGN_PIPELINE_VERSION,
} from './reviewer-holistic-pipelines.mjs';

const require = createRequire(import.meta.url);
const { validateManifest } = require('../validate-reviewer-holistic-evaluation-manifest.js');
const {
  validateProposalEvaluation,
  validateProposalManifestConsistency,
} = require('./reviewer-holistic-m1.js');

export const REVIEWER_HOLISTIC_EVALUATION_SCRIPT_VERSION = 'reviewer-holistic-m1-run-plan-v1';

const ARM_PIPELINES = Object.freeze({
  baseline: REVIEWER_HOLISTIC_BASELINE_PIPELINE_VERSION,
  redesign: REVIEWER_HOLISTIC_REDESIGN_PIPELINE_VERSION,
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sha256Canonical(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function assertValid(label, result) {
  if (result.ok) return;
  const detail = result.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
  throw new Error(`${label} is not runnable: ${detail}`);
}

function runIdFor(slot) {
  return `M1RUN-${sha256Canonical(slot).slice(0, 16).toUpperCase()}`;
}

export function buildReviewerHolisticRunPlan({ manifest, proposalEvaluation }) {
  assertValid('evaluation manifest', validateManifest(manifest, { requireFrozen: true }));
  assertValid(
    'proposal evaluation',
    validateProposalEvaluation(proposalEvaluation, { requireFrozen: true }),
  );
  assertValid(
    'manifest/proposal consistency',
    validateProposalManifestConsistency(manifest, proposalEvaluation),
  );

  if (manifest.evaluationScriptVersion !== REVIEWER_HOLISTIC_EVALUATION_SCRIPT_VERSION) {
    throw new Error(`evaluationScriptVersion must equal ${REVIEWER_HOLISTIC_EVALUATION_SCRIPT_VERSION}`);
  }
  if (manifest.baseline.runtimeBehavior !== ARM_PIPELINES.baseline) {
    throw new Error(`baseline runtimeBehavior must equal ${ARM_PIPELINES.baseline}`);
  }
  if (manifest.redesign.pipelineVersion !== ARM_PIPELINES.redesign) {
    throw new Error(`redesign pipelineVersion must equal ${ARM_PIPELINES.redesign}`);
  }

  const proposalById = new Map(
    proposalEvaluation.proposals.map((proposal) => [proposal.proposalId, proposal]),
  );
  const runs = [];
  for (const proposalId of manifest.proposalEvaluation.proposalIds) {
    const proposal = proposalById.get(proposalId);
    for (const arm of Object.keys(ARM_PIPELINES)) {
      for (let replicate = 1; replicate <= manifest.proposalEvaluation.replicatesPerArm; replicate += 1) {
        const slot = {
          proposalId,
          blindProposalId: proposal.blindProposalId,
          documentHash: proposal.documentHash,
          arm,
          replicate,
          pipelineVersion: ARM_PIPELINES[arm],
          pipelineCommit: arm === 'baseline'
            ? manifest.baseline.commit
            : manifest.redesign.implementationCommit,
        };
        runs.push({ runId: runIdFor(slot), ...slot });
      }
    }
  }

  if (runs.length !== 60 || new Set(runs.map((run) => run.runId)).size !== runs.length) {
    throw new Error('run plan must contain exactly 60 unique attributable run slots');
  }

  const fingerprintInput = {
    evaluationScriptVersion: manifest.evaluationScriptVersion,
    baseline: manifest.baseline,
    redesign: manifest.redesign,
    proposalEvaluation: manifest.proposalEvaluation,
    runtimeConfig: manifest.runtimeConfig,
  };
  return {
    schemaVersion: 1,
    evaluationScriptVersion: REVIEWER_HOLISTIC_EVALUATION_SCRIPT_VERSION,
    manifestFingerprint: sha256Canonical(fingerprintInput),
    runCount: runs.length,
    runs,
  };
}

