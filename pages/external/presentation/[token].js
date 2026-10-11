import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Play } from 'lucide-react';
import { requestJson } from '../../../shared/utils/api-request.js';
import { arrangeMaterials, displayName, isType } from '../../../shared/utils/presentation-page-materials.js';
import SummaryText from '../../../shared/components/SummaryText.js';
import {
  PRESENTATION_SUMMARY_HEADINGS,
  PRESENTATION_SUMMARY_LIST_HEADINGS,
} from '../../../shared/config/transcriptSummary.js';

const PDF = 'application/pdf';
const BUTTON = 'inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-base font-semibold text-gray-800 transition-colors duration-200 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60';
const LINK = 'text-base font-semibold text-gray-700 underline decoration-gray-300 underline-offset-4 transition-colors duration-200 hover:text-gray-900 hover:decoration-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 rounded-sm';

function endpoint(token, material, mode, attempt = 0) {
  const params = new URLSearchParams({ member: material.member, mode });
  if (attempt) params.set('attempt', String(attempt));
  return `/api/external/presentation/${encodeURIComponent(token)}/open?${params}`;
}

function Video({ token, material }) {
  const videoRef = useRef(null);
  const lastTimeRef = useRef(0);
  const pendingSeekRef = useRef(null);
  const attemptRef = useRef(0);
  const retriedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('');
  const [canResume, setCanResume] = useState(false);

  const resolveWatch = (position = null) => {
    const video = videoRef.current;
    if (!video) return;
    attemptRef.current += 1;
    pendingSeekRef.current = position;
    setCanResume(false);
    setStatus('Loading the video…');
    video.src = endpoint(token, material, 'watch', attemptRef.current);
    video.load();
    void video.play().catch(() => setStatus('Press play to start.'));
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
      setStatus('The video stopped. Reconnecting…');
      resolveWatch(lastTimeRef.current);
      return;
    }
    setCanResume(true);
    setStatus('The video stopped again.');
  };
  const onLoadedMetadata = () => {
    const video = videoRef.current;
    const position = pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (!video || position === null) return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.min(position, Math.max(0, video.duration - 0.25));
    }
    void video.play().catch(() => setStatus('Press play to continue.'));
  };

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-gray-900">
        {playing ? (
          <video
            ref={videoRef}
            controls
            playsInline
            preload="metadata"
            onError={onError}
            onLoadedMetadata={onLoadedMetadata}
            onPlaying={() => setStatus('')}
            onTimeUpdate={(event) => { lastTimeRef.current = event.currentTarget.currentTime; }}
            className="h-full w-full"
          />
        ) : (
          <button
            type="button"
            onClick={start}
            className="group absolute inset-0 flex flex-col items-center justify-center gap-4 text-white focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-white/70"
          >
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-gray-900 shadow-[0_8px_24px_-6px_rgb(0_0_0/0.5)] transition-transform duration-300 ease-out group-hover:scale-105 group-active:scale-95">
              <Play aria-hidden="true" className="ml-1 h-9 w-9" fill="currentColor" strokeWidth={0} />
            </span>
            <span className="text-lg font-semibold">Watch the presentation</span>
          </button>
        )}
      </div>
      {(status || canResume) && (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {status && <p role="status" className="text-base text-gray-600">{status}</p>}
          {canResume && (
            <button type="button" onClick={() => resolveWatch(lastTimeRef.current)} className={BUTTON}>Resume</button>
          )}
        </div>
      )}
    </div>
  );
}

function ViewPdfButton({ token, material, children }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Microsoft serves every file as a download, so the PDF is fetched here and handed to the
  // browser's own viewer as a local copy. The tab is opened first, inside the click, so it is not blocked.
  const open = async () => {
    const tab = window.open('', '_blank');
    setBusy(true);
    setFailed(false);
    try {
      if (tab) tab.opener = null;
      // eslint-disable-next-line no-restricted-syntax -- raw fetch: binary PDF bytes via the open route's redirect to Microsoft (not JSON); allowlisted per CLIENT_REQUEST_LAYER_PLAN §2.6
      const response = await fetch(endpoint(token, material, 'open'));
      if (!response.ok) throw new Error(`status ${response.status}`);
      const url = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: PDF }));
      if (tab && !tab.closed) tab.location.href = url;
      else window.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
    } catch {
      if (tab && !tab.closed) tab.close();
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" onClick={open} disabled={busy} className={BUTTON}>{busy ? 'Opening…' : children}</button>
      {failed && (
        <p role="status" className="basis-full text-base text-gray-600">
          This file could not be opened here.{' '}
          <a href={endpoint(token, material, 'download')} className={LINK}>Download it instead</a>
        </p>
      )}
    </>
  );
}

