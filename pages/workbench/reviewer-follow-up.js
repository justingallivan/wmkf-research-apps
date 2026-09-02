/**
 * Consolidated reviewer follow-up — cycle-wide tracking for staff.
 *
 * Read contract: combines the existing Workbench assignment feed with the
 * existing Review Manager aggregate DTO. Write controls are the unchanged
 * ReviewerManagePanel operations; this page introduces no new persistence or
 * API seam. Preview deployments pointed at production Dataverse are visibly
 * read-only, matching the target interlock rather than letting controls fail.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Layout, { Card, PageHeader } from '../../shared/components/Layout';
import RequireAppAccess from '../../shared/components/RequireAppAccess';
import ReviewerManagePanel from '../../shared/components/reviewers/ReviewerManagePanel';
import CampaignConfigModal from '../../shared/components/reviewers/CampaignConfigModal';
import EmailTemplatesModal from '../../shared/components/reviewers/EmailTemplatesModal';
import WorkbenchViewsNav from '../../shared/components/workbench/WorkbenchViewsNav';
import {
  filterReviewerFollowUpProposals,
  isOpenReviewer,
  isReviewerOverdue,
  mergeReviewerFollowUpProposals,
  proposalNeedsAttention,
  summarizeReviewerFollowUp,
} from '../../shared/utils/reviewer-follow-up';
import { classifyTarget } from '../../lib/dataverse/core/interlock';

function ReviewerGroup({ proposal, previewReadOnly, onRefresh }) {
  const [open, setOpen] = useState(() => proposalNeedsAttention(proposal));
  const [campaignOpen, setCampaignOpen] = useState(false);
  const reviewers = proposal.reviewers || [];
  const activeCount = reviewers.filter(isOpenReviewer).length;
  const overdueCount = reviewers.filter((reviewer) => isReviewerOverdue(reviewer)).length;
  const receivedCount = reviewers.filter((reviewer) => (
    reviewer.reviewReceivedAt
    || reviewer.submitted
    || ['review_received', 'complete'].includes(reviewer.reviewStatus)
  )).length;
  const canManage = !previewReadOnly && proposal.workbench?.canManage !== false;
  const requestHref = `/workbench/${encodeURIComponent(proposal.proposalId)}?tab=reviewers&sub=track${
    proposal.requestNumber ? `&n=${encodeURIComponent(proposal.requestNumber)}` : ''
  }`;

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <header className="border-b border-gray-200 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Link
                href={requestHref}
                className="font-semibold tabular-nums text-gray-900 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
              >
                #{proposal.requestNumber || '—'}
              </Link>
              <h2 className="min-w-0 text-base font-semibold text-gray-900 sm:text-lg">
                {proposal.proposalTitle || 'Untitled request'}
              </h2>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {[proposal.proposalInstitution, proposal.proposalAuthors && `PI: ${proposal.proposalAuthors}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="mt-2 text-xs tabular-nums text-gray-500">
              {reviewers.length === 0
                ? 'No reviewers are in the tracking stage.'
                : `${activeCount} active · ${receivedCount} received${overdueCount ? ` · ${overdueCount} overdue` : ''}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 2xl:justify-end">
            <Link
              href={requestHref}
              className="inline-flex min-h-10 items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
            >
              Open full reviewer panel
            </Link>
            {canManage && (
              <button
                type="button"
                onClick={() => setCampaignOpen(true)}
                className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
              >
                Campaign settings
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="min-h-10 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
            >
              {open ? 'Collapse' : 'Show reviewers'}
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="p-4 sm:p-5">
          {reviewers.length === 0 ? (
            <p className="py-4 text-sm text-gray-500">
              There are no accepted reviewers to track yet. Open the full reviewer panel to find or invite reviewers.
            </p>
          ) : (
            <ReviewerManagePanel
              proposal={proposal}
              reviewers={reviewers}
              onRefresh={onRefresh}
              settings={{ reviewDueDate: proposal.reviewDeadline }}
              mode="track"
              canManage={canManage}
              showReviewReminderAction={canManage || previewReadOnly}
              previewReadOnly={previewReadOnly}
            />
          )}
        </div>
      )}

      {campaignOpen && canManage && (
        <CampaignConfigModal
          requestId={proposal.proposalId}
          onClose={() => setCampaignOpen(false)}
          onSaved={onRefresh}
        />
      )}
    </article>
  );
}

export function ReviewerFollowUpDashboard({ previewReadOnly = false }) {
  const [cycles, setCycles] = useState([]);
  const [cycleCode, setCycleCode] = useState('');
  const [proposals, setProposals] = useState([]);
  const [scope, setScope] = useState('my');
  const [view, setView] = useState('attention');
  const [search, setSearch] = useState('');
  const [includeSetAside, setIncludeSetAside] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [loadingCycles, setLoadingCycles] = useState(true);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch('/api/workbench/dashboard');
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Failed to load cycles (${response.status})`);
        if (!active) return;
        const availableCycles = body.cycles || [];
        const requestedCycle = new URLSearchParams(window.location.search)
          .get('cycleCode')?.trim().toUpperCase();
        setCycles(availableCycles);
        setCycleCode(
          availableCycles.some((cycle) => cycle.code === requestedCycle)
            ? requestedCycle
            : body.defaultCycleCode || availableCycles[0]?.code || '',
        );
      } catch (loadError) {
        if (active) setError(loadError.message);
      } finally {
        if (active) setLoadingCycles(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const loadProposals = useCallback(async (selectedCycle, selectedScope) => {
    if (!selectedCycle) return;
    const requestId = ++requestIdRef.current;
    const requestScope = selectedScope === 'all' ? 'all' : 'my';
    setLoadingProposals(true);
    setError(null);
    try {
      const [dashboardResponse, reviewerResponse] = await Promise.all([
        fetch(`/api/workbench/dashboard?cycleCode=${encodeURIComponent(selectedCycle)}&scope=${requestScope}&includeSetAside=1`),
        fetch(`/api/review-manager/reviewers?cycleCode=${encodeURIComponent(selectedCycle)}&scope=${requestScope}`),
      ]);
      const [dashboardBody, reviewerBody] = await Promise.all([
        dashboardResponse.json().catch(() => ({})),
        reviewerResponse.json().catch(() => ({})),
      ]);
      if (requestIdRef.current !== requestId) return;
      if (!dashboardResponse.ok) {
        throw new Error(dashboardBody.error || `Failed to load assigned requests (${dashboardResponse.status})`);
      }
      if (!reviewerResponse.ok) {
        throw new Error(reviewerBody.error || `Failed to load reviewer tracking (${reviewerResponse.status})`);
      }
      setProposals(mergeReviewerFollowUpProposals(
        dashboardBody.proposals || [],
        reviewerBody.proposals || [],
      ));
    } catch (loadError) {
      if (requestIdRef.current !== requestId) return;
      setError(loadError.message);
      setProposals([]);
    } finally {
      if (requestIdRef.current === requestId) setLoadingProposals(false);
    }
  }, []);

  useEffect(() => {
    if (!cycleCode) return undefined;
    const timer = window.setTimeout(() => { void loadProposals(cycleCode, scope); }, 0);
    return () => window.clearTimeout(timer);
  }, [cycleCode, loadProposals, scope]);

  useEffect(() => () => { requestIdRef.current += 1; }, []);

  const visibleProposals = useMemo(() => filterReviewerFollowUpProposals(proposals, {
    view,
    search,
    includeSetAside,
  }), [includeSetAside, proposals, search, view]);
  const summary = useMemo(() => summarizeReviewerFollowUp(
    proposals.filter((proposal) => includeSetAside || !proposal.workbench?.setAside),
  ), [includeSetAside, proposals]);

  return (
    <Layout title="Reviewer follow-up">
      <PageHeader
        title="Reviewer follow-up"
        subtitle="Monitor reviewer progress across a grant cycle and follow up without opening each proposal first."
      />
      <WorkbenchViewsNav
        activeKey="reviewer-follow-up"
        cycleCode={cycleCode}
        counts={{ 'reviewer-follow-up': summary.attentionRequests }}
      />

      {previewReadOnly && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" role="status">
          <span className="font-semibold">Preview is read-only.</span>{' '}
          This Preview is not connected to the reviewer sandbox. Follow-up controls are shown below but remain disabled here.
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 border-y border-gray-200 py-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-start gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            <span>Cycle</span>
            <select
              value={cycleCode}
              onChange={(event) => setCycleCode(event.target.value)}
              disabled={loadingCycles || cycles.length === 0}
              className="block min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50"
            >
              {cycles.map((cycle) => (
                <option key={cycle.code} value={cycle.code}>
                  {cycle.label || cycle.code}{cycle.count ? ` (${cycle.count})` : ''}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-gray-700">Requests</legend>
            <div className="inline-flex min-h-11 overflow-hidden rounded-lg border border-gray-300 bg-white">
              <button
                type="button"
                onClick={() => setScope('my')}
                aria-pressed={scope === 'my'}
                className={`px-4 py-2 text-sm font-semibold ${scope === 'my' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                My requests
              </button>
              <button
                type="button"
                onClick={() => setScope('all')}
                aria-pressed={scope === 'all'}
                className={`border-l border-gray-300 px-4 py-2 text-sm font-semibold ${scope === 'all' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                All requests
              </button>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-gray-700">Reviewers</legend>
            <div className="inline-flex min-h-11 overflow-hidden rounded-lg border border-gray-300 bg-white">
              <button
                type="button"
                onClick={() => setView('attention')}
                aria-pressed={view === 'attention'}
                className={`px-4 py-2 text-sm font-semibold ${view === 'attention' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                Needs attention ({summary.attentionRequests})
              </button>
              <button
                type="button"
                onClick={() => setView('all')}
                aria-pressed={view === 'all'}
                className={`border-l border-gray-300 px-4 py-2 text-sm font-semibold ${view === 'all' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                All reviewers
              </button>
            </div>
          </fieldset>

          <label className="flex min-h-11 self-end items-center gap-2 pb-0.5 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={includeSetAside}
              onChange={(event) => setIncludeSetAside(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Show set aside
          </label>
        </div>

        {!previewReadOnly && (
          <button
            type="button"
            onClick={() => setTemplatesOpen(true)}
            className="min-h-11 self-start rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 lg:self-auto"
          >
            Email templates
          </button>
        )}
      </div>

      <dl className="mb-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
        {[
          [scope === 'all' ? 'Cycle requests' : 'Assigned requests', summary.assignedRequests],
          ['Active reviewers', summary.activeReviewers],
          ['Overdue', summary.overdueReviewers],
          ['Reviews received', summary.reviewsReceived],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-2">
            <dt className="text-gray-500">{label}</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-5">
        <label htmlFor="reviewer-follow-up-search" className="sr-only">Search requests and reviewers</label>
        <input
          id="reviewer-follow-up-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search requests, institutions, PIs, or reviewers"
          className="min-h-12 w-full max-w-2xl rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 shadow-sm placeholder:text-gray-500 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/30"
        />
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
          <p className="font-semibold">Reviewer follow-up could not be loaded</p>
          <p className="mt-1">{error}</p>
          {cycleCode && (
            <button
              type="button"
              onClick={() => void loadProposals(cycleCode, scope)}
              className="mt-3 min-h-10 rounded-lg bg-gray-900 px-3 py-2 font-semibold text-white hover:bg-gray-800"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {loadingCycles || loadingProposals ? (
        <Card hover={false}><p className="text-sm text-gray-500">Loading reviewer activity…</p></Card>
      ) : !error && visibleProposals.length === 0 ? (
        <Card hover={false}>
          <p className="font-medium text-gray-900">
            {view === 'attention'
              ? 'No reviewer follow-up needs attention.'
              : `No ${scope === 'all' ? 'cycle' : 'assigned'} requests match this view.`}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {view === 'attention'
              ? 'Switch to All reviewers to see completed reviews and proposals without active reviewer engagements.'
              : 'Change the cycle, search, or set-aside filter.'}
          </p>
        </Card>
      ) : !error ? (
        <div className="space-y-4">
          {visibleProposals.map((proposal) => (
            <ReviewerGroup
              key={proposal.proposalId}
              proposal={proposal}
              previewReadOnly={previewReadOnly}
              onRefresh={() => loadProposals(cycleCode, scope)}
            />
          ))}
        </div>
      ) : null}

      {templatesOpen && !previewReadOnly && (
        <EmailTemplatesModal onClose={() => setTemplatesOpen(false)} />
      )}
    </Layout>
  );
}

export async function getServerSideProps() {
  const previewReadOnly = process.env.VERCEL_ENV === 'preview'
    && classifyTarget(process.env.DYNAMICS_URL) !== 'sandbox';
  return { props: { previewReadOnly } };
}

export default function ReviewerFollowUpGuard(props) {
  return (
    <RequireAppAccess appKey="reviewers">
      <ReviewerFollowUpDashboard {...props} />
    </RequireAppAccess>
  );
}
