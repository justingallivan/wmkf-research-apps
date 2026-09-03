/**
 * Dry-run-first operator orchestration for missing historical individual-review
 * DOCX retention. Completed pointer pairs leave the manifest population.
 * Manifests bind Production Dataverse plus canonical SharePoint identities and
 * contain identities and hashes, never review content.
 */

import crypto from 'node:crypto';
import { findReviewDocxBackfillPopulation } from '../../dataverse/adapters/reviewer-suggestion.js';
import { parseCycleCode } from '../../utils/cycle-code.js';
import {
  ensureIndividualReviewFile,
  planIndividualReviewFileCandidate,
  preflightReviewDocxWrite,
  resolveReviewDocxTarget,
} from './individual-file-service.js';

export const REVIEW_DOCX_BACKFILL_ARTIFACT = 'review_docx_sharepoint_backfill_v1';
export const REVIEW_DOCX_BACKFILL_SCHEMA_VERSION = 1;

const NON_BLOCKING_STATUSES = new Set([
  'eligible',
  'excluded',
  'not_selected',
  'not_structured',
  'wrong_cycle',
]);

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

function compareCodePointKeys(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function manifestCandidate(plan) {
  return canonicalize({
    suggestionId: plan.suggestionId,
    suggestionEtag: plan.suggestionEtag || null,
    sourceFingerprint: plan.sourceFingerprint || null,
    requestId: plan.requestId || null,
    requestNumber: plan.requestNumber || null,
    receivedAt: plan.receivedAt || null,
    cycleCode: plan.cycleCode || null,
    selected: plan.selected,
    disposition: plan.disposition ?? null,
    richTextPresent: plan.richTextPresent,
    eligibility: plan.status,
    expectedFolder: plan.expectedFolder || null,
    expectedFilename: plan.expectedFilename || null,
    semanticHash: plan.semanticHash || null,
    existingItem: plan.item || null,
    existingSemanticHash: plan.existingSemanticHash || null,
    semanticMatch: plan.semanticMatch ?? null,
    error: plan.error ? { code: plan.error.code || plan.status || 'unknown' } : null,
  });
}

function candidateOrder(left, right) {
  const leftKey = `${left.requestNumber || ''}|${left.receivedAt || ''}|${left.suggestionId || ''}`;
  const rightKey = `${right.requestNumber || ''}|${right.receivedAt || ''}|${right.suggestionId || ''}`;
  return compareCodePointKeys(leftKey, rightKey);
}

function findDuplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const raw of values) {
    if (!raw) continue;
    const value = String(raw).toLowerCase();
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function summarize(candidates, anomalies) {
  const counts = {};
  for (const candidate of candidates) {
    counts[candidate.eligibility] = (counts[candidate.eligibility] || 0) + 1;
  }
  // Closed complement: a new or misspelled classification blocks execution
  // until its semantics are reviewed explicitly.
  const blockingCandidates = candidates.filter(
    (candidate) => !NON_BLOCKING_STATUSES.has(candidate.eligibility),
  );
  return {
    population: candidates.length,
    eligibleMissing: candidates.filter((candidate) => candidate.eligibility === 'eligible' && !candidate.existingItem).length,
    eligibleReconcile: candidates.filter((candidate) => candidate.eligibility === 'eligible' && candidate.semanticMatch === true).length,
    blocking: blockingCandidates.length + anomalies.length,
    counts: canonicalize(counts),
  };
}

function manifestBody({ cycleCode, requestNumber, observedAt, target, candidates, anomalies }) {
  const scope = { cycleCode, requestNumber: requestNumber || null };
  const populationDigest = digest({ scope, target, candidates, anomalies });
  const summary = summarize(candidates, anomalies);
  return canonicalize({
    artifactType: REVIEW_DOCX_BACKFILL_ARTIFACT,
    schemaVersion: REVIEW_DOCX_BACKFILL_SCHEMA_VERSION,
    dryRun: true,
    observedAt,
    scope,
    target,
    populationDigest,
    candidates,
    anomalies,
    summary,
  });
}

export function validateBackfillScope({ cycleCode, requestNumber = null }) {
  const normalizedCycle = typeof cycleCode === 'string' ? cycleCode.trim().toUpperCase() : '';
  if (!parseCycleCode(normalizedCycle) || normalizedCycle !== cycleCode) {
    throw new Error('--cycle must be an exact uppercase cycle code such as D26.');
  }
  const normalizedRequest = requestNumber === null ? null : String(requestNumber).trim();
  if (normalizedRequest !== null && !/^\d+$/.test(normalizedRequest)) {
    throw new Error('--request-number must contain only digits.');
  }
  return { cycleCode: normalizedCycle, requestNumber: normalizedRequest };
}

export async function buildReviewDocxBackfillManifest({
  cycleCode,
  requestNumber = null,
  observedAt = new Date().toISOString(),
} = {}) {
  const scope = validateBackfillScope({ cycleCode, requestNumber });
  const resolvedTarget = await resolveReviewDocxTarget({ requireProductionDataverse: true });
  const target = {
    siteUrl: resolvedTarget.siteUrl,
    siteId: resolvedTarget.siteId,
    driveId: resolvedTarget.driveId,
    dynamicsBase: resolvedTarget.dynamicsBase,
  };
  const discovered = await findReviewDocxBackfillPopulation(scope);
  if (discovered.capped) throw new Error('Review-DOCX backfill discovery hit the Dataverse 5000-row cap.');

  const plans = [];
  for (const row of discovered.records || []) {
    plans.push(await planIndividualReviewFileCandidate(
      row.wmkf_appreviewersuggestionid,
      { cycleCode: scope.cycleCode, target: resolvedTarget },
    ));
  }
  // Discovery selects unfinished rows. If a row finishes between discovery and
  // its authoritative planning read, omit it from this missing-file manifest;
  // execution will still detect any later population change as drift.
  const candidates = plans
    .map(manifestCandidate)
    .filter((candidate) => candidate.eligibility !== 'already_filed')
    .sort(candidateOrder);
  const duplicateSuggestionIds = findDuplicateValues(candidates.map((candidate) => candidate.suggestionId));
  const duplicatePaths = findDuplicateValues(candidates.map((candidate) => (
    candidate.expectedFolder && candidate.expectedFilename
      ? `${candidate.expectedFolder}/${candidate.expectedFilename}`
      : null
  )));
  const anomalies = [];
  if (duplicateSuggestionIds.length > 0) {
    anomalies.push({ code: 'duplicate_suggestion_ids', values: duplicateSuggestionIds });
  }
  if (duplicatePaths.length > 0) {
    anomalies.push({ code: 'duplicate_generated_paths', values: duplicatePaths });
  }
  const eligible = candidates.filter((candidate) => candidate.eligibility === 'eligible');
  if (scope.requestNumber && eligible.length !== 1) {
    anomalies.push({
      code: 'request_scope_not_one_eligible_review',
      requestNumber: scope.requestNumber,
      eligibleCount: eligible.length,
    });
  }

  const body = manifestBody({ ...scope, observedAt, target, candidates, anomalies });
  return { ...body, manifestHash: digest(body) };
}

export function validateReviewDocxBackfillManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Backfill manifest must be a JSON object.');
  }
  if (manifest.artifactType !== REVIEW_DOCX_BACKFILL_ARTIFACT
    || manifest.schemaVersion !== REVIEW_DOCX_BACKFILL_SCHEMA_VERSION
    || manifest.dryRun !== true) {
    throw new Error('Backfill manifest artifact type, schema version, or dry-run marker is invalid.');
  }
  validateBackfillScope(manifest.scope || {});
  if (!Array.isArray(manifest.candidates) || !Array.isArray(manifest.anomalies)) {
    throw new Error('Backfill manifest candidates or anomalies are invalid.');
  }
  const { manifestHash, ...body } = manifest;
  if (!manifestHash || digest(body) !== manifestHash) {
    throw new Error('Backfill manifest hash does not match its current contents.');
  }
  if (body.populationDigest !== digest({
    scope: body.scope,
    target: body.target,
    candidates: body.candidates,
    anomalies: body.anomalies,
  })) {
    throw new Error('Backfill manifest population digest is invalid.');
  }
  return manifest;
}

