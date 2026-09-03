/**
 * Exact, manifest-bound relocation of one retained individual-review DOCX.
 *
 * The replacement is generated from Dataverse, create-only uploaded, verified,
 * and then made current by an ETag-conditional pointer update. The prior file is
 * deliberately left untouched for a separately authorized cleanup.
 */

import crypto from 'node:crypto';
import { isGuid } from '../../utils/guid.js';
import { parseCycleCode } from '../../utils/cycle-code.js';
import {
  ensureIndividualReviewFile,
  planIndividualReviewFileCandidate,
  preflightReviewDocxWrite,
  resolveReviewDocxTarget,
} from './individual-file-service.js';

export const REVIEW_DOCX_REPAIR_ARTIFACT = 'review_docx_sharepoint_repair_v1';
export const REVIEW_DOCX_REPAIR_SCHEMA_VERSION = 1;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function sameTarget(left, right) {
  return Boolean(left && right)
    && left.siteUrl === right.siteUrl
    && left.siteId === right.siteId
    && left.driveId === right.driveId
    && left.dynamicsBase === right.dynamicsBase;
}

export function validateRepairScope({ cycleCode, requestNumber, suggestionId }) {
  const cycle = typeof cycleCode === 'string' ? cycleCode.trim().toUpperCase() : '';
  const request = String(requestNumber || '').trim();
  const suggestion = String(suggestionId || '').trim().toLowerCase();
  if (!parseCycleCode(cycle) || cycle !== cycleCode) {
    throw new Error('--cycle must be an exact uppercase cycle code such as D26.');
  }
  if (!/^\d+$/.test(request)) throw new Error('--request-number must contain only digits.');
  if (!isGuid(suggestion)) throw new Error('--suggestion must be a GUID.');
  return { cycleCode: cycle, requestNumber: request, suggestionId: suggestion };
}

function candidateProjection(plan) {
  return canonicalize({
    suggestionId: plan.suggestionId,
    suggestionEtag: plan.suggestionEtag || null,
    sourceFingerprint: plan.sourceFingerprint || null,
    requestId: plan.requestId || null,
    requestNumber: plan.requestNumber || null,
    reviewerName: plan.reviewerName || null,
    receivedAt: plan.receivedAt || null,
    cycleCode: plan.cycleCode || null,
    status: plan.status,
    priorPointer: plan.priorPointer || null,
    expectedFolder: plan.expectedFolder || null,
    expectedFilename: plan.expectedFilename || null,
    semanticHash: plan.semanticHash || null,
    existingItem: plan.item || null,
    existingSemanticHash: plan.existingSemanticHash || null,
    semanticMatch: plan.semanticMatch ?? null,
    error: plan.error ? { code: plan.error.code || plan.status || 'unknown' } : null,
  });
}

function manifestBody({ scope, target, candidate, observedAt }) {
  const blocking = candidate.status === 'eligible_repair' ? 0 : 1;
  return canonicalize({
    artifactType: REVIEW_DOCX_REPAIR_ARTIFACT,
    schemaVersion: REVIEW_DOCX_REPAIR_SCHEMA_VERSION,
    dryRun: true,
    observedAt,
    scope,
    target,
    candidate,
    summary: { blocking, eligibleRepairs: blocking === 0 ? 1 : 0 },
  });
}

export async function buildReviewDocxRepairManifest({
  cycleCode,
  requestNumber,
  suggestionId,
  observedAt = new Date().toISOString(),
} = {}) {
  const scope = validateRepairScope({ cycleCode, requestNumber, suggestionId });
  const resolvedTarget = await resolveReviewDocxTarget({ requireProductionDataverse: true });
  const target = {
    siteUrl: resolvedTarget.siteUrl,
    siteId: resolvedTarget.siteId,
    driveId: resolvedTarget.driveId,
    dynamicsBase: resolvedTarget.dynamicsBase,
  };
  const plan = await planIndividualReviewFileCandidate(scope.suggestionId, {
    cycleCode: scope.cycleCode,
    target,
    allowPointerRepair: true,
  });
  const candidate = candidateProjection(plan);
  if (candidate.requestNumber !== scope.requestNumber) {
    candidate.status = 'request_mismatch';
    candidate.error = { code: 'request_mismatch' };
  }
  const body = manifestBody({ scope, target, candidate, observedAt });
  return { ...body, manifestHash: digest(body) };
}

