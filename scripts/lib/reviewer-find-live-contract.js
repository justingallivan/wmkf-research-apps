/**
 * Pure contracts for the authenticated Reviewer Find warm-smoke runner.
 *
 * This module intentionally contains no network, browser, or credential
 * handling.  Keeping the safety decisions pure makes the live runner's
 * fail-closed behaviour testable without a deployed app or a staff session.
 */

const SMOKE_REQUEST_NUMBER = '1002788';
const OBSERVATION_ID_RE = /^rfw_[a-z0-9]{16,64}$/i;
const DEPLOYMENT_ID_RE = /^[a-z0-9_-]{6,128}$/i;
const COMMIT_RE = /^[a-f0-9]{7,64}$/i;
const ROSTER_VERSION_RE = /^[a-f0-9]{64}$/i;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID_IN_PATH_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const REASON_CODE_RE = /^[a-z][a-z0-9_]{0,79}$/;
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const OBSERVATION_EFFECT_CLASSES = new Set([
  'postgres_read', 'postgres_write', 'dataverse_read', 'dataverse_write',
  'dataverse_action', 'graph_metadata', 'graph_download', 'blob_read',
  'blob_write', 'proposal_load', 'claude', 'publication_provider',
  'coi_provider', 'contact_provider', 'email', 'job_enqueue',
]);
const LIVE_WARM_TIMING_BUDGETS = Object.freeze({
  // These are the plan's current provisional product hypotheses. They are a
  // fail-closed manual smoke guard, not a CI performance SLO.
  cachedCandidateUiVisibleMs: 2_000,
  reconciledRosterUiReadyMs: 5_000,
});
const MAX_COMPLETE_EFFECT_COUNT = 64;
const LEDGER_PHASE_MAX_WAIT_MS = Object.freeze({
  // Do not let preflight log ingestion consume the entire run before the
  // browser and post-browser ledger can establish their own evidence.
  preflight: 20_000,
  final: 45_000,
});

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function validateLiveConfig({
  baseUrl,
  deploymentId,
  expectedCommit,
  deploymentClass = 'preview',
  confirmProductionReadOnly = false,
  observationId,
} = {}) {
  const failures = [];
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) failures.push('invalid_base_url');
  if (!DEPLOYMENT_ID_RE.test(String(deploymentId || ''))) failures.push('invalid_deployment_id');
  if (!COMMIT_RE.test(String(expectedCommit || ''))) failures.push('invalid_expected_commit');
  if (!['preview', 'production'].includes(deploymentClass)) failures.push('invalid_deployment_class');
  if (deploymentClass === 'production' && confirmProductionReadOnly !== true) {
    failures.push('production_confirmation_required');
  }
  if (!OBSERVATION_ID_RE.test(String(observationId || ''))) failures.push('invalid_observation_id');
  return {
    ok: failures.length === 0,
    failures,
    baseUrl: normalizedBaseUrl,
  };
}

function isAllowedBrowserRequest({ method, url, baseUrl }) {
  if (!ALLOWED_METHODS.has(String(method || '').toUpperCase())) return false;
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function isGuid(value) {
  return GUID_RE.test(String(value || ''));
}

function redactBrowserPath(url, baseUrl) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(baseUrl).origin) return 'external';
    // The path alone is bounded and has no request/query values. Dynamic
    // Workbench GUIDs are normalized before becoming an artifact field.
    return parsed.pathname.replace(GUID_IN_PATH_RE, ':requestId').slice(0, 160);
  } catch {
    return 'invalid';
  }
}

