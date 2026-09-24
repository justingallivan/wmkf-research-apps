import { useLayoutEffect, useRef, useState } from 'react';
import RespondReminderModal from './RespondReminderModal';

const ELIGIBILITY_MESSAGE = {
  token_revoked: 'This reviewer’s access was withdrawn. Restore it deliberately before a reminder.',
  token_not_minted: 'No review link is recorded. Check Materials history first.',
  token_invalid_data: 'The review-link metadata needs technical review.',
  token_expired: 'The review link expired. Send an explicit replacement link first.',
  token_insufficient_window: 'The review link does not cover the deadline.',
  due_date_missing: 'Set a review due date before sending a reminder.',
};

export function ReviewReminderAction({ requestId, reviewer, onSent, previewReadOnly = false, degraded = false }) {
  const [open, setOpen] = useState(false);
  const contextRef = useRef({ requestId, suggestionId: reviewer?.suggestionId, previewReadOnly });
  // Committed identity comparison closes an open composer on context change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const current = contextRef.current;
    if (current.requestId !== requestId || current.suggestionId !== reviewer?.suggestionId || current.previewReadOnly !== previewReadOnly) {
      setOpen(false);
    }
    contextRef.current = { requestId, suggestionId: reviewer?.suggestionId, previewReadOnly };
  });

  const lifecycleEligible = Boolean(
    requestId && reviewer?.suggestionId
    && ['materials_sent', 'under_review'].includes(reviewer.reviewStatus)
    && !reviewer.reviewReceivedAt && reviewer.submitted !== true,
  );
  const canCompose = lifecycleEligible && reviewer?.reviewDueReminderEligibility === 'eligible';
  if (!lifecycleEligible) return <span className="text-xs text-gray-300">—</span>;
  const title = degraded
    ? 'Reviewer data could not be refreshed — retry before making changes'
    : previewReadOnly
      ? 'Preview is read-only. This control is enabled after promotion to production.'
      : ELIGIBILITY_MESSAGE[reviewer.reviewDueReminderEligibility] || 'Review a review-due reminder before sending';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={previewReadOnly || degraded || !canCompose}
        title={title}
        aria-label={`Send reminder to ${reviewer.name || 'reviewer'}${previewReadOnly ? ' (disabled in read-only Preview)' : ''}`}
        className="min-h-9 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
      >
        Send reminder
      </button>
      {open && <RespondReminderModal
        requestId={requestId}
        candidate={reviewer}
        kind="reviewdue"
        onClose={() => setOpen(false)}
        onSent={onSent}
        onStale={onSent}
      />}
    </div>
  );
}
