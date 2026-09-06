/**
 * ReviewerManagePanel — the request-scoped reviewer-management substance.
 *
 * Extracted from `pages/review-manager.js`'s `ProposalDetailTab` (Phase 2 of the
 * Request Workbench build — see `docs/REQUEST_WORKBENCH_BUILD_PLAN.md`). Both the
 * standalone Review Manager page and the Workbench per-request shell render this.
 *
 * The proposal-selector dropdown, the standalone proposal info card, and the
 * per-app signature Settings bar are intentionally NOT here — they stay in the
 * Review Manager page (request context comes from the host in the Workbench).
 *
 * Props:
 *   - proposal   : the request projection ({ proposalId, proposalTitle, reviewDeadline, ... })
 *   - reviewers  : the reviewer rows to manage (already scoped to this request)
 *   - loading    : optional; shows a subtle spinner in the actions bar
 *   - onRefresh  : called after any mutation so the host re-fetches
 *   - settings   : { signature, ... } — feeds the email templates (sender is
 *                  always the signed-in MS account; signature is freeform text)
 *   - mode       : undefined|'all' → every reviewer (Review Manager behavior);
 *                  'track' → Workbench post-acceptance lifecycle sub-tab
 *   - canManage  : UI display gate for request-owner controls. When false,
 *                  write controls are hidden and the table is read-only. Each
 *                  mutation route must enforce its own server authorization;
 *                  this prop is never an authorization boundary.
 *   - showReviewReminderAction : exposes the direct review-due reminder in the
 *                  consolidated follow-up page without changing other hosts.
 *   - previewReadOnly : shows that reminder control disabled so a Preview backed
 *                  by production Dataverse remains visibly fail-closed.
 */

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import ReviewerDueDateEditor from './ReviewerDueDateEditor';
import ReviewerActivityDrawer from './ReviewerActivityDrawer';
import ReviewerCloseoutModal, { closeoutDispositionLabel } from './ReviewerCloseoutModal';
import { latestActivitySummary } from './reviewer-activity-history';
import { acceptedReviewerRemoveWarning } from './remove-reviewer-confirm';
import { Card, Button } from '../Layout';
import {
  getStatusInfo,
  filterByMode,
  canTransitionToTerminal,
} from './reviewer-modes';
import { isGuid } from '../../../lib/utils/guid';
import ReleaseMaterialsModal from './ReleaseMaterialsModal';
import { proposalKeyFor } from './reviewer-draft-keys';
import { TokenActionsMenu, TokenStateBadge } from './TokenActionsMenu';
import { ReviewReminderAction } from './ReviewReminderAction';

// Pure status-pipeline / mode-bucketing logic lives in ./reviewer-modes
// (React-free + unit-tested). Re-export the pipeline so existing importers of
// it from this module keep working.
export { STATUS_PIPELINE, MODE_STATUSES, MODE_WORK_REMAINING, filterByMode } from './reviewer-modes';
export { TokenActionsMenu, TokenStateBadge } from './TokenActionsMenu';
export { ReviewReminderAction } from './ReviewReminderAction';
export { PREVIEW_RENDER_TIMEOUT_MS } from './ReleaseMaterialsModal';

// ─── Template Defaults ──────────────────────────────────────────────────────
// Resolution + per-PD persistence live in email-template-store.js: the org
// default (admin "Email Defaults" panel, Dataverse wmkf_appsystemsetting) with a
// per-PD override layered on top (wmkf_appuserpreferences, EMAIL_TEMPLATES).
// loadEmailTemplates() returns the resolved set; EMPTY_TEMPLATES is the blank
// skeleton used until that load completes.

// ─── Status Badge ───────────────────────────────────────────────────────────

export function StatusBadge({ status }) {
  const info = getStatusInfo(status);
  return (
    <span className={`inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium ${info.color}`}>
      {info.label}
    </span>
  );
}

// ─── Decline-referral inline add helpers ────────────────────────────────────

// Map an identity-lookup match/candidate to the resolution the manual-reviewer
// route expects. A reviewer id reuses the person row; a bare contact id reuses
// the contact. Returns null when neither id is present (nothing to reuse).
function referralResolutionFor(candidate) {
  if (!candidate) return null;
  if (candidate.reviewerId) {
    return { mode: 'reuse_reviewer', reviewerId: candidate.reviewerId, contactId: candidate.contactId || undefined };
  }
  if (candidate.contactId) {
    return { mode: 'reuse_contact', contactId: candidate.contactId };
  }
  return null;
}

function referralContextLine(context) {
  if (!context) return '';
  return [context.email, context.affiliation, context.hasOrcid ? 'ORCID' : null].filter(Boolean).join(' · ');
}

