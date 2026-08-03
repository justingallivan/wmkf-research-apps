#!/usr/bin/env node
/**
 * One-time authenticated Reviewer Find cold-preparation runner.
 *
 * Fixed fixture: request 1002914.  The browser may prepare the standard
 * proposal, verify the already-materialized applicant suggestions, and run one
 * display-only general search.  A fail-closed request fence rejects every
 * other mutation, including all promotion, invitation, email, token, and
 * arbitrary roster-write routes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  COLD_REQUEST_NUMBER,
  validateColdBrowserRequest,
} = require('./lib/reviewer-find-cold-live-contract');
const {
  readProductionAuthoritySnapshot,
  validateColdAuthorityBaseline,
  publicAuthoritySummary,
} = require('./lib/reviewer-find-cold-authority-audit');
const {
  validateLiveConfig,
  isGuid,
  redactBrowserPath,
  deploymentSummary,
  enrichDeploymentWithListing,
  validateRuntimeAttestation,
  summarizeWarmValidation,
} = require('./lib/reviewer-find-live-contract');

const DEFAULT_AUTH_STATE = path.join('.auth', 'reviewer-find-live.json');
const ARTIFACT_ROOT = path.join('.artifacts', 'reviewer-find-cold-live');
const REQUEST_TIMEOUT_MS = 45_000;
const RUN_TIMEOUT_MS = 1_500_000;
const CLI_TIMEOUT_MS = 30_000;
const CLI_MAX_OUTPUT_BYTES = 262144;
const SHA_RE = /^[a-f0-9]{40}$/i;
const ROSTER_VERSION_RE = /^[a-f0-9]{64}$/i;
const MAX_SAFE_COUNT = 10_000;
const MAX_BLOCKED_BROWSER_REQUEST_ENTRIES = 25;

function arg(name, defaultValue = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : defaultValue;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function usage() {
  console.log(`Usage:
  node scripts/live-reviewer-find-cold-prepare.mjs preflight --base-url <exact-preview-alias> --deployment-id <id> --commit <sha>

Options:
  --auth-state .auth/reviewer-find-live.json
  --dry-run

Preflight is Preview-only and read-only. The Production cold run remains locked
until its exact durable effects receive fresh approval. This tool never accepts a
request number, file override, or email/invitation action.`);
}

function localAuthStatePath(value) {
  const requested = path.resolve(value || DEFAULT_AUTH_STATE);
  const authRoot = path.resolve('.auth') + path.sep;
  if (!requested.startsWith(authRoot) || path.extname(requested) !== '.json') return null;
  return requested;
}

function runVercelCli(args) {
  return new Promise((resolve) => {
    const child = spawn('vercel', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let exceeded = false;
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const append = (target, chunk) => {
      const next = target + String(chunk);
      if (Buffer.byteLength(next, 'utf8') > CLI_MAX_OUTPUT_BYTES) {
        exceeded = true;
        child.kill('SIGKILL');
        return target;
      }
      return next;
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', () => finish({ ok: false, reason: 'vercel_cli_unavailable' }));
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CLI_TIMEOUT_MS);
    child.on('close', (code) => {
      if (timedOut) return finish({ ok: false, reason: 'vercel_cli_timeout' });
      if (exceeded) return finish({ ok: false, reason: 'vercel_cli_output_limit_exceeded' });
      if (code !== 0) return finish({ ok: false, reason: 'vercel_cli_command_failed' });
      return finish({ ok: true, stdout, stderr: stderr.slice(0, 120) });
    });
  });
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

async function readDeployment({ deploymentId, baseUrl, expectedCommit, deploymentClass }) {
  const inspected = await runVercelCli(['inspect', deploymentId, '--json']);
  if (!inspected.ok) return inspected;
  let deployment = parseJson(inspected.stdout);
  if (!deployment || deployment.id !== deploymentId) {
    return { ok: false, reason: 'vercel_cli_deployment_response_invalid' };
  }
  const hasCommit = typeof deployment?.meta?.githubCommitSha === 'string'
    || typeof deployment?.meta?.gitCommitSha === 'string'
    || typeof deployment?.gitSource?.sha === 'string';
  if (!hasCommit) {
    const listing = await runVercelCli(['list', '--json']);
    if (listing.ok) deployment = enrichDeploymentWithListing(deployment, parseJson(listing.stdout));
  }
  const summary = deploymentSummary(deployment, {
    baseUrl,
    expectedCommit,
    deploymentClass,
  });
  return summary.ready
    ? { ok: true, summary }
    : { ok: false, reason: summary.reasons[0] || 'vercel_deployment_unverified', summary };
}

function initialState(mode, config, deploymentClass) {
  return {
    schemaVersion: 1,
    kind: 'reviewer_find_cold_preparation',
    requestNumber: COLD_REQUEST_NUMBER,
    mode,
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    pass: false,
    deployment: {
      baseUrl: config.baseUrl,
      id: config.deploymentId,
      expectedCommit: config.expectedCommit,
      class: deploymentClass,
    },
    readiness: {},
    milestones: {},
    browserRequestCounts: {},
    blockedBrowserRequests: [],
    blockedBrowserRequestTotal: 0,
    baseline: null,
    postflight: null,
  };
}

function writeArtifact(state) {
  const runId = `${state.startedAt.replace(/[:.]/g, '-')}-${process.pid}`;
  const directory = path.join(ARTIFACT_ROOT, runId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Keep this artifact operationally useful without retaining request payloads,
  // cookies, GUIDs, raw responses, or browser/CLI error text.
  const artifact = {
    schemaVersion: state.schemaVersion,
    kind: state.kind,
    requestNumber: state.requestNumber,
    mode: state.mode,
    startedAt: state.startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: Math.min(RUN_TIMEOUT_MS, Date.now() - state.startedAtMs),
    pass: state.pass,
    deployment: state.deployment,
    readiness: state.readiness,
    milestones: state.milestones,
    browserRequestCounts: state.browserRequestCounts,
    blockedBrowserRequests: state.blockedBrowserRequests,
    blockedBrowserRequestTotal: state.blockedBrowserRequestTotal,
    baseline: publicBoundedState(state.baseline),
    postflight: publicBoundedState(state.postflight),
  };
  const output = path.join(directory, 'result.json');
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return output;
}

function publicBoundedState(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    ok: value.ok === true,
    roster: value.roster || null,
    lifecycle: value.lifecycle || null,
    authority: value.authority || null,
  };
}

function safeRosterSummary(body) {
  const safeBucket = (bucket) => Array.isArray(body?.[bucket])
    && body[bucket].length <= MAX_SAFE_COUNT;
  const count = (bucket) => safeBucket(bucket) ? body[bucket].length : null;
  const buckets = {
    active: count('active'),
    excluded: count('excluded'),
    ineligible: count('ineligible'),
    blocked: count('blocked'),
  };
  return {
    success: body?.success === true,
    rosterVersion: ROSTER_VERSION_RE.test(String(body?.rosterVersion || ''))
      ? body.rosterVersion
      : null,
    buckets,
    total: Object.values(buckets).every(Number.isSafeInteger)
      ? Object.values(buckets).reduce((sum, value) => sum + value, 0)
      : null,
    valid: body?.success === true
      && ROSTER_VERSION_RE.test(String(body?.rosterVersion || ''))
      && Object.values(buckets).every(Number.isSafeInteger),
  };
}

function safeRollupSummary(body) {
  const counts = body?.counts && typeof body.counts === 'object' ? body.counts : {};
  const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_SAFE_COUNT
    ? value
    : null;
  const result = {
    success: body?.success === true,
    selected: safeCount(counts.candidates),
    invited: safeCount(counts.invited),
    accepted: safeCount(counts.accepted),
    declined: safeCount(counts.declined),
    reviewArtifacts: safeCount(counts.completed),
    totalSuggestions: safeCount(counts.progress?.total),
    uninvitedSuggestions: safeCount(counts.progress?.uninvited),
  };
  return {
    ...result,
    valid: result.success && Object.entries(result)
      .filter(([key]) => key !== 'success')
      .every(([, value]) => Number.isSafeInteger(value)),
  };
}

async function fetchJson(page, relativePath) {
  return page.evaluate(async (inputPath) => {
    const response = await fetch(inputPath, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return { ok: response.ok, status: response.status, body };
  }, relativePath);
}

function safeArtifactPath(url, baseUrl) {
  const redacted = redactBrowserPath(url, baseUrl);
  if (redacted === 'external' || redacted === 'invalid') return redacted;
  return redacted
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, ':email')
    .replace(/\/[A-Za-z0-9_-]{49,}(?=\/|$)/g, '/:opaque')
    .slice(0, 160);
}

function boundedFailureCode(error) {
  const value = String(error?.message || 'cold_run_failed');
  const permitted = new Set([
    'authenticated_reviewer_access_unavailable',
    'cold_fixture_not_resolved',
    'cold_fixture_state_unavailable',
    'cold_fixture_roster_not_empty',
    'cold_fixture_has_reviewer_lifecycle',
    'cold_authority_prod_reads_not_explicit',
    'cold_authority_snapshot_unavailable',
    'cold_authority_baseline_invalid',
    'runtime_target_attestation_unavailable',
    'proposal_metadata_not_current',
    'workbench_request_guid_missing',
    'display_only_not_observed',
    'proposal_preparation_not_observed',
    'applicant_verification_not_observed',
    'general_search_not_observed',
    'cold_postflight_state_unavailable',
    'applicant_verification_partial_or_unexpected',
    'unexpected_cold_producer_request_count',
    'cold_completion_failed',
    'local_source_commit_unavailable',
    'local_source_commit_mismatch',
    'cold_no_send_gate_failed',
    'deployment_reinspection_failed_after_browser',
    'production_cold_prepare_requires_fresh_user_confirmation',
  ]);
  const normalized = value.split(':', 1)[0];
  return permitted.has(normalized) ? normalized : 'cold_browser_operation_failed';
}

async function runLocalCommand(command, args, timeoutMs = CLI_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, stdio: 'ignore', cwd: process.cwd() });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', () => finish({ ok: false }));
    child.on('close', (code) => finish({ ok: code === 0 }));
  });
}

async function readLocalHead() {
  return new Promise((resolve) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], { shell: false, stdio: ['ignore', 'pipe', 'ignore'], cwd: process.cwd() });
    let stdout = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${String(chunk)}`.slice(0, 80); });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      const head = stdout.trim();
      finish(code === 0 && SHA_RE.test(head) ? head.toLowerCase() : null);
    });
  });
}

async function verifyLocalSourceAndNoSend(state) {
  const head = await readLocalHead();
  if (!head) throw new Error('local_source_commit_unavailable');
  if (head !== String(state.deployment.actualCommit || '').toLowerCase()) {
    throw new Error('local_source_commit_mismatch');
  }
  state.readiness.source = 'ready';
  const noSend = await runLocalCommand(process.execPath, ['scripts/check-reviewer-find-cold-no-send.mjs']);
  if (!noSend.ok) throw new Error('cold_no_send_gate_failed');
  state.readiness.noSend = 'ready';
}

function recordRequest(state, request) {
  const method = String(request.method() || '').toUpperCase();
  const safePath = safeArtifactPath(request.url(), state.deployment.baseUrl);
  const key = `${method} ${safePath}`;
  state.browserRequestCounts[key] = (state.browserRequestCounts[key] || 0) + 1;
}

function recordBlockedBrowserRequest(state, entry) {
  state.blockedBrowserRequestTotal = Number.isSafeInteger(state.blockedBrowserRequestTotal)
    ? state.blockedBrowserRequestTotal + 1
    : 1;
  if (state.blockedBrowserRequests.length < MAX_BLOCKED_BROWSER_REQUEST_ENTRIES) {
    state.blockedBrowserRequests.push(entry);
  }
}

async function installFence(context, state, { coldProducers }) {
  context.on('request', (request) => recordRequest(state, request));
  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = String(request.method() || '').toUpperCase();
    const decision = validateColdBrowserRequest({
      method,
      url: request.url(),
      baseUrl: state.deployment.baseUrl,
      requestId: state.internalRequestId,
      postData: request.postData(),
    });
    const preflightSafe = ['GET', 'HEAD', 'OPTIONS'].includes(method) && decision.allowed;
    if ((!coldProducers && !preflightSafe) || (coldProducers && !decision.allowed)) {
      recordBlockedBrowserRequest(state, {
        method: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? method : 'MUTATION',
        path: safeArtifactPath(request.url(), state.deployment.baseUrl),
        reason: decision.reason || 'preflight_mutation_forbidden',
      });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
}

async function readBoundedState(page, requestId) {
  const [rosterResponse, rollupResponse] = await Promise.all([
    fetchJson(page, `/api/workbench/reviewer-roster?requestId=${encodeURIComponent(requestId)}&mode=cached`),
    fetchJson(page, `/api/workbench/reviewer-rollup?requestId=${encodeURIComponent(requestId)}`),
  ]);
  const roster = safeRosterSummary(rosterResponse.body);
  const lifecycle = safeRollupSummary(rollupResponse.body);
  return {
    roster,
    lifecycle,
    ok: rosterResponse.ok && rollupResponse.ok && roster.valid && lifecycle.valid,
  };
}

async function readAndValidateColdAuthorityBaseline(state, requestId) {
  // Require an explicit process-level acknowledgement. readProductionAuthoritySnapshot
  // separately checks the registered production target and active interlock before
  // issuing its bounded OAuth/Dataverse GETs.
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('cold_authority_prod_reads_not_explicit');
  }
  let snapshot;
  try {
    snapshot = await readProductionAuthoritySnapshot({
      requestId,
      windowStart: state.startedAt,
    });
  } catch {
    throw new Error('cold_authority_snapshot_unavailable');
  }
  const validation = validateColdAuthorityBaseline(snapshot, {
    requestId,
    expectedSuggestionCount: 5,
  });
  if (!validation.ok) throw new Error('cold_authority_baseline_invalid');
  return publicAuthoritySummary(snapshot);
}

async function authenticatedPreflight(state, authState) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: authState });
  await installFence(context, state, { coldProducers: false });
  const page = await context.newPage();
  try {
    try {
      await page.goto(`${state.deployment.baseUrl}/api/auth/session`, {
        waitUntil: 'domcontentloaded',
        timeout: REQUEST_TIMEOUT_MS,
      });
    } catch {
      // An expired session can redirect to Microsoft. The cold fence correctly
      // aborts that off-origin request; report the actionable auth condition
      // rather than treating it as a generic browser failure.
      throw new Error('authenticated_reviewer_access_unavailable');
    }
    const auth = await fetchJson(page, '/api/auth/session');
    const access = await fetchJson(page, '/api/app-access');
    if (!auth.ok || !auth.body?.user || !access.ok || !access.body?.apps?.includes('reviewers')) {
      throw new Error('authenticated_reviewer_access_unavailable');
    }
    state.readiness.auth = 'ready';

    const resolved = await fetchJson(
      page,
      `/api/workbench/resolve-request?requestNumber=${COLD_REQUEST_NUMBER}`,
    );
    const requestId = resolved.body?.requestId;
    if (!resolved.ok || resolved.body?.requestNumber !== COLD_REQUEST_NUMBER || !isGuid(requestId)) {
      throw new Error('cold_fixture_not_resolved');
    }
    state.internalRequestId = requestId;
    state.readiness.request = 'ready';

    const authority = await readAndValidateColdAuthorityBaseline(state, requestId);
    state.readiness.authority = 'ready';

    const baseline = await readBoundedState(page, requestId);
    if (!baseline.ok || !baseline.roster.success || !baseline.lifecycle.success) {
      throw new Error('cold_fixture_state_unavailable');
    }
    state.baseline = { ...baseline, authority };
    if (baseline.roster.total !== 0) throw new Error('cold_fixture_roster_not_empty');
    if (baseline.lifecycle.selected !== 0
      || baseline.lifecycle.invited !== 0
      || baseline.lifecycle.accepted !== 0
      || baseline.lifecycle.declined !== 0
      || baseline.lifecycle.reviewArtifacts !== 0) {
      throw new Error('cold_fixture_has_reviewer_lifecycle');
    }
    // reviewer-rollup intentionally filters to selected/declined rows. A
    // pristine applicant recommendation is unselected and therefore reports
    // zero progress here; the direct authority snapshot above proves the five
    // applicant-recommended rows instead.
    state.readiness.fixture = 'ready';

    const reconciled = await fetchJson(
      page,
      `/api/workbench/reviewer-roster?requestId=${encodeURIComponent(requestId)}&mode=reconciled&rosterVersion=${encodeURIComponent(baseline.roster.rosterVersion || '')}`,
    );
    const attestation = validateRuntimeAttestation(
      reconciled.body?.observationAttestation,
      'preview',
    );
    const validation = summarizeWarmValidation(reconciled.body?.warmValidation);
    if (!reconciled.ok || !reconciled.body?.success || !attestation.ok) {
      throw new Error('runtime_target_attestation_unavailable');
    }
    state.readiness.target = 'ready';
    if (validation.state !== 'current' || !validation.binding || !validation.hasVersionedMetadata) {
      throw new Error('proposal_metadata_not_current');
    }
    state.readiness.proposal = { status: 'ready', binding: validation.binding };
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
    throw new Error('Refusing to run with EMERGENCY_AUTH_BYPASS=true.');
  }
  if (mode === 'run') {
    throw new Error('production_cold_prepare_requires_fresh_user_confirmation');
  }
  const config = validateLiveConfig({
    baseUrl: arg('base-url', process.env.LIVE_REVIEWER_BASE_URL || ''),
    deploymentId: arg('deployment-id', process.env.VERCEL_DEPLOYMENT_ID || ''),
    expectedCommit: arg('commit', process.env.VERCEL_GIT_COMMIT_SHA || ''),
    deploymentClass: 'preview',
    observationId: 'rfw_coldprepare1002914',
  });
  if (!config.ok) throw new Error(`invalid_live_config:${config.failures.join(',')}`);
  config.deploymentId = arg('deployment-id', process.env.VERCEL_DEPLOYMENT_ID || '');
  config.expectedCommit = arg('commit', process.env.VERCEL_GIT_COMMIT_SHA || '');
  const authState = localAuthStatePath(arg('auth-state', DEFAULT_AUTH_STATE));
  if (!authState) throw new Error('Auth state must be a JSON file under .auth/.');
  const state = initialState(mode, config, 'preview');

  if (hasFlag('dry-run')) {
    state.readiness.localConfig = 'ready';
    state.pass = true;
    console.log(JSON.stringify({ pass: true, requestNumber: COLD_REQUEST_NUMBER, mode, dryRun: true }));
    return;
  }
  if (!fs.existsSync(authState)) throw new Error('Captured auth state is missing.');
  const deployment = await readDeployment({
    deploymentId: config.deploymentId,
    baseUrl: config.baseUrl,
    expectedCommit: config.expectedCommit,
    deploymentClass: 'preview',
  });
  if (!deployment.ok) throw new Error(`deployment_not_verified:${deployment.reason}`);
  state.deployment = {
    ...state.deployment,
    host: deployment.summary.deploymentHost,
    actualCommit: deployment.summary.actualCommit,
  };
  state.readiness.deployment = 'ready';
  await verifyLocalSourceAndNoSend(state);

  let artifact = null;
  try {
    await authenticatedPreflight(state, authState);
    const deploymentAfterBrowser = await readDeployment({
      deploymentId: config.deploymentId,
      baseUrl: config.baseUrl,
      expectedCommit: config.expectedCommit,
      deploymentClass: 'preview',
    });
    if (!deploymentAfterBrowser.ok) throw new Error('deployment_reinspection_failed_after_browser');
    state.pass = true;
  } catch (error) {
    state.readiness.failure = boundedFailureCode(error);
    throw error;
  } finally {
    artifact = writeArtifact(state);
    console.log(JSON.stringify({ pass: state.pass, mode, requestNumber: COLD_REQUEST_NUMBER, artifact }));
  }
}

const timeout = setTimeout(() => {
  console.error('Reviewer Find cold preparation exceeded its hard run timeout.');
  process.exit(1);
}, RUN_TIMEOUT_MS);
timeout.unref();

main().catch((error) => {
  console.error(`Reviewer Find cold preparation failed: ${boundedFailureCode(error)}`);
  process.exitCode = 1;
});
