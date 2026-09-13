/**
 * Virtual Review Panel Phase A durable worker.
 * docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.6.
 *
 * Single global lease (review-panel-store.js's claimReviewPanelRun mirrors
 * cycle-dossier-store.js's claimDossierRun): at most one run is drained at a
 * time. Per entry, per seat: create the next attempt for any seat with NO
 * attempt yet, dispatch it under the run's lease, run it, then reap expired
 * attempts and select winners — all under the SAME lease. An entry only
 * completes once every configured seat has a winner; the chair then runs as
 * its own attempt row, guarded so a second chair attempt is never dispatched
 * while one is already dispatched or completed for the entry.
 *
 * A `failed` seat/chair (a clean provider/validation error) fails the entry
 * outright (partial-seat policy). An `unknown_outcome` seat/chair (an
 * ambiguous paid call — reapExpiredAttempts's doing, when a dispatched
 * attempt's lease expired with no result ever recorded) ALSO fails the entry
 * outright, with copy naming the possible reserved charge — it is never
 * auto-retried (matches review-panel-store.js's own header and
 * cycle-dossier-store's claimDossierRun recovery path). Neither `failed` nor
 * `unknown_outcome` is ever re-dispatched automatically: the per-seat/chair
 * dispatch predicate only fires for a seat with no attempt at all (or one
 * still `pending`, the brief crash window between createAttempt and
 * markAttemptDispatched). Only an explicit retryFailedEntries call re-arms a
 * failed entry, by creating fresh pending attempts for exactly the
 * seats/chair that still lack a winner.
 */
import { randomUUID } from 'crypto';
import * as store from './review-panel-store';
import { runSeat, runChair } from './review-panel-generation';
import { assertReviewPanelWorkerOpen } from './review-panel-rollout';
import { renderReviewPanelEntryDocuments } from './review-panel-documents';
import { storeReviewPanelFile } from './review-panel-storage';
import { getReviewPanelSeat } from '../../shared/config/reviewPanelSeats';

const interruption = (cause) => Object.assign(store.reviewPanelError('Work is paused.'), { interrupted: true, cause });
const LOST_RESPONSE_TEXT = 'A provider response was lost. A possible charge is reserved; retry explicitly.';

/** Abort an in-flight paid call when the operator stop fires WHILE a call is running. Between-call checks use assertReviewPanelWorkerOpen() directly; this only matters for a call already dispatched. */
function operatorStopSignal({ intervalMs = 10000 } = {}) {
  const controller = new AbortController();
  let timer = setInterval(async () => {
    try {
      await assertReviewPanelWorkerOpen();
    } catch (error) {
      if (!error?.interrupted) return;
      clearInterval(timer);
      timer = null;
      controller.abort(interruption(error));
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    signal: controller.signal,
    stop: () => { if (timer) { clearInterval(timer); timer = null; } },
    abort: (reason) => controller.abort(reason),
  };
}

async function panelPool(values, fn, limit = 3) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) { const i = next++; results[i] = await fn(values[i], i); }
  }));
  return results;
}

/** Plain-language failure copy. `stage` is a seat key or 'chair'. */
export function describeEntryFailure(error, stage) {
  const label = stage === 'chair' ? 'the chair synthesis' : `the "${stage}" seat`;
  const message = String(error?.message || '');
  const timeout = message.match(/timeout after (\d+)ms/i);
  if (timeout) return `${label} timed out after ${Math.round(Number(timeout[1]) / 1000)} seconds.`;
  if (error?.code === 'executor_deadline_exhausted') return `${label} ran out of time before the worker's turn ended.`;
  if (error?.code === 'claude_output_refused') return `The AI declined to write ${label}'s output.`;
  if (error?.code === 'claude_output_truncated' || error?.code === 'claude_output_schema_invalid') return `${label}'s output did not match the required structure and was not saved.`;
  if (error?.status === 429 || error?.status === 529) return `The AI service was busy (HTTP ${error.status}) for ${label}.`;
  if (Number.isInteger(error?.status)) return `The AI service returned an error (HTTP ${error.status}) for ${label}.`;
  return `${label} hit an unexpected problem. Saved work is kept; retry re-runs only the seats/chair that did not complete.`;
}

