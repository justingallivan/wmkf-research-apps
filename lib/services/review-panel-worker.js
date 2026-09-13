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
import { assertReviewPanelStorageConfigured, storeReviewPanelFile } from './review-panel-storage';
import { getReviewPanelSeat, getReviewPanelSeatLabel } from '../../shared/config/reviewPanelSeats';

const interruption = (cause) => Object.assign(store.reviewPanelError('Work is paused.'), { interrupted: true, cause });
const LOST_RESPONSE_TEXT = 'A provider response was lost. A possible charge is reserved; retry explicitly.';
const OWNER_LOST_MESSAGE = 'The run owner no longer has superuser access; no further model calls were made.';

/**
 * Re-assert the run owner is still an active superuser AND the D11 store is
 * still configured, immediately before a paid dispatch (mirrors
 * cycle-dossier-worker.js's assertDossierActor calls at claim time and
 * immediately before each paid call — checkpointResult:136, processEntry:214
 * — plus the dossier's own storage-configured check pattern). Both checks
 * throw the store's own httpStatus-carrying errors; the caller must let
 * either propagate (never swallow) so drainReviewPanels's top-level catch
 * can fail the run and release the lease without dispatching.
 */
async function assertReadyForPaidDispatch(run) {
  await store.assertReviewPanelActor(run.owner_profile_id);
  assertReviewPanelStorageConfigured();
}

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

/**
 * Plain-language failure copy. `stage` is a seat key (e.g. 'seat.claude') or
 * 'chair'; always named by its display label (never the raw seat key). Known
 * error classes — a model refusal, a timeout/abort — get a specific plain
 * reason; anything else falls back to a generic message carrying a short
 * excerpt of the underlying error.
 */
export function describeEntryFailure(error, stage) {
  const label = getReviewPanelSeatLabel(stage);
  const message = String(error?.message || '');
  if (error?.code === 'claude_output_refused' || /refused the request/i.test(message)) {
    return `The ${label} declined to review this proposal (the model returned a refusal); no review was produced.`;
  }
  const isTimeout = /timeout after \d+ms/i.test(message)
    || error?.code === 'executor_deadline_exhausted'
    || error?.name === 'AbortError'
    || /\babort(ed)?\b/i.test(message);
  if (isTimeout) return `The ${label} did not finish within the time budget.`;
  if (error?.code === 'claude_output_truncated' || error?.code === 'claude_output_schema_invalid') return `The ${label}'s output did not match the required structure and was not saved.`;
  if (error?.status === 429 || error?.status === 529) return `The AI service was busy (HTTP ${error.status}) for the ${label}.`;
  if (Number.isInteger(error?.status)) return `The AI service returned an error (HTTP ${error.status}) for the ${label}.`;
  const excerpt = message.trim().slice(0, 140).replace(/[.\s]+$/, '');
  return `The ${label} hit an unexpected problem${excerpt ? `: ${excerpt}` : ''}. Saved work is kept; Retry failed entries re-runs only the seats and chair that did not complete.`;
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
  const label = getReviewPanelSeatLabel(problem.seatKey);
  const message = problem.attempt.state === 'unknown_outcome'
    ? `${LOST_RESPONSE_TEXT} (${label})`
    : describeEntryFailure({ message: problem.attempt.error_text }, problem.seatKey);
  await store.mutateReviewPanelEntry(entry.id, (e) => {
    e.status = 'failed';
    e.data = { ...e.data, error: message };
  }, runLeaseToken);
}

