import { useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';
import PreSiteDistributionPanel from './PreSiteDistributionPanel';
import {
  PRE_SITE_REOPEN_CONTRACT,
  PRE_SITE_REOPEN_REASON_LABEL,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../config/requestDocument';

async function readStatus(requestId, signal) {
  const response = await fetch(
    `/api/workbench/pre-site-visit?requestId=${encodeURIComponent(requestId)}`,
    { method: 'GET', signal },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Status check failed (${response.status})`);
  return body;
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

export default function SiteVisitTab({ requestId, requestNumber = '', isSuperuser = false, onSelectTab }) {
  const [status, setStatus] = useState({
    requestId: null,
    artifact: null,
    pendingArtifact: null,
    reopenHistory: [],
    error: null,
  });
  const [startingRequestId, setStartingRequestId] = useState(null);
  const [reopeningRequestId, setReopeningRequestId] = useState(null);
  const [reopenForm, setReopenForm] = useState(null);
  const [reopenError, setReopenError] = useState(null);
  const sequence = useRef(0);
  const activeController = useRef(null);

  useEffect(() => {
    const currentSequence = ++sequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setReopenForm(null);
    setReopenError(null);
    if (!requestId) return () => controller.abort();

    const id = requestId;
    readStatus(id, controller.signal)
      .then((status) => {
        if (sequence.current !== currentSequence || id !== requestId) return;
        setStatus({
          requestId: id,
          artifact: status.currentArtifact || null,
          pendingArtifact: status.pendingArtifact || null,
          reopenHistory: status.reopenHistory || [],
          error: null,
        });
      })
      .catch((statusError) => {
        if (statusError?.name !== 'AbortError'
          && sequence.current === currentSequence
          && id === requestId) {
          setStatus({
            requestId: id,
            artifact: null,
            pendingArtifact: null,
            reopenHistory: [],
            error: statusError.message,
          });
        }
      });
    return () => {
      sequence.current += 1;
      controller.abort();
      if (activeController.current === controller) activeController.current = null;
    };
  }, [requestId]);

  const statusIsCurrent = status.requestId === requestId;
  const artifact = statusIsCurrent ? status.artifact : null;
  const pendingArtifact = statusIsCurrent ? status.pendingArtifact : null;
  const error = statusIsCurrent ? status.error : null;
  const reopenHistory = statusIsCurrent ? status.reopenHistory : [];
  const loading = Boolean(requestId) && !statusIsCurrent;
  const starting = startingRequestId === requestId;
  const reopening = reopeningRequestId === requestId;
  const ready = artifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && artifact.file?.webUrl
    ? artifact
    : null;
  const active = ready?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW;
  const eligible = ready?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT;
  const downloadUrl = downloadUrlFor(ready?.file);

  const startSiteVisit = async () => {
    if (!eligible || starting || !requestId) return;
    if (!window.confirm(
      'Start the Site Visit stage using this exact Word draft? '
      + 'The exact current SharePoint version will be recorded. Staff will continue editing '
      + 'the same file in Word, and Pre-Site regeneration will be disabled.',
    )) return;

    const id = requestId;
    const expectedArtifactId = ready.artifactId;
    const currentSequence = ++sequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setStartingRequestId(id);
    setStatus((current) => (
      current.requestId === id ? { ...current, error: null } : current
    ));
    try {
      const response = await fetch('/api/workbench/pre-site-visit/start-site-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id, expectedArtifactId }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Site Visit handoff failed (${response.status})`);
      if (sequence.current !== currentSequence || id !== requestId) return;
      if (!body.artifact) throw new Error('Site Visit handoff returned no artifact identity.');
      setStatus({
        requestId: id,
        artifact: body.artifact,
        pendingArtifact: null,
        reopenHistory,
        error: null,
      });
    } catch (startError) {
      if (startError?.name !== 'AbortError'
        && sequence.current === currentSequence
        && id === requestId) {
        setStatus((current) => ({
          requestId: id,
          artifact: current.requestId === id ? current.artifact : null,
          pendingArtifact: current.requestId === id ? current.pendingArtifact : null,
          reopenHistory: current.requestId === id ? current.reopenHistory : [],
          error: startError.message,
        }));
      }
    } finally {
      if (sequence.current === currentSequence && id === requestId) {
        if (activeController.current === controller) activeController.current = null;
        setStartingRequestId(null);
      }
    }
  };

  const openReopenDialog = () => {
    if (!active || !isSuperuser || reopening || !requestNumber) return;
    setReopenError(null);
    setReopenForm({
      reasonCode: '',
      reasonNote: '',
      typedRequestNumber: '',
      clientOperationId: newClientOperationId(),
      submitted: false,
    });
  };

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
    if (!reopenFormValid || reopening || !active || !requestId) return;

    const id = requestId;
    const expectedArtifactId = ready.artifactId;
    const currentSequence = ++sequence.current;
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
      if (sequence.current !== currentSequence || id !== requestId) return;

      const refreshed = await readStatus(id, controller.signal);
      if (sequence.current !== currentSequence || id !== requestId) return;
      setStatus({
        requestId: id,
        artifact: refreshed.currentArtifact || body.artifact || null,
        pendingArtifact: refreshed.pendingArtifact || null,
        reopenHistory: refreshed.reopenHistory || [],
        error: null,
      });
      if (response.status === 202 || body.inProgress) {
        setReopenError('This guarded reopen is already in progress. Keep this dialog open and retry to check the same operation.');
        return;
      }
      setReopenForm(null);
      onSelectTab?.('pre-site-visit');
    } catch (submitError) {
      if (submitError?.name !== 'AbortError'
        && sequence.current === currentSequence
        && id === requestId) {
        setReopenError(submitError.message);
      }
    } finally {
      if (sequence.current === currentSequence && id === requestId) {
        if (activeController.current === controller) activeController.current = null;
        setReopeningRequestId(null);
      }
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}
      <Card hover={false}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Site Visit</h2>
            {active && (
              <p className="mt-1 text-sm font-medium text-green-800">Site Visit in progress</p>
            )}
          </div>
          {active && ready?.file && (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={ready.file.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
              >
                Edit
              </a>
              <a
                href={downloadUrl}
                download={ready.file.name || true}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                Download
              </a>
            </div>
          )}
        </div>

        <div aria-live="polite">
          {loading && !artifact && (
            <p className="mt-4 text-sm text-gray-600">Checking for the current Pre-Site draft…</p>
          )}
          {!loading && !ready && (
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm text-gray-700">
                {pendingArtifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
                  ? 'The Pre-Site Word draft is still being generated.'
                  : 'A Ready Pre-Site Word draft is required before the Site Visit stage can begin.'}
              </p>
              <button
                type="button"
                onClick={() => onSelectTab?.('pre-site-visit')}
                className="mt-3 text-sm font-medium text-gray-900 underline"
              >
                Go to Pre Site Visit Writeup →
              </button>
            </div>
          )}
          {eligible && ready?.file && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-gray-800">
                Continue with{' '}
                <a
                  href={ready.file.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                >
                  {ready.file.name || 'the latest Word draft'}
                </a>
                {' '}as the Site Visit workspace. Staff observations will be entered directly into this same file.
              </p>
              <p className="mt-2 text-sm text-gray-700">
                Starting the stage records the exact current SharePoint version and disables further Pre-Site regeneration.
              </p>
              <button
                type="button"
                onClick={startSiteVisit}
                disabled={starting}
                className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {starting ? 'Starting…' : 'Start Site Visit Stage'}
              </button>
            </div>
          )}
          {active && ready?.file && (
            <div className="mt-4 text-sm text-gray-700">
              <p>
                Working document:{' '}
                <a
                  href={ready.file.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                >
                  {ready.file.name || 'Open Word document'}
                </a>
              </p>
              {ready.milestone?.createdAt && (
                <p className="mt-1 text-xs text-gray-500">
                  Site Visit handoff recorded {new Date(ready.milestone.createdAt).toLocaleString()}.
                </p>
              )}
              {isSuperuser && (
                <button
                  type="button"
                  onClick={openReopenDialog}
                  disabled={reopening || !requestNumber}
                  className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                >
                  Reopen Pre-Site Draft
                </button>
              )}
            </div>
          )}
          {ready && !eligible && !active && (
            <p className="mt-4 text-sm text-amber-800">
              This document has a later lifecycle state and cannot be started from this panel.
            </p>
          )}
        </div>
      </Card>

      {active && ready && (
        <PreSiteDistributionPanel
          key={requestId}
          requestId={requestId}
          requestNumber={requestNumber}
          sourceArtifact={ready}
        />
      )}

      {reopenHistory.length > 0 && (
        <Card hover={false}>
          <h3 className="text-base font-semibold text-gray-900">Guarded reopen attempts</h3>
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
        </Card>
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
