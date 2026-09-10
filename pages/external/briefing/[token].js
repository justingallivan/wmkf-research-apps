/**
 * Deliberation briefing page (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md).
 *
 * Token-authed, not user-authed: the opaque token in the URL is verified by
 * /api/external/briefing/[token]/context on every load. Read-only. Every
 * document opens through /document?member=<bounded id>; the page never sees
 * a SharePoint URL. Reviewer names are shown by owner decision D13.
 */
import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

const REASON_MESSAGE = {
  no_token: 'This link is missing its access token.',
  malformed: 'This link is malformed.',
  invalid_signature: 'This link is invalid.',
  invalid_claim: 'This link is invalid.',
  expired: 'This link has expired. Please contact the Foundation for a current one.',
  revoked: 'This link was replaced. Please use the most recent email from the Foundation.',
  not_found: 'This briefing is not available.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  server_error: 'Something went wrong on our end. Please try again shortly.',
};

function formatDateTime(iso, timeZone) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return date.toLocaleString('en-US');
  }
}

function formatDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Render a meeting link only when it parses as an absolute https URL. */
function httpsOnly(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BriefingPage() {
  const router = useRouter();
  const { token } = router.query;
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/external/briefing/${encodeURIComponent(token)}/context`);
        const data = await res.json().catch(() => ({ ok: false, reason: 'server_error' }));
        if (cancelled) return;
        setState(data.ok ? { status: 'ok', data } : { status: 'error', reason: data.reason });
      } catch {
        if (!cancelled) setState({ status: 'error', reason: 'server_error' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const documentHref = (member) => `/api/external/briefing/${encodeURIComponent(token)}/document?member=${encodeURIComponent(member)}`;

  if (state.status === 'loading') {
    return <Shell title="Deliberation briefing"><p className="text-gray-600">Loading…</p></Shell>;
  }
  if (state.status === 'error') {
    return (
      <Shell title="Deliberation briefing">
        <p className="text-gray-800">{REASON_MESSAGE[state.reason] || 'This link cannot be opened.'}</p>
      </Shell>
    );
  }

  const { data } = state;
  const sessionLine = data.session?.scheduledStart
    ? formatDateTime(data.session.scheduledStart, data.session.timeZone)
    : null;
  const visitLine = data.siteVisit?.scheduledStart ? formatDate(data.siteVisit.scheduledStart) : null;
  const meetingLink = httpsOnly(data.session?.meetingLink);

  return (
    <Shell title={data.title}>
      {data.proposalTitle && <p className="mt-1 text-lg text-gray-700">{data.proposalTitle}</p>}

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Schedule</h2>
        <dl className="mt-2 space-y-1 text-sm text-gray-800">
          <div>
            <dt className="inline font-medium">Deliberation session:</dt>{' '}
            <dd className="inline">
              {sessionLine || 'Not yet scheduled'}
              {meetingLink && (
                <>
                  {' · '}
                  <a className="text-blue-800 underline" href={meetingLink} rel="noreferrer noopener">Join meeting</a>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Site visit:</dt>{' '}
            <dd className="inline">{visitLine || 'Not yet scheduled'}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Writeup</h2>
        {data.writeup?.docx || data.writeup?.pdf ? (
          <ul className="mt-2 space-y-1 text-sm">
            {data.writeup.pdf && (
              <li>
                <a className="text-blue-800 underline" href={documentHref(data.writeup.pdf.member)} target="_blank" rel="noreferrer noopener">
                  {data.writeup.pdf.filename}
                </a>
                {formatSize(data.writeup.pdf.size) && <span className="text-gray-500"> · {formatSize(data.writeup.pdf.size)}</span>}
              </li>
            )}
            {data.writeup.docx && (
              <li>
                <a className="text-blue-800 underline" href={documentHref(data.writeup.docx.member)}>
                  {data.writeup.docx.filename}
                </a>
                {formatSize(data.writeup.docx.size) && <span className="text-gray-500"> · {formatSize(data.writeup.docx.size)}</span>}
              </li>
            )}
            {data.writeup.sharedAt && <li className="text-xs text-gray-500">Shared {formatDate(data.writeup.sharedAt)}. Later staff edits are not reflected here.</li>}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-600">The writeup will appear here once staff share it.</p>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Proposal</h2>
        {data.proposal ? (
          <p className="mt-2 text-sm">
            <a className="text-blue-800 underline" href={documentHref(data.proposal.member)} target="_blank" rel="noreferrer noopener">
              {data.proposal.filename}
            </a>
            {formatSize(data.proposal.size) && <span className="text-gray-500"> · {formatSize(data.proposal.size)}</span>}
          </p>
        ) : (
          <p className="mt-2 text-sm text-gray-600">The proposal is not available for this request.</p>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Site visit materials</h2>
        {data.materials?.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {data.materials.map((material) => (
              <li key={material.member}>
                <span className="font-medium text-gray-800">{material.label}:</span>{' '}
                {material.available ? (
                  <a className="text-blue-800 underline" href={documentHref(material.member)} target="_blank" rel="noreferrer noopener">
                    {material.filename}
                  </a>
                ) : (
                  <span className="text-gray-700">{material.filename} <span className="text-gray-500">(too large to open here; ask staff for a copy)</span></span>
                )}
                {formatSize(material.size) && <span className="text-gray-500"> · {formatSize(material.size)}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-600">No site visit materials yet. Slides, recordings, and transcripts appear here as staff add them.</p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-gray-900">
          Reviews{data.reviews?.length ? ` (${data.reviews.length})` : ''}
        </h2>
        {!data.reviews?.length && (
          <p className="mt-2 text-sm text-gray-600">No completed reviews yet. New reviews appear here as they arrive.</p>
        )}
        {data.reviews?.map((review) => (
          <article key={review.id} className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="font-semibold text-gray-900">{review.reviewerName}</h3>
                {review.affiliation && <p className="text-sm text-gray-600">{review.affiliation}</p>}
              </div>
              <div className="text-right text-xs text-gray-500">
                {review.receivedAt && <p>Received {formatDate(review.receivedAt)}</p>}
                {review.file && (
                  <a className="text-blue-800 underline" href={documentHref(review.file.member)} target="_blank" rel="noreferrer noopener">
                    Open uploaded review
                  </a>
                )}
              </div>
            </header>
            {review.answers?.length > 0 ? (
              <dl className="mt-4 space-y-4">
                {review.answers.map((answer, index) => (
                  <div key={`${review.id}-${index}`}>
                    <dt className="text-sm font-medium text-gray-800">{answer.questionText}</dt>
                    {answer.answerHtml ? (
                      // Sanitized server-side on read (lib/external/sanitize-review-html.js via the answer adapter).
                      <dd className="prose prose-sm mt-1 max-w-none text-gray-800" dangerouslySetInnerHTML={{ __html: answer.answerHtml }} />
                    ) : (
                      <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{answer.answerText || '—'}</dd>
                    )}
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-gray-600">
                {review.file ? 'This review was uploaded as a file.' : 'No structured answers were recorded for this review.'}
              </p>
            )}
          </article>
        ))}
      </section>

      {data.expiresAt && (
        <p className="mt-8 text-xs text-gray-500">This page is available until {formatDate(data.expiresAt)}. Please do not forward the link.</p>
      )}
    </Shell>
  );
}

function Shell({ title, children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Head><title>{title ? `${title} — Deliberation briefing` : 'Deliberation briefing'}</title></Head>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">W. M. Keck Foundation · Deliberation briefing</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">{title || 'Deliberation briefing'}</h1>
        {children}
      </main>
    </div>
  );
}
