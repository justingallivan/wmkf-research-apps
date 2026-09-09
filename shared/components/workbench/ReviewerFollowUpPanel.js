/**
 * Reviewer follow-up panel — cycle-wide reviewer tracking for staff, mounted
 * inside the Request Workbench shell.
 *
 * Read contract: combines the existing Workbench assignment feed with the
 * existing Review Manager aggregate DTO. Write controls are the unchanged
 * ReviewerManagePanel operations; this panel introduces no new persistence or
 * API seam. Preview deployments pointed at production Dataverse are visibly
 * read-only (lib/services/workbench/preview-read-only.js).
 *
 * The shell owns program, cycle, and request scope (my/all); this panel owns
 * the reviewer-state view (attention/all) and the search box, both mirrored
 * into the URL through the shell so back navigation restores them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Card } from '../Layout';
import { TOOLBAR_CONTROL_HEIGHT_CLASS } from '../ToolbarSelect';
import ReviewerManagePanel from '../reviewers/ReviewerManagePanel';
import EmailTemplatesModal from '../reviewers/EmailTemplatesModal';
import ScopeSegment from './ScopeSegment';
import ViewFilterInput from './ViewFilterInput';
import {
  filterReviewerFollowUpProposals,
  isOpenReviewer,
  isReviewerOverdue,
  mergeReviewerFollowUpProposals,
  summarizeReviewerFollowUp,
} from '../../utils/reviewer-follow-up';
import { useUrlMirroredInput } from './useUrlMirroredInput';

function ReviewerGroup({ proposal, previewReadOnly, onRefresh, degraded, loading }) {
  const [open, setOpen] = useState(false);
  const reviewers = proposal.reviewers || [];
  const activeCount = reviewers.filter(isOpenReviewer).length;
  const overdueCount = reviewers.filter((reviewer) => isReviewerOverdue(reviewer)).length;
  const receivedCount = reviewers.filter((reviewer) => (
    reviewer.reviewReceivedAt
    || reviewer.submitted
    || ['review_received', 'complete'].includes(reviewer.reviewStatus)
  )).length;
  const waitingCount = Math.max(reviewers.length - receivedCount - overdueCount, 0);
  const canManage = !previewReadOnly && proposal.workbench?.canManage === true;
  const requestHref = `/workbench/${encodeURIComponent(proposal.proposalId)}?tab=reviewers&sub=track${
    proposal.requestNumber ? `&n=${encodeURIComponent(proposal.requestNumber)}` : ''
  }`;

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <header className="px-4 py-3.5 sm:px-5 sm:py-4">
        <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start lg:justify-between">
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
              {[
                proposal.proposalInstitution,
                proposal.proposalAuthors && `PI: ${proposal.proposalAuthors}`,
                proposal.workbench?.programDirector && `PD: ${proposal.workbench.programDirector}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {reviewers.length === 0 ? (
              <p className="mt-2 text-xs text-gray-500">No reviewers are in the tracking stage.</p>
            ) : (
              <div className="mt-2.5 max-w-xl" aria-label={`Reviewer status: ${receivedCount} received, ${waitingCount} waiting, ${overdueCount} late`}>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-200" role="img" aria-hidden="true">
                  {receivedCount > 0 && <span className="bg-green-500" style={{ width: `${(receivedCount / reviewers.length) * 100}%` }} />}
                  {waitingCount > 0 && <span className="bg-gray-400" style={{ width: `${(waitingCount / reviewers.length) * 100}%` }} />}
                  {overdueCount > 0 && <span className="bg-red-500" style={{ width: `${(overdueCount / reviewers.length) * 100}%` }} />}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                  <span className="text-green-700"><strong>{receivedCount}</strong> received</span>
                  <span className="text-gray-600"><strong>{waitingCount}</strong> waiting</span>
                  <span className="text-red-700"><strong>{overdueCount}</strong> late</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="min-h-11 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
            >
              {open ? 'Hide reviewer activity' : 'Show reviewer activity'}
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="border-t border-gray-200 bg-gray-50/60 px-4 py-3.5 sm:px-5 sm:py-4">
          {reviewers.length === 0 ? (
            <p className="py-4 text-sm text-gray-500">
              There are no accepted reviewers to track yet. Open the full reviewer panel to find or invite reviewers.
            </p>
          ) : (
            <div className="reviewer-activity-panel">
              <ReviewerManagePanel
                proposal={proposal}
                reviewers={reviewers}
                onRefresh={onRefresh}
                settings={{ reviewDueDate: proposal.reviewDeadline }}
                mode="track"
                canManage={canManage}
                showReviewReminderAction={canManage || previewReadOnly}
                previewReadOnly={previewReadOnly}
                degraded={degraded}
                loading={loading}
              />
              <style jsx global>{`
                .reviewer-activity-panel td span.rounded,
                .reviewer-activity-panel td span.rounded-full,
                .reviewer-activity-panel td a.rounded-full,
                .reviewer-activity-panel td button.rounded-full {
                  display: inline-flex;
                  min-height: 1.75rem;
                  align-items: center;
                  border-radius: 9999px;
                  line-height: 1.25;
                  padding: 0.25rem 0.625rem;
                }
                .reviewer-activity-panel button[aria-label^='Manage '] {
                  min-width: 2.25rem;
                  min-height: 2.25rem;
                  border: 1px solid #d1d5db;
                  border-radius: 0.5rem;
                  color: #374151;
                  background: #ffffff;
                }
                .reviewer-activity-panel button[aria-label^='Manage ']:hover {
                  color: #111827;
                  background: #f3f4f6;
                }
              `}</style>
            </div>
          )}
        </div>
      )}

    </article>
  );
}

/**
 * @param {object} props
 * @param {string} props.programId
 * @param {string|null} props.cycleCode   null while the shell resolves the cycle
 * @param {boolean} props.loadingCycles
 * @param {boolean} props.previewReadOnly
 * @param {'my'|'all'} props.scope         request scope (shared with the Request list)
 * @param {'attention'|'all'} props.reviewersView
 * @param {string} props.search
 * @param {Function} props.onScopeChange
 * @param {Function} props.onReviewersViewChange
 * @param {Function} props.onSearchChange  called debounced with the trimmed-as-typed value
 */
