import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout, { Button, Card, PageHeader } from '../shared/components/Layout';
import RequireAuth from '../shared/components/RequireAuth';
import TestRequestBadge from '../shared/components/TestRequestBadge';

import {
  EMPTY_ARRAY, POLL_MS, toId, asSet, launchSelectionSignature, makeIdempotencyKey, deriveLaunchState,
  formatReservationBound, isRunUnsettled, runPillLabel, readResponse, StatusPill, toneForStatus,
  formatRunningElapsed, RunTimeline, EntryRow,
} from '../shared/components/review-panel/review-panel-ui';

// Re-exported for tests/unit/review-panel-page.test.js and any deep-link caller.
export {
  launchSelectionSignature, deriveLaunchState, formatReservationBound, isRunUnsettled, runPillLabel, formatRunningElapsed,
} from '../shared/components/review-panel/review-panel-ui';

export function ReviewPanelWorkspace() {
  const [data, setData] = useState(null);
  // Clock sample for the elapsed-time line: refreshed whenever data lands (mount load and each poll),
  // never read during render (react-hooks/purity).
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [launchError, setLaunchError] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [actionLoading, setActionLoading] = useState('');
  const [view, setView] = useState('requests');
  const [retrySelection, setRetrySelection] = useState(() => new Set());
  // Per-entry rerender request errors (e.g. a 409 because the run isn't
  // settled) — shown beside THAT entry's own row, never in the shared
  // launchError slot (which only ever renders on the Requests tab).
  const [rerenderErrors, setRerenderErrors] = useState(() => new Map());
  const mounted = useRef(true);
  const initialViewSet = useRef(false);
  const launchKeyRef = useRef({ signature: '', key: '' });
  const requestSeq = useRef(0);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError('');
    try {
      const body = await readResponse('/api/review-panel');
      if (!mounted.current || requestSeq.current !== seq) return;
      setData(body);
      setNowMs(Date.now());
      if (!initialViewSet.current) {
        initialViewSet.current = true;
        if (isRunUnsettled(body.runs?.[0]?.status)) setView('progress');
      }
      const incoming = body.panel?.selection == null
        ? asSet((body.candidates || []).map((c) => c.requestId))
        : asSet(body.panel.selection);
      setSelectedIds(incoming);
    } catch (loadError) {
      if (mounted.current && requestSeq.current === seq) setError(loadError.message);
    } finally {
      if (mounted.current && requestSeq.current === seq) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const candidates = data?.candidates || EMPTY_ARRAY;
  const configuration = data?.configuration || null;
  const latestRun = data?.runs?.[0] || null;
  const reservationPerEntry = configuration?.reservationPerEntry;
  const reservationForSelection = useMemo(() => {
    if (!Number.isFinite(reservationPerEntry?.highUsd)) return null;
    return { ...reservationPerEntry, highUsd: reservationPerEntry.highUsd * Math.max(1, selectedIds.size) };
  }, [reservationPerEntry, selectedIds.size]);
  const launchState = deriveLaunchState({ configuration, selectedCount: selectedIds.size, launching: actionLoading === 'launch' });
  const runActive = isRunUnsettled(latestRun?.status);

  // Mirrors pages/cycle-dossier.js's runActive effect exactly: poll every
  // POLL_MS while the latest run is queued/running/paused, stop once it
  // settles. `actionGeneration` is snapshotted at poll-start and compared
  // against requestSeq.current before the response is applied — a stale
  // generation guard so a poll response arriving after a user action (an
  // action bumps requestSeq via load()) can never clobber that action's
  // fresher state.
  useEffect(() => {
    if (!runActive) return undefined;
    let cancelled = false;
    const poll = async () => {
      const actionGeneration = requestSeq.current;
      try {
        const body = await readResponse('/api/review-panel');
        if (!cancelled && mounted.current && requestSeq.current === actionGeneration) { setData(body); setNowMs(Date.now()); }
      } catch (pollError) {
        if (!cancelled && mounted.current && requestSeq.current === actionGeneration) setError(pollError.message);
      }
    };
    const timer = window.setInterval(poll, POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [runActive]);

  const toggleIncluded = (requestId) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(requestId)) next.delete(requestId); else next.add(requestId);
      return next;
    });
  };
  const includeAll = () => setSelectedIds(asSet(candidates.map((c) => c.requestId)));
  const excludeAll = () => setSelectedIds(new Set());

  const runAction = async (body) => readResponse('/api/review-panel', { method: 'POST', body });

  // Mirrors pages/cycle-dossier.js's launchKeyRef: mint a fresh idempotency
  // key ONLY when the selection changed since the last mint, or after a
  // CONFIRMED success. A lost response (network error, or any thrown error —
  // the request may have reached the server) keeps the same key, so a
  // same-selection second click replays the SAME launch instead of starting
  // a second paid run; the page then refreshes from GET before Launch is
  // re-enabled, so a replay sees the run that already exists.
  const launch = async () => {
    const signature = launchSelectionSignature(selectedIds);
    if (launchKeyRef.current.signature !== signature) {
      launchKeyRef.current = { signature, key: makeIdempotencyKey() };
    }
    setActionLoading('launch');
    setLaunchError('');
    try {
      await runAction({ action: 'launch', selectedRequestIds: [...selectedIds], idempotencyKey: launchKeyRef.current.key });
      launchKeyRef.current = { signature: '', key: '' }; // confirmed success: force a fresh key for any future launch
      setView('progress');
      await load();
    } catch (launchErr) {
      setLaunchError(launchErr.message);
      await load(); // ambiguous/failed: refresh state from GET before Launch is re-enabled
    } finally {
      setActionLoading('');
    }
  };

  const retryFailed = async () => {
    if (!latestRun || !retrySelection.size) return;
    setActionLoading('retry');
    try {
      await runAction({ action: 'retry', entryIds: [...retrySelection] });
      setRetrySelection(new Set());
      await load();
    } catch (retryErr) {
      setLaunchError(retryErr.message);
    } finally {
      setActionLoading('');
    }
  };

  // Re-render makes no model calls (review-panel-worker.js's
  // rerenderCompletedEntries re-derives the DOCX/PDF editions from the
  // entry's already-saved seat/chair reviews) — the confirm copy says so
  // explicitly, since the button otherwise reads exactly like a paid retry.
  const rerenderEntry = async (entryId) => {
    if (!latestRun) return;
    if (typeof window !== 'undefined' && !window.confirm('Re-render the Word and PDF editions from the saved reviews? No model calls are made.')) return;
    setActionLoading(`rerender:${entryId}`);
    setRerenderErrors((current) => {
      if (!current.has(entryId)) return current;
      const next = new Map(current);
      next.delete(entryId);
      return next;
    });
    try {
      await runAction({ action: 'rerender', entryIds: [entryId] });
      await load();
    } catch (rerenderErr) {
      // Shown beside THIS entry's own row (EntryRow's rerenderError prop),
      // never in the shared launchError slot — that slot only renders on
      // the Requests tab, so a rejection here (e.g. the run isn't settled)
      // would otherwise be silently invisible on the Progress tab.
      setRerenderErrors((current) => new Map(current).set(entryId, rerenderErr.message));
    } finally {
      setActionLoading('');
    }
  };

  const toggleOperatorStop = async () => {
    setActionLoading('operator-stop');
    try {
      await runAction({ action: 'operator-stop', stop: !data?.control?.stopRequested });
      await load();
    } finally {
      setActionLoading('');
    }
  };

  const failedEntries = (latestRun?.entries || []).filter((e) => e.status === 'failed');
  // The worker materializes entries on claim (drain-review-panels cron runs
  // every minute) — a queued run has no entry rows yet, and a running run
  // may briefly have none while the worker prepares requests. Without this,
  // the Progress tab shows nothing at all during that window.
  const latestRunStatus = String(latestRun?.status || '').toLowerCase();
  const hasEntries = Boolean(latestRun?.entries?.length);
  const waitingCopy = !hasEntries && latestRunStatus === 'queued'
    ? 'Waiting for the worker to pick up the run (runs every minute).'
    : !hasEntries && latestRunStatus === 'running'
      ? 'Preparing requests…'
      : null;
  // Recomputed from the clock sample taken when each poll's data landed (every POLL_MS while unsettled).
  const runningElapsedText = latestRunStatus === 'running' ? formatRunningElapsed(latestRun?.createdAt, nowMs) : null;

  return (
    <Layout>
      <PageHeader title="Review Panel" subtitle="Virtual Review Panel — Phase A foundation (narrative-only, blind seat reviews synthesized by a Claude chair)" />
      <div className="mx-auto max-w-5xl space-y-6 px-4 pb-16">
        {error && <Card><p className="text-sm text-red-700">{error}</p></Card>}

        <Card>
          <div className="mb-4 flex items-center gap-2">
            <button type="button" onClick={() => setView('requests')} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === 'requests' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>Requests</button>
            <button type="button" onClick={() => setView('progress')} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === 'progress' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>Progress</button>
          </div>

          {view === 'requests' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex gap-2">
                  <button type="button" onClick={includeAll} className="text-xs font-semibold text-gray-600 underline">Include all</button>
                  <button type="button" onClick={excludeAll} className="text-xs font-semibold text-gray-600 underline">Exclude all</button>
                </div>
                <span className="text-xs text-gray-500">{selectedIds.size} selected</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {candidates.map((candidate) => (
                  <li key={candidate.requestId} className="flex items-center gap-3 py-2">
                    <input type="checkbox" aria-label={`Include request ${candidate.requestNumber}`} checked={selectedIds.has(toId(candidate.requestId))} onChange={() => toggleIncluded(toId(candidate.requestId))} className="h-4 w-4" />
                    <span className="flex flex-1 flex-wrap items-center gap-2 text-sm text-gray-800">
                      <span>#{candidate.requestNumber} — {candidate.title}</span>
                      <TestRequestBadge isTestRequest={candidate.isTestRequest} />
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                <p><strong>Seats:</strong> {(configuration?.seats || []).map((s) => `${s.seatKey} (${s.provider} · ${s.model})`).join(', ') || 'Unavailable'}</p>
                <p><strong>Chair:</strong> {configuration?.chair ? `${configuration.chair.provider} · ${configuration.chair.model}` : 'Unavailable'}</p>
                <p className="mt-1 italic">Seat and chair models are changed in the admin model panel.</p>
                <p className="mt-1">Estimated reservation: {formatReservationBound(reservationForSelection)}</p>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Button onClick={launch} disabled={launchState.disabled} loading={actionLoading === 'launch'}>Launch</Button>
                {(launchState.reason || launchError) && <span className="text-xs text-red-700" role="alert">{launchError || launchState.reason}</span>}
              </div>
              {!configuration?.ready && configuration?.reason && (
                <p className="mt-1 text-xs text-gray-400">{configuration.reason}</p>
              )}
            </div>
          )}

          {view === 'progress' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <StatusPill tone={toneForStatus(latestRun?.status)}>{runPillLabel(latestRun)}</StatusPill>
                <div className="flex items-center gap-2">
                  {failedEntries.length > 0 && (
                    <Button onClick={retryFailed} disabled={!retrySelection.size || actionLoading === 'retry'} loading={actionLoading === 'retry'}>Retry failed entries</Button>
                  )}
                  <Button onClick={toggleOperatorStop} loading={actionLoading === 'operator-stop'}>
                    {data?.control?.stopRequested ? 'Resume' : 'Operator stop'}
                  </Button>
                </div>
              </div>
              {latestRun?.error && <p className="mb-3 text-sm text-red-700">{latestRun.error}</p>}
              <RunTimeline timeline={latestRun?.timeline} />
              {runningElapsedText && <p className="mb-3 text-xs text-gray-500">{runningElapsedText}</p>}
              {waitingCopy && <p className="mb-3 text-sm text-gray-500">{waitingCopy}</p>}
              <ul>
                {(latestRun?.entries || []).map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2">
                    {entry.status === 'failed' && (
                      <input
                        type="checkbox"
                        aria-label={`Select entry ${entry.requestNumber} for retry`}
                        checked={retrySelection.has(entry.id)}
                        onChange={() => setRetrySelection((current) => {
                          const next = new Set(current);
                          if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
                          return next;
                        })}
                        className="h-4 w-4"
                      />
                    )}
                    <div className="flex-1">
                      <EntryRow
                        entry={entry}
                        runStatus={latestRun?.status}
                        onRerender={rerenderEntry}
                        rerenderLoading={actionLoading === `rerender:${entry.id}`}
                        rerenderError={rerenderErrors.get(entry.id)}
                      />
                    </div>
                  </li>
                ))}
                {!latestRun && !loading && <p className="text-sm text-gray-500">No runs yet.</p>}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
}

export default function ReviewPanelPage() {
  return <RequireAuth><ReviewPanelWorkspace /></RequireAuth>;
}
