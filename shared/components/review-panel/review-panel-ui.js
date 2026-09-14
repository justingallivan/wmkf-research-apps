/**
 * Review Panel shared UI — the pills, timeline, entry row, launch-state and
 * request helpers used by BOTH the standalone multi-request page
 * (pages/review-panel.js) and the per-request Request Workbench tab
 * (shared/components/workbench/ReviewPanelTab.js). Lifted verbatim from the
 * page (docs/plans/REVIEW_PANEL_WORKBENCH_TAB_PLAN_2026-09-13.md slice 6) so
 * the two surfaces cannot fork; the page re-exports the names its tests import.
 */

export const EMPTY_ARRAY = [];
export const POLL_MS = 4000;

export function toId(value) { return value == null ? '' : String(value); }
export function asSet(values) { return new Set((Array.isArray(values) ? values : []).map(toId).filter(Boolean)); }

/** The exact selection this idempotency key would authorize — order-independent, so re-deriving it never depends on Set iteration order. */
export function launchSelectionSignature(selectedIds) {
  return [...selectedIds].map(toId).sort().join(',');
}

export function makeIdempotencyKey() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `review-panel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
  return ['queued', 'running', 'paused'].includes(String(status || '').toLowerCase());
}

/** "retry queued" instead of "queued" when the run is queued because an entry retry is pending — the plain "queued" pill otherwise reads as the original launch queue, not a retry. */
export function runPillLabel(run) {
  if (!run) return 'no run yet';
  if (run.status === 'queued' && (run.entries || []).some((e) => e.retryRequested)) return 'retry queued';
  return run.status;
}

export async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export function StatusPill({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-gray-100 text-gray-700',
    good: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    warning: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
    danger: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
    info: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.neutral}`}>{children}</span>;
}

export function toneForStatus(status) {
  if (status === 'completed') return 'good';
  if (status === 'failed') return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'info';
}

/** "$0.16" when the seat's cost is known, "cost unknown" when it isn't, or null (no cost segment) for a seat with no completed cost yet. */
export function formatSeatCost(costState, costCents) {
  if (costState === 'known') return `$${(Number(costCents) / 100).toFixed(2)}`;
  if (costState === 'unknown') return 'cost unknown';
  return null;
}

export function SeatPill({ seat }) {
  const parts = [seat.label];
  if (seat.model) parts.push(seat.model);
  parts.push(seat.state);
  const cost = formatSeatCost(seat.costState, seat.costCents);
  if (cost) parts.push(cost);
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
      {parts.join(' · ')}
    </span>
  );
}

/** "HH:MM:SS" in the viewer's local time (24h) for one timeline event's ISO timestamp. */
export function formatLocalTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hourCycle: 'h23' });
}

/** "Running for Xs" from the run's created time to `nowMs`, or null for an invalid/missing start. */
export function formatRunningElapsed(createdAt, nowMs) {
  const start = new Date(createdAt).getTime();
  if (!Number.isFinite(start)) return null;
  const seconds = Math.max(0, Math.floor((nowMs - start) / 1000));
  return `Running for ${seconds}s`;
}

/** Compact operator timeline under the run pill — oldest first / newest last, per review-panel-service.js's projection. */
export function RunTimeline({ timeline }) {
  if (!timeline?.length) return null;
  return (
    <ul className="mb-3 space-y-0.5 text-xs text-gray-500" data-testid="review-panel-timeline">
      {timeline.map((event, i) => (
        <li key={`${event.at}-${i}`}>{formatLocalTime(event.at)}  {event.label}</li>
      ))}
    </ul>
  );
}

/** True once every enabled seat AND the chair have a terminal `completed` attempt for this entry. */
export function seatsAndChairCompleted(seats) {
  return seats.length > 0 && seats.every((seat) => seat.state === 'completed');
}

/**
 * True while the worker is between "retry_requested_at cleared" and "entry
 * marked completed" — retryFailedEntries clears retry_requested_at under
 * its lease BEFORE completeEntryWithReport re-renders/uploads, so during
 * that window the entry still reads `failed`/no report with retryRequested
 * already false, and every seat/chair attempt already completed (nothing
 * left to re-run — only the report render/upload is retrying).
 */
export function isReRenderingReport({ runStatus, entry, seats }) {
  return runStatus === 'running' && entry.status === 'failed' && !entry.retryRequested && !entry.hasReport && seatsAndChairCompleted(seats);
}

