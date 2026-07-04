/**
 * Stage 2b / submitted view — proposal-materials list + in-browser review form.
 *
 * Reviewer authoring build (Phase 2): the file-upload card was replaced by the
 * in-browser ReviewAuthoringForm (rich-text questions + autosave). The upload
 * route/infra is retained server-side but no longer surfaced here (plan §7).
 * A submitted review is final and read-only — no re-upload/replace affordance.
 */

import { useEffect, useRef } from 'react';
import ReviewAuthoringForm from './ReviewAuthoringForm';

export default function MaterialsView({ data, token }) {
  const submitted = !!data.submission?.receivedAt;
  const headingRef = useRef(null);
  useEffect(() => {
    if (headingRef.current) headingRef.current.focus();
  }, []);
  return (
    <div className="space-y-6">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold text-gray-900 outline-none sr-only"
      >
        {submitted ? 'Review submitted' : 'Submit your review'}
      </h2>
      <ProposalCard data={data} />
      <FilesCard data={data} token={token} submitted={submitted} />
      {submitted ? <SubmittedNotice data={data} /> : <ReviewAuthoringForm data={data} token={token} />}
    </div>
  );
}

function ProposalCard({ data }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <p className="text-xs uppercase tracking-wide text-gray-500">Proposal</p>
      <h2 className="text-lg font-semibold text-gray-900 mt-1">{data.proposal.title}</h2>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-500">Reviewer</p>
          <p className="text-gray-900">{data.reviewer.name || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Submission deadline</p>
          <p className="text-gray-900">
            {data.tokenExpiresAt
              ? new Date(data.tokenExpiresAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}

function FilesCard({ data, token, submitted }) {
  if (!data.files || data.files.length === 0) {
    // After submission the "hasn't shared materials yet — contact us" prompt
    // is stale noise next to the Review-received notice; the reviewer no
    // longer needs materials. Files that DO exist stay downloadable below.
    if (submitted) return null;
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900">Proposal materials</h3>
        <p className="text-sm text-gray-600 mt-2">
          The Foundation hasn&apos;t shared materials for this review yet. Please contact us if you need them.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-gray-900">Proposal materials</h3>
      <ul className="mt-3 divide-y divide-gray-100">
        {data.files.map((f) => {
          const downloadUrl = `/api/external/review/${encodeURIComponent(token)}/proposal?fileId=${encodeURIComponent(f.id)}&library=${encodeURIComponent(f.library)}`;
          return (
            <li key={`${f.library}::${f.id}`} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 truncate">{f.name}</p>
                <p className="text-xs text-gray-500">{formatBytes(f.size)}</p>
              </div>
              <a
                href={downloadUrl}
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
              >
                Download
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SubmittedNotice({ data }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
      <p className="text-sm font-semibold text-green-900">Review received</p>
      <p className="text-sm text-green-800 mt-1">
        We received your review on{' '}
        {new Date(data.submission.receivedAt).toLocaleString(undefined, {
          dateStyle: 'long',
          timeStyle: 'short',
        })}
        {data.submission.filename ? ` (${data.submission.filename})` : ''}.
        Your review is final. If you need to make a change, please contact your Program Director.
      </p>
    </div>
  );
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
