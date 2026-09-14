/**
 * ReviewPanelTab — the Review Panel inside the Request Workbench (tier-3).
 *
 * One request, one surface: the standalone page's Requests + Progress views
 * collapse into a header (latest status + Launch), the current run's
 * progress, and the edition history for this request
 * (docs/plans/REVIEW_PANEL_WORKBENCH_TAB_PLAN_2026-09-13.md slice 8).
 *
 * Reads GET `/api/review-panel?requestId=<guid>` (review-panel-service.js's
 * getReviewPanelForRequest). Visibility is shared (T3): every launcher's runs
 * for this request render here. Mutations stay owner-scoped on the server, so
 * Stop / Retry / Re-render render ONLY for runs whose `owner.isMine` is true
 * (feedback-ui-gates-must-mirror-server-guards). The Launch button is enabled
 * exactly when the server's own `launchable.ok` is true and shows the
 * server's reason otherwise — the tab never re-derives the preconditions.
 *
 * The tab is mounted only when `hasAccess('review-panel')` (shell) and the
 * route independently enforces requireAppAccess + assertReviewPanelAccess.
 * D6: the reservation figure is a BOUND, never a "typical cost".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card } from '../Layout';
import {
  EMPTY_ARRAY, POLL_MS, makeIdempotencyKey, formatReservationBound, isRunUnsettled, runPillLabel,
  readResponse, StatusPill, toneForStatus, formatRunningElapsed, RunTimeline, EntryRow,
} from '../review-panel/review-panel-ui';

function formatLaunchedAt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function launchedByLine(run) {
  const who = run.owner?.isMine ? 'you' : (run.owner?.name || 'another user');
  const when = formatLaunchedAt(run.createdAt);
  return when ? `Launched ${when} by ${who}` : `Launched by ${who}`;
}

/** Copy for a run that is queued/running but has no entry row yet for this request (the worker materializes entries on claim; the drain cron runs every minute). */
function waitingCopy(run) {
  if (!run || run.entries?.length) return null;
  const status = String(run.status || '').toLowerCase();
  if (status === 'queued') return 'Waiting for the worker to pick up the run (runs every minute).';
  if (status === 'running') return 'Preparing the proposal narrative…';
  return null;
}

function RunRow({ run, nowMs, actionLoading, rerenderErrors, onRerender, onRetry, onStop, actionError }) {
  const unsettled = isRunUnsettled(run.status);
  const failedEntries = (run.entries || EMPTY_ARRAY).filter((e) => e.status === 'failed' && !e.retryRequested);
  // Mirrors review-panel-store.js requestReviewPanelCancel: owner-scoped, the
  // run must be queued/running (a live lease still 409s; shown inline).
  const canStop = run.owner?.isMine && ['queued', 'running'].includes(String(run.status || '').toLowerCase());
  // Mirrors requestReviewPanelRetry: owner-scoped, run settled and not cancelled, entry failed.
  const canRetry = run.owner?.isMine && !unsettled && run.status !== 'cancelled' && failedEntries.length > 0;
  const elapsed = String(run.status || '').toLowerCase() === 'running' ? formatRunningElapsed(run.createdAt, nowMs) : null;
  const waiting = waitingCopy(run);
  return (
    <li className="px-4 py-4" data-testid="review-panel-run">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusPill tone={toneForStatus(run.status)}>{runPillLabel(run)}</StatusPill>
          <span className="text-xs text-gray-500">{launchedByLine(run)}</span>
        </div>
        {(canRetry || canStop) && (
          <div className="flex items-center gap-2">
            {canRetry && (
              <Button size="sm" variant="outline" onClick={() => onRetry(run)} disabled={Boolean(actionLoading)} loading={actionLoading === `retry:${run.id}`}>
                Retry failed
              </Button>
            )}
            {canStop && (
              <Button size="sm" variant="outline" onClick={() => onStop(run)} disabled={Boolean(actionLoading)} loading={actionLoading === `stop:${run.id}`}>
                {run.requestCount > 1 ? 'Stop run' : 'Stop'}
              </Button>
            )}
          </div>
        )}
      </div>
      {run.error && <p className="mt-2 text-sm text-red-700">{run.error}</p>}
      {actionError && <p className="mt-2 text-xs text-red-700" role="alert">{actionError}</p>}
      {unsettled && (
        <div className="mt-3">
          <RunTimeline timeline={run.timeline} />
          {elapsed && <p className="mb-2 text-xs text-gray-500">{elapsed}</p>}
          {waiting && <p className="text-sm text-gray-500">{waiting}</p>}
        </div>
      )}
      {(run.failures || EMPTY_ARRAY).map((f, i) => (
        <p key={`${f.requestId}-${i}`} className="mt-2 text-xs text-red-700">{f.error}</p>
      ))}
      {(run.entries || EMPTY_ARRAY).map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          runStatus={run.status}
          // Re-render is owner-scoped on the server (requestReviewPanelRerender); a
          // non-owner never gets the button, so no-op the handler for them.
          onRerender={run.owner?.isMine ? onRerender : () => {}}
          rerenderLoading={actionLoading === `rerender:${entry.id}`}
          rerenderError={rerenderErrors.get(entry.id)}
        />
      ))}
    </li>
  );
}

