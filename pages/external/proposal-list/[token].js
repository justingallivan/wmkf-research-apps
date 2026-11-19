/**
 * Proposal list page (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * Token-authed, not user-authed: the token in the URL is verified by
 * /api/external/proposal-list/[token]/context on every load. Read-only.
 * Proposals the Foundation highlighted for this person are listed first and
 * open; every other proposal sits in a section that starts collapsed. A title
 * opens that proposal through /document?request=<number>; the page never sees
 * a SharePoint URL.
 */
import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { requestEnvelope } from '../../../shared/utils/api-request';

const PAGE_TITLE = 'Submitted proposals';

const REASON_MESSAGE = {
  no_token: 'This link is missing its access token.',
  malformed: 'This link is malformed.',
  invalid_signature: 'This link is invalid.',
  invalid_claim: 'This link is invalid.',
  expired: 'This link has expired. Please contact the Foundation for a current one.',
  revoked: 'This link is no longer active. Please contact the Foundation for a current one.',
  not_found: 'This proposal list is not available.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  server_error: 'Something went wrong on our end. Please try again shortly.',
};

function formatDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
}

function countLabel(count) {
  return `${count} proposal${count === 1 ? '' : 's'}`;
}

function ProposalRows({ proposals, hrefFor }) {
  return (
    <ul className="divide-y divide-gray-100">
      {proposals.map((proposal) => (
        <li key={proposal.requestNumber} className="py-3">
          <a
            className="font-medium text-blue-800 underline underline-offset-2"
            href={hrefFor(proposal.requestNumber)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {proposal.title}
          </a>
          <p className="mt-0.5 text-sm text-gray-600">
            {[proposal.institution, proposal.projectLeader].filter(Boolean).join(' · ') || 'Institution and PI not recorded'}
          </p>
          {proposal.ownInstitution && (
            <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
              From your institution
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A section's proposals under its discipline groups; flat when it has none. */
function SectionGroups({ section, hrefFor }) {
  const groups = section.groups || [];
  if (!groups.some((group) => group.name)) {
    return <ProposalRows proposals={section.proposals} hrefFor={hrefFor} />;
  }
  return groups.map((group) => (
    <div key={group.name || 'other'} className="pt-3">
      <h3 className="text-sm font-semibold text-gray-700">
        {group.name || 'Other'}{' '}
        <span className="font-normal text-gray-500">({countLabel(group.proposals.length)})</span>
      </h3>
      <ProposalRows proposals={group.proposals} hrefFor={hrefFor} />
    </div>
  ));
}

export default function ProposalListPage() {
  const router = useRouter();
  const { token } = router.query;
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const envelope = await requestEnvelope(`/api/external/proposal-list/${encodeURIComponent(token)}/context`, {
          tolerantBody: () => ({ ok: false, reason: 'server_error' }),
        });
        const data = envelope.error?.parseError ? { ok: false, reason: 'server_error' } : envelope.data;
        if (cancelled) return;
        setState(data?.ok ? { status: 'ok', data } : { status: 'error', reason: data?.reason });
      } catch {
        if (!cancelled) setState({ status: 'error', reason: 'server_error' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (state.status === 'loading') {
    return <Shell><p className="mt-4 text-gray-600">Loading…</p></Shell>;
  }
  if (state.status === 'error') {
    return <Shell><p className="mt-4 text-gray-800">{REASON_MESSAGE[state.reason] || 'This link cannot be opened.'}</p></Shell>;
  }

  const { data } = state;
  const hrefFor = (requestNumber) =>
    `/api/external/proposal-list/${encodeURIComponent(token)}/document?request=${encodeURIComponent(requestNumber)}`;
  const until = formatDate(data.expiresAt);

  return (
    <Shell>
      <p className="mt-2 text-sm text-gray-600">
        Prepared for {data.recipientName} · {data.cycleCode} · {countLabel(data.total)}
        {until ? ` · Link active through ${until}` : ''}
      </p>
      <p className="mt-1 text-sm text-gray-600">Select a title to open the proposal.</p>

      {data.highlighted.length > 0 && (
        <section className="mt-6 rounded-xl border border-blue-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">
            We would value your view on these{' '}
            <span className="font-normal text-gray-500">({countLabel(data.highlighted.length)})</span>
          </h2>
          <div className="mt-2">
            <ProposalRows proposals={data.highlighted} hrefFor={hrefFor} />
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          {data.highlighted.length > 0 ? 'All other proposals' : 'All proposals'}
        </h2>
        <div className="mt-2 space-y-2">
          {data.sections.map((section) => (
            <details key={section.name} className="rounded-xl border border-gray-200 bg-white">
              <summary className="cursor-pointer px-5 py-3 text-base font-medium text-gray-900">
                {section.name}{' '}
                <span className="font-normal text-gray-500">({countLabel(section.proposals.length)})</span>
              </summary>
              <div className="border-t border-gray-100 px-5">
                <SectionGroups section={section} hrefFor={hrefFor} />
              </div>
            </details>
          ))}
          {data.sections.length === 0 && data.highlighted.length === 0 && (
            <p className="text-sm text-gray-600">No proposals are listed yet.</p>
          )}
        </div>
      </section>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>{PAGE_TITLE}</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">W. M. Keck Foundation · Research proposals</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">{PAGE_TITLE}</h1>
        {children}
      </main>
    </div>
  );
}