export function EntryRow({ entry, runStatus, onRerender, rerenderLoading, rerenderError }) {
  const seats = entry.seats || EMPTY_ARRAY;
  const failedSeats = seats.filter((seat) => seat.error);
  const reRendering = isReRenderingReport({ runStatus, entry, seats });
  // Suppression of the stale `failed` pill/error is gated on entry.retryRequested
  // ONLY — the one DB-backed fact. `reRendering` is an inference (running +
  // failed + no report + every seat/chair already won + retryRequested
  // already cleared) that can ALSO be true for a first-time report-save
  // failure sitting alongside still-running sibling entries (panelPool runs
  // up to 3 entries concurrently), or a retry that itself re-fails. Hiding a
  // fresh failure/error there would recreate the exact confusion this fix is
  // for. The "Retrying…" line below is shown on the inference regardless,
  // additively — it does not hide the failed pill or error.
  const showFailedPill = entry.status !== 'failed' || !entry.retryRequested;
  // A re-render request reuses entry.retryRequested (same DB marker as an
  // ordinary failed-entry retry) — entry.rerender (only present while the
  // marker is outstanding) is what distinguishes it, so the completed-entry
  // waiting copy is only ever shown for THIS entry's own outstanding request.
  // Mirrors requestReviewPanelRerender's own settle fence (review-panel-
  // store.js): the run must not be unsettled (queued/running/paused) or
  // cancelled, or the server 409s — the button must never render enabled
  // when the request would only be rejected.
  const canRerender = entry.status === 'completed' && entry.hasReport && !entry.retryRequested
    && !isRunUnsettled(runStatus) && runStatus !== 'cancelled';
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 py-3 last:border-0">
      <span className="min-w-36 flex-1 text-sm font-medium text-gray-800">#{entry.requestNumber || entry.requestId}</span>
      {showFailedPill && <StatusPill tone={toneForStatus(entry.status)}>{entry.status}</StatusPill>}
      {entry.retryRequested && <StatusPill tone="warning">{entry.rerender ? 'Re-render queued' : 'Retry queued'}</StatusPill>}
      {entry.hasReport && (
        <span className="inline-flex items-center gap-1.5" data-testid="review-panel-entry-links">
          <a className="text-xs font-semibold text-gray-600 underline underline-offset-2 hover:text-gray-900" href={`/api/review-panel/download?entryId=${encodeURIComponent(entry.id)}&format=docx`} download>Word</a>
          <a className="text-xs font-semibold text-gray-600 underline underline-offset-2 hover:text-gray-900" href={`/api/review-panel/download?entryId=${encodeURIComponent(entry.id)}&format=pdf`}>PDF</a>
        </span>
      )}
      {canRerender && (
        <button
          type="button"
          onClick={() => onRerender(entry.id)}
          disabled={rerenderLoading}
          className="text-xs font-semibold text-gray-600 underline underline-offset-2 hover:text-gray-900 disabled:opacity-50"
        >
          Re-render report
        </button>
      )}
      {seats.length > 0 && (
        <span className="flex basis-full flex-wrap items-center gap-1.5 pl-1">
          {seats.map((seat) => <SeatPill key={seat.seatKey} seat={seat} />)}
        </span>
      )}
      {failedSeats.map((seat) => (
        <p key={seat.seatKey} className="basis-full pl-1 text-xs text-red-700">{seat.error}</p>
      ))}
      {entry.retryRequested && (
        <p className="basis-full pl-1 text-xs text-gray-500">
          {entry.rerender ? 'Re-render requested — waiting for the worker (runs every minute).' : 'Retry requested — waiting for the worker (runs every minute).'}
        </p>
      )}
      {!entry.retryRequested && reRendering && (
        <p className="basis-full pl-1 text-xs text-gray-500">Retrying: rendering and saving the report…</p>
      )}
      {!entry.retryRequested && entry.error && <p className="basis-full pl-1 text-xs text-red-700">{entry.error}</p>}
      {/* A rejected rerender request (e.g. a 409 because the run isn't settled) shows HERE, beside this
          entry's own row, never in the shared launch-error slot (which only renders on the Requests tab). */}
      {rerenderError && <p className="basis-full pl-1 text-xs text-red-700">{rerenderError}</p>}
    </div>
  );
}
