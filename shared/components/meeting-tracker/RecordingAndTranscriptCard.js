/** Site Visit "Recording and transcript" card: recording, transcript upload/generation, speaker names, board link. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, requestEnvelope, requestJson } from '../../utils/api-request';
import {
  GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES,
  fingerprintGraphBrowserUploadFile,
  nextExpectedStart,
  uploadBrowserDirectGraphFile,
  withGraphBrowserUploadLock,
} from '../../utils/graph-browser-upload';
import { normalizeZoomPaste } from '../../../lib/services/post-presentation-materials/material-model';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../config/requestDocument';
import { Button } from '../Layout';
import { getTranscriptSpeakers, groupTranscriptByTurn } from '../../../lib/services/transcription-pilot/transcript-format';
import { MAX_TRANSCRIPTION_BYTES as MAX_AUDIO_BYTES, MAX_TRANSCRIPTION_MIB } from '../../../lib/services/transcription-pilot/limits';

const MP4_MAX_BYTES = 2_000_000_000;
const TRANSCRIPT_MAX_BYTES = 25 * 1024 * 1024;
const TRANSCRIPT_CONTENT_TYPES = Object.freeze({
  vtt: 'text/vtt',
  txt: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
const PERMANENT_TRANSCRIPT_CODES = new Set([
  'empty_file', 'file_too_large', 'extension_not_allowed', 'content_type_mismatch',
  'vtt_header_invalid', 'transcript_text_invalid', 'signature_mismatch', 'post_presentation_content_mismatch',
  'post_presentation_candidate_mismatch', 'post_presentation_replay_mismatch',
  'post_presentation_generation_ambiguous', 'staged_upload_mismatch',
  'staging_publicly_readable', 'staging_expired', 'staging_not_found',
  'staging_rejected', 'filename_required', 'invalid_size',
  'scan_infected', 'transcript_text_invalid',
]);
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
    return 'Microsoft confirmed that this upload session expired. Reselect the same recording and choose Retry upload; a new session starts at zero.';
  }
  if (code === 'post_presentation_upload_session_closed') {
    return 'Microsoft closed this upload session, but the file outcome is uncertain. The upload is retained for reconciliation.';
  }
  if (code === 'post_presentation_upload_reconciliation_pending') {
    return 'The exact file or upload-session outcome is uncertain. This upload is retained for reconciliation.';
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
  if (['post_presentation_mp4_signature_invalid', 'post_presentation_mp4_malware', 'post_presentation_upload_rejected'].includes(code)) {
    return 'The recording was rejected. Choose a different MP4. The rejected file is retained for controlled cleanup.';
  }
  if (error.status === 410
    || ['post_presentation_upload_session_expired', 'post_presentation_upload_expired'].includes(code)) {
    return 'Microsoft confirmed that this upload can no longer be saved. Reload to check whether Retry upload is available.';
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

function transcriptContentType(file) {
  const extension = file?.name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!extension || !TRANSCRIPT_CONTENT_TYPES[extension]
    || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > TRANSCRIPT_MAX_BYTES) {
    throw new Error('Choose one VTT, text, PDF, or DOCX transcript no larger than 25 MiB. Zoom chat.txt is meeting chat, not a transcript.');
  }
  return TRANSCRIPT_CONTENT_TYPES[extension];
}

function safeMaterialUrl(material) {
  const candidate = material?.externalUrl || material?.webUrl;
  if (typeof candidate !== 'string') return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function useMaterials(requestId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [file, setFile] = useState(null);
  const [zoomText, setZoomText] = useState('');
  const [zoomBusy, setZoomBusy] = useState(false);
  const [zoomError, setZoomError] = useState(null);
  const [transcriptFile, setTranscriptFile] = useState(null);
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const [transcriptProgress, setTranscriptProgress] = useState(null);
  const [transcriptStagedId, setTranscriptStagedId] = useState(null);
  const [transcriptError, setTranscriptError] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyUploadId, setBusyUploadId] = useState(null);
  const [recoveryBusyId, setRecoveryBusyId] = useState(null);
  const [confirmCancelId, setConfirmCancelId] = useState(null);
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
  const materialReadRef = useRef(0);
  const controllerRef = useRef(null);
  const zoomOperationRef = useRef(null);
  const transcriptStageRef = useRef(null);
  const transcriptControllerRef = useRef(null);
  const transcriptInputRef = useRef(null);
  const pauseControllerRef = useRef(null);
  const pauseRef = useRef(false);
  const recoveryBusyRef = useRef(null);
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
      transcriptControllerRef.current?.abort();
      recoveryBusyRef.current = null;
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
    const readId = ++materialReadRef.current;
    const isCurrentRead = () => current(generation) && readId === materialReadRef.current;
    setLoading(true);
    try {
      const result = await requestEnvelope(
        `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-materials`,
        { tolerantBody: true },
      );
      if (!isCurrentRead()) return;
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
      if (isCurrentRead()) setError(loadError.message || 'Presentation materials could not be loaded.');
    } finally {
      if (isCurrentRead()) setLoading(false);
    }
  }, [loadLink, requestId]);

  useEffect(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    pauseControllerRef.current?.abort();
    transcriptControllerRef.current?.abort();
    controllerRef.current = null;
    pauseControllerRef.current = null;
    transcriptControllerRef.current = null;
    zoomOperationRef.current = null;
    transcriptStageRef.current = null;
    pauseRef.current = false;
    recoveryBusyRef.current = null;
    const timer = window.setTimeout(() => {
      setData(null);
      setFile(null);
      setZoomText('');
      setZoomBusy(false);
      setZoomError(null);
      setTranscriptFile(null);
      setTranscriptBusy(false);
      setTranscriptProgress(null);
      setTranscriptStagedId(null);
      setTranscriptError(null);
      setError(null);
      setNotice(null);
      setBusyUploadId(null);
      setRecoveryBusyId(null);
      setConfirmCancelId(null);
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
        if (!Array.isArray(result?.materials)) throw new Error('The recording save was not confirmed. Retry Finish saving.');
        materialReadRef.current += 1;
        const currentRecording = result.materials.find((material) =>
          Number(material.artifactType) === REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING);
        const superseded = result.requestDocumentId && currentRecording?.artifactId
          && String(result.requestDocumentId).toLowerCase() !== String(currentRecording.artifactId).toLowerCase();
        setNotice(`${superseded
          ? 'Recording save completed, but a newer recording is current.'
          : 'Recording saved.'}${result.reconciliationRequired
          ? ' An earlier recording needs reconciliation.' : ''}`);
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

  const runUpload = async ({ selectedFile, fingerprint, upload, startingOver = false }) => {
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
    setNotice(startingOver ? 'A fresh Microsoft upload session is starting from zero.' : null);
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
            if (current(generation) && recoveryBusyRef.current !== upload.uploadId) {
              setTransfer({ ...state, uploadId: upload.uploadId });
            }
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

  const saveZoom = async () => {
    const generation = generationRef.current;
    let normalized;
    try {
      normalized = normalizeZoomPaste(zoomText);
    } catch (validationError) {
      setZoomError(validationError.message);
      return;
    }
    const prior = zoomOperationRef.current;
    const operationId = prior?.requestId === requestId && prior?.url === normalized
      ? prior.operationId : globalThis.crypto?.randomUUID?.();
    if (!operationId) {
      setZoomError('This browser cannot create a secure save identity.');
      return;
    }
    zoomOperationRef.current = { requestId, url: normalized, operationId };
    setZoomBusy(true);
    setZoomError(null);
    try {
      const result = await requestJson(
        `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-materials`,
        { method: 'PATCH', body: { action: 'save_zoom', operationId, zoomText }, tolerantBody: true },
      );
      if (!current(generation)) return;
      if (!Array.isArray(result?.materials)) throw new Error('The Zoom recording save was not confirmed. Retry with the same link.');
      zoomOperationRef.current = null;
      setZoomText('');
      await load();
      if (current(generation)) {
        const currentRecording = result.materials.find((material) =>
          Number(material.artifactType) === REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING);
        const currentIsZoom = currentRecording?.backing === 'external' && currentRecording.externalUrl === normalized;
        setNotice(`${currentIsZoom
          ? 'Zoom recording link saved.'
          : 'This Zoom link was saved, but a newer recording is current. Review the current material.'}${result.reconciliationRequired
          ? ' An earlier recording needs reconciliation.' : ''}`);
      }
    } catch (saveError) {
      if (current(generation)) setZoomError(saveError.message || 'The Zoom recording link could not be saved. Retry with the same link.');
    } finally {
      if (current(generation)) setZoomBusy(false);
    }
  };

  const uploadTranscript = async () => {
    const selectedFile = transcriptFile;
    let contentType;
    try {
      contentType = transcriptContentType(selectedFile);
    } catch (validationError) {
      setTranscriptError(validationError.message);
      return;
    }
    const generation = generationRef.current;
    const controller = new AbortController();
    transcriptControllerRef.current?.abort();
    transcriptControllerRef.current = controller;
    setTranscriptBusy(true);
    setTranscriptError(null);
    try {
      let stage = transcriptStageRef.current;
      if (!stage || stage.requestId !== requestId || stage.file !== selectedFile) {
        setTranscriptProgress(0);
        const token = await requestJson(
          `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-uploads`,
          {
            method: 'POST',
            body: { artifactType: 'transcript', filename: selectedFile.name, contentType, size: selectedFile.size },
            signal: controller.signal,
            tolerantBody: true,
          },
        );
        if (!current(generation)) return;
        const upload = token?.upload;
        if (typeof upload?.stagingId !== 'string' || !upload.stagingId
          || typeof upload.pathname !== 'string' || !upload.pathname
          || typeof upload.clientToken !== 'string' || !upload.clientToken
          || upload.contentType !== contentType || upload.access !== 'private') {
          throw new Error('The transcript staging service returned an invalid upload contract.');
        }
        const { put } = await import('@vercel/blob/client');
        if (!current(generation)) return;
        await put(upload.pathname, selectedFile, {
          access: 'private', token: upload.clientToken, contentType,
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => {
            if (current(generation)) setTranscriptProgress(Math.round(percentage));
          },
        });
        if (!current(generation)) return;
        stage = { requestId, file: selectedFile, stagingId: upload.stagingId };
        transcriptStageRef.current = stage;
        setTranscriptStagedId(stage.stagingId);
      }
      const result = await requestJson(
        `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-uploads/${encodeURIComponent(stage.stagingId)}/finalize`,
        { method: 'POST', body: {}, signal: controller.signal, tolerantBody: true },
      );
      if (!current(generation)) return;
      if (!Array.isArray(result?.materials)) throw new Error('The transcript save was not confirmed. Choose Finish transcript to retry.');
      transcriptStageRef.current = null;
      setTranscriptStagedId(null);
      setTranscriptFile(null);
      setTranscriptProgress(null);
      if (transcriptInputRef.current) transcriptInputRef.current.value = '';
      await load();
      if (current(generation)) {
        const currentTranscript = result.materials.find((material) =>
          Number(material.artifactType) === REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT);
        const superseded = result.requestDocumentId && currentTranscript?.artifactId
          && String(result.requestDocumentId).toLowerCase() !== String(currentTranscript.artifactId).toLowerCase();
        setNotice(`${superseded
          ? 'Transcript save completed, but a newer transcript is current.'
          : 'Transcript saved.'}${result.reconciliationRequired
          ? ' An earlier transcript needs reconciliation.' : ''}`);
      }
    } catch (uploadError) {
      if (uploadError?.name !== 'AbortError' && current(generation)) {
        const code = uploadError?.payload?.code || uploadError?.code;
        const staged = transcriptStageRef.current?.requestId === requestId;
        if (staged) await load();
        if (!current(generation)) return;
        const unusable = uploadError?.status === 422 || PERMANENT_TRANSCRIPT_CODES.has(code);
        if (unusable) {
          transcriptStageRef.current = null;
          setTranscriptStagedId(null);
          setTranscriptFile(null);
          setTranscriptProgress(null);
          if (transcriptInputRef.current) transcriptInputRef.current.value = '';
        }
        const retryHint = transcriptStageRef.current?.requestId === requestId
          ? ' The staged file is retained; choose Finish transcript to retry.' : '';
        const reason = code === 'post_presentation_generation_ambiguous'
            ? 'The transcript save needs reconciliation. Reload and contact support before trying again.'
            : unusable
              ? 'The staged transcript cannot be used. Reselect the file and upload it again.'
              : uploadError.message === code
                ? 'The transcript could not be saved.'
                : uploadError.message || 'The transcript could not be saved.';
        setTranscriptError(`${reason}${retryHint}`);
      }
    } finally {
      if (current(generation)) {
        setTranscriptBusy(false);
        if (transcriptControllerRef.current === controller) transcriptControllerRef.current = null;
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
      if (current(generation)) {
        await load();
        if (current(generation)) setError(finalizeFailureMessage(finishError));
      }
    } finally {
      if (current(generation)) setBusyUploadId(null);
    }
  };

  const cancel = async (intent) => {
    const generation = generationRef.current;
    recoveryBusyRef.current = intent.uploadId;
    setRecoveryBusyId(intent.uploadId);
    setConfirmCancelId(null);
    setError(null);
    controllerRef.current?.abort();
    pauseControllerRef.current?.abort();
    setTransfer(null);
    try {
      const result = await requestJson(
        `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-uploads/${encodeURIComponent(intent.uploadId)}/cancel`,
        { method: 'POST', body: {}, tolerantBody: true },
      );
      if (!current(generation)) return;
      await load();
      if (!current(generation)) return;
      setNotice(result.complete
        ? 'The recording is already complete. Choose Finish saving.'
        : result.finalized ? 'This recording was already saved.' : 'Unfinished upload cancelled.');
    } catch (cancelError) {
      if (!current(generation)) return;
      await load();
      if (current(generation)) setError(uploadFailureMessage(cancelError));
    } finally {
      if (current(generation)) {
        recoveryBusyRef.current = null;
        setRecoveryBusyId(null);
      }
    }
  };

  const retry = async (intent) => {
    if (!file || file.name !== intent.filename || file.size !== intent.size) {
      setError(`Reselect ${intent.filename} (${formatBytes(intent.size)}) to retry from zero.`);
      return;
    }
    const generation = generationRef.current;
    recoveryBusyRef.current = intent.uploadId;
    setRecoveryBusyId(intent.uploadId);
    setError(null);
    setTransfer(null);
    try {
      const fingerprint = await fingerprintGraphBrowserUploadFile(file);
      if (!current(generation)) return;
      const body = await requestJson(
        `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-uploads/${encodeURIComponent(intent.uploadId)}/retry`,
        { method: 'POST', body: { resumeFingerprint: fingerprint }, tolerantBody: true },
      );
      if (!current(generation)) return;
      if (body?.upload?.finalized) {
        await load();
        if (current(generation)) setNotice('This recording was already saved.');
        return;
      }
      const upload = validateUploadContract(body?.upload, { expectedUploadId: intent.uploadId });
      if (upload.complete) {
        await load();
        if (current(generation)) setNotice('The recording is already complete. Choose Finish saving.');
        return;
      }
      recoveryBusyRef.current = null;
      setRecoveryBusyId(null);
      await runUpload({ selectedFile: file, fingerprint, upload, startingOver: upload.restarted === true });
    } catch (retryError) {
      if (!current(generation)) return;
      await load();
      if (current(generation)) setError(uploadFailureMessage(retryError));
    } finally {
      if (current(generation)) {
        recoveryBusyRef.current = null;
        setRecoveryBusyId(null);
      }
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
  const changeZoomText = (text) => {
    zoomOperationRef.current = null;
    setZoomText(text);
    setZoomError(null);
  };
  const chooseTranscriptFile = (nextFile) => {
    transcriptStageRef.current = null;
    setTranscriptStagedId(null);
    setTranscriptProgress(null);
    setTranscriptError(null);
    setTranscriptFile(nextFile);
  };
  const requestPause = () => {
    pauseRef.current = true;
    pauseControllerRef.current?.abort();
    setPauseRequested(true);
    setTransfer((value) => (value ? { ...value, phase: 'pausing', etaSeconds: null } : value));
  };
  return {
    changeZoomText, chooseTranscriptFile, requestPause, transcriptInputRef,
    data, loading, unavailable, file, setFile, zoomText, setZoomText, zoomBusy, zoomError, setZoomError,
    transcriptFile, setTranscriptFile, transcriptBusy, transcriptProgress, transcriptStagedId, setTranscriptStagedId,
    setTranscriptProgress, transcriptError, setTranscriptError, error, notice, busyUploadId, recoveryBusyId,
    confirmCancelId, setConfirmCancelId, transfer, setTransfer, pauseRequested, setPauseRequested, link, linkBusy,
    linkError, linkCopied, manualCopy, confirmReissue, setConfirmReissue, zoomOperationRef, transcriptStageRef,
    transcriptInputRef, pauseRef, pauseControllerRef, current, generationRef,
    load, saveZoom, uploadTranscript, begin, resume, finish, cancel, retry, mutateLink, copyLink,
  };
}

// ---------------------------------------------------------------------------
// Transcription (generate from audio, review, publish, edit names)
// ---------------------------------------------------------------------------

const API_PATH = '/api/meeting-tracker/visits';
const MAX_VTT_BYTES = 4_000_000;
const ALIGNMENT_ACTIVE = new Set(['pending', 'running']);
const ACTIVE_STATUSES = new Set(['uploading', 'queued', 'submitting', 'processing', 'saving']);
const UNRESOLVED_PUBLICATION = new Set(['publishing', 'retryable', 'unknown', 'published_reconcile']);
const PUBLISHED_FOR_JOB = new Set(['published', 'published_reconcile', 'unknown']);
const ALIGNMENT_REASONS = {
  abstained: 'The Zoom captions did not match the speakers confidently. Name them by hand.',
  no_speakers: 'The Zoom captions have no speaker labels.',
  failed: 'Automatic speaker matching did not finish. Name speakers by hand.',
  superseded: 'Names were edited before matching finished.',
};
const SOURCE_LABELS = {
  pi: 'PI', co_pi: 'Co-PI', coPIs: 'Co-PI', saved_staff: 'Saved staff', saved_attendee: 'Saved attendee', savedAttendees: 'Saved attendee',
};
const RUN_STATE_LABELS = {
  uploading: 'Uploading', queued: 'Waiting', submitting: 'Transcribing', processing: 'Transcribing', saving: 'Saving',
  ready: 'Ready', failed: 'Failed', submission_uncertain: 'Needs attention', expired: 'Expired',
};
const PROGRESS_VERBS = {
  uploading: 'Uploading', queued: 'Waiting to transcribe', submitting: 'Transcribing', processing: 'Transcribing', saving: 'Saving transcript for',
};
const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';
const BTN = `inline-flex min-h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-50`;
const BTN_PRIMARY = `inline-flex min-h-10 items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 ${FOCUS_RING} focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700`;
const BTN_LINK = `text-sm font-medium text-gray-700 underline underline-offset-2 hover:text-gray-950 ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-50`;
const INPUT = `mt-1 block min-h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-100`;
const FILE_INPUT = `${INPUT} file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-gray-900`;

function fmtDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function displayName(job) {
  const name = String(job?.original_filename || '').replace(/\.[a-z0-9]{1,5}$/i, '').trim();
  return name || 'recording';
}
function sameId(a, b) { return Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase(); }
function seedNames(names) {
  return Object.fromEntries(Object.entries(names || {}).map(([id, name]) => [id, String(name || '')]));
}
function sameNames(a, b) {
  const left = a || {};
  const right = b || {};
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every((id) => String(left[id] || '') === String(right[id] || ''));
}
function errorMessage(error, fallback) {
  if (error?.status === 409) return 'This draft changed elsewhere. Reload it before trying again; your current edits are preserved.';
  return error?.message || fallback;
}
function vttFormat(file) {
  if (!file) return null;
  if (!String(file.name || '').toLowerCase().endsWith('.vtt')) return 'Choose Zoom captions saved as a .vtt file.';
  if (file.size < 1 || file.size > MAX_VTT_BYTES) return 'Choose Zoom captions larger than 0 bytes and no larger than 4 MB.';
  return null;
}
function audioFormat(file) {
  if (!file) return null;
  const extension = String(file?.name || '').toLowerCase().split('.').pop();
  const expected = extension === 'm4a' ? ['audio/mp4', 'audio/x-m4a'] : extension === 'mp3' ? ['audio/mpeg'] : [];
  if (!expected.length) return 'Choose an M4A or MP3 recording.';
  if (file.type && !expected.includes(file.type)) return 'The selected file type does not match its M4A or MP3 extension.';
  return null;
}

// The current line reads revision data from the TRANSCRIPT material row only. A publication
// row's version/createdAt are concurrency and draft-creation values, never revision metadata.
export function describeCurrentTranscript({ material, collection }) {
  if (!material) return { kind: 'none', text: 'No transcript yet.' };
  const artifact = collection?.currentArtifact;
  const generated = Boolean(artifact?.bundleEditable) && sameId(artifact.id, material.artifactId);
  if (!generated) {
    return {
      kind: 'uploaded',
      text: `Uploaded ${fmtDateTime(material.createdAt)}${material.filename ? ` · ${material.filename}` : ''}`.replace(/\s+/g, ' ').trim(),
    };
  }
  const publications = (collection?.publications || []).filter((row) => row.state !== 'draft');
  const jobs = collection?.jobs || [];
  let publication = publications.find((row) => sameId(row.resultingDocumentId, artifact.id));
  // A names-only edit republishes from the previous document; follow that chain to the original run.
  for (let hop = 0; publication && !publication.inputJobId && publication.sourceArtifactId && hop < 5; hop += 1) {
    const sourceId = publication.sourceArtifactId;
    publication = publications.find((row) => sameId(row.resultingDocumentId, sourceId));
  }
  const job = publication?.inputJobId ? jobs.find((item) => sameId(item.id, publication.inputJobId)) : null;
  const parts = [`Published ${fmtDateTime(material.createdAt)}`.trim()];
  if (job) parts.push(`from ${displayName(job)}`);
  if (Number.isInteger(material.slotVersion) && material.slotVersion > 0) parts.push(`version ${material.slotVersion}`);
  return { kind: 'generated', text: parts.join(' · ') };
}

function Notice({ tone = 'error', children }) {
  if (!children) return null;
  const classes = tone === 'error' ? 'border-red-200 bg-red-50 text-red-900'
    : tone === 'success' ? 'border-green-200 bg-green-50 text-green-900'
      : tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-gray-200 bg-gray-50 text-gray-800';
  return <div className={`rounded-lg border px-3 py-2 text-sm leading-5 ${classes}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function Chip({ tone = 'gray', children }) {
  const classes = tone === 'green' ? 'bg-green-50 text-green-800' : tone === 'amber' ? 'bg-amber-50 text-amber-900' : tone === 'blue' ? 'bg-blue-50 text-blue-800' : 'bg-gray-100 text-gray-700';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>{children}</span>;
}

function useTranscription(requestId, { onMaterialsChanged }) {
  const basePath = `${API_PATH}/${encodeURIComponent(requestId || '')}/transcriptions`;
  const [collection, setCollection] = useState(null);
  const [collectionCheckedAt, setCollectionCheckedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [focusId, setFocusId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [correctionDetail, setCorrectionDetail] = useState(null);
  const [names, setNames] = useState({});
  const [suggestionPicks, setSuggestionPicks] = useState({});
  const [audioFile, setAudioFile] = useState(null);
  const [vttFile, setVttFile] = useState(null);
  const [noVttConfirmation, setNoVttConfirmation] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [closeAcknowledgedId, setCloseAcknowledgedId] = useState(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const detailSeqRef = useRef(0);
  const controllerRef = useRef(null);
  const attemptRef = useRef(null);
  const baselineRef = useRef({ key: null, names: {} });
  const onMaterialsChangedRef = useRef(onMaterialsChanged);
  useEffect(() => { onMaterialsChangedRef.current = onMaterialsChanged; }, [onMaterialsChanged]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      detailSeqRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);
  const isCurrent = useCallback((generation) => mountedRef.current && generationRef.current === generation, []);

  const jobs = useMemo(() => [...(collection?.jobs || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))), [collection?.jobs]);
  const publications = useMemo(() => (collection?.publications || []).filter((row) => row.state !== 'draft'), [collection?.publications]);
  const newestJob = jobs[0] || null;
  const focusJob = (focusId && jobs.find((job) => job.id === focusId)) || newestJob;
  const focusPublished = Boolean(focusJob) && publications.some((row) => row.inputJobId === focusJob.id && PUBLISHED_FOR_JOB.has(row.state));
  const showReview = Boolean(focusJob) && (focusId === focusJob.id || !focusPublished);
  const selectedJob = focusJob && detail?.job?.id === focusJob.id ? detail.job : focusJob;
  const correction = correctionDetail?.correction || null;
  const content = correction ? correctionDetail.content : detail?.job?.id === focusJob?.id ? detail?.content : null;
  const speakerIds = useMemo(() => getTranscriptSpeakers(content), [content]);
  const baselineRaw = correction ? correction.speakerNames : selectedJob?.speaker_names;
  const baselineSig = JSON.stringify(Object.entries(baselineRaw || {}).sort());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const baseline = useMemo(() => seedNames(baselineRaw), [baselineSig]);
  const editorKey = correction ? `c:${correction.operationId}` : (detail?.job?.id && detail.job.id === focusJob?.id ? `j:${detail.job.id}` : null);
  const dirtyNames = speakerIds.some((id) => String(names[id] || '') !== String(baseline[id] || ''));

  // Seed the editor from the server whenever the edited target changes, and adopt newly arrived
  // server names (for example matching finishing) while the local draft is still untouched.
  // Names are never cleared here: only a target switch or a successful save replaces them.
  useEffect(() => {
    const previous = baselineRef.current;
    baselineRef.current = { key: editorKey, names: baseline };
    if (previous.key !== editorKey) setNames(seedNames(baseline));
    else if (!sameNames(previous.names, baseline)) setNames((current) => (sameNames(current, previous.names) ? seedNames(baseline) : current));
  }, [editorKey, baseline]);

  const loadCollection = useCallback(async () => {
    if (!requestId) return;
    const generation = generationRef.current;
    setLoading(true);
    try {
      const body = await requestJson(basePath, { method: 'GET', fallbackMessage: 'Transcription status could not be loaded.' });
      if (!isCurrent(generation)) return;
      setCollection(body);
      setCollectionCheckedAt(Date.now());
      setError(null);
      setConflict(false);
      setDetail((currentDetail) => {
        if (!currentDetail?.job) return currentDetail;
        const fresh = (body.jobs || []).find((job) => job.id === currentDetail.job.id);
        if (!fresh) return null;
        const safe = fresh.status === 'ready' && fresh.contentAccessAllowed === true && !fresh.cleanup_requested_at && !fresh.content_purged_at;
        if (!safe) return { job: fresh, content: null, candidates: [] };
        return Number(fresh.version) >= Number(currentDetail.job.version) ? { ...currentDetail, job: fresh } : currentDetail;
      });
    } catch (loadError) {
      if (isCurrent(generation) && loadError?.name !== 'AbortError') setError(errorMessage(loadError, 'Transcription status could not be loaded.'));
    } finally {
      if (isCurrent(generation)) setLoading(false);
    }
  }, [basePath, isCurrent, requestId]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled && requestId) void loadCollection(); });
    return () => { cancelled = true; };
  }, [loadCollection, requestId]);

  const loadDetail = useCallback(async (jobId, { preserve = false } = {}) => {
    if (!requestId || !jobId) return;
    const generation = generationRef.current;
    const sequence = ++detailSeqRef.current;
    const current = () => isCurrent(generation) && detailSeqRef.current === sequence;
    if (!preserve) { setDetail(null); setSuggestionPicks({}); setCorrectionDetail(null); }
    setBusy('loading');
    try {
      const body = await requestJson(`${basePath}/${encodeURIComponent(jobId)}`, { method: 'GET', fallbackMessage: 'This run could not be opened.' });
      if (!current()) return;
      setDetail(body);
      setConflict(false);
      setError(null);
    } catch (loadError) {
      if (current() && loadError?.name !== 'AbortError') setError(errorMessage(loadError, 'This run could not be opened.'));
    } finally {
      if (current()) setBusy(null);
    }
  }, [basePath, isCurrent, requestId]);

  const loadCorrection = useCallback(async (operationId) => {
    const generation = generationRef.current;
    const sequence = ++detailSeqRef.current;
    const current = () => isCurrent(generation) && detailSeqRef.current === sequence;
    setBusy('loading');
    try {
      const body = await requestJson(`${basePath}/corrections/${encodeURIComponent(operationId)}`, { method: 'GET', fallbackMessage: 'The speaker-name editor could not be refreshed.' });
      if (!current()) return;
      setCorrectionDetail(body);
      setConflict(false);
      setError(null);
    } catch (loadError) {
      if (current() && loadError?.name !== 'AbortError') setError(errorMessage(loadError, 'The speaker-name editor could not be refreshed.'));
    } finally {
      if (current()) setBusy(null);
    }
  }, [basePath, isCurrent]);

  // Load the run under review once it is readable; one attempt per run and status so a failure cannot loop.
  useEffect(() => {
    if (!showReview || correctionDetail || !focusJob) return;
    if (focusJob.status !== 'ready' || focusJob.contentAccessAllowed !== true) return;
    if (detail?.job?.id === focusJob.id) return;
    const key = `${focusJob.id}:${focusJob.status}`;
    if (attemptRef.current === key) return;
    attemptRef.current = key;
    void loadDetail(focusJob.id);
  }, [showReview, correctionDetail, focusJob, detail?.job?.id, loadDetail]);

  const reviewRun = (job) => {
    attemptRef.current = `${job.id}:${job.status}`;
    setFocusId(job.id);
    setNotice(null);
    if (job.status === 'ready' && job.contentAccessAllowed === true) void loadDetail(job.id);
    else { setDetail(null); setCorrectionDetail(null); }
  };

  const refreshReview = () => {
    if (correction) void loadCorrection(correction.operationId);
    else if (focusJob) void loadDetail(focusJob.id, { preserve: true });
  };

  const postJobAction = async (action, body, label) => {
    if (!selectedJob || !requestId) return null;
    const generation = generationRef.current;
    const jobId = selectedJob.id;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson(`${basePath}/${encodeURIComponent(jobId)}/${action}`, { method: action === 'speakers' ? 'PATCH' : 'POST', body, fallbackMessage: `${label} could not be completed.` });
      if (!isCurrent(generation)) return null;
      if (result.job) {
        setDetail((currentDetail) => (currentDetail?.job?.id === jobId ? { ...currentDetail, job: result.job } : currentDetail));
        setCollection((currentCollection) => (currentCollection ? { ...currentCollection, jobs: currentCollection.jobs.map((job) => (job.id === result.job.id ? result.job : job)) } : currentCollection));
      }
      return result;
    } catch (actionError) {
      if (!isCurrent(generation) || actionError?.name === 'AbortError') return null;
      let refreshFailed = false;
      if (action === 'publish') {
        await loadCollection();
        try {
          const latest = await requestJson(`${basePath}/${encodeURIComponent(jobId)}`, { method: 'GET', fallbackMessage: 'Refresh before trying again.' });
          if (isCurrent(generation)) setDetail(latest);
        } catch { refreshFailed = true; }
      }
      if (isCurrent(generation)) {
        setConflict(actionError.status === 409 || refreshFailed);
        setError(errorMessage(actionError, `${label} could not be completed.`));
      }
      return null;
    } finally {
      if (isCurrent(generation)) setBusy(null);
    }
  };

  const saveNames = async () => {
    if (!dirtyNames || busy) return;
    const generation = generationRef.current;
    if (correction) {
      setBusy('speakers');
      setError(null);
      setNotice(null);
      try {
        const result = await requestJson(`${basePath}/corrections/${encodeURIComponent(correction.operationId)}`, {
          method: 'PATCH', body: { expectedVersion: correction.version, speakerNames: names },
          fallbackMessage: 'Speaker names could not be saved.',
        });
        if (!isCurrent(generation)) return;
        setCorrectionDetail((currentDetail) => (currentDetail ? { ...currentDetail, correction: result.correction } : currentDetail));
        setNames(seedNames(result.correction?.speakerNames));
        setNotice('Speaker names saved.');
        setConflict(false);
      } catch (saveError) {
        if (isCurrent(generation)) {
          setConflict(saveError?.status === 409);
          setError(errorMessage(saveError, 'Speaker names could not be saved.'));
        }
      } finally {
        if (isCurrent(generation)) setBusy(null);
      }
      return;
    }
    const result = await postJobAction('speakers', { expectedVersion: selectedJob.version, speakerNames: names }, 'Saving names');
    if (!result?.job) return;
    setNames(seedNames(result.job.speaker_names));
    setNotice('Speaker names saved.');
  };

  const announcePublication = (publication, superseded) => {
    if (publication.state === 'published' && superseded) setNotice('Published, but a newer transcript is current. The newer one is unchanged.');
    else if (publication.state === 'published') setNotice('Transcript published.');
    else if (publication.state === 'published_reconcile') setNotice('Transcript is published, but finishing the downloads did not complete. Check now under Needs attention.');
    else if (publication.state === 'unknown') setNotice('We could not confirm this publish. Check now under Needs attention.');
    else setError(`Publishing failed${publication.errorCode ? ` (reference: ${publication.errorCode})` : ''}. Try again.`);
  };

  const publishJob = async () => {
    if (!selectedJob || !collection || busy) return;
    const expected = collection.currentArtifact || null;
    const result = await postJobAction('publish', {
      expectedVersion: selectedJob.version,
      expectedCurrentArtifactId: expected?.id || null,
      expectedCurrentFingerprint: expected?.fingerprint || null,
    }, 'Publishing');
    if (!result?.publication) return;
    if (result.currentArtifact) setCollection((state) => (state ? { ...state, currentArtifact: result.currentArtifact } : state));
    announcePublication(result.publication, result.superseded);
    if (result.publication.state === 'published') setFocusId(null);
    await loadCollection();
    await onMaterialsChangedRef.current?.();
  };

  const publishCorrection = async () => {
    const artifact = correctionDetail?.currentArtifact;
    if (!correction || !artifact || dirtyNames || !speakerIds.length || correction.state !== 'draft' || busy) return;
    if (artifact.id !== correction.expectedCurrentArtifactId || artifact.fingerprint !== correction.expectedCurrentFingerprint) {
      setError('The published transcript changed after you started editing. Cancel, then choose Edit speaker names again.');
      return;
    }
    const generation = generationRef.current;
    setBusy('publish');
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson(`${basePath}/corrections/${encodeURIComponent(correction.operationId)}/publish`, { method: 'POST', body: { expectedVersion: correction.version }, fallbackMessage: 'The edited transcript could not be published.' });
      if (!isCurrent(generation)) return;
      if (result.currentArtifact) setCollection((state) => (state ? { ...state, currentArtifact: result.currentArtifact } : state));
      announcePublication(result.publication || { state: 'unknown' }, false);
      if (result.publication?.state === 'published') setCorrectionDetail(null);
      await loadCollection();
      await onMaterialsChangedRef.current?.();
    } catch (publishError) {
      if (isCurrent(generation)) {
        setConflict(publishError?.status === 409);
        await loadCollection();
        if (isCurrent(generation)) setError(errorMessage(publishError, 'The edited transcript could not be published.'));
      }
    } finally {
      if (isCurrent(generation)) setBusy(null);
    }
  };

  const beginEditNames = async () => {
    const artifact = collection?.currentArtifact;
    if (!artifact?.bundleEditable || busy) return;
    const generation = generationRef.current;
    setBusy('create-draft');
    setError(null);
    try {
      const created = await requestJson(`${basePath}/materials/${encodeURIComponent(artifact.id)}/corrections`, { method: 'POST', body: {}, fallbackMessage: 'The speaker-name editor could not be opened.' });
      if (!isCurrent(generation)) return;
      if (!created.correction?.operationId) throw new Error('The speaker-name editor returned an incomplete draft. Refresh this page before trying again.');
      detailSeqRef.current += 1;
      setSuggestionPicks({});
      setCorrectionDetail(created);
      setNotice(null);
      await loadCollection();
    } catch (createError) {
      if (isCurrent(generation)) setError(errorMessage(createError, 'The speaker-name editor could not be opened.'));
    } finally {
      if (isCurrent(generation)) setBusy(null);
    }
  };

  const cancelEditNames = () => { detailSeqRef.current += 1; setCorrectionDetail(null); setConflict(false); setError(null); setSuggestionPicks({}); };

  const discardRun = async (job) => {
    if (!job || busy || !globalThis.confirm?.('Discard this draft?')) return;
    const generation = generationRef.current;
    setBusy('discard');
    setError(null);
    try {
      await requestJson(`${basePath}/${encodeURIComponent(job.id)}`, { method: 'DELETE', body: { expectedVersion: job.version }, fallbackMessage: 'The draft could not be discarded.' });
      if (!isCurrent(generation)) return;
      if (detail?.job?.id === job.id) setDetail(null);
      if (focusId === job.id) setFocusId(null);
      setNotice('Draft discarded.');
      await loadCollection();
    } catch (discardError) {
      if (isCurrent(generation)) {
        setConflict(discardError?.status === 409);
        setError(errorMessage(discardError, 'The draft could not be discarded.'));
      }
    } finally {
      if (isCurrent(generation)) setBusy(null);
    }
  };

  const checkPublication = async (publication) => {
    if (!publication?.operationId || busy) return;
    const generation = generationRef.current;
    setBusy(`check-${publication.operationId}`);
    setError(null);
    try {
      const result = await requestJson(`${basePath}/publications/${encodeURIComponent(publication.operationId)}/reconcile`, { method: 'POST', body: {}, fallbackMessage: 'The publish could not be checked.' });
      if (!isCurrent(generation)) return;
      setNotice(result.superseded
        ? 'This publish was confirmed, but a newer transcript is current. The newer one is unchanged.'
        : result.requiresAttention ? 'This publish still needs attention.'
          : result.publication?.state === 'published' ? 'Publish confirmed. Downloads are available.' : 'Checked the saved publish record.');
      await loadCollection();
      await onMaterialsChangedRef.current?.();
    } catch (checkError) {
      if (isCurrent(generation)) setError(errorMessage(checkError, 'The publish could not be checked.'));
    } finally {
      if (isCurrent(generation)) setBusy(null);
    }
  };

  const closePublication = async (publication) => {
    if (!publication?.operationId || closeAcknowledgedId !== publication.operationId || busy) return;
    const generation = generationRef.current;
    setBusy(`close-${publication.operationId}`);
    setError(null);
    try {
      const result = await requestJson(`${basePath}/publications/${encodeURIComponent(publication.operationId)}/close`, {
        method: 'POST', body: { acknowledgeRetainedFiles: true }, fallbackMessage: 'This attempt could not be closed.',
      });
      if (!isCurrent(generation)) return;
      setCloseAcknowledgedId(null);
      setNotice(result.closed ? 'The attempt is closed. Any partly saved files remain in SharePoint.'
        : result.superseded ? 'The publish was confirmed, but a newer transcript is current. The newer one is unchanged.'
          : result.requiresAttention ? 'This publish still needs attention. No files were deleted.' : 'The publish was confirmed.');
      await loadCollection();
    } catch (closeError) {
      if (isCurrent(generation)) {
        setCloseAcknowledgedId(null);
        setConflict(closeError?.status === 409);
        await loadCollection();
        if (isCurrent(generation)) setError(errorMessage(closeError, 'This attempt could not be closed.'));
      }
    } finally {
      if (isCurrent(generation)) setBusy(null);
    }
  };

  const chooseFiles = (files, slot) => {
    const list = Array.from(files || []);
    const isVtt = (file) => String(file?.name || '').toLowerCase().endsWith('.vtt');
    if (list.length > 1) {
      const audio = list.find((file) => !isVtt(file));
      const vtt = list.find(isVtt);
      if (audio) setAudioFile(audio);
      if (vtt) setVttFile(vtt);
    } else if (slot === 'vtt') setVttFile(list[0] || null);
    else setAudioFile(list[0] || null);
    setError(null);
  };

  const confirmNoVtt = noVttConfirmation?.audio === audioFile && noVttConfirmation?.vtt === vttFile;
  const uploadAndStart = async () => {
    if (!audioFile || audioFormat(audioFile) || !acknowledged || busy || !requestId) return;
    if (audioFile.size < 1 || audioFile.size > MAX_AUDIO_BYTES) {
      setError(`Choose an audio recording no larger than ${MAX_TRANSCRIPTION_MIB} MiB.`);
      return;
    }
    if (vttFile && vttFormat(vttFile)) return;
    if (!vttFile && !confirmNoVtt) {
      setNoVttConfirmation({ audio: audioFile, vtt: vttFile });
      return;
    }
    setNoVttConfirmation(null);
    const contentType = audioFile.type || (audioFile.name.toLowerCase().endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg');
    const generation = generationRef.current;
    const controller = new AbortController();
    let startRequested = false;
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setBusy('upload');
    setError(null);
    setNotice(null);
    setUploadProgress(0);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.();
      if (!idempotencyKey) throw new Error('This browser cannot create a secure upload request. Use a current browser and try again.');
      const prepared = await requestJson(basePath, {
        method: 'POST', signal: controller.signal,
        body: {
          filename: audioFile.name, contentType, bytes: audioFile.size, idempotencyKey, providerRegion: 'us',
          ...(vttFile ? { zoomTranscript: { contentType: 'text/vtt', bytes: vttFile.size } } : {}),
        },
        fallbackMessage: 'A private upload could not be prepared.',
      });
      if (!isCurrent(generation)) return;
      const job = prepared.job;
      const upload = prepared.upload;
      if (!job?.id || !Number.isInteger(job.version) || typeof upload?.token !== 'string' || !upload.token || typeof upload?.pathname !== 'string' || !upload.pathname || upload.access !== 'private') {
        throw new Error('The private upload service returned an incomplete response. Refresh this page before trying again.');
      }
      if (audioFile.size > upload.maximumSizeInBytes) throw new Error('The recording exceeds the private upload limit. Choose a smaller file.');
      if (vttFile && (!upload.zoomTranscript?.pathname || !upload.zoomTranscript?.token)) {
        throw new Error('The private upload service did not return an upload for the Zoom captions. Refresh this page before trying again.');
      }
      if (vttFile && !Number.isInteger(upload.zoomTranscript.maximumSizeInBytes)) throw new Error('The private upload service returned an incomplete response for the Zoom captions. Refresh this page before trying again.');
      if (vttFile && vttFile.size > upload.zoomTranscript.maximumSizeInBytes) throw new Error('The Zoom captions exceed the private upload limit. Choose a smaller file.');
      const { put } = await import('@vercel/blob/client');
      if (!isCurrent(generation)) return;
      await put(upload.pathname, audioFile, {
        access: 'private', token: upload.token, multipart: true, contentType,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => { if (isCurrent(generation)) setUploadProgress(Math.max(0, Math.min(100, Math.round(percentage)))); },
      });
      if (!isCurrent(generation)) return;
      if (vttFile && upload.zoomTranscript) {
        setBusy('upload-captions');
        await put(upload.zoomTranscript.pathname, vttFile, {
          access: 'private', token: upload.zoomTranscript.token, contentType: 'text/vtt',
          abortSignal: controller.signal,
        });
        if (!isCurrent(generation)) return;
      }
      startRequested = true;
      setBusy('starting');
      const started = await requestJson(`${basePath}/${encodeURIComponent(job.id)}/start`, {
        method: 'POST', signal: controller.signal,
        body: { expectedVersion: job.version, nonSensitiveAcknowledged: true },
        fallbackMessage: 'The recording uploaded, but the transcription start needs attention.',
      });
      if (!isCurrent(generation)) return;
      if (!started.job?.id || !Number.isInteger(started.job.version)) {
        const uncertainResult = new Error('The recording uploaded, but we could not confirm transcription started.');
        uncertainResult.status = 0;
        throw uncertainResult;
      }
      setAudioFile(null);
      setVttFile(null);
      setAcknowledged(false);
      setUploadProgress(null);
      setFocusId(null);
      setNotice(started.job.status === 'submission_uncertain' || started.job.needsAttention
        ? 'We could not confirm transcription started. Do not upload the same recording again until this run has been checked.'
        : 'Transcription started. Refresh to see its latest status.');
      await loadCollection();
    } catch (uploadFailure) {
      if (!isCurrent(generation) || uploadFailure?.name === 'AbortError') return;
      const uncertain = startRequested && (uploadFailure?.status === 0 || uploadFailure?.status >= 500 || uploadFailure?.payload?.code === 'transcription_dispatch_pending' || uploadFailure?.payload?.code === 'transcription_submission_uncertain');
      await loadCollection();
      setUploadProgress(null);
      setError(uncertain
        ? `${uploadFailure.message || 'We could not confirm transcription started.'} Refresh to check this run before starting another transcription.`
        : errorMessage(uploadFailure, 'The recording could not be uploaded.'));
    } finally {
      if (isCurrent(generation)) setBusy(null);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  return {
    basePath, collection, collectionCheckedAt, loading, jobs, publications, newestJob, focusJob, showReview, selectedJob,
    correction, correctionDetail, content, speakerIds, names, setNames, baseline, dirtyNames, suggestionPicks, setSuggestionPicks,
    detail, audioFile, vttFile, setVttFile, acknowledged, setAcknowledged, uploadProgress, busy, error, notice, conflict,
    closeAcknowledgedId, setCloseAcknowledgedId, confirmNoVtt, setNoVttConfirmation,
    loadCollection, reviewRun, refreshReview, saveNames, publishJob, publishCorrection, beginEditNames, cancelEditNames,
    discardRun, checkPublication, closePublication, chooseFiles, uploadAndStart,
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function SpeakerEditor({ t, alignment, readOnly }) {
  const { content, names, setNames, suggestionPicks, setSuggestionPicks, speakerIds, correctionDetail, collection, busy } = t;
  const candidates = useMemo(() => {
    const result = new Map();
    for (const candidate of correctionDetail?.candidates || t.detail?.candidates || collection?.candidates || []) {
      if (candidate?.id && candidate?.displayName) result.set(candidate.id, candidate);
    }
    return [...result.values()];
  }, [correctionDetail?.candidates, t.detail?.candidates, collection?.candidates]);
  const grouped = useMemo(() => {
    const sources = new Map();
    for (const candidate of candidates) {
      const source = SOURCE_LABELS[candidate.source] || 'Other suggestions';
      if (!sources.has(source)) sources.set(source, []);
      sources.get(source).push(candidate);
    }
    return [...sources.entries()];
  }, [candidates]);
  const turns = groupTranscriptByTurn(content, names || {});
  const excerpts = new Map(speakerIds.map((id) => {
    const text = turns.find((turn) => turn.speaker === id)?.text || '';
    return [id, text.length > 240 ? `${text.slice(0, 240).trimEnd()}…` : text];
  }));
  const matches = alignment?.speakers || {};
  const suggestions = alignment?.suggestions || {};
  const disabled = Boolean(busy) || readOnly;
  const unavailable = Object.entries(collection?.candidateSources || {}).filter(([, value]) => value?.status === 'unavailable');
  if (!speakerIds.length) return <p className="mt-4 text-sm text-gray-700">No timed speaker turns were detected, so this text cannot be published as a timed transcript.</p>;
  return (
    <div className="mt-4" aria-label="Speakers">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-950">Speakers ({speakerIds.length})</h4>
        <p className="text-xs text-gray-600">Pick a suggestion or type a name. Suggestions only fill the field.</p>
      </div>
      {unavailable.length > 0 && <p className="mt-2 text-xs text-amber-900">Some name suggestions are unavailable ({unavailable.map(([source]) => SOURCE_LABELS[source] || source).join(', ')}). You can still type names.</p>}
      <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
        {speakerIds.map((speaker, index) => {
          const match = matches[speaker];
          const rowSuggestions = !match?.name && Array.isArray(suggestions[speaker]) ? suggestions[speaker] : [];
          const controlId = `recording-transcript-speaker-${index}`;
          return (
            <div key={speaker} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.2fr)] sm:items-start" data-testid={`speaker-row-${speaker}`}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                  Speaker {speaker}
                  {match?.name
                    ? <Chip tone="green">Matched from Zoom captions{typeof match.confidence === 'number' ? ` · ${Math.round(match.confidence * 100)}%` : ''}</Chip>
                    : !String(names[speaker] || '').trim() ? <Chip>Unnamed</Chip> : null}
                </p>
                <p className="mt-1 break-words text-xs leading-5 text-gray-600">{excerpts.get(speaker) || 'No excerpt available.'}</p>
              </div>
              <div className="grid min-w-0 gap-2">
                <label htmlFor={`${controlId}-name`} className="block text-xs font-medium text-gray-700">
                  Name for Speaker {speaker}
                  <input
                    id={`${controlId}-name`}
                    value={names[speaker] || ''}
                    disabled={disabled}
                    maxLength={80}
                    onChange={(event) => { setSuggestionPicks((c) => ({ ...c, [speaker]: '' })); setNames((c) => ({ ...c, [speaker]: event.target.value })); }}
                    className={INPUT}
                  />
                </label>
                {rowSuggestions.length > 0 && <div className="flex flex-wrap items-center gap-2">
                  {rowSuggestions.map((name) => (
                    <button key={name} type="button" disabled={disabled} onClick={() => setNames((c) => ({ ...c, [speaker]: name }))} className={BTN}>Use {name}</button>
                  ))}
                </div>}
                {candidates.length > 0 && <label htmlFor={`${controlId}-pick`} className="block text-xs font-medium text-gray-700">
                  People on this request
                  <select
                    id={`${controlId}-pick`}
                    disabled={disabled}
                    value={suggestionPicks[speaker] || ''}
                    onChange={(event) => {
                      const match2 = candidates.find((candidate) => candidate.id === event.target.value);
                      setSuggestionPicks((c) => ({ ...c, [speaker]: event.target.value }));
                      if (match2) setNames((c) => ({ ...c, [speaker]: match2.displayName }));
                    }}
                    className={INPUT}
                  >
                    <option value="">Choose a person…</option>
                    {grouped.map(([source, items]) => (
                      <optgroup key={source} label={source}>
                        {items.map((candidate) => {
                          const repeats = candidates.filter((item) => item.displayName === candidate.displayName).length > 1;
                          const position = repeats ? items.filter((item) => item.displayName === candidate.displayName).findIndex((item) => item.id === candidate.id) + 1 : null;
                          return <option key={candidate.id} value={candidate.id}>{candidate.displayName}{repeats ? ` · ${source} ${position}` : ''}</option>;
                        })}
                      </optgroup>
                    ))}
                  </select>
                </label>}
              </div>
            </div>
          );
        })}
      </div>
      {Number.isInteger(alignment?.reassignedCount) && alignment.reassignedCount > 0 && (
        <p className="mt-2 text-xs text-gray-600">{alignment.reassignedCount === 1 ? 'One short utterance was' : `${alignment.reassignedCount} short utterances were`} reattributed to the speaker the Zoom captions show at that moment.</p>
      )}
    </div>
  );
}

function ReviewBlock({ t }) {
  const { selectedJob: job, correction, busy, conflict, dirtyNames, collection, publications } = t;
  const status = job?.status;
  const alignment = correction ? null : job?.speaker_alignment || null;
  const alignmentShown = Boolean(alignment) && job?.zoomTranscriptAttached !== false;
  const alignmentStatus = alignment?.status || null;
  const matchingActive = alignmentShown && ALIGNMENT_ACTIVE.has(alignmentStatus);
  const unresolved = publications.some((row) => UNRESOLVED_PUBLICATION.has(row.state));
  const alreadyPublished = !correction && publications.some((row) => row.inputJobId === job?.id && PUBLISHED_FOR_JOB.has(row.state));
  const hasTurns = t.speakerIds.length > 0;
  const staleCorrection = Boolean(correction) && (t.correctionDetail?.currentArtifact?.id !== correction.expectedCurrentArtifactId
    || t.correctionDetail?.currentArtifact?.fingerprint !== correction.expectedCurrentFingerprint);
  const publishBlockedReason = matchingActive ? 'Matching still running'
    : dirtyNames ? 'Save names first'
      : !hasTurns ? 'Publishing needs timed speaker turns.'
        : staleCorrection ? 'The published transcript changed. Cancel and start again.'
          : correction ? (correction.state !== 'draft' ? 'This edit was already published.' : null)
            : unresolved ? 'Finish the publish that needs attention first.'
              : alreadyPublished ? 'This run is already published.'
                : status !== 'ready' ? 'Only a ready run can be published.' : null;
  const canReview = correction ? Boolean(t.content) : status === 'ready' && job?.contentAccessAllowed === true && Boolean(t.content);
  const title = correction ? 'Edit speaker names' : displayName(job);
  const showRefresh = matchingActive || conflict;
  const base = t.basePath;

  return (
    <div className="mt-5" data-testid="transcript-review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold text-gray-950">{title}</h3>
          {correction
            ? <p className="mt-1 text-xs text-gray-600">Changes names only. The wording and timestamps stay the same.</p>
            : <p className="mt-1 text-sm text-gray-700">{RUN_STATE_LABELS[status] || 'Unknown'}{job?.ready_at ? ` ${fmtDateTime(job.ready_at)}` : ''}{job?.needsAttention ? ' · Needs attention' : ''}</p>}
        </div>
        {showRefresh && <button type="button" onClick={t.refreshReview} disabled={Boolean(busy)} className={BTN}>{busy === 'loading' ? 'Refreshing…' : 'Refresh'}</button>}
      </div>
      {!correction && status === 'submission_uncertain' && <div className="mt-3"><Notice tone="warning">We could not confirm this recording was accepted for transcription. Do not start another transcription for the same recording until this run is resolved.</Notice></div>}
      {!correction && job?.contentDeletionObserved && <div className="mt-3"><Notice tone="info">This draft’s text is no longer available.</Notice></div>}
      {!correction && status === 'failed' && <div className="mt-3"><Notice>This run could not be transcribed. Try Generate from audio again, or contact an administrator if it keeps failing.</Notice></div>}
      {!correction && status === 'expired' && <div className="mt-3"><Notice tone="warning">This run has expired and its text is no longer available.</Notice></div>}
      {!correction && status === 'ready' && job?.contentAccessAllowed === false && <p className="mt-3 text-sm text-gray-700">This draft’s text is no longer available.</p>}
      {!correction && status === 'ready' && job?.contentAccessAllowed !== false && !t.content && busy === 'loading' && <div className="mt-3 h-20 animate-pulse rounded-lg bg-gray-100" aria-label="Loading draft" />}
      {canReview && <>
        {!correction && <p className="mt-2 text-xs text-gray-600">Not published yet.{job.expires_at ? ` Draft kept until ${fmtDateTime(job.expires_at)}.` : ''}
          {' '}<a className="underline" href={`${base}/${encodeURIComponent(job.id)}/download?format=txt`}>Download draft TXT</a>
          {t.content?.utterances?.length > 0 && <>{' · '}<a className="underline" href={`${base}/${encodeURIComponent(job.id)}/download?format=vtt`}>Download draft VTT</a></>}
        </p>}
        {matchingActive && <div className="mt-3" aria-live="polite"><Notice tone="info">Matching names from Zoom captions…</Notice></div>}
        {alignmentShown && ALIGNMENT_REASONS[alignmentStatus] && <p className="mt-3 text-sm leading-5 text-gray-700">{ALIGNMENT_REASONS[alignmentStatus]}</p>}
        <SpeakerEditor t={{ ...t, collection }} alignment={alignment} readOnly={matchingActive || (correction && correction.state !== 'draft')} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="mr-auto text-xs text-gray-600" aria-live="polite">{dirtyNames ? 'Unsaved name changes' : 'Names saved'}</span>
          <button type="button" onClick={t.saveNames} disabled={!dirtyNames || Boolean(busy) || matchingActive} className={BTN}>{busy === 'speakers' ? 'Saving names…' : 'Save names'}</button>
          <button type="button" onClick={correction ? t.publishCorrection : t.publishJob} disabled={Boolean(publishBlockedReason) || Boolean(busy)} className={BTN_PRIMARY}>{busy === 'publish' ? 'Publishing…' : 'Publish transcript'}</button>
        </div>
        {publishBlockedReason && <p className="mt-2 text-xs leading-5 text-gray-600">{publishBlockedReason}</p>}
      </>}
      {conflict && <p className="mt-3 text-sm text-amber-950" role="alert">Another session changed this. Refresh to load the latest version; your edits stay in the fields.</p>}
      <div className="mt-3">
        {correction
          ? <button type="button" onClick={t.cancelEditNames} disabled={Boolean(busy)} className={BTN_LINK}>Cancel</button>
          : status === 'ready' && <button type="button" onClick={() => t.discardRun(job)} disabled={Boolean(busy)} className={BTN_LINK}>Discard this draft</button>}
      </div>
    </div>
  );
}

function AttentionBlock({ t }) {
  const rows = t.publications.filter((row) => UNRESOLVED_PUBLICATION.has(row.state));
  if (!rows.length) return null;
  const { busy, collectionCheckedAt } = t;
  return (
    <details className="mt-5" open data-testid="needs-attention">
      <summary className={`cursor-pointer text-sm font-semibold text-amber-950 ${FOCUS_RING}`}>Needs attention ({rows.length})</summary>
      <ul className="mt-2 space-y-3">
        {rows.map((row) => {
          const waited = Boolean(row.quarantineUntil) && new Date(row.quarantineUntil).getTime() <= collectionCheckedAt
            && (!row.leaseExpiresAt || new Date(row.leaseExpiresAt).getTime() <= collectionCheckedAt);
          const started = !row.sourceArtifactId ? fmtTime(row.createdAt) : '';
          const copy = row.state === 'published_reconcile' ? 'Publishing did not finish. Check now.'
            : row.state === 'unknown' ? 'We could not confirm this publish. Check now.'
              : row.state === 'retryable' ? 'Publishing failed. Try again.'
                : `Publishing…${started ? ` started ${started}` : ''}`;
          const action = row.state === 'retryable' ? 'Try again' : 'Check now';
          return (
            <li key={row.operationId} className="text-sm text-amber-950">
              <p className="font-medium">{copy}</p>
              {row.errorCode && <p className="mt-1 break-all text-xs text-amber-900">Reference: {row.errorCode}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void t.checkPublication(row)} disabled={Boolean(busy)} className={BTN}>{busy === `check-${row.operationId}` ? 'Checking…' : action}</button>
                {waited && <button type="button" onClick={() => void t.closePublication(row)} disabled={Boolean(busy) || t.closeAcknowledgedId !== row.operationId} className={BTN}>{busy === `close-${row.operationId}` ? 'Closing…' : 'Close this attempt'}</button>}
              </div>
              {waited && <label className="mt-2 flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={t.closeAcknowledgedId === row.operationId} disabled={Boolean(busy)} onChange={(event) => t.setCloseAcknowledgedId(event.target.checked ? row.operationId : null)} className="mt-0.5 h-4 w-4 rounded border-amber-500" /><span>Closing stops retries. Any partly saved files stay in SharePoint, and the current transcript is not changed.</span></label>}
              {!waited && row.quarantineUntil && <p className="mt-2 text-xs leading-5">You can close this attempt after {fmtDateTime(row.quarantineUntil)}.</p>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function EarlierRuns({ t }) {
  const runs = t.showReview ? t.jobs.filter((job) => job.id !== t.focusJob?.id) : t.jobs.filter((job) => job.id !== t.newestJob?.id);
  if (!runs.length) return null;
  return (
    <details className="mt-5" data-testid="earlier-runs">
      <summary className={`cursor-pointer text-sm font-semibold text-gray-900 ${FOCUS_RING}`}>Earlier runs ({runs.length})</summary>
      <ul className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
        {runs.map((job) => (
          <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-gray-900">{displayName(job)}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                {job.ready_at && <Chip>Ready {fmtDateTime(job.ready_at)}</Chip>}
                <Chip tone={job.status === 'ready' ? 'green' : ACTIVE_STATUSES.has(job.status) ? 'blue' : job.status === 'submission_uncertain' ? 'amber' : 'gray'}>{RUN_STATE_LABELS[job.status] || 'Unknown'}</Chip>
              </p>
            </div>
            {job.status === 'ready' && <div className="flex items-center gap-3">
              <button type="button" onClick={() => t.reviewRun(job)} disabled={Boolean(t.busy)} className={BTN}>Review</button>
              <button type="button" onClick={() => void t.discardRun(job)} disabled={Boolean(t.busy)} className={BTN_LINK}>Discard this draft</button>
            </div>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function GenerateForm({ t }) {
  const { busy, audioFile, vttFile } = t;
  const audioError = audioFormat(audioFile);
  const vttError = vttFormat(vttFile);
  const vttInputRef = useRef(null);
  const sizeError = audioFile && (audioFile.size < 1 || audioFile.size > MAX_AUDIO_BYTES);
  return (
    <div className="mt-4 border-t border-gray-200 pt-4" data-testid="generate-form">
      <label htmlFor="recording-transcript-audio" className="block text-xs font-medium text-gray-700">Audio file (M4A or MP3, up to {MAX_TRANSCRIPTION_MIB} MiB)</label>
      <input id="recording-transcript-audio" type="file" accept=".m4a,.mp3,audio/mp4,audio/x-m4a,audio/mpeg" multiple disabled={Boolean(busy)} onChange={(event) => t.chooseFiles(event.target.files, 'audio')} className={FILE_INPUT} />
      {audioFile && <p className="mt-2 break-all text-xs text-gray-700">{audioFile.name} · {(audioFile.size / (1024 * 1024)).toFixed(1)} MiB</p>}
      {audioError && <p className="mt-2 text-sm text-red-800" role="alert">{audioError}</p>}
      {sizeError && <p className="mt-2 text-sm text-red-800" role="alert">Choose an audio recording larger than 0 bytes and no larger than {MAX_TRANSCRIPTION_MIB} MiB.</p>}
      <label htmlFor="recording-transcript-vtt" className="mt-3 block text-xs font-medium text-gray-700">Zoom captions (.vtt, optional) · names speakers automatically</label>
      <input id="recording-transcript-vtt" ref={vttInputRef} type="file" accept=".vtt,text/vtt" multiple disabled={Boolean(busy)} onChange={(event) => t.chooseFiles(event.target.files, 'vtt')} className={FILE_INPUT} />
      {vttFile && <p className="mt-2 break-all text-xs text-gray-700">{vttFile.name} · {(vttFile.size / 1024).toFixed(0)} KiB</p>}
      {vttError && <p className="mt-2 text-sm text-red-800" role="alert">{vttError}</p>}
      <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-gray-800">
        <input type="checkbox" checked={t.acknowledged} disabled={Boolean(busy)} onChange={(event) => t.setAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-blue-600" />
        <span>This recording is non-sensitive and may be sent to our transcription provider.{vttFile ? ' Excerpts of both transcripts are also sent to Anthropic to match speaker names.' : ''} Transcription uses paid credits.</span>
      </label>
      {t.uploadProgress !== null && <div className="mt-3" aria-live="polite"><div className="flex justify-between text-xs text-gray-700"><span>{busy === 'upload-captions' ? 'Uploading Zoom captions' : t.uploadProgress < 100 ? 'Uploading to private storage' : 'Upload complete'}</span><span>{t.uploadProgress}%</span></div><progress className="mt-1 h-2 w-full accent-gray-900" max="100" value={t.uploadProgress} aria-label="Private upload progress" /></div>}
      <button type="button" onClick={t.uploadAndStart} disabled={!audioFile || Boolean(audioError) || Boolean(vttError) || Boolean(sizeError) || !t.acknowledged || Boolean(busy)} className={`mt-3 ${BTN_PRIMARY}`}>{busy === 'upload' ? 'Uploading…' : busy === 'upload-captions' ? 'Uploading Zoom captions…' : busy === 'starting' ? 'Starting transcription…' : 'Start transcription'}</button>
      {t.confirmNoVtt && !vttFile && !busy && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-950" role="alert">
        <p>Add Zoom captions to name speakers automatically?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => { t.setNoVttConfirmation(null); vttInputRef.current?.focus(); }} className={BTN}>Add Zoom captions</button>
          <button type="button" onClick={t.uploadAndStart} className={BTN}>Continue without it</button>
        </div>
      </div>}
    </div>
  );
}

function UploadForm({ m }) {
  return (
    <div className="mt-4 border-t border-gray-200 pt-4" data-testid="upload-form">
      <label htmlFor="recording-transcript-file" className="block text-xs font-medium text-gray-700">Transcript file (VTT, text, PDF, or DOCX, up to 25 MiB)</label>
      <p className="mt-1 text-xs text-gray-600">Zoom’s chat.txt is meeting chat, not a transcript. Uploading replaces the current transcript.</p>
      <input
        id="recording-transcript-file"
        ref={m.transcriptInputRef}
        type="file"
        accept=".vtt,.txt,.pdf,.docx,text/vtt,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        disabled={m.transcriptBusy}
        onChange={(event) => m.chooseTranscriptFile(event.target.files?.[0] || null)}
        className={FILE_INPUT}
      />
      {m.transcriptFile && <p className="mt-2 break-all text-xs text-gray-700">{m.transcriptFile.name}</p>}
      {m.transcriptProgress !== null && <p className="mt-2 text-xs text-gray-600">Uploading: {m.transcriptProgress}%</p>}
      {m.transcriptError && <p role="alert" className="mt-2 text-sm text-red-800">{m.transcriptError}</p>}
      <button type="button" onClick={m.uploadTranscript} disabled={!m.transcriptFile || m.transcriptBusy} className={`mt-3 ${BTN_PRIMARY}`}>{m.transcriptBusy ? 'Uploading…' : m.transcriptStagedId ? 'Finish transcript' : 'Upload transcript'}</button>
    </div>
  );
}

function TranscriptBlock({ m, t }) {
  const [openForm, setOpenForm] = useState(null);
  const material = (m.data?.materials || []).find((item) => Number(item.artifactType) === REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT) || null;
  const line = describeCurrentTranscript({ material, collection: t.collection });
  const artifact = t.collection?.currentArtifact;
  const generated = line.kind === 'generated';
  const openUrl = material ? safeMaterialUrl(material) : null;
  const featureEnabled = t.collection?.featureState === 'enabled';
  const generateReason = !t.collection ? 'Not available right now' : !featureEnabled ? 'Not enabled for this request' : null;
  const active = t.newestJob && ACTIVE_STATUSES.has(t.newestJob.status) ? t.newestJob : null;
  const editing = Boolean(t.correction);
  const toggle = (form) => setOpenForm((value) => (value === form ? null : form));
  return (
    <section className="mt-6 border-t border-gray-200 pt-5" aria-labelledby="recording-transcript-transcript-title">
      <h3 id="recording-transcript-transcript-title" className="text-base font-semibold text-gray-950">Transcript</h3>
      <p className="mt-2 text-sm leading-6 text-gray-900" data-testid="current-transcript-line">{line.text}</p>
      {line.kind === 'uploaded' && <p className="mt-1 text-xs text-gray-600">Uploaded file · speaker names cannot be edited here.</p>}
      {material && <div className="mt-2 flex flex-wrap items-center gap-2">
        {generated && artifact && <>
          <a className={BTN} href={`${t.basePath}/materials/${encodeURIComponent(artifact.id)}/download?format=txt`}>Download TXT</a>
          <a className={BTN} href={`${t.basePath}/materials/${encodeURIComponent(artifact.id)}/download?format=vtt`}>Download VTT</a>
          {!editing && <button type="button" onClick={t.beginEditNames} disabled={Boolean(t.busy)} className={BTN}>{t.busy === 'create-draft' ? 'Opening…' : 'Edit speaker names'}</button>}
        </>}
        {!generated && openUrl && <a className={BTN} href={openUrl} target="_blank" rel="noopener noreferrer">Open</a>}
      </div>}
      <div className="mt-4 flex flex-wrap items-start gap-3">
        <button type="button" onClick={() => toggle('upload')} aria-expanded={openForm === 'upload'} className={BTN}>Upload a transcript</button>
        <div>
          <button type="button" onClick={() => toggle('generate')} aria-expanded={openForm === 'generate'} disabled={Boolean(generateReason)} className={BTN}>Generate from audio</button>
          {generateReason && <p className="mt-1 text-xs text-gray-600">{generateReason}</p>}
        </div>
      </div>
      {openForm === 'upload' && <UploadForm m={m} />}
      {openForm === 'generate' && !generateReason && <GenerateForm t={t} />}
      {t.error && <div className="mt-4"><Notice>{t.error}</Notice></div>}
      {t.notice && <div className="mt-4"><Notice tone={/could not|did not|still needs/.test(t.notice) ? 'warning' : 'success'}>{t.notice}</Notice></div>}
      {active && !editing && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-800" aria-live="polite" data-testid="transcript-progress">
          <p>{PROGRESS_VERBS[active.status]} {displayName(active)}{active.created_at ? ` · started ${fmtTime(active.created_at)}` : ''}</p>
          <button type="button" onClick={() => void t.loadCollection()} disabled={t.loading || Boolean(t.busy)} className={BTN}>{t.loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      )}
      {(editing || (t.showReview && t.focusJob && !ACTIVE_STATUSES.has(t.focusJob.status))) && <ReviewBlock t={t} />}
      <AttentionBlock t={t} />
      <EarlierRuns t={t} />
    </section>
  );
}

function RecordingBlock({ m }) {
  const [replaceOpen, setReplaceOpen] = useState(false);
  const recording = (m.data?.materials || []).find((item) => Number(item.artifactType) === REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING) || null;
  const openUrl = recording ? safeMaterialUrl(recording) : null;
  const intents = m.data?.uploads || [];
  const confirmed = m.transfer?.confirmedBytes || 0;
  const inFlight = Math.max(0, (m.transfer?.inFlightBytes || confirmed) - confirmed);
  const lockedByWork = Boolean(m.busyUploadId || m.recoveryBusyId || m.zoomBusy);
  const showInputs = !recording || replaceOpen || lockedByWork || Boolean(m.file) || intents.length > 0;
  return (
    <section aria-labelledby="recording-transcript-recording-title">
      <h3 id="recording-transcript-recording-title" className="text-base font-semibold text-gray-950">Recording</h3>
      <p className="mt-1 text-xs text-gray-600">Zoom link or MP4. Saving a new one replaces the current one.</p>
      {m.error && <div className="mt-3"><Notice>{m.error}</Notice></div>}
      {m.notice && <div className="mt-3"><Notice tone="info">{m.notice}</Notice></div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-900" data-testid="current-recording-line">
          {recording
            ? `${recording.backing === 'external' ? 'Zoom link' : recording.filename}${recording.createdAt ? ` · added ${fmtDateTime(recording.createdAt)}` : ''}`
            : 'No recording yet'}
        </p>
        <div className="flex items-center gap-2">
          {openUrl && <a href={openUrl} target="_blank" rel="noopener noreferrer" className={BTN}>Open</a>}
          {recording && !showInputs && <button type="button" onClick={() => setReplaceOpen(true)} className={BTN}>Replace recording</button>}
        </div>
      </div>
      {showInputs && <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="recording-transcript-zoom-link" className="block text-xs font-medium text-gray-700">Zoom link (paste the share message if it has a passcode)</label>
          <textarea
            id="recording-transcript-zoom-link" rows={3} maxLength={12000} value={m.zoomText} disabled={m.zoomBusy}
            onChange={(event) => m.changeZoomText(event.target.value)}
            className={INPUT}
          />
          {m.zoomError && <p role="alert" className="mt-2 text-sm text-red-800">{m.zoomError}</p>}
          <Button type="button" size="sm" className="mt-3" loading={m.zoomBusy} disabled={!m.zoomText.trim() || lockedByWork} onClick={m.saveZoom}>Save Zoom link</Button>
        </div>
        <div>
          <label htmlFor="recording-transcript-mp4" className="block text-xs font-medium text-gray-700">MP4 file</label>
          <input id="recording-transcript-mp4" type="file" accept="video/mp4,.mp4" disabled={lockedByWork} onChange={(event) => m.setFile(event.target.files?.[0] || null)} className={FILE_INPUT} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!m.file || lockedByWork} loading={m.busyUploadId === 'new'} onClick={m.begin}>Upload MP4</Button>
            {m.busyUploadId && m.transfer?.phase && !['paused', 'complete'].includes(m.transfer.phase) && (
              <Button type="button" size="sm" variant="outline" disabled={m.pauseRequested} onClick={m.requestPause}>Pause after fragment</Button>
            )}
          </div>
        </div>
      </div>}
      {m.transfer && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950" aria-live="polite">
          <p className="font-semibold">{phaseCopy(m.transfer)}</p>
          <progress className="mt-3 w-full" max="100" value={m.transfer.percent || 0} aria-label="Confirmed upload progress" />
          <p className="mt-2">Confirmed: {formatBytes(confirmed)} of {formatBytes(m.transfer.totalBytes)}</p>
          <p>In flight, not yet confirmed: {formatBytes(inFlight)}</p>
          <p>Throughput: {m.transfer.mbps == null ? (m.transfer.rateStale ? 'Unknown while waiting' : 'Measuring…') : `${m.transfer.mbps.toFixed(2)} Mbps`}</p>
          <p>ETA: {m.transfer.etaSeconds == null ? 'Unknown while waiting' : `${Math.ceil(m.transfer.etaSeconds)} seconds`}</p>
        </div>
      )}
      {intents.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-gray-900">Unfinished uploads</h4>
          <ul className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
            {intents.map((intent) => (
              <li key={intent.uploadId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div><p className="font-medium text-gray-900">{intent.filename}</p><p className="text-xs text-gray-500">{formatBytes(intent.size)} · {intent.state}</p></div>
                <div className="flex gap-2">
                  {intent.canResume && <Button type="button" size="sm" variant="outline" disabled={lockedByWork} onClick={() => m.resume(intent)}>Resume</Button>}
                  {intent.canRetry && <Button type="button" size="sm" variant="outline" disabled={lockedByWork} loading={m.recoveryBusyId === intent.uploadId} onClick={() => m.retry(intent)}>Retry upload</Button>}
                  {intent.canFinalize && <Button type="button" size="sm" disabled={lockedByWork} loading={m.busyUploadId === intent.uploadId} onClick={() => m.finish(intent.uploadId)}>Finish saving</Button>}
                  {intent.canCancel && !intent.canFinalize && <Button type="button" size="sm" variant="outline" disabled={Boolean(m.zoomBusy || m.recoveryBusyId || (m.busyUploadId && m.busyUploadId !== intent.uploadId))} onClick={() => m.setConfirmCancelId(intent.uploadId)}>Cancel</Button>}
                </div>
                {m.confirmCancelId === intent.uploadId && (
                  <div className="w-full rounded border border-amber-200 bg-amber-50 p-3 text-amber-950">
                    <p>Cancel this unfinished upload? Unsaved progress will be lost. A completed recording will remain available to finish saving.</p>
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" disabled={Boolean(m.recoveryBusyId)} onClick={() => m.cancel(intent)}>Cancel upload</Button>
                      <Button type="button" size="sm" variant="outline" disabled={Boolean(m.recoveryBusyId)} onClick={() => m.setConfirmCancelId(null)}>Keep upload</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function PresentationLinkBlock({ m }) {
  const { link, linkBusy, linkError, linkCopied, manualCopy, confirmReissue } = m;
  return (
    <section className="mt-6 border-t border-gray-200 pt-5" data-testid="presentation-link-controls">
      <h3 className="text-base font-semibold text-gray-950">Board presentation link</h3>
      <p className="mt-1 text-xs text-gray-600">This materials-only link does not send email or change recipients.</p>
      {!link && <Button type="button" size="sm" className="mt-3" loading={linkBusy} disabled={linkBusy} onClick={() => m.mutateLink('ensure')}>Generate link</Button>}
      {link && (
        <>
          {link.url ? (
            <>
              <p className="mt-3 truncate font-mono text-xs text-gray-500" title={link.url}>{link.url}</p>
              {manualCopy && <input aria-label="Presentation link for manual copy" readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} className="mt-2 w-full rounded border border-gray-300 p-2 font-mono text-xs" />}
              <p className="mt-1 text-xs text-gray-500">Expires {new Date(link.expiresAt).toLocaleDateString()}.</p>
            </>
          ) : <p className="mt-2 text-sm text-amber-800">The current link cannot be read. Issue a new link to replace it.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {link.url && <Button type="button" size="sm" variant="outline" onClick={m.copyLink}>{linkCopied ? 'Copied' : 'Copy link'}</Button>}
            {!confirmReissue && <Button type="button" size="sm" variant="outline" disabled={linkBusy} onClick={() => m.setConfirmReissue(true)}>Issue new link</Button>}
          </div>
          {confirmReissue && (
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p>The current presentation link will stop working immediately.</p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" loading={linkBusy} disabled={linkBusy} onClick={() => m.mutateLink('reissue')}>Issue new link</Button>
                <Button type="button" size="sm" variant="outline" disabled={linkBusy} onClick={() => m.setConfirmReissue(false)}>Keep current link</Button>
              </div>
            </div>
          )}
        </>
      )}
      {linkError && <p role="alert" className="mt-2 text-sm text-red-700">{linkError}</p>}
    </section>
  );
}

function RecordingAndTranscriptCardForRequest({ requestId }) {
  const m = useMaterials(requestId);
  const t = useTranscription(requestId, { onMaterialsChanged: m.load });
  const heading = <h2 className="text-lg font-semibold text-gray-950">Recording and transcript</h2>;
  const shell = 'mt-8 min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6';
  if (m.unavailable) return <section className={shell} data-testid="recording-and-transcript-card">{heading}<p className="mt-2 text-sm text-gray-700">Recording and transcript are not available for this request.</p></section>;
  return (
    <section className={shell} data-testid="recording-and-transcript-card" aria-labelledby="recording-transcript-title">
      <div id="recording-transcript-title">{heading}</div>
      {m.loading && !m.data && <p className="mt-4 text-sm text-gray-500">Loading…</p>}
      {m.error && !m.data && <div className="mt-4"><Notice>{m.error}</Notice></div>}
      {m.data && (
        <div className="mt-4">
          <RecordingBlock m={m} />
          <TranscriptBlock m={m} t={t} />
          <PresentationLinkBlock m={m} />
        </div>
      )}
    </section>
  );
}

export default function RecordingAndTranscriptCard({ requestId }) {
  if (!requestId) return null;
  return <RecordingAndTranscriptCardForRequest key={requestId} requestId={requestId} />;
}