function reviewedProjection(manifest) {
  return canonicalize({
    scope: manifest.scope,
    target: manifest.target,
    populationDigest: manifest.populationDigest,
    candidates: manifest.candidates,
    anomalies: manifest.anomalies,
    summary: manifest.summary,
  });
}

export async function executeReviewDocxBackfill(manifest) {
  validateReviewDocxBackfillManifest(manifest);
  if (manifest.summary?.blocking !== 0) {
    throw new Error('Backfill manifest contains blocking candidates or anomalies.');
  }

  // Rebuild and compare the complete read-only population before resolving a
  // write-capable target. A mismatch aborts before the first mutation.
  const fresh = await buildReviewDocxBackfillManifest({
    cycleCode: manifest.scope.cycleCode,
    requestNumber: manifest.scope.requestNumber,
  });
  if (JSON.stringify(reviewedProjection(fresh)) !== JSON.stringify(reviewedProjection(manifest))) {
    const error = new Error('Backfill population or source state drifted from the reviewed manifest.');
    error.code = 'manifest_drift';
    throw error;
  }

  const writeSet = fresh.candidates.filter((candidate) => candidate.eligibility === 'eligible');
  if (writeSet.length === 0) {
    const results = fresh.candidates.map((candidate) => ({
      suggestionId: candidate.suggestionId,
      status: 'skipped',
      reason: candidate.eligibility,
    }));
    return {
      status: 'completed',
      manifestHash: manifest.manifestHash,
      results,
      summary: {
        created: 0,
        reconciled: 0,
        skipped: results.length,
        failed: 0,
      },
    };
  }

  const target = await preflightReviewDocxWrite({
    executionMode: 'backfill',
    suggestionIds: writeSet.map((candidate) => candidate.suggestionId),
  });
  if (!sameTarget(target, manifest.target)) {
    const error = new Error('Resolved SharePoint target differs from the reviewed manifest.');
    error.code = 'manifest_target_drift';
    throw error;
  }

  const results = [];
  for (const candidate of fresh.candidates) {
    if (candidate.eligibility !== 'eligible') {
      results.push({
        suggestionId: candidate.suggestionId,
        status: 'skipped',
        reason: candidate.eligibility,
      });
      continue;
    }
    try {
      const result = await ensureIndividualReviewFile(candidate.suggestionId, {
        cycleCode: fresh.scope.cycleCode,
        executionMode: 'backfill',
        target,
        expectedSuggestionEtag: candidate.suggestionEtag,
        expectedSourceFingerprint: candidate.sourceFingerprint,
        expectedSemanticHash: candidate.semanticHash,
      });
      results.push({
        suggestionId: candidate.suggestionId,
        status: ['created', 'reconciled'].includes(result.status) ? result.status : 'failed',
        serviceStatus: result.status,
        expectedFolder: result.expectedFolder || candidate.expectedFolder,
        expectedFilename: result.expectedFilename || candidate.expectedFilename,
        item: result.item || null,
        semanticHash: result.semanticHash || candidate.semanticHash,
        error: result.error ? { code: result.error.code || result.status || 'unknown' } : null,
      });
    } catch (error) {
      results.push({
        suggestionId: candidate.suggestionId,
        status: 'failed',
        serviceStatus: 'unexpected_error',
        error: { code: String(error?.code || 'unexpected_error').slice(0, 100) },
      });
    }
  }

  const summary = { created: 0, reconciled: 0, skipped: 0, failed: 0 };
  for (const result of results) summary[result.status] += 1;
  return {
    status: summary.failed > 0 ? 'completed_with_failures' : 'completed',
    manifestHash: manifest.manifestHash,
    target: manifest.target,
    results,
    summary,
  };
}

export function isBlockingReviewDocxBackfillManifest(manifest) {
  return Number(manifest?.summary?.blocking || 0) > 0;
}