// The compact right-side action for one referral row (structured add/dismiss or
// legacy dismissal). The 'confirm' state renders a full-width picker below —
// see ReferralConfirm — so it is not handled here.
function ReferralAction({ referral, state, canManage, onAdd, onDismiss, onGoToInvite, onNavigate }) {
  const dismiss = referral?.dismissible ? onDismiss : null;
  const status = state?.status;
  if (status === 'adding') {
    return <span className="shrink-0 text-xs text-amber-800">Adding…</span>;
  }
  if (status === 'dismissing') {
    return <span className="shrink-0 text-xs text-amber-800">Dismissing…</span>;
  }
  if (status === 'dismissed') {
    return <span className="shrink-0 text-xs font-medium text-green-700">✓ Dismissed</span>;
  }
  if (status === 'added') {
    return (
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium text-green-700">✓ Added {state.addedName}</p>
        {onGoToInvite && (
          <button type="button" onClick={onGoToInvite} className="text-xs text-amber-900 underline hover:text-amber-950">
            Go to Invite Reviewers →
          </button>
        )}
        {state.invitable === false && (
          <p className="text-xs text-gray-500 mt-0.5">Add an email there to invite.</p>
        )}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="shrink-0 text-right max-w-[16rem]">
        <p className="text-xs text-red-700">{state.error}</p>
        {canManage && (state.operation === 'dismiss' ? dismiss : onAdd) && (
          <button
            type="button"
            onClick={() => (state.operation === 'dismiss' ? dismiss(referral) : onAdd(referral))}
            className="text-xs text-amber-900 underline"
          >
            Try again
          </button>
        )}
      </div>
    );
  }
  if (status === 'remedy') {
    const target = state.outcome === 'promotion_required'
      ? 'find'
      : state.outcome === 'restore_required' || state.stage === 'selected'
        ? 'candidates'
        : 'track';
    const targetLabel = target === 'find'
      ? 'Open Find'
      : state.outcome === 'restore_required'
        ? 'Open Removed'
        : target === 'candidates'
          ? 'Open Invite'
          : 'Open Track';
    return (
      <div className="shrink-0 text-right max-w-[18rem]">
        <p className="text-xs font-medium text-amber-800">Already known to this request</p>
        <p className="text-xs text-amber-700">{state.remedy}</p>
        {onNavigate && (
          <button type="button" onClick={() => onNavigate(target)} className="text-xs text-amber-900 underline">
            {targetLabel}
          </button>
        )}
      </div>
    );
  }
  if (!canManage) return null;
  if (referral.legacy) {
    return dismiss ? (
      <button
        type="button"
        onClick={() => dismiss(referral)}
        className="shrink-0 text-xs font-medium text-amber-900 border border-amber-300 rounded-md px-2 py-1 hover:bg-amber-100"
      >
        Dismiss resolved note
      </button>
    ) : null;
  }
  if (!onAdd && !dismiss) return null;
  return (
    <div className="shrink-0 flex flex-wrap items-center justify-end gap-2">
      {dismiss && (
        <button
          type="button"
          onClick={() => dismiss(referral)}
          className="text-xs font-medium text-gray-600 border border-gray-300 rounded-md px-2 py-1 hover:bg-gray-50"
        >
          Dismiss
        </button>
      )}
      {onAdd && (
        <button
          type="button"
          onClick={() => onAdd(referral)}
          className="text-xs font-medium text-amber-900 border border-amber-300 rounded-md px-2 py-1 hover:bg-amber-100"
        >
          Add as candidate
        </button>
      )}
    </div>
  );
}

