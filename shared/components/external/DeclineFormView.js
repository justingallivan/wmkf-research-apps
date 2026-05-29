/**
 * Decline form view — dispatcher state when reviewer clicks Decline on
 * Stage 2a. Same URL, dedicated page-level layout (not a modal) per locked
 * decision in the build plan §6.
 *
 * Field order: referral first, reason second (per design doc — referrals
 * are the most useful capture). All fields optional; submit-without-
 * filling-anything is supported.
 */

import { useState, useRef, useEffect } from 'react';

const DECLINE_REASONS = [
  { value: '', label: 'Select a reason (optional)' },
  { value: 'too-busy', label: 'Too busy' },
  { value: 'conflict-of-interest', label: 'Conflict of interest' },
  { value: 'outside-expertise', label: 'Outside my expertise' },
  { value: 'bad-timing', label: 'Bad timing' },
  { value: 'other', label: 'Other' },
];

export default function DeclineFormView({ token, etag, onCancel, onDeclined }) {
  const [referral, setReferral] = useState('');
  const [reasonPicklist, setReasonPicklist] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const headingRef = useRef(null);

  // Move screen-reader focus to the heading on view entry.
  useEffect(() => {
    if (headingRef.current) headingRef.current.focus();
  }, []);

  async function submitDeclineWith(decline) {
    setError(null);
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/external/review/${encodeURIComponent(token)}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Optimistic lock: round-trip the suggestion _etag from page load so
          // a concurrent staff edit is caught with a 412 (handled below).
          ...(etag ? { 'If-Match': etag } : {}),
        },
        body: JSON.stringify({ action: 'decline', decline }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) {
        if (resp.status === 409) {
          setError(json.message || 'This invitation can no longer be declined online. Please contact your Program Director.');
        } else if (resp.status === 412) {
          setError('Someone else updated this invitation while you were viewing it. Please refresh and try again.');
        } else {
          setError('Could not submit your response. Please try again.');
        }
        setSubmitting(false);
        return;
      }
      // Success — parent will refetch and switch view; component unmounts.
      await onDeclined();
    } catch (e) {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  // Primary submit: send whatever the reviewer typed.
  function submitDecline() {
    submitDeclineWith({
      referral: referral.trim() || undefined,
      reasonPicklist: reasonPicklist || undefined,
      reasonText: reasonText.trim() || undefined,
    });
  }

  // Secondary affordance: explicitly send an empty decline payload, even if
  // the reviewer typed something but then changed their mind. The label
  // ("Submit without explanation") promises that nothing they typed will be
  // submitted; this honors that promise.
  function submitDeclineEmpty() {
    submitDeclineWith({});
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 space-y-6">
      <div>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold text-gray-900 outline-none"
        >
          Sorry to hear you can't take this on
        </h2>
        <p className="text-sm text-gray-700 mt-2">
          Anything you can share helps us find a good replacement. None of these fields are required.
        </p>
      </div>

      <div>
        <label htmlFor="decline-referral" className="block text-sm font-semibold text-gray-900">
          Anyone you'd suggest instead?
        </label>
        <p className="text-xs text-gray-500 mt-1">
          Names, institutions, emails — whatever you have works. We'll follow up.
        </p>
        <textarea
          id="decline-referral"
          value={referral}
          onChange={(e) => setReferral(e.target.value)}
          rows={6}
          disabled={submitting}
          placeholder="e.g., Dr. Sarah Chen at Stanford works on similar problems and would be a great fit."
          className="mt-2 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:ring-0 disabled:bg-gray-50"
        />
      </div>

      <div>
        <label htmlFor="decline-reason" className="block text-sm font-semibold text-gray-900">
          Reason for declining
        </label>
        <select
          id="decline-reason"
          value={reasonPicklist}
          onChange={(e) => setReasonPicklist(e.target.value)}
          disabled={submitting}
          className="mt-2 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:ring-0 disabled:bg-gray-50 bg-white"
        >
          {DECLINE_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="decline-text" className="block text-sm font-semibold text-gray-900">
          Anything else? <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <textarea
          id="decline-text"
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          rows={3}
          disabled={submitting}
          className="mt-2 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:ring-0 disabled:bg-gray-50"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-sm text-gray-700 hover:text-gray-900 disabled:text-gray-400 underline-offset-2 hover:underline"
        >
          ← Back to invitation
        </button>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={submitDecline}
            disabled={submitting}
            className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-400"
          >
            {submitting ? 'Submitting…' : 'Submit decline'}
          </button>
          <button
            type="button"
            onClick={submitDeclineEmpty}
            disabled={submitting}
            className="text-xs text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline disabled:text-gray-300"
          >
            Submit without explanation
          </button>
        </div>
      </div>
    </div>
  );
}
