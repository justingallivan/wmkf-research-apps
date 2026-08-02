/**
 * Decline form view — dispatcher state when reviewer clicks Decline on
 * Stage 2a. Same URL, dedicated page-level layout (not a modal) per locked
 * decision in the build plan §6.
 *
 * Referrals are structured Name / Institution / Email rows (one expanding to
 * four), followed by an optional decline-reason picklist. The form does not
 * solicit prose. Submitting with no details remains supported.
 */

import { useState, useRef, useEffect } from 'react';
import {
  DECLINE_REFERRAL_LIMITS,
  MAX_DECLINE_REFERRALS,
  normalizeDeclineReferrals,
} from '../../utils/decline-referrals';

const DECLINE_REASONS = [
  { value: '', label: 'Select a reason (optional)' },
  { value: 'too-busy', label: 'Too busy' },
  { value: 'conflict-of-interest', label: 'Conflict of interest' },
  { value: 'outside-expertise', label: 'Outside my expertise' },
  { value: 'bad-timing', label: 'Bad timing' },
  { value: 'other', label: 'Other' },
];

export default function DeclineFormView({ token, etag, onCancel, onDeclined }) {
  const [referrals, setReferrals] = useState([{ name: '', institution: '', email: '' }]);
  const [reasonPicklist, setReasonPicklist] = useState('');
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

  function submitDecline() {
    const normalized = normalizeDeclineReferrals(referrals);
    if (!normalized.ok) {
      const messages = {
        decline_referral_name_required: 'Please include a name for each suggested reviewer.',
        invalid_decline_referral_email: 'Please enter a valid email address or leave it blank.',
        decline_referrals_too_long: 'Please shorten the suggested reviewer details.',
      };
      setError(messages[normalized.reason] || 'Please check the suggested reviewer details.');
      return;
    }
    submitDeclineWith({
      reasonPicklist: reasonPicklist || undefined,
      referrals: normalized.referrals.length ? normalized.referrals : undefined,
    });
  }

  function updateReferral(index, field, value) {
    setReferrals((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )));
  }

  function addReferral() {
    setReferrals((current) => (
      current.length >= MAX_DECLINE_REFERRALS
        ? current
        : [...current, { name: '', institution: '', email: '' }]
    ));
  }

  function removeReferral(index) {
    setReferrals((current) => current.filter((_, rowIndex) => rowIndex !== index));
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
          If you’d like, select a reason or suggest up to four alternative reviewers.
        </p>
      </div>

      <fieldset>
        <legend className="block text-sm font-semibold text-gray-900">
          Suggest another reviewer <span className="font-normal text-gray-500">(optional)</span>
        </legend>
        <p className="text-xs text-gray-500 mt-1">
          Use the person’s published name without degrees or titles. Institution and email are optional.
        </p>
        <div className="mt-3 space-y-3">
          {referrals.map((referral, index) => (
            <div key={index} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-semibold text-gray-700">Reviewer {index + 1}</p>
                {referrals.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeReferral(index)}
                    disabled={submitting}
                    className="text-xs text-gray-500 hover:text-gray-800 disabled:text-gray-300"
                    aria-label={`Remove suggested reviewer ${index + 1}`}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor={`decline-referral-name-${index}`} className="block text-xs font-medium text-gray-700">
                    Name as published
                  </label>
                  <input
                    id={`decline-referral-name-${index}`}
                    value={referral.name}
                    onChange={(e) => updateReferral(index, 'name', e.target.value)}
                    maxLength={DECLINE_REFERRAL_LIMITS.name}
                    disabled={submitting}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:ring-0 disabled:bg-gray-50"
                  />
                </div>
                <div>
                  <label htmlFor={`decline-referral-institution-${index}`} className="block text-xs font-medium text-gray-700">
                    Institution
                  </label>
                  <input
                    id={`decline-referral-institution-${index}`}
                    value={referral.institution}
                    onChange={(e) => updateReferral(index, 'institution', e.target.value)}
                    maxLength={DECLINE_REFERRAL_LIMITS.institution}
                    disabled={submitting}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:ring-0 disabled:bg-gray-50"
                  />
                </div>
                <div>
                  <label htmlFor={`decline-referral-email-${index}`} className="block text-xs font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    id={`decline-referral-email-${index}`}
                    type="email"
                    value={referral.email}
                    onChange={(e) => updateReferral(index, 'email', e.target.value)}
                    maxLength={DECLINE_REFERRAL_LIMITS.email}
                    disabled={submitting}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:ring-0 disabled:bg-gray-50"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        {referrals.length < MAX_DECLINE_REFERRALS && (
          <button
            type="button"
            onClick={addReferral}
            disabled={submitting}
            className="mt-3 text-sm font-medium text-gray-700 hover:text-gray-950 underline-offset-2 hover:underline disabled:text-gray-400"
          >
            + Add another reviewer
          </button>
        )}
      </fieldset>

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
        <button
          type="button"
          onClick={submitDecline}
          disabled={submitting}
          className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-400"
        >
          {submitting ? 'Submitting…' : 'Submit decline'}
        </button>
      </div>
    </div>
  );
}
