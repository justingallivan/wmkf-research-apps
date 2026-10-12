import { useRef, useState } from 'react';
import { Play } from 'lucide-react';

/**
 * Click-to-play video whose `src` comes from a same-origin route that redirects to a short-lived
 * Microsoft download URL (Board page, Workbench). A failure re-resolves the URL once and resumes
 * from the last position; a second failure offers Resume. `srcFor(attempt)` returns the route URL.
 * `reading` is the Board page's size; `compact` sits inside staff panels.
 */
const SIZES = {
  reading: {
    frame: 'rounded-xl',
    disc: 'h-20 w-20',
    icon: 'ml-1 h-9 w-9',
    label: 'text-lg font-semibold',
    status: 'text-base text-gray-600',
    button: 'px-5 py-2.5 text-base',
  },
  compact: {
    frame: 'rounded-lg',
    disc: 'h-14 w-14',
    icon: 'ml-0.5 h-6 w-6',
    label: 'text-sm font-semibold',
    status: 'text-sm text-gray-600',
    button: 'px-3 py-1.5 text-sm',
  },
};

export default function PresentationVideoPlayer({ srcFor, label = 'Watch the presentation', size = 'reading' }) {
  const classes = SIZES[size] || SIZES.reading;
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
    video.src = srcFor(attemptRef.current);
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
      <div className={`relative aspect-video w-full overflow-hidden bg-gray-900 ${classes.frame}`}>
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
            <span className={`flex items-center justify-center rounded-full bg-white text-gray-900 shadow-[0_8px_24px_-6px_rgb(0_0_0/0.5)] transition-transform duration-300 ease-out group-hover:scale-105 group-active:scale-95 ${classes.disc}`}>
              <Play aria-hidden="true" className={classes.icon} fill="currentColor" strokeWidth={0} />
            </span>
            <span className={classes.label}>{label}</span>
          </button>
        )}
      </div>
      {(status || canResume) && (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {status && <p role="status" className={classes.status}>{status}</p>}
          {canResume && (
            <button type="button" onClick={() => resolveWatch(lastTimeRef.current)}
              className={`inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white font-semibold text-gray-800 transition-colors duration-200 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 ${classes.button}`}>
              Resume
            </button>
          )}
        </div>
      )}
    </div>
  );
}
