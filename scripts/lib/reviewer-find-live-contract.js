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

function deploymentSummary(deployment, { baseUrl, expectedCommit, deploymentClass }) {
  const expectedHost = new URL(baseUrl).host;
  const deploymentHost = typeof deployment?.url === 'string' ? deployment.url.replace(/^https:\/\//, '') : null;
  const meta = deployment?.meta && typeof deployment.meta === 'object' ? deployment.meta : {};
  const actualCommit = meta.githubCommitSha || meta.gitCommitSha || deployment?.gitSource?.sha || null;
  const target = deployment?.target || null;
  const classMatches = deploymentClass === 'production'
    ? target === 'production'
    : target !== 'production';
  return {
    ready: deployment?.readyState === 'READY'
      && deploymentHost === expectedHost
      && typeof actualCommit === 'string'
      && actualCommit.toLowerCase() === String(expectedCommit).toLowerCase()
      && classMatches,
    deploymentHost,
    actualCommit: COMMIT_RE.test(String(actualCommit || '')) ? actualCommit : null,
    target: target === 'production' ? 'production' : 'preview',
    reasons: [
      deployment?.readyState === 'READY' ? null : 'deployment_not_ready',
      deploymentHost === expectedHost ? null : 'deployment_host_mismatch',
      typeof actualCommit === 'string' && actualCommit.toLowerCase() === String(expectedCommit).toLowerCase()
        ? null
        : 'deployment_commit_mismatch',
      classMatches ? null : 'deployment_class_mismatch',
    ].filter(Boolean),
  };
}

function summarizeLedger(events, observationId) {
  const disallowed = new Set([
    'postgres_write', 'dataverse_write', 'dataverse_action', 'graph_download',
    'blob_read', 'blob_write', 'proposal_load', 'claude', 'publication_provider',
    'coi_provider', 'contact_provider', 'email', 'job_enqueue',
  ]);
  const effects = {};
  const completeModes = new Set();
  const completeScopeCounts = { cached: 0, reconciled: 0 };
  let incomplete = false;
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.observationId !== observationId) continue;
    if (event.event === 'effect' && typeof event.effectClass === 'string') {
      effects[event.effectClass] = (effects[event.effectClass] || 0) + 1;
    }
    if (event.event === 'complete' && event.complete === true && event.incomplete !== true
      && (event.mode === 'cached' || event.mode === 'reconciled')) {
      completeModes.add(event.mode);
      completeScopeCounts[event.mode] += 1;
    }
    if (event.event === 'observation_incomplete' || event.incomplete === true) incomplete = true;
  }
  const forbiddenEffects = Object.entries(effects)
    .filter(([effectClass, count]) => disallowed.has(effectClass) && count > 0)
    .map(([effectClass]) => effectClass);
  return {
    complete: completeModes.has('cached') && completeModes.has('reconciled') && !incomplete,
    completeModes: [...completeModes].sort(),
    completeScopeCounts,
    forbiddenEffects,
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
  for (const line of jsonLines.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { return []; }
    records.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  const events = [];
  for (const record of records) {
    const candidates = [record?.message, record?.text, record?.output, record?.data]
      .filter((value) => typeof value === 'string');
    for (const candidate of candidates) {
      let event;
      try { event = JSON.parse(candidate); } catch { continue; }
      if (!event || event.kind !== 'reviewer_find_warm_observation' || event.observationId !== observationId) continue;
      if (!['start', 'effect', 'complete', 'observation_incomplete'].includes(event.event)) continue;
      events.push({
        observationId,
        event: event.event,
        effectClass: typeof event.effectClass === 'string' ? event.effectClass : null,
        mode: event.mode === 'cached' || event.mode === 'reconciled' ? event.mode : null,
        complete: event.complete === true,
        incomplete: event.event === 'observation_incomplete' || event.incomplete === true,
        reasonCode: typeof event.reasonCode === 'string' && REASON_CODE_RE.test(event.reasonCode)
          ? event.reasonCode
          : null,
      });
    }
  }
  return events;
}

module.exports = {
  SMOKE_REQUEST_NUMBER,
  OBSERVATION_ID_RE,
  normalizeBaseUrl,
  validateLiveConfig,
  isAllowedBrowserRequest,
  isGuid,
  redactBrowserPath,
  summarizeRoster,
  summarizeWarmValidation,
  validateRuntimeAttestation,
  deploymentSummary,
  summarizeLedger,
  parseVercelObservationEvents,
};
