import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { requestJson } from '../../../shared/utils/api-request.js';

function bytesLabel(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${bytes.toLocaleString()} bytes`;
}

function endpoint(token, material, mode, attempt = 0) {
  const params = new URLSearchParams({ member: material.member, mode });
  if (attempt) params.set('attempt', String(attempt));
  return `/api/external/presentation/${encodeURIComponent(token)}/open?${params}`;
}

function Recording({ token, material }) {
  const videoRef = useRef(null);
  const lastTimeRef = useRef(0);
  const pendingSeekRef = useRef(null);
  const attemptRef = useRef(0);
  const retriedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('');
  const [canResume, setCanResume] = useState(false);

  if (material.backing === 'external') {
    return <a href={endpoint(token, material, 'watch')} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-800 underline">Watch on Zoom</a>;
  }

  const resolveWatch = (position = null) => {
    const video = videoRef.current;
    if (!video) return;
    attemptRef.current += 1;
    pendingSeekRef.current = position;
    setCanResume(false);
    setStatus('Resolving a fresh Microsoft media URL…');
    video.src = endpoint(token, material, 'watch', attemptRef.current);
    video.load();
    void video.play().catch(() => setStatus('Press Play in the video controls to continue.'));
  };

  const start = () => {
    setPlaying(true);
    retriedRef.current = false;
    lastTimeRef.current = 0;
    window.setTimeout(() => resolveWatch(), 0);
  };
  const onError = () => {
    if (!retriedRef.current) {
      retriedRef.current = true;
      setStatus('Playback stopped. Trying one fresh Microsoft media resolution…');
      resolveWatch(lastTimeRef.current);
      return;
    }
    setCanResume(true);
    setStatus('Playback stopped again. Choose Resume watch to request a fresh link.');
  };
  const onLoadedMetadata = () => {
    const video = videoRef.current;
    const position = pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (!video || position === null) return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.min(position, Math.max(0, video.duration - 0.25));
    }
    void video.play().catch(() => setStatus('Position restored. Press Play to continue.'));
  };

  return (
    <div>
      {!playing && <button type="button" onClick={start} className="text-sm font-semibold text-blue-800 underline">Watch recording</button>}
      {playing && (
        <>
          <video
            ref={videoRef}
            controls
            preload="metadata"
            onError={onError}
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={(event) => { lastTimeRef.current = event.currentTarget.currentTime; }}
            className="mt-3 aspect-video w-full rounded-lg bg-black"
          />
          {canResume && <button type="button" onClick={() => resolveWatch(lastTimeRef.current)} className="mt-2 text-sm font-semibold text-blue-800 underline">Resume watch</button>}
          {status && <p role="status" className="mt-2 text-sm text-amber-900">{status}</p>}
        </>
      )}
    </div>
  );
}

function Material({ token, material }) {
  const size = bytesLabel(material.size);
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{material.label}</p>
      <p className="mt-1 font-medium text-gray-900">{material.filename}</p>
      {size && <p className="mt-1 text-xs text-gray-500">{size}</p>}
      <div className="mt-3 flex flex-wrap gap-4">
        {material.canWatch && <Recording token={token} material={material} />}
        {material.canDownload && (
          <a href={endpoint(token, material, 'download')} className="text-sm font-semibold text-blue-800 underline">Download</a>
        )}
      </div>
    </li>
  );
}

export default function PresentationMaterialsPage() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : '';
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    let current = true;
    requestJson(`/api/external/presentation/${encodeURIComponent(token)}/context`, {
      method: 'GET', signal: controller.signal, fallbackMessage: 'These materials cannot be opened.',
    }).then((body) => {
      if (current) setState(body.ok ? { status: 'ready', data: body } : { status: 'error' });
    }).catch((error) => {
      if (!current) return;
      setState({ status: [429, 503].includes(error?.status) ? 'retry' : 'error' });
    });
    return () => { current = false; controller.abort(); };
  }, [token]);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 text-gray-900">
      <div className="mx-auto max-w-4xl">
        {state.status === 'loading' && <p>Loading research presentation materials…</p>}
        {state.status === 'error' && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">This presentation link is unavailable or has expired.</p>}
        {state.status === 'retry' && <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">Presentation materials are temporarily unavailable. Try again shortly.</p>}
        {state.status === 'ready' && (
          <>
            <header>
              <p className="text-sm font-medium text-gray-600">{state.data.title}</p>
              <h1 className="mt-1 text-3xl font-semibold">Research presentation materials</h1>
              {state.data.proposalTitle && <p className="mt-2 text-gray-700">{state.data.proposalTitle}</p>}
            </header>
            {state.data.materials.length === 0 ? (
              <p className="mt-8 rounded-xl border border-gray-200 bg-white p-5">Presentation materials have not been added yet.</p>
            ) : (
              <ul className="mt-8 space-y-4">
                {state.data.materials.map((material) => <Material key={material.member} token={token} material={material} />)}
              </ul>
            )}
            {state.data.expiresAt && <p className="mt-8 text-xs text-gray-500">This link expires {new Date(state.data.expiresAt).toLocaleDateString()}.</p>}
          </>
        )}
      </div>
    </main>
  );
}
