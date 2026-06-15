/**
 * Request Workbench — per-request shell (tier-3).
 *
 * Renders the request context header + the tab strip. The Reviewers tab is live
 * (Phase 2: Invite/Track/Completed via the shared ReviewerManagePanel; Phase 3:
 * the Find sub-tab — applicant-reviewer ingestion + in-panel search); the other
 * 9 tabs are placeholders for the rest of the request lifecycle. Tab + sub-tab
 * selection is query-string driven (?tab=reviewers&sub=invite) for deep-links.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Layout, { Card } from '../../shared/components/Layout';
import RequireAppAccess from '../../shared/components/RequireAppAccess';
import { useAppAccess } from '../../shared/context/AppAccessContext';
import { useProfile } from '../../shared/context/ProfileContext';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences';
import ReviewersTab from '../../shared/components/reviewers/ReviewersTab';
import ProposalTab from '../../shared/components/workbench/ProposalTab';
import { computeCanManage } from '../../shared/components/reviewers/reviewer-modes';

// Reviewers is the live tab (Phases 2–3); the other 9 are placeholders for the
// full request lifecycle. Order matches the build plan's tab strip.
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'initial-writeup', label: 'Initial Writeup' },
  { key: 'reviewers', label: 'Reviewers' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'pre-site-visit', label: 'Pre Site Visit Writeup' },
  { key: 'site-visit', label: 'Site Visit' },
  { key: 'final-writeup', label: 'Final Writeup' },
  { key: 'status', label: 'Status' },
  { key: 'awardee', label: 'Awardee' },
];
const TAB_KEYS = new Set(TABS.map((t) => t.key));

function WorkbenchRequest() {
  const router = useRouter();
  const { data: session } = useSession();
  const { isSuperuser } = useAppAccess();
  const { preferences } = useProfile();
  const { requestId } = router.query;

  const tabParam = typeof router.query.tab === 'string' ? router.query.tab : null;
  const activeTab = tabParam && TAB_KEYS.has(tabParam) ? tabParam : 'reviewers';

  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState(null);

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

  // Per-user invite signature — the same SENDER_INFO preference the standalone
  // Reviewer Finder uses (sender identity is always the signed-in MS account;
  // this only resolves the {{signature}} placeholder in the email templates).
  // Falls back to the freeform signature → sender name → profile display name.
  const reviewerSettings = useMemo(() => {
    let signature = session?.user?.profileName || '';
    const raw = preferences?.[PREFERENCE_KEYS.SENDER_INFO];
    if (raw) {
      try {
        const sender = JSON.parse(raw);
        signature = sender.signature || sender.name || signature;
      } catch {
        /* malformed preference — keep the profile-name fallback */
      }
    }
    return { signature };
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

      {/* Tab strip */}
      <div className="border-b border-gray-200 mb-6 overflow-x-auto">
        <nav className="flex gap-1 min-w-max">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
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

      {activeTab === 'reviewers' ? (
        <ReviewersTab
          requestId={typeof requestId === 'string' ? requestId : ''}
          context={ctx}
          canManage={canManage}
          settings={reviewerSettings}
        />
      ) : activeTab === 'proposal' ? (
        <ProposalTab context={ctx} />
      ) : (
        <Card hover={false}>
          <p className="text-sm text-gray-500">This panel is coming in a later update.</p>
        </Card>
      )}
    </Layout>
  );
}

export default function WorkbenchRequestGuard() {
  return (
    <RequireAppAccess appKey="reviewers">
      <WorkbenchRequest />
    </RequireAppAccess>
  );
}
