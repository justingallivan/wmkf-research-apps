/**
 * Final Writeup — group-review entry and Word launcher.
 *
 * This surface never edits the document in-browser. It starts the governed
 * transition and opens the same stable SharePoint Word item in a separate tab.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 10;

async function fetchStatus(requestId, signal) {
  const response = await fetch(
    `/api/workbench/final-writeup?requestId=${encodeURIComponent(requestId)}`,
    { method: 'GET', signal },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Final Writeup status failed (${response.status})`);
  return body;
}

function waitForPoll(signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, POLL_INTERVAL_MS);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      const error = new Error('Status check aborted.');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
}

function formatStartedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export default function FinalWriteupTab({ requestId }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const activeController = useRef(null);
  const cancelButtonRef = useRef(null);
  const confirmButtonRef = useRef(null);

  const load = useCallback(async (signal) => {
    if (!requestId) return null;
    const next = await fetchStatus(requestId, signal);
    setStatus(next);
    return next;
  }, [requestId]);

  useEffect(() => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setStatus(null);
    setError(null);
    setLoading(Boolean(requestId));
    if (requestId) {
      load(controller.signal)
        .catch((loadError) => {
          if (loadError?.name !== 'AbortError') setError(loadError.message);
        })
        .finally(() => {
          if (activeController.current === controller) setLoading(false);
        });
    }
    return () => controller.abort();
  }, [requestId, load]);

  useEffect(() => {
    if (!confirming) return undefined;
    const previous = document.activeElement;
    confirmButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !starting) setConfirming(false);
      if (event.key === 'Tab') {
        const first = cancelButtonRef.current;
        const last = confirmButtonRef.current;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [confirming, starting]);

  const pollUntilReady = async (controller) => {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const next = await load(controller.signal);
      if (next?.phase === 'group-review') return next;
      if (attempt < POLL_ATTEMPTS - 1) await waitForPoll(controller.signal);
    }
    throw new Error('The transition is still running. Reload this tab in a moment.');
  };

  const start = async () => {
    if (!requestId || !status?.sourceArtifactId || starting) return;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setStarting(true);
    setError(null);
    try {
      const response = await fetch('/api/workbench/final-writeup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          expectedArtifactId: status.sourceArtifactId,
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Final Writeup transition failed (${response.status})`);
      setConfirming(false);
      if (response.status === 202 || body.inProgress) {
        setStatus((current) => ({ ...current, phase: 'starting' }));
        await pollUntilReady(controller);
      } else {
        setStatus({
          available: true,
          phase: 'group-review',
          canStart: false,
          sourceArtifactId: status.sourceArtifactId,
          artifact: body.artifact,
        });
      }
    } catch (startError) {
      if (startError?.name !== 'AbortError') setError(startError.message);
    } finally {
      if (activeController.current === controller) {
        activeController.current = null;
        setStarting(false);
      }
    }
  };

  const artifact = status?.artifact || null;
  const startedAt = formatStartedAt(artifact?.groupReview?.startedAt);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              activeController.current?.abort();
              const controller = new AbortController();
              activeController.current = controller;
              setError(null);
              setLoading(true);
              load(controller.signal)
                .catch((loadError) => {
                  if (loadError?.name !== 'AbortError') setError(loadError.message);
                })
                .finally(() => setLoading(false));
            }}
            className="mt-2 font-medium underline decoration-red-300 underline-offset-4 hover:decoration-red-700 focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2"
          >
            Try again
          </button>
        </div>
      )}

      <Card hover={false}>
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">Final Writeup</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            Group review continues in the same Word document from Staff Deliberations.
          </p>
        </div>

        {loading && !status ? (
          <div className="mt-6 rounded-xl bg-gray-50 p-5 text-sm text-gray-600" role="status">
            Checking the writeup stage…
          </div>
        ) : status?.available === false ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <h3 className="font-semibold">Final Writeup setup is not active</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6">
              This stage is not available yet. Setup must be completed before staff can start group review.
            </p>
          </div>
        ) : status?.phase === 'group-review' && artifact ? (
          <div className="mt-6 flex flex-col gap-5 rounded-xl border border-green-200 bg-green-50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <span className="inline-flex rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-900">
                Group review
              </span>
              <h3 className="mt-3 text-lg font-semibold text-gray-900">Final Writeup is ready</h3>
              <p className="mt-1 text-sm leading-6 text-gray-700">
                {startedAt ? `Started ${startedAt}. ` : ''}
                Word opens separately so staff can co-author in its normal window.
              </p>
              {artifact.file?.name && (
                <p className="mt-2 text-xs text-gray-600">{artifact.file.name}</p>
              )}
            </div>
            <a
              href={artifact.file?.webUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
            >
              Edit writeup
            </a>
          </div>
        ) : status?.phase === 'starting' ? (
          <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950" role="status">
            Recording the current Word version and starting group review…
          </div>
        ) : status?.phase === 'ready' ? (
          <div className="mt-6 flex flex-col gap-5 rounded-xl border border-gray-200 bg-gray-50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <h3 className="text-lg font-semibold text-gray-900">Ready for group review</h3>
              <p className="mt-1 text-sm leading-6 text-gray-600">
                This records the document’s current Word version and turns off Pre-Site regeneration.
              </p>
              {status.sourceFile?.name && (
                <p className="mt-2 text-xs text-gray-500">{status.sourceFile.name}</p>
              )}
              {!status.canStart && (
                <p className="mt-3 text-sm font-medium text-amber-800">
                  Only the lead Program Director or a superuser can start this stage.
                </p>
              )}
            </div>
            {status.canStart && (
              <button
                type="button"
                disabled={starting}
                onClick={() => setConfirming(true)}
                className="min-h-11 shrink-0 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Ready for group review
              </button>
            )}
          </div>
        ) : null}
      </Card>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="final-writeup-confirm-title"
            aria-describedby="final-writeup-confirm-description"
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 id="final-writeup-confirm-title" className="text-xl font-semibold tracking-tight text-gray-900">
              Start group review?
            </h3>
            <div id="final-writeup-confirm-description" className="mt-3 space-y-2 text-sm leading-6 text-gray-700">
              <p>The current Word version becomes the starting point for group review.</p>
              <p>The SharePoint file stays the same. Pre-Site regeneration will no longer be available.</p>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                ref={cancelButtonRef}
                type="button"
                disabled={starting}
                onClick={() => setConfirming(false)}
                className="min-h-11 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-700 focus:ring-offset-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                disabled={starting}
                onClick={start}
                className="min-h-11 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:opacity-50"
              >
                {starting ? 'Starting…' : 'Ready for group review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
