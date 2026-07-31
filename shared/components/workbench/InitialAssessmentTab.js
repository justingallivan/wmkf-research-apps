import { useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../config/requestDocument';
import ArtifactFileMetadata from './ArtifactFileMetadata';

export default function InitialAssessmentTab({ requestId }) {
  const [artifact, setArtifact] = useState(null);
  const [latestAttempt, setLatestAttempt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const loadSequence = useRef(0);
  const generationSequence = useRef(0);
  const monitoredStatus = (latestAttempt || artifact)?.operationStatus;

  useEffect(() => {
    if (!requestId) return undefined;
    const sequence = ++loadSequence.current;
    generationSequence.current += 1;
    (async () => {
      try {
        const response = await fetch(
          `/api/workbench/initial-assessment?requestId=${encodeURIComponent(requestId)}`,
        );
        const body = await response.json().catch(() => ({}));
        if (loadSequence.current !== sequence) return;
        if (!response.ok) throw new Error(body.error || `Failed to load artifact (${response.status})`);
        setArtifact(body.artifacts?.[0] || null);
        setLatestAttempt(body.latestAttempts?.[0] || null);
      } catch (loadError) {
        if (loadSequence.current === sequence) setError(loadError.message);
      } finally {
        if (loadSequence.current === sequence) setLoading(false);
      }
    })();
    return () => {
      loadSequence.current += 1;
      generationSequence.current += 1;
    };
  }, [requestId]);

  useEffect(() => {
    if (!requestId || generating
      || monitoredStatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) {
      return undefined;
    }
    const interval = setInterval(async () => {
      const id = requestId;
      const sequence = ++loadSequence.current;
      try {
        const response = await fetch(
          `/api/workbench/initial-assessment?requestId=${encodeURIComponent(id)}`,
        );
        const body = await response.json().catch(() => ({}));
        if (loadSequence.current !== sequence || id !== requestId) return;
        if (!response.ok) throw new Error(body.error || `Failed to refresh artifact (${response.status})`);
        setArtifact(body.artifacts?.[0] || null);
        setLatestAttempt(body.latestAttempts?.[0] || null);
        setError(null);
      } catch (pollError) {
        if (loadSequence.current === sequence) setError(pollError.message);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [generating, monitoredStatus, requestId]);

  const generate = async () => {
    const id = requestId;
    loadSequence.current += 1;
    const sequence = ++generationSequence.current;
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch('/api/workbench/initial-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id }),
      });
      const body = await response.json().catch(() => ({}));
      if (generationSequence.current !== sequence || id !== requestId) return;
      if (!response.ok) throw new Error(body.error || `Generation failed (${response.status})`);
      const returned = body.artifact || null;
      if (returned?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
        setArtifact(returned);
        setLatestAttempt(null);
      } else if (artifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
        setLatestAttempt(returned);
      } else {
        setArtifact(returned);
        setLatestAttempt(null);
      }
    } catch (generationError) {
      if (generationSequence.current === sequence) setError(generationError.message);
    } finally {
      if (generationSequence.current === sequence) setGenerating(false);
    }
  };

  if (loading) {
    return <Card hover={false}><p className="text-sm text-gray-500">Loading Initial Assessment…</p></Card>;
  }

  const ready = artifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY;
  const attempt = latestAttempt || (ready ? null : artifact);
  const inProgress = attempt?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING;
  const retryable = attempt?.retryable === true;

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}
      <Card hover={false}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Initial Assessment</h2>
            <p className="text-sm text-gray-600 mt-1">
              Creates a governed Word draft in <code>Artifacts/Initial Assessment/</code>.
              Summary and three proposal-grounded rationale sections are drafted by AI;
              Foundation Opportunity remains explicitly staff-required.
            </p>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={
              generating
              || (inProgress && !retryable)
              || !requestId
            }
            className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium disabled:opacity-50"
          >
            {ready && !latestAttempt
              ? 'Refresh from current inputs'
              : generating || (inProgress && !retryable)
                ? 'Generating…'
                : retryable
                  ? 'Retry draft'
                  : 'Generate draft'}
          </button>
        </div>

        {artifact && (
          <div className="mt-5 border-t border-gray-200 pt-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{artifact.operationLabel}</span>
              <span className="text-gray-400">·</span>
              <span className="text-gray-600">{artifact.lifecycleLabel}</span>
              {artifact.attemptCount > 1 && (
                <span className="text-gray-500">· {artifact.attemptCount} attempts</span>
              )}
            </div>
            {ready && artifact.file && (
              <ArtifactFileMetadata
                file={artifact.file}
                linkLabel={`Open ${artifact.file.name || 'Initial Assessment'} in Word/SharePoint →`}
              />
            )}
            {artifact.lastError && (
              <p className="mt-3 text-red-700">
                Last attempt: {artifact.lastError.message}
              </p>
            )}
            {artifact.cleanupRequired?.length > 0 && (
              <p className="mt-3 text-amber-800">
                SharePoint cleanup is required for {artifact.cleanupRequired.length} retained
                file{artifact.cleanupRequired.length === 1 ? '' : 's'}. The exact item IDs are
                recorded for an administrator.
              </p>
            )}
            {inProgress && !retryable && attempt.retryAfterAt && (
              <p className="mt-3 text-gray-500">
                This operation is being monitored. If it stalls, retry unlocks after{' '}
                {new Date(attempt.retryAfterAt).toLocaleTimeString()}.
              </p>
            )}
          </div>
        )}
        {latestAttempt && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-900">
              Replacement attempt: {latestAttempt.operationLabel}
            </p>
            <p className="mt-1 text-amber-800">
              The Ready document above remains canonical until this replacement succeeds.
            </p>
            {latestAttempt.lastError && (
              <p className="mt-2 text-red-700">
                Last attempt: {latestAttempt.lastError.message}
              </p>
            )}
            {latestAttempt.cleanupRequired?.length > 0 && (
              <p className="mt-2 text-amber-900">
                SharePoint cleanup is required for {latestAttempt.cleanupRequired.length} retained
                file{latestAttempt.cleanupRequired.length === 1 ? '' : 's'}.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
