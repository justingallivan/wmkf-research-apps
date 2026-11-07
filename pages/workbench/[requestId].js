/**
 * Request Workbench shell. Sandbox J27 development uses five workflow phases,
 * with legacy tab links resolved to their existing components. Other targets
 * retain the existing tab layout. Existing server authorization and storage
 * contracts are unchanged. Reviewer `sub` navigation remains independent of
 * phase `section` navigation.
 */

import { initialAssessmentRationaleEnabled } from '../../lib/utils/initial-assessment-rationale-readiness';
import InitialAssessmentRationale from '../../shared/components/workbench/InitialAssessmentRationale';
import { meetingRosterSchemaEnabled } from '../../lib/utils/meeting-roster-readiness';
import MeetingRoster from '../../shared/components/workbench/MeetingRoster';
import StaffVisitAssessment from '../../shared/components/workbench/StaffVisitAssessment';
import StaffReviewSummary from '../../shared/components/workbench/StaffReviewSummary';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Layout, { Card } from '../../shared/components/Layout';
import RequireAppAccess from '../../shared/components/RequireAppAccess';
import TestRequestBadge from '../../shared/components/TestRequestBadge';
import { useAppAccess } from '../../shared/context/AppAccessContext';
import { useProfile } from '../../shared/context/ProfileContext';
import { readEmailSignaturePreference } from '../../shared/config/reviewerFinderPreferences';
import ReviewersTab from '../../shared/components/reviewers/ReviewersTab';
import ReviewsTab from '../../shared/components/workbench/ReviewsTab';
import FirstCutCard from '../../shared/components/workbench/FirstCutCard';
import ProposalTab from '../../shared/components/workbench/ProposalTab';
import IntegrityTab from '../../shared/components/workbench/IntegrityTab';
import OverviewTab from '../../shared/components/workbench/OverviewTab';
import AwardeeTab from '../../shared/components/workbench/AwardeeTab';
import InitialAssessmentTab from '../../shared/components/workbench/InitialAssessmentTab';
import StaffDeliberationsTab from '../../shared/components/workbench/StaffDeliberationsTab';
import ReviewPanelTab from '../../shared/components/workbench/ReviewPanelTab';
import FinalWriteupTab from '../../shared/components/workbench/FinalWriteupTab';
import { computeCanManage } from '../../shared/components/reviewers/reviewer-modes';
import { requestEnvelope } from '../../shared/utils/api-request';
import { classifyTarget } from '../../lib/dataverse/core/interlock';

// Implemented tabs: Overview, Proposal, Initial Assessment, Reviewers, Reviews,
// Review Panel (S511; visible only with the `review-panel` app grant — `gate`),
// Staff Deliberations (the merged site-visit writeup workspace, S466), Awardee,
// Final Writeup now supplies the governed group-review handoff and Word launch.
// A tab with `gate` is hidden (and its deep link falls back to Overview) unless
// useAppAccess().hasAccess(gate) is true — fail-closed while access loads.
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'integrity', label: 'Integrity', gate: 'integrity-screener' },
  { key: 'initial-writeup', label: 'Initial Assessment' },
  { key: 'reviewers', label: 'Reviewers' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'review-panel', label: 'Review Panel', gate: 'review-panel' },
  { key: 'staff-deliberations', label: 'Staff Deliberations' },
  { key: 'final-writeup', label: 'Final writeup' },
  { key: 'awardee', label: 'Awardee' },
];
/** Tabs the current viewer may see: ungated tabs always; gated tabs only when the app grant is present. */
export function visibleTabsFor(hasAccess) {
  return TABS.filter((t) => !t.gate || (typeof hasAccess === 'function' && hasAccess(t.gate) === true));
}
// Deep links and onSelectTab callers from before the S466 merge keep working.
const LEGACY_TAB_ALIASES = {
  'pre-site-visit': 'staff-deliberations',
  'site-visit': 'staff-deliberations',
};

