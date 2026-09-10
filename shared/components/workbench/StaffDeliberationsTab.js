/**
 * Staff Deliberations — the merged workspace for the site-visit writeup's whole
 * life (S466; replaces PreSiteVisitTab + SiteVisitTab). One header card answers
 * what stage the document is at, what the current document is, and what the
 * next action is; sections appear by stage.
 *
 * Stage backing (PC Meeting Tracker slice 3, docs/PC_MEETING_TRACKER_PLAN.md
 * D5-D9): four keyed stops — draft | shared | visit | final — derived by
 * shared/utils/deliberation-stage.js from the document lifecycle (DRAFT /
 * REVIEW via the guarded start-site-visit lock / FINAL) and the wmkf_sitevisit
 * Activity's scheduled start (date-derived "visited", D7). Display labels are
 * admin-editable (D6; shared/config/editableTextDefaults.js) and arrive on the
 * GET /api/workbench/pre-site-visit payload as `stageLabels`. "Shared" means
 * locked (D5) — a substate ("not-sent"/"sent") tracks whether materials have
 * actually gone out, fed by the distribution panel's onHistory callback.
 *
 * Tab redesign (docs/plans/STAFF_DELIBERATIONS_TAB_SHAPE_BRIEF_2026-09-09.md,
 * owner-approved 2026-09-10): stage → sentence → one primary action. The rail
 * is the map, one code-owned sentence says what to do next, the action row
 * carries one dark button plus at most one outline button, and Download /
 * Regenerate live in a More menu. Share opens the distribution composer as a
 * dialog; the composer locks the draft (guarded start-site-visit) at preview
 * time, then sends, so the preview is always built from the locked version.
 * The session line reads the tracker through the status payload (§5.4 seam).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';
import PreSiteDistributionPanel from './PreSiteDistributionPanel';
import useSiteVisitContext from './useSiteVisitContext';
import DeliberationStageRail from './DeliberationStageRail';
import OverflowMenu from './OverflowMenu';
import {
  DELIBERATION_STAGE_DEFAULT_LABELS,
  deliberationSessionLine,
  deliberationStageSentence,
  deliberationVisitLine,
  deriveDeliberationStage,
  visitExpected,
} from '../../utils/deliberation-stage';
import {
  PRE_SITE_REOPEN_CONTRACT,
  PRE_SITE_REOPEN_REASON_LABEL,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../config/requestDocument';

const STATUS_POLL_INTERVAL_MS = 3000;
const STATUS_POLL_ATTEMPTS = 20;
const EMPTY_LIST = Object.freeze([]);
const EMPTY_STAGE_LABELS = DELIBERATION_STAGE_DEFAULT_LABELS;

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

export default function StaffDeliberationsTab({
  requestId,
  requestNumber = '',
  isSuperuser = false,
  onSelectTab = null,
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [artifact, setArtifact] = useState(null);
  const [pendingArtifact, setPendingArtifact] = useState(null);
  const [reopenHistory, setReopenHistory] = useState(EMPTY_LIST);
  const [stageLabels, setStageLabels] = useState(EMPTY_STAGE_LABELS);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [latestSendFailure, setLatestSendFailure] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null); // null | 'regenerate'
  const [startingShare, setStartingShare] = useState(false);
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
    setComposerOpen(false);
    setSession(null);
    setLatestSendFailure(null);
    setConfirmDialog(null);
    setStartingShare(false);
    setReopenForm(null);
    setReopenError(null);
    setCurrentSourceEverSent(false);
    setStageLabels(EMPTY_STAGE_LABELS);
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
          if (status.stageLabels) setStageLabels(status.stageLabels);
          setSession(status.session || null);
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
      if (event.key === 'Escape' && !generating) {
        setConfirmDialog(null);
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
  }, [confirmDialog, generating]);

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
      if (status.stageLabels) setStageLabels(status.stageLabels);
      if (status.session !== undefined) setSession(status.session || null);

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
  // Server-derived (uncapped EXISTS, scoped to the current source document) so
  // a superseded document's sends never promote its reopen successor and the
  // display cap cannot regress the stage (Codex S466).
  const everSent = currentSourceEverSent;
  const downloadUrl = downloadUrlFor(readyFile);

  const onDistributionHistory = useCallback((historyInfo) => {
    setCurrentSourceEverSent(historyInfo?.currentSourceEverSent === true);
    setLatestSendFailure(historyInfo?.latestSendFailure || null);
  }, []);

  // Headless read of the wmkf_sitevisit Activity (maintained outside this
  // workspace) feeding the composer's calendar/materials/suggestions, and the
  // rail's visit stop. Fail-open, so this is safe to call for every stage.
  const siteVisitContext = useSiteVisitContext(requestId);
  const siteVisitStartIso = siteVisitContext?.siteVisit?.startIso || null;

  // PC Meeting Tracker slice 3 (docs/PC_MEETING_TRACKER_PLAN.md D5-D9): the
  // four-stop rail derivation. `stage`/`substate`/`visit` drive display only —
  // every existing gate above (`shared`, `draftReady`) stays lifecycle-derived
  // so the working controls and distribution panel are unaffected by the
  // visit having happened.
  // With no current document, an in-flight or failed generation lives in
  // `pendingArtifact`; feed it so the first stop can say generating/failed
  // instead of "No draft yet". Once a draft exists it wins (a regeneration in
  // flight does not un-ready the existing draft).
  const { stage, substate, visit } = deriveDeliberationStage({
    currentArtifact: artifact || pendingArtifact,
    siteVisitStartIso,
    everSent,
  });
  const movedToFinal = stage === 'final';
  // A lifecycle outside the four keyed stops (Board Ready/Superseded/unknown —
  // never produced for the *current* artifact in practice; distribution
  // snapshots that use Board Ready are separate rows, not this one). The rail
  // has nothing meaningful to show for it, so it stays hidden (fail closed).
  const unknownLifecycle = stage === 'beyond';
  const beyondDeliberations = movedToFinal || unknownLifecycle;
  // D8/J27 (docs/PC_MEETING_TRACKER_PLAN.md): whether a visit is even expected
  // this cycle. No production caller varies it today (D26 is always true), but
  // the visit line at draft/shared is anticipatory ("not scheduled" as a PC
  // to-do) and has nothing honest to say once J27 makes a visit optional.
  const visitLineVisible = visitExpected() || stage === 'visit' || stage === 'final';

  // Lock the exact draft as the working document (guarded start-site-visit,
  // ETag-fenced). Called by the composer before it prepares the preview, so
  // the order is lock → preview → send and a lock failure lands in the
  // composer as the error. Idempotent server-side once the row is REVIEW.
  const lockForShare = async () => {
    if (!requestId || !readyFile || !draftReady) return;
    if (startingShare) throw new Error('The draft is already being locked. Wait a moment and try again.');
    const id = requestId;
    const expectedArtifactId = artifact.artifactId;
    const sequence = ++generationSequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setStartingShare(true);
    setError(null);
    try {
      const response = await fetch('/api/workbench/pre-site-visit/start-site-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id, expectedArtifactId }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `The draft could not be locked for sharing (${response.status})`);
      if (generationSequence.current !== sequence || id !== requestId) {
        throw new Error('The request changed while the draft was being locked.');
      }
      if (!body.artifact) throw new Error('Locking returned no artifact identity.');
      setArtifact(body.artifact);
      setPendingArtifact(null);
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

  const confirmDialogContent = confirmDialog === 'regenerate'
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

  const primaryClass = 'rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50';
  const secondaryClass = 'rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50';
  const openComposer = () => {
    setError(null);
    setComposerOpen(true);
  };
  const sentence = deliberationStageSentence({
    stage,
    substate,
    sharedAtIso: artifact?.milestone?.createdAt || null,
    visit,
  });
  // Session and visit lines belong to the stages where the PC's scheduling is
  // still ahead (draft, shared); at Visit the sentence already carries the
  // visit date, and at Final nothing is pending.
  const showSessionLine = !beyondDeliberations && stage !== 'visit';
  const showVisitLine = showSessionLine && visitLineVisible;
  const moreItems = [
    readyFile && !beyondDeliberations && {
      key: 'download', label: 'Download', href: downloadUrl, download: readyFile.name || true, title: readyFile.name || undefined,
    },
    readyFile && draftReady && {
      key: 'regenerate', label: 'Regenerate Word Draft', onSelect: () => setConfirmDialog('regenerate'), disabled: generating || unchangedRetryBlocked,
    },
    readyFile && shared && everSent && {
      key: 'send-again', label: 'Send the deliberation email again…', onSelect: openComposer,
    },
  ].filter(Boolean);

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
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Staff Deliberations</h2>
            {!unknownLifecycle && (
              <>
                <DeliberationStageRail
                  stage={stage}
                  substate={substate}
                  labels={stageLabels}
                  reopened={draftReady && reopenHistory.length > 0}
                />
                <p className="mt-2 max-w-2xl text-sm text-gray-700" data-testid="deliberations-stage-sentence">
                  {sentence}
                </p>
                {showSessionLine && (
                  <p className="mt-1 text-xs text-gray-500" data-testid="deliberations-session-line">
                    {deliberationSessionLine(session)}
                  </p>
                )}
                {showVisitLine && (
                  <p className="mt-1 text-xs text-gray-500" data-testid="deliberations-visit-line">
                    {deliberationVisitLine(visit)}
                  </p>
                )}
                {shared && latestSendFailure && (
                  <p className="mt-1 text-xs font-medium text-red-700" role="alert" data-testid="deliberations-send-failure">
                    The last send failed: {latestSendFailure.message}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {stage === 'draft' && !readyFile && (
              <button
                type="button"
                onClick={generate}
                disabled={generating || !requestId || unchangedRetryBlocked}
                className={primaryClass}
              >
                {generating ? 'Generating…' : 'Generate Word Draft'}
              </button>
            )}
            {stage === 'draft' && readyFile && draftReady && (
              <>
                <a href={readyFile.webUrl} target="_blank" rel="noopener noreferrer" className={primaryClass}>
                  Edit in Word
                </a>
                <button type="button" onClick={openComposer} disabled={generating} className={secondaryClass}>
                  Share…
                </button>
              </>
            )}
            {stage === 'shared' && readyFile && substate === 'not-sent' && (
              <>
                <button type="button" onClick={openComposer} className={primaryClass}>
                  {latestSendFailure ? 'Resend' : 'Share…'}
                </button>
                <a href={readyFile.webUrl} target="_blank" rel="noopener noreferrer" className={secondaryClass}>
                  Open working document
                </a>
              </>
            )}
            {stage === 'shared' && readyFile && substate === 'sent' && (
              <>
                <a href={readyFile.webUrl} target="_blank" rel="noopener noreferrer" className={primaryClass}>
                  Open working document
                </a>
                {latestSendFailure && (
                  <button type="button" onClick={openComposer} className={secondaryClass}>
                    Resend
                  </button>
                )}
              </>
            )}
            {stage === 'visit' && readyFile && (
              <>
                <a href={readyFile.webUrl} target="_blank" rel="noopener noreferrer" className={primaryClass}>
                  Add site-visit edits in Word
                </a>
                {onSelectTab ? (
                  <button type="button" onClick={() => onSelectTab('final-writeup')} className={secondaryClass}>
                    Continue in Final Writeup
                  </button>
                ) : (
                  <span className="text-xs text-gray-400">Open the Final Writeup tab to continue →</span>
                )}
              </>
            )}
            {movedToFinal && onSelectTab && (
              <button type="button" onClick={() => onSelectTab('final-writeup')} className={primaryClass}>
                Open Final Writeup
              </button>
            )}
            {!beyondDeliberations && <OverflowMenu label="More actions" items={moreItems} />}
          </div>
        </div>
        <div aria-live="polite">
          {checkingStatus && !artifact && !pendingArtifact && (
            <p className="mt-4 text-sm text-gray-600">Checking for an existing writeup draft…</p>
          )}
          {pendingArtifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING && readyFile && (
            <p className="mt-4 text-sm text-amber-800">
              A new draft is being generated. The current Word link stays available until it finishes.
            </p>
          )}
          {unchangedRetryBlocked && (
            <p className="mt-4 text-sm text-amber-900">
              This attempt needs a prompt or application change before it can be retried.
            </p>
          )}
          {readyFile && !beyondDeliberations && (
            <div className="mt-4 text-sm text-gray-700">
              <p>
                {shared ? 'Working document:' : 'Latest draft:'}{' '}
                <a
                  href={readyFile.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={readyFile.name || undefined}
                  className="font-medium text-green-800 underline"
                >
                  {shared
                    ? 'Word document'
                    : readyFile.lastModified
                      ? `Word draft · generated ${new Date(readyFile.lastModified).toLocaleDateString()}`
                      : 'Word draft'}
                </a>
              </p>
              <FileDetails file={readyFile} />
              {warnings.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950" role="status">
                  <h3 className="font-semibold">
                    {shared ? 'Working document needs a quick edit check' : 'Draft needs a quick edit check'}
                  </h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {warnings.map((warning, index) => (
                      <li key={`${warning.code || 'warning'}-${index}`}>
                        {warning.message || 'The draft completed with a review warning.'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {shared && !readyFile && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <h3 className="font-semibold">Staff Deliberations is read-only</h3>
              <p className="mt-1">
                No current Word link was returned for this record, so working controls are not
                available. Reload to retry, or contact an administrator if this persists.
              </p>
            </div>
          )}
          {beyondDeliberations && (
            <div className={movedToFinal
              ? 'mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-950'
              : 'mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950'}
            >
              <h3 className="font-semibold">
                {movedToFinal ? 'Moved to Final Writeup' : 'Staff Deliberations is read-only'}
              </h3>
              <p className="mt-1">
                {movedToFinal
                  ? 'This tab now preserves the Staff Deliberations record. Open the Final Writeup tab to continue in Word.'
                  : 'This document has moved beyond the deliberation stages. It cannot be edited, downloaded, or regenerated from this tab.'}
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

      {readyFile && (draftReady || shared) && (
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
          composer={composerOpen ? 'dialog' : 'hidden'}
          onCloseComposer={() => setComposerOpen(false)}
          beforePrepare={draftReady ? lockForShare : null}
          needsLock={draftReady}
          record={shared}
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
                          {entry.correction?.actorName || 'Not captured'}
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
            <div className="mt-6 flex justify-end gap-3">
              <button
                ref={cancelDialogButtonRef}
                type="button"
                disabled={confirmDialogContent.busy}
                onClick={() => setConfirmDialog(null)}
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
