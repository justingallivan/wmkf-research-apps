/**
 * Research Presentation Materials — read-only card on the Staff
 * Deliberations tab (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16.13).
 *
 * Status comes from data the tab already holds: the Site Visit read
 * (useSiteVisitContext) and the portal collection summary on the Pre-Site
 * status payload. File links come from a direct listing of the request's
 * `Site Visit - Slides` / `Site Visit - Participant Bios` SharePoint folders
 * (GET /api/workbench/site-visit/material-files) — INTERIM, so files placed
 * there by hand in AkoyaGo show while the upload portal is still in testing.
 * Links open SharePoint directly; staff are signed in to Microsoft 365.
 */

import { useEffect, useState } from 'react';
import { Card } from '../Layout';
import { requestJson } from '../../utils/api-request';

const ROWS = [
  { key: 'slides', label: 'Slides' },
  { key: 'participantBios', label: 'Participant bios' },
];

/** The one-line status, or null while the Site Visit read is in flight. */
export function presentationMaterialsStatus(siteVisitContext, summary) {
  if (!siteVisitContext) return null;
  if (siteVisitContext.unavailable) return { tone: 'error', text: 'The presentation schedule could not be loaded.' };
  if (!siteVisitContext.siteVisit) return { tone: 'muted', text: 'Presentation not scheduled.' };
  if (!summary) return { tone: 'body', text: 'Presentation scheduled · materials not requested.' };
  if (summary.state === 'ready') return { tone: 'body', text: 'Presentation scheduled · materials ready.' };
  if (summary.state === 'closed') return { tone: 'body', text: 'Presentation scheduled · materials request closed.' };
  return { tone: 'body', text: 'Presentation scheduled · materials requested.' };
}

const TONE_CLASS = {
  error: 'text-red-800',
  muted: 'text-gray-600',
  body: 'text-gray-800',
};

function FileLinks({ files }) {
  if (!files.length) return <span className="text-gray-500">Not received yet</span>;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {files.map((file) => (
        <li key={file.webUrl} className="min-w-0 max-w-full">
          <a
            href={file.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={file.name}
            className="block truncate font-medium text-green-800 underline underline-offset-2 hover:text-green-900"
          >
            {file.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function ResearchPresentationMaterialsCard({ requestId, siteVisitContext, materialsSummary }) {
  // Results are keyed by request so a request change reads as loading
  // without a synchronous reset inside the effect.
  const [result, setResult] = useState(null);
  const files = result?.requestId === requestId ? result : { state: 'loading' };

  useEffect(() => {
    if (!requestId) return undefined;
    const controller = new AbortController();
    requestJson(`/api/workbench/site-visit/material-files?requestId=${encodeURIComponent(requestId)}`, {
      signal: controller.signal,
      tolerantBody: true,
    }).then((body) => {
      if (!controller.signal.aborted) setResult({ ...body, requestId, state: 'loaded' });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ requestId, state: 'error' });
    });
    return () => controller.abort();
  }, [requestId]);

  const status = presentationMaterialsStatus(siteVisitContext, materialsSummary);

  let body;
  if (files.state === 'loading') {
    body = <p className="mt-3 text-sm text-gray-600">Checking SharePoint for materials…</p>;
  } else if (files.state === 'error') {
    body = <p className="mt-3 text-sm text-red-800" role="alert">The SharePoint materials folders could not be read. Reload the page to try again.</p>;
  } else if (!files.folderFound) {
    body = <p className="mt-3 text-sm text-gray-600">This request has no SharePoint folder yet.</p>;
  } else {
    body = (
      <dl className="mt-3 divide-y divide-gray-100 border-y border-gray-100 text-sm">
        {ROWS.map((row) => (
          <div key={row.key} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-6">
            <dt className="shrink-0 font-medium text-gray-700 sm:w-36">{row.label}</dt>
            <dd className="min-w-0 flex-1">
              <FileLinks files={files[row.key] || []} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <Card hover={false}>
      <section aria-labelledby="research-presentation-materials-title" data-testid="research-presentation-materials">
        <h3 id="research-presentation-materials-title" className="text-base font-semibold text-gray-900">
          Research Presentation Materials
        </h3>
        <p className={`mt-1 text-sm ${status ? TONE_CLASS[status.tone] : 'text-gray-600'}`} aria-live="polite">
          {status ? status.text : 'Checking the presentation schedule…'}
        </p>
        {body}
      </section>
    </Card>
  );
}