function MaterialRow({ name, children }) {
  return (
    <li className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <p className="text-lg font-medium text-gray-900">{name}</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">{children}</div>
    </li>
  );
}

function SectionHeading({ children }) {
  return <h2 className="text-2xl font-semibold text-gray-900">{children}</h2>;
}

function Materials({ token, slidesPdf, slidesOriginal, others }) {
  if (!slidesPdf && !slidesOriginal && others.length === 0) return null;
  return (
    <section className="mt-16">
      <SectionHeading>Slides and materials</SectionHeading>
      <ul className="mt-4 divide-y divide-gray-200 border-y border-gray-200">
        {(slidesPdf || slidesOriginal) && (
          <MaterialRow name="Slides">
            {slidesPdf ? (
              <>
                <ViewPdfButton token={token} material={slidesPdf}>View slides</ViewPdfButton>
                {slidesOriginal
                  ? <a href={endpoint(token, slidesOriginal, 'download')} className={LINK}>Download PowerPoint</a>
                  : <a href={endpoint(token, slidesPdf, 'download')} className={LINK}>Download PDF</a>}
              </>
            ) : (
              <a href={endpoint(token, slidesOriginal, 'download')} className={BUTTON}>Download slides</a>
            )}
          </MaterialRow>
        )}
        {others.map((material) => (
          <MaterialRow key={material.member} name={displayName(material.filename)}>
            {isType(material, PDF) ? (
              <>
                <ViewPdfButton token={token} material={material}>View</ViewPdfButton>
                <a href={endpoint(token, material, 'download')} className={LINK}>Download PDF</a>
              </>
            ) : <a href={endpoint(token, material, 'download')} className={BUTTON}>Download</a>}
          </MaterialRow>
        ))}
      </ul>
    </section>
  );
}

function Page({ token, data }) {
  const { video, summary, slidesPdf, slidesOriginal, others } = arrangeMaterials(data.materials);
  const heading = data.proposalTitle || data.title;
  const expires = data.expiresAt ? new Date(data.expiresAt) : null;
  return (
    <>
      <header>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-gray-900 text-balance sm:text-4xl sm:leading-tight">{heading}</h1>
        <p className="mt-3 text-lg text-gray-600">
          {data.proposalTitle && data.title ? `${data.title} · Research presentation` : 'Research presentation'}
        </p>
      </header>

      {!video && !summary && (
        <p className="mt-10 rounded-xl bg-gray-50 px-6 py-5 text-lg text-gray-700">
          The presentation recording and summary will be added after the site visit.
        </p>
      )}

      {video && (
        <section className="mt-10" aria-label="Presentation video">
          <Video token={token} material={video} />
        </section>
      )}

      {summary && (
        <section className="mt-16">
          <SectionHeading>Summary</SectionHeading>
          <div className="mt-6">
            {summary.text ? (
              <SummaryText text={summary.text} headings={PRESENTATION_SUMMARY_HEADINGS} listHeadings={PRESENTATION_SUMMARY_LIST_HEADINGS} />
            ) : (
              <p className="text-lg text-gray-700">
                The summary could not be shown here.{' '}
                <a href={endpoint(token, summary, 'download')} className={LINK}>Download the summary</a>
              </p>
            )}
          </div>
        </section>
      )}

      <Materials token={token} slidesPdf={slidesPdf} slidesOriginal={slidesOriginal} others={others} />

      {expires && !Number.isNaN(expires.getTime()) && (
        <p className="mt-16 text-sm text-gray-500">
          This link expires {expires.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.
        </p>
      )}
    </>
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
    <main className="min-h-screen bg-white px-4 py-12 text-gray-900 selection:bg-gray-200 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-3xl">
        {state.status === 'loading' && <p className="text-lg text-gray-600">Loading…</p>}
        {state.status === 'error' && <p className="rounded-xl bg-red-50 px-6 py-5 text-lg text-red-900">This presentation link is unavailable or has expired.</p>}
        {state.status === 'retry' && <p className="rounded-xl bg-amber-50 px-6 py-5 text-lg text-amber-950">Presentation materials are temporarily unavailable. Try again shortly.</p>}
        {state.status === 'ready' && <Page token={token} data={state.data} />}
      </div>
    </main>
  );
}
