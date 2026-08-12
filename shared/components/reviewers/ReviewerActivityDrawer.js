/**
 * ReviewerActivityDrawer — read-only activity history for one reviewer row.
 *
 * Phase 1 of reviewer activity history (owner decisions 2026-08-12; scope from
 * `outputs/reviewer-activity-history-opus-review-2026-08-11.md`). Everything shown is
 * derived from the reviewer DTO already in memory, so there is no fetch, no route,
 * and no loading state — finding 13's async-load announcement does not apply.
 *
 * Accessibility: focus moves to the drawer on open, is trapped inside while open,
 * Escape closes, and focus returns to the trigger on close.
 *
 * Staleness policy: the host unmounts this drawer on any row mutation rather than
 * letting it display a record the table has since re-fetched past. Existing row
 * refreshes do not reach into an open drawer, so closing is the honest option.
 */

import { useEffect, useRef } from 'react';
import { buildActivityHistory, UNPROVEN_DELIVERY_NOTE } from './reviewer-activity-history';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function formatStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ReviewerActivityDrawer({ reviewer, onClose }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const restoreRef = useRef(null);

  // Capture the trigger before focus moves, so it can be restored on close.
  useEffect(() => {
    restoreRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      const restore = restoreRef.current;
      if (restore && typeof restore.focus === 'function' && document.contains(restore)) {
        restore.focus();
      }
    };
  }, []);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = panelRef.current?.querySelectorAll(FOCUSABLE);
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const events = buildActivityHistory(reviewer);
  const titleId = `reviewer-activity-title-${reviewer.suggestionId}`;
  const noteId = `reviewer-activity-note-${reviewer.suggestionId}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={noteId}
        className="h-full w-full max-w-md overflow-y-auto bg-white p-5 text-left shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-gray-900">Activity history</h2>
            <p className="mt-1 text-sm text-gray-600">{reviewer.name || 'Reviewer'}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Close activity history"
          >
            Close
          </button>
        </div>

        <p id={noteId} className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          Derived from this reviewer&rsquo;s current record. It covers the current engagement
          only — if the reviewer was removed and re-added, earlier activity is no longer
          recorded. Deadline extensions are not listed: the record stores the new deadline,
          not when it was granted.
        </p>

        {events.length === 0 ? (
          <p className="mt-5 text-sm text-gray-500">No activity recorded for this reviewer yet.</p>
        ) : (
          <ol className="mt-5 space-y-4">
            {events.map(event => (
              <li key={event.key} className="border-l-2 border-gray-200 pl-3">
                <p className="text-sm font-medium text-gray-900">{event.label}</p>
                <p className="text-xs text-gray-500">{formatStamp(event.at)}</p>
                {event.detail && <p className="mt-1 text-xs text-gray-500">{event.detail}</p>}
                {!event.deliveryProven && (
                  <p className="mt-1 text-xs text-amber-700">{event.unprovenNote || UNPROVEN_DELIVERY_NOTE}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
