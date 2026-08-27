/**
 * Reviewer reminder delivery strategies for the scheduled-email ledger
 * (docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md, reviewer cron-reminders slice).
 *
 * Two workflows: 'reviewer_respond_reminder' (invited, unanswered) and
 * 'reviewer_reviewdue_reminder' (accepted, materials sent, not submitted).
 * source_record_id is the wmkf_appreviewersuggestion id; rows are created by
 * the sweeps in `reviewer-reminder-sweep.js` and delivered by
 * `scheduled-email-service.js` through this strategy contract:
 *
 *   checkEligibility(message)  → { eligible, ctx } | { stop, reason } | { defer: Date }
 *   buildActivityInput(message, ctx) → createEmailActivity input; called ONLY
 *       when no Dynamics activity exists yet. Performs the Dataverse
 *       marker+token claim (one If-Match PATCH via mintAndStore) so
 *       claim-before-send holds, and FUSES the mint with activity creation —
 *       a re-mint on retry would invalidate the token already embedded in an
 *       existing activity (latest-link-wins, single stored hash).
 *   finalize(message) → post-send bookkeeping; none here — the Dataverse
 *       marker is stamped pre-send by the claim, unlike the grantee flow's
 *       post-send deliverable status update.
 *   previewHtml(message) / noticeText(message) → projection rendering.
 *
 * Eligibility outcome semantics (send time, fresh reads):
 *   stop  — permanent for THIS row: refusal predicate fired (declined,
 *           removed, revoked, excluded, submitted…), the source vanished, the
 *           reminder config is off/incomplete, the respond token expired, or
 *           a marker appeared before we started transport (a manual nudge
 *           superseded us). The sweep may later REVIVE a stopped,
 *           never-transported row when the suggestion becomes eligible again
 *           (re-invite, config re-enabled).
 *   defer — pure time drift: the recomputed send time (due-date extension,
 *           offset/lead change) is still in the future; the row keeps its
 *           place and moves.
 */

import { mintAndStore } from '../external/token-lifecycle.js';
import { computeReviewerTokenExpiry } from '../external/reviewer-token-ttl.js';
import { resolveEffectiveReviewDueDate } from '../external/reviewer-due-date.js';
import { renderReviewerReminderHtml } from '../external/reviewer-reminder-email.js';
import { buildAutomatedEmailNotice } from '../external/automated-email-notice.js';
import { getById as getRequestById } from '../dataverse/adapters/grant-request.js';
import {
  readReminderSuggestion,
  respondRefusalReason,
  reviewDueRefusalReason,
} from './reviewer-reminder-eligibility.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACEHOLDER_URL = 'https://reviews.wmkeck.org/secure-link-created-when-sent';

export const REVIEWER_REMINDER_REQUEST_SELECT = [
  'akoya_requestid',
  'wmkf_respondoffsetdays', 'wmkf_respondreminderenabled', 'wmkf_respondreminderleaddays',
  'wmkf_reviewduedate', 'wmkf_reviewduereminderenabled', 'wmkf_reviewduereminderleaddays',
].join(',');

/**
 * Recompute the send time from live config — the sweeps freeze the same
 * arithmetic into scheduled_send_at at creation; this send-time recompute is
 * what lets a due-date extension or config change move a queued row instead
 * of firing on the stale date. Returns a ms timestamp, or null when the
 * config no longer supports this reminder (caller stops the row).
 */
export function computeReminderSendAtMs(kind, row, request) {
  if (kind === 'respond') {
    if (request.wmkf_respondreminderenabled !== true) return null;
    const offset = Number.isInteger(request.wmkf_respondoffsetdays) ? request.wmkf_respondoffsetdays : null;
    if (offset == null || !row.wmkf_emailsentat) return null;
    const lead = Number.isInteger(request.wmkf_respondreminderleaddays) ? request.wmkf_respondreminderleaddays : 0;
    const sentMs = Date.parse(row.wmkf_emailsentat);
    if (!Number.isFinite(sentMs)) return null;
    return sentMs + (offset - lead) * DAY_MS;
  }
  if (request.wmkf_reviewduereminderenabled !== true) return null;
  const dueYmd = resolveEffectiveReviewDueDate({
    overrideDate: row.wmkf_reviewduedateoverride,
    defaultDate: request.wmkf_reviewduedate,
  });
  if (!dueYmd) return null;
  const dueMs = Date.parse(`${dueYmd}T23:59:59Z`);
  if (!Number.isFinite(dueMs)) return null;
  const lead = Number.isInteger(request.wmkf_reviewduereminderleaddays) ? request.wmkf_reviewduereminderleaddays : 0;
  return dueMs - lead * DAY_MS;
}

function reminderMarker(kind, row) {
  return kind === 'respond' ? row.wmkf_respondremindersentat : row.wmkf_remindersentat;
}

function noticeFor(message) {
  return {
    senderName: message.pd_name,
    senderEmail: message.pd_email,
    kind: 'reminder',
  };
}

function buttonLabelFor(kind) {
  return kind === 'respond' ? 'Accept or decline' : 'Open your review';
}

