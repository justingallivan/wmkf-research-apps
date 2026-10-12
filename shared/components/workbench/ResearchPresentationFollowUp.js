import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../config/requestDocument';
import {
  DISCUSSION_SUMMARY_HEADINGS, DISCUSSION_SUMMARY_LIST_HEADINGS,
  PRESENTATION_SUMMARY_HEADINGS, PRESENTATION_SUMMARY_LIST_HEADINGS,
} from '../../config/transcriptSummary';
import SummaryText, { parseSummaryText } from '../SummaryText';
import PresentationVideoPlayer from '../PresentationVideoPlayer';

const SLOTS = [
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING, label: 'Full recording', action: 'Watch full recording' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, label: 'Full transcript', action: 'Open full transcript' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT, label: 'Presentation transcript', action: 'Open presentation transcript' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT, label: 'Staff discussion transcript', action: 'Open staff discussion transcript' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, label: 'Presentation summary', action: 'Open presentation summary' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_SUMMARY, label: 'Staff discussion summary', action: 'Open staff discussion summary' },
];

// Each summary's sections are fixed by its prompt; until "Read more" the first one is shown,
// capped at a length so a long opening (or text without the headings) stays a preview.
const PRESENTATION_SUMMARY = { headings: PRESENTATION_SUMMARY_HEADINGS, listHeadings: PRESENTATION_SUMMARY_LIST_HEADINGS };
const DISCUSSION_SUMMARY = { headings: DISCUSSION_SUMMARY_HEADINGS, listHeadings: DISCUSSION_SUMMARY_LIST_HEADINGS };
const COLLAPSED_MAX_CHARS = 700;

// Returns the preview and whether it hides anything.
function collapsedPreview(text, format) {
  const sections = parseSummaryText(text, format);
  const first = sections[0];
  if (!first) return { preview: text, hidesText: false };
  const opening = [first.heading, ...first.lines].filter(Boolean).join('\n');
  if (opening.length > COLLAPSED_MAX_CHARS) {
    return { preview: `${opening.slice(0, COLLAPSED_MAX_CHARS).trim()}…`, hidesText: true };
  }
  return { preview: opening, hidesText: sections.length > 1 };
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
}

function SummaryBlock({ summary, format = PRESENTATION_SUMMARY, testId = 'presentation-summary-text', staleNote }) {
  const [expanded, setExpanded] = useState(false);
  const published = formatDate(summary.publishedAt);
  const text = summary.text || '';
  const { preview, hidesText: canExpand } = collapsedPreview(text, format);
  return (
    <div className="mt-0.5" data-testid={testId}>
      <p className="text-xs text-gray-500">
        {published ? `Published ${published}` : 'Published'}
        {summary.stale ? ` · ${staleNote || 'from an earlier transcript version; the Board link no longer shows it'}` : ''}
        {summary.slidesChanged === true ? ' · the applicant slides were updated after this summary was made' : ''}
      </p>
      {text && (
        <>
          <div className="mt-2">
            <SummaryText text={expanded || !canExpand ? text : preview} {...format} headingLevel={5} size="compact" />
          </div>
          {canExpand && (
            <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}
              className="mt-2 text-sm font-semibold text-blue-800 underline">
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Rendered inside the Presentation step of the Staff deliberations tab: one
// link per published item (file names carry internal ids, so they are not
// shown), and the summary's opening with Read more.
export default function ResearchPresentationFollowUp({ requestId = null, videoPlayable = false, status, materials = [], summary = null, discussionSummary = null }) {
  if (status === 'disabled') return null;
  const byType = new Map(materials.map((material) => [Number(material.artifactType), material]));
  const present = SLOTS
    .map((slot) => {
      const material = byType.get(slot.type);
      if (!material) return null;
      return { ...slot, href: material.backing === 'external' ? material.externalUrl : material.webUrl };
    })
    .filter(Boolean);
  const summarySlot = present.find((slot) => slot.type === REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY);
  const discussionSlot = present.find((slot) => slot.type === REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_SUMMARY);
  // A summary shown below needs no link; one whose text could not be read keeps its link.
  const shownBelow = new Set([
    summarySlot && summary?.text ? summarySlot.type : null,
    discussionSlot && discussionSummary?.text ? discussionSlot.type : null,
  ]);
  const linked = present.filter((slot) => !shownBelow.has(slot.type));
  // The approved presentation cut plays here (the server re-checks it against the approved cut);
  // the full recording stays a link because it includes the staff discussion.
  const video = byType.get(REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_VIDEO);
  const showVideo = Boolean(requestId && videoPlayable && video && video.backing === 'file');
  const videoSrc = (attempt) => `/api/workbench/site-visit/presentation-video?${new URLSearchParams({ requestId, attempt: String(attempt) })}`;
  return (
    <div className="mt-3" data-testid="research-presentation-follow-up">
      <h4 className="text-sm font-semibold text-gray-900">Recording and transcripts</h4>
      {status === 'loading' && <p className="mt-1 text-sm text-gray-600">Loading presentation materials…</p>}
      {status === 'unavailable' && (
        <p className="mt-1 text-sm text-red-800" role="alert">Presentation materials could not be loaded.</p>
      )}
      {status === 'loaded' && present.length === 0 && (
        <p className="mt-1 text-sm text-gray-600">The recording and transcripts appear here after the Meeting Tracker publishes them.</p>
      )}
      {status === 'loaded' && showVideo && (
        <div className="mt-2 max-w-3xl" data-testid="presentation-video">
          <PresentationVideoPlayer key={requestId} srcFor={videoSrc} size="compact" />
        </div>
      )}
      {status === 'loaded' && linked.length > 0 && (
        <ul className={`${showVideo ? 'mt-3' : 'mt-1'} flex flex-wrap gap-x-5 gap-y-1 text-sm`}>
          {linked.map((slot) => (
            <li key={slot.type}>
              {slot.href ? (
                <a href={slot.href} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-blue-700 underline-offset-4 hover:text-blue-900 hover:underline">
                  {slot.action}
                  <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                </a>
              ) : (
                <span className="text-gray-600">{slot.label} (link unavailable)</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {status === 'loaded' && summarySlot && summary && (
        <div className="mt-6 max-w-3xl">
          <h4 className="text-sm font-semibold text-gray-900">Presentation summary</h4>
          <SummaryBlock summary={summary} />
        </div>
      )}
      {status === 'loaded' && discussionSlot && discussionSummary && (
        <div className="mt-6 max-w-3xl">
          <h4 className="text-sm font-semibold text-gray-900">Staff discussion summary</h4>
          <p className="text-xs text-gray-500">Staff only. Never included on the Board page.</p>
          <SummaryBlock summary={discussionSummary} format={DISCUSSION_SUMMARY}
            testId="discussion-summary-text" staleNote="from an earlier transcript version" />
        </div>
      )}
    </div>
  );
}
