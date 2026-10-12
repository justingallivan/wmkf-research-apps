/**
 * Staff reading page: one transcript or summary shown formatted, opened in a new tab from the
 * Workbench and the Site Visit card (docs/plans/STAFF_READER_AND_VIDEO_PLAN_2026-10-11.md §3).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import Layout from '../../shared/components/Layout';
import RequireAppAccess from '../../shared/components/RequireAppAccess';
import { useAppAccess } from '../../shared/context/AppAccessContext';
import SummaryText from '../../shared/components/SummaryText';
import TranscriptText from '../../shared/components/TranscriptText';
import { requestEnvelope } from '../../shared/utils/api-request';
import { isGuid } from '../../lib/utils/guid';
import {
  DISCUSSION_SUMMARY_HEADINGS,
  DISCUSSION_SUMMARY_LIST_HEADINGS,
  PRESENTATION_SUMMARY_HEADINGS,
  PRESENTATION_SUMMARY_LIST_HEADINGS,
} from '../../shared/config/transcriptSummary';

const SUMMARY_FORMAT = {
  presentation: { headings: PRESENTATION_SUMMARY_HEADINGS, listHeadings: PRESENTATION_SUMMARY_LIST_HEADINGS },
  discussion: { headings: DISCUSSION_SUMMARY_HEADINGS, listHeadings: DISCUSSION_SUMMARY_LIST_HEADINGS },
};

// Plain wording for each refusal; every one still offers the SharePoint file when it is known.
const PROBLEM = {
  unsupported_format: 'This file is not a plain-text transcript, so it can only be opened in SharePoint.',
  too_large: 'This file is too large to show here.',
  integrity_failed: 'The file in SharePoint no longer matches the published version, so it is not shown.',
  not_found: 'This item is no longer published for this request.',
  invalid_request: 'This link is incomplete.',
};

function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
}

function single(value) {
  return typeof value === 'string' ? value : '';
}

function SharePointLink({ href }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2">
      Open in SharePoint
      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
    </a>
  );
}

function Skeleton() {
  return (
    <div className="mt-8 space-y-4" aria-hidden="true">
      {[92, 78, 85, 64, 88, 70].map((width, index) => (
        <div key={index} className="h-4 animate-pulse rounded bg-gray-200" style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

// `Shell` is the page frame; tests and local previews may pass a plain one.
export function Reader({ Shell = Layout }) {
  const router = useRouter();
  const { hasAccess } = useAppAccess();
  const requestId = single(router.query.request);
  const documentId = single(router.query.document);
  const [state, setState] = useState({ status: 'loading', body: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!router.isReady || !isGuid(requestId) || !isGuid(documentId)) return undefined;
    const controller = new AbortController();
    // A new document or a Retry starts from the loading state before its fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: 'loading', body: null });
    const params = new URLSearchParams({ requestId, documentId });
    requestEnvelope(`/api/workbench/site-visit/presentation-text?${params}`, { signal: controller.signal, tolerantBody: true })
      .then((envelope) => {
        if (controller.signal.aborted) return;
        setState(envelope.ok
          ? { status: 'ready', body: envelope.data }
          : { status: 'error', body: envelope.data || {}, httpStatus: envelope.status });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error', body: {}, httpStatus: 0 });
      });
    return () => controller.abort();
  }, [router.isReady, requestId, documentId, attempt]);

  // A malformed link never calls the route.
  const invalidLink = router.isReady && (!isGuid(requestId) || !isGuid(documentId));
  const view = invalidLink ? { status: 'error', body: { reason: 'invalid_request' } } : state;
  const body = view.body || {};
  const request = body.request || null;
  const item = body.item || {};
  const sharePoint = body.links?.sharePoint || null;
  const label = item.label || (view.status === 'loading' ? 'Loading…' : 'Document');
  const published = formatDate(item.publishedAt);
  const identity = request?.number ? `Request ${request.number}` : 'Request';
  const problem = PROBLEM[body.reason] || 'This item could not be loaded.';
  const retryable = view.status === 'error' && !PROBLEM[body.reason];

  return (
    <Shell title={request?.number ? `${label} · ${identity}` : label} maxWidth="4xl">
      <article className="pb-16">
        <header>
          {/* The identity line links back to the Workbench only for people who can open it. */}
          {isGuid(requestId) && hasAccess('reviewers') ? (
            <Link href={`/workbench/${requestId}?tab=staff-deliberations`}
              className="text-sm text-gray-500 underline-offset-4 hover:text-gray-800 hover:underline">
              {identity}{request?.title ? ` · ${request.title}` : ''}
            </Link>
          ) : (
            <p className="text-sm text-gray-500">{identity}</p>
          )}
          <div className="mt-2 flex items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold text-gray-900 text-balance">{label}</h1>
            <SharePointLink href={sharePoint} />
          </div>
          {view.status === 'ready' && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
              {published && <span>Published {published}</span>}
              {item.kind === 'summary' && (
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">AI-generated</span>
              )}
              {item.summaryKind === 'discussion' && <span>Staff only. Never included on the Board page.</span>}
              {item.stale && <span className="text-amber-700">Made from an earlier transcript version.</span>}
            </p>
          )}
        </header>

        {view.status === 'loading' && <Skeleton />}

        {view.status === 'error' && (
          <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5" role="alert">
            <p className="text-base text-gray-800">{problem}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {retryable && (
                <button type="button" onClick={retry}
                  className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2">
                  Retry
                </button>
              )}
              <SharePointLink href={sharePoint} />
            </div>
          </div>
        )}

        {view.status === 'ready' && (
          <div className="mt-10 max-w-[70ch]">
            {item.kind === 'summary'
              ? <SummaryText text={body.text} {...(SUMMARY_FORMAT[item.summaryKind] || {})} headingLevel={2} />
              : <TranscriptText text={body.text} />}
          </div>
        )}
      </article>
    </Shell>
  );
}

export default function ReadPage() {
  return (
    <RequireAppAccess appKey={['reviewers', 'meeting-tracker']}>
      <Reader />
    </RequireAppAccess>
  );
}
