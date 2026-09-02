/**
 * Request Workbench — per-request shell (tier-3).
 *
 * Renders the request context header + the tab strip. LIVE tabs: Reviewers
 * (Find, Invite Reviewers, Track Reviewers via ReviewerManagePanel; Phase 3
 * applicant-reviewer ingestion + in-panel search), Proposal (documents + AI
 * content + Field Primer, S258/S260), Reviews (read-back of submitted reviews —
 * decoded Q1/Q3/Q10 ratings + file download), and — Group A, S260 — Overview
 * (per-request command center) + Status (read-only akoya_requeststatus
 * reflection), Awardee (grantee-deliverables workflow), and Initial Assessment
 * (governed DOCX producer/read model), and Staff Deliberations (S466 merge of
 * the former Pre Site Visit Writeup + Site Visit tabs: durable Word producer,
 * guarded share hand-off, logistics, materials distribution, guarded reopen —
 * old tab keys alias in), plus Final Writeup group-review handoff and Word launch. The
 * default landing is Overview. Tab + sub-tab selection is query-string driven
 * (?tab=reviewers&sub=track) for deep-links.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Layout, { Card } from '../../shared/components/Layout';
import RequireAppAccess from '../../shared/components/RequireAppAccess';
import { useAppAccess } from '../../shared/context/AppAccessContext';
import { useProfile } from '../../shared/context/ProfileContext';
import { readEmailSignaturePreference } from '../../shared/config/reviewerFinderPreferences';
import ReviewersTab from '../../shared/components/reviewers/ReviewersTab';
import ReviewsTab from '../../shared/components/workbench/ReviewsTab';
import ProposalTab from '../../shared/components/workbench/ProposalTab';
import OverviewTab from '../../shared/components/workbench/OverviewTab';
import StatusTab from '../../shared/components/workbench/StatusTab';
import AwardeeTab from '../../shared/components/workbench/AwardeeTab';
import InitialAssessmentTab from '../../shared/components/workbench/InitialAssessmentTab';
import StaffDeliberationsTab from '../../shared/components/workbench/StaffDeliberationsTab';
import FinalWriteupTab from '../../shared/components/workbench/FinalWriteupTab';
import { computeCanManage } from '../../shared/components/reviewers/reviewer-modes';
import { classifyTarget } from '../../lib/dataverse/core/interlock';

// Implemented tabs: Overview, Proposal, Initial Assessment, Reviewers, Reviews,
// Staff Deliberations (the merged site-visit writeup workspace, S466), Status,
// Final Writeup now supplies the governed group-review handoff and Word launch.
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'initial-writeup', label: 'Initial Assessment' },
  { key: 'reviewers', label: 'Reviewers' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'staff-deliberations', label: 'Staff Deliberations' },
  { key: 'final-writeup', label: 'Final Writeup' },
  { key: 'status', label: 'Status' },
  { key: 'awardee', label: 'Awardee' },
];
const TAB_KEYS = new Set(TABS.map((t) => t.key));
// Deep links and onSelectTab callers from before the S466 merge keep working.
const LEGACY_TAB_ALIASES = {
  'pre-site-visit': 'staff-deliberations',
  'site-visit': 'staff-deliberations',
};

export function WorkbenchRequest({ previewReadOnly = false }) {
  const router = useRouter();
  const { data: session } = useSession();
  const { isSuperuser } = useAppAccess();
  const { preferences } = useProfile();
  const { requestId } = router.query;

  const rawTabParam = typeof router.query.tab === 'string' ? router.query.tab : null;
  const tabParam = rawTabParam ? (LEGACY_TAB_ALIASES[rawTabParam] || rawTabParam) : null;
  const activeTab = tabParam && TAB_KEYS.has(tabParam) ? tabParam : 'overview';
  const reviewerSurfaceReadOnly = previewReadOnly && ['reviewers', 'reviews'].includes(activeTab);

  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState(null);
  const activeTabButtonRef = useRef(null);

  useEffect(() => {
    activeTabButtonRef.current?.scrollIntoView?.({
      block: 'nearest',
      inline: 'center',
    });
  }, [activeTab]);

  // Request context (header, PD for the canManage gate, title for the panel).
  // Resolved by GUID — which the route always has — so it loads on direct/
  // bookmarked links too, not only when the dashboard passes ?n= (Codex S209).
  const requestNumber = typeof router.query.n === 'string' ? router.query.n : null;
  const loadCtx = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/workbench/resolve-request?requestId=${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load request (${res.status})`);
      setCtx(body);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (typeof requestId === 'string' && requestId) loadCtx(requestId);
  }, [requestId, loadCtx]);

  const selectTab = (key) => {
    router.push(
      { pathname: `/workbench/${requestId}`, query: { ...(requestNumber ? { n: requestNumber } : {}), tab: key } },
      undefined,
      { shallow: true },
    );
  };

  // Soft UI gate (S207 decision) — cosmetic, fails open. See computeCanManage.
  const myUserId = session?.user?.dynamicsSystemuserId || null;
  const pdId = ctx?.programDirectorId || null;
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
        <Link href="/workbench" className="text-sm text-gray-500 hover:text-gray-700">← Back to dashboard</Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {ctx?.requestNumber ? `Request #${ctx.requestNumber}` : (requestNumber ? `Request #${requestNumber}` : 'Request Workbench')}
        </h1>
        {ctx?.title && <p className="text-gray-600 mt-1">{ctx.title}</p>}
        {ctx && (
          <p className="text-sm text-gray-500 mt-1">
            {[ctx.cycleLabel, ctx.grantProgram, ctx.institution].filter(Boolean).join(' · ')}
          </p>
        )}
        {error && <p className="text-sm text-amber-600 mt-1">Couldn’t load request details: {error}</p>}
      </div>

      {reviewerSurfaceReadOnly && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" role="status">
          <span className="font-semibold">Preview is read-only for reviewer work.</span>{' '}
          This Preview is not connected to the reviewer sandbox. Reviewer changes are disabled here.
        </div>
      )}

      {/* Tab strip */}
      <div className="border-b border-gray-200 mb-6 overflow-x-auto">
        <nav className="flex gap-1 min-w-max" aria-label="Request sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              ref={activeTab === t.key ? activeTabButtonRef : null}
              type="button"
              onClick={() => selectTab(t.key)}
              aria-current={activeTab === t.key ? 'page' : undefined}
              className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${
                activeTab === t.key
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' ? (
        <OverviewTab
          context={ctx}
          requestId={typeof requestId === 'string' ? requestId : ''}
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
          context={ctx}
          canManage={canManage}
          settings={reviewerSettings}
          previewReadOnly={reviewerSurfaceReadOnly}
        />
      ) : activeTab === 'proposal' ? (
        <ProposalTab context={ctx} />
      ) : activeTab === 'initial-writeup' ? (
        <InitialAssessmentTab
          key={typeof requestId === 'string' ? requestId : ''}
          requestId={typeof requestId === 'string' ? requestId : ''}
          isSuperuser={isSuperuser}
        />
      ) : activeTab === 'reviews' ? (
        <ReviewsTab
          requestId={typeof requestId === 'string' ? requestId : ''}
          previewReadOnly={reviewerSurfaceReadOnly}
        />
      ) : activeTab === 'staff-deliberations' ? (
        <StaffDeliberationsTab
          key={typeof requestId === 'string' ? requestId : ''}
          requestId={typeof requestId === 'string' ? requestId : ''}
          requestNumber={ctx?.requestNumber || requestNumber || ''}
          isSuperuser={isSuperuser}
        />
      ) : activeTab === 'final-writeup' ? (
        <FinalWriteupTab
          key={typeof requestId === 'string' ? requestId : ''}
          requestId={typeof requestId === 'string' ? requestId : ''}
        />
      ) : activeTab === 'status' ? (
        <StatusTab context={ctx} />
      ) : activeTab === 'awardee' ? (
        <AwardeeTab
          key={typeof requestId === 'string' ? requestId : ''}
          requestId={typeof requestId === 'string' ? requestId : ''}
          context={ctx}
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
  return { props: { previewReadOnly } };
}

export default function WorkbenchRequestGuard(props) {
  return (
    <RequireAppAccess appKey="reviewers">
      <WorkbenchRequest {...props} />
    </RequireAppAccess>
  );
}
