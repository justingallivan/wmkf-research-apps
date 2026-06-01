/**
 * ReviewersTab — the Reviewers tab inside the Request Workbench (tier-3).
 *
 * Hosts the reviewer sub-tabs for a single request:
 *   - Find       : placeholder in Phase 2 (the Find panel + applicant-reviewer
 *                  ingestion land in Phase 3 — see the build plan). For now it
 *                  points staff at the standalone Reviewer Finder.
 *   - Invite     : accepted reviewers awaiting materials.
 *   - Track      : reviewers in flight (materials sent → review received).
 *   - Completed  : reviewers whose review is complete.
 *
 * Reviewer data comes from the existing Review Manager GET, scoped to one
 * request via `?proposalId=<guid>` (accepted reviewers only — the same set the
 * Review Manager manages). The Invite/Track/Completed panels reuse the shared
 * ReviewerManagePanel; `mode` selects which status slice each shows.
 *
 * Sub-tab selection is query-string driven (`?tab=reviewers&sub=invite`) for
 * deep-links; default landing is state-aware.
 *
 * Props:
 *   - requestId : the akoya_request GUID
 *   - context   : light request context from resolve-request (title, etc.)
 *   - canManage : soft UI gate passed through to the panel (cosmetic; the
 *                 reused server APIs stay org-open)
 *   - settings  : { signature } for the email templates
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { Card } from '../Layout';
import ReviewerManagePanel from './ReviewerManagePanel';
import { SubTabBadge, countForMode, workRemainingForMode } from './SubTabBadges';

const SUB_TABS = [
  { key: 'find', label: 'Find' },
  { key: 'invite', label: 'Invite' },
  { key: 'track', label: 'Track' },
  { key: 'completed', label: 'Completed' },
];
const SUB_TAB_KEYS = new Set(SUB_TABS.map((t) => t.key));

// State-aware default: drop staff where the open work is. If reviewers have
// accepted but aren't out yet → Invite; if any are in flight → Track; if some
// are done and nothing is pending → Completed; otherwise (no reviewers) Find.
function computeDefaultSub(reviewers) {
  if (workRemainingForMode(reviewers, 'invite') > 0) return 'invite';
  if (countForMode(reviewers, 'track') > 0) return 'track';
  if (countForMode(reviewers, 'completed') > 0) return 'completed';
  if (countForMode(reviewers, 'invite') > 0) return 'invite';
  return 'find';
}

export default function ReviewersTab({ requestId, context, canManage = true, settings = {} }) {
  const router = useRouter();
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reviewers = proposal?.reviewers || [];

  const subParam = typeof router.query.sub === 'string' ? router.query.sub : null;
  const activeSub = subParam && SUB_TAB_KEYS.has(subParam) ? subParam : null;

  const loadReviewers = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/review-manager/reviewers?proposalId=${encodeURIComponent(requestId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to load reviewers (${res.status})`);
      }
      setProposal((data.proposals && data.proposals[0]) || null);
    } catch (e) {
      setError(e.message);
      setProposal(null);
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadReviewers();
  }, [loadReviewers]);

  const selectSub = (key) => {
    router.push(
      { pathname: router.pathname, query: { ...router.query, sub: key } },
      undefined,
      { shallow: true },
    );
  };

  // When the URL names no sub-tab, land on a state-aware default (computed, not
  // a redirect — so the choice stays implicit until the user clicks). While the
  // fetch is in flight we don't guess.
  const current = activeSub || (loading ? null : computeDefaultSub(reviewers));

  // A synthetic proposal so the panel can render its empty state even before any
  // reviewer has accepted (the GET returns no projection until then) and even
  // when request context didn't load — keyed on requestId, which is always
  // present. Never null, so the manage panels never render blank (Codex S209).
  const panelProposal = proposal || {
    proposalId: (context && context.requestId) || requestId || null,
    proposalTitle: (context && context.title)
      || (context && context.requestNumber ? `Request ${context.requestNumber}` : 'Request'),
    reviewDeadline: null,
    reviewers: [],
  };

  return (
    <div className="space-y-4">
      {/* Sub-tab strip */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {SUB_TABS.map((t) => {
            const isManage = t.key !== 'find';
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => selectSub(t.key)}
                className={`flex items-center px-4 py-2 text-sm font-medium border-b-2 ${
                  current === t.key
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
                {isManage && (
                  <SubTabBadge
                    count={countForMode(reviewers, t.key)}
                    workRemaining={workRemainingForMode(reviewers, t.key)}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {error && (
        <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
          Couldn’t load reviewers: {error}
        </div>
      )}

      {current === null ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
        </div>
      ) : current === 'find' ? (
        <Card hover={false}>
          <p className="font-medium text-gray-900 mb-1">Find reviewers</p>
          <p className="text-sm text-gray-600">
            Searching for candidates and ingesting applicant-recommended reviewers
            lands here in a later update. For now, use the standalone Reviewer
            Finder, then return here to invite and track those who accept.
          </p>
        </Card>
      ) : (
        <ReviewerManagePanel
          proposal={panelProposal}
          reviewers={reviewers}
          loading={loading}
          onRefresh={loadReviewers}
          settings={settings}
          mode={current}
          canManage={canManage}
        />
      )}
    </div>
  );
}
