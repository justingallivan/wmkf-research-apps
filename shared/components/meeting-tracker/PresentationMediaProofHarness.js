import { useEffect, useRef, useState } from 'react';
import { fingerprintPresentationMediaProofFile } from '../../utils/presentation-media-proof-upload';
import {
  nextExpectedStart,
  uploadBrowserDirectGraphFile,
  withGraphBrowserUploadLock,
} from '../../utils/graph-browser-upload';
import { requestJson } from '../../utils/api-request';

const STORAGE_KEY = 'wmkf:presentation-media-proof-upload';
const STORAGE_SCHEMA_VERSION = 2;

async function proofAction(body, signal) {
  return requestJson('/api/meeting-tracker/presentation-media-proof', {
    method: 'POST',
    body,
    signal,
    fallbackMessage: 'The proof action failed.',
  });
}

function formatBytes(value) {
  return `${(Number(value || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Calculating…';
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}m ${remainder}s`;
}

function uploadStatusCopy(state) {
  if (!state) return null;
  if (state.phase === 'uploading') {
    return 'Uploading directly from this browser to Microsoft. Progress below is Graph-confirmed.';
  }
  if (state.phase === 'pausing') return 'Pausing after Microsoft confirms the current fragment…';
  if (state.phase === 'reconnecting') {
    if (state.reason === 'offline') return 'Offline. Waiting briefly to reconnect without spending a retry attempt…';
    if (state.reason === 'throttled') return 'Microsoft asked this upload to slow down. Reconnecting after Retry-After…';
    return 'Reconnecting through a fresh authorized Graph status check…';
  }
  if (state.phase === 'paused') {
    if (state.reason === 'offline_timeout') return 'Paused because the browser stayed offline. Use Resume for a fresh authorized status check.';
    if (state.reason === 'throttled') return 'Paused after bounded Microsoft throttling. Use Resume for a fresh authorized status check.';
    if (state.reason === 'retry_exhausted') return 'Paused after three attempts without Graph-confirmed progress. Use Resume to check live status again.';
  }
  return null;
}

