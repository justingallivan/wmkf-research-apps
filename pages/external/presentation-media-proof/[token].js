import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
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
  const videoRef = useRef(null);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    requestJson(`/api/external/presentation-media-proof/${encodeURIComponent(token)}/context`, {
      fallbackMessage: 'This proof cannot be opened.',
    })
      .then((body) => {
        if (!cancelled) setState(body.ok ? { status: 'ok', data: body } : { status: 'error', reason: body.reason || 'server_error' });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error', reason: 'server_error' }); });
    return () => { cancelled = true; };
  }, [token]);

  const endpoint = (mode, selectedDelivery = delivery) => `/api/external/presentation-media-proof/${encodeURIComponent(token)}/open?mode=${mode}&delivery=${selectedDelivery}`;

  const watch = async () => {
    setResolverHits((value) => value + 1);
    if (delivery === 'redirect') {
      videoRef.current.src = endpoint('watch', 'redirect');
      await videoRef.current.play().catch(() => {});
      return;
    }
    const body = await requestJson(endpoint('watch', 'json'), { fallbackMessage: 'Media resolution failed.' })
      .catch((error) => {
        setState({ status: 'error', reason: error.payload?.reason || 'server_error' });
        return null;
      });
    if (!body?.url) return;
    videoRef.current.src = body.url;
    await videoRef.current.play().catch(() => {});
  };

  const download = async () => {
    setResolverHits((value) => value + 1);
    if (delivery === 'redirect') {
      window.location.assign(endpoint('download', 'redirect'));
      return;
    }
    const body = await requestJson(endpoint('download', 'json'), { fallbackMessage: 'Download resolution failed.' })
      .catch((error) => {
        setState({ status: 'error', reason: error.payload?.reason || 'server_error' });
        return null;
      });
    if (!body?.url) return;
    window.location.assign(body.url);
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900">
      <div className="mx-auto max-w-4xl space-y-5">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Preview-only proof</p>
          <h1 className="mt-1 text-2xl font-semibold">Presentation media transport</h1>
        </header>
        {state.status === 'loading' && <p>Loading proof…</p>}
        {state.status === 'error' && <p className="rounded border border-red-200 bg-red-50 p-4 text-red-900">This proof cannot be opened ({state.reason}).</p>}
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
              <button type="button" onClick={download} className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold">Download</button>
            </div>
            <video ref={videoRef} controls preload="metadata" className="mt-5 aspect-video w-full rounded bg-black" />
            <p className="mt-3 text-xs text-gray-500">Application resolver actions from this page: {resolverHits}. Seeking should not increase this count.</p>
          </section>
        )}
      </div>
    </main>
  );
}
