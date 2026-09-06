import { useState, useLayoutEffect, useRef } from 'react';

const REVIEW_REMINDER_ERROR_MESSAGE = {
  conflict: 'Already claimed by another send. Refresh and try again.',
  removed: 'This reviewer was removed from the request.',
  revoked: 'Their review link was revoked. Reissue it before sending a reminder.',
  token_revoked: 'This reviewer\'s access was withdrawn. Deliberately restore access before sending a reminder.',
  token_not_minted: 'No review link is recorded. Investigate the Materials history before sending a link explicitly.',
  token_invalid_data: 'The review-link metadata needs technical review. Do not regenerate the link automatically.',
  token_expired: 'The review link expired. Send an explicit replacement link before sending a reminder.',
  token_insufficient_window: 'The review link does not cover the deadline. Send a deliberate replacement link first.',
  due_date_missing: 'Set a review due date before sending a reminder.',
  not_found: 'This reviewer is no longer available. Refresh the list.',
  read_failed: 'The latest reviewer status could not be verified. Nothing was sent.',
  prepare_failed: 'The reminder could not be prepared. Nothing was sent.',
  send_failed: 'The reminder was prepared, but the email could not be sent.',
  misconfigured: 'The review reminder email template is missing or blank in Admin.',
  ineligible: 'This reviewer is no longer eligible for a reminder. Refresh the list.',
};

export function ReviewReminderAction({
  requestId,
  reviewer,
  onSent,
  previewReadOnly = false,
  degraded = false,
}) {
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const mountedRef = useRef(true);
  // The per-attempt supersession token: bumped only by a new send and by
  // unmount. A committed-context epoch (below) is a SEPARATE dimension —
  // request/reviewer identity/read-only changes bump epoch without bumping
  // generation, so a stale attempt's finally can still find its own
  // generation match and release the send lock even though its feedback/
  // callback checkpoints (which also require epoch match) stay suppressed.
  const generationRef = useRef(0);
  const sendingRef = useRef(false);
  const contextRef = useRef({ requestId, suggestionId: reviewer?.suggestionId, previewReadOnly, onSent, epoch: 0 });

  useLayoutEffect(() => {
    const context = contextRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      sendingRef.current = false;
      context.epoch += 1;
    };
  }, []);

  // Committed-props reconciliation, mirroring the Stage 6B1 registry effect
  // pair (mount/unmount effect above, committed-props effect here): no
  // dependency array, no cleanup, so it runs on every commit. Only
  // request/suggestionId/read-only identity bumps the epoch; object/
  // callback replacement is ordinary refresh and is tracked here (for the
  // latest-callback rule) without invalidating anything. A departed
  // session's feedback must not linger for the new one, so the epoch bump
  // also clears it — this intentionally has no dependency array (identity
  // is a multi-field comparison, not a single prop) and conditionally calls
  // setState, so react-hooks/exhaustive-deps cannot infer a correct
  // dependency list here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const context = contextRef.current;
    if (context.requestId !== requestId
      || context.suggestionId !== reviewer?.suggestionId
      || context.previewReadOnly !== previewReadOnly) {
      context.epoch += 1;
      setFeedback(null);
    }
    context.requestId = requestId;
    context.suggestionId = reviewer?.suggestionId;
    context.previewReadOnly = previewReadOnly;
    context.onSent = onSent;
  });

  const lifecycleEligible = Boolean(
    requestId
    && reviewer?.suggestionId
    && ['materials_sent', 'under_review'].includes(reviewer.reviewStatus)
    && !reviewer.reviewReceivedAt
    && reviewer.submitted !== true,
  );
  const reminderEligibility = reviewer?.reviewDueReminderEligibility;
  const canSend = lifecycleEligible && reminderEligibility === 'eligible';

  if (!lifecycleEligible) return <span className="text-xs text-gray-300">—</span>;

  const isCurrent = (epoch) => mountedRef.current && epoch === contextRef.current.epoch;

  const handleSend = async () => {
    if (previewReadOnly || degraded || !canSend || sendingRef.current) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const epoch = contextRef.current.epoch;
    sendingRef.current = true;
    setSending(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/review-manager/send-review-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          suggestionId: reviewer.suggestionId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (generation !== generationRef.current || !isCurrent(epoch)) return;
      if (!response.ok || !data.ok) {
        setFeedback({
          ok: false,
          message: REVIEW_REMINDER_ERROR_MESSAGE[data.reason] || 'The reminder could not be sent.',
        });
        return;
      }
      setFeedback({ ok: true, message: 'Reminder sent.' });
      // "Reminder sent." feedback is retained regardless of what the
      // callback does: a throw/rejection here is a refresh failure, not a
      // failed send, and must never relabel a confirmed mutation as failed
      // or trigger a resend. The callback's returned promise is observed
      // (so a rejection never becomes an unhandled rejection) but NOT
      // awaited: a slow/never-resolving refresh must not hold the send
      // lock or the UI feedback hostage.
      const latestOnSent = contextRef.current.onSent;
      if (latestOnSent) {
        try {
          const result = latestOnSent();
          if (result && typeof result.then === 'function') result.catch(() => {});
        } catch {
          // Swallow: confirmed send, callback/refresh failure only.
        }
      }
    } catch (error) {
      if (generation === generationRef.current && isCurrent(epoch)) {
        setFeedback({ ok: false, message: error.message || 'The reminder could not be sent.' });
      }
    } finally {
      if (generation === generationRef.current) {
        sendingRef.current = false;
        if (mountedRef.current) setSending(false);
      }
    }
  };

  const previewTitle = 'Preview is read-only. This control is enabled after promotion to production.';
  const eligibilityTitle = canSend
    ? 'Send a review-due reminder now'
    : REVIEW_REMINDER_ERROR_MESSAGE[reminderEligibility]
      || 'Reminder eligibility could not be verified. Refresh before trying again.';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleSend}
        disabled={previewReadOnly || degraded || !canSend || sending}
        title={degraded ? 'Reviewer data could not be refreshed - retry before making changes' : (previewReadOnly ? previewTitle : eligibilityTitle)}
        aria-label={`Send reminder to ${reviewer.name || 'reviewer'}${previewReadOnly ? ' (disabled in read-only Preview)' : ''}`}
        className="min-h-9 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
      >
        {sending ? 'Sending…' : 'Send reminder'}
      </button>
      {feedback && (
        <span
          className={`max-w-40 text-right text-xs leading-4 ${feedback.ok ? 'text-green-700' : 'text-amber-700'}`}
          role="status"
        >
          {feedback.message}
        </span>
      )}
    </div>
  );
}
