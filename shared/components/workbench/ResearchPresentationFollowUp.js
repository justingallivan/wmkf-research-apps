import { useState } from 'react';
import { Card } from '../Layout';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../config/requestDocument';

const SLOTS = [
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING, label: 'Recording', action: 'Watch recording' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, label: 'Transcript', action: 'Open transcript' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT, label: 'Presentation transcript', action: 'Open presentation transcript' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT, label: 'Staff discussion transcript', action: 'Open staff discussion transcript' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, label: 'Presentation summary', action: 'Open presentation summary' },
];

// The summary's sections are fixed by its prompt; the first one is shown until "Read more".
const SECOND_SECTION = /\n\s*Questions and answers\s*\n/;
const COLLAPSED_FALLBACK_CHARS = 700;

function firstSection(text) {
  const match = SECOND_SECTION.exec(text);
  if (match) return text.slice(0, match.index).trim();
  return text.length > COLLAPSED_FALLBACK_CHARS ? `${text.slice(0, COLLAPSED_FALLBACK_CHARS).trim()}…` : text;
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
}

function SummaryText({ summary }) {
  const [expanded, setExpanded] = useState(false);
  const published = formatDate(summary.publishedAt);
  const collapsed = summary.text ? firstSection(summary.text) : null;
  const canExpand = Boolean(summary.text) && collapsed !== summary.text;
  return (
    <div className="mt-2" data-testid="presentation-summary-text">
      <p className="text-xs text-gray-500">
        {published ? `Published ${published}` : 'Published'}
        {summary.stale ? ' · from an earlier transcript version; the Board link no longer shows it' : ''}
      </p>
      {summary.text && (
        <>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-900">{expanded ? summary.text : collapsed}</p>
          {canExpand && (
            <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}
              className="mt-1 text-sm font-semibold text-blue-800 underline">
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function ResearchPresentationFollowUp({ status, materials = [], summary = null }) {
  if (status === 'disabled') return null;
  const byType = new Map(materials.map((material) => [Number(material.artifactType), material]));
  return (
    <Card hover={false}>
      <div data-testid="research-presentation-follow-up">
        <h3 className="text-base font-semibold text-gray-900">Research presentation follow-up</h3>
        {status === 'loading' && <p className="mt-2 text-sm text-gray-600">Loading presentation materials…</p>}
        {status === 'unavailable' && (
          <p className="mt-2 text-sm text-red-800" role="alert">Presentation materials could not be loaded.</p>
        )}
        {status === 'loaded' && (
          <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {SLOTS.map((slot) => {
              const material = byType.get(slot.type);
              const href = material?.backing === 'external' ? material.externalUrl : material?.webUrl;
              const inlineSummary = slot.type === REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY && material && summary;
              return (
                <li key={slot.type} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">{slot.label}</p>
                      <p className="text-xs text-gray-500">{material?.filename || 'Not added yet'}</p>
                    </div>
                    {href && (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-800 underline">
                        {slot.action}
                      </a>
                    )}
                  </div>
                  {inlineSummary && <SummaryText summary={summary} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
