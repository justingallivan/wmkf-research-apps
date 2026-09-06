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

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReviewerDueDateEditor from './ReviewerDueDateEditor';
import ReviewerActivityDrawer from './ReviewerActivityDrawer';
import ReviewerCloseoutModal, { closeoutDispositionLabel } from './ReviewerCloseoutModal';
import { latestActivitySummary } from './reviewer-activity-history';
import { acceptedReviewerRemoveWarning } from './remove-reviewer-confirm';
import { Card, Button } from '../Layout';
import {
  STATUS_PIPELINE,
  getStatusInfo,
  filterByMode,
  TERMINAL_REVIEW_STATUSES,
  canTransitionToTerminal,
} from './reviewer-modes';
import { EMPTY_TEMPLATES, loadEmailTemplates, saveEmailTemplates } from './email-template-store';
import { renderPreviewFailureMessage, RENDER_PREVIEW_NETWORK_MESSAGE } from './render-preview-failure';
import { isGuid } from '../../../lib/utils/guid';

// Pure status-pipeline / mode-bucketing logic lives in ./reviewer-modes
// (React-free + unit-tested). Re-export the pipeline so existing importers of
// it from this module keep working.
export { STATUS_PIPELINE, MODE_STATUSES, MODE_WORK_REMAINING, filterByMode } from './reviewer-modes';

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

// ─── Magic-link Token State ─────────────────────────────────────────────────

const TOKEN_STATE_INFO = {
  not_minted: { label: 'Not sent', color: 'bg-gray-100 text-gray-600' },
  active:     { label: 'Active',   color: 'bg-blue-100 text-blue-800' },
  revoked:    { label: 'Revoked',  color: 'bg-red-100 text-red-800' },
  expired:    { label: 'Expired',  color: 'bg-orange-100 text-orange-800' },
  invalid:    { label: 'Needs review', color: 'bg-amber-100 text-amber-800' },
};