/** One sentence for the header, in the sibling tabs' stage-sentence voice: what state this request's panel work is in right now. */
function stateSentence({ loading, runs, activeRun }) {
  if (loading && !runs.length) return 'Loading panel history…';
  if (activeRun) return `A panel is in progress — ${launchedByLine(activeRun).replace(/^Launched /, 'launched ')}.`;
  const latest = runs[0];
  if (!latest) return 'No panel has been run for this request yet.';
  const status = String(latest.status || '').toLowerCase();
  const verb = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : status === 'cancelled' ? 'was stopped' : status === 'partial' ? 'completed with failures' : status;
  return `The latest panel ${verb} — ${launchedByLine(latest).replace(/^Launched /, 'launched ')}.`;
}

export default function ReviewPanelTab({ requestId }) {
  const [data, setData] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [launchError, setLaunchError] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [actionErrors, setActionErrors] = useState(() => new Map()); // per-run stop/retry errors
  const [rerenderErrors, setRerenderErrors] = useState(() => new Map()); // per-entry
  const mounted = useRef(true);
  const requestSeq = useRef(0);
  const launchKeyRef = useRef('');

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const endpoint = `/api/review-panel?requestId=${encodeURIComponent(requestId)}`;

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError('');
    try {
      const body = await readResponse(await fetch(endpoint));
      if (!mounted.current || requestSeq.current !== seq) return;
      setData(body);
      setNowMs(Date.now());
    } catch (loadError) {
      if (mounted.current && requestSeq.current === seq) setError(loadError.message);
    } finally {
      if (mounted.current && requestSeq.current === seq) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { if (requestId) void load(); }, [requestId, load]);

  const runs = data?.runs || EMPTY_ARRAY;
  const activeRun = data?.activeRunId ? runs.find((r) => r.id === data.activeRunId) || null : null;
  const configuration = data?.configuration || null;
  const launchable = data?.launchable || { ok: false, reason: null };

  // Poll while this request has an unsettled run — same stale-generation guard
  // as pages/review-panel.js: a poll response that lands after a user action
  // (which bumps requestSeq via load()) is discarded.
  const activeRunId = data?.activeRunId || null;
  useEffect(() => {
    if (!activeRunId) return undefined;
    let cancelled = false;
    const poll = async () => {
      const generation = requestSeq.current;
      try {
        const body = await readResponse(await fetch(endpoint));
        if (!cancelled && mounted.current && requestSeq.current === generation) { setData(body); setNowMs(Date.now()); }
      } catch (pollError) {
        if (!cancelled && mounted.current && requestSeq.current === generation) setError(pollError.message);
      }
    };
    const timer = window.setInterval(poll, POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeRunId, endpoint]);

  const runAction = async (body) => readResponse(await fetch('/api/review-panel', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));

  // Same idempotency posture as the page: one key per launch attempt for this
  // request, kept across a lost response so a second click replays instead of
  // starting a second paid run; cleared only on confirmed success.
  const launch = async () => {
    if (!launchKeyRef.current) launchKeyRef.current = makeIdempotencyKey();
    setActionLoading('launch');
    setLaunchError('');
    try {
      await runAction({ action: 'launch', selectedRequestIds: [requestId], idempotencyKey: launchKeyRef.current });
      launchKeyRef.current = '';
      await load();
    } catch (launchErr) {
      setLaunchError(launchErr.message);
      await load();
    } finally {
      setActionLoading('');
    }
  };

  const setRunError = (runId, message) => setActionErrors((current) => {
    const next = new Map(current);
    if (message) next.set(runId, message); else next.delete(runId);
    return next;
  });

  const retry = async (run) => {
    const entryIds = (run.entries || EMPTY_ARRAY).filter((e) => e.status === 'failed').map((e) => e.id);
    if (!entryIds.length) return;
    setActionLoading(`retry:${run.id}`);
    setRunError(run.id, null);
    try {
      await runAction({ action: 'retry', entryIds });
      await load();
    } catch (retryErr) {
      setRunError(run.id, retryErr.message);
    } finally {
      setActionLoading('');
    }
  };

  // Stop is RUN-scoped on the server (requestReviewPanelCancel): a run launched
  // from the standalone page can span several requests, and this tab only shows
  // this request's entry. Name the scope before doing something that affects
  // work the user cannot see here.
  const stop = async (run) => {
    if (run.requestCount > 1 && typeof window !== 'undefined'
      && !window.confirm(`Stop this run? It covers ${run.requestCount} requests, not just this one; every request still in progress in it will be stopped.`)) return;
    setActionLoading(`stop:${run.id}`);
    setRunError(run.id, null);
    try {
      await runAction({ action: 'stop', runId: run.id });
      await load();
    } catch (stopErr) {
      setRunError(run.id, stopErr.message);
    } finally {
      setActionLoading('');
    }
  };

  const rerender = async (entryId) => {
    if (typeof window !== 'undefined' && !window.confirm('Re-render the Word and PDF editions from the saved reviews? No model calls are made.')) return;
    setActionLoading(`rerender:${entryId}`);
    setRerenderErrors((current) => { if (!current.has(entryId)) return current; const next = new Map(current); next.delete(entryId); return next; });
    try {
      await runAction({ action: 'rerender', entryIds: [entryId] });
      await load();
    } catch (rerenderErr) {
      setRerenderErrors((current) => new Map(current).set(entryId, rerenderErr.message));
    } finally {
      setActionLoading('');
    }
  };

  const latestRun = runs[0] || null;
  const launchDisabled = !launchable.ok || actionLoading === 'launch' || loading;
  const launchReason = launchError || (!launchable.ok ? launchable.reason : null);
  const seatsLine = (configuration?.seats || EMPTY_ARRAY).map((s) => `${s.label || s.seatKey} · ${s.model}`).join(', ');

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm" role="alert">
          {error}
        </div>
      )}
      {data?.control?.stopRequested && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm" role="status">
          Review panel work is paused by the rollout operator{data.control.reason ? `: ${data.control.reason}` : ''}. Launches queue until it resumes.
        </div>
      )}

      <Card hover={false}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Review Panel</h2>
            <p className="mt-2 max-w-2xl text-sm text-gray-700" data-testid="review-panel-state-sentence">
              {stateSentence({ loading, runs, activeRun })}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Blind AI seat reviews of the proposal narrative, synthesized by a chair, saved as Word and PDF editions.
            </p>
            <dl className="mt-3 grid gap-x-4 gap-y-0.5 text-xs text-gray-500 sm:grid-cols-[auto_minmax(0,1fr)]">
              <dt className="font-medium text-gray-600">Seats</dt>
              <dd className="min-w-0 break-words">{seatsLine || 'Unavailable'}</dd>
              <dt className="font-medium text-gray-600">Chair</dt>
              <dd>{configuration?.chair ? configuration.chair.model : 'Unavailable'}</dd>
              <dt className="font-medium text-gray-600">Reservation</dt>
              <dd>{formatReservationBound(configuration?.reservationPerEntry)}</dd>
            </dl>
            {!configuration?.ready && configuration?.reason && (
              <p className="mt-2 text-xs text-gray-400">{configuration.reason}</p>
            )}
          </div>
          <div className="flex max-w-xs flex-col items-end gap-1.5">
            <Button size="sm" onClick={launch} disabled={launchDisabled} loading={actionLoading === 'launch'}>
              {latestRun ? 'Launch new panel' : 'Launch panel'}
            </Button>
            {launchReason && (
              <p className="text-right text-xs font-medium text-red-700" role="alert">{launchReason}</p>
            )}
          </div>
        </div>
      </Card>

      <section aria-labelledby="review-panel-history-heading">
        <h2 id="review-panel-history-heading" className="text-sm font-semibold text-gray-900">
          Panels for this request{runs.length ? ` (${runs.length})` : ''}
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Every panel launched for this request, newest first. Stop, retry, and re-render apply only to panels you launched.
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {loading && !data && <p className="px-4 py-4 text-sm text-gray-500">Loading…</p>}
          {!loading && !runs.length && (
            <p className="px-4 py-4 text-sm text-gray-500">Nothing here yet. Launch a panel to review this proposal narrative.</p>
          )}
          {runs.length > 0 && (
            <ul className="divide-y divide-gray-200">
              {runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  nowMs={nowMs}
                  actionLoading={actionLoading}
                  rerenderErrors={rerenderErrors}
                  actionError={actionErrors.get(run.id)}
                  onRerender={rerender}
                  onRetry={retry}
                  onStop={stop}
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
