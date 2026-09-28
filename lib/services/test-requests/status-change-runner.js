/**
 * Status setter runner (docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md,
 * slice C): one Phase I or Phase II Status change on a ready production test
 * Request, owner-run through the CLI.
 *
 * Order: refuse before any write (run, marker, program, open change, option,
 * transition, replay) → journal the change → PATCH through
 * `fenceStatusChangeClient` with If-Match → wait until every background job
 * regarding the Request since the write is terminal → census what the change
 * created → complete, or stop `needs_attention`. A change left `dispatched`
 * resumes by reading the Request (`decideResume`), never by re-sending blind.
 */
import crypto from 'node:crypto';
import { bodyOrThrow, getEmails, getPayments, guidEqual, PRODUCTION_GRANT_PROGRAM_NAME, sleep as realSleep } from './basic-clone-steps.js';
import { fenceStatusChangeClient } from './production-write-fence.js';
import {
  STATUS_FIELDS, assertNotDuplicateProducing, decideResume, evaluateEffects, planTransition, resolveOption,
} from './status-transitions.js';

const OPEN = new Set(['planned', 'dispatched', 'applied']);
const JOB_COMPLETED = 3;
const JOB_FAILED = 31;
/**
 * Completion timing. `minQuietMs`: a change is not complete until at least
 * this long after the write AND two consecutive polls show no open job, so an
 * empty first poll (the workflow has not queued yet) never counts as done
 * (Codex round 1, slice C).
 */
export const COMPLETION_DEFAULTS = Object.freeze({ pollMs: 20_000, maxWaitMs: 10 * 60_000, minQuietMs: 90_000 });

