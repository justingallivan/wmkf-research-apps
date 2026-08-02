#!/usr/bin/env node
/**
 * Authenticated, read-only Reviewer Find warm-smoke runner.
 *
 * This runner is deliberately stricter than a normal browser check. It uses a
 * locally captured, normal Microsoft session; permits only same-origin GET/
 * HEAD/OPTIONS browser traffic; and never clicks an action. It is restricted
 * to the dedicated no-send request 1002788. A preflight that cannot prove the
 * named deployment, target, proposal binding, roster, and observation ledger
 * stops before any Workbench navigation.
 *
 * It relies on two separate authoritative proofs: a redacted runtime
 * Dataverse-target attestation returned by the observed warm route, and a
 * bounded Vercel CLI runtime-log query for the exact deployment/observation
 * pair. CLI values and browser request inspection are not substitutes for
 * either proof.
 *
 * Usage:
 *   npm run smoke:reviewer-find:preflight -- \
 *     --base-url https://<exact-preview>.vercel.app \
 *     --deployment-id <vercel-deployment-id> --commit <git-sha>
 *
 *   npm run smoke:reviewer-find:live -- [same arguments]
 *
 * Required local state:
 *   .auth/reviewer-find-live.json captured with
 *   npm run smoke:reviewer-find:auth -- --base-url <exact-preview-url>
 *
 * Optional environment:
 *   VERCEL_TOKEN=<read-only token>       Optional fallback if the authenticated CLI is unavailable.
 *   VERCEL_TEAM_ID=<team id>             Passed only to Vercel's deployment read API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SMOKE_REQUEST_NUMBER,
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
} = require('./lib/reviewer-find-live-contract');

const DEFAULT_AUTH_STATE = path.join('.auth', 'reviewer-find-live.json');
const ARTIFACT_ROOT = path.join('.artifacts', 'reviewer-find-live');
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_RUN_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;
const CLI_TIMEOUT_MS = 30_000;
const CLI_MAX_OUTPUT_BYTES = 262144;

function arg(name, defaultValue = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : defaultValue;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function usage() {
  console.log(`Usage:
  node scripts/live-reviewer-find-smoke.mjs preflight --base-url <exact-preview-url> --deployment-id <id> --commit <sha>
  node scripts/live-reviewer-find-smoke.mjs run --base-url <exact-preview-url> --deployment-id <id> --commit <sha>

Options:
  --auth-state .auth/reviewer-find-live.json
  --deployment-class preview|production    (default: preview)
  --confirm-production-read-only           required only for a post-merge production confirmation
  --dry-run                                validate local arguments only; makes no network request

This tool is read-only and fixed to request ${SMOKE_REQUEST_NUMBER}. It refuses auth bypasses,
browser mutation methods, off-origin browser requests, and unverified observation evidence.`);
}

function newObservationId() {
  return `rfw_${randomBytes(16).toString('hex')}`;
}

function localAuthStatePath(value) {
  const requested = path.resolve(value || DEFAULT_AUTH_STATE);
  const authRoot = path.resolve('.auth') + path.sep;
  if (!requested.startsWith(authRoot) || path.extname(requested) !== '.json') return null;
  return requested;
}

function status(state, key, readiness, reason = null, detail = null) {
  state.readiness[key] = { readiness, reason, ...(detail ? { detail } : {}) };
}

function ready(state, key) {
  return state.readiness[key]?.readiness === 'ready';
}

function allRequiredReady(state) {
  return ['deployment', 'auth', 'target', 'request', 'proposal', 'roster', 'observation']
    .every((key) => ready(state, key));
}

function boundedElapsed(startedAt) {
  return Math.min(MAX_RUN_MS, Math.max(0, Date.now() - startedAt));
}

function writeArtifact(state) {
  const directory = path.join(ARTIFACT_ROOT, state.observationId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const artifact = {
    schemaVersion: 1,
    kind: 'reviewer_find_read_only_smoke',
    observationId: state.observationId,
    requestNumber: SMOKE_REQUEST_NUMBER,
    mode: state.mode,
    startedAt: state.startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: boundedElapsed(state.startedAtMs),
    pass: state.pass === true,
    deployment: state.deployment,
    readiness: state.readiness,
    milestones: state.milestones,
    browserRequestCounts: state.browserRequestCounts,
    blockedBrowserRequests: state.blockedBrowserRequests,
    // Never include request GUIDs, reviewer data, full response payloads,
    // cookies, headers, file paths, raw Vercel logs, or error messages.
  };
  const output = path.join(directory, 'result.json');
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return output;
}

function runVercelCli(args, { timeoutMs = CLI_TIMEOUT_MS, maxOutputBytes = CLI_MAX_OUTPUT_BYTES } = {}) {
  return new Promise((resolve) => {
    const child = spawn('vercel', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let exceeded = false;
    let timedOut = false;
    let settled = false;
    let timeout = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    const append = (target, chunk) => {
      const next = target + String(chunk);
      if (Buffer.byteLength(next, 'utf8') > maxOutputBytes) {
        exceeded = true;
        child.kill('SIGKILL');
        return target;
      }
      return next;
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', () => finish({ ok: false, reason: 'vercel_cli_unavailable' }));
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code) => {
      if (timedOut) return finish({ ok: false, reason: 'vercel_cli_timeout' });
      if (exceeded) return finish({ ok: false, reason: 'vercel_cli_output_limit_exceeded' });
      if (code !== 0) return finish({ ok: false, reason: 'vercel_cli_command_failed' });
      // Vercel CLI emits its own update/fetch diagnostics on stderr even for a
      // successful JSON command. Discard bounded stderr; stdout must still
      // parse and validate exactly before any evidence can pass.
      return finish({ ok: true, stdout });
    });
  });
}

function parseCliJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

async function readDeployment({ deploymentId, baseUrl, expectedCommit, deploymentClass }) {
  const cli = await runVercelCli(['inspect', deploymentId, '--json']);
  if (cli.ok) {
    const deployment = parseCliJson(cli.stdout);
    if (!deployment || deployment.id !== deploymentId) {
      return { ok: false, reason: 'vercel_cli_deployment_response_invalid' };
    }
    const summary = deploymentSummary(deployment, { baseUrl, expectedCommit, deploymentClass });
    return summary.ready
      ? { ok: true, summary }
      : { ok: false, reason: summary.reasons[0] || 'vercel_deployment_unverified', summary };
  }

  const token = process.env.VERCEL_TOKEN;
  if (!token) return { ok: false, reason: cli.reason };
  const query = process.env.VERCEL_TEAM_ID
    ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}`
    : '';
  let response;
  try {
    response = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}${query}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'vercel_deployment_query_failed' };
  }
  if (!response.ok) return { ok: false, reason: 'vercel_deployment_query_rejected' };
  let deployment;
  try {
    deployment = await response.json();
  } catch {
    return { ok: false, reason: 'vercel_deployment_response_invalid' };
  }
  if (deployment?.id !== deploymentId) return { ok: false, reason: 'vercel_deployment_id_mismatch' };
  const summary = deploymentSummary(deployment, { baseUrl, expectedCommit, deploymentClass });
  return summary.ready
    ? { ok: true, summary }
    : { ok: false, reason: summary.reasons[0] || 'vercel_deployment_unverified', summary };
}

async function readObservationLedger({ deploymentId, observationId, startedAt, minimumCompleteScopesPerMode = 1 }) {
  let latest = { ok: false, reason: 'observation_log_query_not_attempted' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const cli = await runVercelCli([
      'logs',
      '--deployment', deploymentId,
      '--since', startedAt,
      '--until', new Date().toISOString(),
      '--query', observationId,
      '--json',
      '--limit', '512',
    ], { timeoutMs: 10_000 });
    if (!cli.ok) {
      latest = { ok: false, reason: cli.reason };
    } else {
      const events = parseVercelObservationEvents(cli.stdout, observationId);
      const ledger = summarizeLedger(events, observationId);
      if (!ledger.complete) {
        latest = { ok: false, reason: 'observation_complete_event_missing_or_incomplete', ledger };
      } else if ((ledger.effectCounts.postgres_read || 0) < 1) {
        latest = { ok: false, reason: 'observation_positive_postgres_read_missing', ledger };
      } else if (ledger.forbiddenEffects.length > 0) {
        latest = { ok: false, reason: 'observation_forbidden_effect_observed', ledger };
      } else if (ledger.completeScopeCounts.cached < minimumCompleteScopesPerMode
        || ledger.completeScopeCounts.reconciled < minimumCompleteScopesPerMode) {
        latest = { ok: false, reason: 'observation_scenario_scopes_missing', ledger };
      } else {
        return { ok: true, ledger };
      }
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return latest;
}

function recordBrowserRequest(state, request) {
  const pathKey = redactBrowserPath(request.url(), state.deployment.baseUrl);
  const method = String(request.method() || '').toUpperCase();
  const key = `${method} ${pathKey}`;
  state.browserRequestCounts[key] = (state.browserRequestCounts[key] || 0) + 1;
}

async function installReadOnlyNetworkFence(context, state) {
  context.on('request', (request) => recordBrowserRequest(state, request));
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!isAllowedBrowserRequest({
      method: request.method(),
      url: request.url(),
      baseUrl: state.deployment.baseUrl,
    })) {
      const method = String(request.method() || '').toUpperCase();
      const pathKey = redactBrowserPath(request.url(), state.deployment.baseUrl);
      state.blockedBrowserRequests.push({
        method: SAFE_METHODS.has(method) ? method : 'MUTATION',
        path: pathKey,
      });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
}

async function fetchSummary(page, relativePath, kind) {
  return page.evaluate(async ({ relativePath: inputPath, kind: inputKind }) => {
    const response = await fetch(inputPath, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    const base = { ok: response.ok, status: response.status };
    if (inputKind === 'auth') {
      return { ...base, signedIn: !!(body && typeof body === 'object' && body.user) };
    }
    if (inputKind === 'access') {
      return {
        ...base,
        reviewersAccess: !!(body && Array.isArray(body.apps) && body.apps.includes('reviewers')),
      };
    }
    if (inputKind === 'request') {
      return {
        ...base,
        requestId: typeof body?.requestId === 'string' ? body.requestId : null,
        requestNumber: typeof body?.requestNumber === 'string' ? body.requestNumber : null,
      };
    }
    if (inputKind === 'cachedRoster') {
      const roster = body && typeof body === 'object' ? body : null;
      const count = (bucket) => Array.isArray(roster?.[bucket]) ? roster[bucket].length : 0;
      return {
        ...base,
        success: body?.success === true,
        rosterVersion: typeof roster?.rosterVersion === 'string' ? roster.rosterVersion : null,
        active: count('active'), excluded: count('excluded'), ineligible: count('ineligible'), blocked: count('blocked'),
      };
    }
    if (inputKind === 'reconciledRoster') {
      const roster = body && typeof body === 'object' ? body : null;
      const validation = roster?.warmValidation && typeof roster.warmValidation === 'object'
        ? roster.warmValidation
        : null;
      return {
        ...base,
        success: body?.success === true,
        authorityState: typeof roster?.authorityState === 'string' ? roster.authorityState : null,
        warmValidationState: typeof validation?.state === 'string' ? validation.state : null,
        warmValidationReason: typeof validation?.reasonCode === 'string' ? validation.reasonCode.slice(0, 80) : null,
        proposalContentVersion: typeof validation?.proposalContentVersion === 'string' ? validation.proposalContentVersion : null,
        proposalBinding: ['canonical', 'fallback'].includes(validation?.proposalBinding)
          ? validation.proposalBinding
          : null,
        observationScope: typeof roster?.observationAttestation?.scope === 'string'
          ? roster.observationAttestation.scope
          : null,
        observationDeploymentClass: typeof roster?.observationAttestation?.deploymentClass === 'string'
          ? roster.observationAttestation.deploymentClass
          : null,
        observationDataverseTargetClass: typeof roster?.observationAttestation?.dataverseTargetClass === 'string'
          ? roster.observationAttestation.dataverseTargetClass
          : null,
        observationInterlockMode: typeof roster?.observationAttestation?.interlockMode === 'string'
          ? roster.observationAttestation.interlockMode
          : null,
      };
    }
    return { ...base };
  }, { relativePath, kind });
}

function rosterFromSummary(summary) {
  return {
    rosterVersion: summary?.rosterVersion || null,
    active: Array.from({ length: Math.max(0, Number(summary?.active || 0)) }),
    excluded: Array.from({ length: Math.max(0, Number(summary?.excluded || 0)) }),
    ineligible: Array.from({ length: Math.max(0, Number(summary?.ineligible || 0)) }),
    blocked: Array.from({ length: Math.max(0, Number(summary?.blocked || 0)) }),
  };
}

async function runAuthenticatedReadPreflight(state, authState) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authState,
    extraHTTPHeaders: { 'x-reviewer-find-observation-id': state.observationId },
  });
  await installReadOnlyNetworkFence(context, state);
  const page = await context.newPage();
  try {
    // An API document establishes the same origin without mounting the
    // Workbench. Preflight therefore remains independent of UI side effects.
    await page.goto(`${state.deployment.baseUrl}/api/auth/session`, {
      waitUntil: 'domcontentloaded',
      timeout: REQUEST_TIMEOUT_MS,
    });
    const auth = await fetchSummary(page, '/api/auth/session', 'auth');
    const access = await fetchSummary(page, '/api/app-access', 'access');
    if (!auth.ok || !auth.signedIn || !access.ok || !access.reviewersAccess) {
      status(state, 'auth', 'blocked', 'authenticated_app_access_unavailable');
      return;
    }
    status(state, 'auth', 'ready');

    const request = await fetchSummary(
      page,
      `/api/workbench/resolve-request?requestNumber=${SMOKE_REQUEST_NUMBER}`,
      'request',
    );
    if (!request.ok || request.requestNumber !== SMOKE_REQUEST_NUMBER || !isGuid(request.requestId)) {
      status(state, 'request', 'blocked', 'smoke_request_not_resolved');
      return;
    }
    // The GUID is retained only in process memory to form the fixed GET URLs.
    state.internalRequestId = request.requestId;
    status(state, 'request', 'ready');

    const cached = await fetchSummary(
      page,
      `/api/workbench/reviewer-roster?requestId=${encodeURIComponent(request.requestId)}&mode=cached`,
      'cachedRoster',
    );
    const roster = summarizeRoster(rosterFromSummary(cached));
    if (!cached.ok || !cached.success || !roster.rosterVersion || roster.counts.active < 1) {
      status(state, 'roster', 'blocked', 'warm_roster_not_ready', { totalCandidates: roster.total });
      return;
    }
    status(state, 'roster', 'ready', null, { totalCandidates: roster.total });

    const reconciled = await fetchSummary(
      page,
      `/api/workbench/reviewer-roster?requestId=${encodeURIComponent(request.requestId)}&mode=reconciled&rosterVersion=${encodeURIComponent(roster.rosterVersion)}`,
      'reconciledRoster',
    );
    const validation = summarizeWarmValidation({
      state: reconciled.warmValidationState,
      reasonCode: reconciled.warmValidationReason,
      proposalContentVersion: reconciled.proposalContentVersion,
      binding: reconciled.proposalBinding,
    });
    if (!reconciled.ok || !reconciled.success || validation.state !== 'current'
      || !validation.hasVersionedMetadata) {
      status(state, 'proposal', 'blocked', 'proposal_metadata_not_current');
    } else if (!validation.binding) {
      // Existing route data proves a versioned metadata read but deliberately
      // does not expose the canonical-vs-fallback result. Do not infer it from
      // filenames or a CLI input; the preflight needs an authoritative enum.
      status(state, 'proposal', 'blocked', 'proposal_binding_attestation_unavailable');
    } else {
      status(state, 'proposal', 'ready', null, { binding: validation.binding });
    }

    const attestation = validateRuntimeAttestation({
      scope: reconciled.observationScope,
      deploymentClass: reconciled.observationDeploymentClass,
      dataverseTargetClass: reconciled.observationDataverseTargetClass,
      interlockMode: reconciled.observationInterlockMode,
    }, state.deployment.class);
    if (attestation.ok) {
      status(state, 'target', 'ready', null, {
        dataverseTargetClass: attestation.value.dataverseTargetClass,
        interlockMode: attestation.value.interlockMode,
      });
    } else {
      status(state, 'target', 'blocked', 'runtime_target_attestation_invalid');
    }
  } catch {
    if (!state.readiness.auth) status(state, 'auth', 'blocked', 'authenticated_preflight_request_failed');
    else if (!state.readiness.request) status(state, 'request', 'blocked', 'request_preflight_request_failed');
    else if (!state.readiness.roster) status(state, 'roster', 'blocked', 'roster_preflight_request_failed');
    else if (!state.readiness.proposal) status(state, 'proposal', 'blocked', 'proposal_preflight_request_failed');
    if (!state.readiness.target) status(state, 'target', 'blocked', 'runtime_target_attestation_unavailable');
  } finally {
    await browser.close();
  }
}

function isWarmRosterResponse(response, mode) {
  try {
    const url = new URL(response.url());
    return url.pathname === '/api/workbench/reviewer-roster'
      && url.searchParams.get('mode') === mode
      && response.request().method() === 'GET';
  } catch {
    return false;
  }
}

async function observeWarmVisit(page, state, url, label) {
  const startedAt = Date.now();
  const cachedResponse = page.waitForResponse((response) => isWarmRosterResponse(response, 'cached'), {
    timeout: REQUEST_TIMEOUT_MS,
  }).then((response) => ({ status: response.status(), elapsedMs: Date.now() - startedAt }));
  const reconciledResponse = page.waitForResponse((response) => isWarmRosterResponse(response, 'reconciled'), {
    timeout: REQUEST_TIMEOUT_MS,
  }).then((response) => ({ status: response.status(), elapsedMs: Date.now() - startedAt }));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
  const cached = await cachedResponse;
  if (cached.status !== 200) throw new Error('cached_roster_response_not_ok');
  await page.locator('[data-testid="reviewer-candidate-list"]').waitFor({
    state: 'visible',
    timeout: REQUEST_TIMEOUT_MS,
  });
  state.milestones[`${label}CachedResponseMs`] = cached.elapsedMs;
  state.milestones[`${label}CandidateUiVisibleMs`] = Date.now() - startedAt;

  const reconciled = await reconciledResponse;
  if (reconciled.status !== 200) throw new Error('reconciled_roster_response_not_ok');
  state.milestones[`${label}ReconciledResponseMs`] = reconciled.elapsedMs;
}

async function runBrowserScenario(state, authState) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authState,
    extraHTTPHeaders: { 'x-reviewer-find-observation-id': state.observationId },
  });
  await installReadOnlyNetworkFence(context, state);
  const page = await context.newPage();
  try {
    const started = Date.now();
    await page.goto(`${state.deployment.baseUrl}/workbench`, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
    state.milestones.dashboardLoadedMs = Date.now() - started;
    // The fixed request number is intentionally not a caller option. Its GUID
    // was resolved from the authenticated deployment in preflight and is never
    // included in the artifact. Navigation remains read-only and fenced above.
    const requestId = state.internalRequestId;
    if (!isGuid(requestId)) throw new Error('workbench_request_guid_missing');
    const requestUrl = `${state.deployment.baseUrl}/workbench/${encodeURIComponent(requestId)}?tab=reviewers&sub=find&n=${SMOKE_REQUEST_NUMBER}`;
    await observeWarmVisit(page, state, requestUrl, 'firstVisit');
    await page.goto(`${state.deployment.baseUrl}/workbench`, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
    state.milestones.dashboardRevisitedMs = Date.now() - started;
    await observeWarmVisit(page, state, requestUrl, 'secondVisit');
  } finally {
    await browser.close();
  }
}

async function main() {
  const mode = process.argv[2];
  if (hasFlag('help') || hasFlag('h') || !['preflight', 'run'].includes(mode)) {
    usage();
    process.exit(mode ? 1 : 0);
  }
  if (process.env.EMERGENCY_AUTH_BYPASS === 'true') {
    throw new Error('Refusing to run with EMERGENCY_AUTH_BYPASS=true. Capture a normal staff session instead.');
  }

  const observationId = newObservationId();
  const config = validateLiveConfig({
    baseUrl: arg('base-url', process.env.LIVE_REVIEWER_BASE_URL || ''),
    deploymentId: arg('deployment-id', process.env.VERCEL_DEPLOYMENT_ID || ''),
    expectedCommit: arg('commit', process.env.VERCEL_GIT_COMMIT_SHA || ''),
    deploymentClass: arg('deployment-class', 'preview'),
    confirmProductionReadOnly: hasFlag('confirm-production-read-only'),
    observationId,
  });
  const state = {
    observationId,
    mode,
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    pass: false,
    deployment: {
      id: arg('deployment-id', process.env.VERCEL_DEPLOYMENT_ID || '') || null,
      expectedCommit: arg('commit', process.env.VERCEL_GIT_COMMIT_SHA || '') || null,
      class: arg('deployment-class', 'preview'),
      baseUrl: config.baseUrl || null,
    },
    readiness: {},
    milestones: {},
    browserRequestCounts: {},
    blockedBrowserRequests: [],
  };

  if (!config.ok) {
    for (const failure of config.failures) status(state, 'deployment', 'blocked', failure);
    const output = writeArtifact(state);
    console.error(`Reviewer Find live preflight blocked: ${config.failures.join(', ')}. Result: ${output}`);
    process.exitCode = 2;
    return;
  }

  if (hasFlag('dry-run')) {
    status(state, 'deployment', 'blocked', 'dry_run_no_deployment_attestation');
    status(state, 'auth', 'blocked', 'dry_run_no_authenticated_session_check');
    status(state, 'target', 'blocked', 'dry_run_no_runtime_target_attestation');
    status(state, 'request', 'blocked', 'dry_run_no_request_check');
    status(state, 'proposal', 'blocked', 'dry_run_no_proposal_check');
    status(state, 'roster', 'blocked', 'dry_run_no_roster_check');
    status(state, 'observation', 'blocked', 'dry_run_no_runtime_log_check');
    const output = writeArtifact(state);
    console.error(`Reviewer Find live dry-run blocked as designed. Result: ${output}`);
    process.exitCode = 2;
    return;
  }

  const deployment = await readDeployment({
    deploymentId: state.deployment.id,
    baseUrl: state.deployment.baseUrl,
    expectedCommit: state.deployment.expectedCommit,
    deploymentClass: state.deployment.class,
  });
  if (deployment.ok) {
    status(state, 'deployment', 'ready', null, {
      target: deployment.summary.target,
      actualCommit: deployment.summary.actualCommit,
    });
  } else {
    status(state, 'deployment', 'blocked', deployment.reason, deployment.summary ? {
      target: deployment.summary.target,
      actualCommit: deployment.summary.actualCommit,
    } : null);
  }

  status(state, 'target', 'blocked', 'runtime_target_attestation_not_checked');
  status(state, 'observation', 'blocked', 'observation_ledger_not_checked');

  const authState = localAuthStatePath(arg('auth-state', DEFAULT_AUTH_STATE));
  if (!authState || !fs.existsSync(authState)) {
    status(state, 'auth', 'blocked', 'auth_state_missing_or_outside_dot_auth');
  } else {
    await runAuthenticatedReadPreflight(state, authState);
  }

  if (ready(state, 'auth') && ready(state, 'request') && ready(state, 'roster')) {
    const ledger = await readObservationLedger({
      deploymentId: state.deployment.id,
      observationId: state.observationId,
      startedAt: state.startedAt,
    });
    if (ledger.ok) {
      status(state, 'observation', 'ready', null, {
        completeModes: ledger.ledger.completeModes,
        effectCounts: ledger.ledger.effectCounts,
      });
    } else {
      status(state, 'observation', 'blocked', ledger.reason);
    }
  }

  if (mode === 'run' && allRequiredReady(state) && state.blockedBrowserRequests.length === 0) {
    try {
      await runBrowserScenario(state, authState);
      const finalLedger = await readObservationLedger({
        deploymentId: state.deployment.id,
        observationId: state.observationId,
        startedAt: state.startedAt,
        // Preflight contributes one cached/reconciled pair; both actual
        // Workbench visits must add their own completed pair before a run can
        // pass, so the final ledger requires at least three of each mode.
        minimumCompleteScopesPerMode: 3,
      });
      if (!finalLedger.ok) {
        status(state, 'observation', 'blocked', finalLedger.reason);
        status(state, 'scenario', 'blocked', 'post_scenario_observation_not_green');
      } else if (state.blockedBrowserRequests.length === 0) {
        status(state, 'observation', 'ready', null, {
          completeModes: finalLedger.ledger.completeModes,
          effectCounts: finalLedger.ledger.effectCounts,
        });
        status(state, 'scenario', 'ready');
        state.pass = allRequiredReady(state);
      } else {
        status(state, 'scenario', 'blocked', 'browser_mutation_or_off_origin_request_blocked');
      }
    } catch {
      status(state, 'scenario', 'blocked', 'warm_browser_milestone_not_observed');
    }
  } else if (mode === 'run') {
    status(state, 'scenario', 'blocked', state.blockedBrowserRequests.length > 0
      ? 'browser_mutation_or_off_origin_request_blocked'
      : 'preflight_not_ready');
  } else if (mode === 'preflight' && allRequiredReady(state) && state.blockedBrowserRequests.length === 0) {
    state.pass = true;
  }

  const output = writeArtifact(state);
  if (state.pass) {
    console.log(`Reviewer Find live smoke passed. Result: ${output}`);
  } else {
    const blockers = Object.entries(state.readiness)
      .filter(([, value]) => value.readiness !== 'ready')
      .map(([key, value]) => `${key}:${value.reason}`)
      .join(', ');
    console.error(`Reviewer Find live ${mode} blocked or failed: ${blockers}. Result: ${output}`);
    process.exitCode = 2;
  }
}

main().catch((error) => {
  // Do not print raw error objects: they can contain URLs, headers, or service
  // messages. The durable artifact also intentionally records only reason codes.
  // The class name is safe metadata and distinguishes a malformed local setup
  // from an external service response without disclosing either response.
  console.error(`Reviewer Find live runner failed before completing its read-only preflight (${error?.name || 'Error'}).`);
  process.exitCode = 2;
});
