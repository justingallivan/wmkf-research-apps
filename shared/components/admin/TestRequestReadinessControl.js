import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../utils/api-request';
import { messageFor } from './test-request-factory-copy';
import { buttonProps, focusAndShow } from './test-request-factory-ui';

/**
 * "Mark ready for review" for a prepared J27+ test Request (owner, 2026-11-15).
 * Readiness is what makes a J27 Research request appear in the Workbench. The
 * server (POST .../readiness) runs the owner CLI's checks and sends one
 * journaled PATCH; a "check again" answer resumes the same attempt and never
 * sends twice. Readiness cannot be set back to false, so the action asks first.
 *
 * `readiness` and `current` come from the status GET; `onChanged(scope)` reloads it.
 * The enablement below mirrors the server's own refusals (required status pair,
 * no open status change, stored manifest), which the server still enforces.
 */
function Reason({ id, children }) {
  return <p id={id} className="text-sm text-gray-600">{children}</p>;
}

export default function TestRequestReadinessControl({
  run, readiness, current, statusChangeOpen, writeBlock, liveScope, onChanged,
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const questionRef = useRef(null);
  const resultRef = useRef(null);

  useEffect(() => { if (confirming) focusAndShow(questionRef.current); }, [confirming]);
  useEffect(() => { if (result) focusAndShow(resultRef.current); }, [result]);

  if (!readiness || readiness.applies === false) return null;
  if (readiness.unavailable) {
    return (
      <section aria-labelledby="factory-readiness-heading" className="space-y-2 border-t border-gray-200 pt-5">
        <h4 id="factory-readiness-heading" className="text-sm font-semibold text-gray-950">Ready for review</h4>
        <p className="text-sm text-gray-600">Readiness couldn't be checked just now. Reload the run to try again.</p>
      </section>
    );
  }
  const requestName = run.destinationRequestNumber ? `Request ${run.destinationRequestNumber}` : 'this test Request';
  const done = readiness.ready === true && readiness.attemptStatus === 'complete';
  // Sent but not finished: the same POST resumes it without another PATCH.
  const resumable = readiness.attemptStatus === 'dispatched' || readiness.attemptStatus === 'applied';

  async function send() {
    const scope = liveScope();
    setBusy(true);
    setResult(null);
    setConfirming(false);
    try {
      const reply = await requestJson(`/api/admin/test-requests/runs/${run.runId}/readiness`, {
        method: 'POST', signal: scope.signal, fallbackMessage: 'The readiness change could not be sent.',
      });
      if (!scope.alive()) return;
      setResult(reply.outcome === 'complete'
        ? { tone: 'green', text: `${requestName} is ready for review. It now appears in the Workbench.` }
        : { tone: 'amber', text: reply.message });
      await onChanged(scope);
    } catch (error) {
      if (!scope.alive() || error?.name === 'AbortError') return;
      setResult({ tone: 'red', text: messageFor(error) });
      await onChanged(scope);
    } finally {
      if (scope.alive()) setBusy(false);
    }
  }

  const reason = (() => {
    if (writeBlock) return writeBlock;
    if (busy) return 'Waiting for the last request to finish.';
    if (readiness.attemptStatus === 'needs_attention') return 'The last attempt needs the owner to inspect it from the command-line tool before anything else is sent.';
    if (!readiness.manifestStored) return "This run's stored files are gone, so the form can't check it. The owner can mark it ready from the command-line tool with the downloaded manifest.";
    if (resumable) return '';
    if (statusChangeOpen) return 'Finish the open status change first.';
    if (current?.phase1 !== readiness.requiredPair.phase1 || current?.phase2 !== readiness.requiredPair.phase2) {
      return 'Set Phase I to Invited, then Phase II to Phase II Pending Committee Review, first.';
    }
    if (readiness.ready === true) return 'This Request was marked ready outside this form; the owner inspects it from the command-line tool.';
    return '';
  })();

  const tones = {
    green: 'border-green-200 bg-green-50 text-green-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-900',
  };

  return (
    <section aria-labelledby="factory-readiness-heading" className="space-y-3 border-t border-gray-200 pt-5">
      <h4 id="factory-readiness-heading" className="text-sm font-semibold text-gray-950">Ready for review</h4>
      {result ? (
        <div ref={resultRef} tabIndex={-1} role="status" className={`rounded-lg border px-4 py-3 text-sm focus:outline-none ${tones[result.tone]}`}>{result.text}</div>
      ) : null}
      {done ? (
        result ? null : <p className="text-sm text-gray-800">{requestName} is ready for review and appears in the Workbench.</p>
      ) : confirming ? (
        <div role="group" aria-label="Confirm marking ready for review" className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-sm leading-6 text-gray-900">
          <p ref={questionRef} tabIndex={-1} className="font-semibold focus:outline-none">Mark {requestName} ready for review on Production?</p>
          <p className="mt-1">It will appear in the Workbench for staff. This can't be undone: readiness can't be set back from here or the command-line tool.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" {...buttonProps(true)} disabled={Boolean(reason)} onClick={send}>Yes, mark it ready</button>
            <button type="button" {...buttonProps(false)} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            {...buttonProps(true)}
            disabled={Boolean(reason)}
            aria-describedby="factory-readiness-reason"
            onClick={resumable ? send : () => setConfirming(true)}
          >
            {resumable ? 'Check again' : 'Mark ready for review'}
          </button>
          {reason ? <Reason id="factory-readiness-reason">{reason}</Reason> : null}
        </div>
      )}
    </section>
  );
}