function makeStrategy(kind) {
  return {
    async checkEligibility(message, { force = false } = {}) {
      const { row, error } = await readReminderSuggestion(message.source_record_id);
      if (error) throw error; // transient read → retryable failure, never a stop
      if (!row?.wmkf_appreviewersuggestionid) return { stop: true, reason: 'source_not_found' };

      const refusal = (kind === 'respond' ? respondRefusalReason : reviewDueRefusalReason)(
        row, message.request_id,
      );
      if (refusal) return { stop: true, reason: refusal };

      // A marker on a row that never claimed means someone else (the manual
      // nudge path, or a pre-ledger send) already reminded this reviewer — our
      // queued copy is redundant. But once THIS row claimed
      // (claim_committed_at, stamped just before the marker/token PATCH) the
      // marker is our own: a retry after a post-claim crash must resume the
      // send (correlation recovery, then re-mint if no activity exists), not
      // falsely stop with a "reminded" record whose email never went out.
      if (reminderMarker(kind, row) && !message.dynamics_email_id && !message.claim_committed_at) {
        return { stop: true, reason: 'already_reminded' };
      }

      // Request read failures propagate (retryable); a hard 404 stops.
      let request;
      try {
        request = await getRequestById(message.request_id, { select: REVIEWER_REMINDER_REQUEST_SELECT });
      } catch (requestError) {
        if (requestError?.status === 404) return { stop: true, reason: 'source_not_found' };
        throw requestError;
      }
      if (!request?.akoya_requestid) return { stop: true, reason: 'source_not_found' };

      const sendAtMs = computeReminderSendAtMs(kind, row, request);
      if (sendAtMs == null) return { stop: true, reason: 'reminder_config_off' };
      // force = the PD's own send-now: their explicit intent overrides the
      // recomputed schedule, never the hard eligibility above/below.
      if (sendAtMs > Date.now() && !force) return { defer: new Date(sendAtMs) };

      if (kind === 'respond') {
        // Only nudge while the reviewer's current token is live — a dead link
        // means the offer window closed (cron §3.B parity). A re-invite resets
        // the marker and token; the sweep revives the stopped row then.
        // EXCEPT when this row already claimed and holds no activity: the
        // current token is our own rotation and we are about to re-mint a
        // fresh one anyway — stopping here would strand a "reminded" marker
        // with no email ever sent (same failure shape the claim guards).
        const resumingOwnClaim = Boolean(message.claim_committed_at) && !message.dynamics_email_id;
        const expires = row.wmkf_externaltokenexpires ? Date.parse(row.wmkf_externaltokenexpires) : null;
        if (!resumingOwnClaim && (expires == null || !Number.isFinite(expires) || expires <= Date.now())) {
          return { stop: true, reason: 'token_expired' };
        }
      }

      return { eligible: true, ctx: { row, request } };
    },

    async buildActivityInput(message, ctx) {
      const { row, request } = ctx;
      if (!row._etag) {
        throw new Error('reviewer reminder claim requires a fresh ETag');
      }
      const reviewDueDate = resolveEffectiveReviewDueDate({
        overrideDate: row.wmkf_reviewduedateoverride,
        defaultDate: request.wmkf_reviewduedate,
      });
      const claimPatch = kind === 'respond'
        ? { wmkf_respondremindersentat: new Date().toISOString() }
        : {
            wmkf_remindersentat: new Date().toISOString(),
            wmkf_remindercount: (Number.isInteger(row.wmkf_remindercount) ? row.wmkf_remindercount : 0) + 1,
          };
      // ONE conditional PATCH lands marker + fresh token before any transport
      // (claim-before-send). A 412 propagates → retryable failure; the next
      // attempt re-authorizes from a fresh read.
      const { url } = await mintAndStore({
        suggestionId: message.source_record_id,
        requestId: message.request_id,
        expiresAt: computeReviewerTokenExpiry({
          accepted: kind === 'reviewdue',
          reviewDueDate,
        }),
        actingUserSystemId: message.pd_systemuser_id,
        ifMatch: row._etag,
        writeFields: claimPatch,
      });
      return {
        subject: message.subject,
        body: renderReviewerReminderHtml({
          bodyText: message.body_text,
          url,
          buttonLabel: buttonLabelFor(kind),
          automationNotice: noticeFor(message),
        }),
        from: message.pd_email,
        to: parseRecipientList(message.to_recipients),
        cc: parseRecipientList(message.cc_recipients),
        regardingId: message.request_id,
        regardingType: 'akoya_request',
        actingUserSystemId: message.pd_systemuser_id,
        noFallback: true,
      };
    },

    // Marker already stamped pre-send by the claim; nothing to finalize in
    // Dataverse.
    async finalize() {
      return null;
    },

    previewHtml(message) {
      return renderReviewerReminderHtml({
        bodyText: message.body_text,
        url: PLACEHOLDER_URL,
        buttonLabel: buttonLabelFor(kind),
        automationNotice: noticeFor(message),
      });
    },

    noticeText(message) {
      return buildAutomatedEmailNotice(noticeFor(message));
    },
  };
}

function parseRecipientList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const REVIEWER_RESPOND_WORKFLOW = 'reviewer_respond_reminder';
export const REVIEWER_REVIEWDUE_WORKFLOW = 'reviewer_reviewdue_reminder';

export const REVIEWER_REMINDER_STRATEGIES = {
  [REVIEWER_RESPOND_WORKFLOW]: makeStrategy('respond'),
  [REVIEWER_REVIEWDUE_WORKFLOW]: makeStrategy('reviewdue'),
};