function latestAttemptsBySeat(attempts) {
  const bySeat = new Map();
  for (const attempt of attempts) {
    const current = bySeat.get(attempt.seat_key);
    if (!current || attempt.attempt_no > current.attempt_no) bySeat.set(attempt.seat_key, attempt);
  }
  return bySeat;
}

/**
 * The first seat (in `seatKeys` order) whose latest attempt is `failed` or
 * `unknown_outcome`. Both are terminal from the worker's point of view: a
 * `failed` seat is a clean provider/validation error already described by
 * `describeEntryFailure`; an `unknown_outcome` seat is an ambiguous paid call
 * that must never be silently re-spent.
 */
function findProblemSeat(seatKeys, latest) {
  for (const seatKey of seatKeys) {
    const attempt = latest.get(seatKey);
    if (attempt && (attempt.state === 'failed' || attempt.state === 'unknown_outcome')) return { seatKey, attempt };
  }
  return null;
}

async function failEntryForProblem(entry, problem, runLeaseToken) {
  const label = problem.seatKey === 'chair' ? 'the chair synthesis' : `the "${problem.seatKey}" seat`;
  const message = problem.attempt.state === 'unknown_outcome'
    ? `${LOST_RESPONSE_TEXT} (${label})`
    : describeEntryFailure({ message: problem.attempt.error_text }, problem.seatKey);
  await store.mutateReviewPanelEntry(entry.id, (e) => {
    e.status = 'failed';
    e.data = { ...e.data, error: message };
  }, runLeaseToken);
}

async function runOneSeat(run, entry, seatKey, seatConfig, operatorStop, existingAttempt) {
  try {
    await assertReviewPanelWorkerOpen();
  } catch (error) {
    if (error?.interrupted) operatorStop.abort(error);
    throw error;
  }
  // Dispatch an existing `pending` attempt (created either by retryFailedEntries
  // or by a brief crash between createAttempt and markAttemptDispatched) rather
  // than minting a second one for the same seat.
  const attempt = existingAttempt || await store.createAttempt({
    entryId: entry.id, seatKey, leaseToken: run.lease_token,
    provider: seatConfig.provider, model: seatConfig.model, promptSnapshot: seatConfig.promptSnapshot,
  });
  const dispatchToken = randomUUID();
  await store.markAttemptDispatched(attempt.id, { dispatchToken, leaseToken: run.lease_token, dispatchExpiresAt: run.locked_until });
  const deadlineMs = new Date(run.locked_until).getTime() - 60000;
  try {
    await runSeat(entry.data.input, seatConfig, { attemptId: attempt.id, dispatchToken, deadlineMs, signal: operatorStop.signal });
  } catch (error) {
    // runSeat already finalized the attempt row (completed/failed) before
    // throwing/returning. An operator-stop interruption must still abort
    // further seats in this entry; any other provider error is already
    // reflected in the ledger and does not itself stop the drain.
    if (error?.interrupted) throw error;
  }
}

const REPORT_FILE_CONTENT_TYPES = Object.freeze({
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
});

