#!/usr/bin/env node
/**
 * Manual, gated production smoke for the Wave 13 reviewer identity-binding
 * chain: durable job → deployed 2-minute cron drain → capture-self-reported-
 * orcid → versioned binding writer → persisted person binding.
 *
 * What it proves: the DEPLOYED drain and writer produce the exact first
 * `self_reported` Wave 13 binding from a durable acceptance job. What it does
 * NOT prove: deployed `/respond` route staging (identical code path for fresh
 * and repeat accepts; covered by organic traffic).
 *
 * Safety shape (see the 2026-07-13 adversarial-review smoke contract):
 * - synthetic person + suggestion, unique smoke-key proxy email, NO contact;
 * - `isAcceptRepeat:true` + `optedOut:true` + no boardIdentity → no email,
 *   no quota, no honorarium, no contact writes, no mismatch alerts;
 * - accepted state is written to Dataverse BEFORE the job is staged;
 * - the deployed cron claims the job — this script NEVER invokes the drain;
 * - the smoke must run against a deployment containing completedJobIds plus
 *   deployment-fingerprint maintenance telemetry;
 * - recovery state is persisted before and after every production write;
 * - job-backed cleanup only after immutable `completed` status; artifact first;
 * - the completed queue row is KEPT unless --delete-job is passed.
 *
 * Usage:
 *   node scripts/smoke-reviewer-binding.js --request <GUID|requestNum> \
 *        --approved-request-id <GUID> --expect-deployment <sha-or-dpl> \
 *        [--orcid 0000-0002-1825-0097] [--timeout-minutes 15] [--poll-seconds 15] \
 *        [--cleanup] [--delete-job] --confirm-prod-dataverse
 *
 * Authorization is tracked + double-entry: the RESOLVED request GUID must
 * equal the owner-approved --approved-request-id AND be committed in
 * scripts/lib/smoke-reviewer-binding-fixtures.js. --expect-deployment must name
 * the production deployment (from `vercel inspect`) the cron is expected to run;
 * the matching maintenance run must record both this deployment fingerprint and
 * the exact smoke job id in completedJobIds.
 *
 * Exit codes: 0 pass · 1 assertion failure · 2 timeout/interrupted (job may
 * still be live — do NOT clean up by hand unless it is `completed`) · 3 aborted
 * precondition.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : def;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const REQUEST = arg('request');
const APPROVED_REQUEST_ID = arg('approved-request-id');
const EXPECT_DEPLOYMENT = arg('expect-deployment');
const ORCID_RAW = arg('orcid', '0000-0002-1825-0097');
const TIMEOUT_MINUTES = Math.max(4, Number(arg('timeout-minutes', 15)) || 15);
const POLL_SECONDS = Math.max(5, Number(arg('poll-seconds', 15)) || 15);
const CLEANUP = hasFlag('cleanup');
const DELETE_JOB = hasFlag('delete-job');
// Deliberately a per-run flag ONLY — no environment fallback. A standing env
// confirm would let a later, unauthorized invocation write to production.
const CONFIRMED = hasFlag('confirm-prod-dataverse');

let recoveryEnabled = false;

function abort(message) {
  if (recoveryEnabled) {
    const error = new Error(message);
    error.code = 'smoke_precondition_failed';
    error.exitCode = 3;
    throw error;
  }
  console.error(`ABORT: ${message}`);
  process.exit(3);
}

const USAGE = 'Usage: node scripts/smoke-reviewer-binding.js --request <GUID|requestNum> --approved-request-id <GUID> --expect-deployment <sha-or-dpl> [--orcid <iD>] [--timeout-minutes 15] [--poll-seconds 15] [--cleanup] [--delete-job] --confirm-prod-dataverse';
if (hasFlag('help') || hasFlag('h') || !REQUEST) {
  console.log(USAGE);
  process.exit(REQUEST ? 0 : 3);
}
if (!CONFIRMED) {
  abort('this smoke creates real PROD Dataverse rows and a production queue job. Re-run with --confirm-prod-dataverse when the owner has authorized the run.');
}
if (!APPROVED_REQUEST_ID) {
  abort('--approved-request-id <GUID> is required: authorization must name the owner-approved fixture request, not bless the run generically.');
}
if (!EXPECT_DEPLOYMENT || !String(EXPECT_DEPLOYMENT).trim()) {
  abort('--expect-deployment <sha-or-dpl> is required: run `vercel inspect` on the production deployment first and pass its SHA or deployment id so the artifact records what the cron was expected to run.');
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const potentialReviewer = await import('../lib/dataverse/adapters/potential-reviewer.js');
const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const researcher = await import('../lib/dataverse/adapters/researcher.js');
const odata = await import('../lib/dataverse/core/odata.js');
const { normalizeOrcid } = await import('../lib/utils/orcid-normalize.js');
const { enqueueReviewerAcceptanceJob } = await import('../lib/services/reviewer-acceptance-job-service.js');
const { sql } = await import('@vercel/postgres');
const core = await import('./lib/smoke-reviewer-binding-core.js');
const { APPROVED_FIXTURE_REQUEST_IDS } = await import('./lib/smoke-reviewer-binding-fixtures.js');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (APPROVED_FIXTURE_REQUEST_IDS.length === 0) {
  abort('no approved reviewer-binding smoke fixture is committed; owner must commit the approved fixture GUID to scripts/lib/smoke-reviewer-binding-fixtures.js first.');
}

const wanted = normalizeOrcid(ORCID_RAW);
if (wanted.state !== 'valid') abort(`--orcid is not a valid ORCID (${wanted.state})`);
const ORCID = wanted.id;

// ── Guard: no local server may be able to drain the shared production queue.
// verifyCronSecret bypasses auth entirely under NODE_ENV=development, so a
// running local dev server pointed at production stores would let the LOCAL
// artifact claim the job and silently defeat the deployed-artifact proof.
async function assertNoLocalServer() {
  const bases = new Set(['http://localhost:3000']);
  if (process.env.NEXTAUTH_URL) bases.add(process.env.NEXTAUTH_URL.replace(/\/$/, ''));
  for (const base of bases) {
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(base)) continue;
    try {
      await fetch(base, { signal: AbortSignal.timeout(1500) });
      abort(`a local server is responding at ${base}. Its dev-mode cron route can drain the production queue through the LOCAL artifact — stop it before running the smoke.`);
    } catch {
      // unreachable — good
    }
  }
}

function runPopulationPreflight(label) {
  console.log(`\n── Wave 13 preflight (${label}) ──`);
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [
      join(__dirname, 'preflight-reviewer-identity-binding-fields.mjs'),
      '--target=prod',
      '--include-population',
    ], { encoding: 'utf8' });
  } catch (e) {
    abort(`preflight failed (${label}): ${(e.stdout || e.message || '').toString().slice(0, 400)}`);
  }
  process.stdout.write(stdout);
  const counts = core.parsePopulationCounts(stdout);
  if (!counts) abort(`preflight (${label}) produced no population snapshot`);
  return counts;
}

async function resolveRequest(request) {
  if (GUID_RE.test(request)) {
    const row = await DynamicsService.getRecord('akoya_requests', request, {
      select: 'akoya_requestid,akoya_requestnum,akoya_title',
    });
    console.log(`request: #${row.akoya_requestnum} — ${row.akoya_title || '(no title)'}  ${row.akoya_requestid}`);
    return row;
  }
  const { records } = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum,akoya_title',
    filter: odata.eq('akoya_requestnum', request),
    top: 1,
  });
  if (!records[0]) abort(`no akoya_request with requestnum '${request}'`);
  console.log(`request: #${records[0].akoya_requestnum} — ${records[0].akoya_title || '(no title)'}  ${records[0].akoya_requestid}`);
  return records[0];
}

async function pollJobUntilTerminal(jobId, startedAt) {
  const deadline = Date.now() + TIMEOUT_MINUTES * 60 * 1000;
  for (;;) {
    const { rows } = await sql`SELECT * FROM reviewer_acceptance_jobs WHERE id = ${jobId}`;
    const job = rows[0] || null;
    if (!job) abort(`job ${jobId} disappeared from reviewer_acceptance_jobs`);
    console.log(`  [${new Date().toISOString()}] job ${jobId}: status=${job.status} attempts=${job.attempts} locked_until=${job.locked_until ? new Date(job.locked_until).toISOString() : null} last_error=${job.last_error ? JSON.stringify(job.last_error.slice(0, 120)) : null}`);
    if (core.isJobTerminal(job)) return job;
    if (Date.now() > deadline) {
      console.error(`\nTIMEOUT after ${TIMEOUT_MINUTES} minutes. The job is still ${job.status} and may yet be claimed by the production cron.`);
      console.error('NO cleanup was performed. Re-check the job before touching any row:');
      console.error(`  SELECT * FROM reviewer_acceptance_jobs WHERE id = ${jobId};`);
      console.error(`Window started at ${startedAt}.`);
      const error = new Error(`smoke timed out with job ${jobId} still ${job.status}`);
      error.code = 'smoke_timeout';
      error.exitCode = 2;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
  }
}

async function deleteOrReport(entitySet, id, label, { allowDuringFatal = false } = {}) {
  try {
    await DynamicsService.deleteRecord(entitySet, id);
    console.log(`  deleted ${label} ${id}`);
    return { deleted: true };
  } catch (delErr) {
    // Delete and deactivation are separate writes. A signal during the delete
    // must fence the fallback before it can start on the main/operator path.
    if (!allowDuringFatal) assertMainFlowActive();
    try {
      await DynamicsService.updateRecord(entitySet, id, { statecode: 1, statuscode: 2 });
      console.log(`  DEACTIVATED (delete unavailable) ${label} ${id}: ${delErr.message?.slice(0, 100)}`);
      return { deleted: false, deactivated: true, error: delErr.message || String(delErr) };
    } catch (deactErr) {
      console.log(`  could not delete or deactivate ${label} ${id}: ${deactErr.message?.slice(0, 120)}`);
      return { deleted: false, deactivated: false, error: deactErr.message || String(deactErr) };
    }
  }
}

async function isRecordStillReadable(entitySet, id, select, label) {
  try {
    await DynamicsService.getRecord(entitySet, id, { select });
    console.error(`  ${label} ${id} is still readable after delete`);
    return true;
  } catch (err) {
    if (err?.status === 404 || /\b404\b/.test(String(err?.message || ''))) {
      console.log(`  verified ${label} ${id} is absent`);
      return false;
    }
    console.error(`  could not verify ${label} ${id} absence: ${err.message?.slice(0, 120) || err}`);
    return true;
  }
}

function parseDetails(details) {
  if (!details) return {};
  if (typeof details === 'object') return details;
  try {
    return JSON.parse(details);
  } catch {
    return {};
  }
}

const startedAt = new Date().toISOString();
let prePopulation = null;
let artifactPath = null;
let failed = false;
let fatalRequested = false;
let fatalPromise = null;

const artifact = {
  startedAt,
  orcid: ORCID,
  approvedRequestId: APPROVED_REQUEST_ID,
  expectDeployment: EXPECT_DEPLOYMENT,
  prePopulation: null,
  state: 'initializing',
  phase: 'preflight',
  pendingWrite: null,
  problems: [],
};

function initializeArtifact(smokeKey) {
  const outDir = join(__dirname, '..', 'outputs');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  artifactPath = join(outDir, `${smokeKey}-result.json`);
  artifact.smokeKey = smokeKey;
  artifact.prePopulation = prePopulation;
  artifact.state = 'in_progress';
  artifact.phase = 'authorized';
  recoveryEnabled = true;
  persistArtifact();
}

function persistArtifact({ finished = false } = {}) {
  if (!artifactPath) return;
  artifact.updatedAt = new Date().toISOString();
  if (finished) {
    artifact.finishedAt = artifact.updatedAt;
    artifact.pass = !failed && artifact.state === 'passed';
  }
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
}

function beginProductionWrite(name, { allowDuringFatal = false } = {}) {
  if (!allowDuringFatal) assertMainFlowActive();
  artifact.pendingWrite = name;
  artifact.phase = `before_${name}`;
  persistArtifact();
}

function finishProductionWrite(name, patch = {}) {
  Object.assign(artifact, patch);
  artifact.pendingWrite = null;
  artifact.phase = `${name}_written`;
  persistArtifact();
}

function assertMainFlowActive() {
  if (!fatalRequested) return;
  const error = new Error('fatal shutdown already requested');
  error.code = 'smoke_fatal_shutdown_requested';
  error.exitCode = 2;
  throw error;
}

async function readRecoveryJob() {
  if (artifact.jobId) {
    const { rows } = await sql`SELECT * FROM reviewer_acceptance_jobs WHERE id = ${artifact.jobId}`;
    return rows[0] || null;
  }
  if (artifact.suggestionId && artifact.acceptedAt) {
    const { rows } = await sql`
      SELECT * FROM reviewer_acceptance_jobs
       WHERE suggestion_id = ${artifact.suggestionId}
         AND accepted_at = ${artifact.acceptedAt}
       ORDER BY created_at DESC
       LIMIT 1
    `;
    if (rows[0]) artifact.jobId = rows[0].id;
    return rows[0] || null;
  }
  return null;
}

async function cleanupKnownRows({ terminalJob, reason }) {
  const allowDuringFatal = reason === 'unexpected_failure';
  artifact.cleanupInProgress = true;
  persistArtifact();
  const cleanup = { reason, startedAt: new Date().toISOString() };
  if (artifact.suggestionId) {
    beginProductionWrite('cleanup_suggestion', { allowDuringFatal });
    cleanup.suggestion = await deleteOrReport(
      'wmkf_appreviewersuggestions',
      artifact.suggestionId,
      'suggestion',
      { allowDuringFatal },
    );
    cleanup.suggestionStillReadable = await isRecordStillReadable(
      'wmkf_appreviewersuggestions',
      artifact.suggestionId,
      'wmkf_appreviewersuggestionid',
      'suggestion',
    );
    finishProductionWrite('cleanup_suggestion', {
      cleanupProgress: {
        ...(artifact.cleanupProgress || {}),
        suggestion: cleanup.suggestion,
        suggestionStillReadable: cleanup.suggestionStillReadable,
      },
    });
  }
  if (artifact.personId) {
    beginProductionWrite('cleanup_person', { allowDuringFatal });
    cleanup.person = await deleteOrReport(
      'wmkf_potentialreviewerses',
      artifact.personId,
      'person',
      { allowDuringFatal },
    );
    cleanup.personStillReadable = await isRecordStillReadable(
      'wmkf_potentialreviewerses',
      artifact.personId,
      'wmkf_potentialreviewersid',
      'person',
    );
    finishProductionWrite('cleanup_person', {
      cleanupProgress: {
        ...(artifact.cleanupProgress || {}),
        person: cleanup.person,
        personStillReadable: cleanup.personStillReadable,
      },
    });
  }
  const postPopulation = runPopulationPreflight('post-recovery-cleanup');
  cleanup.postPopulation = postPopulation;
  cleanup.populationRestored = Object.entries(prePopulation || {})
    .every(([entity, count]) => postPopulation[entity] === count);
  cleanup.ok = (!artifact.suggestionId
      || (cleanup.suggestion?.deleted === true && cleanup.suggestionStillReadable === false))
    && (!artifact.personId
      || (cleanup.person?.deleted === true && cleanup.personStillReadable === false))
    && cleanup.populationRestored;

  if (DELETE_JOB && core.canCleanup(terminalJob) && cleanup.ok) {
    beginProductionWrite('cleanup_job', { allowDuringFatal });
    const { rows: deleted } = await sql`
      DELETE FROM reviewer_acceptance_jobs
       WHERE id = ${artifact.jobId} AND status = 'completed'
       RETURNING id
    `;
    cleanup.jobDeleted = deleted.length > 0;
    if (!cleanup.jobDeleted) cleanup.ok = false;
    finishProductionWrite('cleanup_job', { cleanupJobDeleted: cleanup.jobDeleted });
  } else {
    cleanup.jobDeleted = false;
  }
  cleanup.finishedAt = new Date().toISOString();
  artifact.cleanupInProgress = false;
  if (reason === 'operator_requested') artifact.cleanup = cleanup;
  else artifact.recoveryCleanup = cleanup;
  if (!cleanup.ok) {
    failed = true;
    artifact.problems.push('recovery cleanup did not fully delete known rows and restore the population baseline');
  }
  persistArtifact();
  return cleanup;
}

async function handleFatal(error, { signal = null } = {}) {
  failed = true;
  const pendingWriteAtFailure = artifact.pendingWrite;
  const phaseAtFailure = artifact.phase;

  // Signal callbacks cannot be awaited by Node. Stamp the signal, current
  // phase, and pending write synchronously before the first await so even a
  // concurrent main-flow resolution cannot exit without durable evidence.
  artifact.failure = {
    signal,
    code: error?.code || null,
    message: error?.message || String(error),
    stack: error?.stack || null,
    observedJobStatus: null,
    jobReadError: null,
    pendingWrite: pendingWriteAtFailure,
    phase: phaseAtFailure,
    at: new Date().toISOString(),
  };
  artifact.state = signal ? 'interrupted' : 'failed';
  artifact.phase = signal ? 'signal_received' : 'error_caught';
  artifact.recovery = {
    autoCleanupEligible: false,
    cleanupRequested: CLEANUP,
    jobStaged: Boolean(artifact.jobId),
    jobCompleted: false,
    pendingWrite: pendingWriteAtFailure,
  };
  persistArtifact({ finished: true });

  let observedJob = null;
  let jobReadError = null;
  try {
    observedJob = await readRecoveryJob();
  } catch (readError) {
    jobReadError = readError?.message || String(readError);
  }

  artifact.job = observedJob || artifact.job || null;
  artifact.failure.observedJobStatus = observedJob?.status || null;
  artifact.failure.jobReadError = jobReadError;
  artifact.phase = signal ? 'signal_received' : 'error_caught';

  const autoCleanup = core.canAutoCleanupRecovery({
    cleanupRequested: CLEANUP,
    jobId: artifact.jobId,
    job: observedJob,
    pendingWrite: pendingWriteAtFailure,
    cleanupInProgress: artifact.cleanupInProgress,
    signal,
  });
  artifact.recovery = {
    autoCleanupEligible: autoCleanup,
    cleanupRequested: CLEANUP,
    jobStaged: Boolean(artifact.jobId),
    jobCompleted: core.canCleanup(observedJob),
    pendingWrite: pendingWriteAtFailure,
  };
  persistArtifact({ finished: true });

  if (autoCleanup && (artifact.personId || artifact.suggestionId)) {
    try {
      await bypassDynamicsRestrictions('smoke-reviewer-binding-recovery-cleanup', () =>
        cleanupKnownRows({ terminalJob: observedJob, reason: 'unexpected_failure' }),
      );
    } catch (cleanupError) {
      artifact.recoveryCleanup = {
        ok: false,
        error: cleanupError?.message || String(cleanupError),
      };
      artifact.problems.push(`recovery cleanup threw: ${cleanupError?.message || cleanupError}`);
      persistArtifact({ finished: true });
    }
  }

  console.error(`\n${signal ? 'INTERRUPTED' : 'FAILED'}: ${error?.message || error}`);
  if (artifactPath) console.error(`Recovery artifact: ${artifactPath}`);
  if (artifact.personId || artifact.suggestionId || artifact.jobId) {
    console.error(`Known rows: person=${artifact.personId || 'none'} suggestion=${artifact.suggestionId || 'none'} job=${artifact.jobId || 'none'}`);
  }
  if (artifact.jobId && !core.canCleanup(observedJob)) {
    console.error('The job is not confirmed completed. Failed/cancelled jobs can be requeued; do not clean up Dataverse rows.');
  }
  process.exit(signal ? 2 : (error?.exitCode || 1));
}

function requestFatal(error, options = {}) {
  fatalRequested = true;
  if (!fatalPromise) fatalPromise = handleFatal(error, options);
  return fatalPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void requestFatal(new Error(`${signal} received`), { signal });
  });
}

await assertNoLocalServer();

prePopulation = runPopulationPreflight('pre-smoke');
const recordProblems = (label, result) => {
  if (result.ok) {
    console.log(`  PASS ${label}`);
  } else {
    failed = true;
    console.error(`  FAIL ${label}:`);
    for (const problem of result.problems) console.error(`    - ${problem}`);
  }
  artifact.problems.push(...result.problems.map((p) => `${label}: ${p}`));
};

try {
  await bypassDynamicsRestrictions('smoke-reviewer-binding', async () => {
  const request = await resolveRequest(REQUEST);
  const approval = core.assertApprovedRequest(request.akoya_requestid, APPROVED_REQUEST_ID, APPROVED_FIXTURE_REQUEST_IDS);
  if (!approval.ok) abort(approval.problems.join('; '));
  const smokeKey = core.buildSmokeKey();
  const email = `${smokeKey}@example.org`;
  assertMainFlowActive();
  initializeArtifact(smokeKey);

  // ── Setup: unique clean person, no contact ──────────────────────────────
  beginProductionWrite('person_create');
  const person = await potentialReviewer.upsertByEmail({
    name: `Smoke Binding Reviewer ${smokeKey.slice(-6)}`,
    email,
    affiliation: 'Smoke Reviewer Binding Test Institution',
    expertise: 'smoke test',
  });
  if (person.created !== true) {
    finishProductionWrite('person_create_refused', { reusedPersonId: person.id || null });
    abort(`upsertByEmail reused an existing person (${person.id}) for ${email} — refusing to treat a matched row as test-owned. Nothing was created; nothing to clean up.`);
  }
  console.log(`person: ${person.id} (${email})`);
  finishProductionWrite('person_create', { personId: person.id });
  assertMainFlowActive();

  const cleanRow = await researcher.getIdentityBindingForUpdate(person.id);
  const cleanCheck = core.assertCleanInitRow(cleanRow);
  if (!cleanCheck.ok) {
    abort(`person ${person.id} is not clean-unbound; the smoke would not exercise writer init:\n  ${cleanCheck.problems.join('\n  ')}`);
  }
  const personBefore = await potentialReviewer.getById(person.id);
  if (personBefore?._wmkf_contact_value) {
    abort(`freshly created person ${person.id} unexpectedly has a contact link ${personBefore._wmkf_contact_value}`);
  }

  beginProductionWrite('suggestion_create');
  const suggestion = await suggestionAdapter.upsert({
    potentialReviewerId: person.id,
    requestId: request.akoya_requestid,
    suggestionLabel: `Smoke binding ${smokeKey}`,
    sources: core.SMOKE_SOURCE_TAG,
    selected: false,
  });
  console.log(`suggestion: ${suggestion.id}`);
  finishProductionWrite('suggestion_create', { suggestionId: suggestion.id });
  assertMainFlowActive();

  // ── Accepted state BEFORE staging (drain ordering requirement) ──────────
  const acceptedAt = core.wholeSecondIso();
  artifact.acceptedAt = acceptedAt;
  beginProductionWrite('accepted_state');
  await DynamicsService.updateRecord('wmkf_appreviewersuggestions', suggestion.id, {
    wmkf_accepted: true,
    wmkf_declined: false,
    wmkf_responsetype: suggestionAdapter.RESPONSE_TYPE_MAP.accepted,
    wmkf_responsereceivedat: acceptedAt,
    wmkf_honorariumoptout: true,
    wmkf_reviewerorcid: ORCID,
  });
  finishProductionWrite('accepted_state', { acceptedAt });
  assertMainFlowActive();
  const acceptedRow = await suggestionAdapter.getForAcceptanceDrain(suggestion.id);
  if (acceptedRow?.wmkf_accepted !== true || !core.secondEqual(acceptedRow?.wmkf_responsereceivedat, acceptedAt)) {
    abort(`accepted state did not read back (accepted=${acceptedRow?.wmkf_accepted}, responseReceivedAt=${acceptedRow?.wmkf_responsereceivedat}). Clean up person/suggestion by hand — no job was staged.`);
  }
  console.log(`accepted state stamped at ${acceptedAt} and read back.`);

  // ── Stage the durable job (queued; deployed cron claims it) ─────────────
  beginProductionWrite('job_staging');
  const job = await enqueueReviewerAcceptanceJob(core.buildSmokeJobArgs({
    acceptanceKey: `${smokeKey}-accept`,
    acceptedAt,
    suggestion: acceptedRow,
    request: { akoya_requestid: request.akoya_requestid, akoya_requestnum: request.akoya_requestnum },
    reviewer: { wmkf_potentialreviewersid: person.id },
    orcid: ORCID,
  }));
  console.log(`job staged: id=${job.id} status=${job.status} accepted_at=${acceptedAt}`);
  finishProductionWrite('job_staging', { jobId: job.id, job });
  assertMainFlowActive();

  // ── Poll until the deployed cron finishes it ─────────────────────────────
  console.log(`\nPolling job ${job.id} every ${POLL_SECONDS}s (timeout ${TIMEOUT_MINUTES}m). This script never invokes the drain.`);
  const terminalJob = await pollJobUntilTerminal(job.id, startedAt);
  assertMainFlowActive();
  artifact.job = terminalJob;
  artifact.phase = 'job_terminal';
  persistArtifact();

  // ── Assertions ───────────────────────────────────────────────────────────
  console.log('\n── Assertions ──');
  recordProblems('job outcome', core.assertJobOutcome(terminalJob));

  const boundRow = await researcher.getIdentityBindingForUpdate(person.id);
  artifact.personBinding = boundRow;
  recordProblems('Wave 13 person binding', core.assertWave13Binding(boundRow, { orcid: ORCID, acceptedAt }));

  const personAfter = await potentialReviewer.getById(person.id);
  recordProblems('no contact link created', {
    ok: !personAfter?._wmkf_contact_value,
    problems: personAfter?._wmkf_contact_value ? [`person gained contact link ${personAfter._wmkf_contact_value}`] : [],
  });

  const { rows: alertRows } = await sql`
    SELECT id, alert_type, severity, title, created_at FROM system_alerts
     WHERE created_at >= ${startedAt} AND metadata->>'suggestionId' = ${suggestion.id}
  `;
  recordProblems('no system alerts raised', {
    ok: alertRows.length === 0,
    problems: alertRows.map((a) => `alert ${a.id} ${a.alert_type} (${a.severity}) "${a.title}"`),
  });

  // ── Attribution (BLOCKING) ───────────────────────────────────────────────
  const { rows: runs } = await sql`
    SELECT id, job_name, status, records_processed, started_at, completed_at, details
      FROM maintenance_runs
     WHERE job_name = 'drain-reviewer-acceptances' AND started_at >= ${startedAt}::timestamptz AT TIME ZONE 'UTC'
     ORDER BY started_at
  `;
  const matchedRun = core.findMatchingDrainAttributionRun(runs, {
    jobId: job.id,
    expectDeployment: EXPECT_DEPLOYMENT,
  });
  artifact.maintenanceRuns = runs;
  artifact.attributionRunId = matchedRun?.id || null;
  console.log(`\n── Attribution ──`);
  console.log(`maintenance_runs (drain-reviewer-acceptances) since ${startedAt}: ${runs.length} run(s); ${matchedRun ? `run ${matchedRun.id} completed the smoke job on the expected deployment` : 'no run recorded both completion of the smoke job and the expected deployment'}.`);
  for (const run of runs) {
    const details = parseDetails(run.details);
    console.log(`  run ${run.id}: ${run.status} processed=${run.records_processed} deployment=${details.deployment?.deploymentId || details.deployment?.gitCommitSha || 'none'} completedJobIds=${JSON.stringify(details.completedJobIds || [])} retriedJobIds=${JSON.stringify(details.retriedJobIds || [])} leaseLostJobIds=${JSON.stringify(details.leaseLostJobIds || [])}`);
  }
  recordProblems('deployed-drain attribution', core.assertDrainAttribution({
    matchedRun,
    totalRuns: runs.length,
    jobId: job.id,
    expectDeployment: EXPECT_DEPLOYMENT,
  }));
  console.log(`expected deployment (operator-attested via vercel inspect): ${EXPECT_DEPLOYMENT}`);

  // ── Artifact before any cleanup ──────────────────────────────────────────
  artifact.phase = 'assertions_complete';
  persistArtifact();
  console.log(`\nartifact: ${artifactPath}`);

  // ── Cleanup (only on explicit flag, only after immutable completion) ───
  if (!CLEANUP) {
    console.log('\nCleanup skipped (pass --cleanup to remove the smoke person/suggestion; the queue row is kept as audit evidence unless --delete-job).');
    console.log(`rows: person=${person.id} suggestion=${suggestion.id} job=${job.id}`);
  } else {
    console.log('\n── Cleanup ──');
    if (!core.canCleanup(terminalJob)) {
      console.error('  refusing cleanup: job is not completed (failed/cancelled jobs can be requeued).');
      artifact.problems.push('cleanup: job is not completed');
      failed = true;
      persistArtifact();
    } else {
      const cleanup = await cleanupKnownRows({ terminalJob, reason: 'operator_requested' });
      if (cleanup.ok) {
        console.log('baseline restored: known rows are absent and post-cleanup population matches the pre-smoke snapshot.');
      } else {
        console.error(`cleanup did not fully verify: ${JSON.stringify(cleanup)}`);
      }
    }
  }
  });

  if (fatalPromise) await fatalPromise;
  artifact.state = failed ? 'failed' : 'passed';
  artifact.phase = 'complete';
  persistArtifact({ finished: true });
  console.log(`\n${failed ? 'FAIL' : 'PASS'} — smoke ${artifact.smokeKey}`);
  process.exit(failed ? 1 : 0);
} catch (error) {
  await requestFatal(error);
}