export function TokenStateBadge({ state, expiresAt, firstAccessedAt }) {
  const known = Boolean(TOKEN_STATE_INFO[state]);
  const info = TOKEN_STATE_INFO[state] || {
    label: 'Unknown',
    color: 'bg-amber-100 text-amber-800',
  };
  const tooltip = [
    state === 'invalid' && 'Stored token metadata needs technical review',
    !known && 'Unrecognized token state; refresh or request technical review',
    expiresAt && `Expires ${new Date(expiresAt).toLocaleDateString()}`,
    firstAccessedAt && `Opened ${new Date(firstAccessedAt).toLocaleDateString()}`,
  ].filter(Boolean).join(' · ');
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded text-xs font-medium ${info.color}`}
      title={tooltip || undefined}
    >
      {info.label}
      {state === 'active' && firstAccessedAt && (
        <span className="ml-1 text-xs opacity-75">opened</span>
      )}
    </span>
  );
}

const REVIEW_REMINDER_ERROR_MESSAGE = {
  conflict: 'Already claimed by another send. Refresh and try again.',
  removed: 'This reviewer was removed from the request.',
  revoked: 'Their review link was revoked. Reissue it before sending a reminder.',
  token_revoked: 'This reviewer\'s access was withdrawn. Deliberately restore access before sending a reminder.',
  token_not_minted: 'No review link is recorded. Investigate the Materials history before sending a link explicitly.',
  token_invalid_data: 'The review-link metadata needs technical review. Do not regenerate the link automatically.',
  token_expired: 'The review link expired. Send an explicit replacement link before sending a reminder.',
  token_insufficient_window: 'The review link does not cover the deadline. Send a deliberate replacement link first.',
  due_date_missing: 'Set a review due date before sending a reminder.',
  not_found: 'This reviewer is no longer available. Refresh the list.',
  read_failed: 'The latest reviewer status could not be verified. Nothing was sent.',
  prepare_failed: 'The reminder could not be prepared. Nothing was sent.',
  send_failed: 'The reminder was prepared, but the email could not be sent.',
  misconfigured: 'The review reminder email template is missing or blank in Admin.',
  ineligible: 'This reviewer is no longer eligible for a reminder. Refresh the list.',
};

export function ReviewReminderAction({
  requestId,
  reviewer,
  onSent,
  previewReadOnly = false,
}) {
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const mountedRef = useRef(true);
  // The per-attempt supersession token: bumped only by a new send and by
  // unmount. A committed-context epoch (below) is a SEPARATE dimension —
  // request/reviewer identity/read-only changes bump epoch without bumping
  // generation, so a stale attempt's finally can still find its own
  // generation match and release the send lock even though its feedback/
  // callback checkpoints (which also require epoch match) stay suppressed.
  const generationRef = useRef(0);
  const sendingRef = useRef(false);
  const contextRef = useRef({ requestId, suggestionId: reviewer?.suggestionId, previewReadOnly, onSent, epoch: 0 });

  useLayoutEffect(() => {
    const context = contextRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      sendingRef.current = false;
      context.epoch += 1;
    };
  }, []);

  // Committed-props reconciliation, mirroring the Stage 6B1 registry effect
  // pair (mount/unmount effect above, committed-props effect here): no
  // dependency array, no cleanup, so it runs on every commit. Only
  // request/suggestionId/read-only identity bumps the epoch; object/
  // callback replacement is ordinary refresh and is tracked here (for the
  // latest-callback rule) without invalidating anything. A departed
  // session's feedback must not linger for the new one, so the epoch bump
  // also clears it — this intentionally has no dependency array (identity
  // is a multi-field comparison, not a single prop) and conditionally calls
  // setState, so react-hooks/exhaustive-deps cannot infer a correct
  // dependency list here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const context = contextRef.current;
    if (context.requestId !== requestId
      || context.suggestionId !== reviewer?.suggestionId
      || context.previewReadOnly !== previewReadOnly) {
      context.epoch += 1;
      setFeedback(null);
    }
    context.requestId = requestId;
    context.suggestionId = reviewer?.suggestionId;
    context.previewReadOnly = previewReadOnly;
    context.onSent = onSent;
  });

  const lifecycleEligible = Boolean(
    requestId
    && reviewer?.suggestionId
    && ['materials_sent', 'under_review'].includes(reviewer.reviewStatus)
    && !reviewer.reviewReceivedAt
    && reviewer.submitted !== true,
  );
  const reminderEligibility = reviewer?.reviewDueReminderEligibility;
  const canSend = lifecycleEligible && reminderEligibility === 'eligible';

  if (!lifecycleEligible) return <span className="text-xs text-gray-300">—</span>;

  const isCurrent = (epoch) => mountedRef.current && epoch === contextRef.current.epoch;

  const handleSend = async () => {
    if (previewReadOnly || !canSend || sendingRef.current) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const epoch = contextRef.current.epoch;
    sendingRef.current = true;
    setSending(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/review-manager/send-review-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          suggestionId: reviewer.suggestionId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (generation !== generationRef.current || !isCurrent(epoch)) return;
      if (!response.ok || !data.ok) {
        setFeedback({
          ok: false,
          message: REVIEW_REMINDER_ERROR_MESSAGE[data.reason] || 'The reminder could not be sent.',
        });
        return;
      }
      setFeedback({ ok: true, message: 'Reminder sent.' });
      // "Reminder sent." feedback is retained regardless of what the
      // callback does: a throw/rejection here is a refresh failure, not a
      // failed send, and must never relabel a confirmed mutation as failed
      // or trigger a resend. The callback's returned promise is observed
      // (so a rejection never becomes an unhandled rejection) but NOT
      // awaited: a slow/never-resolving refresh must not hold the send
      // lock or the UI feedback hostage.
      const latestOnSent = contextRef.current.onSent;
      if (latestOnSent) {
        try {
          const result = latestOnSent();
          if (result && typeof result.then === 'function') result.catch(() => {});
        } catch {
          // Swallow: confirmed send, callback/refresh failure only.
        }
      }
    } catch (error) {
      if (generation === generationRef.current && isCurrent(epoch)) {
        setFeedback({ ok: false, message: error.message || 'The reminder could not be sent.' });
      }
    } finally {
      if (generation === generationRef.current) {
        sendingRef.current = false;
        if (mountedRef.current) setSending(false);
      }
    }
  };

  const previewTitle = 'Preview is read-only. This control is enabled after promotion to production.';
  const eligibilityTitle = canSend
    ? 'Send a review-due reminder now'
    : REVIEW_REMINDER_ERROR_MESSAGE[reminderEligibility]
      || 'Reminder eligibility could not be verified. Refresh before trying again.';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleSend}
        disabled={previewReadOnly || !canSend || sending}
        title={previewReadOnly ? previewTitle : eligibilityTitle}
        aria-label={`Send reminder to ${reviewer.name || 'reviewer'}${previewReadOnly ? ' (disabled in read-only Preview)' : ''}`}
        className="min-h-9 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
      >
        {sending ? 'Sending…' : 'Send reminder'}
      </button>
      {feedback && (
        <span
          className={`max-w-40 text-right text-xs leading-4 ${feedback.ok ? 'text-green-700' : 'text-amber-700'}`}
          role="status"
        >
          {feedback.message}
        </span>
      )}
    </div>
  );
}

const MENU_WIDTH = 288; // w-72

export function TokenActionsMenu({
  reviewer,
  onRegenerate,
  onRevoke,
  onRemove,
  onStatusChange,
  statusPending = false,
  onTransition,
  onCloseReview,
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null); // { left, top } in viewport px, or null
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const isActive = reviewer.tokenState === 'active';
  const hasInvalidTokenMetadata = reviewer.tokenState === 'invalid';
  const canRegenerate = !hasInvalidTokenMetadata;
  const canRevoke = isActive || hasInvalidTokenMetadata;
  const canCorrectStatus = Boolean(
    onStatusChange
      && reviewer.reviewStatus !== 'complete'
      && !TERMINAL_REVIEW_STATUSES.includes(reviewer.reviewStatus),
  );
  const canEndEngagement = Boolean(
    onTransition && canTransitionToTerminal(reviewer),
  );
  const settableStatuses = STATUS_PIPELINE.filter(
    s => s.key !== 'accepted'
      && s.key !== 'complete'
      && !TERMINAL_REVIEW_STATUSES.includes(s.key),
  );
  const canCloseReview = Boolean(
    onCloseReview && ['review_received', 'complete'].includes(reviewer.reviewStatus),
  );
  const canRemove = Boolean(
    onRemove
      && reviewer.reviewStatus !== 'complete'
      && !TERMINAL_REVIEW_STATUSES.includes(reviewer.reviewStatus),
  );
  // The estimate drives the upward flip so the portalled menu never opens
  // off-screen. Status correction and terminal actions are taller sections;
  // the remaining items are standard 40px menu rows.
  const itemCount = (canRegenerate ? 1 : 0) + (canRevoke ? 1 : 0) + (canRemove ? 1 : 0);
  const estimatedMenuHeight = (itemCount * 40)
    + (canCorrectStatus ? 118 : 0)
    + (canEndEngagement ? 104 : 0)
    + (canCloseReview ? 72 : 0)
    + (hasInvalidTokenMetadata ? 48 : 0)
    + 8;

  // Position the menu in viewport coords, flipping upward when there isn't room
  // below. Rendered in a portal (see below) so it escapes the table card's
  // `overflow-hidden` clip and the footer's stacking context.
  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const openUp = rect.bottom + estimatedMenuHeight > window.innerHeight
      && rect.top > estimatedMenuHeight;
    setCoords({
      left: Math.max(8, rect.right - MENU_WIDTH),
      top: openUp ? rect.top - estimatedMenuHeight - 4 : rect.bottom + 4,
    });
  }, [estimatedMenuHeight]);

  useEffect(() => {
    if (!open) return;
    place();
    const onDocClick = (e) => {
      // Close only when the click is outside BOTH the trigger and the portalled
      // menu (the menu lives outside this component's DOM subtree).
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // Position is computed once on open; close on scroll/resize so a stale
    // fixed position can never be shown detached from its row.
    const onReflow = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
        title="Manage reviewer"
        aria-label={`Manage ${reviewer.name || 'reviewer'}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>
      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: coords.left, top: coords.top, width: MENU_WIDTH }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 text-sm"
        >
          {canCorrectStatus && (
            <div className="px-3 py-2 border-b border-gray-100">
              <label className="block">
                <span className="block text-xs font-medium text-gray-700 mb-1">
                  Correct recorded status
                </span>
                <select
                  value={reviewer.reviewStatus === 'accepted' ? '' : reviewer.reviewStatus}
                  disabled={statusPending}
                  onChange={(event) => {
                    const newStatus = event.target.value;
                    if (!newStatus || statusPending) return;
                    setOpen(false);
                    onStatusChange(newStatus);
                  }}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 text-gray-700 bg-white focus:ring-1 focus:ring-gray-400 focus:outline-none disabled:cursor-wait disabled:bg-gray-50"
                  aria-label={`Correct status for ${reviewer.name || 'reviewer'}`}
                >
                  {reviewer.reviewStatus === 'accepted' && (
                    <option value="" disabled>Accepted</option>
                  )}
                  {settableStatuses.map(status => (
                    <option key={status.key} value={status.key}>{status.label}</option>
                  ))}
                </select>
              </label>
              <p role={statusPending ? 'status' : undefined} className="mt-1.5 text-xs leading-4 text-gray-500">
                {statusPending ? 'Updating status…' : 'Use only to fix the recorded stage. No email is sent.'}
              </p>
            </div>
          )}
          {canEndEngagement && (
            <div className="py-1 border-b border-gray-100">
              <p className="px-3 pt-1 pb-0.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                End engagement
              </p>
              <button
                type="button"
                onClick={() => { setOpen(false); onTransition('withdrew'); }}
                className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-700"
              >
                Record reviewer withdrawal
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); onTransition('released'); }}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700"
              >
                Release from assignment
              </button>
            </div>
          )}
          {canCloseReview && (
            <div className="py-1 border-b border-gray-100">
              <p className="px-3 pt-1 pb-0.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                Review closeout
              </p>
              <button
                type="button"
                onClick={() => { setOpen(false); onCloseReview(); }}
                className="w-full text-left px-3 py-2 hover:bg-green-50 text-green-800"
              >
                {reviewer.reviewStatus === 'complete' ? 'Edit closeout' : 'Close review'}
              </button>
            </div>
          )}
          <p className="px-3 pt-2 pb-0.5 text-xs font-medium uppercase tracking-wide text-gray-400">
            Reviewer link
          </p>
          {canRegenerate && (
            <button
              onClick={() => { setOpen(false); onRegenerate(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50"
            >
              {reviewer.tokenState === 'not_minted' ? 'Generate link & copy' : 'Regenerate link & copy'}
            </button>
          )}
          {hasInvalidTokenMetadata && (
            <p className="px-3 py-2 text-xs leading-4 text-amber-700 bg-amber-50">
              Token metadata needs repair. Do not regenerate this link.
            </p>
          )}
          {canRevoke && (
            <button
              onClick={() => { setOpen(false); onRevoke(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-700"
            >
              Revoke link
            </button>
          )}
          {canRemove && (
            <button
              onClick={() => { setOpen(false); onRemove(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-700 border-t border-gray-100"
            >
              Remove from this request
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Email Modal ────────────────────────────────────────────────────────────

const EMAIL_FIELDS_STORAGE_KEY = 'review_manager_email_fields';
const ATTACHMENTS_STORAGE_KEY = 'review_manager_attachments';

// Bounded per-render network timeout for /api/review-manager/render-emails.
// Since d040a7a3 preview renders are read-only server-side (no token
// minting), so aborting a stuck request client-side can no longer strand a
// durable write — this exists purely to recover the UI (release the
// single-flight lock + tail) from a request that never settles, not to
// coordinate with any server-side cancellation.
export const PREVIEW_RENDER_TIMEOUT_MS = 45000;

function fileKeyOf(file) {
  return `${file.library}::${file.folder}::${file.name}`;
}

const emptyProposalDoc = () => ({
  loading: false,
  error: null,
  blobUrl: null,
  filename: null,
  allFiles: [],
  pickedKey: null,
});

// Stage 6B3b: the modal session's membership key, by VALUE, over the fields
// the rendered draft body actually consumes for a given reviewer (see
// email-generator.js buildTemplateContext: candidate.name, candidate.email,
// candidate.affiliation — candidate.expertiseAreas is also read there, but
// the reviewers-service projection this panel's rows come from
// (lib/services/review-manager/reviewers-service.js) never sets an
// expertiseAreas/expertise field, so there is nothing to fold in for it).
// A same-id change to any of these after a preview leaves the rendered body
// (sent verbatim; the server only re-resolves the destination address)
// showing a stale greeting/affiliation, so it must invalidate the session
// exactly like a membership change. Per-reviewer strings are sorted (not
// keyed by array order) and joined with U+0001 (a control character that
// cannot appear in these fields), each field within a reviewer's string
// joined with U+0000 (same non-collision rationale as the settings key
// below) — so no combination of name/email/affiliation values across two
// different reviewers can collide into the same overall key. An empty
// `reviewers` array must still produce '' (the completion exemption's
// `nextKey === ''` check depends on it). Used both by the committed-session
// effect below AND by handleSend's `priorKey` capture (which reads
// sessionContextRef.current.key, always assigned from this same function's
// output — see the effect), so there is only one computation to keep in
// sync.
// Field/row separators built at runtime (String.fromCharCode) rather than
// written as literal control characters in this source file: U+0000 cannot
// appear in name/email/affiliation, and U+0001 cannot appear in any
// suggestionId GUID, so no combination of per-reviewer field values or
// per-reviewer joined strings can collide across the separators.
const MEMBERSHIP_KEY_FIELD_SEP = String.fromCharCode(0);
const MEMBERSHIP_KEY_ROW_SEP = String.fromCharCode(1);

function membershipKeyFor(reviewers) {
  return reviewers
    .map(r => [r.suggestionId, r.name || '', r.email || '', r.affiliation || ''].join(MEMBERSHIP_KEY_FIELD_SEP))
    .slice()
    .sort()
    .join(MEMBERSHIP_KEY_ROW_SEP);
}

// Stage 6B3c: a fourth Codex review found the rendered body also embeds
// PROPOSAL fields (title, abstract, PI/authors, institution — see
// render-emails-service.js buildTemplateContext) and send transmits the body
// verbatim, so a same-requestId proposal edit after preview leaves stale
// proposal text just like a stale membership/settings field would. Keyed by
// VALUE over exactly the four proposal fields the panel carries (see the
// `proposal` prop contract in reviewers-service.js / reviewer-follow-up.js /
// ReviewersTab's synthetic fallback) — co-investigators are NOT carried by
// any host, so there is nothing to fold in for them. Joined with the same
// MEMBERSHIP_KEY_FIELD_SEP (no row separator needed: this is a fixed
// four-field record, not a per-reviewer array). A null/undefined proposal
// (e.g. a host reviewers-fetch failure) yields the four-empty join, same
// shape as an empty membership key.
function proposalKeyFor(proposal) {
  return [
    proposal?.proposalTitle,
    proposal?.proposalAbstract,
    proposal?.proposalAuthors,
    proposal?.proposalInstitution,
  ].map(v => v || '').join(MEMBERSHIP_KEY_FIELD_SEP);
}

function ReleaseMaterialsModal({ isOpen, onClose, reviewers, proposalTitle, proposalKey, requestId, settings, onEmailsSent, membershipCause }) {
  // This request-scoped entry point is intentionally materials-only. Review-due
  // nudges use ReviewReminderAction's fresh eligibility + atomic-claim path, and
  // thank-yous are handled by the dedicated sweep. Keeping those choices out of
  // the release modal prevents one generic composer from competing with the
  // lifecycle-specific actions.
  const templateType = 'materials';
  const [templates, setTemplates] = useState(EMPTY_TEMPLATES);
  const [step, setStep] = useState('compose'); // compose | preview | sending | sent
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [drafts, setDrafts] = useState([]); // [{ suggestionId, candidateName, candidateEmail, requestNumber, subject, body, skipped? }]
  const [sentResults, setSentResults] = useState({ sent: [], failed: [], skipped: [] });
  const [error, setError] = useState(null);
  const [emailFields, setEmailFields] = useState({
    reviewDueDate: settings.reviewDueDate || '',
    proposalSendDate: '',
    // honorarium removed S199 — now a Dataverse ground-truth read server-side.
  });
  // Attachments are per-template-type so switching templates (e.g. Materials
  // → Thank-you) doesn't carry over the proposal PDF or other type-specific files.
  const [attachmentsByType, setAttachmentsByType] = useState({ materials: [], followup: [], thankyou: [] });
  const attachments = Array.isArray(attachmentsByType?.[templateType]) ? attachmentsByType[templateType] : [];
  const [proposalDoc, setProposalDoc] = useState(emptyProposalDoc);
  const proposalLoadSeq = useRef(0);
  // Admin-configurable, default OFF (docs/agent-wiki/topics/external-reviewer-portal.md):
  // when off, the release email is portal-link-only ({{externalLink}} in the
  // template) — no proposal auto-attach, no manual file picker, no Blob upload.
  // Read fresh every time the modal opens (see effect below); never a build-time
  // constant.
  const [attachProposalEmailEnabled, setAttachProposalEmailEnabled] = useState(false);
  // Reviewer-visible SharePoint materials preflight — warns the PD before a
  // "materials" release when the reviewer-portal download folder is empty.
  // status: 'idle' | 'checking' | 'ok' | 'unavailable'. 'unavailable' covers
  // both a non-ok response and a fetch failure — the client can't verify
  // either way, so it shows a neutral note and does NOT gate the send (an
  // unreachable check must never block a real release).
  const [materialsPreflight, setMaterialsPreflight] = useState({ status: 'idle', fileCount: null });
  const setAttachments = (updater) => {
    setAttachmentsByType((prev) => {
      const current = prev[templateType] || [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      const merged = { ...prev, [templateType]: next };
      try { localStorage.setItem(ATTACHMENTS_STORAGE_KEY, JSON.stringify(merged)); } catch (e) { /* ignore */ }
      return merged;
    });
  };
  const [isUploading, setIsUploading] = useState(false);
  // True only when the last preview render failed — gates the compose banner's
  // Retry button so it never offers to re-render on a send-path error.
  const [previewFailed, setPreviewFailed] = useState(false);
  // True whenever a preview render is queued or in flight — disables the
  // footer Preview button and the Retry button.
  const [rendering, setRendering] = useState(false);
  // Declared here (not beside saveTemplate below) so the session-identity
  // reconcile effect, which resets it on a new session, can reference the
  // setter without a textual before-declaration lint warning.
  const [templateSaved, setTemplateSaved] = useState(false);

  // Synchronous single-flight lock for handlePreview, keyed to the modal-session
  // epoch that was current when a render was started. A second call for the SAME
  // session returns immediately; a stale finally (from a session that has since
  // closed/reopened) must not clear a newer session's lock or `rendering` state.
  const renderingEpochRef = useRef(null);
  // Serializes preview-render execution across close/reopen sessions (not just
  // across same-session clicks): a render kicked off just before close and a
  // new render kicked off right after reopen must still apply in session order.
  // Chaining every render onto this tail guarantees at most one fetch in flight.
  const renderTailRef = useRef(Promise.resolve());
  // Monotonic modal-session id, bumped on every isOpen transition (open AND
  // close) and never reset. A response for an earlier open/close session can
  // never mutate a later session's state — see handlePreview/handleSend.
  const modalSessionRef = useRef(0);
  // The AbortController for whatever render-emails fetch is currently
  // outstanding (if any), so close/reopen can abort it immediately instead of
  // leaving it to the PREVIEW_RENDER_TIMEOUT_MS ceiling. Aborting settles that
  // fetch's promise, which is what actually releases renderTailRef for the
  // next session — without this, ReleaseMaterialsModal staying mounted across close
  // means a hung render's tail blocks every later session until it times out.
  const activeRenderAbortRef = useRef(null);

  // Stage 6B3: modal session identity = isOpen + requestId + a per-reviewer
  // membership+recipient key, plus the one-use completion-cause consumption
  // (see handleSend/onEmailsSent below). Compare stable membership BY VALUE
  // (see membershipKeyFor above), never array identity or reviewer
  // display-object identity — a same-membership, same-field-values rerender
  // with fresh row objects must not reset drafts/step. modalSessionRef
  // (declared above) IS the epoch: handlePreview/handleSend already capture
  // and compare against it.
  // Stage 6B3a: identity also folds in a settings-by-VALUE key (signature +
  // reviewDueDate — the only two `settings` fields consumed anywhere, see
  // snapshotSettings in handlePreview) — never the whole `settings` object,
  // which the panel call site rebuilds fresh every render ({...settings,
  // reviewDueDate}) and which can carry unrelated host keys.
  // Stage 6B3b: the membership key itself widened from suggestionId-only to
  // suggestionId+name+email+affiliation (membershipKeyFor) — the rendered
  // draft body is sent verbatim (the server only re-resolves the destination
  // address at send time), so a same-id change to a recipient's rendered
  // fields after preview must invalidate the session exactly like a
  // membership change, not just leave a stale greeting/affiliation in the
  // sent body.
  // Stage 6B3c: identity also folds in a proposal-by-VALUE key (proposalKey
  // prop, computed by the call site via proposalKeyFor over proposalTitle/
  // proposalAbstract/proposalAuthors/proposalInstitution — see
  // proposalKeyFor above) — the rendered draft body also embeds these
  // PROPOSAL fields (render-emails-service.js) and is sent verbatim, so a
  // same-requestId proposal edit after preview must invalidate the session
  // exactly like a membership or settings change.
  const mountedRef = useRef(true);
  const saveTimerRef = useRef(null);
  const uploadAttemptRef = useRef(null);
  // The most recently FINISHED send attempt (see handleSend), set only when
  // its `complete` event lands. `onEmailsSent` is called with this exact
  // object, so the panel hands the SAME object back as the `membershipCause`
  // prop after it clears selection — the effect below matches the incoming
  // prop's identity/fields against this ref to decide whether a prior→empty
  // membership transition is the one THIS attempt caused (and so must not
  // reset the just-completed summary), vs. any other membership change
  // (which discards this ref and invalidates normally).
  const lastSendAttemptRef = useRef(null);
  const sessionContextRef = useRef({
    isOpen: false,
    requestId: undefined,
    key: '',
    settingsKey: '',
    // Stage 6B3c: proposal-by-VALUE key (proposalKeyFor) — see the
    // committed-session effect below.
    proposalKey: '',
    // The committed settings.reviewDueDate default at last reconcile — the
    // "prior default" the emailFields follow-rule below compares against.
    reviewDueDateDefault: '',
    onEmailsSent,
  });

  // Mount/unmount lifetime: unmounting (the modal renders under `canManage &&`
  // at the panel call site, so permission loss is unmount here — see D2 in
  // the 6B3 trace) permanently invalidates every in-flight attempt. This is a
  // SEPARATE dimension from the committed-session reconcile effect below,
  // mirroring the ReviewReminderAction/6B1 mount-effect pair.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      modalSessionRef.current += 1;
      lastSendAttemptRef.current = null;
      if (activeRenderAbortRef.current) {
        activeRenderAbortRef.current.abort();
        activeRenderAbortRef.current = null;
      }
      proposalLoadSeq.current += 1;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      uploadAttemptRef.current = null;
    };
  }, []);

  // Committed-session reconciliation: no dependency array, no cleanup, so it
  // runs on every commit (mirrors the Stage 6B1/6B2 committed-props effect
  // pattern). Any change to isOpen, requestId, the membership+recipient key
  // (Stage 6B3b — see membershipKeyFor above), the settings-by-value key
  // (Stage 6B3a), or the proposal-by-value key (Stage 6B3c — see
  // proposalKeyFor above) bumps modalSessionRef, aborts the active render,
  // and resets compose/preview/send scratch state back to a fresh 'compose'
  // session — except when the transition is the one-use completion-cause
  // exemption (a prior-membership→empty transition tagged by the
  // just-finished send attempt, with settings AND proposal ALSO unchanged),
  // which updates the committed key WITHOUT bumping or resetting,
  // preserving the just-completed 'sent' summary. Same-membership,
  // same-recipient-fields array/object churn (fresh reviewer objects, same
  // ids and same name/email/affiliation; a fresh `settings` object with the
  // same signature/reviewDueDate values; a fresh `proposal` object with the
  // same title/abstract/authors/institution values) never bumps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const context = sessionContextRef.current;
    const nextKey = membershipKeyFor(reviewers);
    // Settings identity by VALUE, not object identity: the panel call site
    // rebuilds `settings` fresh every render ({...settings, reviewDueDate:
    // proposal.reviewDeadline}), so comparing the object (or JSON.stringify
    // of the whole thing) would bump on every render and would also pick up
    // unrelated host keys riding along in `...settings`. Only `signature` and
    // `reviewDueDate` are ever consumed (see snapshotSettings in
    // handlePreview) — those are the only two fields in this key. Joined
    // with U+0000, which cannot appear in a date string and is not
    // realistically typeable into the freeform signature field, so the two
    // fields can't collide across the separator.
    const nextSettingsKey = `${settings.signature || ''}\u0000${settings.reviewDueDate || ''}`;
    const changed = context.isOpen !== isOpen || context.requestId !== requestId || context.key !== nextKey
      || context.settingsKey !== nextSettingsKey || context.proposalKey !== proposalKey;

    if (changed) {
      // The one-use completion-cause exemption: this specific transition is
      // priorKey→empty, the session/request/settings/proposal are UNCHANGED
      // (only membership moved), and the cause the panel handed back as a
      // prop is exactly the attempt this modal's own last `complete`
      // produced (same token), still unconsumed, still referring to the
      // current epoch/request/prior membership. Any mismatch (untagged
      // empty, a different membership, request/mode/permission/settings/
      // proposal change, an expired/reused/foreign cause, or a change that
      // happened before completion) invalidates normally.
      const attempt = lastSendAttemptRef.current;
      const cause = membershipCause;
      const isCompletionExemption = Boolean(
        context.isOpen === isOpen
          && context.requestId === requestId
          && context.settingsKey === nextSettingsKey
          && context.proposalKey === proposalKey
          && nextKey === ''
          && attempt
          && !attempt.consumed
          && cause
          && cause.token === attempt.token
          && cause.session === modalSessionRef.current
          && cause.requestId === requestId
          && cause.priorKey === context.key
      );

      if (isCompletionExemption) {
        attempt.consumed = true;
        context.key = nextKey;
      } else {
        lastSendAttemptRef.current = null;
        modalSessionRef.current += 1;
        context.isOpen = isOpen;
        context.requestId = requestId;
        context.key = nextKey;
        // Deadline follow rule: emailFields.reviewDueDate is seeded from the
        // prop once (useState initializer) and otherwise wins over it at
        // render, so widening the key alone would invalidate the session on
        // a deadline change but never actually move the visible/sent date.
        // Move it to the new committed default ONLY when the field still
        // holds the PRIOR committed default or is empty — i.e. the PD never
        // customized it away, and no localStorage restore put something else
        // there. A functional update: a fresh `settings` object with the
        // SAME reviewDueDate value must not schedule a no-op setState here
        // (guarded by the nextDueDateDefault !== prevDueDateDefault check
        // below), and if the field was customized, this must return the same
        // `prev` object so the setState is a true no-op.
        const prevDueDateDefault = context.reviewDueDateDefault;
        const nextDueDateDefault = settings.reviewDueDate || '';
        if (nextDueDateDefault !== prevDueDateDefault) {
          setEmailFields(prev => (
            (!prev.reviewDueDate || prev.reviewDueDate === prevDueDateDefault)
              ? { ...prev, reviewDueDate: nextDueDateDefault }
              : prev
          ));
        }
        context.settingsKey = nextSettingsKey;
        context.proposalKey = proposalKey;
        context.reviewDueDateDefault = nextDueDateDefault;
        if (activeRenderAbortRef.current) {
          activeRenderAbortRef.current.abort();
          activeRenderAbortRef.current = null;
        }
        // proposalLoadSeq is NOT bumped here: loadProposal posts only
        // {requestId, fileKey} — membership is irrelevant to which document
        // loads, so a membership-only change must not orphan a non-stale
        // load. The two resetProposalDoc effects below already invalidate it
        // on isOpen and requestId changes, and the unmount cleanup covers
        // unmount; this branch also fires for pure membership changes, which
        // must leave a pending proposal load alone.
        if (isOpen) {
          setStep('compose');
          setProgress({ current: 0, total: 0, message: '' });
          setDrafts([]);
          setSentResults({ sent: [], failed: [], skipped: [] });
          setError(null);
          setPreviewFailed(false);
          setRendering(false);
          setIsUploading(false);
          uploadAttemptRef.current = null;
          setTemplateSaved(false);
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
        }
      }
    }
    context.onEmailsSent = onEmailsSent;
  });

  // Read the attach-proposal-email setting fresh every time the modal opens
  // (never cached/build-time) so an admin toggle takes effect immediately.
  // Fetch failure degrades to the documented default (OFF/portal-link-only).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/review-manager/release-settings');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setAttachProposalEmailEnabled(!!(res.ok && data?.attachProposalEmail));
      } catch (e) {
        if (!cancelled) setAttachProposalEmailEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Materials-release preflight: fetch fresh whenever the modal is open on
  // the 'materials' template (open, and every switch into it) so a folder
  // that was empty a minute ago but has since been populated doesn't show a
  // stale warning. Same cancelled-flag guard as the release-settings effect
  // above — no setState after this run is superseded or the modal closes.
  useEffect(() => {
    if (!isOpen || templateType !== 'materials' || !requestId) return;
    let cancelled = false;
    setMaterialsPreflight({ status: 'checking', fileCount: null });
    (async () => {
      try {
        const res = await fetch(`/api/review-manager/materials-preflight?requestId=${encodeURIComponent(requestId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data?.ok) {
          setMaterialsPreflight({ status: 'ok', fileCount: typeof data.fileCount === 'number' ? data.fileCount : null });
        } else {
          setMaterialsPreflight({ status: 'unavailable', fileCount: null });
        }
      } catch (e) {
        if (!cancelled) setMaterialsPreflight({ status: 'unavailable', fileCount: null });
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, templateType, requestId]);

  const resetProposalDoc = useCallback(() => {
    proposalLoadSeq.current += 1;
    setProposalDoc(emptyProposalDoc());
  }, []);

  const loadProposal = useCallback(async (fileKey) => {
    if (!requestId) return;
    const seq = proposalLoadSeq.current + 1;
    proposalLoadSeq.current = seq;
    setProposalDoc(prev => ({
      ...emptyProposalDoc(),
      allFiles: prev.allFiles || [],
      pickedKey: fileKey || prev.pickedKey || null,
      loading: true,
    }));
    try {
      const response = await fetch('/api/reviewer-finder/load-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fileKey ? { requestId, fileKey } : { requestId }),
      });
      const data = await response.json().catch(() => ({}));
      const allFiles = Array.isArray(data.allFiles) ? data.allFiles : [];

      if (!response.ok || !data.success) {
        if (proposalLoadSeq.current !== seq) return;
        setProposalDoc({
          loading: false,
          error: response.status === 404 ? 'not_found' : (data.error || `Could not load the proposal document (${response.status})`),
          blobUrl: null,
          filename: null,
          allFiles,
          pickedKey: null,
        });
        return;
      }

      if (proposalLoadSeq.current !== seq) return;
      setProposalDoc({
        loading: false,
        error: null,
        blobUrl: data.blobUrl || null,
        filename: data.filename || null,
        allFiles,
        pickedKey: data.picked || null,
      });
    } catch (err) {
      if (proposalLoadSeq.current !== seq) return;
      setProposalDoc({
        loading: false,
        error: err.message || 'Could not load the proposal document',
        blobUrl: null,
        filename: null,
        allFiles: [],
        pickedKey: null,
      });
    }
  }, [requestId]);

  useEffect(() => {
    if (!isOpen) resetProposalDoc();
  }, [isOpen, resetProposalDoc]);

  useEffect(() => {
    resetProposalDoc();
  }, [requestId, resetProposalDoc]);

  useEffect(() => {
    // Attach-proposal-email OFF (default): never auto-load/Blob-upload the
    // proposal from SharePoint — the release email is portal-link-only.
    if (!isOpen || templateType !== 'materials' || !requestId || !attachProposalEmailEnabled) return;
    loadProposal();
  }, [isOpen, templateType, requestId, attachProposalEmailEnabled, loadProposal]);

  // Templates load from the per-user Dataverse store; email-fields + attachments
  // remain per-browser (localStorage) — they're per-send scratch, not templates.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await loadEmailTemplates();
      if (!cancelled) setTemplates(t);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(EMAIL_FIELDS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setEmailFields(prev => ({
          ...prev,
          ...parsed,
          // A stale saved blank must not hide the request's campaign date.
          reviewDueDate: parsed.reviewDueDate || prev.reviewDueDate || settings.reviewDueDate || '',
        }));
      }
    } catch (e) { /* ignore */ }
    try {
      const saved = localStorage.getItem(ATTACHMENTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Backward-compat: legacy storage was a flat array of attachments.
        // Treat that as materials (where attachments were intended to land).
        if (Array.isArray(parsed)) {
          setAttachmentsByType({ materials: parsed, followup: [], thankyou: [] });
        } else {
          setAttachmentsByType({ materials: [], followup: [], thankyou: [], ...parsed });
        }
      }
    } catch (e) { /* ignore */ }
  }, []);

  // Plain function, not useCallback: it reads mountedRef/modalSessionRef
  // (deliberately outside its "deps"), and it's used only as an onClick
  // handler here — no downstream memoization depends on its identity.
  const saveTemplate = async () => {
    // Templates → per-user Dataverse store (shared with the Workbench invite
    // flow + the EmailTemplatesModal). Email-fields + attachments stay local.
    // Preference persistence itself (localStorage + saveEmailTemplates) is
    // NEVER reverted by a departed session — only the "Saved ✓" feedback and
    // its 1.5s timer are session/mounted-owned (Stage 6B3 D-save-template).
    const epoch = modalSessionRef.current;
    try {
      localStorage.setItem(EMAIL_FIELDS_STORAGE_KEY, JSON.stringify(emailFields));
      localStorage.setItem(ATTACHMENTS_STORAGE_KEY, JSON.stringify(attachmentsByType));
    } catch (e) { /* ignore */ }
    const ok = await saveEmailTemplates(templates);
    if (!mountedRef.current || modalSessionRef.current !== epoch) return;
    setTemplateSaved(ok);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (ok) {
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        if (mountedRef.current && modalSessionRef.current === epoch) setTemplateSaved(false);
      }, 1500);
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    // Stage 6B3 D6: `isUploading` is released by attempt identity regardless
    // of session epoch (the 6B2 lock pattern), but stale-session writes
    // (attachments/localStorage/error) are suppressed. Already-started bytes
    // may finish uploading — we never delete an uploaded blob or infer
    // rollback — but a stale attempt does not start its NEXT file, and does
    // not touch attachments/error for a departed session.
    const epoch = modalSessionRef.current;
    const attempt = {};
    uploadAttemptRef.current = attempt;
    const isCurrent = () => mountedRef.current && modalSessionRef.current === epoch;
    setIsUploading(true);
    let stale = false;
    try {
      const { upload } = await import('@vercel/blob/client');
      if (!isCurrent()) { stale = true; }
      for (const file of files) {
        if (stale) break;
        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/upload-handler',
        });
        if (!isCurrent()) { stale = true; break; }
        const newAttachment = { url: blob.url, filename: file.name, size: file.size };
        setAttachments((prev) => [...prev, newAttachment]);
      }
    } catch (err) {
      if (isCurrent()) setError(`Failed to upload: ${err.message}`);
    } finally {
      if (uploadAttemptRef.current === attempt) {
        uploadAttemptRef.current = null;
        if (mountedRef.current) setIsUploading(false);
      }
      e.target.value = ''; // reset input
    }
  };

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const currentTemplate = templates[templateType];
  const proposalFiles = [...(proposalDoc.allFiles || [])].sort((a, b) => {
    const ap = a.classification === 'proposal' ? 0 : 1;
    const bp = b.classification === 'proposal' ? 0 : 1;
    return ap - bp || String(a.name).localeCompare(String(b.name));
  });

  // Single-flight + modal-session guarded preview render (v3). Returns the
  // scheduled promise; callers (the Preview/Retry buttons) don't need to await it.
  const handlePreview = () => {
    const epoch = modalSessionRef.current;
    // Reentrancy guard: a second call for the SAME session (same-tick double
    // click, or Retry clicked while its own render is still pending) is a no-op —
    // at most one fetch per modal session may execute at a time.
    if (renderingEpochRef.current === epoch) return renderTailRef.current;
    // Set the lock synchronously (before setRendering) so two same-tick clicks
    // can't both observe an unlocked ref.
    renderingEpochRef.current = epoch;
    setRendering(true);

    // Snapshot the request inputs now — a queued run (waiting on a prior,
    // still-closing session's tail) must use what was current when IT was
    // requested, not whatever the compose form holds by the time its turn comes.
    const snapshotSuggestionIds = reviewers.map(r => r.suggestionId);
    const snapshotTemplateType = templateType;
    const snapshotTemplate = currentTemplate;
    const snapshotSettings = {
      signature: settings.signature || '',
      reviewDueDate: emailFields.reviewDueDate || settings.reviewDueDate || '',
      customFields: {
        proposalSendDate: emailFields.proposalSendDate || '',
        // honorarium intentionally omitted — render-emails injects the
        // Dataverse ground-truth amount server-side (S199).
      },
    };

    const run = renderTailRef.current.then(async () => {
      // Superseded before its turn (the session closed/reopened while this run
      // waited behind a prior session's tail) — skip the fetch entirely.
      if (modalSessionRef.current !== epoch) return;

      setError(null);
      setDrafts([]);
      setPreviewFailed(false);
      setProgress({ current: 0, total: 0, message: 'Rendering previews...' });

      // Bound this fetch so a hung request can't wedge renderTailRef forever —
      // ReleaseMaterialsModal stays mounted when closed, so without this a stuck render
      // would block every later session's preview too (only close/reopen abort,
      // above, gets there sooner). Preview renders are read-only server-side
      // since d040a7a3, so aborting here never strands a durable write.
      const controller = new AbortController();
      activeRenderAbortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), PREVIEW_RENDER_TIMEOUT_MS);

      try {
        const response = await fetch('/api/review-manager/render-emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            suggestionIds: snapshotSuggestionIds,
            templateType: snapshotTemplateType,
            template: snapshotTemplate,
            settings: snapshotSettings,
          }),
          signal: controller.signal,
        });
        if (modalSessionRef.current !== epoch) return;

        // Tolerate a non-JSON body (gateway timeout / crashed function) — the
        // status-code message below beats a raw JSON parse error in the banner.
        const data = await response.json().catch(() => ({}));
        if (modalSessionRef.current !== epoch) return;
        if (!response.ok) {
          const failure = new Error(renderPreviewFailureMessage({ status: response.status, serverMessage: data.error }));
          failure.isPreviewFailure = true;
          throw failure;
        }

        setDrafts(data.drafts || []);
        setStep('preview');
      } catch (err) {
        if (modalSessionRef.current !== epoch) return;
        // The compose step keeps its Preview button visible, so the retry
        // affordance already exists here; only the message needed help.
        // A timeout/close abort surfaces as AbortError, which — like any other
        // non-server failure — falls through to the network message below.
        setError(err.isPreviewFailure ? err.message : RENDER_PREVIEW_NETWORK_MESSAGE);
        setPreviewFailed(true);
      } finally {
        clearTimeout(timeoutId);
        if (activeRenderAbortRef.current === controller) activeRenderAbortRef.current = null;
      }
    });
    renderTailRef.current = run;
    run.finally(() => {
      // Clear the lock/rendering only if both the lock epoch and the current
      // modal epoch still equal the captured value — a stale run's finally must
      // never clear a newer session's lock or state.
      if (renderingEpochRef.current === epoch && modalSessionRef.current === epoch) {
        renderingEpochRef.current = null;
        setRendering(false);
      }
    });
    return run;
  };

  const updateDraft = (suggestionId, field, value) => {
    setDrafts(prev => prev.map(d =>
      d.suggestionId === suggestionId ? { ...d, [field]: value } : d
    ));
  };

  const handleSend = async () => {
    const sendable = drafts.filter(d => !d.skipped && d.candidateEmail);
    if (sendable.length === 0) {
      setError('No recipients with email to send to');
      return;
    }

    // Missing exact reviewer proposal for a "materials" release: confirm the
    // PD means to send anyway before creating the (irreversible) email
    // activities. Only gates on a verified-empty count ('ok' + 0) — an
    // unverifiable check ('unavailable') must never block a real send.
    if (templateType === 'materials' && materialsPreflight.status === 'ok' && materialsPreflight.fileCount === 0) {
      const releaseAnyway = window.confirm(
        'The expected reviewer proposal PDF is not available for this request — reviewers who follow '
          + 'their link will find nothing to download. Release anyway?'
      );
      if (!releaseAnyway) return;
    }

    const ok = window.confirm(
      `Release the proposal to ${sendable.length} reviewer${sendable.length !== 1 ? 's' : ''} now? `
        + 'This will send the materials email through Dynamics and cannot be undone.'
    );
    if (!ok) return;

    // Captured before any async work: a response arriving after this modal
    // session closed/reopened must not mutate the current session's state.
    // requestIdAtSend/priorKey are the COMMITTED identity at send start (not
    // recomputed from props later) — this is what makes the completion-cause
    // exemption's field comparisons in the session effect tautologically
    // correct for this exact attempt.
    const epoch = modalSessionRef.current;
    const requestIdAtSend = sessionContextRef.current.requestId;
    const priorKey = sessionContextRef.current.key;
    const sendToken = Symbol('send');
    // Local mutable accumulator: the authoritative source for the completion
    // summary, fed only by email_sent/email_failed/result — NOT a snapshot of
    // (possibly stale/batched) React state. `finished` makes the attempt
    // terminal: once true, no further event (a duplicate complete, or a
    // trailing error/result in a later chunk) has any effect.
    let results = { sent: [], failed: [], skipped: [] };
    let finished = false;
    setStep('sending');
    setProgress({ current: 0, total: sendable.length, message: 'Starting...' });
    setError(null);
    setSentResults(results);

    try {
      // Attach-proposal-email OFF (default): never send attachmentUrls — the
      // release email is portal-link-only ({{externalLink}} in the template).
      const manualAttachmentUrls = attachProposalEmailEnabled
        ? attachments.map(a => a.url).filter(Boolean)
        : [];
      const attachmentUrls = attachProposalEmailEnabled && templateType === 'materials' && proposalDoc.blobUrl
        ? Array.from(new Set([proposalDoc.blobUrl, ...manualAttachmentUrls]))
        : manualAttachmentUrls;

      const response = await fetch('/api/review-manager/send-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drafts: sendable.map(d => ({
            suggestionId: d.suggestionId,
            subject: d.subject,
            body: d.body,
            externalLinkExpected: d.externalLinkExpected,
          })),
          templateType,
          attachmentUrls,
          markAsSent: true,
        }),
      });
      if (modalSessionRef.current !== epoch) return;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || data.message || `Email send failed (${response.status})`);
      }
      if (!response.body || typeof response.body.getReader !== 'function') {
        throw new Error('Email send returned no readable response stream');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = null;
      // reader.cancel() is a best-effort client stream close, not a server
      // rollback: it may be absent on a test double, and its promise
      // rejection is observed everywhere it's called so it never surfaces as
      // an unhandled rejection.
      const cancelReader = () => {
        try {
          const p = reader.cancel();
          if (p && typeof p.then === 'function') p.catch(() => {});
        } catch (e) { /* best-effort */ }
      };

      while (!finished) {
        const { value, done } = await reader.read();
        if (modalSessionRef.current !== epoch) {
          cancelReader();
          return;
        }
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          // A duplicate `complete`, or a trailing `error`/`result`, arriving
          // in the SAME chunk right after this attempt already finished must
          // also have no effect.
          if (finished) break;
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'progress') {
                setProgress(prev => ({ ...prev, ...data }));
              } else if (currentEvent === 'email_sent') {
                results = { ...results, sent: [...results.sent, data] };
                setSentResults(results);
              } else if (currentEvent === 'email_failed') {
                results = { ...results, failed: [...results.failed, data] };
                setSentResults(results);
              } else if (currentEvent === 'result') {
                results = {
                  sent: data.sent || [],
                  failed: data.failed || [],
                  skipped: data.skipped || [],
                };
                setSentResults(results);
              } else if (currentEvent === 'complete') {
                // Mark this attempt finished BEFORE calling the parent — the
                // finished flag is what makes a duplicate complete or a
                // trailing error/result a no-op, and the recorded attempt is
                // what lets the session effect recognize the exact
                // membership-clear this callback is about to cause.
                finished = true;
                setSentResults(results);
                setStep('sent');
                lastSendAttemptRef.current = {
                  token: sendToken,
                  session: epoch,
                  requestId: requestIdAtSend,
                  priorKey,
                  consumed: false,
                };
                const cause = lastSendAttemptRef.current;
                const latestOnEmailsSent = sessionContextRef.current.onEmailsSent;
                if (latestOnEmailsSent) {
                  try {
                    const result = latestOnEmailsSent(cause);
                    if (result && typeof result.then === 'function') result.catch(() => {});
                  } catch (e) {
                    // Swallow: confirmed send, callback/refresh failure only —
                    // never relabel a confirmed mutation as failed.
                  }
                }
              } else if (currentEvent === 'error') {
                setError(data.message);
                setStep('preview');
              }
            } catch (e) { /* parse error, ignore */ }
            currentEvent = null;
          }
        }
      }
      if (finished) cancelReader();
    } catch (err) {
      if (modalSessionRef.current !== epoch || finished) return;
      setError(err.message);
      setStep('preview');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === 'download' ? 'Emails Ready' : 'Release proposal to reviewers'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'compose' && (
            <div className="space-y-4">
              {error && (
                <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm flex items-start justify-between gap-3">
                  <span>{error}</span>
                  {previewFailed && (
                    <button
                      type="button"
                      onClick={handlePreview}
                      disabled={rendering}
                      className="shrink-0 px-2.5 py-1 rounded-md border border-amber-300 bg-white text-amber-800 text-xs font-medium hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                    >
                      ↻ Retry
                    </button>
                  )}
                </div>
              )}

              {materialsPreflight.status === 'ok' && materialsPreflight.fileCount === 0 && (
                <div className="p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
                  The expected reviewer proposal PDF is not available for this request — reviewers
                  who follow their link will find nothing to download.
                </div>
              )}

              {materialsPreflight.status === 'unavailable' && (
                <div className="p-3 bg-gray-50 text-gray-500 rounded-lg text-sm">
                  Couldn’t verify reviewer materials availability.
                </div>
              )}

              {/* Email Fields — dates and values for placeholders */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-gray-600 mb-1">Email Fields (used in placeholders)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Review Due Date</label>
                    <input
                      type="date"
                      value={emailFields.reviewDueDate}
                      onChange={e => setEmailFields(prev => ({ ...prev, reviewDueDate: e.target.value }))}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Proposal Send Date</label>
                    <input
                      type="date"
                      value={emailFields.proposalSendDate}
                      onChange={e => setEmailFields(prev => ({ ...prev, proposalSendDate: e.target.value }))}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-400 focus:outline-none"
                    />
                  </div>
                  {/* Honorarium amount removed from per-user input (S199): it is
                      now a single Dataverse ground-truth (honorarium.default_amount)
                      read server-side at email-render time. The
                      {{customField:honorarium}} placeholder still works — it's
                      filled by the server, not this form. */}
                </div>
              </div>

              {!attachProposalEmailEnabled && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
                  Reviewers access materials via their secure portal link (included automatically) —
                  no attachment is sent. An admin can enable email attachments in Admin → Reviewer
                  Release Attachments.
                </div>
              )}

              {attachProposalEmailEnabled && (
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900">Proposal document</p>
                    {proposalDoc.loading && (
                      <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
                    )}
                  </div>
                  {proposalDoc.error === 'not_found' ? (
                    <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
                      No canonical reviewer proposal was found at
                      {' '}Reviewer Materials/Proposal_&#123;Request#&#125;.pdf.
                    </div>
                  ) : proposalDoc.error ? (
                    <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
                      {proposalDoc.error}{' '}
                      <button type="button" onClick={() => loadProposal()} className="underline font-medium">Retry</button>
                    </div>
                  ) : proposalDoc.loading ? (
                    <p className="text-sm text-gray-500">Loading the request’s proposal from SharePoint…</p>
                  ) : proposalDoc.blobUrl ? (
                    <p className="text-sm text-gray-700">
                      Will attach: <span className="font-medium">{proposalDoc.filename}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-gray-600">
                      No canonical reviewer proposal was found at
                      {' '}Reviewer Materials/Proposal_&#123;Request#&#125;.pdf.
                    </p>
                  )}

                  {proposalFiles.length > 0 && (
                    <div className="mt-3">
                      <label className="block text-xs text-gray-500 mb-1" htmlFor="proposal-document-picker">
                        Historical/manual override: choose a different request file
                      </label>
                      <select
                        id="proposal-document-picker"
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
                        value={proposalDoc.pickedKey || ''}
                        disabled={proposalDoc.loading}
                        onChange={(ev) => { if (ev.target.value) loadProposal(ev.target.value); }}
                      >
                        {!proposalDoc.pickedKey && <option value="">Select a file…</option>}
                        {proposalFiles.map((file) => {
                          const key = fileKeyOf(file);
                          return (
                            <option key={key} value={key}>
                              {file.name}{file.classification === 'proposal' ? '  ·  proposal' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Attachments — gated by the admin-configurable attach-proposal-email
                  setting (default OFF). When off, no file picker is shown, nothing
                  is uploaded to Blob, and no attachmentUrls are sent. */}
              {attachProposalEmailEnabled && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-medium text-gray-600">Attachments (included in .eml files)</p>
                  <label className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
                    isUploading ? 'bg-gray-300 text-gray-500' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}>
                    {isUploading ? 'Uploading...' : '+ Add File'}
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg"
                      multiple
                      onChange={handleFileUpload}
                      disabled={isUploading}
                    />
                  </label>
                </div>
                {attachments.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No attachments. Upload reviewer instructions, templates, etc.</p>
                ) : (
                  <div className="space-y-1">
                    {attachments.map((att, i) => (
                      <div key={i} className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-gray-200">
                        <div className="flex items-center gap-2 min-w-0">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          <span className="text-sm text-gray-700 truncate">{att.filename}</span>
                          {att.size && <span className="text-xs text-gray-400 flex-shrink-0">{formatFileSize(att.size)}</span>}
                        </div>
                        <button
                          onClick={() => removeAttachment(i)}
                          className="text-gray-400 hover:text-red-500 ml-2 flex-shrink-0"
                          title="Remove attachment"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={currentTemplate.subject}
                  onChange={e => setTemplates(prev => ({
                    ...prev,
                    [templateType]: { ...prev[templateType], subject: e.target.value },
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
                <textarea
                  value={currentTemplate.body}
                  onChange={e => setTemplates(prev => ({
                    ...prev,
                    [templateType]: { ...prev[templateType], body: e.target.value },
                  }))}
                  rows={14}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
              </div>

              {/* Placeholders reference */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-600 mb-1">Available Placeholders</p>
                <div className="flex flex-wrap gap-1">
                  {['greeting', 'recipientName', 'salutation', 'recipientLastName',
                    'proposalTitle', 'piName', 'piInstitution', 'externalLink',
                    'reviewDueDate', 'programName', 'signature',
                    'investigatorTeam', 'reviewerFormLink',
                    'customField:proposalSendDate', 'customField:honorarium',
                    'customField:proposalDueDate'].map(p => (
                    <code key={p} className="text-xs bg-white px-1.5 py-0.5 rounded border border-gray-200 text-gray-600">
                      {`{{${p}}}`}
                    </code>
                  ))}
                </div>
              </div>

              {/* Recipients summary */}
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  <strong>{reviewers.length}</strong> reviewer{reviewers.length !== 1 ? 's' : ''} selected
                  {reviewers.filter(r => !r.email).length > 0 && (
                    <span className="text-orange-600 ml-2">
                      ({reviewers.filter(r => !r.email).length} without email — will be skipped)
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
              <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
                Review and personalize each email below. Edits here are sent as-is to each
                recipient. Attachments and the sender are locked at this step.
              </div>
              {drafts.filter(d => d.skipped).length > 0 && (
                <div className="bg-orange-50 rounded-lg p-3 text-sm text-orange-800">
                  {drafts.filter(d => d.skipped).length} reviewer(s) will be skipped (no email on file).
                </div>
              )}
              <div className="space-y-3">
                {drafts.map((d) => (
                  <div key={d.suggestionId} className={`border rounded-lg p-3 ${d.skipped ? 'bg-gray-50 opacity-60' : 'bg-white'}`}>
                    <div className="flex items-baseline justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{d.candidateName}</p>
                        <p className="text-xs text-gray-500">
                          {d.candidateEmail || 'no email on file'}
                          {d.requestNumber && <span className="ml-2">· request {d.requestNumber}</span>}
                        </p>
                      </div>
                      {d.skipped && (
                        <span className="text-xs text-orange-700 font-medium">Will be skipped</span>
                      )}
                    </div>
                    {!d.skipped && (
                      <>
                        <input
                          type="text"
                          value={d.subject}
                          onChange={e => updateDraft(d.suggestionId, 'subject', e.target.value)}
                          className="w-full mb-2 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                          placeholder="Subject"
                        />
                        <textarea
                          value={d.body}
                          onChange={e => updateDraft(d.suggestionId, 'body', e.target.value)}
                          rows={8}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 font-mono"
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'sending' && (
            <div className="space-y-4 py-8">
              <div className="text-center space-y-3">
                <div className="w-12 h-12 border-4 border-gray-200 border-t-gray-600 rounded-full animate-spin mx-auto" />
                <p className="text-gray-700 font-medium">{progress.message || 'Sending...'}</p>
                {progress.total > 0 && (
                  <div className="w-full bg-gray-200 rounded-full h-2 max-w-md mx-auto">
                    <div
                      className="bg-gray-700 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                )}
                <p className="text-sm text-gray-500">{progress.current} / {progress.total}</p>
              </div>
              {(sentResults.sent.length > 0 || sentResults.failed.length > 0) && (
                <div className="border-t border-gray-200 pt-3 space-y-1 max-h-48 overflow-y-auto">
                  {sentResults.sent.map(s => (
                    <div key={`s-${s.suggestionId}`} className="flex items-center gap-2 text-sm text-green-700">
                      <span>✓</span><span>{s.candidateName}</span><span className="text-gray-400 text-xs">{s.candidateEmail}</span>
                    </div>
                  ))}
                  {sentResults.failed.map(f => (
                    <div key={`f-${f.suggestionId}`} className="flex items-center gap-2 text-sm text-red-700">
                      <span>✗</span><span>{f.candidateName}</span><span className="text-red-500 text-xs">{f.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'sent' && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${
                  sentResults.failed.length === 0 ? 'bg-green-100' : 'bg-yellow-100'
                  }`}>
                  <svg className={`w-6 h-6 ${sentResults.failed.length === 0 ? 'text-green-600' : 'text-yellow-600'}`}
                       fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-gray-900">
                  {sentResults.sent.length} sent
                  {sentResults.failed.length > 0 && `, ${sentResults.failed.length} failed`}
                  {sentResults.skipped.length > 0 && `, ${sentResults.skipped.length} skipped`}
                </p>
              </div>
              <div className="space-y-1">
                {sentResults.sent.map(s => (
                  <div key={`s-${s.suggestionId}`} className="flex items-center justify-between p-2 bg-green-50 rounded text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">✓</span>
                      <span className="font-medium text-gray-900">{s.candidateName}</span>
                      <span className="text-gray-500 text-xs">{s.candidateEmail}</span>
                    </div>
                    {s.regardingLinked && <span className="text-xs text-green-700">linked to request</span>}
                  </div>
                ))}
                {sentResults.failed.map(f => (
                  <div key={`f-${f.suggestionId}`} className="p-2 bg-red-50 rounded text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-red-600">✗</span>
                      <span className="font-medium text-gray-900">{f.candidateName}</span>
                      <span className="text-gray-500 text-xs">{f.candidateEmail}</span>
                    </div>
                    <p className="text-xs text-red-700 ml-6">{f.error}</p>
                  </div>
                ))}
                {sentResults.skipped.map(s => (
                  <div key={`sk-${s.suggestionId}`} className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm text-gray-600">
                    <span>—</span>
                    <span className="font-medium">{s.candidateName}</span>
                    <span className="text-xs">skipped ({s.reason || 'not sent'})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            disabled={step === 'sending'}
          >
            {step === 'sent' ? 'Close' : 'Cancel'}
          </button>
          <div className="flex gap-2">
            {step === 'compose' && (
              <>
                <button
                  onClick={saveTemplate}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg border border-gray-300 transition-colors"
                  title="Save these as your default templates (stored to your account)"
                >
                  {templateSaved ? 'Saved ✓' : 'Save Template'}
                </button>
                <Button onClick={handlePreview} disabled={rendering}>
                  Preview {reviewers.filter(r => r.email).length} Email{reviewers.filter(r => r.email).length !== 1 ? 's' : ''}
                </Button>
              </>
            )}
            {step === 'preview' && (
              <>
                <button
                  onClick={() => setStep('compose')}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg border border-gray-300 transition-colors"
                >
                  Back
                </button>
                <Button onClick={handleSend}>
                  Send {drafts.filter(d => !d.skipped).length} Email{drafts.filter(d => !d.skipped).length !== 1 ? 's' : ''}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
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
                              />
                            )}
                            {showActionsColumn && ['review_received', 'complete'].includes(r.reviewStatus) && (
                              <button
                                type="button"
                                onClick={() => setCloseoutReviewerId(r.suggestionId)}
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
