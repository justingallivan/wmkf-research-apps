/**
 * Staff Deliberations — the merged workspace for the site-visit writeup's whole
 * life (S466; replaces PreSiteVisitTab + SiteVisitTab). One header card answers
 * what stage the document is at (Draft → Share → Wrap Up), what the current
 * document is, and what the next action is; sections appear by stage.
 *
 * Stage backing: Draft/Share map to the document lifecycle (DRAFT / REVIEW via
 * the guarded start-site-visit lock). Wrap Up is DERIVED — the first
 * transport-accepted materials send promotes the rail (owner decision
 * 2026-08-27); no new document state exists. The "Move to Final Writeup"
 * hand-off is deliberately NOT built until its receiving end is defined
 * (open question 4b in the workspace proposal).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';
import PreSiteDistributionPanel from './PreSiteDistributionPanel';
import useSiteVisitContext from './useSiteVisitContext';
import {
  PRE_SITE_REOPEN_CONTRACT,
  PRE_SITE_REOPEN_REASON_LABEL,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../config/requestDocument';

const STATUS_POLL_INTERVAL_MS = 3000;
const STATUS_POLL_ATTEMPTS = 20;
const EMPTY_LIST = Object.freeze([]);

async function readStatus(requestId, signal) {
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

function failureMessage(artifact, fallback, explicitReference = null) {
  const message = artifact?.lastError?.message || fallback;
  const reference = artifact?.lastError?.supportReference
    || artifact?.provenance?.runId
    || explicitReference
    || artifact?.artifactId
    || null;
  return reference ? `${message} Support reference: ${reference}.` : message;
}

function downloadUrlFor(file) {
  if (!file?.webUrl) return null;
  try {
    const url = new URL(file.webUrl);
    url.searchParams.set('download', '1');
    return url.toString();
  } catch {
    const separator = file.webUrl.includes('?') ? '&' : '?';
    return `${file.webUrl}${separator}download=1`;
  }
}

function newClientOperationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_value, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`
    + `-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function StageRail({ stage, reopened }) {
  const currentIndex = stage === 'share' ? 1 : stage === 'wrap-up' ? 2 : 0;
  const items = [
    { label: stage === 'draft-ready' ? 'Draft ready' : 'Draft', index: 0 },
    { label: 'Share', index: 1 },
    { label: 'Wrap Up', index: 2 },
  ];
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold" data-testid="stage-rail">
      {items.map((item, position) => (
        <span key={item.label} className="flex items-center gap-2">
          {position > 0 && <span className="text-gray-300">──</span>}
          <span className={item.index < currentIndex
            ? 'text-gray-500'
            : item.index === currentIndex
              ? 'text-green-800'
              : 'text-gray-300'}
          >
            {item.index < currentIndex ? '✓' : item.index === currentIndex ? '●' : '○'} {item.label}
          </span>
        </span>
      ))}
      {reopened && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
          reopened
        </span>
      )}
    </p>
  );
}

// The SharePoint filename carries idempotency hex staff shouldn't have to
// read; links show a display label and the real identity lives one click
// away here (Download still saves under the real filename).
function FileDetails({ file }) {
  if (!file?.name) return null;
  return (
    <details className="mt-1 text-xs text-gray-500">
      <summary className="cursor-pointer select-none">File details</summary>
      <p className="mt-1">
        {file.name}
        {Number(file.size) > 0 ? ` · ${Math.max(1, Math.round(file.size / 1024))} KB` : ''}
        {file.versionId ? ` · SharePoint version ${file.versionId}` : ''}
      </p>
    </details>
  );
}

export default function StaffDeliberationsTab({ requestId, requestNumber = '', isSuperuser = false }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [artifact, setArtifact] = useState(null);
  const [pendingArtifact, setPendingArtifact] = useState(null);
  const [reopenHistory, setReopenHistory] = useState(EMPTY_LIST);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null); // null | 'start' | 'regenerate'
  const [startingShare, setStartingShare] = useState(false);
  const [shareError, setShareError] = useState(null);
  const [reopeningRequestId, setReopeningRequestId] = useState(null);
  const [reopenForm, setReopenForm] = useState(null);
  const [reopenError, setReopenError] = useState(null);
  const [currentSourceEverSent, setCurrentSourceEverSent] = useState(false);
  const generationSequence = useRef(0);
  const activeController = useRef(null);
  const cancelDialogButtonRef = useRef(null);
  const confirmDialogButtonRef = useRef(null);

  useEffect(() => {
    generationSequence.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    setGenerating(false);
    setError(null);
    setArtifact(null);
    setPendingArtifact(null);
    setReopenHistory(EMPTY_LIST);
    setRecoveryMessage(null);
    setShowHelp(false);
    setConfirmDialog(null);
    setStartingShare(false);
    setShareError(null);
    setReopenForm(null);
    setReopenError(null);
    setCurrentSourceEverSent(false);
    const id = requestId;
    if (id) {
      const sequence = generationSequence.current;
      const controller = new AbortController();
      activeController.current = controller;
      setCheckingStatus(true);
      readStatus(id, controller.signal)
        .then((status) => {
          if (generationSequence.current !== sequence || id !== requestId) return;
          setArtifact(status.currentArtifact || null);
          setPendingArtifact(status.pendingArtifact || null);
          setReopenHistory(status.reopenHistory || EMPTY_LIST);
          if (status.pendingArtifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED) {
            setError(failureMessage(
              status.pendingArtifact,
              'The latest Word-draft attempt failed.',
            ));
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
    if (!confirmDialog) return undefined;
    const previouslyFocused = document.activeElement;
    confirmDialogButtonRef.current?.focus();
    const handleModalKey = (event) => {
      if (event.key === 'Escape' && !startingShare && !generating) {
        setConfirmDialog(null);
        setShareError(null);
      }
      if (event.key === 'Tab') {
        const first = cancelDialogButtonRef.current;
        const last = confirmDialogButtonRef.current;
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
  }, [confirmDialog, startingShare, generating]);

  const pollForArtifact = async ({ id, sequence, controller, targetArtifactId, baselineArtifactId }) => {
    for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt += 1) {
      const status = await readStatus(id, controller.signal);
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
        throw new Error(failureMessage(pending, 'The latest Word-draft attempt failed.'));
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
        const fallback = body.error || `Generation failed (${response.status})`;
        let status = null;
        try {
          status = await readStatus(id, controller.signal);
        } catch (statusError) {
          if (statusError?.name === 'AbortError') throw statusError;
          throw new Error(failureMessage(null, fallback, body.runId || body.artifactId));
        }
        if (generationSequence.current !== sequence || id !== requestId) return;
        setArtifact(status.currentArtifact || null);
        setPendingArtifact(status.pendingArtifact || null);
        const failed = status.pendingArtifact?.operationStatus
          === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
          ? status.pendingArtifact
          : null;
        throw new Error(failureMessage(failed, fallback, body.runId || body.artifactId));
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
  const warnings = Array.isArray(artifact?.warnings) ? artifact.warnings : [];
  const unchangedRetryBlocked = pendingArtifact?.operationStatus
    === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
    && pendingArtifact.retryable === false;
  const shared = artifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW;
  const draftReady = artifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT;
  const beyondDeliberations = Boolean(artifact) && !draftReady && !shared;
  // Server-derived (uncapped EXISTS, scoped to the current source document) so
  // a superseded document's sends never promote its reopen successor and the
  // display cap cannot regress the stage (Codex S466).
  const everSent = currentSourceEverSent;
  const stage = shared
    ? (everSent ? 'wrap-up' : 'share')
    : readyFile && draftReady
      ? 'draft-ready'
      : 'draft';
  const downloadUrl = downloadUrlFor(readyFile);
  const workingControlsAvailable = readyFile && (draftReady || shared);

  const onDistributionHistory = useCallback((historyInfo) => {
    setCurrentSourceEverSent(historyInfo?.currentSourceEverSent === true);
  }, []);

  // Headless read of the wmkf_sitevisit Activity (maintained outside this
  // workspace) feeding the composer's calendar/materials/suggestions.
  const siteVisitContext = useSiteVisitContext(shared && readyFile ? requestId : null);

  const startShare = async () => {
    if (!requestId || !readyFile || !draftReady || startingShare) return;
    const id = requestId;
    const expectedArtifactId = artifact.artifactId;
    const sequence = ++generationSequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setStartingShare(true);
    setShareError(null);
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
      setConfirmDialog(null);
    } catch (startError) {
      if (startError?.name !== 'AbortError'
        && generationSequence.current === sequence
        && id === requestId) {
        setShareError(startError.message);
      }
    } finally {
      if (generationSequence.current === sequence && id === requestId) {
        if (activeController.current === controller) activeController.current = null;
        setStartingShare(false);
      }
    }
  };

  const openReopenDialog = () => {
    if (!shared || !isSuperuser || reopeningRequestId === requestId || !requestNumber) return;
    setReopenError(null);
    setReopenForm({
      reasonCode: '',
      reasonNote: '',
      typedRequestNumber: '',
      clientOperationId: newClientOperationId(),
      submitted: false,
    });
  };

  const reopening = reopeningRequestId === requestId;
  const reopenFormValid = Boolean(
    reopenForm
      && requestNumber
      && Object.prototype.hasOwnProperty.call(PRE_SITE_REOPEN_REASON_LABEL, reopenForm.reasonCode)
      && reopenForm.reasonNote.trim().length >= PRE_SITE_REOPEN_CONTRACT.minimumReasonNoteLength
      && reopenForm.reasonNote.trim().length <= PRE_SITE_REOPEN_CONTRACT.maximumReasonNoteLength
      && reopenForm.typedRequestNumber === requestNumber,
  );

  const submitReopen = async (event) => {
    event.preventDefault();
    if (!reopenFormValid || reopening || !shared || !requestId) return;

    const id = requestId;
    const expectedArtifactId = artifact.artifactId;
    const sequence = ++generationSequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setReopeningRequestId(id);
    setReopenError(null);
    setReopenForm((current) => (current ? { ...current, submitted: true } : current));
    try {
      const response = await fetch('/api/workbench/pre-site-visit/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: id,
          expectedArtifactId,
          clientOperationId: reopenForm.clientOperationId,
          requestNumber: reopenForm.typedRequestNumber,
          reasonCode: reopenForm.reasonCode,
          reasonNote: reopenForm.reasonNote.trim(),
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Guarded reopen failed (${response.status})`);
      if (generationSequence.current !== sequence || id !== requestId) return;

      const refreshed = await readStatus(id, controller.signal);
      if (generationSequence.current !== sequence || id !== requestId) return;
      setArtifact(refreshed.currentArtifact || body.artifact || null);
      setPendingArtifact(refreshed.pendingArtifact || null);
      setReopenHistory(refreshed.reopenHistory || EMPTY_LIST);
      if (response.status === 202 || body.inProgress) {
        setReopenError('This guarded reopen is already in progress. Keep this dialog open and retry to check the same operation.');
        return;
      }
      setReopenForm(null);
    } catch (submitError) {
      if (submitError?.name !== 'AbortError'
        && generationSequence.current === sequence
        && id === requestId) {
        setReopenError(submitError.message);
      }
    } finally {
      if (generationSequence.current === sequence && id === requestId) {
        if (activeController.current === controller) activeController.current = null;
        setReopeningRequestId(null);
      }
    }
  };

  const confirmDialogContent = confirmDialog === 'start'
    ? {
      title: 'Start sharing this draft?',
      confirmLabel: startingShare ? 'Starting…' : 'Start sharing',
      busy: startingShare,
      onConfirm: startShare,
      body: (
        <>
          <p>
            You are about to use <span className="font-medium">{readyFile?.name || 'this Word draft'}</span>
            {' '}as the working document for the site visit.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>This exact Word document will become the Site Visit workspace.</li>
            <li>Its current SharePoint version will be recorded in Dataverse.</li>
            <li>Staff can continue editing this same document in Word.</li>
            <li>The draft can no longer be regenerated after this change.</li>
          </ul>
        </>
      ),
    }
    : confirmDialog === 'regenerate'
      ? {
        title: 'Regenerate this draft?',
        confirmLabel: generating ? 'Regenerating…' : 'Regenerate',
        busy: generating,
        onConfirm: () => {
          setConfirmDialog(null);
          generate();
        },
        body: (
          <p>
            Regenerating starts a new Claude call and creates new AI-generated content from
            the latest proposal source and Dataverse data. Edits in the current Word file
            will not be carried into the new draft.
          </p>
        ),
      }
      : null;

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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="relative flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">Site Visit Writeup</h2>
              <button
                type="button"
                aria-label="About the site visit writeup"
                aria-expanded={showHelp}
                aria-controls="staff-deliberations-help"
                onClick={() => setShowHelp((visible) => !visible)}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-sm font-semibold text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                ?
              </button>
              {showHelp && (
                <div
                  id="staff-deliberations-help"
                  role="note"
                  className="absolute left-0 top-full z-10 mt-2 w-[min(34rem,calc(100vw-3rem))] rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-lg"
                >
                  <p>
                    The draft uses the exact <code>AI Materials/ProposalNarrative_&#123;Request#&#125;.pdf</code>
                    {' '}file, authoritative Dataverse fields, and the current published Admin prompt.
                  </p>
                  <p className="mt-2">
                    The graphical abstract, caption, recommendation, referee comments, and scientific
                    presentation remain marked for staff completion. Institutional funding history is
                    filled from the AkoyaGO award history.

                  </p>
                  <p className="mt-2">
                    Generated sections and the input snapshot are registered in Dataverse. The Word file
                    is saved in SharePoint and becomes the working document once sharing starts.
                    Regeneration uses the latest governed inputs; unchanged inputs may reuse the
                    current draft.
                  </p>
                </div>
              )}
            </div>
            {!beyondDeliberations && (
              <StageRail stage={stage} reopened={draftReady && reopenHistory.length > 0} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {workingControlsAvailable && (
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
            {(!artifact || draftReady) && (
              <button
                type="button"
                onClick={() => (readyFile ? setConfirmDialog('regenerate') : generate())}
                disabled={generating || !requestId || unchangedRetryBlocked}
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
            <p className="mt-4 text-sm text-gray-600">Checking for an existing writeup draft…</p>
          )}
          {pendingArtifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING && (
            <p className="mt-4 text-sm text-amber-800">
              This draft is being generated. The Word link will be available when generation finishes.
            </p>
          )}
          {unchangedRetryBlocked && (
            <p className="mt-4 text-sm text-amber-900">
              This attempt needs a prompt or application change before it can be retried.
            </p>
          )}
          {readyFile && draftReady && (
            <div className="mt-4 text-sm text-gray-700">
              <p>
                Latest draft:{' '}
                <a
                  href={readyFile.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={readyFile.name || undefined}
                  className="font-medium text-green-800 underline"
                >
                  {readyFile.lastModified
                    ? `Word draft · generated ${new Date(readyFile.lastModified).toLocaleDateString()}`
                    : 'Word draft'}
                </a>
              </p>
              <FileDetails file={readyFile} />
              {warnings.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950" role="status">
                  <h3 className="font-semibold">Draft needs a quick edit check</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {warnings.map((warning, index) => (
                      <li key={`${warning.code || 'warning'}-${index}`}>
                        {warning.message || 'The draft completed with a review warning.'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
                <p className="max-w-xl text-sm text-gray-600">
                  Sharing locks this exact version as the working document and turns off regeneration.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShareError(null);
                    setConfirmDialog('start');
                  }}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  Start sharing
                </button>
              </div>
            </div>
          )}
          {readyFile && shared && (
            <div className="mt-4 text-sm text-gray-700">
              <p>
                Working document:{' '}
                <a
                  href={readyFile.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={readyFile.name || undefined}
                  className="font-medium underline"
                >
                  Word document
                </a>
                {' '}
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                  Shared
                </span>
              </p>
              {artifact.milestone?.createdAt && (
                <p className="mt-1 text-xs text-gray-500">
                  Sharing began {new Date(artifact.milestone.createdAt).toLocaleString()}; this exact
                  version is recorded and regeneration is off.
                </p>
              )}
              <FileDetails file={readyFile} />
              {warnings.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950" role="status">
                  <h4 className="font-semibold">Working document needs a quick edit check</h4>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {warnings.map((warning, index) => (
                      <li key={`${warning.code || 'warning'}-${index}`}>
                        {warning.message || 'The document completed with a review warning.'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {everSent && (
                <p className="mt-3 text-sm text-gray-700">
                  <span className="mr-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    Materials sent
                  </span>
                  Fill in the site-visit sections (recommendation, referee comments, presentation)
                  in the working document — it is the starting draft for the final writeup.
                </p>
              )}
            </div>
          )}
          {shared && !readyFile && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <h3 className="font-semibold">Site visit writeup is read-only</h3>
              <p className="mt-1">
                No current Word link was returned for this record, so working controls are not
                available. Reload to retry, or contact an administrator if this persists.
              </p>
            </div>
          )}
          {beyondDeliberations && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <h3 className="font-semibold">Site visit writeup is read-only</h3>
              <p className="mt-1">
                This document has moved beyond the deliberation stages. It cannot be edited,
                downloaded, or regenerated from this tab.
              </p>
              {artifact?.file?.name && (
                <p className="mt-2 text-xs">
                  Document: <span className="font-medium">{artifact.file.name}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      {shared && readyFile && (
        <PreSiteDistributionPanel
          key={`distribution-${requestId}`}
          requestId={requestId}
          requestNumber={requestNumber}
          sourceArtifact={artifact}
          siteVisit={siteVisitContext?.siteVisit || null}
          materials={siteVisitContext?.materials || EMPTY_LIST}
          suggestedTo={siteVisitContext?.suggestedTo || EMPTY_LIST}
          suggestedCc={siteVisitContext?.suggestedCc || EMPTY_LIST}
          onHistory={onDistributionHistory}
          collapsed={everSent}
        />
      )}

      {isSuperuser && (shared || reopenHistory.length > 0) && (
        <Card hover={false}>
          <details>
            <summary className="cursor-pointer select-none text-sm font-semibold text-gray-600">
              Administration — guarded reopen &amp; audit trail
            </summary>
            <div className="mt-3 space-y-4">
              {shared && (
                <div>
                  <p className="text-sm text-gray-600">
                    A guarded reopen preserves the recorded handoff and returns the workspace to a
                    Draft successor created from its exact bytes.
                  </p>
                  <button
                    type="button"
                    onClick={openReopenDialog}
                    disabled={reopening || !requestNumber}
                    className="mt-3 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                  >
                    Reopen Pre-Site Draft
                  </button>
                </div>
              )}
              {reopenHistory.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Guarded reopen attempts</h3>
                  <ul className="mt-3 space-y-3">
                    {reopenHistory.map((entry) => (
                      <li key={entry.correction?.cycleId || entry.artifactId} className="rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
                        <p className="font-medium text-gray-900">
                          {PRE_SITE_REOPEN_REASON_LABEL[entry.correction?.reasonCode]
                            || entry.correction?.reasonCode
                            || 'Reopen'}
                        </p>
                        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                          {entry.outcome === 'completed'
                            ? 'Completed'
                            : entry.outcome === 'failed'
                              ? 'Failed'
                              : entry.outcome === 'in_progress'
                                ? 'In progress'
                                : 'Needs reconciliation'}
                        </p>
                        {entry.correction?.reasonNote && <p className="mt-1">{entry.correction.reasonNote}</p>}
                        {entry.cleanupRequired?.length > 0 && (
                          <p className="mt-1 text-amber-800">
                            A retained SharePoint copy requires reconciliation.
                          </p>
                        )}
                        <p className="mt-1 text-xs text-gray-500">
                          {entry.correction?.actorName || 'Recorded staff actor'}
                          {entry.correction?.createdAt
                            ? ` · ${new Date(entry.correction.createdAt).toLocaleString()}`
                            : ''}
                          {entry.source?.milestone?.versionId
                            ? ` · source version ${entry.source.milestone.versionId}`
                            : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        </Card>
      )}

      {confirmDialogContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="deliberations-confirm-title"
            aria-describedby="deliberations-confirm-description"
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 id="deliberations-confirm-title" className="text-xl font-semibold text-gray-900">
              {confirmDialogContent.title}
            </h2>
            <div id="deliberations-confirm-description" className="mt-3 text-sm text-gray-700">
              {confirmDialogContent.body}
            </div>
            {shareError && confirmDialog === 'start' && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                {shareError}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                ref={cancelDialogButtonRef}
                type="button"
                disabled={confirmDialogContent.busy}
                onClick={() => {
                  setConfirmDialog(null);
                  setShareError(null);
                }}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                ref={confirmDialogButtonRef}
                type="button"
                disabled={confirmDialogContent.busy}
                onClick={confirmDialogContent.onConfirm}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {confirmDialogContent.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {reopenForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="guarded-reopen-title"
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
          >
            <h3 id="guarded-reopen-title" className="text-lg font-semibold text-gray-900">
              Guarded reopen
            </h3>
            <p className="mt-2 text-sm text-gray-700">
              This preserves the recorded handoff and creates a new Draft successor from its exact bytes.
            </p>
            {reopenError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                {reopenError}
              </div>
            )}
            <form className="mt-4 space-y-4" onSubmit={submitReopen}>
              <div>
                <label htmlFor="reopen-reason" className="block text-sm font-medium text-gray-800">
                  Reason
                </label>
                <select
                  id="reopen-reason"
                  value={reopenForm.reasonCode}
                  onChange={(event) => setReopenForm((current) => ({
                    ...current,
                    reasonCode: event.target.value,
                  }))}
                  disabled={reopening || reopenForm.submitted}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select a reason</option>
                  {Object.entries(PRE_SITE_REOPEN_REASON_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reopen-note" className="block text-sm font-medium text-gray-800">
                  Correction note
                </label>
                <textarea
                  id="reopen-note"
                  value={reopenForm.reasonNote}
                  onChange={(event) => setReopenForm((current) => ({
                    ...current,
                    reasonNote: event.target.value,
                  }))}
                  minLength={PRE_SITE_REOPEN_CONTRACT.minimumReasonNoteLength}
                  maxLength={PRE_SITE_REOPEN_CONTRACT.maximumReasonNoteLength}
                  rows={4}
                  disabled={reopening || reopenForm.submitted}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {PRE_SITE_REOPEN_CONTRACT.minimumReasonNoteLength}–{PRE_SITE_REOPEN_CONTRACT.maximumReasonNoteLength} characters.
                </p>
              </div>
              <div>
                <label htmlFor="reopen-confirmation" className="block text-sm font-medium text-gray-800">
                  Type request number {requestNumber} to confirm
                </label>
                <input
                  id="reopen-confirmation"
                  value={reopenForm.typedRequestNumber}
                  onChange={(event) => setReopenForm((current) => ({ ...current, typedRequestNumber: event.target.value }))}
                  autoComplete="off"
                  disabled={reopening || reopenForm.submitted}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {reopenForm.submitted && (
                  <p className="mt-1 text-xs text-gray-500">
                    This operation keeps its original reason and confirmation for safe retry.
                    Cancel and reopen the dialog to start a different operation.
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setReopenForm(null); setReopenError(null); }}
                  disabled={reopening}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!reopenFormValid || reopening}
                  className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {reopening ? 'Reopening…' : 'Create Draft Successor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
