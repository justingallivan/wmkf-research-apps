import { useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';
import {
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

export default function SiteVisitTab({ requestId, onSelectTab }) {
  const [status, setStatus] = useState({
    requestId: null,
    artifact: null,
    pendingArtifact: null,
    error: null,
  });
  const [startingRequestId, setStartingRequestId] = useState(null);
  const sequence = useRef(0);
  const activeController = useRef(null);

  useEffect(() => {
    const currentSequence = ++sequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    if (!requestId) return () => controller.abort();

    const id = requestId;
    readStatus(id, controller.signal)
      .then((status) => {
        if (sequence.current !== currentSequence || id !== requestId) return;
        setStatus({
          requestId: id,
          artifact: status.currentArtifact || null,
          pendingArtifact: status.pendingArtifact || null,
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
  const loading = Boolean(requestId) && !statusIsCurrent;
  const starting = startingRequestId === requestId;
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
      + 'The same SharePoint file will become the working document and Pre-Site regeneration will be disabled.',
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
            </div>
          )}
          {ready && !eligible && !active && (
            <p className="mt-4 text-sm text-amber-800">
              This document has a later lifecycle state and cannot be started from this panel.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
