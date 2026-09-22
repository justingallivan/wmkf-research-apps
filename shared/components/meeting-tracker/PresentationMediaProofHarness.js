import { useEffect, useRef, useState } from 'react';
import { uploadPresentationMediaProofFile, nextExpectedStart } from '../../utils/presentation-media-proof-upload';
import { requestJson } from '../../utils/api-request';

const STORAGE_KEY = 'wmkf:presentation-media-proof-upload';

async function proofAction(body) {
  return requestJson('/api/meeting-tracker/presentation-media-proof', {
    method: 'POST',
    body,
    fallbackMessage: 'The proof action failed.',
  });
}

function formatBytes(value) {
  return `${(Number(value || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PresentationMediaProofHarness() {
  const [requestId, setRequestId] = useState('');
  const [file, setFile] = useState(null);
  const [saved, setSaved] = useState(null);
  const [status, setStatus] = useState('Choose a sanctioned request and MP4 larger than 50 MB.');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState(null);
  const pauseRef = useRef(false);
  const abortRef = useRef(null);

  useEffect(() => {
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
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, []);

  const persist = (value) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    setSaved(value);
  };

  const sameFile = () => Boolean(file && saved
    && file.name === saved.file.name
    && file.size === saved.file.size
    && file.lastModified === saved.file.lastModified);

  const runUpload = async ({ uploadUrl, chunkBytes, start }) => {
    pauseRef.current = false;
    abortRef.current = new AbortController();
    setBusy(true);
    setStatus('Uploading directly from this browser to Microsoft…');
    try {
      const result = await uploadPresentationMediaProofFile({
        file,
        uploadUrl,
        chunkBytes,
        start,
        signal: abortRef.current.signal,
        shouldPause: () => pauseRef.current,
        onProgress: ({ uploaded, total }) => setProgress(Math.round((uploaded / total) * 100)),
      });
      setStatus(result.complete
        ? 'Microsoft committed the complete file. Finish saving to mint the five-minute playback proof.'
        : `Paused at ${formatBytes(result.nextStart)}. You can Resume now or reload and reselect the file.`);
    } catch (error) {
      setStatus(error.name === 'AbortError' ? 'Upload stopped.' : error.message);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const begin = async () => {
    if (!file) return setStatus('Choose an MP4 first.');
    setBusy(true);
    setProof(null);
    try {
      const data = await proofAction({
        action: 'begin', requestId, filename: file.name, mimeType: file.type,
        size: file.size, lastModified: file.lastModified,
      });
      const record = {
        permit: data.permit,
        requestId,
        file: { name: file.name, size: file.size, lastModified: file.lastModified },
        expiresAt: data.expiresAt,
      };
      persist(record);
      setProgress(0);
      await runUpload({
        uploadUrl: data.uploadUrl,
        chunkBytes: data.chunkBytes,
        start: nextExpectedStart(data.nextExpectedRanges, 0),
      });
    } catch (error) {
      setStatus(error.message);
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!saved?.permit) return setStatus('No unfinished proof upload was found.');
    if (!sameFile()) return setStatus('Reselect the exact same local file before resuming.');
    setBusy(true);
    try {
      const data = await proofAction({ action: 'status', permit: saved.permit });
      if (data.complete) {
        setProgress(100);
        setStatus('Microsoft already committed the file. Use Finish saving.');
        setBusy(false);
        return;
      }
      await runUpload({
        uploadUrl: data.uploadUrl,
        chunkBytes: data.chunkBytes,
        start: nextExpectedStart(data.nextExpectedRanges, 0),
      });
    } catch (error) {
      setStatus(error.message);
      setBusy(false);
    }
  };

  const finalize = async () => {
    if (!saved?.permit) return setStatus('No proof upload is available to finalize.');
    setBusy(true);
    try {
      const data = await proofAction({ action: 'finalize', permit: saved.permit });
      setProof(data);
      setStatus('Playback proof created. Open it in a private window before the five-minute token expires.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  const cleanup = async () => {
    if (!saved?.permit) return setStatus('No proof upload is available to clean up.');
    setBusy(true);
    try {
      const data = await proofAction({ action: 'cleanup', permit: saved.permit });
      sessionStorage.removeItem(STORAGE_KEY);
      setSaved(null);
      setProof(null);
      setProgress(0);
      setStatus(data.deletedItem ? 'The exact disposable SharePoint item was deleted.' : 'The upload session was cancelled; no committed item existed.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Preview-only transport proof</p>
          <h1 className="mt-1 text-2xl font-semibold">Presentation video upload and playback</h1>
          <p className="mt-2 text-sm text-gray-700">Use only a sanctioned sandbox request and a real Zoom MP4. The file travels directly to Microsoft and must be removed with Cleanup after testing.</p>
        </header>

        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium" htmlFor="proof-request">Sandbox request GUID</label>
          <input id="proof-request" value={requestId} onChange={(event) => setRequestId(event.target.value)} disabled={Boolean(saved)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm" />
          <label className="mt-4 block text-sm font-medium" htmlFor="proof-file">Zoom MP4 (over 50 MB)</label>
          <input id="proof-file" type="file" accept="video/mp4,.mp4" onChange={(event) => setFile(event.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />
          {file && <p className="mt-2 text-xs text-gray-600">{file.name} · {formatBytes(file.size)}</p>}

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" disabled={busy || Boolean(saved)} onClick={begin} className="rounded bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Begin and upload</button>
            <button type="button" disabled={!busy} onClick={() => { pauseRef.current = true; }} className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-40">Pause after chunk</button>
            <button type="button" disabled={busy || !saved} onClick={resume} className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-40">Resume</button>
            <button type="button" disabled={busy || !saved} onClick={finalize} className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Finish saving</button>
            <button type="button" disabled={busy || !saved} onClick={cleanup} className="rounded border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-40">Cleanup exact item</button>
          </div>

          <div className="mt-5 h-2 overflow-hidden rounded bg-gray-200" aria-label={`Upload ${progress}% complete`}>
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p role="status" className="mt-3 text-sm text-gray-700">{status}</p>
          {saved?.expiresAt && <p className="mt-1 text-xs text-gray-500">Graph session initially expires {new Date(saved.expiresAt).toLocaleString()}.</p>}
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