export function validateReviewDocxRepairManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Repair manifest must be a JSON object.');
  }
  if (manifest.artifactType !== REVIEW_DOCX_REPAIR_ARTIFACT
    || manifest.schemaVersion !== REVIEW_DOCX_REPAIR_SCHEMA_VERSION
    || manifest.dryRun !== true) {
    throw new Error('Repair manifest artifact type, schema version, or dry-run marker is invalid.');
  }
  validateRepairScope(manifest.scope || {});
  const { manifestHash, ...body } = manifest;
  if (!manifestHash || digest(body) !== manifestHash) {
    throw new Error('Repair manifest hash does not match its current contents.');
  }
  const candidate = manifest.candidate || {};
  if (candidate.suggestionId !== manifest.scope.suggestionId
    || candidate.requestNumber !== manifest.scope.requestNumber) {
    throw new Error('Repair manifest candidate does not match its scope.');
  }
  if (manifest.summary?.blocking === 0) {
    if (candidate.status !== 'eligible_repair'
      || !candidate.suggestionEtag
      || !candidate.sourceFingerprint
      || !candidate.semanticHash
      || !candidate.priorPointer?.folder
      || !candidate.priorPointer?.filename
      || !candidate.expectedFolder
      || !candidate.expectedFilename) {
      throw new Error('Nonblocking repair manifest is missing its exact source or target contract.');
    }
    if (candidate.priorPointer.folder === candidate.expectedFolder
      && candidate.priorPointer.filename === candidate.expectedFilename) {
      throw new Error('Repair source and target pointers must differ.');
    }
    if (candidate.existingItem && candidate.semanticMatch !== true) {
      throw new Error('An existing repair target must match the reviewed semantic content.');
    }
  }
  const expectedBlocking = candidate.status === 'eligible_repair' ? 0 : 1;
  if (manifest.summary?.blocking !== expectedBlocking
    || manifest.summary?.eligibleRepairs !== (expectedBlocking === 0 ? 1 : 0)) {
    throw new Error('Repair manifest summary does not match its candidate.');
  }
  if (!manifest.target?.siteUrl || !manifest.target?.siteId
    || !manifest.target?.driveId || !manifest.target?.dynamicsBase) {
    throw new Error('Repair manifest target identity is incomplete.');
  }
  return manifest;
}

function reviewedProjection(manifest) {
  return canonicalize({
    scope: manifest.scope,
    target: manifest.target,
    candidate: manifest.candidate,
    summary: manifest.summary,
  });
}

export async function executeReviewDocxRepair(manifest) {
  validateReviewDocxRepairManifest(manifest);
  if (manifest.summary.blocking !== 0) {
    throw new Error('Repair manifest contains a blocking candidate.');
  }
  const fresh = await buildReviewDocxRepairManifest(manifest.scope);
  if (JSON.stringify(reviewedProjection(fresh)) !== JSON.stringify(reviewedProjection(manifest))) {
    const error = new Error('Repair source, destination, or target drifted from the reviewed manifest.');
    error.code = 'manifest_drift';
    throw error;
  }
  const target = await preflightReviewDocxWrite({
    executionMode: 'backfill',
    suggestionIds: [manifest.scope.suggestionId],
  });
  if (!sameTarget(target, manifest.target)) {
    const error = new Error('Resolved SharePoint target differs from the reviewed repair manifest.');
    error.code = 'manifest_target_drift';
    throw error;
  }
  const result = await ensureIndividualReviewFile(manifest.scope.suggestionId, {
    cycleCode: manifest.scope.cycleCode,
    executionMode: 'backfill',
    target,
    expectedSuggestionEtag: manifest.candidate.suggestionEtag,
    expectedSourceFingerprint: manifest.candidate.sourceFingerprint,
    expectedSemanticHash: manifest.candidate.semanticHash,
    repairFromPointer: manifest.candidate.priorPointer,
  });
  const succeeded = result.status === 'created' || result.status === 'reconciled';
  const targetPointer = {
    folder: result.expectedFolder || manifest.candidate.expectedFolder,
    filename: result.expectedFilename || manifest.candidate.expectedFilename,
  };
  return {
    status: succeeded ? 'completed' : 'failed',
    manifestHash: manifest.manifestHash,
    suggestionId: manifest.scope.suggestionId,
    requestNumber: manifest.scope.requestNumber,
    priorPointer: manifest.candidate.priorPointer,
    currentPointer: succeeded ? targetPointer : null,
    targetPointer,
    priorFileCleanup: 'deferred',
    result: {
      status: result.status,
      semanticHash: result.semanticHash || manifest.candidate.semanticHash,
      item: result.item || null,
      error: result.error ? { code: result.error.code || result.status || 'unknown' } : null,
    },
    summary: { repaired: succeeded ? 1 : 0, failed: succeeded ? 0 : 1 },
  };
}
