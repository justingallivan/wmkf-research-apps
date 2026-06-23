/**
 * Post-accept confirmation view — terminal screen shown after a successful
 * accept (or when the reviewer returns to a previously-accepted engagement
 * before materials have been sent).
 */

import { useEffect, useRef } from 'react';

export default function AcceptedConfirmationView() {
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
          We'll email you when the proposal materials are available. Until then,
          you can return to this page any time using the original link.
        </p>
        <p>
          If something changes — calendar conflict, conflict of interest you
          spotted, anything — please reach out to your Program Director rather
          than waiting until materials are released.
        </p>
      </div>

    </div>
  );
}