/**
 * Render + persist the entry's private DOCX/PDF report editions (A.7, D11)
 * and mark the entry completed with both the chair's structured result and
 * the saved file refs, all under the run's current lease (review-panel-
 * storage.js's writes need no separate authorization here — the worker
 * already holds the run lease this pass). If rendering or storage fails
 * (including the D11 store not yet being provisioned — review-panel-
 * storage.js 503s when REVIEW_PANEL_BLOB_READ_WRITE_TOKEN is unset), the
 * entry is FAILED rather than silently completed with no saved report; the
 * chair's result is preserved on the entry's data for visibility even in
 * that failure.
 *
 * Only renders/uploads a format NOT already present in entry.data.files, and
 * persists each ref the moment it lands (one mutateReviewPanelEntry write
 * per format) rather than only after both succeed. Without this, a partial
 * failure (docx put succeeds, pdf put fails) left NO ref recorded at all;
 * "Retry failed entries" then re-entered this function, re-rendered BOTH
 * formats (fresh bytes — e.g. a docx creation timestamp — differ from what's
 * already stored), and the docx re-upload failed forever: storeReviewPanelFile's
 * create-only put (allowOverwrite:false) is refused, and its recovery path
 * only succeeds when the retried bytes match the ALREADY-STORED digest,
 * which a fresh render can never do.
 */
async function completeEntryWithReport(run, entry, config, chairAttempt) {
  const seatKeys = Object.keys(config.seats);
  const before = await store.readReviewPanelEntry(entry.id);
  const existingFiles = before.data?.files || {};
  const missingFormats = ['docx', 'pdf'].filter((format) => !existingFiles[format]);

  if (!missingFormats.length) {
    // Both editions are already saved (a stale re-entry, e.g. after an
    // operator retry that found nothing left to do) — just settle the
    // entry's status without touching storage again.
    await store.mutateReviewPanelEntry(entry.id, (e) => {
      e.status = 'completed';
      e.data = { ...e.data, chairResult: chairAttempt.result_json, files: existingFiles };
    }, run.lease_token);
    return;
  }

  try {
    const [allAttempts, cost] = await Promise.all([
      // Entry-scoped, NOT run-scoped: panelPool runs up to 3 entries
      // concurrently, so a run-wide sum here would count sibling entries'
      // still-in-flight attempts as "unknown" and withhold every report's
      // cost line even when this entry's own attempts are all known.
      store.listAttemptsForEntry(entry.id), store.sumEntryAttemptCosts(entry.id),
    ]);
    const seats = seatKeys.map((seatKey) => {
      const winnerAttempt = allAttempts.find((a) => a.id === before.winners_json?.[seatKey]);
      const seatConfig = config.seats[seatKey];
      const registryEntry = getReviewPanelSeat(seatKey);
      return { seatKey, label: registryEntry?.label || seatKey, vendor: seatConfig.provider, model: seatConfig.model, answers: winnerAttempt?.result_json || {} };
    });
    const report = {
      title: `Review Panel — ${before.data?.input?.requestNumber || before.data?.requestNumber || before.request_id}`,
      institution: before.data?.input?.institution || null,
      chair: chairAttempt.result_json,
      seats,
      cost,
    };
    const rendered = await renderReviewPanelEntryDocuments(report, { formats: missingFormats });
    const newFiles = {};
    for (const format of missingFormats) {
      const ref = await storeReviewPanelFile(`review-panel/${entry.id}/report.${format}`, rendered[format], REPORT_FILE_CONTENT_TYPES[format]);
      newFiles[format] = ref;
      // Persist immediately: if the NEXT format's upload throws, this one is
      // never lost, and a later retry only re-renders/re-uploads what's
      // still missing.
      await store.mutateReviewPanelEntry(entry.id, (e) => {
        e.data = { ...e.data, files: { ...(e.data.files || {}), [format]: ref } };
      }, run.lease_token);
    }
    await store.mutateReviewPanelEntry(entry.id, (e) => {
      e.status = 'completed';
      e.data = { ...e.data, chairResult: chairAttempt.result_json, files: { ...existingFiles, ...newFiles } };
    }, run.lease_token);
  } catch (error) {
    await store.mutateReviewPanelEntry(entry.id, (e) => {
      e.status = 'failed';
      e.data = { ...e.data, chairResult: chairAttempt.result_json, error: `The panel completed, but its report could not be saved (${error?.httpStatus ? error.message : 'an unexpected problem occurred'}).` };
    }, run.lease_token);
  }
}

