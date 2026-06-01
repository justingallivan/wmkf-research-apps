/**
 * Request Workbench — per-request shell (tier-3).
 *
 * Phase 1 ships this as the landing target for the dashboard rows so they don't
 * link into a 404. It renders the request context header + the tab strip; the
 * Reviewers tab (and the rest) get their real panels in Phase 2. Tab selection
 * is query-string driven (?tab=reviewers) for deep-links.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout, { Card } from '../../shared/components/Layout';
import RequireAppAccess from '../../shared/components/RequireAppAccess';

// Reviewers is the live tab (Phase 2); the rest are placeholders for the full
// request lifecycle. Order matches the build plan's tab strip.
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
  const { requestId } = router.query;

  const tabParam = typeof router.query.tab === 'string' ? router.query.tab : null;
  const activeTab = tabParam && TAB_KEYS.has(tabParam) ? tabParam : 'reviewers';

  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState(null);

  // Best-effort header context. resolve-request keys on number, so we only fetch
  // when the dashboard passed ?n=<requestNumber>; otherwise we just show the id.
  const requestNumber = typeof router.query.n === 'string' ? router.query.n : null;
  const loadCtx = useCallback(async (num) => {
    try {
      const res = await fetch(`/api/workbench/resolve-request?requestNumber=${encodeURIComponent(num)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load request (${res.status})`);
      setCtx(body);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (requestNumber) loadCtx(requestNumber);
  }, [requestNumber, loadCtx]);

  const selectTab = (key) => {
    router.push(
      { pathname: `/workbench/${requestId}`, query: { ...(requestNumber ? { n: requestNumber } : {}), tab: key } },
      undefined,
      { shallow: true },
    );
  };

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

      <Card hover={false}>
        {activeTab === 'reviewers' ? (
          <div className="text-gray-600">
            <p className="font-medium text-gray-900 mb-1">Reviewers</p>
            <p className="text-sm">
              Finding, inviting, and tracking peer reviewers for this request lands here in the next update.
              For now, use the standalone Reviewer Finder and Review Manager.
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">This panel is coming in a later update.</p>
        )}
      </Card>
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
