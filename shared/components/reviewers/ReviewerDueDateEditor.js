import { useEffect, useRef, useState } from 'react';
import { currentYmdInTimeZone, isYmd } from '../../../lib/utils/date-ymd';

function formatDate(value) {
  if (!isYmd(value)) return 'Not set';
  const parsed = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

function nextYmd(value) {
  if (!isYmd(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function minimumExtensionDate(originalDate, today = currentYmdInTimeZone()) {
  const dayAfterOriginal = nextYmd(originalDate);
  if (!dayAfterOriginal) return today;
  return dayAfterOriginal > today ? dayAfterOriginal : today;
}

function messageForReason(reason, fallback) {
  const messages = {
    ineligible: 'This reviewer is no longer eligible for a deadline change. Reload the reviewer list.',
    not_found: 'This reviewer is no longer available. Reload the reviewer list.',
    original_due_date_missing: 'I could not find the original review deadline. Reload the reviewer list, and contact an administrator if the problem continues.',
    invalid_extension_date: 'Choose a date after the original deadline.',
    no_extension_to_restore: 'There is no extension to restore. Reload the reviewer list.',
    no_change: 'Choose a different deadline, or use Resend deadline email.',
    conflict: 'The reviewer changed while this dialog was open. Reload and try again.',
    misconfigured: 'I could not prepare the deadline email. No deadline was changed. Try again, and contact an administrator if the problem continues.',
    notification_unavailable: 'I am missing the reviewer or Program Director information needed for this email. No deadline was changed. Contact an administrator.',
    read_failed: 'I could not load the reviewer data. No deadline was changed. Try again, and contact an administrator if the problem continues.',
    save_failed: 'I could not save the extension. Reload the reviewer list and try again.',
    send_failed: 'I could not send the deadline email. Try the email again, and contact an administrator if the problem continues.',
    server_error: 'I could not complete the deadline update. Try again, and contact an administrator if the problem continues.',
  };
  return messages[reason] || fallback;
}

/**
 * Track Reviewers action for an accepted reviewer's operational due date.
 * Saving is one server-side workflow: preflight the notice, persist the date,
 * then dispatch the deadline email and stable-UID calendar update. Only an
 * actual dispatch failure produces partial success; retry/resend reads fresh
 * server state and performs no date write.
 */
export default function ReviewerDueDateEditor({
  suggestionId,
  reviewerName,
  overrideDate = null,
  effectiveDate = null,
  defaultDate = null,
  canManage = true,
  onSaved,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const [savedWithoutNotification, setSavedWithoutNotification] = useState(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const minimumDate = minimumExtensionDate(defaultDate);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const close = ({ refresh = savedWithoutNotification } = {}) => {
    generationRef.current += 1;
    setOpen(false);
    setDraft(overrideDate || '');
    setWorking(false);
    setError(null);
    setSavedWithoutNotification(false);
    if (refresh && onSaved) onSaved();
  };

  const submit = async ({ action = 'save', reviewDueDateOverride } = {}) => {
    const generation = ++generationRef.current;
    setWorking(true);
    setError(null);
    try {
      const body = action === 'retry'
        ? { action, suggestionId }
        : { action, suggestionId, reviewDueDateOverride };
      const response = await fetch('/api/review-manager/review-due-extension', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!mountedRef.current || generation !== generationRef.current) return;

      if (data.saved === true && data.notified === false) {
        setSavedWithoutNotification(true);
        setError('The deadline was saved, but the reviewer notification was not sent.');
        return;
      }
      if (!response.ok || !data.ok) {
        throw new Error(messageForReason(data.reason, data.error || 'The extension could not be saved.'));
      }
      setOpen(false);
      setSavedWithoutNotification(false);
      if (onSaved) onSaved();
    } catch (requestError) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      const detail = requestError.message || 'I could not complete the deadline update.';
      setError(savedWithoutNotification ? `The deadline is still saved. ${detail}` : detail);
    } finally {
      if (mountedRef.current && generation === generationRef.current) setWorking(false);
    }
  };

  const openModal = () => {
    setDraft(overrideDate || minimumDate);
    setError(null);
    setSavedWithoutNotification(false);
    setOpen(true);
  };

  const validDraft = isYmd(draft)
    && draft >= minimumDate
    && draft > defaultDate
    && draft !== overrideDate;

  return (
    <div className="text-xs">
      {overrideDate ? (
        <div className="space-y-0.5">
          <p className="font-medium text-gray-800">Extended: {formatDate(effectiveDate)}</p>
          <p className="text-gray-500">Original: {formatDate(defaultDate)}</p>
        </div>
      ) : (
        <p className="text-gray-600">Due: {formatDate(effectiveDate || defaultDate)}</p>
      )}

      {canManage && isYmd(defaultDate) && (
        <button
          type="button"
          onClick={openModal}
          className="mt-1 text-blue-700 hover:text-blue-900 hover:underline"
        >
          {overrideDate ? 'Change extension' : 'Grant extension'}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`review-extension-title-${suggestionId}`}
            className="w-full max-w-md rounded-xl bg-white p-5 text-left shadow-xl"
          >
            <h2 id={`review-extension-title-${suggestionId}`} className="text-lg font-semibold text-gray-900">
              {overrideDate ? 'Change extension' : 'Grant extension'}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {reviewerName ? `Reviewer: ${reviewerName}` : 'Reviewer deadline'}
            </p>

            <div className="mt-4 rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Original deadline</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{formatDate(defaultDate)}</p>
              {overrideDate && (
                <p className="mt-1 text-xs text-gray-500">Current extension: {formatDate(overrideDate)}</p>
              )}
            </div>

            <label className="mt-4 block text-sm font-medium text-gray-700" htmlFor={`review-extension-date-${suggestionId}`}>
              New deadline
            </label>
            <input
              id={`review-extension-date-${suggestionId}`}
              type="date"
              value={draft}
              min={minimumDate}
              onChange={(event) => setDraft(event.target.value)}
              disabled={working || savedWithoutNotification}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-2 text-xs text-gray-500">
              Saving automatically emails the reviewer and attaches the updated calendar date.
            </p>

            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p>{error}</p>
                {savedWithoutNotification && (
                  <button
                    type="button"
                    onClick={() => submit({ action: 'retry' })}
                    disabled={working}
                    className="mt-2 font-medium underline disabled:opacity-50"
                  >
                    {working ? 'Retrying…' : 'Retry email'}
                  </button>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {overrideDate && !savedWithoutNotification && (
                <button
                  type="button"
                  onClick={() => submit({ action: 'save', reviewDueDateOverride: null })}
                  disabled={working}
                  className="mr-auto rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 disabled:opacity-50"
                >
                  Restore original deadline
                </button>
              )}
              {overrideDate && !savedWithoutNotification && (
                <button
                  type="button"
                  onClick={() => submit({ action: 'retry' })}
                  disabled={working}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 disabled:opacity-50"
                >
                  {working ? 'Sending…' : 'Resend deadline email'}
                </button>
              )}
              <button
                type="button"
                onClick={() => close()}
                disabled={working}
                className="rounded-lg px-3 py-2 text-sm text-gray-600 disabled:opacity-50"
              >
                Close
              </button>
              {!savedWithoutNotification && (
                <button
                  type="button"
                  onClick={() => submit({ action: 'save', reviewDueDateOverride: draft })}
                  disabled={working || !validDraft}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {working ? 'Saving and sending…' : 'Save extension'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