export function WorkbenchRequest({ previewReadOnly = false, staffReviewSummary = false, meetingRosterEnabled = false, initialRationaleEnabled = false }) {
  const router = useRouter();
  const { data: session } = useSession();
  const { isSuperuser, hasAccess } = useAppAccess();
  const { preferences } = useProfile();
  const { requestId } = router.query;

  const [ctx, setCtx] = useState(null);
  const [ctxOwnerGeneration, setCtxOwnerGeneration] = useState(-1);
  const [error, setError] = useState(null);
  const [errorRequestId, setErrorRequestId] = useState(null);
  const ctxLoadGeneration = useRef(0);
  const tabScrollerRef = useRef(null);
  const routeRequestId = typeof requestId === 'string' && requestId ? requestId : null;
  const routeKey = routeRequestId?.toLowerCase() || '';
  const [visitEditorRequestId, setVisitEditorRequestId] = useState(null);
  const [rationaleEditorRequestId, setRationaleEditorRequestId] = useState(null);
  const routeStateRef = useRef({ key: routeKey, generation: 0 });
  if (routeStateRef.current.key !== routeKey) {
    routeStateRef.current = {
      key: routeKey,
      generation: routeStateRef.current.generation + 1,
    };
  }
  const routeGeneration = routeStateRef.current.generation;
  const contextMatchesRoute = !!routeRequestId
    && typeof ctx?.requestId === 'string'
    && ctx.requestId.toLowerCase() === routeRequestId.toLowerCase();
  const visibleContext = contextMatchesRoute && ctxOwnerGeneration === routeGeneration ? ctx : null;
  const visibleError = error && errorRequestId?.toLowerCase() === routeRequestId?.toLowerCase()
    ? error
    : null;

  // The redesigned shell follows the same sandbox boundary as the tested fields.
  const phaseLayout = staffReviewSummary && visibleContext?.cycleCode === 'J27';
  const showInitialRationale = phaseLayout && initialRationaleEnabled;
  const phaseTabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'initial-assessment', label: 'Initial Assessment' },
    { key: 'peer-review', label: 'Peer Review' },
    { key: 'deliberations', label: 'Deliberations' },
    { key: 'final-assessment', label: 'Final Assessment' },
  ];
  const visibleTabs = phaseLayout ? phaseTabs : visibleTabsFor(hasAccess);
  const visibleTabKeys = useMemo(() => new Set(visibleTabs.map((t) => t.key)), [visibleTabs]);
  const rawTabParam = typeof router.query.tab === 'string' ? router.query.tab : null;
  const phaseLinkPending = staffReviewSummary && !visibleContext
    && ['initial-assessment', 'peer-review', 'deliberations', 'final-assessment'].includes(rawTabParam);
  const tabParam = rawTabParam ? (LEGACY_TAB_ALIASES[rawTabParam] || rawTabParam) : null;
  const legacySections = {
    proposal: ['initial-assessment', 'proposal'],
    integrity: ['initial-assessment', 'integrity'],
    'initial-writeup': ['initial-assessment', 'assessment'],
    reviewers: ['peer-review', 'panel'],
    reviews: ['peer-review', 'reports'],
    'review-panel': ['peer-review', 'group-review'],
    'staff-deliberations': ['deliberations', null],
    'final-writeup': ['final-assessment', null],
    awardee: ['overview', 'awardee'],
  };
  const legacy = phaseLayout ? legacySections[tabParam] : null;
  const phase = legacy?.[0] || (tabParam && visibleTabKeys.has(tabParam) ? tabParam : 'overview');
  const requestedSection = legacy?.[1] || (typeof router.query.section === 'string' ? router.query.section : null);
  const sections = !phaseLayout ? [] : phase === 'initial-assessment' ? [
    { key: 'proposal', label: showInitialRationale ? 'Assessment' : 'Proposal' },
    ...(hasAccess('integrity-screener') === true ? [{ key: 'integrity', label: 'Integrity' }] : []),
    { key: 'assessment', label: showInitialRationale ? 'Word assessment' : 'Assessment' },
  ] : phase === 'peer-review' ? [
    { key: 'panel', label: 'Panel' }, { key: 'reports', label: 'Reports' },
    ...(hasAccess('review-panel') === true ? [{ key: 'group-review', label: 'Group review' }] : []),
  ] : phase === 'overview' ? [
    { key: 'summary', label: 'Summary' }, { key: 'awardee', label: 'Awardee' },
  ] : [];
  const section = sections.some((item) => item.key === requestedSection) ? requestedSection : sections[0]?.key;
  const phaseContent = {
    'initial-assessment': { proposal: 'proposal', integrity: 'integrity', assessment: 'initial-writeup' },
    'peer-review': { panel: 'reviewers', reports: 'reviews', 'group-review': 'review-panel' },
    overview: { summary: 'overview', awardee: 'awardee' },
    deliberations: { default: 'staff-deliberations' },
    'final-assessment': { default: 'final-writeup' },
  };
  const activeTab = phaseLayout ? (phaseContent[phase]?.[section || 'default'] || 'overview')
    : (tabParam && visibleTabKeys.has(tabParam) ? tabParam : 'overview');
  const reviewerSurfaceReadOnly = previewReadOnly && ['reviewers', 'reviews'].includes(activeTab);
  const editingInitialRationale = showInitialRationale && activeTab === 'proposal';

  useEffect(() => {
    if (editingInitialRationale) setRationaleEditorRequestId(routeRequestId);
  }, [editingInitialRationale, routeRequestId]);


  useEffect(() => {
    if (activeTab === 'staff-deliberations') setVisitEditorRequestId(routeRequestId);
  }, [activeTab, routeRequestId]);

  useEffect(() => {
    const scroller = tabScrollerRef.current;
    const activeButton = scroller?.querySelector('[aria-current="page"]');
    if (!scroller || !activeButton || scroller.scrollWidth <= scroller.clientWidth) return;
    scroller.scrollLeft = Math.max(
      0,
      activeButton.offsetLeft - (scroller.clientWidth - activeButton.offsetWidth) / 2,
    );
  }, [activeTab, visibleTabs.length]);

  // Request context (header, PD for the canManage gate, title for the panel).
  // Resolved by GUID — which the route always has — so it loads on direct/
  // bookmarked links too, not only when the dashboard passes ?n= (Codex S209).
  const requestNumber = typeof router.query.n === 'string' ? router.query.n : null;
  const loadCtx = useCallback(async (id) => {
    const loadGeneration = (ctxLoadGeneration.current += 1);
    const ownerGeneration = routeGeneration;
    setError(null);
    setErrorRequestId(null);
    try {
      const envelope = await requestEnvelope(`/api/workbench/resolve-request?requestId=${encodeURIComponent(id)}`, {
        tolerantBody: true,
      });
      if (!envelope.ok) throw new Error(envelope.data.error || `Failed to load request (${envelope.status})`);
      if (envelope.data?.success !== true || typeof envelope.data.requestId !== 'string'
        || envelope.data.requestId.toLowerCase() !== id.toLowerCase()) {
        throw new Error('Request context did not match the requested request');
      }
      if (ctxLoadGeneration.current === loadGeneration && routeKey === id.toLowerCase()) {
        setCtx(envelope.data);
        setCtxOwnerGeneration(ownerGeneration);
      }
    } catch (e) {
      if (ctxLoadGeneration.current === loadGeneration && routeKey === id.toLowerCase()) {
        setCtx(null);
        setCtxOwnerGeneration(-1);
        setError(e.message);
        setErrorRequestId(id);
      }
    }
  }, [routeKey, routeGeneration]);

  useEffect(() => {
    ctxLoadGeneration.current += 1;
    setCtx(null);
    setCtxOwnerGeneration(-1);
    setError(null);
    setErrorRequestId(null);
    if (typeof requestId === 'string' && requestId) loadCtx(requestId);
    return () => {
      ctxLoadGeneration.current += 1;
    };
  }, [requestId, loadCtx]);

  const selectTab = async (key, nextSection) => {
    const destination = phaseLayout ? legacySections[key] : null;
    const destinationPhase = destination?.[0] || key;
    const reviewerQuery = phaseLayout && phase === 'peer-review' && destinationPhase === 'peer-review'
      ? Object.fromEntries(['sub', 'proposalFile', 'repairCandidate', 'repairSuggestion']
        .filter((name) => typeof router.query[name] === 'string')
        .map((name) => [name, router.query[name]]))
      : {};
    try { await router.push(
      { pathname: `/workbench/${requestId}`, query: { ...reviewerQuery, ...(requestNumber ? { n: requestNumber } : {}), tab: destination?.[0] || key, ...((destination?.[1] || nextSection) ? { section: destination?.[1] || nextSection } : {}) } },
      undefined,
      { shallow: true },
    ); } catch (navigationError) { if (!navigationError?.cancelled) throw navigationError; }
  };

  // Fail-closed UI gate. Protected mutation routes independently enforce their
  // server-side policy; this client projection is never authorization.
  const myUserId = session?.user?.dynamicsSystemuserId || null;
  const pdId = visibleContext?.programDirectorId || null;
  const canManage = computeCanManage({ isSuperuser, pdId, myUserId });

  // Per-user invite signature — the unified email_signature preference, with
  // legacy SENDER_INFO fallback (sender identity is always the signed-in MS
  // account; this only resolves the {{signature}} placeholder in templates).
  // Falls back to the freeform signature → sender name → profile display name.
  const reviewerSettings = useMemo(() => {
    const sender = readEmailSignaturePreference(preferences);
    return { signature: sender.signature || sender.name || session?.user?.profileName || '' };
  }, [preferences, session?.user?.profileName]);

  return (
    <Layout title="Request Workbench">
      <div className="mb-4">
        <Link href="/workbench" className="text-sm text-gray-500 hover:text-gray-700">← Back to Workbench</Link>
      </div>

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">
            {visibleContext?.requestNumber ? `Request #${visibleContext.requestNumber}` : (requestNumber ? `Request #${requestNumber}` : 'Request Workbench')}
          </h1>
          <TestRequestBadge isTestRequest={visibleContext?.isTestRequest} />
        </div>
        {visibleContext?.title && <p className="text-gray-600 mt-1">{visibleContext.title}</p>}
        {visibleContext && (
          <p className="text-sm text-gray-500 mt-1">
            {[visibleContext.cycleLabel, visibleContext.grantProgram, visibleContext.institution].filter(Boolean).join(' · ')}
          </p>
        )}
        {visibleError && <p className="text-sm text-amber-600 mt-1">Couldn’t load request details: {visibleError}</p>}
      </div>

      {reviewerSurfaceReadOnly && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" role="status">
          <span className="font-semibold">Preview is read-only for reviewer work.</span>{' '}
          This Preview is not connected to the reviewer sandbox. Reviewer changes are disabled here.
        </div>
      )}

      {/* Tab strip */}
      <div hidden={phaseLinkPending} ref={tabScrollerRef} className="border-b border-gray-200 mb-6 overflow-x-auto">
        <nav className="flex gap-1 min-w-max" aria-label="Request sections">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              aria-current={(phaseLayout ? phase : activeTab) === t.key ? 'page' : undefined}
              className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${
                (phaseLayout ? phase : activeTab) === t.key
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {sections.length > 0 && (
        <nav className="flex flex-wrap gap-2 mb-6" aria-label={`${phaseTabs.find((item) => item.key === phase)?.label || 'Phase'} sections`}>
          {sections.filter((item) => item.key !== 'group-review').map((item) => (
            <button key={item.key} type="button" onClick={() => selectTab(phase, item.key)}
              aria-current={(section === 'group-review' ? 'panel' : section) === item.key ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${(section === 'group-review' ? 'panel' : section) === item.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {phaseLayout && phase === 'peer-review' && section !== 'reports' && hasAccess('review-panel') === true && (
        <nav className="flex gap-4 mb-6 text-sm" aria-label="Panel tools">
          {[
            { key: 'panel', label: 'Reviewer roster' },
            { key: 'group-review', label: 'Group review' },
          ].map((item) => (
            <button key={item.key} type="button" onClick={() => selectTab('peer-review', item.key)}
              aria-current={section === item.key ? 'page' : undefined}
              className={`py-2 border-b-2 ${section === item.key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'}`}>
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {staffReviewSummary && visibleContext?.cycleCode === 'J27' && activeTab === 'staff-deliberations' && (
        <StaffReviewSummary key={`deliberations-review-summary:${routeRequestId}`} requestId={routeRequestId} readOnly />
      )}
      {staffReviewSummary && visibleContext?.cycleCode === 'J27'
        && (activeTab === 'staff-deliberations' || visitEditorRequestId === routeRequestId) && (
        <div hidden={activeTab !== 'staff-deliberations'}>
          {meetingRosterEnabled && <MeetingRoster key={`meeting-roster-editor:${routeRequestId}`} requestId={routeRequestId} />}
          <StaffVisitAssessment key={`staff-visit-editor:${routeRequestId}`} requestId={routeRequestId} />
        </div>
      )}

      {showInitialRationale && (editingInitialRationale || rationaleEditorRequestId === routeRequestId) && (
        <div hidden={!editingInitialRationale}>
          <InitialAssessmentRationale key={routeRequestId} requestId={routeRequestId} />
        </div>
      )}

      {phaseLinkPending ? (
        <Card hover={false}>
          <p className="text-sm text-gray-600" role="status">
            {visibleError ? 'Request details are required to open this phase.' : 'Loading request details…'}
          </p>
          {visibleError && <button type="button" className="mt-3 text-sm font-medium underline"
            onClick={() => loadCtx(routeRequestId)}>Retry</button>}
        </Card>
      ) : activeTab === 'overview' ? (
        <OverviewTab
          key={routeRequestId || ''}
          context={visibleContext}
          requestId={routeRequestId || ''}
          onSelectTab={selectTab}
        />
      ) : activeTab === 'reviewers' ? (
        <ReviewersTab
          // Key by requestId so the whole subtree remounts on request
          // navigation (matches AwardeeTab below). Without this, the reused
          // instance + its children (ReviewerFindPanel's proposal/applicant
          // loaders) can leak a prior request's data into the new one via
          // in-flight fetches; a fresh mount starts clean.
          key={typeof requestId === 'string' ? requestId : ''}
          requestId={typeof requestId === 'string' ? requestId : ''}
          context={visibleContext}
          canChangeDeadline={Boolean(myUserId && pdId && myUserId.toLowerCase() === pdId.toLowerCase())}
          deadlineActorContext={`${myUserId}:${pdId}`}
          canManage={canManage}
          settings={reviewerSettings}
          previewReadOnly={reviewerSurfaceReadOnly}
        />
      ) : activeTab === 'proposal' ? (
        <>
          {visibleContext?.cycleCode === 'J27' && (
            <FirstCutCard
              key={routeRequestId}
              context={visibleContext}
              canManage={canManage && !previewReadOnly}
              refresh={() => {
                if (routeStateRef.current.generation === routeGeneration) return loadCtx(routeRequestId);
              }}
            />
          )}
          {showInitialRationale ? (
            <details key={routeRequestId} open={rawTabParam === 'proposal'}
              className="rounded-xl border bg-white p-5">
              <summary className="cursor-pointer font-semibold">Proposal and AI intake findings</summary>
              <div className="mt-4">
                <ProposalTab context={visibleContext} requestId={routeRequestId} />
              </div>
            </details>
          ) : (
            <ProposalTab key={routeRequestId || ''} context={visibleContext} requestId={routeRequestId || ''} />
          )}
        </>
      ) : activeTab === 'integrity' ? (
        <IntegrityTab key={routeRequestId || ''} requestId={routeRequestId || ''} />
      ) : activeTab === 'initial-writeup' ? (
        <InitialAssessmentTab
          key={typeof requestId === 'string' ? requestId : ''}
          requestId={typeof requestId === 'string' ? requestId : ''}
          isSuperuser={isSuperuser}
        />
      ) : activeTab === 'reviews' ? (
        <ReviewsTab
          key={typeof requestId === 'string' ? requestId : ''}
          requestId={typeof requestId === 'string' ? requestId : ''}
          previewReadOnly={reviewerSurfaceReadOnly}
          showStaffReviewSummary={staffReviewSummary && visibleContext?.cycleCode === 'J27'}
        />
      ) : activeTab === 'review-panel' ? (
        <ReviewPanelTab
          key={typeof requestId === 'string' ? requestId : ''}
          requestId={typeof requestId === 'string' ? requestId : ''}
        />
      ) : activeTab === 'staff-deliberations' ? (
        <StaffDeliberationsTab
          key={typeof requestId === 'string' ? requestId : ''}
          requestId={typeof requestId === 'string' ? requestId : ''}
          requestNumber={visibleContext?.requestNumber || requestNumber || ''}
          isSuperuser={isSuperuser}
          onSelectTab={selectTab}
        />
      ) : activeTab === 'final-writeup' ? (
        <>
          {staffReviewSummary && visibleContext?.cycleCode === 'J27' && (
            <>
              <StaffReviewSummary key={`staff-review-summary:${routeRequestId}`} requestId={routeRequestId} readOnly />
              {meetingRosterEnabled && <MeetingRoster key={`meeting-roster-reader:${routeRequestId}`} requestId={routeRequestId} readOnly />}
              <StaffVisitAssessment key={`staff-visit-assessment:${routeRequestId}`} requestId={routeRequestId} readOnly />
            </>
          )}
          <FinalWriteupTab
            key={typeof requestId === 'string' ? requestId : ''}
            requestId={typeof requestId === 'string' ? requestId : ''}
          />
        </>
      ) : activeTab === 'awardee' ? (
        <AwardeeTab
          key={typeof requestId === 'string' ? requestId : ''}
          requestId={typeof requestId === 'string' ? requestId : ''}
          context={visibleContext}
        />
      ) : (
        <Card hover={false}>
          <p className="text-sm text-gray-500">This panel is coming in a later update.</p>
        </Card>
      )}
    </Layout>
  );
}

export async function getServerSideProps() {
  const previewReadOnly = process.env.VERCEL_ENV === 'preview'
    && classifyTarget(process.env.DYNAMICS_URL) !== 'sandbox';
  const staffReviewSummary = process.env.VERCEL_ENV !== 'production'
    && classifyTarget(process.env.DYNAMICS_URL) === 'sandbox';
  return { props: { previewReadOnly, staffReviewSummary, meetingRosterEnabled: meetingRosterSchemaEnabled(), initialRationaleEnabled: initialAssessmentRationaleEnabled() } };
}

export default function WorkbenchRequestGuard(props) {
  return (
    <RequireAppAccess appKey="reviewers">
      <WorkbenchRequest {...props} />
    </RequireAppAccess>
  );
}
