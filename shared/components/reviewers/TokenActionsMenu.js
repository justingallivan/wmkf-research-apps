import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_PIPELINE, TERMINAL_REVIEW_STATUSES, canTransitionToTerminal } from './reviewer-modes';

// ─── Magic-link Token State ─────────────────────────────────────────────────

const TOKEN_STATE_INFO = {
  not_minted: { label: 'Not sent', color: 'bg-gray-100 text-gray-600' },
  active:     { label: 'Active',   color: 'bg-blue-100 text-blue-800' },
  revoked:    { label: 'Revoked',  color: 'bg-red-100 text-red-800' },
  expired:    { label: 'Expired',  color: 'bg-orange-100 text-orange-800' },
  invalid:    { label: 'Needs review', color: 'bg-amber-100 text-amber-800' },
};

export function TokenStateBadge({ state, expiresAt, firstAccessedAt }) {
  const known = Boolean(TOKEN_STATE_INFO[state]);
  const info = TOKEN_STATE_INFO[state] || {
    label: 'Unknown',
    color: 'bg-amber-100 text-amber-800',
  };
  const tooltip = [
    state === 'invalid' && 'Stored token metadata needs technical review',
    !known && 'Unrecognized token state; refresh or request technical review',
    expiresAt && `Expires ${new Date(expiresAt).toLocaleDateString()}`,
    firstAccessedAt && `Opened ${new Date(firstAccessedAt).toLocaleDateString()}`,
  ].filter(Boolean).join(' · ');
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded text-xs font-medium ${info.color}`}
      title={tooltip || undefined}
    >
      {info.label}
      {state === 'active' && firstAccessedAt && (
        <span className="ml-1 text-xs opacity-75">opened</span>
      )}
    </span>
  );
}

const MENU_WIDTH = 288; // w-72

export function TokenActionsMenu({
  reviewer,
  onRegenerate,
  onRevoke,
  onRemove,
  onStatusChange,
  statusPending = false,
  onTransition,
  onCloseReview,
  degraded = false,
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null); // { left, top } in viewport px, or null
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const isActive = reviewer.tokenState === 'active';
  const hasInvalidTokenMetadata = reviewer.tokenState === 'invalid';
  const canRegenerate = !hasInvalidTokenMetadata;
  const canRevoke = isActive || hasInvalidTokenMetadata;
  const canCorrectStatus = Boolean(
    onStatusChange
      && reviewer.reviewStatus !== 'complete'
      && !TERMINAL_REVIEW_STATUSES.includes(reviewer.reviewStatus),
  );
  const canEndEngagement = Boolean(
    onTransition && canTransitionToTerminal(reviewer),
  );
  const settableStatuses = STATUS_PIPELINE.filter(
    s => s.key !== 'accepted'
      && s.key !== 'complete'
      && !TERMINAL_REVIEW_STATUSES.includes(s.key),
  );
  const canCloseReview = Boolean(
    onCloseReview && ['review_received', 'complete'].includes(reviewer.reviewStatus),
  );
  const canRemove = Boolean(
    onRemove
      && reviewer.reviewStatus !== 'complete'
      && !TERMINAL_REVIEW_STATUSES.includes(reviewer.reviewStatus),
  );
  const degradedTitle = 'Reviewer data could not be refreshed - retry before making changes';
  // The estimate drives the upward flip so the portalled menu never opens
  // off-screen. Status correction and terminal actions are taller sections;
  // the remaining items are standard 40px menu rows.
  const itemCount = (canRegenerate ? 1 : 0) + (canRevoke ? 1 : 0) + (canRemove ? 1 : 0);
  const estimatedMenuHeight = (itemCount * 40)
    + (canCorrectStatus ? 118 : 0)
    + (canEndEngagement ? 104 : 0)
    + (canCloseReview ? 72 : 0)
    + (hasInvalidTokenMetadata ? 48 : 0)
    + 8;

  // Position the menu in viewport coords, flipping upward when there isn't room
  // below. Rendered in a portal (see below) so it escapes the table card's
  // `overflow-hidden` clip and the footer's stacking context.
  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const openUp = rect.bottom + estimatedMenuHeight > window.innerHeight
      && rect.top > estimatedMenuHeight;
    setCoords({
      left: Math.max(8, rect.right - MENU_WIDTH),
      top: openUp ? rect.top - estimatedMenuHeight - 4 : rect.bottom + 4,
    });
  }, [estimatedMenuHeight]);

  useEffect(() => {
    if (!open) return;
    place();
    const onDocClick = (e) => {
      // Close only when the click is outside BOTH the trigger and the portalled
      // menu (the menu lives outside this component's DOM subtree).
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // Position is computed once on open; close on scroll/resize so a stale
    // fixed position can never be shown detached from its row.
    const onReflow = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        disabled={degraded}
        className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
        title={degraded ? degradedTitle : 'Manage reviewer'}
        aria-label={`Manage ${reviewer.name || 'reviewer'}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>
      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: coords.left, top: coords.top, width: MENU_WIDTH }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 text-sm"
        >
          {canCorrectStatus && (
            <div className="px-3 py-2 border-b border-gray-100">
              <label className="block">
                <span className="block text-xs font-medium text-gray-700 mb-1">
                  Correct recorded status
                </span>
                <select
                  value={reviewer.reviewStatus === 'accepted' ? '' : reviewer.reviewStatus}
                  disabled={statusPending || degraded}
                  title={degraded ? degradedTitle : undefined}
                  onChange={(event) => {
                    const newStatus = event.target.value;
                    if (!newStatus || statusPending) return;
                    setOpen(false);
                    onStatusChange(newStatus);
                  }}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 text-gray-700 bg-white focus:ring-1 focus:ring-gray-400 focus:outline-none disabled:cursor-wait disabled:bg-gray-50"
                  aria-label={`Correct status for ${reviewer.name || 'reviewer'}`}
                >
                  {reviewer.reviewStatus === 'accepted' && (
                    <option value="" disabled>Accepted</option>
                  )}
                  {settableStatuses.map(status => (
                    <option key={status.key} value={status.key}>{status.label}</option>
                  ))}
                </select>
              </label>
              <p role={statusPending ? 'status' : undefined} className="mt-1.5 text-xs leading-4 text-gray-500">
                {statusPending ? 'Updating status…' : 'Use only to fix the recorded stage. No email is sent.'}
              </p>
            </div>
          )}
          {canEndEngagement && (
            <div className="py-1 border-b border-gray-100">
              <p className="px-3 pt-1 pb-0.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                End engagement
              </p>
              <button
                type="button"
                disabled={degraded}
                title={degraded ? degradedTitle : undefined}
                onClick={() => { setOpen(false); onTransition('withdrew'); }}
                className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-700"
              >
                Record reviewer withdrawal
              </button>
              <button
                type="button"
                disabled={degraded}
                title={degraded ? degradedTitle : undefined}
                onClick={() => { setOpen(false); onTransition('released'); }}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700"
              >
                Release from assignment
              </button>
            </div>
          )}
          {canCloseReview && (
            <div className="py-1 border-b border-gray-100">
              <p className="px-3 pt-1 pb-0.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                Review closeout
              </p>
              <button
                type="button"
                disabled={degraded}
                title={degraded ? degradedTitle : undefined}
                onClick={() => { setOpen(false); onCloseReview(); }}
                className="w-full text-left px-3 py-2 hover:bg-green-50 text-green-800"
              >
                {reviewer.reviewStatus === 'complete' ? 'Edit closeout' : 'Close review'}
              </button>
            </div>
          )}
          <p className="px-3 pt-2 pb-0.5 text-xs font-medium uppercase tracking-wide text-gray-400">
            Reviewer link
          </p>
          {canRegenerate && (
            <button
              disabled={degraded}
              title={degraded ? degradedTitle : undefined}
              onClick={() => { setOpen(false); onRegenerate(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50"
            >
              {reviewer.tokenState === 'not_minted' ? 'Generate link & copy' : 'Regenerate link & copy'}
            </button>
          )}
          {hasInvalidTokenMetadata && (
            <p className="px-3 py-2 text-xs leading-4 text-amber-700 bg-amber-50">
              Token metadata needs repair. Do not regenerate this link.
            </p>
          )}
          {canRevoke && (
            <button
              disabled={degraded}
              title={degraded ? degradedTitle : undefined}
              onClick={() => { setOpen(false); onRevoke(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-700"
            >
              Revoke link
            </button>
          )}
          {canRemove && (
            <button
              disabled={degraded}
              title={degraded ? degradedTitle : undefined}
              onClick={() => { setOpen(false); onRemove(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-700 border-t border-gray-100"
            >
              Remove from this request
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
