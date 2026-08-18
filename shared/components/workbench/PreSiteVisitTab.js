import { useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';
import {
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../config/requestDocument';

const STATUS_POLL_INTERVAL_MS = 3000;
const STATUS_POLL_ATTEMPTS = 20;

async function readArtifactStatus(requestId, signal) {
  const response = await fetch(
    `/api/workbench/pre-site-visit?requestId=${encodeURIComponent(requestId)}`,
    { method: 'GET', signal },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Status check failed (${response.status})`);
  return body;
}

function waitForNextPoll(signal) {
  if (signal.aborted) {
    const error = new Error('Status check aborted.');
    error.name = 'AbortError';
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error('Status check aborted.');
      error.name = 'AbortError';
      reject(error);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, STATUS_POLL_INTERVAL_MS);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export default function PreSiteVisitTab({ requestId, onSelectTab }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [artifact, setArtifact] = useState(null);
  const [pendingArtifact, setPendingArtifact] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [startingSiteVisit, setStartingSiteVisit] = useState(false);
  const [siteVisitError, setSiteVisitError] = useState(null);
  const generationSequence = useRef(0);
  const activeController = useRef(null);
  const startButtonRef = useRef(null);
  const cancelStartButtonRef = useRef(null);
  const confirmStartButtonRef = useRef(null);

  useEffect(() => {
    generationSequence.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    setGenerating(false);
    setError(null);
    setArtifact(null);
    setPendingArtifact(null);
    setRecoveryMessage(null);
    setShowHelp(false);
    setShowStartModal(false);
    setStartingSiteVisit(false);
    setSiteVisitError(null);
    const id = requestId;
    if (id) {
      const sequence = generationSequence.current;
      const controller = new AbortController();
      activeController.current = controller;
      setCheckingStatus(true);
      readArtifactStatus(id, controller.signal)
        .then((status) => {
          if (generationSequence.current !== sequence || id !== requestId) return;
          setArtifact(status.currentArtifact || null);
          setPendingArtifact(status.pendingArtifact || null);
          if (status.pendingArtifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED) {
            setError(status.pendingArtifact.lastError?.message || 'The latest Word-draft attempt failed.');
          }
        })
        .catch((statusError) => {
          if (statusError?.name !== 'AbortError'
            && generationSequence.current === sequence
            && id === requestId) {
            setError(statusError.message);
          }
        })
        .finally(() => {
          if (generationSequence.current === sequence && id === requestId) {
            if (activeController.current === controller) activeController.current = null;
            setCheckingStatus(false);
          }
        });
    }
    return () => {
      generationSequence.current += 1;
      activeController.current?.abort();
      activeController.current = null;
    };
  }, [requestId]);

  useEffect(() => {
    if (!showStartModal) return undefined;
    const previouslyFocused = document.activeElement;
    confirmStartButtonRef.current?.focus();
    const handleModalKey = (event) => {
      if (event.key === 'Escape' && !startingSiteVisit) {
        setShowStartModal(false);
        setSiteVisitError(null);
      }
      if (event.key === 'Tab') {
        const first = cancelStartButtonRef.current;
        const last = confirmStartButtonRef.current;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleModalKey);
    return () => {
      document.removeEventListener('keydown', handleModalKey);
      if (previouslyFocused?.focus) previouslyFocused.focus();
    };
  }, [showStartModal, startingSiteVisit]);

  const pollForArtifact = async ({ id, sequence, controller, targetArtifactId, baselineArtifactId }) => {
    for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt += 1) {
      const status = await readArtifactStatus(id, controller.signal);
      if (generationSequence.current !== sequence || id !== requestId) {
        const stale = new Error('Status check aborted.');
        stale.name = 'AbortError';
        throw stale;
      }
      const current = status.currentArtifact || null;
      const pending = status.pendingArtifact || null;
      if (current) setArtifact(current);
      setPendingArtifact(pending);

      if (pending?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED) {
        throw new Error(pending.lastError?.message || 'The latest Word-draft attempt failed.');
      }
      if (targetArtifactId && current?.artifactId === targetArtifactId) return current;
      if (!targetArtifactId && current && (
        !baselineArtifactId || current.artifactId !== baselineArtifactId
      )) return current;

      if (attempt < STATUS_POLL_ATTEMPTS - 1) await waitForNextPoll(controller.signal);
    }
    throw new Error(
      'The connection was interrupted and a newly completed draft could not be confirmed. '
      + 'The current Word link, if shown, remains available; try Generate Word draft again.',
    );
  };

  const generate = async () => {
    if (!requestId || generating) return;
    const id = requestId;
    const baselineArtifactId = artifact?.artifactId || null;
    const sequence = ++generationSequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setGenerating(true);
    setCheckingStatus(false);
    setError(null);
    setPendingArtifact(null);
    setRecoveryMessage(null);

    let receivedResponse = false;
    try {
      const response = await fetch('/api/workbench/pre-site-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id }),
        signal: controller.signal,
      });
      receivedResponse = true;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Generation failed (${response.status})`);
      }
      const body = await response.json().catch(() => ({}));
      if (generationSequence.current !== sequence || id !== requestId) return;
      if (!body.artifact) throw new Error('Generation returned no artifact identity.');
      if (body.artifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) {
        setPendingArtifact(body.artifact);
        setRecoveryMessage('The draft is still being generated. Checking for the completed Word link…');
        const ready = await pollForArtifact({
          id,
          sequence,
          controller,
          targetArtifactId: body.artifact.artifactId,
          baselineArtifactId,
        });
        setArtifact(ready);
        setPendingArtifact(null);
      } else {
        setArtifact(body.artifact);
      }
    } catch (generationError) {
      if (generationError?.name !== 'AbortError'
        && generationSequence.current === sequence
        && id === requestId) {
        if (!receivedResponse) {
          setRecoveryMessage(
            'The generation connection was interrupted. Checking Dataverse for the completed draft…',
          );
          try {
            const ready = await pollForArtifact({
              id,
              sequence,
              controller,
              targetArtifactId: null,
              baselineArtifactId,
            });
            setArtifact(ready);
            setPendingArtifact(null);
          } catch (recoveryError) {
            if (recoveryError?.name !== 'AbortError') setError(recoveryError.message);
          }
        } else {
          setError(generationError.message);
        }
      }
    } finally {
      if (generationSequence.current === sequence && id === requestId) {
        if (activeController.current === controller) activeController.current = null;
        setGenerating(false);
        setRecoveryMessage(null);
      }
    }
  };

  const readyFile = artifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && artifact.file?.webUrl
    ? artifact.file
    : null;
  const promotedToSiteVisit = artifact?.lifecycleState
    === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW;
  const readyForSiteVisit = artifact?.lifecycleState
    === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT;
  const downloadUrl = readyFile
    ? (() => {
      try {
        const url = new URL(readyFile.webUrl);
        url.searchParams.set('download', '1');
        return url.toString();
      } catch {
        const separator = readyFile.webUrl.includes('?') ? '&' : '?';
        return `${readyFile.webUrl}${separator}download=1`;
      }
    })()
    : null;

  const generateWithConfirmation = () => {
    if (readyFile && !window.confirm(
      'Regenerate the Word draft using the latest source data? '
      + 'Edits in the current Word file will not be carried into a newly generated draft.',
    )) return;
    generate();
  };

  const startSiteVisit = async () => {
    if (!requestId || !readyFile || !readyForSiteVisit || startingSiteVisit) return;
    const id = requestId;
    const expectedArtifactId = artifact.artifactId;
    const sequence = ++generationSequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setStartingSiteVisit(true);
    setSiteVisitError(null);
    setError(null);
    try {
      const response = await fetch('/api/workbench/pre-site-visit/start-site-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id, expectedArtifactId }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Site Visit handoff failed (${response.status})`);
      if (generationSequence.current !== sequence || id !== requestId) return;
      if (!body.artifact) throw new Error('Site Visit handoff returned no artifact identity.');
      setArtifact(body.artifact);
      setPendingArtifact(null);
      setShowStartModal(false);
      onSelectTab?.('site-visit');
    } catch (startError) {
      if (startError?.name !== 'AbortError'
        && generationSequence.current === sequence
        && id === requestId) {
        setSiteVisitError(startError.message);
      }
    } finally {
      if (generationSequence.current === sequence && id === requestId) {
        if (activeController.current === controller) activeController.current = null;
        setStartingSiteVisit(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm" role="alert">
          {error}
        </div>
      )}
      {recoveryMessage && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm" role="status">
          {recoveryMessage}
        </div>
      )}
      <Card hover={false}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Pre Site Visit Writeup</h2>
            <button
              type="button"
              aria-label="About Pre Site Visit Word drafts"
              aria-expanded={showHelp}
              aria-controls="pre-site-visit-help"
              onClick={() => setShowHelp((visible) => !visible)}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-sm font-semibold text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              ?
            </button>
            {showHelp && (
              <div
                id="pre-site-visit-help"
                role="note"
                className="absolute left-0 top-full z-10 mt-2 w-[min(34rem,calc(100vw-3rem))] rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-lg"
              >
                <p>
                  The draft uses the exact <code>AI Materials/ProposalNarrative_&#123;Request#&#125;.pdf</code>
                  {' '}file, authoritative Dataverse fields, and the current published Admin prompt.
                </p>
                <p className="mt-2">
                  The graphical abstract, caption, recommendation, referee comments, scientific
                  presentation, and institutional funding history remain marked for staff completion.
                </p>
                <p className="mt-2">
                  Generated sections and the input snapshot are registered in Dataverse. The Word file
                  is saved in SharePoint and becomes the Site Visit working document. Regeneration uses
                  the latest governed inputs; unchanged inputs may reuse the current draft.
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {readyFile && (
              <>
                <a
                  href={readyFile.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
                >
                  Edit
                </a>
                <a
                  href={downloadUrl}
                  download={readyFile.name || true}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  Download
                </a>
              </>
            )}
            {!promotedToSiteVisit && (
              <button
                type="button"
                onClick={generateWithConfirmation}
                disabled={generating || !requestId}
                className={readyFile
                  ? 'rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50'
                  : 'rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50'}
              >
                {generating
                  ? 'Generating…'
                  : readyFile ? 'Regenerate Word Draft' : 'Generate Word Draft'}
              </button>
            )}
          </div>
        </div>
        <div aria-live="polite">
          {checkingStatus && !artifact && !pendingArtifact && (
            <p className="mt-4 text-sm text-gray-600">Checking for an existing Pre-Site Visit draft…</p>
          )}
          {pendingArtifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING && (
            <p className="mt-4 text-sm text-amber-800">
              This draft is being generated. The Word link will be available when generation finishes.
            </p>
          )}
          {readyFile && (
            <div className="mt-4 text-sm text-gray-700">
              <p>
                Latest draft:{' '}
                <a
                  href={readyFile.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-green-800 underline"
                >
                  {readyFile.name || 'Open Word draft'}
                </a>
              </p>
              {promotedToSiteVisit ? (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
                  <h3 className="font-semibold text-green-900">Site Visit in progress</h3>
                  <p className="mt-1">
                    This draft is now the Site Visit workspace and can no longer be regenerated here.
                  </p>
                  <button
                    type="button"
                    onClick={() => onSelectTab?.('site-visit')}
                    className="mt-3 rounded-lg border border-green-300 bg-white px-4 py-2 font-medium text-green-900 hover:bg-green-100"
                  >
                    Open Site Visit workspace
                  </button>
                </div>
              ) : readyForSiteVisit ? (
                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <h3 className="font-semibold text-gray-900">Ready for the Site Visit stage?</h3>
                  <p className="mt-1">
                    Use this Word draft as the working document for the Site Visit.
                  </p>
                  <button
                    ref={startButtonRef}
                    type="button"
                    onClick={() => {
                      setSiteVisitError(null);
                      setShowStartModal(true);
                    }}
                    className="mt-3 rounded-lg bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-800"
                  >
                    Start Site Visit
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </Card>

      {showStartModal && readyFile && readyForSiteVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-site-visit-title"
            aria-describedby="start-site-visit-description"
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 id="start-site-visit-title" className="text-xl font-semibold text-gray-900">
              Start the Site Visit stage?
            </h2>
            <div id="start-site-visit-description" className="mt-3 text-sm text-gray-700">
              <p>
                You are about to use <span className="font-medium">{readyFile.name || 'this Word draft'}</span>
                {' '}as the Site Visit workspace.
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>This exact Word document will become the Site Visit workspace.</li>
                <li>Its current SharePoint version will be recorded in Dataverse.</li>
                <li>Staff can continue editing this same document in Word.</li>
                <li>The Pre-Site draft can no longer be regenerated after this change.</li>
              </ul>
            </div>
            {siteVisitError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                {siteVisitError}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                ref={cancelStartButtonRef}
                type="button"
                disabled={startingSiteVisit}
                onClick={() => {
                  setShowStartModal(false);
                  setSiteVisitError(null);
                }}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                ref={confirmStartButtonRef}
                type="button"
                disabled={startingSiteVisit}
                onClick={startSiteVisit}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {startingSiteVisit ? 'Starting…' : 'Start Site Visit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
