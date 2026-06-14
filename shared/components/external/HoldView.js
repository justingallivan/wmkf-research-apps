/**
 * Hold view — the pre-accept "agree in principle" screen, shown when a proposal
 * is NOT yet released to reviewers (readiness gate). Two sub-states:
 *
 *   ask (confirmed=false, dispatcher view 'hold-invite') — the lightweight
 *     "will you review?" ask. [Hold my spot] POSTs action:'hold'; [Decline]
 *     routes to the shared decline form.
 *   confirmed (confirmed=true, dispatcher view 'held') — the sit-tight screen
 *     after a hold: "you're on the slate; we'll send proposals + a calendar hold
 *     when they're ready." Offers a flip-to-decline while still pre-materials.
 *
 * No proposal materials are shown here — the reviewer hasn't seen (or committed
 * to) the proposal yet; that's the whole point of the hold. Finalize (COI/AI
 * acks + payment) happens later via Stage2aView once the proposal is released.
 */

import { useState, useRef, useEffect } from 'react';

// meetingDate is a 'YYYY-MM-DD' panel date. Show month + year only — the precise
// review window rides on the .ics (chunk 5); here it's just context, and
// month/year avoids day-level timezone drift from parsing a bare date string.
function formatMonthYear(meetingDate) {
  if (!meetingDate) return null;
  const d = new Date(meetingDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// heldAt is a full ISO datetime; show a friendly day for the "held on" confirmation.
function formatHeldDate(heldAt) {
  if (!heldAt) return null;
  const d = new Date(heldAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export default function HoldView({ data, token, confirmed, onRequestDecline, onHeld }) {
  const proposal = data.proposal || {};
  const etag = data.etag;
  const canFlipState = data.engagementState?.canFlipState;
  const heldOn = formatHeldDate(data.engagementState?.heldAt);
  const meetingWindow = formatMonthYear(proposal.meetingDate);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const headingRef = useRef(null);

  useEffect(() => {
    if (headingRef.current) headingRef.current.focus();
  }, []);

  async function submitHold() {
    setError(null);
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/external/review/${encodeURIComponent(token)}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Optimistic lock: round-trip the suggestion _etag from page load.
          ...(etag ? { 'If-Match': etag } : {}),
        },
        body: JSON.stringify({ action: 'hold' }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) {
        if (resp.status === 409 && json.reason === 'already_released') {
          setError('This proposal is now ready for review. Please refresh the page to continue.');
        } else if (resp.status === 409) {
          setError(json.message || 'This invitation can no longer be held online. Please contact your Program Director.');
        } else if (resp.status === 412) {
          setError('Someone else updated this invitation while you were viewing it. Please refresh and try again.');
        } else {
          setError('Could not save your response. Please try again.');
        }
        setSubmitting(false);
        return;
      }
      // Success — parent refetches and re-renders as the 'held' confirmed view.
      await onHeld();
    } catch (e) {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  // ── Confirmed (post-hold) ────────────────────────────────────────────────
  if (confirmed) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 space-y-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-blue-700 font-semibold">You're on the slate</p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold text-gray-900 mt-1 outline-none"
          >
            Thank you — your spot is held.
          </h2>
        </div>

        <div className="space-y-3 text-sm text-gray-700">
          <p>
            You've agreed in principle to review for the
            {meetingWindow ? ` ${meetingWindow}` : ''} panel{heldOn ? `, held on ${heldOn}` : ''}.
            There's nothing more to do right now.
          </p>
          <p>
            When the proposal is ready, we'll email you the materials and a calendar
            hold, and ask you to confirm the final details (conflict-of-interest and
            AI-use acknowledgements, and how you'd like any honorarium handled).
          </p>
          <p>
            If anything changes before then, please reach out to your Program Director.
          </p>
        </div>

        {canFlipState && (
          <div className="pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">Need to step back?</p>
            <button
              type="button"
              onClick={onRequestDecline}
              className="text-sm text-gray-700 underline-offset-2 hover:underline mt-1"
            >
              Switch to declining this invitation
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Ask (lightweight invitation) ─────────────────────────────────────────
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Invitation to review</p>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold text-gray-900 mt-1 outline-none"
        >
          Would you be willing to review for us?
        </h2>
      </div>

      <div className="space-y-3 text-sm text-gray-700">
        <p>
          We're lining up reviewers for the{meetingWindow ? ` ${meetingWindow}` : ''} panel and
          would love your help. The proposals aren't quite ready yet — so for now we're
          just asking you to <strong>hold your spot</strong>.
        </p>
        <p>
          No commitment to specifics today: you won't see proposal materials, and the
          conflict-of-interest / AI-use acknowledgements and honorarium details all come
          later, once the proposal is released. We'll email you then with everything you
          need and a calendar hold.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onRequestDecline}
          disabled={submitting}
          className="text-sm text-gray-700 hover:text-gray-900 disabled:text-gray-400 underline-offset-2 hover:underline"
        >
          I can't this time
        </button>
        <button
          type="button"
          onClick={submitHold}
          disabled={submitting}
          className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-400"
        >
          {submitting ? 'Saving…' : 'Hold my spot'}
        </button>
      </div>
    </div>
  );
}
