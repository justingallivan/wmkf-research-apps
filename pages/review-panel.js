import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout, { Button, Card, PageHeader } from '../shared/components/Layout';
import RequireAuth from '../shared/components/RequireAuth';

const EMPTY_ARRAY = [];

function toId(value) { return value == null ? '' : String(value); }
function asSet(values) { return new Set((Array.isArray(values) ? values : []).map(toId).filter(Boolean)); }

/**
 * Pure derivation of the Launch button's disabled state and the reason shown
 * beside it. Mirrors the SAME conditions the server enforces (rollout
 * enabled/configured, at least one selected candidate, configuration ready,
 * smoke mode's exactly-one-selection rule — review-panel-service.js's
 * launchReviewPanel) so the UI never shows Launch enabled when the server
 * would reject it.
 */
export function deriveLaunchState({ configuration, selectedCount, launching }) {
  if (launching) return { disabled: true, reason: null };
  if (!configuration) return { disabled: true, reason: 'Loading configuration…' };
  if (!configuration.ready) return { disabled: true, reason: configuration.error || 'The review panel is not ready.' };
  if (!selectedCount) return { disabled: true, reason: 'Select at least one request.' };
  if (configuration.mode === 'smoke' && selectedCount !== 1) {
    return { disabled: true, reason: 'Smoke mode requires exactly one selected request.' };
  }
  return { disabled: false, reason: null };
}

/** Reservation BOUND only (D6) — never a "typical cost" figure. */
export function formatReservationBound(reservation) {
  if (!Number.isFinite(reservation?.highUsd)) return 'Unavailable';
  return `up to $${reservation.highUsd.toFixed(2)} (reservation bound)`;
}

export function isRunUnsettled(status) {
  return ['queued', 'running'].includes(String(status || '').toLowerCase());
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function StatusPill({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-gray-100 text-gray-700',
    good: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    warning: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
    danger: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
    info: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.neutral}`}>{children}</span>;
}

function toneForStatus(status) {
  if (status === 'completed') return 'good';
  if (status === 'failed') return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'info';
}

function EntryRow({ entry }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 py-3 last:border-0">
      <span className="min-w-36 flex-1 text-sm font-medium text-gray-800">#{entry.requestNumber || entry.requestId}</span>
      <StatusPill tone={toneForStatus(entry.status)}>{entry.status}</StatusPill>
      {entry.retryRequested && <StatusPill tone="warning">Retry queued</StatusPill>}
      {entry.hasReport && (
        <span className="inline-flex items-center gap-1.5" data-testid="review-panel-entry-links">
          <a className="text-xs font-semibold text-gray-600 underline underline-offset-2 hover:text-gray-900" href={`/api/review-panel/download?entryId=${encodeURIComponent(entry.id)}&format=docx`} download>Word</a>
          <a className="text-xs font-semibold text-gray-600 underline underline-offset-2 hover:text-gray-900" href={`/api/review-panel/download?entryId=${encodeURIComponent(entry.id)}&format=pdf`}>PDF</a>
        </span>
      )}
      {entry.error && <p className="basis-full pl-1 text-xs text-red-700">{entry.error}</p>}
    </div>
  );
}

export function ReviewPanelWorkspace() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [launchError, setLaunchError] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [actionLoading, setActionLoading] = useState('');
  const [view, setView] = useState('requests');
  const [retrySelection, setRetrySelection] = useState(() => new Set());
  const mounted = useRef(true);
  const initialViewSet = useRef(false);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const body = await readResponse(await fetch('/api/review-panel'));
      if (!mounted.current) return;
      setData(body);
      if (!initialViewSet.current) {
        initialViewSet.current = true;
        if (isRunUnsettled(body.runs?.[0]?.status)) setView('progress');
      }
      const incoming = body.panel?.selection == null
        ? asSet((body.candidates || []).map((c) => c.requestId))
        : asSet(body.panel.selection);
      setSelectedIds(incoming);
    } catch (loadError) {
      if (mounted.current) setError(loadError.message);
    } finally {
      if (mounted.current) setLoading(false);
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

  const toggleIncluded = (requestId) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(requestId)) next.delete(requestId); else next.add(requestId);
      return next;
    });
  };
  const includeAll = () => setSelectedIds(asSet(candidates.map((c) => c.requestId)));
  const excludeAll = () => setSelectedIds(new Set());

  const runAction = async (body) => {
    const response = await fetch('/api/review-panel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return readResponse(response);
  };

  const launch = async () => {
    setActionLoading('launch');
    setLaunchError('');
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `review-panel-${Date.now()}`;
      await runAction({ action: 'launch', selectedRequestIds: [...selectedIds], idempotencyKey });
      setView('progress');
      await load();
    } catch (launchErr) {
      setLaunchError(launchErr.message);
    } finally {
      setActionLoading('');
    }
  };

  const retryFailed = async () => {
    if (!latestRun || !retrySelection.size) return;
    setActionLoading('retry');
    try {
      await runAction({ action: 'retry', runId: latestRun.id, entryIds: [...retrySelection] });
      setRetrySelection(new Set());
      await load();
    } catch (retryErr) {
      setLaunchError(retryErr.message);
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
                    <span className="flex-1 text-sm text-gray-800">#{candidate.requestNumber} — {candidate.title}</span>
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
            </div>
          )}

          {view === 'progress' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <StatusPill tone={toneForStatus(latestRun?.status)}>{latestRun?.status || 'no run yet'}</StatusPill>
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
                    <div className="flex-1"><EntryRow entry={entry} /></div>
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
