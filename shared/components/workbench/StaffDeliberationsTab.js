/**
 * Staff Deliberations — the merged workspace for the deliberation cycle's
 * governed documents (S466; replaces PreSiteVisitTab + SiteVisitTab).
 *
 * docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md §4-§5 slice 5:
 * the workspace now carries two independent governed artifacts with their
 * own lifecycle state — the Pre-Research Presentation Brief (Generate /
 * Regenerate / Download / Open in SharePoint / Share) and the legacy
 * Pre-Site Visit writeup (Generate / Regenerate / Download / Edit / an
 * explicit **Start Site Visit** action, B11). Share locks and distributes
 * the BRIEF (`lock-for-share`, never `start-site-visit`); starting the Site
 * Visit is a separate, explicit transition on the Pre-Site card, available
 * whenever a Ready/Draft Pre-Site row exists, independent of Share. Final
 * Writeup still requires the Pre-Site row in Review (B11); its prerequisite
 * is named on the Pre-Site card rather than surfacing a generic failure.
 *
 * Stage backing (PC Meeting Tracker slice 3, docs/PC_MEETING_TRACKER_PLAN.md
 * D5-D9; composite projection revised for the brief per plan §3.5): four
 * keyed stops — draft | shared | visit | final — derived by
 * shared/utils/deliberation-stage.js from the BRIEF's lifecycle (DRAFT /
 * REVIEW via the guarded lock-for-share route) and the wmkf_sitevisit
 * Activity's scheduled start (date-derived "visited", D7), with `final`
 * driven independently by the canonical Pre-Site row reaching FINAL
 * (Final Writeup activation marks the Pre-Site row, not the brief). Display
 * labels are admin-editable (D6; shared/config/editableTextDefaults.js) and
 * arrive on the GET /api/workbench/pre-site-visit payload as `stageLabels`.
 * "Shared" means the brief is locked (§3.4) — a substate ("not-sent"/"sent")
 * tracks whether materials have actually gone out, fed by the distribution
 * panel's onHistory callback (server-keyed to the brief's document id).
 *
 * Tab redesign (docs/plans/STAFF_DELIBERATIONS_TAB_SHAPE_BRIEF_2026-09-09.md,
 * owner-approved 2026-09-10): stage → sentence → one primary action per card.
 * Share opens the distribution composer as a dialog; the composer locks the
 * brief (guarded lock-for-share) at preview time, then sends, so the preview
 * is always built from the locked version. The session line reads the
 * tracker through the Pre-Site status payload (§5.4 seam).
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
import { siteVisitMaterialsLine } from '../../utils/site-visit-materials-line';
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

async function readBriefStatus(requestId, signal) {
  const response = await fetch(
    `/api/workbench/pre-rp-brief?requestId=${encodeURIComponent(requestId)}`,
    { method: 'GET', signal },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Brief status check failed (${response.status})`);
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

function Warnings({ warnings, label }) {
  if (!warnings.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950" role="status">
      <h4 className="font-semibold">{label}</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {warnings.map((warning, index) => (
          <li key={`${warning.code || 'warning'}-${index}`}>
            {warning.message || 'The draft completed with a review warning.'}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StaffDeliberationsTab({
  requestId,
  requestNumber = '',
  isSuperuser = false,
  onSelectTab = null,
}) {
  // Pre-Site Visit writeup state (legacy artifact; independent lifecycle).
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [artifact, setArtifact] = useState(null);
  const [pendingArtifact, setPendingArtifact] = useState(null);
  const [reopenHistory, setReopenHistory] = useState(EMPTY_LIST);
  const [stageLabels, setStageLabels] = useState(EMPTY_STAGE_LABELS);
  // The workbench keys this tab by requestId, so a mounted instance never
  // changes request: the status read starts on mount, never on a switch.
  const [checkingStatus, setCheckingStatus] = useState(Boolean(requestId));
  const [recoveryMessage, setRecoveryMessage] = useState(null);
  const [session, setSession] = useState(null);
  const [sessionAttendees, setSessionAttendees] = useState(EMPTY_LIST);
  const [materials, setMaterials] = useState(null);
  const [startingSiteVisit, setStartingSiteVisit] = useState(false);
  const [reopeningRequestId, setReopeningRequestId] = useState(null);
  const [reopenForm, setReopenForm] = useState(null);
  const [reopenError, setReopenError] = useState(null);
  const generationSequence = useRef(0);
  const activeController = useRef(null);

  // Pre-Research Presentation Brief state (the distribution source, plan §4).
  const [briefGenerating, setBriefGenerating] = useState(false);
  const [briefError, setBriefError] = useState(null);
  const [briefArtifact, setBriefArtifact] = useState(null);
  const [briefPendingArtifact, setBriefPendingArtifact] = useState(null);
  const [checkingBriefStatus, setCheckingBriefStatus] = useState(Boolean(requestId));
  const [briefRecoveryMessage, setBriefRecoveryMessage] = useState(null);
  // §3.5/H1: set true only by a SUCCESSFUL brief status fetch reporting no
  // brief rows at all (never inferred from a failed fetch), so the legacy
  // Pre-Site rail fallback below cannot fire on a `briefError`.
  const [noBriefRowsAtAll, setNoBriefRowsAtAll] = useState(false);
  const briefSequence = useRef(0);
  const briefController = useRef(null);
  // Guarded regeneration of a brief already sent to the Board (owner decision
  // 2026-09-16, plan §10) — superuser-only; mirrors the Pre-Site reopen
  // state above but targets the brief's own artifact/status.
  const [briefReopeningRequestId, setBriefReopeningRequestId] = useState(null);
  const [briefReopenForm, setBriefReopenForm] = useState(null);
  const [briefReopenError, setBriefReopenError] = useState(null);

  // Shared composer/dialog state.
  const [composerOpen, setComposerOpen] = useState(false);
  const [latestSendFailure, setLatestSendFailure] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null); // null | { kind: 'brief' | 'presite' }
  const [currentSourceEverSent, setCurrentSourceEverSent] = useState(false);
  const cancelDialogButtonRef = useRef(null);
  const confirmDialogButtonRef = useRef(null);

  useEffect(() => {
    generationSequence.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    const id = requestId;
    if (id) {
      const sequence = generationSequence.current;
      const controller = new AbortController();
      activeController.current = controller;
      readStatus(id, controller.signal)
        .then((status) => {
          if (generationSequence.current !== sequence || id !== requestId) return;
          setArtifact(status.currentArtifact || null);
          setPendingArtifact(status.pendingArtifact || null);
          setReopenHistory(status.reopenHistory || EMPTY_LIST);
          if (status.stageLabels) setStageLabels(status.stageLabels);
          setSession(status.session || null);
          setSessionAttendees(Array.isArray(status.sessionAttendees) ? status.sessionAttendees : EMPTY_LIST);
          setMaterials(status.materials || null);
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
    briefSequence.current += 1;
    briefController.current?.abort();
    briefController.current = null;
    const id = requestId;
    if (id) {
      const sequence = briefSequence.current;
      const controller = new AbortController();
      briefController.current = controller;
      readBriefStatus(id, controller.signal)
        .then((status) => {
          if (briefSequence.current !== sequence || id !== requestId) return;
          setBriefArtifact(status.currentArtifact || null);
          setBriefPendingArtifact(status.pendingArtifact || null);
          setNoBriefRowsAtAll(status.hasBriefRows === false);
          if (status.pendingArtifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED) {
            setBriefError(failureMessage(
              status.pendingArtifact,
              'The latest brief attempt failed.',
            ));
          }
        })
        .catch((statusError) => {
          if (statusError?.name !== 'AbortError'
            && briefSequence.current === sequence
            && id === requestId) {
            // A registry fault (e.g. brief_pointer_invalid) is reported, not
            // thrown — the Pre-Site card must stay usable regardless. It
            // must also NOT be treated as "no brief rows": that would
            // silently fall back to the legacy Pre-Site rail and hide a
            // real fault behind a stage that looks fine.
            setNoBriefRowsAtAll(false);
            setBriefError(statusError.message);
          }
        })
        .finally(() => {
          if (briefSequence.current === sequence && id === requestId) {
            if (briefController.current === controller) briefController.current = null;
            setCheckingBriefStatus(false);
          }
        });
    }
    return () => {
      briefSequence.current += 1;
      briefController.current?.abort();
      briefController.current = null;
    };
  }, [requestId]);

  useEffect(() => {
    if (!confirmDialog) return undefined;
    const previouslyFocused = document.activeElement;
    confirmDialogButtonRef.current?.focus();
    const busy = confirmDialog.kind === 'brief' ? briefGenerating : generating;
    const handleModalKey = (event) => {
      if (event.key === 'Escape' && !busy) {
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
  }, [confirmDialog, generating, briefGenerating]);

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
      if (status.sessionAttendees !== undefined) setSessionAttendees(Array.isArray(status.sessionAttendees) ? status.sessionAttendees : EMPTY_LIST);
      if (status.materials !== undefined) setMaterials(status.materials || null);

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

  const pollForBrief = async ({ id, sequence, controller, targetArtifactId }) => {
    for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt += 1) {
      const status = await readBriefStatus(id, controller.signal);
      if (briefSequence.current !== sequence || id !== requestId) {
        const stale = new Error('Status check aborted.');
        stale.name = 'AbortError';
        throw stale;
      }
      const current = status.currentArtifact || null;
      const pending = status.pendingArtifact || null;
      if (current) setBriefArtifact(current);
      setBriefPendingArtifact(pending);
      if (pending?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED) {
        throw new Error(failureMessage(pending, 'The latest brief attempt failed.'));
      }
      if (targetArtifactId && current?.artifactId === targetArtifactId) return current;
      if (attempt < STATUS_POLL_ATTEMPTS - 1) await waitForNextPoll(controller.signal);
    }
    throw new Error(
      'The connection was interrupted and a newly completed brief could not be confirmed. '
      + 'The current link, if shown, remains available; try Generate Brief again.',
    );
  };

  // Generation is deterministic and synchronous server-side (no AI step); the
  // only asynchronous path is a concurrent claim (202 GENERATING), so this
  // stays a compact handler rather than mirroring every recovery branch of
  // the Pre-Site `generate()` above.
  const generateBrief = async () => {
    if (!requestId || briefGenerating) return;
    const id = requestId;
    const sequence = ++briefSequence.current;
    briefController.current?.abort();
    const controller = new AbortController();
    briefController.current = controller;
    setBriefGenerating(true);
    setCheckingBriefStatus(false);
    setBriefError(null);
    setBriefPendingArtifact(null);
    setBriefRecoveryMessage(null);
    try {
      const response = await fetch('/api/workbench/pre-rp-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id, clientOperationId: newClientOperationId() }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Brief generation failed (${response.status})`);
      if (briefSequence.current !== sequence || id !== requestId) return;
      if (!body.artifact) throw new Error('Brief generation returned no artifact identity.');
      if (body.artifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) {
        setBriefPendingArtifact(body.artifact);
        setBriefRecoveryMessage('The brief is still being generated. Checking for the completed link…');
        const ready = await pollForBrief({ id, sequence, controller, targetArtifactId: body.artifact.artifactId });
        setBriefArtifact(ready);
        setBriefPendingArtifact(null);
      } else {
        setBriefArtifact(body.artifact);
      }
    } catch (generationError) {
      if (generationError?.name !== 'AbortError'
        && briefSequence.current === sequence
        && id === requestId) {
        setBriefError(generationError.message);
      }
    } finally {
      if (briefSequence.current === sequence && id === requestId) {
        if (briefController.current === controller) briefController.current = null;
        setBriefGenerating(false);
        setBriefRecoveryMessage(null);
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
  const preSiteShared = artifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW;
  const preSiteDraftReady = artifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT;
  const preSiteFinal = artifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL;
  const downloadUrl = downloadUrlFor(readyFile);

  const briefReadyFile = briefArtifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && briefArtifact.file?.webUrl
    ? briefArtifact.file
    : null;
  const briefWarnings = Array.isArray(briefArtifact?.warnings) ? briefArtifact.warnings : [];
  const briefUnchangedRetryBlocked = briefPendingArtifact?.operationStatus
    === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
    && briefPendingArtifact.retryable === false;
  const briefShared = briefArtifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW;
  const briefDraftReady = briefArtifact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT;
  const briefDownloadUrl = downloadUrlFor(briefReadyFile);
  // H3a/B10 client mirror: the server gate (`assertBriefInputsReady`,
  // `brief_reviews_required`) is authoritative; this only disables the
  // affordance early with a reason, using the same received-review count
  // captured in the brief's own generation-input snapshot.
  // `receivedReviewCount` is tri-state (null = the stored snapshot could not
  // be read; the server refuses that as `brief_snapshot_invalid`), so the two
  // blocked reasons stay distinct here as they are on the server.
  const briefSnapshotInvalid = Boolean(briefArtifact) && briefArtifact.receivedReviewCount === null;
  const briefReviewsRequired = Boolean(briefArtifact) && !briefSnapshotInvalid
    && (briefArtifact.receivedReviewCount ?? 0) === 0;
  const briefShareBlocked = briefSnapshotInvalid || briefReviewsRequired;
  const briefShareBlockedReason = briefSnapshotInvalid
    ? 'The brief\'s stored input record could not be read, so it cannot be shared. Regenerate the brief first.'
    : 'The brief has no received reviews yet. Share is blocked until at least one review is received.';

  // Server-derived (uncapped EXISTS, scoped to the CURRENT brief document) so
  // a superseded document's sends never promote its reopen successor and the
  // display cap cannot regress the stage (S466; keyed to the brief per plan
  // §3.5 since distribution's source is the brief).
  const everSent = currentSourceEverSent;

  const onDistributionHistory = useCallback((historyInfo) => {
    setCurrentSourceEverSent(historyInfo?.currentSourceEverSent === true);
    setLatestSendFailure(historyInfo?.latestSendFailure || null);
  }, []);

  // Headless read of the wmkf_sitevisit Activity (maintained outside this
  // workspace) feeding the composer's calendar/materials/suggestions, and the
  // rail's visit stop. Fail-open, so this is safe to call for every stage.
  const siteVisitContext = useSiteVisitContext(requestId);
  const siteVisitStartIso = siteVisitContext?.siteVisit?.startIso || null;

  // Plan §3.5 / H1: the composite stage projection reads the BRIEF as the
  // stage artifact (or its pending attempt while none exists yet); a request
  // with NO brief rows at all (confirmed by a successful status fetch, never
  // inferred from a failed one — see `noBriefRowsAtAll`) falls back to the
  // legacy Pre-Site artifact so a request that predates the brief still
  // shows its true stage. `finalReached` is a separate signal from the
  // canonical Pre-Site row's own lifecycle reaching FINAL, because Final
  // Writeup activation marks the Pre-Site row while the brief stays in
  // Review (B11).
  const stageFetchFailed = Boolean(briefError) && !briefArtifact && !briefPendingArtifact && !noBriefRowsAtAll;
  const { stage, substate, visit } = deriveDeliberationStage({
    stageArtifact: briefArtifact
      || briefPendingArtifact
      || (noBriefRowsAtAll ? (artifact || pendingArtifact) : null),
    finalReached: preSiteFinal,
    siteVisitStartIso,
    everSent,
  });
  const movedToFinal = stage === 'final';
  // A lifecycle outside the four keyed stops (Board Ready/Superseded/unknown —
  // never produced for the *current* brief in practice). The rail has
  // nothing meaningful to show for it, so it stays hidden (fail closed).
  const unknownLifecycle = stage === 'beyond';
  const beyondDeliberations = movedToFinal || unknownLifecycle;
  // D8/J27 (docs/PC_MEETING_TRACKER_PLAN.md): whether a visit is even expected
  // this cycle. No production caller varies it today (D26 is always true), but
  // the visit line at draft/shared is anticipatory ("not scheduled" as a PC
  // to-do) and has nothing honest to say once J27 makes a visit optional.
  const visitLineVisible = visitExpected() || stage === 'visit' || stage === 'final';

  // Locks the exact brief as the working document (guarded lock-for-share,
  // ETag-fenced). Called by the composer before it prepares the preview, so
  // the order is lock → preview → send and a lock failure lands in the
  // composer as the error. Idempotent server-side once the row is Review.
  // Never calls start-site-visit (B11): the Pre-Site transition is a
  // separate, explicit action below.
  const lockBriefForShare = async () => {
    if (!requestId || !briefReadyFile || !briefDraftReady) return;
    const id = requestId;
    const expectedArtifactId = briefArtifact.artifactId;
    const sequence = ++briefSequence.current;
    briefController.current?.abort();
    const controller = new AbortController();
    briefController.current = controller;
    try {
      const response = await fetch('/api/workbench/pre-rp-brief/lock-for-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id, expectedArtifactId }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `The brief could not be locked for sharing (${response.status})`);
      if (briefSequence.current !== sequence || id !== requestId) {
        throw new Error('The request changed while the brief was being locked.');
      }
      if (!body.artifact) throw new Error('Locking returned no artifact identity.');
      setBriefArtifact(body.artifact);
      setBriefPendingArtifact(null);
    } finally {
      if (briefSequence.current === sequence && id === requestId) {
        if (briefController.current === controller) briefController.current = null;
      }
    }
  };

  // B11: promotes the current Ready Pre-Site writeup into the Site Visit
  // workspace (unchanged route). Independent of Share — available whenever a
  // Ready/Draft Pre-Site row exists.
  const startSiteVisitAction = async () => {
    // M4: a plain early return, never a throw — this runs as a fire-and-
    // forget promise from the button's onClick, so throwing here (even
    // though the button is also disabled while startingSiteVisit) risks an
    // unhandled promise rejection rather than a caught, displayed error.
    if (!requestId || !readyFile || !preSiteDraftReady || startingSiteVisit) return;
    const id = requestId;
    const expectedArtifactId = artifact.artifactId;
    const sequence = ++generationSequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setStartingSiteVisit(true);
    setError(null);
    try {
      const response = await fetch('/api/workbench/pre-site-visit/start-site-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id, expectedArtifactId }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `The Site Visit could not be started (${response.status})`);
      if (generationSequence.current !== sequence || id !== requestId) {
        throw new Error('The request changed while the Site Visit was being started.');
      }
      if (!body.artifact) throw new Error('Starting the Site Visit returned no artifact identity.');
      setArtifact(body.artifact);
      setPendingArtifact(null);
    } catch (startError) {
      if (startError?.name !== 'AbortError'
        && generationSequence.current === sequence
        && id === requestId) setError(startError.message);
    } finally {
      if (generationSequence.current === sequence && id === requestId) {
        if (activeController.current === controller) activeController.current = null;
        setStartingSiteVisit(false);
      }
    }
  };

  const openReopenDialog = () => {
    if (!preSiteShared || !isSuperuser || reopeningRequestId === requestId || !requestNumber) return;
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
    if (!reopenFormValid || reopening || !preSiteShared || !requestId) return;

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

  const briefReopening = briefReopeningRequestId === requestId;
  const briefReopenFormValid = Boolean(
    briefReopenForm
      && requestNumber
      && Object.prototype.hasOwnProperty.call(PRE_SITE_REOPEN_REASON_LABEL, briefReopenForm.reasonCode)
      && briefReopenForm.reasonNote.trim().length >= PRE_SITE_REOPEN_CONTRACT.minimumReasonNoteLength
      && briefReopenForm.reasonNote.trim().length <= PRE_SITE_REOPEN_CONTRACT.maximumReasonNoteLength
      && briefReopenForm.typedRequestNumber === requestNumber,
  );

  const openBriefReopenDialog = () => {
    if (!briefShared || !everSent || !isSuperuser || briefReopeningRequestId === requestId
      || !requestNumber || !briefArtifact) return;
    setBriefReopenError(null);
    setBriefReopenForm({
      reasonCode: '',
      reasonNote: '',
      typedRequestNumber: '',
      clientOperationId: newClientOperationId(),
      submitted: false,
    });
  };

  const submitBriefReopen = async (event) => {
    event.preventDefault();
    if (!briefReopenFormValid || briefReopening || !briefShared || !requestId || !briefArtifact) return;

    const id = requestId;
    const expectedArtifactId = briefArtifact.artifactId;
    const sequence = ++briefSequence.current;
    briefController.current?.abort();
    const controller = new AbortController();
    briefController.current = controller;
    setBriefReopeningRequestId(id);
    setBriefReopenError(null);
    setBriefReopenForm((current) => (current ? { ...current, submitted: true } : current));
    try {
      const response = await fetch('/api/workbench/pre-rp-brief/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: id,
          expectedArtifactId,
          clientOperationId: briefReopenForm.clientOperationId,
          requestNumber: briefReopenForm.typedRequestNumber,
          reasonCode: briefReopenForm.reasonCode,
          reasonNote: briefReopenForm.reasonNote.trim(),
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Guarded brief regeneration failed (${response.status})`);
      if (briefSequence.current !== sequence || id !== requestId) return;

      // Refreshes brief status (the new artifact) and, by updating the
      // distribution panel's sourceArtifact prop below, its distribution
      // history — `everSent` re-derives against the new (never-sent) row.
      const refreshed = await readBriefStatus(id, controller.signal);
      if (briefSequence.current !== sequence || id !== requestId) return;
      setBriefArtifact(refreshed.currentArtifact || body.artifact || null);
      setBriefPendingArtifact(refreshed.pendingArtifact || null);
      if (response.status === 202
        || body.artifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) {
        setBriefReopenError(
          'This guarded regeneration is already in progress. Keep this dialog open and retry to check the same operation.',
        );
        return;
      }
      setBriefReopenForm(null);
    } catch (submitError) {
      if (submitError?.name !== 'AbortError'
        && briefSequence.current === sequence
        && id === requestId) {
        setBriefReopenError(submitError.message);
      }
    } finally {
      if (briefSequence.current === sequence && id === requestId) {
        if (briefController.current === controller) briefController.current = null;
        setBriefReopeningRequestId(null);
      }
    }
  };

  const confirmDialogContent = confirmDialog?.kind === 'brief'
    ? {
      title: 'Regenerate this brief?',
      confirmLabel: briefGenerating ? 'Regenerating…' : 'Regenerate',
      busy: briefGenerating,
      onConfirm: () => {
        setConfirmDialog(null);
        generateBrief();
      },
      body: (
        <p>
          {briefShared
            ? 'Regenerating replaces the brief currently shared for this deliberation with a new one '
              + 'from the latest proposal and review data. Edits in the current Word file will not be '
              + 'carried into the new brief, and the prior file remains in SharePoint.'
            : 'Regenerating creates a new brief from the latest proposal and review data. '
              + 'Edits in the current Word file will not be carried into the new brief, and the '
              + 'prior file remains in SharePoint.'}
        </p>
      ),
    }
    : confirmDialog?.kind === 'presite'
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
    sharedAtIso: briefArtifact?.milestone?.createdAt || null,
    visit,
  });
  // Session and visit lines belong to the stages where the PC's scheduling is
  // still ahead (draft, shared); at Visit the sentence already carries the
  // visit date, and at Final nothing is pending.
  const showSessionLine = !beyondDeliberations && stage !== 'visit';
  const showVisitLine = showSessionLine && visitLineVisible;
  // Applicant materials (plan §16.3, PR 3): shown at every stage before Final
  // once a collection exists, since the files matter through the visit.
  const materialsLine = !beyondDeliberations && stage !== 'final' ? siteVisitMaterialsLine(materials) : null;

  const briefMoreItems = [
    briefReadyFile && !beyondDeliberations && {
      key: 'download', label: 'Download', href: briefDownloadUrl, download: briefReadyFile.name || true, title: briefReadyFile.name || undefined,
    },
    // NEW-1 (Opus round 2): a brief already sent to the Board (briefShared &&
    // everSent) is not offered Regenerate — only a shared-but-not-yet-sent
    // brief (still recoverable before anyone outside staff has seen it) or a
    // plain Draft brief.
    briefReadyFile && !beyondDeliberations && (briefDraftReady || (briefShared && !everSent)) && {
      key: 'regenerate', label: 'Regenerate Brief', onSelect: () => setConfirmDialog({ kind: 'brief' }), disabled: briefGenerating || briefUnchangedRetryBlocked,
    },
    briefReadyFile && briefShared && everSent && {
      key: 'send-again', label: 'Send the deliberation email again…', onSelect: openComposer,
    },
    // Guarded regeneration of a brief already sent to the Board (owner
    // decision 2026-09-16, plan §10): superuser-only, never shown otherwise.
    briefReadyFile && briefShared && everSent && isSuperuser && !beyondDeliberations && {
      key: 'reopen-sent', label: 'Regenerate sent brief…', onSelect: openBriefReopenDialog, disabled: briefGenerating,
    },
  ].filter(Boolean);

  const preSiteMoreItems = [
    readyFile && !preSiteFinal && {
      key: 'download', label: 'Download', href: downloadUrl, download: readyFile.name || true, title: readyFile.name || undefined,
    },
    readyFile && preSiteDraftReady && {
      key: 'regenerate', label: 'Regenerate Word Draft', onSelect: () => setConfirmDialog({ kind: 'presite' }), disabled: generating || unchangedRetryBlocked,
    },
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {recoveryMessage && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm" role="status">
          {recoveryMessage}
        </div>
      )}
      {briefRecoveryMessage && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm" role="status">
          {briefRecoveryMessage}
        </div>
      )}
      <Card hover={false}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Staff Deliberations</h2>
            {stageFetchFailed && (
              <p className="mt-2 max-w-2xl text-sm text-red-800" data-testid="deliberations-stage-error">
                The deliberation stage could not be determined: {briefError}
              </p>
            )}
            {!stageFetchFailed && !unknownLifecycle && (
              <>
                <DeliberationStageRail
                  stage={stage}
                  substate={substate}
                  labels={stageLabels}
                  reopened={preSiteDraftReady && reopenHistory.length > 0}
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
                {materialsLine && (
                  <p className="mt-1 text-xs text-gray-500" data-testid="deliberations-materials-line">
                    {materialsLine}
                  </p>
                )}
                {briefShared && latestSendFailure && (
                  <p className="mt-1 text-xs font-medium text-red-700" role="alert" data-testid="deliberations-send-failure">
                    The last send failed: {latestSendFailure.message}
                  </p>
                )}
              </>
            )}
          </div>
          {movedToFinal && onSelectTab && (
            <button type="button" onClick={() => onSelectTab('final-writeup')} className={primaryClass}>
              Open Final Writeup
            </button>
          )}
        </div>
        {unknownLifecycle && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <h3 className="font-semibold">Staff Deliberations is read-only</h3>
            <p className="mt-1">
              The Pre-Research Presentation Brief has moved beyond the deliberation stages.
              It cannot be downloaded or regenerated from this tab. The Site Visit writeup
              below keeps its own actions.
            </p>
          </div>
        )}
        {movedToFinal && (
          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-950">
            <h3 className="font-semibold">Moved to Final Writeup</h3>
            <p className="mt-1">
              This tab now preserves the Staff Deliberations record. Open the Final Writeup tab to continue in Word.
            </p>
          </div>
        )}
      </Card>

      <Card hover={false}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Pre-Research Presentation Brief</h3>
            {briefError && (
              <p className="mt-2 text-sm text-red-800" role="alert">{briefError}</p>
            )}
            <div aria-live="polite">
              {checkingBriefStatus && !briefArtifact && !briefPendingArtifact && (
                <p className="mt-2 text-sm text-gray-600">Checking for an existing brief…</p>
              )}
              {briefPendingArtifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING && briefReadyFile && (
                <p className="mt-2 text-sm text-amber-800">
                  A new brief is being generated. The current link stays available until it finishes.
                </p>
              )}
              {briefUnchangedRetryBlocked && (
                <p className="mt-2 text-sm text-amber-900">
                  This attempt needs a prompt or application change before it can be retried.
                </p>
              )}
              {briefReadyFile && (
                <div className="mt-2 text-sm text-gray-700">
                  <p>
                    {briefShared ? 'Working document:' : 'Latest draft:'}{' '}
                    <a
                      href={briefReadyFile.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={briefReadyFile.name || undefined}
                      className="font-medium text-green-800 underline"
                    >
                      {briefShared ? 'Word document' : 'Word draft'}
                    </a>
                  </p>
                  <FileDetails file={briefReadyFile} />
                  <Warnings warnings={briefWarnings} label={briefShared ? 'Working document needs a quick edit check' : 'Draft needs a quick edit check'} />
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!briefReadyFile && !briefShared && (
              <button
                type="button"
                onClick={generateBrief}
                disabled={briefGenerating || !requestId || briefUnchangedRetryBlocked}
                className={primaryClass}
              >
                {briefGenerating ? 'Generating…' : 'Generate Brief'}
              </button>
            )}
            {briefReadyFile && briefDraftReady && (
              <>
                <a href={briefReadyFile.webUrl} target="_blank" rel="noopener noreferrer" className={primaryClass}>
                  Edit in Word
                </a>
                <button
                  type="button"
                  onClick={openComposer}
                  disabled={briefGenerating || briefShareBlocked}
                  title={briefShareBlocked ? briefShareBlockedReason : undefined}
                  className={secondaryClass}
                >
                  Share…
                </button>
                {briefShareBlocked && (
                  <p className="mt-1 basis-full text-xs text-gray-600">{briefShareBlockedReason}</p>
                )}
              </>
            )}
            {briefReadyFile && briefShared && stage === 'shared' && substate === 'not-sent' && (
              <>
                <button
                  type="button"
                  onClick={openComposer}
                  disabled={briefShareBlocked}
                  title={briefShareBlocked ? briefShareBlockedReason : undefined}
                  className={primaryClass}
                >
                  {latestSendFailure ? 'Resend' : 'Share…'}
                </button>
                {briefShareBlocked && (
                  <p className="mt-1 basis-full text-xs text-gray-600">{briefShareBlockedReason}</p>
                )}
                <a href={briefReadyFile.webUrl} target="_blank" rel="noopener noreferrer" className={secondaryClass}>
                  Open working document
                </a>
              </>
            )}
            {briefReadyFile && briefShared && !(stage === 'shared' && substate === 'not-sent') && (
              <>
                <a href={briefReadyFile.webUrl} target="_blank" rel="noopener noreferrer" className={primaryClass}>
                  Open working document
                </a>
                {latestSendFailure && (
                  <button type="button" onClick={openComposer} className={secondaryClass}>
                    Resend
                  </button>
                )}
              </>
            )}
            {briefMoreItems.length > 0 && <OverflowMenu label="More brief actions" items={briefMoreItems} />}
          </div>
        </div>
        {briefShared && !briefReadyFile && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <h3 className="font-semibold">Pre-Research Presentation Brief is read-only</h3>
            <p className="mt-1">
              No current Word link was returned for this record, so working controls are not
              available. Reload to retry, or contact an administrator if this persists.
            </p>
          </div>
        )}
      </Card>

      <Card hover={false}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Pre-Site Visit Writeup</h3>
            {error && (
              <p className="mt-2 text-sm text-red-800" role="alert">{error}</p>
            )}
            <div aria-live="polite">
              {checkingStatus && !artifact && !pendingArtifact && (
                <p className="mt-2 text-sm text-gray-600">Checking for an existing writeup draft…</p>
              )}
              {pendingArtifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING && readyFile && (
                <p className="mt-2 text-sm text-amber-800">
                  A new draft is being generated. The current Word link stays available until it finishes.
                </p>
              )}
              {unchangedRetryBlocked && (
                <p className="mt-2 text-sm text-amber-900">
                  This attempt needs a prompt or application change before it can be retried.
                </p>
              )}
              {readyFile && (
                <div className="mt-2 text-sm text-gray-700">
                  <p>
                    {preSiteShared || preSiteFinal ? 'Working document:' : 'Latest draft:'}{' '}
                    <a
                      href={readyFile.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={readyFile.name || undefined}
                      className="font-medium text-green-800 underline"
                    >
                      {preSiteShared || preSiteFinal
                        ? 'Word document'
                        : readyFile.lastModified
                          ? `Word draft · generated ${new Date(readyFile.lastModified).toLocaleDateString()}`
                          : 'Word draft'}
                    </a>
                  </p>
                  <FileDetails file={readyFile} />
                  <Warnings warnings={warnings} label={preSiteShared || preSiteFinal ? 'Working document needs a quick edit check' : 'Draft needs a quick edit check'} />
                </div>
              )}
              {stage === 'visit' && !preSiteShared && !preSiteFinal && (
                <p className="mt-2 text-xs font-medium text-amber-800" data-testid="final-writeup-prerequisite">
                  Start the Site Visit on this writeup before continuing to Final Writeup.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!readyFile && !preSiteShared && !preSiteFinal && (
              <button
                type="button"
                onClick={generate}
                disabled={generating || !requestId || unchangedRetryBlocked}
                className={primaryClass}
              >
                {generating ? 'Generating…' : 'Generate Word Draft'}
              </button>
            )}
            {readyFile && preSiteDraftReady && (
              <>
                <a href={readyFile.webUrl} target="_blank" rel="noopener noreferrer" className={primaryClass}>
                  Edit in Word
                </a>
                <button type="button" onClick={startSiteVisitAction} disabled={startingSiteVisit || generating} className={secondaryClass}>
                  {startingSiteVisit ? 'Starting…' : 'Start Site Visit'}
                </button>
              </>
            )}
            {readyFile && (preSiteShared || preSiteFinal) && (
              <a href={readyFile.webUrl} target="_blank" rel="noopener noreferrer" className={primaryClass}>
                Open working document
              </a>
            )}
            {stage === 'visit' && preSiteShared && onSelectTab && (
              <button type="button" onClick={() => onSelectTab('final-writeup')} className={secondaryClass}>
                Continue in Final Writeup
              </button>
            )}
            {preSiteMoreItems.length > 0 && <OverflowMenu label="More writeup actions" items={preSiteMoreItems} />}
          </div>
        </div>
        {(preSiteShared || preSiteFinal) && !readyFile && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <h3 className="font-semibold">Pre-Site Visit Writeup is read-only</h3>
            <p className="mt-1">
              No current Word link was returned for this record, so working controls are not
              available. Reload to retry, or contact an administrator if this persists.
            </p>
          </div>
        )}
      </Card>

      {briefReadyFile && (briefDraftReady || briefShared) && (
        <PreSiteDistributionPanel
          key={`distribution-${requestId}`}
          requestId={requestId}
          requestNumber={requestNumber}
          sourceArtifact={briefArtifact}
          siteVisit={siteVisitContext?.siteVisit || null}
          session={session}
          // Tracker §5.6: the session's attendees are the default recipients
          // once a slot exists; before that, the site-visit party.
          suggestedTo={sessionAttendees.length ? sessionAttendees.map((person) => person.email) : (siteVisitContext?.suggestedTo || EMPTY_LIST)}
          suggestedCc={sessionAttendees.length ? EMPTY_LIST : (siteVisitContext?.suggestedCc || EMPTY_LIST)}
          onHistory={onDistributionHistory}
          composer={composerOpen ? 'dialog' : 'hidden'}
          onCloseComposer={() => setComposerOpen(false)}
          beforePrepare={briefDraftReady ? lockBriefForShare : null}
          needsLock={briefDraftReady}
          record={briefShared}
        />
      )}

      {isSuperuser && (preSiteShared || reopenHistory.length > 0) && (
        <Card hover={false}>
          <details>
            <summary className="cursor-pointer select-none text-sm font-semibold text-gray-600">
              Administration — guarded reopen &amp; audit trail
            </summary>
            <div className="mt-3 space-y-4">
              {preSiteShared && (
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

      {/* react-hooks/refs infers ref aliasing through the dialog's ref={} props below;
          confirmDialogContent itself reads no ref (state + callbacks only). */}
      {/* eslint-disable-next-line react-hooks/refs */}
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

      {briefReopenForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="brief-reopen-title"
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
          >
            <h3 id="brief-reopen-title" className="text-lg font-semibold text-gray-900">
              Regenerate a brief the Board already received?
            </h3>
            <p className="mt-2 text-sm text-gray-700">
              The Board already received this brief. A new Draft brief will replace it for staff.
              The deliberation briefing page keeps serving the version already sent until you share again.
            </p>
            {briefReopenError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                {briefReopenError}
              </div>
            )}
            <form className="mt-4 space-y-4" onSubmit={submitBriefReopen}>
              <div>
                <label htmlFor="brief-reopen-reason" className="block text-sm font-medium text-gray-800">
                  Reason
                </label>
                <select
                  id="brief-reopen-reason"
                  value={briefReopenForm.reasonCode}
                  onChange={(event) => setBriefReopenForm((current) => ({
                    ...current,
                    reasonCode: event.target.value,
                  }))}
                  disabled={briefReopening || briefReopenForm.submitted}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select a reason</option>
                  {Object.entries(PRE_SITE_REOPEN_REASON_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="brief-reopen-note" className="block text-sm font-medium text-gray-800">
                  Correction note
                </label>
                <textarea
                  id="brief-reopen-note"
                  value={briefReopenForm.reasonNote}
                  onChange={(event) => setBriefReopenForm((current) => ({
                    ...current,
                    reasonNote: event.target.value,
                  }))}
                  minLength={PRE_SITE_REOPEN_CONTRACT.minimumReasonNoteLength}
                  maxLength={PRE_SITE_REOPEN_CONTRACT.maximumReasonNoteLength}
                  rows={4}
                  disabled={briefReopening || briefReopenForm.submitted}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {PRE_SITE_REOPEN_CONTRACT.minimumReasonNoteLength}–{PRE_SITE_REOPEN_CONTRACT.maximumReasonNoteLength} characters.
                </p>
              </div>
              <div>
                <label htmlFor="brief-reopen-confirmation" className="block text-sm font-medium text-gray-800">
                  Type request number {requestNumber} to confirm
                </label>
                <input
                  id="brief-reopen-confirmation"
                  value={briefReopenForm.typedRequestNumber}
                  onChange={(event) => setBriefReopenForm((current) => ({ ...current, typedRequestNumber: event.target.value }))}
                  autoComplete="off"
                  disabled={briefReopening || briefReopenForm.submitted}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {briefReopenForm.submitted && (
                  <p className="mt-1 text-xs text-gray-500">
                    This operation keeps its original reason and confirmation for safe retry.
                    Cancel and reopen the dialog to start a different operation.
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setBriefReopenForm(null); setBriefReopenError(null); }}
                  disabled={briefReopening}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!briefReopenFormValid || briefReopening}
                  className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {briefReopening ? 'Regenerating…' : 'Regenerate Sent Brief'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
