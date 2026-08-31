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
const ACKNOWLEDGEMENT_SCHEMA_NOT_READY = 'final_writeup_acknowledgement_schema_not_ready';

async function fetchStatus(requestId, signal) {
  const response = await fetch(
    `/api/workbench/final-writeup?requestId=${encodeURIComponent(requestId)}`,
    { method: 'GET', signal },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Final Writeup status failed (${response.status})`);
  return body;
}

async function fetchAcknowledgementState(requestId, signal) {
  const response = await fetch(
    `/api/workbench/final-writeup/acknowledgement?requestId=${encodeURIComponent(requestId)}`,
    { method: 'GET', signal },
  );
  const body = await response.json().catch(() => ({}));
  if (response.status === 503 && body.code === ACKNOWLEDGEMENT_SCHEMA_NOT_READY) {
    return { available: false };
  }
  if (!response.ok) {
    throw new Error(body.error || `Final Writeup review status failed (${response.status})`);
  }
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

function formatReviewDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function personalReviewPresentation(state) {
  if (state === 'unreviewed') {
    return {
      label: 'Needs review',
      detail: 'Open the writeup, then return here to record that you reviewed this version.',
      action: 'Mark reviewed',
      tone: 'gray',
    };
  }
  if (state === 'reviewed') {
    return {
      label: 'Reviewed',
      detail: 'You reviewed the current version.',
      action: null,
      tone: 'green',
    };
  }
  if (state === 'updated') {
    return {
      label: 'Updated since your review',
      detail: 'The writeup has a newer version. Review the latest changes before updating your mark.',
      action: 'Mark latest version reviewed',
      tone: 'amber',
    };
  }
  return null;
}

function ReviewerInitial({ reviewer }) {
  const name = reviewer.name || 'Reviewer';
  const reviewedAt = formatReviewDate(reviewer.acknowledgedAt);
  const freshness = reviewer.state === 'updated'
    ? 'The writeup has changed since this review.'
    : 'Reviewed the current version.';
  const description = `${name}. ${reviewedAt ? `Reviewed ${reviewedAt}. ` : ''}${freshness}`;

  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-label={description}
        className="inline-flex size-11 items-center justify-center rounded-full border border-gray-300 bg-gray-100 text-xs font-semibold text-gray-700 outline-none transition-colors hover:border-gray-400 hover:bg-gray-200 focus:ring-2 focus:ring-gray-800 focus:ring-offset-2"
      >
        {reviewer.initials || 'R'}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full start-1/2 z-10 mb-2 w-max max-w-64 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-5 text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <span className="block font-semibold">{name}</span>
        {reviewedAt && <span className="block text-gray-200">Reviewed {reviewedAt}</span>}
        {reviewer.state === 'updated' && (
          <span className="block text-amber-200">Updated since this review</span>
        )}
      </span>
    </span>
  );
}

export default function FinalWriteupTab({ requestId }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState(null);
  const [acknowledgementLoading, setAcknowledgementLoading] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [acknowledgementError, setAcknowledgementError] = useState(null);
  const [acknowledgementReload, setAcknowledgementReload] = useState(0);
  const activeController = useRef(null);
  const acknowledgementController = useRef(null);
  const cancelButtonRef = useRef(null);
  const confirmButtonRef = useRef(null);

  const load = useCallback(async (signal) => {
    if (!requestId) return null;
    return fetchStatus(requestId, signal);
  }, [requestId]);

  useEffect(() => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    acknowledgementController.current?.abort();
    acknowledgementController.current = null;
    setStatus(null);
    setError(null);
    setAcknowledgement(null);
    setAcknowledgementError(null);
    setAcknowledgementLoading(false);
    setAcknowledging(false);
    setLoading(Boolean(requestId));
    if (requestId) {
      load(controller.signal)
        .then((next) => {
          if (activeController.current === controller) setStatus(next);
        })
        .catch((loadError) => {
          if (activeController.current === controller && loadError?.name !== 'AbortError') {
            setError(loadError.message);
          }
        })
        .finally(() => {
          if (activeController.current === controller) setLoading(false);
        });
    }
    return () => {
      controller.abort();
      acknowledgementController.current?.abort();
    };
  }, [requestId, load]);

  const acknowledgementArtifactId = status?.phase === 'group-review'
    ? status?.artifact?.artifactId || null
    : null;

  useEffect(() => {
    acknowledgementController.current?.abort();
    const controller = new AbortController();
    acknowledgementController.current = controller;
    setAcknowledgement(null);
    setAcknowledgementError(null);
    setAcknowledgementLoading(Boolean(requestId && acknowledgementArtifactId));
    setAcknowledging(false);

    if (requestId && acknowledgementArtifactId) {
      fetchAcknowledgementState(requestId, controller.signal)
        .then((next) => {
          if (acknowledgementController.current !== controller) return;
          if (next.available !== false && next.finalArtifactId !== acknowledgementArtifactId) {
            throw new Error('The current Final Writeup changed. Reload this tab before recording review.');
          }
          setAcknowledgement(next);
        })
        .catch((loadError) => {
          if (acknowledgementController.current === controller
            && loadError?.name !== 'AbortError') {
            setAcknowledgementError(loadError.message);
          }
        })
        .finally(() => {
          if (acknowledgementController.current === controller) {
            setAcknowledgementLoading(false);
          }
        });
    }

    return () => controller.abort();
  }, [requestId, acknowledgementArtifactId, acknowledgementReload]);

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
      if (activeController.current !== controller) return null;
      setStatus(next);
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
      if (activeController.current !== controller) return;
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
      if (activeController.current === controller && startError?.name !== 'AbortError') {
        setError(startError.message);
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = null;
        setStarting(false);
      }
    }
  };

  const markReviewed = async () => {
    if (!requestId
      || !acknowledgementArtifactId
      || !acknowledgement?.mayAcknowledge
      || acknowledging) return;
    acknowledgementController.current?.abort();
    const controller = new AbortController();
    acknowledgementController.current = controller;
    setAcknowledging(true);
    setAcknowledgementError(null);
    try {
      const response = await fetch('/api/workbench/final-writeup/acknowledgement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          expectedFinalArtifactId: acknowledgementArtifactId,
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 503 && body.code === ACKNOWLEDGEMENT_SCHEMA_NOT_READY) {
        if (acknowledgementController.current === controller) {
          setAcknowledgement({ available: false });
        }
        return;
      }
      if (!response.ok) {
        throw new Error(body.error || `Final Writeup review update failed (${response.status})`);
      }
      if (acknowledgementController.current !== controller) return;
      if (body.finalArtifactId !== acknowledgementArtifactId) {
        throw new Error('The current Final Writeup changed. Reload this tab before recording review.');
      }
      setAcknowledgement(body);
    } catch (reviewError) {
      if (acknowledgementController.current === controller
        && reviewError?.name !== 'AbortError') {
        setAcknowledgementError(reviewError.message);
      }
    } finally {
      if (acknowledgementController.current === controller) {
        setAcknowledging(false);
      }
    }
  };

  const artifact = status?.artifact || null;
  const startedAt = formatStartedAt(artifact?.groupReview?.startedAt);
  const lastUpdated = formatReviewDate(acknowledgement?.publicationLastModified);
  const personalReviewedAt = formatReviewDate(acknowledgement?.acknowledgedAt);
  const personalReview = personalReviewPresentation(acknowledgement?.personalState);
  const reviewers = Array.isArray(acknowledgement?.reviewers)
    ? acknowledgement.reviewers
    : [];

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
                .then((next) => {
                  if (activeController.current === controller) setStatus(next);
                })
                .catch((loadError) => {
                  if (activeController.current === controller
                    && loadError?.name !== 'AbortError') {
                    setError(loadError.message);
                  }
                })
                .finally(() => {
                  if (activeController.current === controller) {
                    activeController.current = null;
                    setLoading(false);
                  }
                });
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
          <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 max-w-2xl">
                <span className="inline-flex rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-900">
                  Group review
                </span>
                <h3 className="mt-3 text-lg font-semibold text-gray-900">Final Writeup is ready</h3>
                <p className="mt-1 text-sm leading-6 text-gray-700">
                  {startedAt ? `Started ${startedAt}. ` : ''}
                  Word opens separately so staff can co-author in its normal window.
                </p>
                {lastUpdated && (
                  <p className="mt-2 text-xs font-medium text-gray-600">Last updated {lastUpdated}</p>
                )}
                {artifact.file?.name && (
                  <p className="mt-1 break-words text-xs text-gray-600">{artifact.file.name}</p>
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

            {(acknowledgementLoading
              || acknowledgementError
              || acknowledgement?.available === true) && (
              <div className="mt-5 border-t border-green-200 pt-5">
                {acknowledgementLoading ? (
                  <p className="text-sm text-gray-600" role="status">Checking review activity…</p>
                ) : acknowledgementError ? (
                  <div className="text-sm text-red-800" role="alert">
                    <p>Review tracking could not be loaded. The writeup is still available.</p>
                    <p className="mt-1 text-xs text-red-700">{acknowledgementError}</p>
                    <button
                      type="button"
                      onClick={() => setAcknowledgementReload((value) => value + 1)}
                      className="mt-2 font-semibold underline decoration-red-300 underline-offset-4 hover:decoration-red-700 focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2"
                    >
                      Try review tracking again
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-gray-900">Reviewed by</h4>
                      {reviewers.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2" aria-label="Review participants">
                          {reviewers.map((reviewer) => (
                            <ReviewerInitial key={reviewer.reviewerId} reviewer={reviewer} />
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-sm text-gray-600">No reviews recorded yet.</p>
                      )}
                    </div>

                    {acknowledgement.mayAcknowledge && (
                      <div className="max-w-md sm:text-end" aria-live="polite">
                        {personalReview ? (
                          <>
                            <p className={`text-sm font-semibold ${
                              personalReview.tone === 'green'
                                ? 'text-green-800'
                                : personalReview.tone === 'amber'
                                  ? 'text-amber-800'
                                  : 'text-gray-900'
                            }`}>
                              {personalReview.label}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-gray-600">
                              {personalReview.detail}
                              {acknowledgement.personalState === 'reviewed' && personalReviewedAt
                                ? ` Recorded ${personalReviewedAt}.`
                                : ''}
                            </p>
                            {personalReview.action && (
                              <button
                                type="button"
                                disabled={acknowledging}
                                onClick={markReviewed}
                                className="mt-3 min-h-11 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {acknowledging ? 'Recording review…' : personalReview.action}
                              </button>
                            )}
                          </>
                        ) : (
                          <p className="text-sm font-medium text-red-800" role="alert">
                            Review tracking returned an unsupported state. Try again before recording review.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