async function processEntry(run, entry, config, operatorStop) {
  const seatKeys = Object.keys(config.seats);

  // Reap + select winners BEFORE deciding which seats still need a fresh
  // attempt. A seat left `dispatched` by a worker that crashed mid-call is
  // reaped to `unknown_outcome` here; that state is then treated as an entry
  // failure below, never as "needs a fresh attempt". Cheap no-ops when there
  // is nothing stale to reap.
  await store.reapExpiredAttempts(run.id, run.lease_token);
  await store.selectWinners(entry.id, run.lease_token);
  let latest = latestAttemptsBySeat(await store.listAttemptsForEntry(entry.id));

  let problem = findProblemSeat(seatKeys, latest);
  if (problem) { await failEntryForProblem(entry, problem, run.lease_token); return; }

  // Only a seat with no attempt yet (or one still `pending` — the brief
  // crash window between createAttempt and markAttemptDispatched) is
  // dispatched here. `failed`/`unknown_outcome` never auto-dispatch; only
  // retryFailedEntries creates a fresh attempt for those.
  const seatsNeedingRun = seatKeys.filter((seatKey) => {
    const attempt = latest.get(seatKey);
    return !attempt || attempt.state === 'pending';
  });

  if (seatsNeedingRun.length) {
    const settled = await Promise.allSettled(
      seatsNeedingRun.map((seatKey) => runOneSeat(run, entry, seatKey, config.seats[seatKey], operatorStop, latest.get(seatKey))),
    );
    const interrupted = settled.find((r) => r.status === 'rejected' && r.reason?.interrupted);
    if (interrupted) throw interrupted.reason;

    await store.reapExpiredAttempts(run.id, run.lease_token);
    await store.selectWinners(entry.id, run.lease_token);
    latest = latestAttemptsBySeat(await store.listAttemptsForEntry(entry.id));

    problem = findProblemSeat(seatKeys, latest);
    if (problem) { await failEntryForProblem(entry, problem, run.lease_token); return; }
  }

  const current = await store.readReviewPanelEntry(entry.id);
  const hasAllWinners = seatKeys.every((seatKey) => current.winners_json?.[seatKey]);
  if (!hasAllWinners) return; // one or more seats are still pending/dispatched in flight; nothing more to do this pass

  const chairAttempts = (await store.listAttemptsForEntry(entry.id)).filter((a) => a.seat_key === 'chair');
  const latestChair = chairAttempts.reduce((best, a) => (!best || a.attempt_no > best.attempt_no ? a : best), null);
  if (latestChair) {
    if (latestChair.state === 'completed') {
      await completeEntryWithReport(run, entry, config, latestChair);
      return;
    }
    if (latestChair.state === 'unknown_outcome' || latestChair.state === 'failed') {
      // Idempotent, same as findProblemSeat for seats: even if a prior pass
      // died between finalizeAttempt(failed) and mutateReviewPanelEntry, this
      // never leaves the entry stuck open with a terminal chair attempt.
      await failEntryForProblem(entry, { seatKey: 'chair', attempt: latestChair }, run.lease_token);
      return;
    }
    if (latestChair.state === 'dispatched') return; // still in flight
    // state === 'pending': fall through and dispatch this existing attempt
    // (created by retryFailedEntries, or the brief crash window between
    // createAttempt and markAttemptDispatched) rather than minting a new one.
  }

  const allAttempts = await store.listAttemptsForEntry(entry.id);
  const seatReviews = {};
  for (const seatKey of seatKeys) {
    const winnerAttempt = allAttempts.find((a) => a.id === current.winners_json[seatKey]);
    seatReviews[seatKey] = winnerAttempt?.result_json;
  }

  try {
    await assertReviewPanelWorkerOpen();
  } catch (error) {
    if (error?.interrupted) operatorStop.abort(error);
    throw error;
  }
  const chairAttempt = latestChair?.state === 'pending' ? latestChair : await store.createAttempt({
    entryId: entry.id, seatKey: 'chair', leaseToken: run.lease_token,
    provider: config.chair.provider, model: config.chair.model, promptSnapshot: config.chair.promptSnapshot,
  });
  const dispatchToken = randomUUID();
  await store.markAttemptDispatched(chairAttempt.id, { dispatchToken, leaseToken: run.lease_token, dispatchExpiresAt: run.locked_until });
  const deadlineMs = new Date(run.locked_until).getTime() - 60000;
  try {
    await runChair(entry.data.input, seatReviews, config.chair, { attemptId: chairAttempt.id, dispatchToken, deadlineMs, signal: operatorStop.signal });
  } catch (error) {
    if (error?.interrupted) throw error;
    // Re-read the attempt's ACTUAL final state rather than trusting the
    // thrown error: if this attempt's lease had already expired by the time
    // runChair's own finalizeAttempt CAS ran, the late-path fallback flips it
    // to 'unknown_outcome' instead of recording 'failed' (review-panel-
    // store.js's finalizeAttempt). Routing through failEntryForProblem picks
    // the correct copy (possible-charge vs. clean failure) either way.
    const finalChair = (await store.listAttemptsForEntry(entry.id)).find((a) => a.id === chairAttempt.id);
    await failEntryForProblem(entry, { seatKey: 'chair', attempt: finalChair || { state: 'failed', error_text: error?.message } }, run.lease_token);
    return;
  }
  const finalChair = (await store.listAttemptsForEntry(entry.id)).find((a) => a.id === chairAttempt.id);
  if (finalChair?.state === 'completed') {
    await completeEntryWithReport(run, entry, config, finalChair);
  } else {
    await failEntryForProblem(entry, { seatKey: 'chair', attempt: finalChair || { state: 'failed', error_text: null } }, run.lease_token);
  }
}

