/**
 * ReviewersTab — the Reviewers tab inside the Request Workbench (tier-3).
 *
 * Hosts the reviewer sub-tabs for a single request:
 *   - Find       : ReviewerFindPanel (Phase 3) — applicant-reviewer ingestion
 *                  (recommended → candidates, excluded → per-request soft-block),
 *                  auto-loaded proposal, and the in-panel reviewer search
 *                  (ReviewerSearchSection: inline analyze→discover→enrich→save).
 *   - Invite Reviewers : saved candidates ready for invitation.
 *   - Track Reviewers  : accepted reviewers across the full post-acceptance
 *                        lifecycle (accepted → complete).
 *
 * Reviewer data comes from the existing Review Manager GET, scoped to one
 * request via `?proposalId=<guid>` (accepted reviewers only — the same set the
 * Review Manager manages). Track Reviewers reuses the shared ReviewerManagePanel
 * with `mode="track"`.
 *
 * Sub-tab selection is query-string driven (`?tab=reviewers&sub=track`) for
 * deep-links; legacy `invite`/`completed` links normalize to Track Reviewers.
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
import Link from 'next/link';
import ReviewerManagePanel from './ReviewerManagePanel';
import ReviewerFindPanel from './ReviewerFindPanel';
import ReviewerInvitePanel from './ReviewerInvitePanel';
import EmailTemplatesModal from './EmailTemplatesModal';
import CampaignConfigModal from './CampaignConfigModal';
import { SubTabBadge } from './SubTabBadges';
import { countForMode, workRemainingForMode, computeDefaultSub } from './reviewer-modes';

const SUB_TABS = [
  { key: 'find', label: 'Find' },
  { key: 'candidates', label: 'Invite Reviewers' },
  { key: 'track', label: 'Track Reviewers' },
];
const SUB_TAB_KEYS = new Set(SUB_TABS.map((t) => t.key));

export default function ReviewersTab({ requestId, context, canManage = true, settings = {} }) {
  const router = useRouter();
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [removedCandidates, setRemovedCandidates] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);

  const reviewers = proposal?.reviewers || [];
  // Candidates badge: saved candidates not yet invited (and not accepted/declined).
  const candidatesToInvite = candidates.filter((c) => !c.invited && !c.accepted && !c.declined).length;

  const subParam = typeof router.query.sub === 'string' ? router.query.sub : null;
  const normalizedSubParam = subParam === 'invite' || subParam === 'completed' ? 'track' : subParam;
  const activeSub = normalizedSubParam && SUB_TAB_KEYS.has(normalizedSubParam) ? normalizedSubParam : null;

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
      const prop = (data.proposals && data.proposals[0]) || null;
      const rows = (prop && prop.candidates) || [];
      const removed = (prop && prop.removedCandidates) || [];
      setCandidates(Array.isArray(rows) ? rows : []);
      setRemovedCandidates(Array.isArray(removed) ? removed : []);
    } catch {
      setCandidates([]);
      setRemovedCandidates([]);
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
          onClick={() => setCampaignOpen(true)}
          className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 whitespace-nowrap"
          title="Edit this request's reviewer campaign settings (days to respond, review due date)"
        >
          ⚙ Campaign settings
        </button>
        <button
          type="button"
          onClick={() => setTemplatesOpen(true)}
          className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 whitespace-nowrap"
          title="Edit your default reviewer email templates"
        >
          ✎ Email templates
        </button>
        <Link
          href="/profile-settings"
          className="text-xs text-gray-400 hover:text-gray-700 px-1 py-1 whitespace-nowrap"
          title="Manage all your email templates in Profile Settings"
        >
          Manage in Profile →
        </Link>
      </div>

      {templatesOpen && <EmailTemplatesModal onClose={() => setTemplatesOpen(false)} />}
      {campaignOpen && requestId && (
        <CampaignConfigModal requestId={requestId} onClose={() => setCampaignOpen(false)} />
      )}

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
        <ReviewerFindPanel
          requestId={requestId}
          context={context}
          canManage={canManage}
          savedPoolNames={candidates.map((c) => c.name).filter(Boolean)}
          onSaved={refreshAll}
        />
      ) : current === 'candidates' ? (
        <ReviewerInvitePanel
          requestId={requestId}
          candidates={candidates}
          removedCandidates={removedCandidates}
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
