/**
 * Post-accept confirmation view — terminal screen shown after a successful
 * accept (or when the reviewer returns to a previously-accepted engagement
 * before materials have been sent). Since D46/D49 the acceptance job emails
 * the materials link within minutes and re-mints the reviewer's link, so the
 * copy points the reviewer to that email (draft wording; owner review in
 * PR #562).
 */

import { useEffect, useRef } from 'react';
import ProgramDirectorContact from './ProgramDirectorContact';

export default function AcceptedConfirmationView({
  programDirector = null,
  onRequestDecline,
  showWithdrawalOption = true,
}) {
  const headingRef = useRef(null);

  useEffect(() => {
    if (headingRef.current) headingRef.current.focus();
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-green-700 font-semibold">Confirmed</p>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold text-gray-900 mt-1 outline-none"
        >
          Thank you. You're confirmed as a reviewer.
        </h2>
      </div>

      <div className="space-y-3 text-sm text-gray-700">
        <p>
          We'll email you a link to the proposal and the review form, usually
          within a few minutes. Please use the link in that email from then
          on; the link you used to reach this page may stop working. If the
          email hasn't arrived by the next business day, please let your
          Program Director know.
        </p>
        <p>
          If something changes — calendar conflict, conflict of interest you
          spotted, anything — please let us know as soon as you can.
          {showWithdrawalOption
            ? ' You can change your response below, or reach out to your Program Director'
            : ' Use the secure link in your confirmation email, or reach out to your Program Director'}
          <ProgramDirectorContact programDirector={programDirector} />.
        </p>
      </div>

      {showWithdrawalOption && onRequestDecline && (
        <div className="pt-4 border-t border-gray-100 space-y-2">
          <p className="text-sm font-medium text-gray-700">
            Need to change your response?
          </p>
          <p className="text-xs text-gray-500">
            If you can no longer complete the review, you can withdraw and suggest alternate reviewers.
          </p>
          <button
            type="button"
            onClick={onRequestDecline}
            className="text-sm font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2"
          >
            I can no longer review
          </button>
        </div>
      )}

    </div>
  );
}