export default function ReviewerFollowUpPanel({
  programId,
  cycleCode,
  loadingCycles,
  previewReadOnly = false,
  scope,
  reviewersView,
  search,
  onScopeChange,
  onReviewersViewChange,
  onSearchChange,
}) {
  const [proposals, setProposals] = useState([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);
  const lastLoadedParamsRef = useRef(null);

  const [searchInput, setSearchInput] = useUrlMirroredInput(search, onSearchChange);

  const loadProposals = useCallback(async (selectedCycle, selectedScope, selectedProgramId) => {
    if (!selectedCycle) return;
    const requestId = ++requestIdRef.current;
    const requestScope = selectedScope === 'all' ? 'all' : 'my';
    setLoadingProposals(true);
    try {
      const [dashboardResponse, reviewerResponse] = await Promise.all([
        fetch(`/api/workbench/dashboard?cycleCode=${encodeURIComponent(selectedCycle)}&scope=${requestScope}&programId=${encodeURIComponent(selectedProgramId)}`),
        fetch(`/api/review-manager/reviewers?cycleCode=${encodeURIComponent(selectedCycle)}&scope=${requestScope}&programId=${encodeURIComponent(selectedProgramId)}`),
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
      lastLoadedParamsRef.current = `${selectedCycle}|${requestScope}|${selectedProgramId}`;
      setError(null);
    } catch (loadError) {
      if (requestIdRef.current !== requestId) return;
      setError(loadError.message);
    } finally {
      if (requestIdRef.current === requestId) setLoadingProposals(false);
    }
  }, []);

  useEffect(() => {
    if (!cycleCode) {
      // The shell is resolving a cycle: ignore any load still in flight.
      requestIdRef.current += 1;
      return undefined;
    }
    const requestScope = scope === 'all' ? 'all' : 'my';
    const currentParams = `${cycleCode}|${requestScope}|${programId}`;
    requestIdRef.current += 1;
    if (lastLoadedParamsRef.current !== null && lastLoadedParamsRef.current !== currentParams) {
      setProposals([]);
      setError(null);
      setLoadingProposals(true);
    }
    const timer = window.setTimeout(() => { void loadProposals(cycleCode, scope, programId); }, 0);
    return () => window.clearTimeout(timer);
  }, [cycleCode, loadProposals, programId, scope]);

  useEffect(() => () => { requestIdRef.current += 1; }, []);

  // Counts computed after the reviewer-status filter but before the live
  // text filter, so "Showing X of Y" has a stable denominator while typing.
  const statusFilteredProposals = useMemo(() => filterReviewerFollowUpProposals(proposals, {
    view: reviewersView,
    search: '',
  }), [proposals, reviewersView]);
  const visibleProposals = useMemo(() => filterReviewerFollowUpProposals(proposals, {
    view: reviewersView,
    search: searchInput,
  }), [proposals, searchInput, reviewersView]);
  const summary = useMemo(() => summarizeReviewerFollowUp(
    proposals.filter((proposal) => !proposal.workbench?.setAside),
  ), [proposals]);

  return (
    <>
      {previewReadOnly && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" role="status">
          <span className="font-semibold">Preview is read-only.</span>{' '}
          This Preview is not connected to the reviewer sandbox. Follow-up controls are shown below but remain disabled here.
        </div>
      )}

      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <ScopeSegment scope={scope} onChange={onScopeChange} />

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-gray-700">Reviewer status</legend>
            <div className={`inline-flex ${TOOLBAR_CONTROL_HEIGHT_CLASS} overflow-hidden rounded-xl border border-gray-300 bg-white`}>
              <button
                type="button"
                onClick={() => onReviewersViewChange('attention')}
                aria-pressed={reviewersView === 'attention'}
                className={`px-4 py-2 text-sm font-semibold ${reviewersView === 'attention' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                Needs attention ({summary.attentionRequests})
              </button>
              <button
                type="button"
                onClick={() => onReviewersViewChange('all')}
                aria-pressed={reviewersView === 'all'}
                className={`border-l border-gray-300 px-4 py-2 text-sm font-semibold ${reviewersView === 'all' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                All ({summary.assignedRequests})
              </button>
            </div>
          </fieldset>

          </div>
          <div className="flex flex-col gap-3 border-t border-gray-100 pt-3 sm:flex-row sm:items-start sm:justify-between">
            <ViewFilterInput
              id="reviewer-follow-up-search"
              label="Filter reviewer follow-up"
              placeholder="Request #, institution, PI, or reviewer"
              value={searchInput}
              onChange={setSearchInput}
              shown={visibleProposals.length}
              total={statusFilteredProposals.length}
              unit="requests"
            />
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
        </div>
      </div>

      <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-3 border-b border-gray-200 pb-4 text-sm sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-6 sm:gap-y-2">
        {[
          [scope === 'all' ? 'Cycle requests' : 'Assigned requests', summary.assignedRequests],
          ['Active reviewers', summary.activeReviewers],
          ['Overdue', summary.overdueReviewers],
          ['Reviews received', summary.reviewsReceived],
        ].map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
            <dt className="text-gray-500">{label}</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>

      {error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-900" role="alert">
          {proposals.length > 0 ? (
            <>
              <p className="font-semibold">Reviewer follow-up could not be refreshed</p>
              <p className="mt-1">Showing the last loaded results. Retry before making changes.</p>
              <p className="mt-1">I&apos;m having trouble accessing the server. This is usually a temporary blip. Please press retry and if the problem doesn&apos;t resolve, contact an administrator.</p>
              <p className="mt-1 text-red-800">Details: <span>{error}</span></p>
            </>
          ) : (
            <>
              <p className="font-semibold">Reviewer follow-up could not be loaded</p>
              <p className="mt-1">I&apos;m having trouble accessing the server. This is usually a temporary blip. Please press retry and if the problem doesn&apos;t resolve, contact an administrator.</p>
              <p className="mt-1 text-red-800">Details: <span>{error}</span></p>
            </>
          )}
          <button
            type="button"
            onClick={() => void loadProposals(cycleCode, scope, programId)}
            disabled={loadingProposals || !cycleCode}
            className="mt-3 min-h-10 rounded-lg bg-gray-900 px-3 py-2 font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loadingProposals ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}

      {(loadingCycles || loadingProposals) && proposals.length === 0 ? (
        <Card hover={false}>
          <div className="flex items-center gap-3" role="status" aria-live="polite">
            <span className="h-2 w-2 animate-pulse rounded-full bg-gray-500" aria-hidden="true" />
            <p className="text-sm text-gray-600">Loading reviewer activity…</p>
          </div>
        </Card>
      ) : visibleProposals.length === 0 && cycleCode && (!error || proposals.length > 0) ? (
        <Card hover={false}>
          <p className="font-medium text-gray-900">
            {scope === 'my' && proposals.length === 0
              ? 'No requests are assigned to you in this cycle.'
              : reviewersView === 'attention'
              ? 'No reviewer follow-up needs attention.'
              : `No ${scope === 'all' ? 'cycle' : 'assigned'} requests match this view.`}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {scope === 'my' && proposals.length === 0
              ? 'Select All in program to view the full cycle.'
              : reviewersView === 'attention'
              ? 'Select All to see completed reviews and proposals without active reviewer engagements.'
              : 'Change the cycle or search.'}
          </p>
        </Card>
      ) : visibleProposals.length > 0 ? (
        <div className="space-y-4">
          {visibleProposals.map((proposal) => (
            <ReviewerGroup
              key={proposal.proposalId}
              proposal={proposal}
              previewReadOnly={previewReadOnly}
              onRefresh={() => loadProposals(cycleCode, scope, programId)}
              degraded={Boolean(error)}
              loading={loadingProposals}
            />
          ))}
        </div>
      ) : null}

      {templatesOpen && !previewReadOnly && (
        <EmailTemplatesModal onClose={() => setTemplatesOpen(false)} />
      )}
    </>
  );
}