/**
 * Re-arm failed entries by creating a fresh `pending` attempt, under the
 * run's current lease, for exactly the seats that still lack a winner (plus
 * a fresh chair attempt when every seat already has a winner but no chair
 * attempt ever completed). The next drain pass's per-seat/chair dispatch
 * predicate then picks up exactly those fresh `pending` rows; a seat that
 * already has a winner is never re-attempted. Never touches an entry that
 * is not currently `failed`.
 */
export async function retryFailedEntries(run, entryIds) {
  const config = run.data?.config;
  if (!config) throw store.reviewPanelError('Run has no pinned configuration.');
  const seatKeys = Object.keys(config.seats);
  for (const entryId of entryIds) {
    const entry = await store.readReviewPanelEntry(entryId);
    if (!entry || entry.status !== 'failed') continue;

    for (const seatKey of seatKeys) {
      if (entry.winners_json?.[seatKey]) continue;
      await store.createAttempt({
        entryId, seatKey, leaseToken: run.lease_token,
        provider: config.seats[seatKey].provider, model: config.seats[seatKey].model, promptSnapshot: config.seats[seatKey].promptSnapshot,
      });
    }

    const allSeatsAlreadyWon = seatKeys.every((seatKey) => entry.winners_json?.[seatKey]);
    if (allSeatsAlreadyWon) {
      const chairAttempts = (await store.listAttemptsForEntry(entryId)).filter((a) => a.seat_key === 'chair');
      const hasCompletedChair = chairAttempts.some((a) => a.state === 'completed');
      if (!hasCompletedChair) {
        await store.createAttempt({
          entryId, seatKey: 'chair', leaseToken: run.lease_token,
          provider: config.chair.provider, model: config.chair.model, promptSnapshot: config.chair.promptSnapshot,
        });
      }
    }

    await store.mutateReviewPanelEntry(entryId, (e) => {
      e.status = 'running';
      e.data = { ...e.data, error: null };
    }, run.lease_token);
  }
}

