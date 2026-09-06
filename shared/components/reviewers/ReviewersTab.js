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
 * A server-validated manual proposal choice is retained in `?proposalFile=` so
 * the Find document binding survives refresh without becoming file authority.
 *
 * Props:
 *   - requestId : the akoya_request GUID
 *   - context   : light request context from resolve-request (title, etc.)
 *   - canManage : UI display gate for request-owner controls. Mutation
 *                 routes independently enforce their applicable server policy.
 *   - settings  : { signature } for the email templates
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

// How long a confirmed-invite overlay is allowed to stand before a plain
// refetch repaints pure server truth. The overlay asserts a PAST fact (the
// send stamp existed when the send stream confirmed it), so a concurrent
// lifecycle reset landing inside the refresh window — remove → restore clears
// wmkf_invited (ENGAGEMENT_STAMP_RESET) — would otherwise be repainted as
// invited until the next incidental refresh (Codex S401 adversarial finding).
// Time-bounding the overlay closes that for EVERY resetting writer, current or
// future, without version-plumbing the send stream and roster DTO.
const OVERLAY_RECONCILE_MS = 4000;

export default function ReviewersTab({
  requestId,
  context,
  canManage = true,
  settings = {},
  previewReadOnly = false,
}) {
  const router = useRouter();
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [removedCandidates, setRemovedCandidates] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [declineReferrals, setDeclineReferrals] = useState([]);
  // The parent currently keys ReviewersTab by requestId, which remounts it across
  // request navigations. Keep the in-flight guards below as defense in depth:
  // they also prevent a late response from painting stale data if the parent
  // keying contract changes or a request is reloaded in place.
  const currentRequestIdRef = useRef(requestId);
  currentRequestIdRef.current = requestId;
  // Same-request overlap guards: two in-flight calls to the SAME loader (e.g. a
  // mutation refresh racing a mount/prior refresh) must resolve newest-wins —
  // without this, a slower stale response repaints over the fresh one. The
  // requestId ref above only covers cross-request navigation.
  const candidatesGenRef = useRef(0);
  const reviewersGenRef = useRef(0);
  const referralsGenRef = useRef(0);
  // Pending overlay-reconcile timer (see OVERLAY_RECONCILE_MS). Cleared on
  // unmount so a late firing can't set state on a dead component; a firing
  // that outlives a request navigation is already dropped by the loader's
  // requestId guard.
  const reconcileTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(reconcileTimerRef.current), []);
  // Per-referral inline action state for the Track Reviewers decline-referral
  // callout, keyed by the per-item referralId (with suggestionId as a legacy
  // fallback). Drives structured add/identity confirmation and per-referral
  // dismissal without conflating those workflows.
  const [referralActions, setReferralActions] = useState({});
  const canEdit = canManage && !previewReadOnly;

  const reviewers = proposal?.reviewers || [];
  const findSavedPool = useMemo(() => [
    ...candidates,
    ...removedCandidates.filter((candidate) => (
      candidate?.declined || candidate?.responseType === 'declined'
    )),
  ], [candidates, removedCandidates]);
  // Candidates badge: saved candidates not yet invited (and not accepted/declined).
  const candidatesToInvite = candidates.filter((c) => !c.invited && !c.accepted && !c.declined).length;

  const subParam = typeof router.query.sub === 'string' ? router.query.sub : null;
  const normalizedSubParam = subParam === 'invite' || subParam === 'completed' ? 'track' : subParam;
  const activeSub = normalizedSubParam && SUB_TAB_KEYS.has(normalizedSubParam) ? normalizedSubParam : null;
  const proposalFileKey = typeof router.query.proposalFile === 'string'
    ? router.query.proposalFile
    : null;
  const repairCandidateKey = typeof router.query.repairCandidate === 'string'
    ? router.query.repairCandidate
    : null;
  const repairSuggestionId = typeof router.query.repairSuggestion === 'string'
    ? router.query.repairSuggestion
    : null;

  // A deliberate proposal override is navigation state, not component memory.
  // The Find loader still revalidates this opaque key against the request's
  // server-listed SharePoint files before it can download or analyze anything.
  const persistProposalFileKey = useCallback((fileKey) => {
    const query = { ...router.query };
    if (fileKey) query.proposalFile = fileKey;
    else delete query.proposalFile;
    router.replace(
      { pathname: router.pathname, query },
      undefined,
      { shallow: true },
    );
  }, [router]);

  const loadReviewers = useCallback(async () => {
    if (!requestId) return;
    const rid = requestId;
    const gen = ++reviewersGenRef.current;
    const isCurrent = () => rid === currentRequestIdRef.current && gen === reviewersGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/review-manager/reviewers?proposalId=${encodeURIComponent(rid)}`);
      const data = await res.json().catch(() => ({}));
      if (!isCurrent()) return; // request changed or a newer load superseded this one
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to load reviewers (${res.status})`);
      }
      setProposal((data.proposals && data.proposals[0]) || null);
    } catch (e) {
      if (isCurrent()) {
        setError(e.message);
        // A transient refetch error must not blank the panel or invalidate an
        // open materials-modal session for the same request (Stage 6B3d) — keep
        // the last committed proposal when it belongs to this request. A
        // proposal from another request is still dropped.
        setProposal((prev) => (prev && prev.proposalId === rid ? prev : null));
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadReviewers();
  }, [loadReviewers]);

  // Saved-candidate roster (all selected suggestion rows for the request,
  // regardless of accepted) — the data behind the Candidates tab + its badge.
  // confirmedInvites = { invitedSuggestionIds, sentAt } | null. When present
  // (post-invite-send refresh), those rows are painted invited on top of the
  // refetched roster: the send stream already confirmed their wmkf_invited
  // stamp committed, so the overlay is server-confirmed fact — not optimism —
  // and a read that lags the just-committed write can't re-render the rows as
  // still invitable (S400 finding 2).
  const loadCandidates = useCallback(async (confirmedInvites = null) => {
    if (!requestId) return;
    const rid = requestId;
    const gen = ++candidatesGenRef.current;
    const isCurrent = () => rid === currentRequestIdRef.current && gen === candidatesGenRef.current;
    setCandidatesLoading(true);
    try {
      const res = await fetch(`/api/reviewer-finder/my-candidates?requestId=${encodeURIComponent(rid)}`);
      const data = await res.json().catch(() => ({}));
      if (!isCurrent()) return; // request changed or a newer load superseded this one
      const prop = (data.proposals && data.proposals[0]) || null;
      const rows = (prop && prop.candidates) || [];
      const removed = (prop && prop.removedCandidates) || [];
      let next = Array.isArray(rows) ? rows : [];
      if (confirmedInvites) {
        const ids = new Set(confirmedInvites.invitedSuggestionIds);
        next = next.map((c) => (ids.has(c.suggestionId)
          ? { ...c, invited: true, emailSentAt: c.emailSentAt || confirmedInvites.sentAt || null }
          : c));
      }
      setCandidates(next);
      if (confirmedInvites) {
        // Server truth unconditionally reasserts shortly after the overlay
        // actually paints. Starting this clock earlier would let a slow
        // overlay-carrying response lose the newest-generation guard to its
        // own reconciling refetch before the confirmed invite can render.
        clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = setTimeout(() => loadCandidates(), OVERLAY_RECONCILE_MS);
      }
      setRemovedCandidates(Array.isArray(removed) ? removed : []);
    } catch {
      if (isCurrent()) {
        setCandidates([]);
        setRemovedCandidates([]);
      }
    } finally {
      if (isCurrent()) setCandidatesLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // Decline-referrals: names a declining reviewer suggested on the external
  // portal (captured to wmkf_declinereferral). Read via a dedicated endpoint so
  // it surfaces even when no reviewer has accepted yet (the review-manager GET
  // early-returns in that case). Fail-soft: an empty list on any error.
  const loadDeclineReferrals = useCallback(async () => {
    if (!requestId) return;
    const rid = requestId;
    const gen = ++referralsGenRef.current;
    const isCurrent = () => rid === currentRequestIdRef.current && gen === referralsGenRef.current;
    try {
      const res = await fetch(`/api/workbench/decline-referrals?requestId=${encodeURIComponent(rid)}`);
      const data = await res.json().catch(() => ({}));
      if (!isCurrent()) return; // request changed or a newer load superseded this one
      setDeclineReferrals(res.ok && Array.isArray(data.referrals) ? data.referrals : []);
    } catch {
      if (isCurrent()) setDeclineReferrals([]);
    }
  }, [requestId]);

  useEffect(() => {
    // Clear immediately on request change so a slow fetch can't leave the prior
    // request's referrals visible while the new one loads.
    setDeclineReferrals([]);
    loadDeclineReferrals();
  }, [loadDeclineReferrals]);

  // Refresh BOTH data sources after any mutation. An accepted reviewer appears in
  // both the Candidates roster (my-candidates) and the Invite/Track lists
  // (review-manager/reviewers); removing/editing/inviting from one surface must
  // refresh the other or the untouched tab shows stale state (Codex S213: removing
  // an accepted candidate refreshed only the candidates list, leaving the Invite
  // tab still showing the removed reviewer).
  // Accepts an optional { invitedSuggestionIds, sentAt } payload from the
  // post-invite-send path (see loadCandidates). refreshAll is handed around as a
  // bare callback (onSaved/onRefresh/onClick), so anything that isn't that exact
  // shape — click events included — is ignored rather than trusted.
  const refreshAll = useCallback((confirmedInvites) => {
    const overlay = confirmedInvites
      && Array.isArray(confirmedInvites.invitedSuggestionIds)
      && confirmedInvites.invitedSuggestionIds.length > 0
      ? { invitedSuggestionIds: confirmedInvites.invitedSuggestionIds, sentAt: confirmedInvites.sentAt || null }
      : null;
    loadCandidates(overlay);
    loadReviewers();
    loadDeclineReferrals();
  }, [loadCandidates, loadReviewers, loadDeclineReferrals]);

  const selectSub = (key) => {
    router.push(
      { pathname: router.pathname, query: { ...router.query, sub: key } },
      undefined,
      { shallow: true },
    );
  };

  // "Add as candidate" on a decline referral: add the suggested person straight
  // into this request's candidate pool in place (no tab hop). The server
  // resolves identity itself — a confident match or a clearly-new person is
  // added immediately; an ambiguous/conflicting identity returns 409 + `lookup`,
  // which we surface as an inline picker on the referral row (staff confirm → we
  // re-POST with the chosen resolution). Every structured row also has an exact
  // dismissal action. Legacy free-text suggestions are never submitted as one
  // person's name and retain their note-level dismissal action.
  // On success we refresh both lists and land on
  // the Invite Reviewers sub-tab where the new candidate now appears.
  const addReferralCandidate = async (referral, resolution) => {
    if (!canEdit) return;
    const sid = referral?.suggestionId;
    const actionKey = referral?.referralId || sid;
    if (referral?.legacy) return;
    const name = (referral?.referralName || '').trim();
    if (!sid || !name || !requestId) return;
    const rid = requestId;
    setReferralActions((prev) => ({ ...prev, [actionKey]: { status: 'adding' } }));
    try {
      const res = await fetch('/api/workbench/manual-reviewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: rid,
          name,
          email: referral?.email || undefined,
          affiliation: referral?.institution || undefined,
          // The source row is known to be a reviewer decline even if its linked
          // person display-name read failed. Keep durable `referred` provenance
          // in that rare case instead of silently downgrading to staff_manual.
          referredBy: referral?.reviewerName || 'Declining reviewer',
          resolution: resolution || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (rid !== currentRequestIdRef.current) return; // request changed mid-flight — drop stale result
      if (res.ok && data.success) {
        if (['promotion_required', 'restore_required', 'already_handled'].includes(data.outcome)) {
          setReferralActions((prev) => ({
            ...prev,
            [actionKey]: {
              status: 'remedy',
              outcome: data.outcome,
              remedy: data.remedy,
              suggestionId: data.suggestionId,
              stage: data.stage,
            },
          }));
          refreshAll();
          return;
        }
        setReferralActions((prev) => ({
          ...prev,
          [actionKey]: {
            status: 'added',
            addedName: data.candidate?.name || name,
            invitable: !!data.candidate?.invitable,
          },
        }));
        refreshAll();
        selectSub('candidates'); // land on Invite Reviewers, where the new row shows
        return;
      }
      if (res.status === 409 && data.lookup) {
        setReferralActions((prev) => ({ ...prev, [actionKey]: { status: 'confirm', lookup: data.lookup } }));
        return;
      }
      const message = data.code === 'applicant_excluded'
        ? 'This person is excluded for this request.'
        : (data.error || `Couldn’t add (${res.status}).`);
      setReferralActions((prev) => ({ ...prev, [actionKey]: { status: 'error', error: message } }));
    } catch (e) {
      if (rid !== currentRequestIdRef.current) return;
      setReferralActions((prev) => ({ ...prev, [actionKey]: { status: 'error', error: e.message } }));
    }
  };

  const dismissDeclineReferral = async (referral) => {
    if (!canEdit) return;
    const sid = referral?.suggestionId;
    const actionKey = referral?.referralId || sid;
    if (!sid || !requestId) return;
    if (!referral?.dismissible || !referral?.referralVersion) return;
    if (!referral?.legacy && !Number.isInteger(referral?.referralIndex)) return;
    const rid = requestId;
    setReferralActions((prev) => ({ ...prev, [actionKey]: { status: 'dismissing' } }));
    try {
      const res = await fetch('/api/workbench/decline-referrals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: rid,
          suggestionId: sid,
          referralVersion: referral.referralVersion,
          ...(!referral?.legacy ? { referralIndex: referral.referralIndex } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (rid !== currentRequestIdRef.current) return;
      if (!res.ok || !data.success) {
        setReferralActions((prev) => ({
          ...prev,
          [actionKey]: {
            status: 'error',
            operation: 'dismiss',
            error: data.error || `Couldn’t dismiss the referral (${res.status}).`,
          },
        }));
        return;
      }
      setReferralActions((prev) => ({ ...prev, [actionKey]: { status: 'dismissed' } }));
      loadDeclineReferrals();
    } catch (error) {
      if (rid !== currentRequestIdRef.current) return;
      setReferralActions((prev) => ({
        ...prev,
        [actionKey]: { status: 'error', operation: 'dismiss', error: error.message },
      }));
    }
  };

  const dismissReferralAction = (sid) => {
    setReferralActions((prev) => {
      if (!(sid in prev)) return prev;
      const next = { ...prev };
      delete next[sid];
      return next;
    });
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
                  // Track Reviewers folds in pending decline-referrals so the tab
                  // signals them (amber) even when no reviewer has accepted yet —
                  // otherwise the badge reads 0 and staff never open the tab where
                  // the referral callout lives (the all-declined-before-accept case).
                  <SubTabBadge
                    count={countForMode(reviewers, t.key) + (t.key === 'track' ? declineReferrals.length : 0)}
                    workRemaining={workRemainingForMode(reviewers, t.key) + (t.key === 'track' ? declineReferrals.length : 0)}
                  />
                ) : null}
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => setCampaignOpen(true)}
          disabled={!canEdit}
          className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40"
          title={previewReadOnly
            ? 'Campaign settings are disabled in read-only Preview'
            : !canManage
              ? 'Only the lead Program Director or a superuser can edit campaign settings'
            : "Edit this request's reviewer campaign settings (days to respond, review due date)"}
        >
          ⚙ Campaign settings
        </button>
        <button
          type="button"
          onClick={() => setTemplatesOpen(true)}
          disabled={previewReadOnly}
          className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40"
          title={previewReadOnly
            ? 'Email templates are disabled in read-only Preview'
            : 'Edit your default reviewer email templates'}
        >
          ✎ Email templates
        </button>
        {previewReadOnly ? (
          <span
            className="px-1 py-1 text-xs text-gray-400 opacity-40 whitespace-nowrap"
            title="Template management is disabled in read-only Preview"
            aria-disabled="true"
          >
            Manage in Profile →
          </span>
        ) : (
          <Link
            href="/profile-settings"
            className="text-xs text-gray-400 hover:text-gray-700 px-1 py-1 whitespace-nowrap"
            title="Manage all your email templates in Profile Settings"
          >
            Manage in Profile →
          </Link>
        )}
      </div>

      {templatesOpen && !previewReadOnly && <EmailTemplatesModal onClose={() => setTemplatesOpen(false)} />}
      {campaignOpen && requestId && canEdit && (
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
          canManage={canEdit}
          proposalFileKey={proposalFileKey}
          proposalBindingReady={router.isReady !== false}
          onProposalFileKeyChange={persistProposalFileKey}
          savedPool={findSavedPool}
          onSaved={refreshAll}
          onNavigate={selectSub}
          repairCandidateKey={repairCandidateKey}
        />
      ) : current === 'candidates' ? (
        <ReviewerInvitePanel
          requestId={requestId}
          candidates={candidates}
          removedCandidates={removedCandidates}
          loading={candidatesLoading}
          onRefresh={refreshAll}
          settings={settings}
          canManage={canEdit}
          repairSuggestionId={repairSuggestionId}
        />
      ) : (
        <ReviewerManagePanel
          proposal={panelProposal}
          reviewers={reviewers}
          loading={loading}
          onRefresh={refreshAll}
          settings={settings}
          mode={current}
          canManage={canEdit}
          showReviewReminderAction={current === 'track'}
          previewReadOnly={previewReadOnly}
          declineReferrals={declineReferrals}
          referralActions={referralActions}
          onAddReferral={addReferralCandidate}
          onDismissDeclineReferral={dismissDeclineReferral}
          onGoToInvite={() => selectSub('candidates')}
          onNavigate={selectSub}
          onDismissReferral={dismissReferralAction}
        />
      )}
    </div>
  );
}