// Full-width identity-confirm picker shown when the server couldn't confidently
// resolve the suggested name (409 + lookup). Staff pick the right existing
// person or add as new; a free-text suggestion is never auto-resolved to a
// namesake.
function ReferralConfirm({ referral, lookup, onChoose, onCancel }) {
  const options = [];
  if (lookup?.outcome === 'confident' && lookup.match) options.push(lookup.match);
  if (lookup?.outcome === 'candidates') options.push(...(lookup.candidates || []));
  return (
    <div className="mt-2 border border-amber-200 bg-amber-50 rounded p-2 text-sm">
      <p className="font-medium text-amber-900">
        Confirm who “{referral.referralName || referral.referralText}” is before adding
      </p>
      {lookup?.outcome === 'conflict' && (
        <p className="text-xs text-red-700 mt-1">
          Existing records disagree ({lookup.reason}). Add as a new person only if this is someone different.
        </p>
      )}
      {options.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {options.map((c, idx) => {
            const resolution = referralResolutionFor(c);
            if (!resolution) return null;
            const ctx = referralContextLine(c.context);
            return (
              <button
                key={`${c.source || 'match'}-${c.reviewerId || c.contactId || idx}`}
                type="button"
                onClick={() => onChoose(resolution)}
                className="w-full text-left border border-amber-200 bg-white rounded p-2 hover:border-amber-400"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">{c.context?.name || 'Existing person'}</span>
                  <span className="text-xs text-gray-500">
                    {c.source || 'match'}{c.matchKey ? ` · ${c.matchKey}` : ''}{c.context?.active === false ? ' · inactive' : ''}
                  </span>
                </span>
                {ctx && <span className="block text-xs text-gray-600 mt-0.5">{ctx}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChoose({ mode: 'create_new' })}
          className="text-xs font-medium text-amber-900 border border-amber-300 rounded px-2 py-1 bg-white hover:bg-amber-100"
        >
          Add as new person
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Reviewer Manage Panel ──────────────────────────────────────────────────

export default function ReviewerManagePanel({
  proposal,
  reviewers: reviewersProp,
  loading = false,
  onRefresh,
  settings = {},
  mode,
  canManage = true,
  showReviewReminderAction = false,
  previewReadOnly = false,
  degraded = false,
  declineReferrals = [],
  referralActions = {},
  onAddReferral,
  onDismissDeclineReferral,
  onGoToInvite,
  onNavigate,
  onDismissReferral,
}) {
  const [selectedReviewers, setSelectedReviewers] = useState(new Set());
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [activityDrawerId, setActivityDrawerId] = useState(null); // suggestionId
  const [closeoutReviewerId, setCloseoutReviewerId] = useState(null); // suggestionId
  // Stage 6B3: the one-use completion-cause the ReleaseMaterialsModal hands
  // back after a send finishes, so its own session effect can recognize the
  // selection-clear THIS attempt caused (and not reset the summary it just
  // showed) while still invalidating for any other selection change. Set
  // synchronously BEFORE the selection clear below; cleared in every OTHER
  // selection setter path so a cause never outlives its own transition.
  const selectionCauseRef = useRef(null);

  const allReviewers = reviewersProp || proposal?.reviewers || [];
  const reviewers = filterByMode(allReviewers, mode);

  // The mutex belongs to this mounted panel, not the server or other panels.
  // Invalidating feedback never releases an in-flight write: A → B → A and a
  // disappearing/returning row must still wait for the original attempt.
  const statusOperationsRef = useRef(new Map());
  const statusContextRef = useRef({ mounted: false, epoch: 0 });
  const [pendingStatusTokens, setPendingStatusTokens] = useState(() => new Map());
  // Stage 6B1: feedback-ownership registry for the token/removal/terminal
  // actions below. One entry per `${kind}:${suggestionId}` key holding the
  // latest attempt for that action+row; a newer call for the same key simply
  // replaces the map entry, which is how an older attempt gets superseded
  // (checked via token identity in isAttemptCurrent) without cancelling or
  // repeating its already-dispatched request. `valid` is flipped permanently
  // false by the two layout effects below on unmount or observed row absence,
  // the same way statusOperationsRef's operations are — this is required
  // because a row that disappears and returns would otherwise look current
  // again by the time an attempt settles.
  const actionAttemptsRef = useRef(new Map());

  useLayoutEffect(() => {
    const context = statusContextRef.current;
    const operations = statusOperationsRef.current;
    const attempts = actionAttemptsRef.current;
    context.mounted = true;
    return () => {
      context.mounted = false;
      context.epoch += 1;
      for (const operation of operations.values()) operation.valid = false;
      for (const attempt of attempts.values()) attempt.valid = false;
    };
  }, []);

  // Reconcile only committed props. Object/callback replacement is ordinary
  // refresh behavior; request/mode/permission changes and observed row absence
  // permanently invalidate feedback, even if those values later return.
  useLayoutEffect(() => {
    const context = statusContextRef.current;
    if (context.requestId !== proposal?.proposalId || context.mode !== mode
        || context.canManage !== canManage || context.previewReadOnly !== previewReadOnly) {
      context.epoch += 1;
    }
    context.requestId = proposal?.proposalId;
    context.mode = mode;
    context.canManage = canManage;
    context.previewReadOnly = previewReadOnly;
    context.reviewers = new Map(reviewers.map(row => [row.suggestionId, row]));
    context.onRefresh = onRefresh;
    for (const operation of statusOperationsRef.current.values()) {
      if (operation.epoch !== context.epoch || !context.reviewers.has(operation.suggestionId)) {
        operation.valid = false;
      }
    }
    for (const attempt of actionAttemptsRef.current.values()) {
      if (attempt.epoch !== context.epoch || !context.reviewers.has(attempt.suggestionId)) {
        attempt.valid = false;
      }
    }
  });

  // Capture stable requestId/suggestionId/kind/epoch and a unique attempt
  // token BEFORE the caller's first await. Returns null (caller must no-op)
  // when the row is already gone or the committed context cannot currently
  // accept a mutation — this is the "revalidate after confirm() before
  // dispatch" checkpoint for revoke/remove/terminal, since beginAttempt is
  // always called only after confirm() has returned.
  const beginAttempt = (kind, suggestionId) => {
    const context = statusContextRef.current;
    const row = context.reviewers.get(suggestionId);
    if (!context.mounted || !context.canManage || context.previewReadOnly || !row) return null;
    const attempt = {
      token: Symbol(kind),
      kind,
      suggestionId,
      requestId: context.requestId,
      epoch: context.epoch,
      valid: true,
    };
    actionAttemptsRef.current.set(`${kind}:${suggestionId}`, attempt);
    return attempt;
  };

  // Currentness checkpoint: same-context row/callback replacement stays
  // valid; request/mode/permission change (epoch bump), observed row
  // absence (attempt.valid flipped by the effects above) and a superseding
  // later attempt for the same action+row (token mismatch in the registry)
  // all invalidate.
  const isAttemptCurrent = (attempt) => {
    const context = statusContextRef.current;
    return Boolean(attempt) && attempt.valid && context.mounted
      && context.epoch === attempt.epoch && context.requestId === attempt.requestId
      && context.canManage && !context.previewReadOnly
      && context.reviewers.has(attempt.suggestionId)
      && actionAttemptsRef.current.get(`${attempt.kind}:${attempt.suggestionId}`)?.token === attempt.token;
  };

  const finishAttempt = (attempt) => {
    const key = `${attempt.kind}:${attempt.suggestionId}`;
    if (actionAttemptsRef.current.get(key)?.token === attempt.token) {
      actionAttemptsRef.current.delete(key);
    }
  };

  // Reset selection when the proposal OR the active mode changes — a
  // selection made under one sub-tab shouldn't leak into another's visible set.
  useEffect(() => {
    selectionCauseRef.current = null;
    setSelectedReviewers(new Set());
  }, [proposal?.proposalId, mode]);

  // The open drawer is a pure projection of the CURRENT row, looked up fresh each
  // render, so a re-fetch after a row mutation flows straight into it — that is the
  // "refresh" half of the Phase 1 staleness policy. The only case left is the row
  // vanishing (removed, or filtered out by a mode/status change), which closes it.
  const activityReviewer = activityDrawerId
    ? reviewers.find(r => r.suggestionId === activityDrawerId) || null
    : null;
  const closeoutReviewer = closeoutReviewerId
    ? reviewers.find(r => r.suggestionId === closeoutReviewerId) || null
    : null;

  useEffect(() => {
    if (activityDrawerId && !activityReviewer) setActivityDrawerId(null);
  }, [activityDrawerId, activityReviewer]);

  const acceptedReviewers = reviewers.filter(r => r.reviewStatus === 'accepted');
  const selectedList = acceptedReviewers.filter(r => selectedReviewers.has(r.suggestionId));
  const showSelectionColumn = canManage && acceptedReviewers.length > 0;
  const allSelected = showSelectionColumn
    && acceptedReviewers.every(r => selectedReviewers.has(r.suggestionId));
  const showFollowUpColumn = showReviewReminderAction;
  const showActionsColumn = canManage;
  const showActionColumn = showFollowUpColumn || showActionsColumn;
  const reviewerColumnWidth = showActionColumn
    ? showSelectionColumn ? 'w-[30%]' : 'w-[34%]'
    : 'w-[38%]';
  const tableMinWidth = showActionColumn ? 'min-w-[58rem]' : 'min-w-[48rem]';

  const toggleSelectAll = () => {
    selectionCauseRef.current = null;
    if (allSelected) {
      setSelectedReviewers(new Set());
    } else {
      setSelectedReviewers(new Set(acceptedReviewers.map(r => r.suggestionId)));
    }
  };

  const toggleSelect = (id) => {
    selectionCauseRef.current = null;
    setSelectedReviewers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── External-link lifecycle actions ─────────────────────────────────────
  // These hit the Phase 5 staff endpoints. All are no-ops in dev when the
  // suggestion has never had a token minted (regenerate is the entry point);
  // revoke + mark-received are 404-tolerant on the backend.
  const handleRegenerateToken = async (suggestionId) => {
    const attempt = beginAttempt('regenerate', suggestionId);
    if (!attempt) return;
    const isCurrent = () => isAttemptCurrent(attempt);
    try {
      let resp;
      try {
        resp = await fetch('/api/review-manager/regenerate-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suggestionId }),
        });
      } catch (err) {
        if (isCurrent()) alert(`Network error generating link: ${err.message}`);
        return;
      }
      if (!isCurrent()) return;
      const data = await resp.json().catch(() => ({}));
      if (!isCurrent()) return;
      if (!resp.ok || !data.ok) {
        alert(`Could not generate a new link: ${data.reason || resp.status}`);
        return;
      }
      // A new token already exists server-side at this point (mintAndStore
      // persists before the route responds). If we've gone stale, we must
      // never copy or display it — but there is nothing to roll back either.
      if (!isCurrent()) return;
      let copied = false;
      try {
        await navigator.clipboard.writeText(data.url);
        copied = true;
      } catch {
        // Clipboard can fail on insecure contexts — show the URL anyway.
        copied = false;
      }
      // A copy that already started cannot be cancelled by navigation, but we
      // can still suppress the alert/prompt/refresh that would follow it.
      if (!isCurrent()) return;
      if (copied) {
        alert(`Link copied to clipboard. Expires ${new Date(data.expiresAt).toLocaleDateString()}.`);
      } else {
        prompt('Reviewer link (copy manually):', data.url);
      }
      const currentOnRefresh = statusContextRef.current.onRefresh;
      if (currentOnRefresh) {
        try {
          await currentOnRefresh();
        } catch {
          if (isCurrent()) {
            alert('The link was generated, but the reviewer list could not be refreshed. Reload to see the current list.');
          }
        }
      }
    } finally {
      finishAttempt(attempt);
    }
  };

  const handleRevokeToken = async (suggestionId) => {
    if (!confirm('Revoke this reviewer\'s magic link? They will no longer be able to use it.')) return;
    // Revalidate after confirm() and before dispatch: beginAttempt reads the
    // current committed context, so a row/permission/request change while the
    // confirm dialog was open makes it return null and we no-op.
    const attempt = beginAttempt('revoke', suggestionId);
    if (!attempt) return;
    const isCurrent = () => isAttemptCurrent(attempt);
    try {
      let resp;
      try {
        resp = await fetch('/api/review-manager/revoke-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suggestionId }),
        });
      } catch (err) {
        if (isCurrent()) alert(`Network error: ${err.message}`);
        return;
      }
      if (!isCurrent()) return;
      const data = await resp.json().catch(() => ({}));
      if (!isCurrent()) return;
      if (!resp.ok || !data.ok) {
        alert(`Revoke failed: ${data.reason || resp.status}`);
        return;
      }
      const currentOnRefresh = statusContextRef.current.onRefresh;
      if (currentOnRefresh) {
        try {
          await currentOnRefresh();
        } catch {
          if (isCurrent()) {
            alert('The link was revoked, but the reviewer list could not be refreshed. Reload to see the current list.');
          }
        }
      }
    } finally {
      finishAttempt(attempt);
    }
  };

  // Remove a reviewer from THIS request. The my-candidates DELETE endpoint is
  // server-authoritative (S213, Codex BUG-1 fix): it revokes any live magic link
  // FIRST, then soft-deletes (sets the suggestion wmkf_selected=false). It never
  // touches the global wmkf_potentialreviewer person / promoted contact, which
  // are reused across requests; the engagement row + its history are preserved,
  // just dropped from the request's lists. Doing the revoke server-side means we
  // don't rely on a stale client tokenState to decide whether a link needs
  // killing — `hasLiveLink` here only tailors the confirm wording. A revoke
  // failure on the server fails the whole DELETE (non-ok), so the row is kept and
  // we never leave an unselected row with a live link.
  const handleRemoveReviewer = async (reviewer) => {
    const hasLiveLink = reviewer.tokenState === 'active';
    // An accepted reviewer who backed out should be recorded as a withdrawal
    // (same menu, "Record reviewer withdrawal"), not removed — Remove erases
    // the acceptance. Warn first; the staffer still decides.
    const msg = `Remove ${reviewer.name || 'this reviewer'} from this request?\n\n`
      + acceptedReviewerRemoveWarning({
        accepted: reviewer.responseType === 'accepted',
        // The menu only offers withdrawal while the review is outstanding.
        withdrawalLocation: canTransitionToTerminal(reviewer) ? 'same-menu' : 'track-reviewers',
      })
      + 'This drops them from your reviewer list for this proposal. '
      + (hasLiveLink ? 'Their review link will be revoked. ' : '')
      + 'Their reviewer record and any review history are preserved.';
    if (!confirm(msg)) return;

    // Revalidate after confirm() and before dispatch (see handleRevokeToken).
    const attempt = beginAttempt('remove', reviewer.suggestionId);
    if (!attempt) return;
    const isCurrent = () => isAttemptCurrent(attempt);
    try {
      let resp;
      try {
        resp = await fetch('/api/reviewer-finder/my-candidates', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suggestionId: reviewer.suggestionId }),
        });
      } catch (err) {
        if (isCurrent()) alert(`Network error removing reviewer: ${err.message}`);
        return;
      }
      if (!isCurrent()) return;
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        if (!isCurrent()) return;
        const detail = data.error || data.message || data.details || resp.status;
        alert(`Could not remove the reviewer: ${detail}`);
        return;
      }
      const currentOnRefresh = statusContextRef.current.onRefresh;
      if (currentOnRefresh) {
        try {
          await currentOnRefresh();
        } catch {
          if (isCurrent()) {
            alert('The reviewer was removed, but the reviewer list could not be refreshed. Reload to see the current list.');
          }
        }
      }
    } finally {
      finishAttempt(attempt);
    }
  };

  const updateStatus = async (suggestionId, newStatus) => {
    const context = statusContextRef.current;
    const row = context.reviewers.get(suggestionId);
    if (!context.mounted || !context.canManage || context.previewReadOnly || !row
        || statusOperationsRef.current.has(suggestionId)) return;

    const operation = {
      token: Symbol('reviewer-status'),
      suggestionId,
      requestId: context.requestId,
      epoch: context.epoch,
      reviewerLabel: row.name || row.email || suggestionId,
      submittedIds: [suggestionId.trim().toLowerCase()],
      valid: true,
    };
    // Acquire synchronously; React state alone cannot block two same-tick events.
    statusOperationsRef.current.set(suggestionId, operation);
    setPendingStatusTokens(previous => new Map(previous).set(suggestionId, operation.token));

    const isCurrent = () => {
      const current = statusContextRef.current;
      return current.mounted && operation.valid
        && current.epoch === operation.epoch && current.requestId === operation.requestId
        && current.canManage && !current.previewReadOnly
        && current.reviewers.has(suggestionId)
        && statusOperationsRef.current.get(suggestionId)?.token === operation.token;
    };
    const reviewerIdentity = `${operation.reviewerLabel} (${suggestionId})`;
    const reportUnconfirmed = (detail, includeIdentity = false) => {
      if (isCurrent()) {
        const label = includeIdentity ? reviewerIdentity : operation.reviewerLabel;
        const recovery = includeIdentity ? ' Review the current status before submitting another update.' : '';
        alert(`Could not confirm the status update for ${label}. ${detail} Reload before trying again.${recovery}`);
      }
    };

    try {
      let response;
      try {
        response = await fetch('/api/review-manager/reviewers', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suggestionId, reviewStatus: newStatus }),
        });
      } catch (error) {
        reportUnconfirmed(`Network error${error?.message ? `: ${error.message}` : ''}.`);
        return;
      }
      if (!isCurrent()) return;

      let data;
      try {
        data = await response.json();
      } catch {
        reportUnconfirmed(`Invalid response from the server (HTTP ${response.status}).`);
        return;
      }
      if (!isCurrent()) return;
      const outcomeKeys = ['savedIds', 'failedIds', 'notAttemptedIds'];
      const hasOutcomes = data != null && outcomeKeys.some(key => Object.hasOwn(data, key));
      const isResponseObject = data !== null && typeof data === 'object' && !Array.isArray(data);
      if (!isResponseObject) {
        reportUnconfirmed('Invalid response from the server.', hasOutcomes);
        return;
      }
      const detail = [data.error, data.message, data.reason]
        .find(value => typeof value === 'string' && value.trim());
      const hasError = Object.hasOwn(data, 'error');
      if (hasOutcomes) {
        // One own key opts into the entire protocol. Never salvage a claimed
        // saved prefix from a malformed result or accept another row's outcome.
        const hasArrays = outcomeKeys.every(key => Object.hasOwn(data, key) && Array.isArray(data[key]));
        const returnedIds = hasArrays ? [...data.savedIds, ...data.failedIds, ...data.notAttemptedIds] : [];
        const matchesSubmission = hasArrays && returnedIds.length === operation.submittedIds.length
          && returnedIds.every((id, index) => isGuid(id) && id.trim().toLowerCase() === operation.submittedIds[index]);
        const confirmed = matchesSubmission && response.status === 200 && response.ok
          && data.success === true && !hasError
          && data.savedIds.length === operation.submittedIds.length
          && data.failedIds.length === 0 && data.notAttemptedIds.length === 0;
        const uncertain = matchesSubmission && response.status === 500 && !response.ok
          && data.success === false && data.failedIds.length === 1;
        if (!confirmed && !uncertain) {
          reportUnconfirmed('Invalid response: the reported outcomes do not confirm this status update.', true);
          return;
        }
        if (uncertain) {
          // A rejected adapter call may have committed before losing its reply.
          reportUnconfirmed(detail?.trim() || 'The server could not confirm this update.', true);
          return;
        }
      } else if (!response.ok || data.success !== true || hasError) {
        reportUnconfirmed(detail?.trim() || (response.ok
          ? 'Invalid response: the server did not confirm success.'
          : `The server returned HTTP ${response.status}.`));
        return;
      }

      // A confirmed write and a failed host refresh are different outcomes.
      // Void callbacks and hosts that catch their own read failures cannot
      // certify successful reconciliation; keep their existing contracts.
      if (!isCurrent()) return;
      try {
        await statusContextRef.current.onRefresh?.();
      } catch {
        if (isCurrent()) {
          alert(`Status saved for ${hasOutcomes ? reviewerIdentity : operation.reviewerLabel}, but the reviewer list could not be refreshed. Reload to see the current status.`);
        }
        return;
      }
      if (hasOutcomes && isCurrent()) {
        alert(`Status saved for ${reviewerIdentity}.`);
      }
    } finally {
      if (statusOperationsRef.current.get(suggestionId)?.token === operation.token) {
        statusOperationsRef.current.delete(suggestionId);
      }
      // Owned pending cleanup is allowed after invalidation, but never after
      // unmount and never for a different operation's display token.
      if (statusContextRef.current.mounted) {
        setPendingStatusTokens(previous => {
          if (previous.get(suggestionId) !== operation.token) return previous;
          const next = new Map(previous);
          next.delete(suggestionId);
          return next;
        });
      }
    }
  };

  const transitionTerminal = async (reviewer, terminalStatus) => {
    const outcome = terminalStatus === 'withdrew'
      ? 'withdrew after accepting'
      : 'was released by WMKF';
    const consequence = terminalStatus === 'withdrew'
      ? 'This changes their response to declined, updates reviewer counts, revokes their portal link, and removes any linked honorarium request.'
      : 'This ends the engagement and revokes their portal link.';
    if (!confirm(`Confirm that ${reviewer.name || 'this reviewer'} ${outcome}?\n\n${consequence}`)) return;
    // Revalidate after confirm() and before dispatch (see handleRevokeToken).
    // Both terminal choices for a given row share one generation, since only
    // one of them can meaningfully be in flight for that row at a time.
    const attempt = beginAttempt('terminal', reviewer.suggestionId);
    if (!attempt) return;
    const isCurrent = () => isAttemptCurrent(attempt);
    // Captured at dispatch time, not read live from `proposal` later — a
    // request switch after this point must not relabel this payload.
    const requestId = attempt.requestId;
    try {
      let response;
      try {
        response = await fetch('/api/review-manager/terminal-transition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            suggestionIds: [reviewer.suggestionId],
            terminalStatus,
          }),
        });
      } catch (transitionError) {
        if (isCurrent()) alert(`Network error ending engagement: ${transitionError.message}`);
        return;
      }
      if (!isCurrent()) return;
      const data = await response.json().catch(() => ({}));
      if (!isCurrent()) return;
      if (!response.ok || data.transitioned !== 1) {
        // A 409 with results[0].status === 'write_failed' may have partially
        // committed server-side; there is no client-side replay or repair.
        const reason = data.results?.[0]?.status || data.error || response.status;
        alert(`Could not end the engagement: ${reason}. Reload and try again.`);
        return;
      }
      const currentOnRefresh = statusContextRef.current.onRefresh;
      if (currentOnRefresh) {
        try {
          await currentOnRefresh();
        } catch {
          if (isCurrent()) {
            alert('The engagement change was recorded, but the reviewer list could not be refreshed. Reload to see the current status.');
          }
        }
      }
    } finally {
      finishAttempt(attempt);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (!proposal) return null;

  const emptyLabel = mode && mode !== 'all'
    ? 'No reviewers in this stage.'
    : 'No reviewers yet.';

  return (
    <div className="space-y-4">
      {/* Decline referrals are structured for new portal submissions and remain
          backward-readable for legacy free text. They surface only on Track
          Reviewers — the home base once invites are out. "Add as candidate"
          routes through the normal identity-resolution flow. */}
      {mode === 'track' && declineReferrals.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900 mb-1">
            {declineReferrals.length} referral{declineReferrals.length !== 1 ? 's' : ''} from reviewers who declined
          </p>
          <p className="text-xs text-amber-800 mb-3">
            Add useful referrals as candidates, or dismiss suggestions that have already been considered.
          </p>
          <ul className="space-y-2">
            {declineReferrals.map((r) => {
              const actionKey = r.referralId || r.suggestionId;
              const state = referralActions[actionKey];
              const confirming = state?.status === 'confirm';
              return (
                <li
                  key={actionKey}
                  className="rounded-md bg-white/70 border border-amber-100 p-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 break-words">
                        {r.referralName || r.referralText}
                      </p>
                      {r.institution && <p className="text-xs text-gray-600">{r.institution}</p>}
                      {r.email && <p className="text-xs text-gray-600">{r.email}</p>}
                      <p className="text-xs text-gray-500">
                        suggested by {r.reviewerName || 'a declining reviewer'}
                      </p>
                      {r.legacy && r.dismissible && (
                        <p className="text-xs text-amber-700 mt-1">
                          Older free-text note. If everyone listed has already been handled, dismiss the resolved note.
                        </p>
                      )}
                      {r.legacy && !r.dismissible && (
                        <p className="text-xs text-red-700 mt-1">
                          This saved referral cannot be dismissed safely. Ask an administrator to repair it.
                        </p>
                      )}
                    </div>
                    {!confirming && (
                      <ReferralAction
                        referral={r}
                        state={state}
                        canManage={canManage}
                        onAdd={onAddReferral}
                        onDismiss={onDismissDeclineReferral}
                        onGoToInvite={onGoToInvite}
                        onNavigate={onNavigate}
                      />
                    )}
                  </div>
                  {confirming && (
                    <ReferralConfirm
                      referral={r}
                      lookup={state.lookup}
                      onChoose={(resolution) => onAddReferral && onAddReferral(r, resolution)}
                      onCancel={onDismissReferral ? () => onDismissReferral(actionKey) : undefined}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {/* Actions bar. Counts use selectedList (eligible + visible + selected), not the raw
          selectedReviewers set, which can retain IDs no longer visible after a
          refresh removes a reviewer — that would overcount (Codex S209). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            {selectedList.length > 0
              ? `${selectedList.length} accepted reviewer${selectedList.length !== 1 ? 's' : ''} selected`
              : `${reviewers.length} reviewer${reviewers.length !== 1 ? 's' : ''}`}
          </span>
          {loading && (
            <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Release proposal to reviewers (reviewer-engagement §3.A): a one-click
              materials send to accepted-awaiting-materials reviewers, even
              though Track Reviewers also shows later lifecycle statuses.
              If the user has selected a subset of accepted reviewers (using
              selectedList's visible+selected semantics, not the raw
              selectedReviewers set — see Codex S209 note above), release
              targets only that subset; otherwise it targets all accepted
              reviewers. Accepted-only is also enforced server-side in
              send-emails. */}
          {canManage && acceptedReviewers.length > 0 && (
            <Button
              onClick={() => {
                const releaseTargets = selectedList.length > 0
                  ? selectedList
                  : acceptedReviewers;
                selectionCauseRef.current = null;
                setSelectedReviewers(new Set(releaseTargets.map(r => r.suggestionId)));
                setReleaseModalOpen(true);
              }}
              disabled={degraded}
              title={degraded ? 'Reviewer data could not be refreshed - retry before making changes' : undefined}
            >
              Release proposal to reviewers ({selectedList.length > 0 ? selectedList.length : acceptedReviewers.length})
            </Button>
          )}
        </div>
      </div>

      {/* Reviewers table */}
      {reviewers.length === 0 ? (
        <Card hover={false}>
          <p className="text-sm text-gray-500 text-center py-6">{emptyLabel}</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className={`w-full table-fixed divide-y divide-gray-200 ${tableMinWidth}`}>
            {/* Status and link form one progress signal; reminders, closeout,
                downloads, and secondary controls share one action lane. This
                keeps the table scannable without pushing core controls beyond
                the visible card edge. */}
            <colgroup>
              {showSelectionColumn && <col className="w-[4%]" />}
              <col className={reviewerColumnWidth} />
              <col className={showActionColumn ? 'w-[17%]' : 'w-[20%]'} />
              <col className={showActionColumn ? 'w-[14%]' : 'w-[17%]'} />
              <col className={showActionColumn ? 'w-[17%]' : 'w-[25%]'} />
              {showActionColumn && <col className="w-[18%]" />}
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                {showSelectionColumn && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all reviewers awaiting materials"
                      className="rounded border-gray-300"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reviewer</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Action</th>
                {showActionColumn && (
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Next action
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reviewers.map(r => {
                // Terminal status has no guaranteed timestamp, so it takes precedence
                // without being fabricated as a dated timeline event.
                const lastEvent = latestActivitySummary(r);

                return (
                  <tr key={r.suggestionId} className="hover:bg-gray-50 transition-colors">
                    {showSelectionColumn && (
                      <td className="px-3 py-3 align-top">
                        {r.reviewStatus === 'accepted' && (
                          <input
                            type="checkbox"
                            checked={selectedReviewers.has(r.suggestionId)}
                            onChange={() => toggleSelect(r.suggestionId)}
                            aria-label={`Select ${r.name || 'reviewer'} for proposal release`}
                            className="rounded border-gray-300"
                          />
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 align-top">
                      <p className="line-clamp-2 break-words text-sm font-medium text-gray-900" title={r.name || ''}>{r.name}</p>
                      <p className="line-clamp-2 break-words text-xs leading-5 text-gray-500" title={r.affiliation || ''}>{r.affiliation || ''}</p>
                      {r.email && <p className="truncate text-xs leading-5 text-gray-400" title={r.email}>{r.email}</p>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={r.reviewStatus} />
                        <TokenStateBadge state={r.tokenState} expiresAt={r.tokenExpiresAt} firstAccessedAt={r.proposalFirstAccessedAt} />
                      </div>
                      {r.reviewStatus === 'complete' && (
                        <span className="mt-1 block text-xs leading-4 text-gray-600">
                          {closeoutDispositionLabel(r.honorariumEligibility)}
                        </span>
                      )}
                      {r.reminderCount > 0 && (
                        <span className="text-xs text-gray-400 ml-1">({r.reminderCount} reminder{r.reminderCount !== 1 ? 's' : ''})</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <ReviewerDueDateEditor
                        suggestionId={r.suggestionId}
                        reviewerName={r.name}
                        overrideDate={r.reviewDueDateOverride}
                        effectiveDate={r.effectiveReviewDeadline}
                        defaultDate={proposal.reviewDeadline}
                        canManage={canManage
                          && mode === 'track'
                          && ['accepted', 'materials_sent', 'under_review'].includes(r.reviewStatus)
                          && !r.reviewReceivedAt}
                        onSaved={onRefresh}
                      />
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-gray-500">
                      {lastEvent ? (
                        <>
                          <p className="text-gray-700">{lastEvent.label}</p>
                          {lastEvent.dated === false ? null : <p>{formatDate(lastEvent.at)}</p>}
                        </>
                      ) : (
                        <p>—</p>
                      )}
                      <button
                        type="button"
                        onClick={() => setActivityDrawerId(r.suggestionId)}
                        className="mt-1 text-blue-700 hover:text-blue-900 hover:underline"
                        aria-label={`View activity history for ${r.name || 'reviewer'}`}
                      >
                        History
                      </button>
                    </td>
                    {showActionColumn && (
                      <td className="px-4 py-3 align-top">
                        <div className="flex min-h-9 items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {showFollowUpColumn
                              && ['materials_sent', 'under_review'].includes(r.reviewStatus)
                              && !r.reviewReceivedAt
                              && r.submitted !== true && (
                              <ReviewReminderAction
                                requestId={proposal.proposalId}
                                reviewer={r}
                                onSent={onRefresh}
                                previewReadOnly={previewReadOnly || !canManage}
                                degraded={degraded}
                              />
                            )}
                            {showActionsColumn && ['review_received', 'complete'].includes(r.reviewStatus) && (
                              <button
                                type="button"
                                onClick={() => setCloseoutReviewerId(r.suggestionId)}
                                disabled={degraded}
                                title={degraded ? 'Reviewer data could not be refreshed - retry before making changes' : undefined}
                                className="min-h-9 whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
                              >
                                {r.reviewStatus === 'complete' ? 'Edit closeout' : 'Close review'}
                              </button>
                            )}
                          </div>
                          {showActionsColumn && (
                            <div className="flex shrink-0 items-center gap-1">
                              {/* Download received review from SharePoint via Graph. */}
                              {r.reviewSharePointFolder && (
                                <a
                                  href={`/api/review-manager/download-review?suggestionId=${encodeURIComponent(r.suggestionId)}`}
                                  className="rounded-lg p-1.5 text-green-600 hover:bg-green-50 hover:text-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
                                  title={`Download: ${r.reviewFilename || 'review'}`}
                                  aria-label={`Download review from ${r.name || 'reviewer'}`}
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                </a>
                              )}
                              {/* Secondary magic-link and lifecycle actions. */}
                              <TokenActionsMenu
                                reviewer={r}
                                onRegenerate={() => handleRegenerateToken(r.suggestionId)}
                                onRevoke={() => handleRevokeToken(r.suggestionId)}
                                onRemove={() => handleRemoveReviewer(r)}
                                onStatusChange={(newStatus) => updateStatus(r.suggestionId, newStatus)}
                                statusPending={pendingStatusTokens.has(r.suggestionId)}
                                onTransition={(terminalStatus) => transitionTerminal(r, terminalStatus)}
                                degraded={degraded}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Read-only, so it renders regardless of the canManage UI gate. */}
      {activityReviewer && (
        <ReviewerActivityDrawer
          reviewer={activityReviewer}
          onClose={() => setActivityDrawerId(null)}
        />
      )}

      {closeoutReviewer && (
        <ReviewerCloseoutModal
          isOpen
          reviewer={closeoutReviewer}
          proposal={proposal}
          requestId={proposal?.proposalId}
          canManage={canManage}
          previewReadOnly={previewReadOnly}
          onClose={() => setCloseoutReviewerId(null)}
          onSaved={() => (onRefresh ? onRefresh() : undefined)}
        />
      )}

      {/* Modals */}
      {canManage && (
        <>
          <ReleaseMaterialsModal
            isOpen={releaseModalOpen}
            onClose={() => setReleaseModalOpen(false)}
            reviewers={selectedList}
            proposalTitle={proposal.proposalTitle}
            // Stage 6B3c: by-VALUE key over the proposal fields the rendered
            // draft body embeds (see proposalKeyFor above) — never the
            // proposal object itself, which this call site rebuilds fresh
            // every render.
            proposalKey={proposalKeyFor(proposal)}
            requestId={proposal?.proposalId}
            settings={{
              ...settings,
              reviewDueDate: proposal.reviewDeadline,
            }}
            // Deliberate ref read during render (Stage 6B3 D4): the modal's
            // session effect needs the LATEST committed cause at the moment
            // this transition commits, not a value captured a render early
            // via useState (which would itself need an extra commit and could
            // race the very membership change it's meant to validate). The
            // ref only carries plain data and never affects this component's
            // own render output.
            // eslint-disable-next-line react-hooks/refs
            membershipCause={selectionCauseRef.current}
            degraded={degraded}
            onEmailsSent={(cause) => {
              // Tag the clear synchronously BEFORE it commits — see
              // selectionCauseRef's declaration above and the modal's own
              // session-effect consumption of this exact prop.
              selectionCauseRef.current = cause;
              setSelectedReviewers(new Set());
              if (onRefresh) onRefresh();
            }}
          />
        </>
      )}
    </div>
  );
}