/**
 * Materialize any entries the launch route queued but could not create
 * itself (createReviewPanelEntry requires the run's CURRENT lease, which the
 * route never holds — review-panel-service.js's launchReviewPanel instead
 * parks each selected request's already-resolved input DTO in
 * run.data.pendingEntries). Idempotent across crashes: an entry is only
 * created for a requestId with no existing review_panel_entries row for this
 * run, so a worker that dies between creating an entry and clearing it from
 * pendingEntries simply re-checks on the next pass and skips what already
 * exists — it never mints a second entry (and therefore never a second round
 * of paid seat attempts) for the same requestId.
 */
async function materializePendingEntries(run) {
  const pending = Array.isArray(run.data?.pendingEntries) ? run.data.pendingEntries : [];
  if (!pending.length) return;
  const existingRequestIds = new Set((await store.listReviewPanelEntries(run.id)).map((e) => e.request_id));
  const toCreate = pending.filter((item) => !existingRequestIds.has(item.requestId));
  for (const item of toCreate) {
    await store.createReviewPanelEntry({
      runId: run.id, requestId: item.requestId, leaseToken: run.lease_token,
      createdBy: run.owner_profile_id, data: { input: item.input, requestNumber: item.requestNumber },
    });
  }
  if (toCreate.length) {
    await store.mutateReviewPanelRun(run.id, (row) => { row.data.pendingEntries = []; }, { owner: run.owner_profile_id, leaseToken: run.lease_token });
  }
}

/** Once every entry in the run has settled (completed or failed), write the run's terminal status back — the ONLY place review_panel_runs.status ever leaves 'running'/'queued' outside an explicit operator cancel. Required for requestReviewPanelRetry's settle fence (no lease_token AND status not in queued/running) to ever open. */
async function finalizeRunStatusIfSettled(run) {
  const entries = await store.listReviewPanelEntries(run.id);
  if (!entries.length || !entries.every((e) => ['completed', 'failed'].includes(e.status))) return;
  const allFailed = entries.every((e) => e.status === 'failed');
  const allCompleted = entries.every((e) => e.status === 'completed');
  const finalStatus = allCompleted ? 'completed' : allFailed ? 'failed' : 'partial';
  await store.mutateReviewPanelRun(run.id, (row) => { row.status = finalStatus; }, { owner: run.owner_profile_id, leaseToken: run.lease_token });
}

export async function drainReviewPanels() {
  const run = await store.claimReviewPanelRun();
  if (!run) return { claimed: 0 };
  const operatorStop = operatorStopSignal();
  try {
    await assertReviewPanelWorkerOpen();
    const config = run.data?.config;
    if (!config) throw store.reviewPanelError('Run has no pinned configuration.');
    await materializePendingEntries(run);
    // Consume any operator retry request queued by the route
    // (review-panel-service.js's requestReviewPanelRetry) BEFORE this pass's
    // entry scan: retryFailedEntries creates the fresh attempts and, via
    // mutateReviewPanelEntry, clears retry_requested_at in the same
    // lease-fenced transaction that flips the entry back to 'running'.
    const retryIds = (await store.listRetryRequestedEntries(run.id)) || [];
    if (retryIds.length) await retryFailedEntries(run, retryIds);
    const entries = (await store.listReviewPanelEntries(run.id)).filter((e) => ['pending', 'running'].includes(e.status));
    await panelPool(entries, (entry) => processEntry(run, entry, config, operatorStop));
    await finalizeRunStatusIfSettled(run);
    return { claimed: 1, runId: run.id };
  } catch (error) {
    if (error?.interrupted) return { claimed: 1, paused: true };
    throw error;
  } finally {
    operatorStop.stop();
    await store.releaseReviewPanelRun(run.id, run.lease_token);
  }
}