function summarizeRoster(roster) {
  const safeBuckets = ['active', 'excluded', 'ineligible', 'blocked'];
  const counts = {};
  for (const bucket of safeBuckets) {
    counts[bucket] = Array.isArray(roster?.[bucket]) ? roster[bucket].length : 0;
  }
  return {
    rosterVersion: ROSTER_VERSION_RE.test(String(roster?.rosterVersion || ''))
      ? roster.rosterVersion
      : null,
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

function summarizeWarmValidation(warmValidation) {
  const state = ['current', 'stale', 'error'].includes(warmValidation?.state)
    ? warmValidation.state
    : 'unclassified';
  const binding = ['canonical', 'fallback'].includes(warmValidation?.proposal?.binding)
    ? warmValidation.proposal.binding
    : ['canonical', 'fallback'].includes(warmValidation?.binding)
      ? warmValidation.binding
      : null;
  const contentVersion = warmValidation?.proposalContentVersion;
  return {
    state,
    reasonCode: typeof warmValidation?.reasonCode === 'string'
      ? warmValidation.reasonCode.slice(0, 80)
      : null,
    binding,
    hasVersionedMetadata: ROSTER_VERSION_RE.test(String(contentVersion || '')),
  };
}

function validateRuntimeAttestation(attestation, expectedDeploymentClass) {
  const normalized = {
    scope: typeof attestation?.scope === 'string' ? attestation.scope : null,
    deploymentClass: typeof attestation?.deploymentClass === 'string'
      ? attestation.deploymentClass
      : null,
    dataverseTargetClass: typeof attestation?.dataverseTargetClass === 'string'
      ? attestation.dataverseTargetClass
      : null,
    interlockMode: typeof attestation?.interlockMode === 'string'
      ? attestation.interlockMode
      : null,
  };
  return {
    ok: normalized.scope === 'reviewer_roster_warm_read_only'
      && (expectedDeploymentClass === 'preview' || expectedDeploymentClass === 'production')
      && normalized.deploymentClass === expectedDeploymentClass
      && normalized.dataverseTargetClass === 'production'
      && normalized.interlockMode === 'on',
    value: normalized,
  };
}

function deploymentHost(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const candidate = value.includes('://') ? value : `https://${value}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/') return null;
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

function inspectedAliasHosts(deployment) {
  const rawAliases = [deployment?.aliases, deployment?.alias]
    .flatMap((value) => Array.isArray(value) ? value : [value]);
  return [...new Set(rawAliases.map(deploymentHost).filter(Boolean))];
}

function deploymentSummary(deployment, { baseUrl, expectedCommit, deploymentClass }) {
  const expectedHost = new URL(baseUrl).host.toLowerCase();
  const immutableDeploymentHost = deploymentHost(deployment?.url);
  const aliases = inspectedAliasHosts(deployment);
  const baseHostMatch = immutableDeploymentHost === expectedHost
    ? 'immutable'
    : aliases.includes(expectedHost)
      ? 'alias'
      : null;
  const meta = deployment?.meta && typeof deployment.meta === 'object' ? deployment.meta : {};
  const actualCommit = meta.githubCommitSha || meta.gitCommitSha || deployment?.gitSource?.sha || null;
  const target = deployment?.target || null;
  const classMatches = deploymentClass === 'production'
    ? target === 'production'
    : target !== 'production';
  return {
    ready: deployment?.readyState === 'READY'
      && baseHostMatch !== null
      && typeof actualCommit === 'string'
      && actualCommit.toLowerCase() === String(expectedCommit).toLowerCase()
      && classMatches,
    deploymentHost: immutableDeploymentHost,
    baseHostMatch,
    actualCommit: COMMIT_RE.test(String(actualCommit || '')) ? actualCommit : null,
    target: target === 'production' ? 'production' : 'preview',
    reasons: [
      deployment?.readyState === 'READY' ? null : 'deployment_not_ready',
      baseHostMatch !== null ? null : 'deployment_base_host_unlisted',
      typeof actualCommit === 'string' && actualCommit.toLowerCase() === String(expectedCommit).toLowerCase()
        ? null
        : 'deployment_commit_mismatch',
      classMatches ? null : 'deployment_class_mismatch',
    ].filter(Boolean),
  };
}

function enrichDeploymentWithListing(inspectedDeployment, listingPayload) {
  if (!inspectedDeployment || typeof inspectedDeployment.url !== 'string' || !inspectedDeployment.id) {
    return inspectedDeployment;
  }
  const matches = Array.isArray(listingPayload?.deployments)
    ? listingPayload.deployments.filter((deployment) => {
      if (deployment?.url !== inspectedDeployment.url) return false;
      // Newer `vercel list --json` responses include an immutable deployment
      // ID. When one is present, it must agree with inspect. Some supported
      // CLI responses omit it; in that case the inspect ID -> immutable host
      // proof plus a *unique* exact-host listing remains the join boundary.
      const listedId = deployment?.id || deployment?.uid || null;
      return listedId === null || listedId === inspectedDeployment.id;
    })
    : [];
  if (matches.length !== 1) return inspectedDeployment;
  const listedDeployment = matches[0];
  const inspectedMeta = inspectedDeployment.meta && typeof inspectedDeployment.meta === 'object'
    ? inspectedDeployment.meta
    : null;
  const listedMeta = listedDeployment.meta && typeof listedDeployment.meta === 'object'
    ? listedDeployment.meta
    : null;
  const inspectedHasCommit = typeof inspectedMeta?.githubCommitSha === 'string'
    || typeof inspectedMeta?.gitCommitSha === 'string';
  const listedCommitMeta = typeof listedMeta?.githubCommitSha === 'string'
    ? { githubCommitSha: listedMeta.githubCommitSha }
    : typeof listedMeta?.gitCommitSha === 'string'
      ? { gitCommitSha: listedMeta.gitCommitSha }
      : null;
  const inspectedGitSource = inspectedDeployment.gitSource && typeof inspectedDeployment.gitSource === 'object'
    ? inspectedDeployment.gitSource
    : null;
  const listedGitSource = listedDeployment.gitSource && typeof listedDeployment.gitSource === 'object'
    ? listedDeployment.gitSource
    : null;
  const inspectedHasGitSha = typeof inspectedGitSource?.sha === 'string';
  const listedGitSourceWithSha = typeof listedGitSource?.sha === 'string'
    ? { sha: listedGitSource.sha }
    : null;
  return {
    ...inspectedDeployment,
    // `list` is used only to fill the Git commit fields absent from inspect.
    // In particular it must never contribute aliases or other deployment
    // identity fields; stable callback aliases are authoritative only from the
    // inspected deployment/API response.
    meta: inspectedHasCommit
      ? inspectedMeta
      : listedCommitMeta
        ? { ...(inspectedMeta || {}), ...listedCommitMeta }
        : inspectedMeta,
    gitSource: inspectedHasGitSha
      ? inspectedGitSource
      : listedGitSourceWithSha
        ? { ...(inspectedGitSource || {}), ...listedGitSourceWithSha }
        : inspectedGitSource,
  };
}

function validateWarmVisitMilestones({
  cachedCandidateUiVisibleMs,
  reconciledRosterUiReadyMs,
  reconciliationPendingAtCachedUi,
} = {}) {
  const reasons = [];
  if (reconciliationPendingAtCachedUi !== true) {
    reasons.push('cached_ui_not_observed_before_reconciliation');
  }
  if (!Number.isFinite(cachedCandidateUiVisibleMs)
    || cachedCandidateUiVisibleMs < 0
    || cachedCandidateUiVisibleMs > LIVE_WARM_TIMING_BUDGETS.cachedCandidateUiVisibleMs) {
    reasons.push('cached_candidate_ui_budget_exceeded');
  }
  if (!Number.isFinite(reconciledRosterUiReadyMs)
    || reconciledRosterUiReadyMs < 0
    || reconciledRosterUiReadyMs > LIVE_WARM_TIMING_BUDGETS.reconciledRosterUiReadyMs) {
    reasons.push('reconciled_roster_ui_budget_exceeded');
  }
  return { ok: reasons.length === 0, reasons };
}

function observationLogPollPlan({ nowMs, deadlineAtMs, intervalMs = 2_000, maxQueryMs = 10_000 } = {}) {
  const remainingMs = Number.isFinite(deadlineAtMs) && Number.isFinite(nowMs)
    ? Math.max(0, deadlineAtMs - nowMs)
    : 0;
  if (remainingMs < 1) return { canPoll: false, queryTimeoutMs: 0, retryDelayMs: 0 };
  return {
    canPoll: true,
    queryTimeoutMs: Math.max(1, Math.min(maxQueryMs, remainingMs)),
    retryDelayMs: Math.max(0, Math.min(intervalMs, Math.max(0, remainingMs - 1))),
  };
}

function ledgerPhaseDeadline({ nowMs, globalDeadlineAtMs, phase } = {}) {
  const phaseBudget = LEDGER_PHASE_MAX_WAIT_MS[phase];
  if (!Number.isFinite(nowMs) || !Number.isFinite(globalDeadlineAtMs) || !phaseBudget) return null;
  return Math.min(globalDeadlineAtMs, nowMs + phaseBudget);
}

function normalizeCompleteEffectCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > OBSERVATION_EFFECT_CLASSES.size) return null;
  const normalized = {};
  for (const [effectClass, count] of entries) {
    if (!OBSERVATION_EFFECT_CLASSES.has(effectClass)
      || !Number.isSafeInteger(count)
      || count < 0
      || count > MAX_COMPLETE_EFFECT_COUNT) {
      return null;
    }
    normalized[effectClass] = count;
  }
  return normalized;
}

function summarizeLedger(events, observationId) {
  const disallowed = new Set([
    'postgres_write', 'dataverse_write', 'dataverse_action', 'graph_download',
    'blob_read', 'blob_write', 'proposal_load', 'claude', 'publication_provider',
    'coi_provider', 'contact_provider', 'email', 'job_enqueue',
  ]);
  const effects = {};
  const unknownEffects = [];
  const completeModes = new Set();
  const completeScopeCounts = { cached: 0, reconciled: 0 };
  const completeSummaryFailures = [];
  const completeSummaryForbiddenEffects = new Set();
  let incomplete = false;
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.observationId !== observationId) continue;
    if (event.event === 'effect' && typeof event.effectClass === 'string') {
      effects[event.effectClass] = (effects[event.effectClass] || 0) + 1;
      if (!OBSERVATION_EFFECT_CLASSES.has(event.effectClass)) unknownEffects.push(event.effectClass);
    }
    if (event.event === 'complete' && event.complete === true && event.incomplete === false
      && (event.mode === 'cached' || event.mode === 'reconciled')) {
      const summary = normalizeCompleteEffectCounts(event.effectCounts);
      if (!summary) {
        completeSummaryFailures.push(`${event.mode}_complete_effect_counts_invalid`);
        continue;
      }
      for (const [effectClass, count] of Object.entries(summary)) {
        if (disallowed.has(effectClass) && count > 0) completeSummaryForbiddenEffects.add(effectClass);
      }
      if (event.mode === 'cached' && (summary.postgres_read || 0) < 1) {
        completeSummaryFailures.push('cached_complete_postgres_read_missing');
        continue;
      }
      if (event.mode === 'reconciled'
        && ((summary.postgres_read || 0) < 1 || (summary.dataverse_read || 0) < 1)) {
        completeSummaryFailures.push('reconciled_complete_required_read_missing');
        continue;
      }
      if (completeSummaryForbiddenEffects.size > 0) continue;
      completeModes.add(event.mode);
      completeScopeCounts[event.mode] += 1;
    }
    if (event.event === 'observation_incomplete' || event.incomplete === true) incomplete = true;
  }
  const forbiddenEffects = Object.entries(effects)
    .filter(([effectClass, count]) => disallowed.has(effectClass) && count > 0)
    .map(([effectClass]) => effectClass);
  return {
    complete: completeModes.has('cached')
      && completeModes.has('reconciled')
      && !incomplete
      && unknownEffects.length === 0
      && completeSummaryFailures.length === 0
      && completeSummaryForbiddenEffects.size === 0,
    completeModes: [...completeModes].sort(),
    completeScopeCounts,
    incomplete,
    forbiddenEffects,
    unknownEffects: [...new Set(unknownEffects)].sort(),
    completeSummaryFailures: [...new Set(completeSummaryFailures)].sort(),
    completeSummaryForbiddenEffects: [...completeSummaryForbiddenEffects].sort(),
    effectCounts: effects,
  };
}

/**
 * Extract only the bounded warm-observation schema from Vercel's JSON-lines
 * log response. Any non-JSON/non-schema record is ignored; callers fail closed
 * when the resulting ledger lacks a complete positive control. Raw log text is
 * never returned or persisted because it may contain application data.
 */
function parseVercelObservationEvents(jsonLines, observationId) {
  if (typeof jsonLines !== 'string' || jsonLines.length > 262144) return [];
  const records = [];
  let malformedCorrelatedObservation = false;
  const hasCorrelatedObservationMarker = (value) => typeof value === 'string'
    && (value.includes(observationId) || value.includes('reviewer_find_warm_observation'));
  for (const line of jsonLines.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed;
    // Vercel's CLI can interleave non-JSON diagnostics with its JSONL stream.
    // Ignore a malformed unrelated line; a pass still requires the complete,
    // exact-correlation positive controls below.
    try { parsed = JSON.parse(line); } catch {
      // An unrelated CLI diagnostic is not observation evidence. A malformed
      // line that names this observation (or its unique schema marker), though,
      // could conceal the complete/effect event the runner needs. Record only a
      // bounded incomplete marker; never retain the raw line.
      if (hasCorrelatedObservationMarker(line)) malformedCorrelatedObservation = true;
      continue;
    }
    records.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  const events = [];
  for (const record of records) {
    const candidates = [record, record?.message, record?.text, record?.output, record?.data]
      .filter((value) => typeof value === 'string' || (value && typeof value === 'object'));
    for (const candidate of candidates) {
      let event;
      if (typeof candidate === 'string') {
        try { event = JSON.parse(candidate); } catch {
          if (hasCorrelatedObservationMarker(candidate)) malformedCorrelatedObservation = true;
          continue;
        }
      } else {
        event = candidate;
      }
      if (!event || Array.isArray(event) || event.kind !== 'reviewer_find_warm_observation'
        || event.observationId !== observationId || event.route !== 'reviewer_roster') continue;
      if (!['start', 'effect', 'complete', 'observation_incomplete'].includes(event.event)) continue;
      events.push({
        observationId,
        event: event.event,
        effectClass: typeof event.effectClass === 'string' ? event.effectClass : null,
        mode: event.mode === 'cached' || event.mode === 'reconciled' ? event.mode : null,
        complete: event.complete === true,
        incomplete: event.event === 'observation_incomplete' || event.incomplete === true,
        effectCounts: event.event === 'complete'
          ? normalizeCompleteEffectCounts(event.effectCounts)
          : null,
        reasonCode: typeof event.reasonCode === 'string' && REASON_CODE_RE.test(event.reasonCode)
          ? event.reasonCode
          : null,
      });
    }
  }
  if (malformedCorrelatedObservation) {
    events.push({
      observationId,
      event: 'observation_incomplete',
      effectClass: null,
      mode: null,
      complete: false,
      incomplete: true,
      effectCounts: null,
      reasonCode: 'malformed_observation_log_line',
    });
  }
  return events;
}

module.exports = {
  SMOKE_REQUEST_NUMBER,
  OBSERVATION_ID_RE,
  LIVE_WARM_TIMING_BUDGETS,
  LEDGER_PHASE_MAX_WAIT_MS,
  normalizeBaseUrl,
  validateLiveConfig,
  isAllowedBrowserRequest,
  isGuid,
  redactBrowserPath,
  summarizeRoster,
  summarizeWarmValidation,
  validateRuntimeAttestation,
  deploymentSummary,
  enrichDeploymentWithListing,
  validateWarmVisitMilestones,
  observationLogPollPlan,
  ledgerPhaseDeadline,
  normalizeCompleteEffectCounts,
  summarizeLedger,
  parseVercelObservationEvents,
};