async function runOneSeat(run, entry, seatKey, seatConfig, operatorStop, existingAttempt, revocation) {
  try {
    await assertReviewPanelWorkerOpen();
  } catch (error) {
    if (error?.interrupted) operatorStop.abort(error);
    throw error;
  }
  // Fast local short-circuit once a SIBLING entry has already detected an
  // owner revocation this pass — avoids a redundant DB round trip and stops
  // this seat from ever dispatching. Deliberately unguarded otherwise: an
  // owner-revoked (403) or storage-not-configured (503) throw here must
  // propagate all the way to drainReviewPanels, never be swallowed — see
  // assertReadyForPaidDispatch.
  if (revocation?.error) throw revocation.error;
  await assertReadyForPaidDispatch(run);
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

/** Shared report payload builder — the exact input renderReviewPanelEntryDocuments needs, used by both a normal completion and a re-render (same seat/chair reviews either way). Never mutates anything; entry-scoped cost (never run-scoped — see sumEntryAttemptCosts's own header). */
async function buildReviewPanelReport(entryId, config, chairAttempt, before) {
  const seatKeys = Object.keys(config.seats);
  const [allAttempts, cost] = await Promise.all([
    store.listAttemptsForEntry(entryId), store.sumEntryAttemptCosts(entryId),
  ]);
  const seats = seatKeys.map((seatKey) => {
    const winnerAttempt = allAttempts.find((a) => a.id === before.winners_json?.[seatKey]);
    const seatConfig = config.seats[seatKey];
    const registryEntry = getReviewPanelSeat(seatKey);
    return { seatKey, label: registryEntry?.label || seatKey, vendor: seatConfig.provider, model: seatConfig.model, answers: winnerAttempt?.result_json || {} };
  });
  const seatLabels = Object.fromEntries(seatKeys.map((seatKey) => [seatKey, getReviewPanelSeatLabel(seatKey)]));
  return {
    title: `Review Panel — ${before.data?.input?.requestNumber || before.data?.requestNumber || before.request_id}`,
    institution: before.data?.input?.institution || null,
    chair: chairAttempt.result_json,
    seats,
    cost,
    questions: config.projectedQuestionSet,
    seatLabels,
  };
}

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
 *
 * `forceFormats` (rerenderCompletedEntries' own mode) switches to atomic-swap
 * semantics instead: EVERY format in the list is rendered/uploaded (never
 * derived from what's already missing — an already-completed entry has BOTH
 * formats present, so a "missing" derivation would render nothing), and
 * `data.files` is left COMPLETELY UNTOUCHED — the current pair stays live and
 * downloadable — until every format has landed; only then is the new pair
 * swapped in atomically, with the superseded pair appended (never overwritten)
 * to `data.rerenderHistory`. On ANY failure in this mode, `data.files` is
 * simply never written — it was never touched — so the previous pair is
 * still the persisted, live pair regardless of whether even the rollback
 * write (which only records `error`/`reportError`) itself lands; a lease
 * expiry makes every mutateReviewPanelEntry call 409, so that rollback write
 * is wrapped in its own try/catch rather than assumed to succeed.
 */
async function completeEntryWithReport(run, entry, config, chairAttempt, { renderStamp = null, forceFormats = null } = {}) {
  const before = await store.readReviewPanelEntry(entry.id);
  const existingFiles = before.data?.files || {};
  const rerenderMode = Array.isArray(forceFormats);
  // renderStamp is set only by the re-render path (rerenderCompletedEntries):
  // it forces a NEW Blob pathname per render so storeReviewPanelFile's
  // create-only put (allowOverwrite:false) can never collide with the
  // edition it is superseding — the old edition's ref is kept, never deleted
  // (CLAUDE.md's Blob cleanup rule), so its pathname is still live.
  const pathnameFor = (format) => (renderStamp ? `review-panel/${entry.id}/report-${renderStamp}.${format}` : `review-panel/${entry.id}/report.${format}`);

  if (rerenderMode) {
    let newFiles = {};
    try {
      const report = await buildReviewPanelReport(entry.id, config, chairAttempt, before);
      const rendered = await renderReviewPanelEntryDocuments(report, { formats: forceFormats });
      for (const format of forceFormats) {
        const ref = await storeReviewPanelFile(pathnameFor(format), rendered[format], REPORT_FILE_CONTENT_TYPES[format]);
        // Accumulated locally only — NOT persisted per-format here, unlike
        // the normal-completion path below: a partial pair must never go
        // live. If the NEXT format throws, this one's ref is still recorded
        // on the thrown-catch path below (reportError.orphanedFiles) so its
        // Blob pathname is never silently lost, even though it's never made
        // the entry's live `data.files`.
        newFiles[format] = { ...ref, savedAt: new Date().toISOString() };
      }
      // Every format landed: atomically swap in the new pair and append the
      // superseded pair to history (append, never overwrite).
      await store.mutateReviewPanelEntry(entry.id, (e) => {
        e.status = 'completed';
        e.data = {
          ...e.data,
          chairResult: chairAttempt.result_json,
          files: newFiles,
          error: null,
          reportError: null,
          rerenderHistory: [...(e.data.rerenderHistory || []), { replacedAt: new Date().toISOString(), files: existingFiles }],
        };
      }, run.lease_token);
    } catch (error) {
      const message = String(error?.message || '').slice(0, 300);
      console.error('[review-panel] re-render failed', { entryId: entry.id, message, name: error?.name });
      const detail = message.slice(0, 160);
      const copy = error?.httpStatus ? error.message : `an unexpected problem occurred${detail ? `: ${detail}` : ''}`;
      try {
        await store.mutateReviewPanelEntry(entry.id, (e) => {
          e.status = 'completed'; // never left `failed` by a re-render: the OLD pair was never touched and is still live
          e.data = {
            ...e.data,
            files: existingFiles, // untouched throughout; explicit here for clarity, not a rewrite of live state
            error: `The re-rendered report could not be saved (${copy}); the previous edition is kept.`,
            reportError: {
              name: error?.name, message, at: new Date().toISOString(),
              // Any successfully-uploaded-but-not-swapped-in new format: its
              // Blob pathname is recorded for diagnosis so it is never lost,
              // even though it never became the entry's live `data.files`.
              ...(Object.keys(newFiles).length ? { orphanedFiles: newFiles } : {}),
            },
          };
        }, run.lease_token);
      } catch (writeError) {
        // A lease expiry (or any other transient failure) here is SAFE:
        // this whole branch never wrote to data.files before this point, so
        // the previous pair is still the persisted, live pair regardless of
        // whether this rollback write itself lands. The next drain pass
        // (or an operator retry) re-evaluates from that untouched state.
        console.error('[review-panel] re-render rollback write failed (data.files was never touched, so the previous pair is still live)', { entryId: entry.id, message: String(writeError?.message || '') });
      }
    }
    return;
  }

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
    const report = await buildReviewPanelReport(entry.id, config, chairAttempt, before);
    const rendered = await renderReviewPanelEntryDocuments(report, { formats: missingFormats });
    const newFiles = {};
    for (const format of missingFormats) {
      const ref = await storeReviewPanelFile(pathnameFor(format), rendered[format], REPORT_FILE_CONTENT_TYPES[format]);
      // savedAt stamps the moment THIS edition landed — also read by the
      // service's timeline projection for its "Report saved" event when
      // present, in preference to the entry's own updated_at.
      const stampedRef = { ...ref, savedAt: new Date().toISOString() };
      newFiles[format] = stampedRef;
      // Persist immediately: if the NEXT format's upload throws, this one is
      // never lost, and a later retry only re-renders/re-uploads what's
      // still missing.
      await store.mutateReviewPanelEntry(entry.id, (e) => {
        e.data = { ...e.data, files: { ...(e.data.files || {}), [format]: stampedRef } };
      }, run.lease_token);
    }
    await store.mutateReviewPanelEntry(entry.id, (e) => {
      e.status = 'completed';
      e.data = { ...e.data, chairResult: chairAttempt.result_json, files: { ...existingFiles, ...newFiles } };
    }, run.lease_token);
  } catch (error) {
    const message = String(error?.message || '').slice(0, 300);
    console.error('[review-panel] report save failed', { entryId: entry.id, message, name: error?.name });
    const detail = message.slice(0, 160);
    const copy = error?.httpStatus ? error.message : `an unexpected problem occurred${detail ? `: ${detail}` : ''}`;
    await store.mutateReviewPanelEntry(entry.id, (e) => {
      e.status = 'failed';
      e.data = {
        ...e.data,
        chairResult: chairAttempt.result_json,
        error: `The panel completed, but its report could not be saved (${copy}).`,
        reportError: { name: error?.name, message, at: new Date().toISOString() },
      };
    }, run.lease_token);
  }
}

async function processEntry(run, entry, config, operatorStop, revocation) {
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
      seatsNeedingRun.map((seatKey) => runOneSeat(run, entry, seatKey, config.seats[seatKey], operatorStop, latest.get(seatKey), revocation)),
    );
    const interrupted = settled.find((r) => r.status === 'rejected' && r.reason?.interrupted);
    if (interrupted) throw interrupted.reason;
    // Owner-revoked (403) or storage-not-configured (503) must also abort
    // the whole drain pass, same as an operator-stop interruption — never
    // silently ignored the way an ordinary provider error is (that path is
    // already reflected in the attempt ledger by runSeat itself).
    const notReady = settled.find((r) => r.status === 'rejected' && [403, 503].includes(r.reason?.httpStatus));
    if (notReady) throw notReady.reason;

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
  // Fast local short-circuit, same as runOneSeat's call. Deliberately
  // unguarded otherwise — must propagate to drainReviewPanels, never be
  // swallowed.
  if (revocation?.error) throw revocation.error;
  await assertReadyForPaidDispatch(run);
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
 * is not currently `failed` — but an entry named in `entryIds` that ISN'T
 * `failed` still gets its `retry_requested_at` marker cleared (via the
 * no-op mutateReviewPanelEntry below), under the same lease-fenced
 * transaction, so a stale marker (e.g. two retry requests queued back to
 * back, or the entry moved on before this pass consumed it) can never
 * linger forever — otherwise the "Retry queued" pill and
 * listRetryRequestedEntries would keep surfacing an entry this function
 * will never touch again.
 */
export async function retryFailedEntries(run, entryIds) {
  const config = run.data?.config;
  if (!config) throw store.reviewPanelError('Run has no pinned configuration.');
  const seatKeys = Object.keys(config.seats);
  for (const entryId of entryIds) {
    const entry = await store.readReviewPanelEntry(entryId);
    if (!entry) continue;
    if (entry.status !== 'failed') {
      await store.mutateReviewPanelEntry(entryId, () => {}, run.lease_token);
      continue;
    }

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
 * Consume a re-render request (requestReviewPanelRerender, review-panel-
 * store.js): for each entry id still carrying `retry_requested_at` AND
 * `data.rerender` on a `completed` entry, clear the marker under the lease
 * then re-render both DOCX/PDF editions from the entry's ALREADY-SAVED
 * seat/chair reviews — never creating an attempt or calling runSeat/runChair
 * (this path makes no model calls; the reviews are read straight from the
 * winning attempt rows, exactly like completeEntryWithReport already does
 * for a normal completion). A stale entry named here that is no longer
 * `completed` with a `rerender` marker (e.g. two requests queued back to
 * back, or the entry changed state before this pass consumed it) still gets
 * its `retry_requested_at`/`data.rerender` marker cleared via the no-op
 * mutateReviewPanelEntry below, so it can never linger forever — same
 * defensive shape as retryFailedEntries' own stale-marker handling.
 *
 * This function itself never touches `data.files` — clearing the marker is
 * the only write it makes directly. `completeEntryWithReport`'s own
 * `forceFormats` mode (passed both formats explicitly here, never derived
 * from what's "missing" — an already-completed entry has both present) does
 * the actual render/upload/swap under atomic-swap semantics: the CURRENT
 * pair stays live and downloadable for the entire render/upload window, and
 * is only ever replaced once a FULL new pair has landed, with the superseded
 * pair appended to `data.rerenderHistory` (never overwritten). A failed
 * render/upload leaves the previous pair in place — see that function's own
 * header comment for the full failure-handling contract.
 */
export async function rerenderCompletedEntries(run, config, entryIds) {
  for (const entryId of entryIds) {
    const entry = await store.readReviewPanelEntry(entryId);
    if (!entry) continue;
    if (entry.status !== 'completed' || !entry.data?.rerender) {
      await store.mutateReviewPanelEntry(entryId, () => {}, run.lease_token);
      continue;
    }
    const chairAttemptId = entry.winners_json?.chair;
    const chairAttempt = chairAttemptId
      && (await store.listAttemptsForEntry(entryId)).find((a) => a.id === chairAttemptId);
    if (!chairAttempt) {
      // Defense in depth: requestReviewPanelRerender only marks entries with
      // a chair winner, so this should be unreachable. Clear the marker
      // rather than looping on it forever.
      await store.mutateReviewPanelEntry(entryId, (e) => {
        const { rerender, ...rest } = e.data || {};
        e.data = rest;
      }, run.lease_token);
      continue;
    }
    // Clear the outstanding-request marker BEFORE rendering: completeEntryWithReport
    // re-reads the entry from the store itself, and a crash mid-render must
    // never leave this entry re-triggering the same re-render forever.
    // data.files is left completely untouched by this write.
    await store.mutateReviewPanelEntry(entryId, (e) => {
      const { rerender, ...rest } = e.data || {};
      e.data = rest;
    }, run.lease_token);
    const renderStamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    await completeEntryWithReport(run, entry, config, chairAttempt, { renderStamp, forceFormats: ['docx', 'pdf'] });
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

/**
 * Owner revoked mid-pool (detected during panelPool, with sibling entries
 * possibly still mid-dispatch — see drainReviewPanels). Runs AFTER the pool
 * has fully settled (panelPool swallows the 403 rather than rethrowing, so
 * Promise.all never rejects early while siblings are still in flight) and
 * BEFORE the lease is released: reaps every still-`dispatched` attempt to
 * `unknown_outcome` regardless of expiry (a `failed` run is never reclaimed
 * again, so nothing will ever reap them later), fails every non-terminal
 * entry with the revocation copy, then fails the run itself and clears the
 * lease. Order matters — the run is only marked `failed` (and its lease
 * cleared) LAST, once every entry-level write above is safely committed
 * under the still-current lease.
 */
async function settleRevokedRun(run) {
  await store.reapAllDispatchedAttempts(run.id, run.lease_token);
  const entries = await store.listReviewPanelEntries(run.id);
  for (const entry of entries) {
    if (['completed', 'failed'].includes(entry.status)) continue;
    await store.mutateReviewPanelEntry(entry.id, (e) => {
      e.status = 'failed';
      e.data = { ...e.data, error: OWNER_LOST_MESSAGE };
    }, run.lease_token);
  }
  await store.stopRevokedReviewPanelRun(run.id, run.lease_token, OWNER_LOST_MESSAGE);
}

export async function drainReviewPanels() {
  const run = await store.claimReviewPanelRun();
  if (!run) return { claimed: 0 };
  const operatorStop = operatorStopSignal();
  // Shared across every entry this pass. Set by the FIRST entry to detect an
  // owner revocation; checked by every OTHER entry's runOneSeat/chair-dispatch
  // call as a fast local short-circuit (no DB round trip) before it would
  // otherwise dispatch. panelPool's own wrapper below (not processEntry
  // itself) is what stops a 403 from rejecting the pool early.
  const revocation = { error: null };
  try {
    // Immediately after claiming the run — mirrors cycle-dossier-worker.js's
    // drainCycleDossiers, which calls assertDossierActor right after
    // claimDossierRun, before touching anything else.
    await store.assertReviewPanelActor(run.owner_profile_id);
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
    if (retryIds.length) {
      // The SAME marker (retry_requested_at) hands off both a failed-entry
      // retry and a completed-entry re-render request; only reading each
      // entry's own status/data.rerender tells them apart. Splitting here —
      // rather than inside retryFailedEntries — keeps that function's own
      // contract ("only ever touches a `failed` entry, or no-ops") unchanged.
      const markedEntries = await Promise.all(retryIds.map((id) => store.readReviewPanelEntry(id)));
      const rerenderIds = markedEntries.filter((e) => e?.status === 'completed' && e.data?.rerender).map((e) => e.id);
      const retryOnlyIds = retryIds.filter((id) => !rerenderIds.includes(id));
      if (rerenderIds.length) await rerenderCompletedEntries(run, config, rerenderIds);
      if (retryOnlyIds.length) await retryFailedEntries(run, retryOnlyIds);
    }
    const entries = (await store.listReviewPanelEntries(run.id)).filter((e) => ['pending', 'running'].includes(e.status));
    await panelPool(entries, async (entry) => {
      try {
        await processEntry(run, entry, config, operatorStop, revocation);
      } catch (error) {
        // Owner-revoked: record it and abort any OTHER in-flight paid calls
        // via the shared operatorStop signal, but do NOT rethrow. Rethrowing
        // here would make panelPool's Promise.all reject immediately while
        // sibling entries (different pool workers) are still mid-dispatch —
        // their attempts would be left `dispatched` inside a run that (once
        // marked failed below) is never reclaimed again to reap them.
        // Swallowing instead lets every entry worker in the pool settle
        // first; settleRevokedRun then reaps whatever is left, still under
        // the held lease. `.interrupted` (operator stop) and any other
        // error keep their existing propagate-through behavior.
        if (error?.httpStatus === 403) {
          if (!revocation.error) { revocation.error = error; operatorStop.abort(error); }
          return;
        }
        throw error;
      }
    });
    if (revocation.error) {
      await settleRevokedRun(run);
      return { claimed: 1, ownerRevoked: true };
    }
    await finalizeRunStatusIfSettled(run);
    return { claimed: 1, runId: run.id };
  } catch (error) {
    if (error?.interrupted) return { claimed: 1, paused: true };
    // Owner-revoked BEFORE the pool started (the claim-time check, or the
    // very first entry's dispatch check with no sibling concurrency yet) —
    // no pool work is in flight, so there is nothing to reap; fail the run
    // directly. Mirrors cycle-dossier-worker.js's drainCycleDossiers
    // `if (error.httpStatus === 403) { await store.stopRevokedDossierRun(...);
    // return ...; }`, but review-panel-store.js's stopRevokedReviewPanelRun
    // fails the RUN (not "paused" — review-panel has no separate
    // paused/resume flow) with plain copy.
    if (error?.httpStatus === 403) {
      await store.stopRevokedReviewPanelRun(run.id, run.lease_token, OWNER_LOST_MESSAGE);
      return { claimed: 1, ownerRevoked: true };
    }
    // Storage not (or no longer) configured: treat like an operator-stop
    // interruption, not a permanent run failure — D11's store may simply not
    // be provisioned yet, and provisioning it later should let a paused run
    // resume rather than requiring an explicit retry of a "failed" run.
    // Logged at error level (even though the cron response body stays a
    // plain {paused:true}) so a misconfiguration doesn't silently vanish.
    if (error?.httpStatus === 503) {
      console.error('[review-panel-worker] paused: D11 storage is not configured —', error.message);
      return { claimed: 1, paused: true };
    }
    throw error;
  } finally {
    operatorStop.stop();
    await store.releaseReviewPanelRun(run.id, run.lease_token);
  }
}
