import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../config/requestDocument';
import {
  DISCUSSION_SUMMARY_HEADINGS, DISCUSSION_SUMMARY_LIST_HEADINGS,
  PRESENTATION_SUMMARY_HEADINGS, PRESENTATION_SUMMARY_LIST_HEADINGS,
} from '../../config/transcriptSummary';
import SummaryText, { parseSummaryText } from '../SummaryText';

const SLOTS = [
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING, label: 'Recording', action: 'Watch recording' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, label: 'Transcript', action: 'Open transcript' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT, label: 'Presentation transcript', action: 'Open presentation transcript' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT, label: 'Staff discussion transcript', action: 'Open staff discussion transcript' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_SUMMARY, label: 'Staff discussion summary', action: 'Open staff discussion summary' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, label: 'Presentation summary', action: 'Open presentation summary' },
];

// Each summary's sections are fixed by its prompt; the first one is shown until "Read more".
// Text without those headings (an edited draft) is cut at a length instead.
const PRESENTATION_SUMMARY = { headings: PRESENTATION_SUMMARY_HEADINGS, listHeadings: PRESENTATION_SUMMARY_LIST_HEADINGS };
const DISCUSSION_SUMMARY = { headings: DISCUSSION_SUMMARY_HEADINGS, listHeadings: DISCUSSION_SUMMARY_LIST_HEADINGS };
const COLLAPSED_FALLBACK_CHARS = 700;

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
  const sections = parseSummaryText(text, format);
  const bySection = sections.length > 1;
  const byLength = !bySection && text.length > COLLAPSED_FALLBACK_CHARS;
  const canExpand = bySection || byLength;
  const collapsedText = byLength ? `${text.slice(0, COLLAPSED_FALLBACK_CHARS).trim()}…` : text;
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
            <SummaryText text={expanded ? text : collapsedText} {...format} headingLevel={5} size="compact"
              maxSections={canExpand && !expanded && bySection ? 1 : undefined} />
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
export default function ResearchPresentationFollowUp({ status, materials = [], summary = null, discussionSummary = null }) {
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
      {status === 'loaded' && present.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {present.map((slot) => (
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
