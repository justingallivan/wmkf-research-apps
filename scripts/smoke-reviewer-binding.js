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
 * - the smoke must run against a deployment containing the jobIds/deployment
 *   maintenance telemetry added after the 2026-07-13 adversarial review;
 * - no cleanup while the job is non-terminal; artifact captured first;
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
 * the exact smoke job id.
 *
 * Exit codes: 0 pass · 1 assertion failure · 2 timeout/interrupted (job may
 * still be live — do NOT clean up by hand until it is terminal) · 3 aborted
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

function abort(message) {
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
    if (core.canCleanup(job)) return job;
    if (Date.now() > deadline) {
      console.error(`\nTIMEOUT after ${TIMEOUT_MINUTES} minutes. The job is still ${job.status} and may yet be claimed by the production cron.`);
      console.error('NO cleanup was performed. Re-check the job before touching any row:');
      console.error(`  SELECT * FROM reviewer_acceptance_jobs WHERE id = ${jobId};`);
      console.error(`Window started at ${startedAt}.`);
      process.exit(2);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
  }
}

async function deleteOrReport(entitySet, id, label) {
  try {
    await DynamicsService.deleteRecord(entitySet, id);
    console.log(`  deleted ${label} ${id}`);
    return { deleted: true };
  } catch (delErr) {
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
let interruptGuard = null;
process.on('SIGINT', () => {
  console.error('\nInterrupted. NO cleanup was performed.');
  if (interruptGuard) console.error(interruptGuard);
  console.error('If a job was staged, the production cron may still process it — verify it is terminal before touching any row.');
  process.exit(2);
});

await assertNoLocalServer();

const prePopulation = runPopulationPreflight('pre-smoke');

const artifact = {
  startedAt,
  orcid: ORCID,
  approvedRequestId: APPROVED_REQUEST_ID,
  expectDeployment: EXPECT_DEPLOYMENT,
  prePopulation,
  problems: [],
};

let failed = false;
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

await bypassDynamicsRestrictions('smoke-reviewer-binding', async () => {
  const request = await resolveRequest(REQUEST);
  const approval = core.assertApprovedRequest(request.akoya_requestid, APPROVED_REQUEST_ID, APPROVED_FIXTURE_REQUEST_IDS);
  if (!approval.ok) abort(approval.problems.join('; '));
  const smokeKey = core.buildSmokeKey();
  const email = `${smokeKey}@example.org`;
  artifact.smokeKey = smokeKey;

  // ── Setup: unique clean person, no contact ──────────────────────────────
  const person = await potentialReviewer.upsertByEmail({
    name: `Smoke Binding Reviewer ${smokeKey.slice(-6)}`,
    email,
    affiliation: 'Smoke Reviewer Binding Test Institution',
    expertise: 'smoke test',
  });
  if (person.created !== true) {
    abort(`upsertByEmail reused an existing person (${person.id}) for ${email} — refusing to treat a matched row as test-owned. Nothing was created; nothing to clean up.`);
  }
  console.log(`person: ${person.id} (${email})`);
  artifact.personId = person.id;

  const cleanRow = await researcher.getIdentityBindingForUpdate(person.id);
  const cleanCheck = core.assertCleanInitRow(cleanRow);
  if (!cleanCheck.ok) {
    abort(`person ${person.id} is not clean-unbound; the smoke would not exercise writer init:\n  ${cleanCheck.problems.join('\n  ')}`);
  }
  const personBefore = await potentialReviewer.getById(person.id);
  if (personBefore?._wmkf_contact_value) {
    abort(`freshly created person ${person.id} unexpectedly has a contact link ${personBefore._wmkf_contact_value}`);
  }

  const suggestion = await suggestionAdapter.upsert({
    potentialReviewerId: person.id,
    requestId: request.akoya_requestid,
    suggestionLabel: `Smoke binding ${smokeKey}`,
    sources: core.SMOKE_SOURCE_TAG,
    selected: false,
  });
  console.log(`suggestion: ${suggestion.id}`);
  artifact.suggestionId = suggestion.id;
  interruptGuard = `Created rows: person=${person.id} suggestion=${suggestion.id} (suggestion may hold accepted state).`;

  // ── Accepted state BEFORE staging (drain ordering requirement) ──────────
  const acceptedAt = core.wholeSecondIso();
  artifact.acceptedAt = acceptedAt;
  await DynamicsService.updateRecord('wmkf_appreviewersuggestions', suggestion.id, {
    wmkf_accepted: true,
    wmkf_declined: false,
    wmkf_responsetype: suggestionAdapter.RESPONSE_TYPE_MAP.accepted,
    wmkf_responsereceivedat: acceptedAt,
    wmkf_honorariumoptout: true,
    wmkf_reviewerorcid: ORCID,
  });
  const acceptedRow = await suggestionAdapter.getForAcceptanceDrain(suggestion.id);
  if (acceptedRow?.wmkf_accepted !== true || !core.secondEqual(acceptedRow?.wmkf_responsereceivedat, acceptedAt)) {
    abort(`accepted state did not read back (accepted=${acceptedRow?.wmkf_accepted}, responseReceivedAt=${acceptedRow?.wmkf_responsereceivedat}). Clean up person/suggestion by hand — no job was staged.`);
  }
  console.log(`accepted state stamped at ${acceptedAt} and read back.`);

  // ── Stage the durable job (queued; deployed cron claims it) ─────────────
  const job = await enqueueReviewerAcceptanceJob(core.buildSmokeJobArgs({
    acceptanceKey: `${smokeKey}-accept`,
    acceptedAt,
    suggestion: acceptedRow,
    request: { akoya_requestid: request.akoya_requestid, akoya_requestnum: request.akoya_requestnum },
    reviewer: { wmkf_potentialreviewersid: person.id },
    orcid: ORCID,
  }));
  console.log(`job staged: id=${job.id} status=${job.status} accepted_at=${acceptedAt}`);
  artifact.jobId = job.id;
  interruptGuard = `Created rows: person=${person.id} suggestion=${suggestion.id} job=${job.id}. The production cron may still claim the job.`;

  // ── Poll until the deployed cron finishes it ─────────────────────────────
  console.log(`\nPolling job ${job.id} every ${POLL_SECONDS}s (timeout ${TIMEOUT_MINUTES}m). This script never invokes the drain.`);
  const terminalJob = await pollJobUntilTerminal(job.id, startedAt);
  artifact.job = terminalJob;

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
  console.log(`maintenance_runs (drain-reviewer-acceptances) since ${startedAt}: ${runs.length} run(s); ${matchedRun ? `run ${matchedRun.id} recorded the smoke job and expected deployment` : 'no run recorded both the smoke job and expected deployment'}.`);
  for (const run of runs) {
    const details = parseDetails(run.details);
    console.log(`  run ${run.id}: ${run.status} processed=${run.records_processed} deployment=${details.deployment?.deploymentId || details.deployment?.gitCommitSha || 'none'} jobIds=${JSON.stringify(details.jobIds || [])}`);
  }
  recordProblems('deployed-drain attribution', core.assertDrainAttribution({
    matchedRun,
    totalRuns: runs.length,
    jobId: job.id,
    expectDeployment: EXPECT_DEPLOYMENT,
  }));
  console.log(`expected deployment (operator-attested via vercel inspect): ${EXPECT_DEPLOYMENT}`);

  // ── Artifact before any cleanup ──────────────────────────────────────────
  const outDir = join(__dirname, '..', 'outputs');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const artifactPath = join(outDir, `${smokeKey}-result.json`);
  const writeArtifact = () => {
    artifact.finishedAt = new Date().toISOString();
    artifact.pass = !failed;
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  };
  writeArtifact();
  console.log(`\nartifact: ${artifactPath}`);

  // ── Cleanup (only on explicit flag, only after terminal) ────────────────
  if (!CLEANUP) {
    console.log('\nCleanup skipped (pass --cleanup to remove the smoke person/suggestion; the queue row is kept as audit evidence unless --delete-job).');
    console.log(`rows: person=${person.id} suggestion=${suggestion.id} job=${job.id}`);
  } else {
    console.log('\n── Cleanup ──');
    if (!core.canCleanup(terminalJob)) {
      console.error('  refusing cleanup: job is not terminal.');
      artifact.problems.push('cleanup: job is not terminal');
      failed = true;
      writeArtifact();
    } else {
      const suggestionCleanup = await deleteOrReport('wmkf_appreviewersuggestions', suggestion.id, 'suggestion');
      const personCleanup = await deleteOrReport('wmkf_potentialreviewerses', person.id, 'person');
      const suggestionStillReadable = await isRecordStillReadable(
        'wmkf_appreviewersuggestions',
        suggestion.id,
        'wmkf_appreviewersuggestionid',
        'suggestion',
      );
      const personStillReadable = await isRecordStillReadable(
        'wmkf_potentialreviewerses',
        person.id,
        'wmkf_potentialreviewersid',
        'person',
      );
      const postPopulation = runPopulationPreflight('post-cleanup');
      artifact.postPopulation = postPopulation;
      const restored = Object.entries(prePopulation).every(([entity, count]) => postPopulation[entity] === count);
      if (restored) {
        console.log('baseline restored: post-cleanup population matches the pre-smoke snapshot.');
      } else {
        console.error(`baseline NOT restored: pre=${JSON.stringify(prePopulation)} post=${JSON.stringify(postPopulation)} — investigate before rerunning.`);
      }
      const cleanupResult = core.evaluateCleanup({
        suggestionOutcome: suggestionCleanup,
        personOutcome: personCleanup,
        suggestionStillReadable,
        personStillReadable,
        populationRestored: restored,
      });
      if (!cleanupResult.ok) {
        failed = true;
        for (const problem of cleanupResult.problems) {
          console.error(`  cleanup failure: ${problem}`);
          artifact.problems.push(`cleanup: ${problem}`);
        }
      }

      let jobDeleted = false;
      if (DELETE_JOB && cleanupResult.allowJobDeletion) {
        const { rows: deleted } = await sql`
          DELETE FROM reviewer_acceptance_jobs
           WHERE id = ${job.id} AND status = ANY(${['completed', 'failed', 'cancelled']})
           RETURNING id
        `;
        jobDeleted = deleted.length > 0;
        if (jobDeleted) {
          console.log(`  deleted queue job ${job.id}`);
        } else {
          console.error(`  queue job ${job.id} NOT deleted (not terminal?)`);
          artifact.problems.push(`cleanup: queue job ${job.id} not deleted despite verified row cleanup`);
          failed = true;
        }
      } else if (DELETE_JOB) {
        console.log(`  queue job ${job.id} kept as audit evidence because cleanup did not fully verify.`);
      } else {
        console.log(`  queue job ${job.id} kept as audit evidence (pass --delete-job to remove it after cleanup verifies).`);
      }

      artifact.cleanup = {
        suggestion: suggestionCleanup,
        person: personCleanup,
        suggestionStillReadable,
        personStillReadable,
        populationRestored: restored,
        allowJobDeletion: cleanupResult.allowJobDeletion,
        jobDeleted,
      };
      // Recompute pass so the durable artifact can never say pass=true while
      // the process exits non-zero on a cleanup/baseline failure.
      writeArtifact();
    }
  }
});

console.log(`\n${failed ? 'FAIL' : 'PASS'} — smoke ${artifact.smokeKey}`);
process.exit(failed ? 1 : 0);
