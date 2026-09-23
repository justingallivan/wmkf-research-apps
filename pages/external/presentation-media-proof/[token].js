import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { classifyDeployment } from '../../../lib/dataverse/core/interlock';
import { requestJson } from '../../../shared/utils/api-request';

function formatBytes(value) {
  return `${(Number(value || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

export async function getServerSideProps() {
  if (classifyDeployment() !== 'preview') return { notFound: true };
  return { props: {} };
}

export default function PresentationMediaProofPage() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : '';
  const [state, setState] = useState({ status: 'loading' });
  const [delivery, setDelivery] = useState('redirect');
  const [resolverHits, setResolverHits] = useState(0);
  const [mediaStatus, setMediaStatus] = useState('');
  const [canResume, setCanResume] = useState(false);
  const videoRef = useRef(null);
  const lastTimeRef = useRef(0);
  const pendingSeekRef = useRef(null);
  const autoRetriedRef = useRef(false);
  const resolutionRef = useRef(0);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    requestJson(`/api/external/presentation-media-proof/${encodeURIComponent(token)}/context`, {
      fallbackMessage: 'This proof cannot be opened.',
    })
      .then((body) => {
        if (!cancelled) setState(body.ok ? { status: 'ok', data: body } : { status: 'error', reason: body.reason || 'server_error' });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', reason: error.payload?.reason || 'server_error' });
      });
    return () => { cancelled = true; resolutionRef.current += 1; };
  }, [token]);

  const endpoint = (mode, selectedDelivery = delivery) => `/api/external/presentation-media-proof/${encodeURIComponent(token)}/open?mode=${mode}&delivery=${selectedDelivery}`;
  const tokenIsLive = () => state.status === 'ok' && Date.now() < Date.parse(state.data.expiresAt);
  const expiredMessage = 'The five-minute proof token expired. Return to the staff proof harness and use Finish saving to issue a new link.';

  const resolveWatch = async (resumeAt = null) => {
    if (!tokenIsLive()) {
      setMediaStatus(expiredMessage);
      setCanResume(false);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const resolution = ++resolutionRef.current;
    pendingSeekRef.current = resumeAt;
    setResolverHits((value) => value + 1);
    setMediaStatus('Resolving a fresh Microsoft media URL…');
    try {
      if (delivery === 'redirect') {
        // A distinct URL makes Safari/Edge issue a new no-store 302 after a
        // media error instead of reusing the prior video resource.
        video.src = `${endpoint('watch', 'redirect')}&attempt=${resolution}`;
      } else {
        const body = await requestJson(endpoint('watch', 'json'), { fallbackMessage: 'Media resolution failed.' });
        if (resolution !== resolutionRef.current) return;
        if (!body?.url) throw new Error('Microsoft did not return a media URL.');
        video.src = body.url;
      }
      video.load();
      await video.play().catch(() => {
        if (resolution === resolutionRef.current) setMediaStatus('Press Play in the video controls to continue.');
      });
    } catch (error) {
      if (resolution !== resolutionRef.current) return;
      setCanResume(true);
      setMediaStatus(error.payload?.reason === 'expired' || !tokenIsLive() ? expiredMessage : error.message);
    }
  };

  const watch = () => {
    autoRetriedRef.current = false;
    lastTimeRef.current = 0;
    setCanResume(false);
    void resolveWatch();
  };

  const resumeWatch = () => {
    autoRetriedRef.current = true;
    setCanResume(false);
    void resolveWatch(lastTimeRef.current);
  };

  const onMediaError = () => {
    if (!tokenIsLive()) {
      setMediaStatus(expiredMessage);
      setCanResume(false);
      return;
    }
    if (!autoRetriedRef.current) {
      autoRetriedRef.current = true;
      setMediaStatus('Playback stopped. Trying one fresh media resolution…');
      void resolveWatch(lastTimeRef.current);
      return;
    }
    setCanResume(true);
    setMediaStatus('Playback stopped again. Use Resume Watch for a new explicit resolution.');
  };

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    const position = pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (!video || position === null) return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.min(position, Math.max(0, video.duration - 0.25));
    }
    void video.play().catch(() => setMediaStatus('Position restored. Press Play in the video controls to continue.'));
  };

  const download = async () => {
    if (!tokenIsLive()) {
      setMediaStatus(expiredMessage);
      return;
    }
    setResolverHits((value) => value + 1);
    if (delivery === 'redirect') {
      window.location.assign(endpoint('download', 'redirect'));
      return;
    }
    try {
      const body = await requestJson(endpoint('download', 'json'), { fallbackMessage: 'Download resolution failed.' });
      if (!body?.url) throw new Error('Microsoft did not return a download URL.');
      window.location.assign(body.url);
    } catch (error) {
      setMediaStatus(!tokenIsLive() ? expiredMessage : error.message);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900">
      <div className="mx-auto max-w-4xl space-y-5">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Preview-only proof</p>
          <h1 className="mt-1 text-2xl font-semibold">Presentation media transport</h1>
        </header>
        {state.status === 'loading' && <p>Loading proof…</p>}
        {state.status === 'error' && <p className="rounded border border-red-200 bg-red-50 p-4 text-red-900">This proof cannot be opened ({state.reason}). Return to the staff proof harness and use Finish saving for a new link.</p>}
        {state.status === 'ok' && (
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="font-medium">{state.data.filename}</p>
            <p className="text-sm text-gray-600">{formatBytes(state.data.size)} · token expires {new Date(state.data.expiresAt).toLocaleTimeString()}</p>
            <fieldset className="mt-4">
              <legend className="text-sm font-medium">Resolver delivery shape</legend>
              <label className="mr-4 text-sm"><input type="radio" name="delivery" value="redirect" checked={delivery === 'redirect'} onChange={() => setDelivery('redirect')} /> 302 redirect</label>
              <label className="text-sm"><input type="radio" name="delivery" value="json" checked={delivery === 'json'} onChange={() => setDelivery('json')} /> one-shot URL</label>
            </fieldset>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={watch} className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Watch</button>
              {canResume && <button type="button" onClick={resumeWatch} className="rounded border border-blue-700 px-4 py-2 text-sm font-semibold text-blue-900">Resume Watch</button>}
              <button type="button" onClick={download} className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold">Download</button>
            </div>
            <video ref={videoRef} controls preload="metadata" onError={onMediaError} onLoadedMetadata={onLoadedMetadata} onTimeUpdate={(event) => { lastTimeRef.current = event.currentTarget.currentTime; }} className="mt-5 aspect-video w-full rounded bg-black" />
            {mediaStatus && <p role="status" className="mt-3 text-sm text-amber-900">{mediaStatus}</p>}
            <p className="mt-3 text-xs text-gray-500">Application resolver actions from this page: {resolverHits}. Seeking should not increase this count. If a download URL expires, click Download again.</p>
            <Link href="/meeting-tracker/presentation-media-proof" className="mt-2 inline-block text-xs text-blue-800 underline">Staff proof harness for a new five-minute link</Link>
          </section>
        )}
      </div>
    </main>
  );
}
