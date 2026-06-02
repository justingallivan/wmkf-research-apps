/**
 * ReviewersTab — the Reviewers tab inside the Request Workbench (tier-3).
 *
 * Hosts the reviewer sub-tabs for a single request:
 *   - Find       : ReviewerFindPanel (Phase 3) — applicant-reviewer ingestion
 *                  (recommended → candidates, excluded → per-request soft-block),
 *                  auto-loaded proposal, and the in-panel reviewer search
 *                  (ReviewerSearchSection: inline analyze→discover→enrich→save).
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
import ReviewerManagePanel from './ReviewerManagePanel';
import ReviewerFindPanel from './ReviewerFindPanel';
import CandidatesPanel from './CandidatesPanel';
import EmailTemplatesModal from './EmailTemplatesModal';
import { SubTabBadge } from './SubTabBadges';
import { countForMode, workRemainingForMode, computeDefaultSub } from './reviewer-modes';

const SUB_TABS = [
  { key: 'find', label: 'Find' },
  { key: 'candidates', label: 'Candidates' },
  { key: 'invite', label: 'Invite' },
  { key: 'track', label: 'Track' },
  { key: 'completed', label: 'Completed' },
];
const SUB_TAB_KEYS = new Set(SUB_TABS.map((t) => t.key));

export default function ReviewersTab({ requestId, context, canManage = true, settings = {} }) {
  const router = useRouter();
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const reviewers = proposal?.reviewers || [];
  // Candidates badge: saved candidates not yet invited (and not accepted/declined).
  const candidatesToInvite = candidates.filter((c) => !c.invited && !c.accepted && !c.declined).length;

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

  // Saved-candidate roster (all selected suggestion rows for the request,
  // regardless of accepted) — the data behind the Candidates tab + its badge.
  const loadCandidates = useCallback(async () => {
    if (!requestId) return;
    setCandidatesLoading(true);
    try {
      const res = await fetch(`/api/reviewer-finder/my-candidates?requestId=${encodeURIComponent(requestId)}`);
      const data = await res.json().catch(() => ({}));
      const rows = (data.proposals && data.proposals[0] && data.proposals[0].candidates) || [];
      setCandidates(Array.isArray(rows) ? rows : []);
    } catch {
      setCandidates([]);
    } finally {
      setCandidatesLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // Refresh BOTH data sources after any mutation. An accepted reviewer appears in
  // both the Candidates roster (my-candidates) and the Invite/Track lists
  // (review-manager/reviewers); removing/editing/inviting from one surface must
  // refresh the other or the untouched tab shows stale state (Codex S213: removing
  // an accepted candidate refreshed only the candidates list, leaving the Invite
  // tab still showing the removed reviewer).
  const refreshAll = useCallback(() => {
    loadCandidates();
    loadReviewers();
  }, [loadCandidates, loadReviewers]);

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
      <div className="border-b border-gray-200 flex items-center justify-between">
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
                {t.key === 'candidates' ? (
                  <SubTabBadge count={candidatesToInvite} workRemaining={candidatesToInvite} />
                ) : isManage ? (
                  <SubTabBadge
                    count={countForMode(reviewers, t.key)}
                    workRemaining={workRemainingForMode(reviewers, t.key)}
                  />
                ) : null}
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => setTemplatesOpen(true)}
          className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 whitespace-nowrap"
          title="Edit your default reviewer email templates"
        >
          ✎ Email templates
        </button>
      </div>

      {templatesOpen && <EmailTemplatesModal onClose={() => setTemplatesOpen(false)} />}

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
        <ReviewerFindPanel requestId={requestId} context={context} canManage={canManage} />
      ) : current === 'candidates' ? (
        <CandidatesPanel
          requestId={requestId}
          candidates={candidates}
          loading={candidatesLoading}
          onRefresh={refreshAll}
          settings={settings}
          canManage={canManage}
        />
      ) : (
        <ReviewerManagePanel
          proposal={panelProposal}
          reviewers={reviewers}
          loading={loading}
          onRefresh={refreshAll}
          settings={settings}
          mode={current}
          canManage={canManage}
        />
      )}
    </div>
  );
}
