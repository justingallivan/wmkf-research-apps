/** Governed post-presentation materials with browser-direct MP4 upload. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, requestEnvelope, requestJson } from '../../utils/api-request';
import {
  GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES,
  fingerprintGraphBrowserUploadFile,
  nextExpectedStart,
  uploadBrowserDirectGraphFile,
  withGraphBrowserUploadLock,
} from '../../utils/graph-browser-upload';
import { Button } from '../Layout';

const MP4_MAX_BYTES = 2_000_000_000;
const FINALIZE_RETRY_DELAYS_MS = [750, 2_000];
const STATUS_CHECK_TIMEOUT_MS = 75_000;

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${bytes.toLocaleString()} bytes`;
}

function phaseCopy(state) {
  if (!state) return '';
  if (state.phase === 'pausing') return 'Pausing after the current fragment…';
  if (state.phase === 'paused' && state.reason === 'requested') return 'Paused after the last Microsoft-confirmed fragment.';
  if (state.phase === 'paused' && state.reason === 'offline_timeout') return 'Upload stopped after the connection remained offline.';
  if (state.phase === 'paused' && state.reason === 'throttled') return 'Microsoft asked the uploader to wait longer. Automatic retry stopped.';
  if (state.phase === 'paused') return 'Automatic retry stopped without losing Microsoft-confirmed progress.';
  if (state.phase === 'reconnecting') return 'Reconnecting and checking Microsoft’s confirmed range…';
  if (state.phase === 'complete') return 'Upload complete. Finishing the governed record…';
  return 'Uploading directly to Microsoft SharePoint…';
}

function pausedNotice(reason) {
  if (reason === 'requested') return 'Upload paused. Microsoft-confirmed progress is retained; choose Resume to continue with the selected file.';
  if (reason === 'offline_timeout') return 'Upload stopped after the connection remained offline. Reconnect, then choose Resume.';
  if (reason === 'throttled') return 'Microsoft throttled the upload for too long. Wait, then choose Resume.';
  return 'Automatic retry stopped. Microsoft-confirmed progress is retained; choose Resume to try again.';
}

function uploadFailureMessage(error) {
  const status = error?.status;
  const code = error?.payload?.code || error?.code;
  if (!(error instanceof ApiRequestError)) {
    if (code === 'graph_upload_network_error'
      || code === 'post_presentation_upload_status_timeout'
      || code === 'post_presentation_upload_status_unreachable') {
      return code === 'post_presentation_upload_status_timeout'
        ? 'The upload status check timed out. Check the connection, then choose Resume; confirmed progress is retained.'
        : 'The upload connection failed. Check the connection, then choose Resume; confirmed progress is retained.';
    }
    return error?.message || 'The recording upload could not continue.';
  }
  if ([401, 403].includes(status)) return 'Your sign-in is no longer authorized. Sign in again, then choose Resume.';
  if (status === 410 || ['post_presentation_upload_session_expired', 'post_presentation_upload_expired'].includes(code)) {
    return 'Microsoft confirmed that this upload session expired. Start a new upload with the same recording.';
  }
  if (code === 'post_presentation_upload_session_closed') {
    return 'Microsoft closed this upload session. Refresh the unfinished upload state, then finish saving or start a new upload.';
  }
  if (code === 'post_presentation_site_visit_changed') {
    return 'The active Site Visit changed after this upload began. Reload the page before resuming.';
  }
  if (code === 'post_presentation_resume_fingerprint_mismatch') {
    return 'The selected file does not match this unfinished upload. Reselect the original recording.';
  }
  if (code === 'post_presentation_finalize_in_progress') {
    return 'This recording is already being saved. Wait briefly, then retry.';
  }
  if (code === 'post_presentation_upload_changed') {
    return 'The unfinished upload changed while its status was checked. Reload, then retry.';
  }
  if (status >= 500) return 'The upload status service is temporarily unavailable. Retry later from Unfinished uploads.';
  return error?.message || 'The recording upload could not continue.';
}

function finalizeFailureMessage(error) {
  const code = error?.payload?.code || error?.code;
  if (!(error instanceof ApiRequestError)) {
    return 'The recording could not be saved because the connection failed. Retry from Unfinished uploads; the Microsoft-confirmed file is retained.';
  }
  if ([401, 403].includes(error.status)) {
    return 'Your sign-in is no longer authorized. Sign in again, then choose Finish saving.';
  }
  if (error.status === 410
    || ['post_presentation_upload_session_expired', 'post_presentation_upload_expired'].includes(code)) {
    return 'Microsoft confirmed that this upload can no longer be saved. Start a new upload with the same recording.';
  }
  if (code === 'post_presentation_finalize_in_progress') {
    return 'This recording is already being saved. Wait briefly, then retry Finish saving.';
  }
  if (code === 'post_presentation_slot_busy') {
    return 'The recording save slot remained busy after bounded retries. Retry Finish saving; the Microsoft-confirmed file is retained.';
  }
  if (error.status >= 500) {
    return 'The recording save service is temporarily unavailable. Retry Finish saving later; the Microsoft-confirmed file is retained.';
  }
  return error.message || 'The recording could not be saved.';
}

function validateUploadContract(upload, { expectedUploadId, requireIncomplete = false } = {}) {
  const validId = typeof upload?.uploadId === 'string' && upload.uploadId.length > 0;
  const expectedMatches = !expectedUploadId || upload?.uploadId === expectedUploadId;
  const complete = upload?.complete === true;
  const validTransfer = (!requireIncomplete && complete) || (
    !complete
    && typeof upload?.uploadUrl === 'string'
    && upload.uploadUrl.length > 0
    && Array.isArray(upload.nextExpectedRanges)
    && upload.nextExpectedRanges.length > 0
    && upload.chunkBytes === GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES
  );
  if (!validId || !expectedMatches || !validTransfer) {
    throw Object.assign(new Error('The upload service returned an invalid transfer contract. Reload and retry.'), {
      code: 'post_presentation_upload_contract_invalid',
    });
  }
  return upload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function PostPresentationMaterialsCard({ requestId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyUploadId, setBusyUploadId] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [pauseRequested, setPauseRequested] = useState(false);
  const [link, setLink] = useState(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const [confirmReissue, setConfirmReissue] = useState(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const controllerRef = useRef(null);
  const pauseControllerRef = useRef(null);
  const pauseRef = useRef(false);
  const linkIdRef = useRef(null);
  const linkEpochRef = useRef(0);
  const linkReadRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      controllerRef.current?.abort();
      pauseControllerRef.current?.abort();
    };
  }, []);

  const current = (generation) => mountedRef.current && generation === generationRef.current;

  const applyLink = useCallback((nextLink) => {
    const nextId = nextLink?.id || null;
    if (linkIdRef.current !== nextId) {
      setLinkCopied(false);
      setManualCopy(false);
      setConfirmReissue(false);
      setLinkError(null);
    }
    linkIdRef.current = nextId;
    setLink(nextLink || null);
  }, []);

  const loadLink = useCallback(async (generation) => {
    const epoch = linkEpochRef.current;
    const readId = ++linkReadRef.current;
    const isCurrentLinkRead = () => current(generation)
      && epoch === linkEpochRef.current
      && readId === linkReadRef.current;
    try {
      const result = await requestEnvelope(
        `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-link`,
        { tolerantBody: true },
      );
      if (!isCurrentLinkRead()) return { ok: false, stale: true };
      if (result.ok) {
        applyLink(result.data.link || null);
        return { ok: true };
      }
      setLinkError(result.data?.error || 'The presentation link could not be loaded.');
      return { ok: false };
    } catch (linkLoadError) {
      if (!isCurrentLinkRead()) return { ok: false, stale: true };
      setLinkError(linkLoadError.message || 'The presentation link could not be loaded.');
      return { ok: false };
    }
  }, [applyLink, requestId]);

  const load = useCallback(async () => {
    if (!requestId) return;
    const generation = generationRef.current;
    setLoading(true);
    try {
      const result = await requestEnvelope(
        `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-materials`,
        { tolerantBody: true },
      );
      if (!current(generation)) return;
      if ([404, 503].includes(result.status)) {
        setUnavailable(true);
        return;
      }
      if (!result.ok) throw result.error;
      setData(result.data);
      setUnavailable(false);
      setError(null);
      void loadLink(generation);
    } catch (loadError) {
      if (current(generation)) setError(loadError.message || 'Presentation materials could not be loaded.');
    } finally {
      if (current(generation)) setLoading(false);
    }
  }, [loadLink, requestId]);

  useEffect(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    pauseControllerRef.current?.abort();
    controllerRef.current = null;
    pauseControllerRef.current = null;
    pauseRef.current = false;
    const timer = window.setTimeout(() => {
      setData(null);
      setFile(null);
      setError(null);
      setNotice(null);
      setBusyUploadId(null);
      setTransfer(null);
      setPauseRequested(false);
      setUnavailable(false);
      linkIdRef.current = null;
      linkEpochRef.current += 1;
      linkReadRef.current += 1;
      setLink(null);
      setLinkBusy(false);
      setLinkError(null);
      setLinkCopied(false);
      setManualCopy(false);
      setConfirmReissue(false);
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, requestId]);

  const finalize = async (uploadId, generation) => {
    for (let attempt = 0; attempt <= FINALIZE_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const result = await requestJson(
          `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-uploads/${encodeURIComponent(uploadId)}/finalize`,
          { method: 'POST', body: {}, tolerantBody: true },
        );
        if (!current(generation)) return null;
        setData(result);
        setNotice('Recording saved.');
        setTransfer(null);
        return result;
      } catch (finalizeError) {
        if (!current(generation)) return null;
        const retryable = finalizeError?.payload?.code === 'post_presentation_slot_busy';
        if (!retryable || attempt === FINALIZE_RETRY_DELAYS_MS.length) throw finalizeError;
        await sleep(FINALIZE_RETRY_DELAYS_MS[attempt]);
      }
    }
    return null;
  };

  const requestUploadStatus = async ({ uploadId, fingerprint, signal }) => {
    const statusController = new AbortController();
    let timedOut = false;
    const abortForCaller = () => statusController.abort();
    if (signal?.aborted) abortForCaller();
    else signal?.addEventListener('abort', abortForCaller, { once: true });
    const timeout = window.setTimeout(() => {
      timedOut = true;
      statusController.abort();
    }, STATUS_CHECK_TIMEOUT_MS);
    let body;
    try {
      body = await requestJson(
        `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-uploads/${encodeURIComponent(uploadId)}/resume`,
        {
          method: 'POST',
          body: { resumeFingerprint: fingerprint },
          signal: statusController.signal,
          tolerantBody: true,
        },
      );
    } catch (statusError) {
      if (!timedOut) {
        if (signal?.aborted || statusError instanceof ApiRequestError) throw statusError;
        throw Object.assign(new Error('The authorized upload status could not be reached.'), {
          code: 'post_presentation_upload_status_unreachable',
        });
      }
      throw Object.assign(new Error('The authorized upload status check timed out.'), {
        code: 'post_presentation_upload_status_timeout',
      });
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abortForCaller);
    }
    return validateUploadContract(body?.upload, { expectedUploadId: uploadId });
  };

  const runUpload = async ({ selectedFile, fingerprint, upload }) => {
    const generation = generationRef.current;
    const controller = new AbortController();
    const pauseController = new AbortController();
    controllerRef.current?.abort();
    pauseControllerRef.current?.abort();
    controllerRef.current = controller;
    pauseControllerRef.current = pauseController;
    pauseRef.current = false;
    setPauseRequested(false);
    setBusyUploadId(upload.uploadId);
    setError(null);
    setNotice(null);
    const authorizeStatus = async () => requestUploadStatus({
      uploadId: upload.uploadId,
      fingerprint,
      signal: controller.signal,
    });
    let finalizing = false;
    try {
      const result = await withGraphBrowserUploadLock(upload.lockKey || upload.uploadId, () =>
        uploadBrowserDirectGraphFile({
          file: selectedFile,
          uploadUrl: upload.uploadUrl,
          start: nextExpectedStart(upload.nextExpectedRanges),
          chunkBytes: GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES,
          signal: controller.signal,
          pauseSignal: pauseController.signal,
          shouldPause: () => pauseRef.current,
          authorizeStatus,
          onState: (state) => {
            if (current(generation)) setTransfer({ ...state, uploadId: upload.uploadId });
          },
        }));
      if (!current(generation)) return;
      if (result.complete) {
        finalizing = true;
        await finalize(upload.uploadId, generation);
      }
      else setNotice(pausedNotice(result.reason));
      await load();
    } catch (uploadError) {
      if (uploadError?.name !== 'AbortError' && current(generation)) {
        const message = finalizing ? finalizeFailureMessage(uploadError) : uploadFailureMessage(uploadError);
        setTransfer(null);
        await load();
        if (current(generation)) setError(message);
      }
    } finally {
      if (current(generation)) {
        setBusyUploadId(null);
        setPauseRequested(false);
        controllerRef.current = null;
        pauseControllerRef.current = null;
      }
    }
  };

  const begin = async () => {
    if (!file) return;
    const generation = generationRef.current;
    if (file.type !== 'video/mp4' || !/\.mp4$/i.test(file.name)
      || !Number.isInteger(file.size) || file.size <= 0 || file.size > MP4_MAX_BYTES) {
      setError('Choose one MP4 no larger than 2,000,000,000 bytes.');
      return;
    }
    setBusyUploadId('new');
    setError(null);
    try {
      const fingerprint = await fingerprintGraphBrowserUploadFile(file);
      if (!current(generation)) return;
      const operationId = globalThis.crypto?.randomUUID?.();
      if (!operationId) throw new Error('This browser cannot create a secure upload identity.');
      const body = await requestJson(
        `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-uploads`,
        {
          method: 'POST',
          body: {
            artifactType: 'recording', operationId, filename: file.name,
            contentType: file.type, size: file.size, resumeFingerprint: fingerprint,
          },
          tolerantBody: true,
        },
      );
      if (!current(generation)) return;
      const upload = validateUploadContract(body?.upload, {
        expectedUploadId: operationId,
        requireIncomplete: true,
      });
      await runUpload({ selectedFile: file, fingerprint, upload });
    } catch (beginError) {
      if (current(generation)) setError(beginError.message || 'The recording upload could not start.');
    } finally {
      if (current(generation)) setBusyUploadId(null);
    }
  };

  const resume = async (intent) => {
    if (!file || file.name !== intent.filename || file.size !== intent.size) {
      setError(`Reselect ${intent.filename} (${formatBytes(intent.size)}) to resume this upload.`);
      return;
    }
    const generation = generationRef.current;
    setBusyUploadId(intent.uploadId);
    setError(null);
    const statusController = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = statusController;
    let finalizing = false;
    try {
      const fingerprint = await fingerprintGraphBrowserUploadFile(file);
      if (!current(generation)) return;
      const upload = await requestUploadStatus({
        uploadId: intent.uploadId,
        fingerprint,
        signal: statusController.signal,
      });
      if (!current(generation)) return;
      if (upload.complete) {
        finalizing = true;
        await finalize(intent.uploadId, generation);
        await load();
        return;
      }
      await runUpload({ selectedFile: file, fingerprint, upload });
    } catch (resumeError) {
      if (resumeError?.name !== 'AbortError' && current(generation)) {
        const message = finalizing ? finalizeFailureMessage(resumeError) : uploadFailureMessage(resumeError);
        setTransfer(null);
        await load();
        if (current(generation)) setError(message);
      }
    } finally {
      if (current(generation)) {
        setBusyUploadId(null);
        if (controllerRef.current === statusController) controllerRef.current = null;
      }
    }
  };

  const finish = async (uploadId) => {
    const generation = generationRef.current;
    setBusyUploadId(uploadId);
    setError(null);
    try {
      await finalize(uploadId, generation);
      await load();
    } catch (finishError) {
      if (current(generation)) setError(finalizeFailureMessage(finishError));
    } finally {
      if (current(generation)) setBusyUploadId(null);
    }
  };

  const mutateLink = async (action) => {
    const generation = generationRef.current;
    const mutationEpoch = ++linkEpochRef.current;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const body = await requestJson(
        `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-link`,
        {
          method: 'POST',
          body: {
            action,
            ...(action === 'reissue' ? { expectedLinkId: link?.id } : {}),
          },
          tolerantBody: true,
        },
      );
      if (!current(generation) || mutationEpoch !== linkEpochRef.current) return;
      linkEpochRef.current += 1;
      applyLink(body.link || null);
    } catch (linkMutationError) {
      if (current(generation)
        && mutationEpoch === linkEpochRef.current
        && linkMutationError?.payload?.code === 'presentation_link_superseded') {
        linkEpochRef.current += 1;
        setConfirmReissue(false);
        applyLink(null);
        const refreshed = await loadLink(generation);
        if (current(generation) && refreshed.ok) {
          setLinkError('Another action replaced this link first. The current link has been refreshed.');
        }
      } else if (current(generation) && mutationEpoch === linkEpochRef.current) {
        linkEpochRef.current += 1;
        setLinkError(linkMutationError.message || 'The presentation link could not be updated.');
      }
    } finally {
      if (current(generation)) setLinkBusy(false);
    }
  };

  const copyLink = async () => {
    const generation = generationRef.current;
    try {
      await navigator.clipboard.writeText(link.url);
      if (!current(generation)) return;
      setLinkCopied(true);
      setManualCopy(false);
    } catch {
      if (!current(generation)) return;
      setLinkCopied(false);
      setManualCopy(true);
      setLinkError('Automatic copy was blocked. Select and copy the link below.');
    }
  };

  if (unavailable) return null;
  const intents = data?.uploads || [];
  const confirmed = transfer?.confirmedBytes || 0;
  const inFlight = Math.max(0, (transfer?.inFlightBytes || confirmed) - confirmed);

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm" data-testid="post-presentation-materials-card">
      <h2 className="text-xl font-semibold text-gray-900">Post-presentation materials</h2>
      <p className="mt-1 text-sm text-gray-600">Upload a Zoom MP4 directly to the request’s governed SharePoint folder. File bytes do not pass through this application.</p>
      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{notice}</div>}
      {loading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}

      {!loading && (
        <>
          <label htmlFor="post-presentation-mp4" className="mt-4 block text-sm font-medium text-gray-800">Zoom MP4</label>
          <input
            id="post-presentation-mp4"
            type="file"
            accept="video/mp4,.mp4"
            disabled={Boolean(busyUploadId)}
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="mt-2 block w-full rounded-lg border border-gray-300 p-2 text-sm"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" disabled={!file || Boolean(busyUploadId)} loading={busyUploadId === 'new'} onClick={begin}>Upload recording</Button>
            {busyUploadId && transfer?.phase && !['paused', 'complete'].includes(transfer.phase) && (
              <Button type="button" variant="outline" disabled={pauseRequested} onClick={() => {
                pauseRef.current = true;
                pauseControllerRef.current?.abort();
                setPauseRequested(true);
                setTransfer((value) => value ? { ...value, phase: 'pausing', etaSeconds: null } : value);
              }}>Pause after fragment</Button>
            )}
          </div>

          {transfer && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950" aria-live="polite">
              <p className="font-semibold">{phaseCopy(transfer)}</p>
              <progress className="mt-3 w-full" max="100" value={transfer.percent || 0} aria-label="Graph-confirmed upload progress" />
              <p className="mt-2">Graph-confirmed: {formatBytes(confirmed)} of {formatBytes(transfer.totalBytes)}</p>
              <p>In flight, not yet confirmed: {formatBytes(inFlight)}</p>
              <p>Throughput: {transfer.mbps == null ? (transfer.rateStale ? 'Unknown while waiting' : 'Measuring…') : `${transfer.mbps.toFixed(2)} Mbps`}</p>
              <p>ETA: {transfer.etaSeconds == null ? 'Unknown while waiting' : `${Math.ceil(transfer.etaSeconds)} seconds`}</p>
            </div>
          )}

          {intents.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-gray-900">Unfinished uploads</h3>
              <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
                {intents.map((intent) => (
                  <li key={intent.uploadId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div><p className="font-medium text-gray-900">{intent.filename}</p><p className="text-xs text-gray-500">{formatBytes(intent.size)} · {intent.state}</p></div>
                    <div className="flex gap-2">
                      {intent.canResume && <Button type="button" size="sm" variant="outline" disabled={Boolean(busyUploadId)} onClick={() => resume(intent)}>Resume</Button>}
                      {intent.canFinalize && <Button type="button" size="sm" disabled={Boolean(busyUploadId)} loading={busyUploadId === intent.uploadId} onClick={() => finish(intent.uploadId)}>Finish saving</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data?.materials?.length > 0 && (
            <ul className="mt-5 divide-y divide-gray-100 rounded-lg border border-gray-200">
              {data.materials.map((material) => <li key={material.artifactId} className="px-4 py-3 text-sm text-gray-800">{material.label || material.filename || material.artifactTypeLabel || 'Presentation material'}</li>)}
            </ul>
          )}

          <div className="mt-6 rounded-lg border border-gray-200 p-4" data-testid="presentation-link-controls">
            <h3 className="text-sm font-semibold text-gray-900">Board presentation link</h3>
            <p className="mt-1 text-xs text-gray-600">This materials-only link does not send email or change recipients.</p>
            {!link && (
              <Button type="button" size="sm" className="mt-3" loading={linkBusy} disabled={linkBusy} onClick={() => mutateLink('ensure')}>Generate link</Button>
            )}
            {link && (
              <>
                {link.url ? (
                  <>
                    <p className="mt-3 truncate font-mono text-xs text-gray-500" title={link.url}>{link.url}</p>
                    {manualCopy && <input aria-label="Presentation link for manual copy" readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} className="mt-2 w-full rounded border border-gray-300 p-2 font-mono text-xs" />}
                    <p className="mt-1 text-xs text-gray-500">Expires {new Date(link.expiresAt).toLocaleDateString()}.</p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-amber-800">The current link cannot be read. Issue a new link to replace it.</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {link.url && <Button type="button" size="sm" variant="outline" onClick={copyLink}>{linkCopied ? 'Copied' : 'Copy link'}</Button>}
                  {!confirmReissue && <Button type="button" size="sm" variant="outline" disabled={linkBusy} onClick={() => setConfirmReissue(true)}>Issue new link</Button>}
                </div>
                {confirmReissue && (
                  <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <p>The current presentation link will stop working immediately.</p>
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" loading={linkBusy} disabled={linkBusy} onClick={() => mutateLink('reissue')}>Issue new link</Button>
                      <Button type="button" size="sm" variant="outline" disabled={linkBusy} onClick={() => setConfirmReissue(false)}>Keep current link</Button>
                    </div>
                  </div>
                )}
              </>
            )}
            {linkError && <p role="alert" className="mt-2 text-sm text-red-700">{linkError}</p>}
          </div>
        </>
      )}
    </section>
  );
}