function refusal(message, code = 'status_change_refused') {
  return Object.assign(new Error(message), { code });
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex');

export function fieldFor(name) {
  const field = STATUS_FIELDS[name];
  if (!field) throw refusal('--field must be phase1 or phase2.');
  return field;
}

async function readRequest(client, requestId) {
  const select = ['akoya_requestid', 'wmkf_istestrequest', 'wmkf_testcreationrunid', 'wmkf_phaseistatus', 'wmkf_phaseiistatus',
    '_wmkf_grantprogram_value', 'akoya_requeststatus'].join(',');
  const row = bodyOrThrow('Request read', await client.get(`/akoya_requests(${requestId})?$select=${select}`));
  if (!guidEqual(row.akoya_requestid, requestId)) throw refusal('Request read returned a different row.');
  return row;
}

async function assertResearchProgram(client, grantProgramId) {
  if (!grantProgramId) throw refusal('The test Request has no grant program.');
  const row = bodyOrThrow('grant program read', await client.get(`/wmkf_grantprograms(${grantProgramId})?$select=wmkf_name`));
  if (row.wmkf_name !== PRODUCTION_GRANT_PROGRAM_NAME) {
    throw refusal(`The transition table covers the ${PRODUCTION_GRANT_PROGRAM_NAME} program only.`);
  }
}

export async function readLiveOptions(client, field) {
  const response = await client.get(
    `/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='${field}')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata`
      + '?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)',
  );
  const body = bodyOrThrow(`${field} options`, response);
  const options = body.OptionSet?.Options?.length ? body.OptionSet.Options : body.GlobalOptionSet?.Options || [];
  return options.map((o) => ({ value: o.Value, label: o.Label?.UserLocalizedLabel?.Label ?? null }));
}

function pairOf(row) {
  return { phase1: row.wmkf_phaseistatus ?? null, phase2: row.wmkf_phaseiistatus ?? null };
}

/** Refusals that need no ledger row: the run and the Request itself. */
async function assertChangeable(client, run) {
  if (!run) throw refusal('No test request run with that ID.');
  if (run.destinationEnvironment !== 'production') throw refusal('The status setter runs only on production test Requests.');
  if (run.status !== 'ready') throw refusal(`Run is ${run.status}; only a ready run's Request can change status.`);
  const request = await readRequest(client, run.destinationRequestId);
  if (request.wmkf_istestrequest !== true || !guidEqual(request.wmkf_testcreationrunid, run.runId)) {
    throw refusal('The Request does not carry this run\'s test marker.');
  }
  await assertResearchProgram(client, request._wmkf_grantprogram_value);
  return request;
}

async function dispatch({ client, ledger, run, change }) {
  await ledger.markStatusChangeDispatched({ changeId: change.changeId });
  const fenced = fenceStatusChangeClient(client, {
    destinationRequestId: run.destinationRequestId, sourceRequestId: run.sourceRequestId, field: change.field, optionValue: change.optionAfter,
  });
  let response;
  try {
    response = await fenced.patchWithOptions(
      `/akoya_requests(${run.destinationRequestId})`, { [change.field]: change.optionAfter }, { 'If-Match': change.etagBefore },
    );
  } catch (error) {
    // No readable answer: the write may have landed. The change stays
    // dispatched; the same command resumes it by reading the Request.
    throw refusal(`The status PATCH has no readable result (${error.message}); run the same command again to resume.`, 'status_change_ambiguous');
  }
  if (response?.status === 412) {
    await ledger.markStatusChangeNeedsAttention({ changeId: change.changeId, error: 'The Request changed since it was read (412); nothing was written.' });
    throw refusal('The Request changed since it was read (412); nothing was written.', 'status_change_conflict');
  }
  if (!response?.ok) {
    const error = `The status PATCH was refused (${response?.status ?? 'no status'}).`;
    await ledger.markStatusChangeNeedsAttention({ changeId: change.changeId, error });
    throw refusal(error);
  }
  return ledger.markStatusChangeApplied({ changeId: change.changeId });
}

async function listJobsSince(client, requestId, since) {
  const filter = `_regardingobjectid_value eq ${requestId} and createdon ge ${new Date(since).toISOString()}`;
  const response = await client.get(
    `/asyncoperations?$select=asyncoperationid,name,statecode,statuscode,createdon&$filter=${encodeURIComponent(filter)}&$top=100`,
  );
  return bodyOrThrow('background jobs', response).value || [];
}

async function listTrackingSince(client, requestId, since) {
  const filter = `_akoya_request_value eq ${requestId} and createdon ge ${new Date(since).toISOString()}`;
  const response = await client.get(
    `/akoya_goapplystatustrackings?$select=akoya_goapplystatustrackingid,createdon&$filter=${encodeURIComponent(filter)}&$top=50`,
  );
  return bodyOrThrow('GoApply status tracking', response).value || [];
}

/**
 * Wait until the jobs regarding the Request are quiet: at least `minQuietMs`
 * after the write, and two consecutive polls with no open job and the same
 * job set. Jobs still open at `maxWaitMs` return as `open`.
 */
async function awaitJobs(client, requestId, since, { pollMs, maxWaitMs, minQuietMs, now, sleep }) {
  const sinceMs = new Date(since).getTime();
  const deadline = now() + maxWaitMs;
  let previous = null;
  for (;;) {
    const jobs = await listJobsSince(client, requestId, since);
    const open = jobs.filter((job) => job.statecode !== JOB_COMPLETED);
    const signature = jobs.map((job) => `${job.asyncoperationid}:${job.statecode}`).sort().join(',');
    if (!open.length && previous === signature && now() - sinceMs >= minQuietMs) {
      return { jobs, failed: jobs.filter((job) => job.statuscode === JOB_FAILED) };
    }
    previous = open.length ? null : signature;
    if (now() >= deadline) return { jobs, open, notQuiet: !open.length };
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
}

/** New effect rows regarding the Request since `since`, and the Request Status readback. */
export async function censusSince(client, requestId, since) {
  const sinceMs = new Date(since).getTime();
  const after = (row) => new Date(row.createdon).getTime() >= sinceMs;
  const [emails, tracking, payments, request] = await Promise.all([
    getEmails(client, requestId), listTrackingSince(client, requestId, since), getPayments(client, requestId),
    client.get(`/akoya_requests(${requestId})?$select=akoya_requeststatus`),
  ]);
  return {
    emails: emails.filter(after).map((e) => e.activityid),
    tracking: tracking.map((t) => t.akoya_goapplystatustrackingid),
    payments: payments.filter(after).map((p) => p.akoya_requestpaymentid),
    requestStatus: bodyOrThrow('Request Status readback', request).akoya_requeststatus ?? null,
  };
}

async function complete({ client, ledger, run, change, transition, completion }) {
  const since = change.dispatchedAt;
  const waited = await awaitJobs(client, run.destinationRequestId, since, completion);
  if (waited.open?.length || waited.notQuiet) {
    // The write landed; only completion is pending. The change stays applied
    // (open), so the same command resumes here without re-sending.
    throw refusal(`${waited.open.length} background job(s) regarding the Request are not finished (or the jobs are not yet quiet) after ${Math.round(completion.maxWaitMs / 1000)} s; run the same command again to re-check.`, 'status_change_jobs_open');
  }
  const census = await censusSince(client, run.destinationRequestId, since);
  const { failures, absent } = evaluateEffects(transition.allowed, census);
  const effects = {
    kind: 'status_change', outcome: failures.length ? 'unexpected_effects' : 'complete',
    emailIds: census.emails, trackingIds: census.tracking, paymentIds: census.payments,
    jobIds: waited.jobs.map((job) => job.asyncoperationid), requestStatusSha256: sha256(census.requestStatus), count: waited.failed.length,
  };
  if (waited.failed.length) failures.push(`${waited.failed.length} background job(s) regarding the Request failed`);
  if (failures.length) {
    await ledger.markStatusChangeNeedsAttention({ changeId: change.changeId, error: failures.join('; '), effects });
    throw refusal(`Status change ${change.sequence} needs attention: ${failures.join('; ')}.`, 'status_change_effects');
  }
  await ledger.completeStatusChange({ changeId: change.changeId, effects });
  return {
    changeId: change.changeId, sequence: change.sequence, field: change.field, before: change.optionBefore, after: change.optionAfter,
    requestStatus: census.requestStatus, emails: census.emails.length, tracking: census.tracking.length, payments: census.payments.length,
    jobs: waited.jobs.length, allowedButAbsent: absent,
  };
}

/**
 * Make one status change, or resume the run's open one.
 * @param {{ client: object, ledger: object, runId: string, field: string, optionLabel: string, rerun?: boolean,
 *   completion?: { pollMs?: number, maxWaitMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void> } }} input
 */
export async function runStatusChange({ client, ledger, runId, field, optionLabel, rerun = false, completion = {} }) {
  const timing = { ...COMPLETION_DEFAULTS, now: Date.now, sleep: realSleep, ...completion };
  const run = await ledger.getRun(runId);
  const request = await assertChangeable(client, run);
  const after = resolveOption(await readLiveOptions(client, field), optionLabel);
  const prior = await ledger.listStatusChanges(runId);
  const open = prior.find((c) => OPEN.has(c.status));

  if (open) {
    if (open.field !== field || open.optionAfter !== after) {
      throw refusal(`Change ${open.sequence} (${open.field} → ${open.optionAfter}) is still ${open.status}; resume it first.`, 'status_change_open');
    }
    // The effect classes are those of the journaled transition (before → after).
    const slot = field === STATUS_FIELDS.phase1 ? 'phase1' : 'phase2';
    const transition = planTransition({ field, pair: { ...pairOf(request), [slot]: open.optionBefore }, after });
    let change = open;
    if (open.status !== 'applied') {
      let decision = decideResume(open, { value: request[field] ?? null, etag: request['@odata.etag'] });
      // A planned change was never sent, so a target already in place was
      // written by someone else, not recovered.
      if (open.status === 'planned' && decision === 'recovered') decision = 'needs_attention';
      if (decision === 'needs_attention') {
        await ledger.markStatusChangeNeedsAttention({ changeId: open.changeId, error: 'On resume the Request held neither the before-value at its old row version nor the target.' });
        throw refusal('On resume the Request held neither the before-value at its old row version nor the target; inspect it.', 'status_change_resume');
      }
      change = decision === 'recovered'
        ? await ledger.markStatusChangeApplied({ changeId: open.changeId })
        : await dispatch({ client, ledger, run, change: open });
    }
    return complete({ client, ledger, run, change, transition, completion: timing });
  }

  const transition = planTransition({ field, pair: pairOf(request), after });
  assertNotDuplicateProducing(prior, { field, after, allowed: transition.allowed }, { rerun });
  const etag = request['@odata.etag'];
  const planned = await ledger.planStatusChange({
    runId, changeId: crypto.randomUUID(), field, optionBefore: transition.before, optionAfter: after, etagBefore: etag, rerun,
  });
  const applied = await dispatch({ client, ledger, run, change: planned });
  return complete({ client, ledger, run, change: applied, transition, completion: timing });
}

/** Read-only: effects regarding the Request since the run's last completed change, against what it recorded. */
export async function recheckStatusChange({ client, ledger, runId }) {
  const run = await ledger.getRun(runId);
  if (!run || run.destinationEnvironment !== 'production') throw refusal('No production test request run with that ID.');
  const last = (await ledger.listStatusChanges(runId)).filter((c) => c.dispatchedAt).at(-1);
  if (!last) throw refusal('This run has no status change to recheck.');
  const [census, jobs] = await Promise.all([
    censusSince(client, run.destinationRequestId, last.dispatchedAt),
    listJobsSince(client, run.destinationRequestId, last.dispatchedAt),
  ]);
  const recorded = last.effects || {};
  const late = {
    emails: census.emails.filter((id) => !(recorded.emailIds || []).includes(id)),
    tracking: census.tracking.filter((id) => !(recorded.trackingIds || []).includes(id)),
    payments: census.payments.filter((id) => !(recorded.paymentIds || []).includes(id)),
  };
  const openJobs = jobs.filter((job) => job.statecode !== JOB_COMPLETED).length;
  const failedJobs = jobs.filter((job) => job.statuscode === JOB_FAILED).length;
  const lateCount = late.emails.length + late.tracking.length + late.payments.length;
  // Late effects join the journal, so the replay guard sees them.
  if (lateCount && ['complete', 'needs_attention'].includes(last.status)) {
    await ledger.recordLateStatusChangeEffects({
      changeId: last.changeId,
      effects: {
        ...recorded, kind: 'status_change', outcome: 'late_effects',
        emailIds: [...(recorded.emailIds || []), ...late.emails], trackingIds: [...(recorded.trackingIds || []), ...late.tracking],
        paymentIds: [...(recorded.paymentIds || []), ...late.payments], jobIds: jobs.map((job) => job.asyncoperationid),
      },
    });
  }
  return {
    sequence: last.sequence, status: last.status, field: last.field, after: last.optionAfter, openJobs, failedJobs,
    requestStatus: census.requestStatus, requestStatusChanged: recorded.requestStatusSha256 ? sha256(census.requestStatus) !== recorded.requestStatusSha256 : null,
    lateEffects: { emails: late.emails.length, tracking: late.tracking.length, payments: late.payments.length },
    ok: lateCount === 0 && openJobs === 0 && failedJobs === 0,
  };
}