export default function PresentationMediaProofHarness() {
  const [requestId, setRequestId] = useState('');
  const [file, setFile] = useState(null);
  const [saved, setSaved] = useState(null);
  const [status, setStatus] = useState('Choose a sanctioned request and MP4 larger than 50 MB.');
  const [uploadState, setUploadState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploadActive, setUploadActive] = useState(false);
  const [proof, setProof] = useState(null);
  const pauseRef = useRef(false);
  const abortRef = useRef(null);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    let timer = null;
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (parsed?.permit) {
        timer = window.setTimeout(() => {
          setSaved(parsed);
          setRequestId(parsed.requestId || '');
          setStatus('An unfinished proof upload was found. Reselect the same file, then Resume.');
        }, 0);
      }
    } catch {}
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      abortRef.current?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const persist = (value) => {
    const versioned = { ...value, schemaVersion: STORAGE_SCHEMA_VERSION };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(versioned));
    } catch {
      throw new Error('The browser could not retain the encrypted resume permit. Keep this tab open and retry.');
    }
    setSaved(versioned);
    return versioned;
  };

  const sameFile = async (chosenFile, record) => Boolean(chosenFile && record?.fingerprint
    && chosenFile.name === record.file.name
    && chosenFile.size === record.file.size
    && chosenFile.lastModified === record.file.lastModified
    && await fingerprintPresentationMediaProofFile(chosenFile) === record.fingerprint);

  const runUpload = async ({ chosenFile, record, uploadUrl, chunkBytes, start, generation }) => {
    pauseRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setUploadActive(true);
    setStatus('Uploading directly from this browser to Microsoft. Progress below is Graph-confirmed.');
    try {
      const lockKey = record.lockKey || record.permit.slice(-48);
      const result = await withGraphBrowserUploadLock(lockKey, () => uploadBrowserDirectGraphFile({
          file: chosenFile,
          uploadUrl,
          chunkBytes,
          start,
          signal: controller.signal,
          shouldPause: () => pauseRef.current,
          authorizeStatus: async () => {
            const data = await proofAction({ action: 'status', permit: record.permit }, controller.signal);
            if (mountedRef.current && generationRef.current === generation && data.expiresAt) {
              persist({ ...record, expiresAt: data.expiresAt });
            }
            return data;
          },
          onState: (next) => {
            if (!mountedRef.current || generationRef.current !== generation) return;
            setUploadState(next);
            const copy = uploadStatusCopy(next);
            if (copy) setStatus(copy);
          },
        }));
      if (!mountedRef.current || generationRef.current !== generation) return;
      if (result.expiresAt) persist({ ...record, expiresAt: result.expiresAt });
      setStatus(result.complete
        ? 'Microsoft and the application verified the complete committed file. Finish saving to mint the five-minute playback proof.'
        : uploadStatusCopy({ phase: 'paused', reason: result.reason })
          || `Paused at ${formatBytes(result.nextStart)} of Graph-confirmed bytes. You can Resume now or reload and reselect the file.`);
    } catch (error) {
      if (!mountedRef.current || generationRef.current !== generation) return;
      if (error.payload?.code === 'presentation_media_proof_session_expired') {
        setStatus('Microsoft confirmed that the Graph upload session expired without a visible committed file. Keep this permit for owner-approved Cleanup, then begin a new proof upload.');
      } else if (error.payload?.code === 'presentation_media_proof_session_closed') {
        setStatus('Microsoft closed the upload session, but the final item outcome is unresolved. Keep this permit and retry status or owner-approved Cleanup; do not start a replacement automatically.');
      } else if (error.status === 401 || error.status === 403) {
        setStatus('The application could not reauthorize this upload. Sign in again, then use Resume; the Graph offset and permit were kept.');
      } else {
        setStatus(error.name === 'AbortError'
          ? 'Upload stopped. The confirmed offset and permit were kept; Resume will reconcile live Graph status.'
          : error.message);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current && generationRef.current === generation) {
        setUploadActive(false);
        setBusy(false);
      }
    }
  };

  const begin = async () => {
    if (!file) return setStatus('Choose an MP4 first.');
    const chosenFile = file;
    const generation = generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProof(null);
    try {
      const fingerprint = await fingerprintPresentationMediaProofFile(chosenFile);
      if (!mountedRef.current || generationRef.current !== generation) return;
      const data = await proofAction({
        action: 'begin', requestId, filename: chosenFile.name, mimeType: chosenFile.type,
        size: chosenFile.size, lastModified: chosenFile.lastModified,
      }, controller.signal);
      if (!mountedRef.current || generationRef.current !== generation) return;
      const record = persist({
        permit: data.permit,
        lockKey: data.lockKey,
        requestId,
        file: { name: chosenFile.name, size: chosenFile.size, lastModified: chosenFile.lastModified },
        fingerprint,
        expiresAt: data.expiresAt,
      });
      setUploadState(null);
      if (abortRef.current === controller) abortRef.current = null;
      await runUpload({
        chosenFile,
        record,
        uploadUrl: data.uploadUrl,
        chunkBytes: data.chunkBytes,
        start: nextExpectedStart(data.nextExpectedRanges),
        generation,
      });
    } catch (error) {
      if (mountedRef.current && generationRef.current === generation) {
        setStatus(error.message);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current && generationRef.current === generation) setBusy(false);
    }
  };

  const resume = async () => {
    if (!saved?.permit) return setStatus('No unfinished proof upload was found.');
    const chosenFile = file;
    const record = saved;
    const generation = generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      if (!record.fingerprint) {
        setStatus('This older proof has no file fingerprint. Keep the permit for Cleanup, then begin a new proof.');
        return;
      }
      const fileMatches = await sameFile(chosenFile, record);
      if (!mountedRef.current || generationRef.current !== generation) return;
      if (!fileMatches) {
        setStatus('Reselect the exact same local file before resuming; its size, timestamp, and SHA-256 edge fingerprint must match.');
        return;
      }
      const data = await proofAction({ action: 'status', permit: record.permit }, controller.signal);
      if (!mountedRef.current || generationRef.current !== generation) return;
      if (data.complete) {
        setUploadState({
          phase: 'complete', confirmedBytes: record.file.size, inFlightBytes: record.file.size,
          totalBytes: record.file.size, percent: 100, mbps: null, etaSeconds: 0,
          expiresAt: data.expiresAt || record.expiresAt,
        });
        setStatus('Microsoft and the application verified the committed file. Use Finish saving.');
        setBusy(false);
        return;
      }
      const refreshedRecord = persist({ ...record, expiresAt: data.expiresAt || record.expiresAt });
      if (abortRef.current === controller) abortRef.current = null;
      await runUpload({
        chosenFile,
        record: refreshedRecord,
        uploadUrl: data.uploadUrl,
        chunkBytes: data.chunkBytes,
        start: nextExpectedStart(data.nextExpectedRanges),
        generation,
      });
    } catch (error) {
      if (!mountedRef.current || generationRef.current !== generation) return;
      if (error.payload?.code === 'presentation_media_proof_session_expired') {
        setStatus('Microsoft confirmed that the Graph upload session expired without a visible committed file. Keep this permit; after owner-approved Cleanup, begin a new proof upload.');
      } else if (error.payload?.code === 'presentation_media_proof_session_closed') {
        setStatus('Microsoft closed the upload session, but the item outcome is unresolved. Keep the permit and do not start a replacement automatically.');
      } else if (error.status === 401 || error.status === 403) {
        setStatus('The application could not reauthorize this upload. Sign in again, then use Resume; the Graph offset and permit were kept.');
      } else {
        setStatus(error.message);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current && generationRef.current === generation) setBusy(false);
    }
  };

  const finalize = async () => {
    if (!saved?.permit) return setStatus('No proof upload is available to finalize.');
    const record = saved;
    const generation = generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      const data = await proofAction({ action: 'finalize', permit: record.permit }, controller.signal);
      if (!mountedRef.current || generationRef.current !== generation) return;
      setProof(data);
      setStatus('Playback proof created. Open it in a private window before the five-minute token expires.');
    } catch (error) {
      if (!mountedRef.current || generationRef.current !== generation) return;
      setStatus(error.message);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current && generationRef.current === generation) setBusy(false);
    }
  };

  const cleanup = async () => {
    if (!saved?.permit) return setStatus('No proof upload is available to clean up.');
    const record = saved;
    const generation = generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      const data = await proofAction({ action: 'cleanup', permit: record.permit }, controller.signal);
      if (!mountedRef.current || generationRef.current !== generation) return;
      const outcomeCopy = {
        item_deleted: 'The exact disposable SharePoint item was moved to the site recycle bin.',
        placeholder_deleted: 'The terminal upload session left an exact partial SharePoint placeholder; it was moved to the site recycle bin.',
        session_cancelled: 'Microsoft confirmed the upload session was cancelled; no committed item existed.',
        session_gone: 'Microsoft reports the upload session no longer exists; no committed item was found.',
        session_expired: 'Microsoft reports the upload session expired; no committed item was found.',
      }[data.cleanupOutcome];
      if (!outcomeCopy) {
        throw new Error('Cleanup did not return a confirmed outcome. The retry permit was retained.');
      }
      sessionStorage.removeItem(STORAGE_KEY);
      setSaved(null);
      setProof(null);
      setUploadState(null);
      setStatus(outcomeCopy);
    } catch (error) {
      if (!mountedRef.current || generationRef.current !== generation) return;
      setStatus(error.message);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current && generationRef.current === generation) setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Preview-only transport proof</p>
          <h1 className="mt-1 text-2xl font-semibold">Presentation video upload and playback</h1>
          <p className="mt-2 text-sm text-gray-700">Use only the owner-sanctioned disposable request and a real Zoom MP4. The file travels directly to Microsoft and must be removed with Cleanup after testing.</p>
        </header>

        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium" htmlFor="proof-request">Sanctioned request GUID</label>
          <input id="proof-request" value={requestId} onChange={(event) => { generationRef.current += 1; setRequestId(event.target.value); }} disabled={busy || Boolean(saved)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm" />
          <label className="mt-4 block text-sm font-medium" htmlFor="proof-file">Zoom MP4 (over 50 MB)</label>
          <input id="proof-file" type="file" accept="video/mp4,.mp4" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />
          {file && <p className="mt-2 text-xs text-gray-600">{file.name} · {formatBytes(file.size)}</p>}

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" disabled={busy || Boolean(saved)} onClick={begin} className="rounded bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Begin and upload</button>
            <button type="button" disabled={!uploadActive} onClick={() => {
              pauseRef.current = true;
              setUploadState((current) => current ? { ...current, phase: 'pausing', etaSeconds: null } : current);
              setStatus('Pausing after Microsoft confirms the current fragment…');
            }} className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-40">Pause after chunk</button>
            <button type="button" disabled={busy || !saved} onClick={resume} className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-40">Resume</button>
            <button type="button" disabled={busy || !saved} onClick={finalize} className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Finish saving</button>
            <button type="button" disabled={busy || !saved} onClick={cleanup} className="rounded border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-40">Cleanup exact item</button>
          </div>

          <div className="mt-5 h-2 overflow-hidden rounded bg-gray-200" aria-label={`Upload ${Math.round(uploadState?.percent || 0)}% Graph-confirmed`}>
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${uploadState?.percent || 0}%` }} />
          </div>
          <p role="status" className="mt-3 text-sm text-gray-700">{status}</p>
          {uploadState && (
            <div className="mt-2 grid gap-1 text-xs text-gray-600 sm:grid-cols-3">
              <p>Confirmed: {formatBytes(uploadState.confirmedBytes)} / {formatBytes(uploadState.totalBytes)}</p>
              <p>In flight: {formatBytes(Math.max(0, uploadState.inFlightBytes - uploadState.confirmedBytes))}</p>
              <p>{['reconnecting', 'pausing', 'paused'].includes(uploadState.phase)
                ? 'ETA unavailable while the upload is not advancing'
                : uploadState.mbps
                  ? `${uploadState.mbps.toFixed(2)} Mbps · ETA ${formatEta(uploadState.etaSeconds)}`
                  : 'Throughput and ETA pending a confirmed sample'}</p>
            </div>
          )}
          {(uploadState?.expiresAt || saved?.expiresAt) && <p className="mt-1 text-xs text-gray-500">Last Graph-reported session expiry: {new Date(uploadState?.expiresAt || saved.expiresAt).toLocaleString()}.</p>}
        </section>

        {proof?.proofUrl && (
          <section className="rounded-xl border border-green-200 bg-green-50 p-5">
            <h2 className="font-semibold text-green-950">Five-minute playback proof</h2>
            <a href={proof.proofUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-sm font-semibold text-blue-800 underline">Open proof page</a>
            <p className="mt-2 text-xs text-green-900">Expires {new Date(proof.expiresAt).toLocaleString()}. Cleanup remains required after testing.</p>
          </section>
        )}
      </div>
    </main>
  );
}
