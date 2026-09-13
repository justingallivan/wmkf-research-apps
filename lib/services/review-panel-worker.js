/**
 * Virtual Review Panel Phase A durable worker.
 * docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.6.
 *
 * Single global lease (review-panel-store.js's claimReviewPanelRun mirrors
 * cycle-dossier-store.js's claimDossierRun): at most one run is drained at a
 * time. Per entry, per seat: create the next attempt for any seat lacking a
 * completed attempt, dispatch it under the run's lease, run it, then reap
 * expired attempts and select winners — all under the SAME lease. An entry
 * only completes once every configured seat has a winner; the chair then
 * runs as its own attempt row, guarded so a second chair attempt is never
 * dispatched while one is already dispatched or completed for the entry.
 * A failed seat fails the entry outright (partial-seat policy); an
 * `unknown_outcome` seat (ambiguous paid call) is NEITHER a winner nor a
 * failure — [ASSUMED] the entry simply stays `running` (incomplete) pending
 * an explicit operator retry, since an ambiguous paid call is never retried
 * automatically. retryFailedEntries re-arms only entries whose seats/chair
 * still lack a winner; the per-seat "no completed/dispatched attempt yet"
 * predicate in processEntry then naturally re-attempts exactly those seats
 * and, once they all have winners again, re-runs the chair.
 */
import { randomUUID } from 'crypto';
import * as store from './review-panel-store';
import { runSeat, runChair } from './review-panel-generation';
import { assertReviewPanelWorkerOpen } from './review-panel-rollout';

const interruption = (cause) => Object.assign(store.reviewPanelError('Work is paused.'), { interrupted: true, cause });

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

async function runOneSeat(run, entry, seatKey, seatConfig, operatorStop) {
  try {
    await assertReviewPanelWorkerOpen();
  } catch (error) {
    if (error?.interrupted) operatorStop.abort(error);
    throw error;
  }
  const attempt = await store.createAttempt({
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

async function processEntry(run, entry, config, operatorStop) {
  const seatKeys = Object.keys(config.seats);

  // Reap + select winners BEFORE deciding which seats still need a fresh
  // attempt. A seat left `dispatched` by a worker that crashed mid-call is
  // excluded from `seatsNeedingRun`'s naive predicate (`dispatched` looks
  // like "already in flight"); without reaping it first, that seat would
  // never be re-attempted and the entry would sit `pending` forever. Cheap
  // no-ops when there is nothing stale to reap.
  await store.reapExpiredAttempts(run.id, run.lease_token);
  await store.selectWinners(entry.id, run.lease_token);
  let latest = latestAttemptsBySeat(await store.listAttemptsForEntry(entry.id));
  const seatsNeedingRun = seatKeys.filter((seatKey) => {
    const attempt = latest.get(seatKey);
    return !attempt || !['completed', 'dispatched'].includes(attempt.state);
  });

  if (seatsNeedingRun.length) {
    const settled = await Promise.allSettled(
      seatsNeedingRun.map((seatKey) => runOneSeat(run, entry, seatKey, config.seats[seatKey], operatorStop)),
    );
    const interrupted = settled.find((r) => r.status === 'rejected' && r.reason?.interrupted);
    if (interrupted) throw interrupted.reason;

    await store.reapExpiredAttempts(run.id, run.lease_token);
    await store.selectWinners(entry.id, run.lease_token);
    latest = latestAttemptsBySeat(await store.listAttemptsForEntry(entry.id));
  }

  const failed = seatKeys.find((seatKey) => latest.get(seatKey)?.state === 'failed');
  if (failed) {
    await store.mutateReviewPanelEntry(entry.id, (e) => {
      e.status = 'failed';
      e.data = { ...e.data, error: describeEntryFailure({ message: latest.get(failed)?.error_text }, failed) };
    }, run.lease_token);
    return;
  }

  const current = await store.readReviewPanelEntry(entry.id);
  const hasAllWinners = seatKeys.every((seatKey) => current.winners_json?.[seatKey]);
  if (!hasAllWinners) return; // one or more seats are unknown_outcome (ambiguous) or still pending; await explicit retry, never auto-retried

  const chairAttempts = (await store.listAttemptsForEntry(entry.id)).filter((a) => a.seat_key === 'chair');
  if (chairAttempts.some((a) => ['dispatched', 'completed'].includes(a.state))) {
    const completedChair = chairAttempts.find((a) => a.state === 'completed');
    if (completedChair) {
      await store.mutateReviewPanelEntry(entry.id, (e) => {
        e.status = 'completed';
        e.data = { ...e.data, chairResult: completedChair.result_json };
      }, run.lease_token);
    }
    return;
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
  const chairAttempt = await store.createAttempt({
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
    await store.mutateReviewPanelEntry(entry.id, (e) => {
      e.status = 'failed';
      e.data = { ...e.data, error: describeEntryFailure(error, 'chair') };
    }, run.lease_token);
    return;
  }
  const finalChair = (await store.listAttemptsForEntry(entry.id)).find((a) => a.id === chairAttempt.id);
  await store.mutateReviewPanelEntry(entry.id, (e) => {
    if (finalChair?.state === 'completed') {
      e.status = 'completed';
      e.data = { ...e.data, chairResult: finalChair.result_json };
    } else {
      e.status = 'failed';
      e.data = { ...e.data, error: describeEntryFailure({}, 'chair') };
    }
  }, run.lease_token);
}

/** Re-arm entries whose seats/chair still lack a winner so the next drain pass re-attempts exactly those seats and re-runs the chair. Never touches an entry that already completed. */
export async function retryFailedEntries(run, entryIds) {
  for (const entryId of entryIds) {
    await store.mutateReviewPanelEntry(entryId, (e) => {
      if (e.status === 'failed') { e.status = 'running'; e.data = { ...e.data, error: null }; }
    }, run.lease_token);
  }
}

export async function drainReviewPanels() {
  const run = await store.claimReviewPanelRun();
  if (!run) return { claimed: 0 };
  const operatorStop = operatorStopSignal();
  try {
    await assertReviewPanelWorkerOpen();
    const config = run.data?.config;
    if (!config) throw store.reviewPanelError('Run has no pinned configuration.');
    const entries = (await store.listReviewPanelEntries(run.id)).filter((e) => ['pending', 'running'].includes(e.status));
    await panelPool(entries, (entry) => processEntry(run, entry, config, operatorStop));
    return { claimed: 1, runId: run.id };
  } catch (error) {
    if (error?.interrupted) return { claimed: 1, paused: true };
    throw error;
  } finally {
    operatorStop.stop();
    await store.releaseReviewPanelRun(run.id, run.lease_token);
  }
}
