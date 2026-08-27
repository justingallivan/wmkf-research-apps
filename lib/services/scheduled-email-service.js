/**
 * Personalized scheduled-email coordinator.
 *
 * One durable Postgres row binds a PD's exact editable draft to a future send.
 * Dynamics activity correlation + readback makes retries reconcile transport
 * state instead of blindly creating a second email. Secure grantee links are
 * minted only while creating the real recipient activity, never for previews.
 *
 * The per-PD daily digest (docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md) is the
 * single notification surface: approval-pending and upcoming sections recur
 * until actioned; the sent-FYI section is receipted via digest_fyi_at so a
 * cron retry never re-announces a send.
 */

import * as emailActivityAdapter from '../dataverse/adapters/email-activity.js';
import * as granteeDeliverableAdapter from '../dataverse/adapters/grantee-deliverable.js';
import { mintForRequest } from '../external/grantee-token-lifecycle.js';
import {
  buildGranteeReminderNoticeText,
  composeScheduledGranteeReminderBodyText,
  renderGranteeInviteHtml,
} from '../external/grantee-invite-email.js';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus.js';
import { REVIEWER_REMINDER_STRATEGIES } from './reviewer-reminder-workflows.js';
import * as store from './scheduled-email-store.js';

const SEND_ACCEPTED_STATUS_CODES = new Set([3, 6, 7]);
const PLACEHOLDER_URL = 'https://grantees.wmkeck.org/secure-link-created-when-sent';
const DELIVERABLE_SELECT = 'wmkf_granteedeliverableid,wmkf_deliverablestatus,wmkf_remindeddate';

const DEFAULT_DEPENDENCIES = Object.freeze({
  getMessage: store.getScheduledEmail,
  claimSend: store.claimScheduledEmailSend,
  recordEmailActivity: store.recordScheduledEmailActivity,
  recordSendRequested: store.recordScheduledEmailSendRequested,
  recordSent: store.recordScheduledEmailSent,
  recordFailure: store.recordScheduledEmailFailure,
  recordFinalized: store.recordScheduledEmailFinalized,
  cancelForSource: store.cancelScheduledEmailForSource,
  deferSend: store.deferScheduledEmailSend,
  recordClaim: store.recordScheduledEmailClaim,
  listDigestRows: store.listScheduledEmailDigestRows,
  markDigestFyi: store.markScheduledEmailsDigestFyi,
  claimDigestRun: store.claimDigestRun,
  recordDigestRunActivity: store.recordDigestRunActivity,
  markDigestRunAccepted: store.markDigestRunAccepted,
  markDigestRunFyiStamped: store.markDigestRunFyiStamped,
  getDeliverable: (id) => granteeDeliverableAdapter.getById(id, { select: DELIVERABLE_SELECT }),
  updateDeliverable: granteeDeliverableAdapter.update,
  createEmailActivity: emailActivityAdapter.create,
  sendEmail: emailActivityAdapter.send,
  getEmailActivity: emailActivityAdapter.getById,
  findEmailByCorrelation: emailActivityAdapter.findByCorrelation,
  mintForRequest,
});

function parseRecipients(value) {
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

function accepted(email) {
  return SEND_ACCEPTED_STATUS_CODES.has(Number(email?.statuscode));
}

function correlationKey(kind, id) {
  return `wmkf-scheduled-${kind}:${id}`;
}

function publicBaseUrl() {
  const configured = String(process.env.NEXTAUTH_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const production = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim().replace(/\/$/, '');
  return production ? `https://${production}` : '';
}

function formatDateTime(value) {
  const date = new Date(value);
  return date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function recoverByCorrelation(key, dependencies) {
  const matches = await dependencies.findEmailByCorrelation(key);
  if (matches.length > 1) {
    throw new Error(`Multiple Dynamics email activities share correlation ${key}`);
  }
  return matches[0] || null;
}

async function resolveEmailActivity(message, createInput, dependencies, persist) {
  let email = message.dynamics_email_id
    ? await dependencies.getEmailActivity(message.dynamics_email_id).catch(() => null)
    : null;
  if (!email) email = await recoverByCorrelation(correlationKey('recipient', message.id), dependencies);
  if (!email) {
    try {
      const emailId = await dependencies.createEmailActivity({
        ...createInput,
        correlationKey: correlationKey('recipient', message.id),
      });
      message = await persist(message, emailId);
      if (!message) throw new Error('Dynamics email identity could not be persisted');
      email = await dependencies.getEmailActivity(emailId);
    } catch (error) {
      email = await recoverByCorrelation(correlationKey('recipient', message.id), dependencies);
      if (!email) throw error;
      message = await persist(message, email.activityid);
      if (!message) throw new Error('Recovered Dynamics email identity could not be persisted');
    }
  }
  return { message, email };
}

async function sourceStillEligible(message, dependencies) {
  let deliverable;
  try {
    deliverable = await dependencies.getDeliverable(message.deliverable_id);
  } catch (error) {
    // Only a confirmed-deleted source (404) is ineligible. Any other read
    // failure must propagate so the send fails retryable instead of the
    // message being permanently stopped on a transient Dataverse error.
    if (error?.status === 404) return null;
    throw error;
  }
  return deliverable?.wmkf_deliverablestatus === GRANTEE_DELIVERABLE_STATUS.INVITED
    ? deliverable
    : null;
}

/**
 * Per-workflow delivery strategy. The grantee strategy reads its collaborators
 * from the injected dependencies bag (test seam predates the dispatch); the
 * reviewer strategies (`reviewer-reminder-workflows.js`) bind their own
 * imports. Contract: checkEligibility → {eligible, ctx} | {stop} | {defer};
 * buildActivityInput runs ONLY when no Dynamics activity exists (mint fused
 * with creation); finalize is the post-send bookkeeping.
 */
function strategyFor(workflowType, dependencies) {
  if (workflowType === 'grantee_abstract_reminder') {
    return {
      async checkEligibility(message) {
        const deliverable = await sourceStillEligible(message, dependencies);
        return deliverable ? { eligible: true, ctx: { deliverable } } : { stop: true };
      },
      async buildActivityInput(message) {
        const { url } = await dependencies.mintForRequest({ requestId: message.request_id });
        const bodyText = composeScheduledGranteeReminderBodyText({
          bodyText: message.body_text,
          signatureText: message.signature_text,
        });
        return {
          subject: message.subject,
          body: renderGranteeInviteHtml({
            bodyText,
            url,
            automationNotice: {
              senderName: message.pd_name,
              senderEmail: message.pd_email,
              kind: 'reminder',
            },
          }),
          from: message.pd_email,
          to: parseRecipients(message.to_recipients),
          cc: parseRecipients(message.cc_recipients),
          regardingId: message.request_id,
          regardingType: 'akoya_request',
          actingUserSystemId: message.pd_systemuser_id,
          noFallback: true,
        };
      },
      async finalize(message) {
        const deliverable = await dependencies.getDeliverable(message.deliverable_id);
        if (deliverable.wmkf_deliverablestatus === GRANTEE_DELIVERABLE_STATUS.INVITED) {
          await dependencies.updateDeliverable(
            message.deliverable_id,
            {
              wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT,
              wmkf_remindeddate: message.sent_at || new Date().toISOString(),
            },
            { ifMatch: deliverable._etag },
          );
        }
        return null;
      },
      previewHtml(message) {
        return renderGranteeInviteHtml({
          bodyText: composeScheduledGranteeReminderBodyText({
            bodyText: message.body_text,
            signatureText: message.signature_text,
          }),
          url: PLACEHOLDER_URL,
          automationNotice: {
            senderName: message.pd_name,
            senderEmail: message.pd_email,
            kind: 'reminder',
          },
        });
      },
      noticeText(message) {
        return buildGranteeReminderNoticeText({
          senderName: message.pd_name,
          senderEmail: message.pd_email,
        });
      },
    };
  }
  const strategy = REVIEWER_REMINDER_STRATEGIES[workflowType];
  if (!strategy) throw new Error(`Unknown scheduled-email workflow: ${workflowType}`);
  return strategy;
}

export function scheduledSendAtForInvitation(invitedDate) {
  const invited = new Date(invitedDate);
  if (Number.isNaN(invited.getTime())) throw new TypeError('invitedDate must be valid');
  const eligibleAt = new Date(invited.getTime() + 12 * 24 * 60 * 60 * 1000);
  let scheduledAt = new Date(Date.UTC(
    eligibleAt.getUTCFullYear(),
    eligibleAt.getUTCMonth(),
    eligibleAt.getUTCDate(),
    8,
  ));
  if (scheduledAt < eligibleAt) {
    scheduledAt = new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000);
  }
  return scheduledAt;
}

export function renderScheduledEmailPreview(message, dependencies = DEFAULT_DEPENDENCIES) {
  return strategyFor(message.workflow_type, dependencies).previewHtml(message);
}

export function projectScheduledEmail(message, dependencies = DEFAULT_DEPENDENCIES) {
  if (!message) return null;
  const strategy = strategyFor(message.workflow_type, dependencies);
  return {
    id: message.id,
    workflowType: message.workflow_type,
    requestId: message.request_id,
    recipientName: message.recipient_name,
    recipientContactIds: parseRecipients(message.recipient_contact_ids),
    toRecipients: parseRecipients(message.to_recipients),
    ccRecipients: parseRecipients(message.cc_recipients),
    subject: message.subject,
    bodyText: message.body_text,
    signatureText: message.signature_text,
    automationNotice: strategy.noticeText(message),
    scheduledSendAt: message.scheduled_send_at,
    approvalRequired: message.approval_required === true,
    status: message.status,
    version: message.version,
    reviewedAt: message.reviewed_at,
    approvedAt: message.approved_at,
    editedAt: message.edited_at,
    stoppedAt: message.stopped_at,
    sentAt: message.sent_at,
    error: message.last_error_message,
    previewHtml: strategy.previewHtml(message),
  };
}

export async function finalizeScheduledEmail(message, dependencies = DEFAULT_DEPENDENCIES) {
  if (!message || message.status !== 'sent' || message.finalized_at) return message;
  await strategyFor(message.workflow_type, dependencies).finalize(message);
  return dependencies.recordFinalized(message.id);
}

export async function deliverScheduledEmail(
  id,
  { force = false, pdSystemUserId = null, expectedVersion = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  let message = await dependencies.claimSend(id, { force, pdSystemUserId, expectedVersion });
  if (!message) return { skipped: true };

  try {
    // Inside the try so an unknown workflow records a failure and releases the
    // lease instead of stranding the claim until lock expiry.
    const strategy = strategyFor(message.workflow_type, dependencies);
    // force (the PD's own send-now) overrides SCHEDULING only: the strategy
    // skips its timing-defer verdict but still enforces hard eligibility.
    const check = await strategy.checkEligibility(message, { force });
    if (check.defer) {
      const deferred = await dependencies.deferSend(message, check.defer);
      if (deferred) return { deferred: true, message: projectScheduledEmail(deferred, dependencies) };
      // Defer refused: the send was actually requested on a prior attempt
      // (send_requested_at set — an unsent draft alone still defers) —
      // complete that send below instead of leaving the row leased in
      // 'sending'. The existing activity carries the original token/body,
      // so no ctx (and no re-mint) is needed.
    } else if (!check.eligible) {
      const stopped = await dependencies.cancelForSource(message.id);
      return { stopped: true, message: projectScheduledEmail(stopped, dependencies) };
    }

    let existing = message.dynamics_email_id
      ? await dependencies.getEmailActivity(message.dynamics_email_id).catch(() => null)
      : await recoverByCorrelation(correlationKey('recipient', message.id), dependencies);

    if (!existing) {
      if (check.defer) {
        // Defer was refused (send_requested_at recorded) yet the activity
        // cannot be resolved right now — fail retryable rather than re-mint
        // over an activity whose send already started.
        throw new Error('Deferred send has transport state but its Dynamics activity could not be resolved');
      }
      // Claim ownership BEFORE the strategy's external claim (reviewer
      // strategies stamp a Dataverse marker + rotate the token inside
      // buildActivityInput): a crash between that PATCH and activity
      // persistence must leave a row whose retry recognizes the marker as
      // its own instead of stopping as 'already_reminded'.
      message = await dependencies.recordClaim(message);
      if (!message) throw new Error('Send claim could not be persisted');
      const createInput = await strategy.buildActivityInput(message, check.ctx);
      const resolved = await resolveEmailActivity(
        message,
        createInput,
        dependencies,
        dependencies.recordEmailActivity,
      );
      message = resolved.message;
      existing = resolved.email;
    } else if (!message.dynamics_email_id) {
      message = await dependencies.recordEmailActivity(message, existing.activityid);
      if (!message) throw new Error('Recovered Dynamics email identity could not be persisted');
    }

    if (!accepted(existing)) {
      const recheck = await strategy.checkEligibility(message, { force });
      if (!recheck.eligible && !recheck.defer) {
        const stopped = await dependencies.cancelForSource(message.id);
        return { stopped: true, message: projectScheduledEmail(stopped, dependencies) };
      }
      // A defer verdict here (recomputed send time moved out) with the
      // activity already created: keep the existing activity and move the
      // send — correlation recovery re-attaches it at the new time.
      if (recheck.defer) {
        const deferred = await dependencies.deferSend(message, recheck.defer);
        if (deferred) return { deferred: true, message: projectScheduledEmail(deferred, dependencies) };
        // Defer refused (send actually requested): fall through and send.
      }
      message = await dependencies.recordSendRequested(message);
      if (!message) throw new Error('Send intent could not be persisted');
      try {
        await dependencies.sendEmail(message.dynamics_email_id, {
          actingUserSystemId: message.pd_systemuser_id,
          noFallback: true,
        });
      } catch (error) {
        const ambiguous = await dependencies.getEmailActivity(message.dynamics_email_id).catch(() => null);
        if (!accepted(ambiguous)) throw error;
      }
      existing = await dependencies.getEmailActivity(message.dynamics_email_id).catch(() => existing);
    }

    const sent = await dependencies.recordSent(message, existing);
    if (!sent) throw new Error('Transport acceptance could not be persisted');
    const finalized = await finalizeScheduledEmail(sent, dependencies);
    return { sent: true, message: projectScheduledEmail(finalized || sent) };
  } catch (error) {
    if (message?.lease_token) {
      await dependencies.recordFailure(message, error, error?.code || 'scheduled_email_send_failed').catch(() => {});
    }
    throw error;
  }
}

/* ------------------------------ daily digest ----------------------------- */

function digestItemHtml(message, base) {
  const href = `${base}/scheduled-emails?message=${encodeURIComponent(message.id)}`;
  return `<li style="margin:0 0 10px;"><a href="${escapeHtml(href)}">${escapeHtml(message.subject)}</a> — to ${escapeHtml(message.recipient_name)}, ${escapeHtml(formatDateTime(message.scheduled_send_at))}</li>`;
}

function digestSectionHtml(title, note, items, base) {
  if (items.length === 0) return '';
  return `<h3 style="margin:18px 0 6px;font-size:15px;">${escapeHtml(title)}</h3>
<p style="margin:0 0 8px;color:#475467;font-size:13px;">${escapeHtml(note)}</p>
<ul style="margin:0;padding-left:18px;">${items.map((m) => digestItemHtml(m, base)).join('\n')}</ul>`;
}

/**
 * Groups all digest-relevant rows per PD. Exported for the cron.
 * A PD appears only when at least one section is non-empty.
 */
export function groupDigestRowsByPd(rows) {
  const byPd = new Map();
  for (const row of rows) {
    let entry = byPd.get(row.pd_systemuser_id);
    if (!entry) {
      entry = {
        pdSystemUserId: row.pd_systemuser_id,
        pdName: row.pd_name,
        pdEmail: row.pd_email,
        approvalPending: [],
        upcoming: [],
        sentFyi: [],
      };
      byPd.set(row.pd_systemuser_id, entry);
    }
    if (row.status === 'sent') {
      entry.sentFyi.push(row);
    } else if (row.approval_required === true && !row.approved_at) {
      entry.approvalPending.push(row);
    } else {
      entry.upcoming.push(row);
    }
  }
  return [...byPd.values()];
}

/**
 * Sends one digest email to one PD and stamps the FYI receipts.
 *
 * Concurrency + retry contract (scheduled_email_digest_runs; adversarial
 * review 2026-08-26): the per-(PD, UTC day) run row is claimed with a lease
 * before any Dynamics work — one digest per PD per day survives concurrent
 * invocations. FYI receipts are stamped ONLY from the run's frozen
 * membership, never from the freshly built group: a row sent after today's
 * digest keeps digest_fyi_at NULL and appears in tomorrow's digest instead
 * of being silently receipted. The Dynamics correlation key remains the
 * backstop for an activity created before the run row recorded it.
 */
export async function sendScheduledEmailDigest(group, dependencies = DEFAULT_DEPENDENCIES) {
  const base = publicBaseUrl();
  if (!base) throw new Error('NEXTAUTH_URL or VERCEL_PROJECT_PRODUCTION_URL is required for digests');
  const sender = String(process.env.NOTIFICATION_EMAIL_FROM || '').trim();
  if (!sender) throw new Error('NOTIFICATION_EMAIL_FROM is required for digests');

  const day = new Date().toISOString().slice(0, 10);
  const key = `wmkf-scheduled-digest:${group.pdSystemUserId}:${day}`;

  const { claimed, run } = await dependencies.claimDigestRun({
    pdSystemUserId: group.pdSystemUserId,
    digestDay: day,
    fyiMessageIds: group.sentFyi.map((m) => m.id),
  });

  if (!claimed) {
    if (run?.accepted_at) {
      // Crash-after-send recovery: stamp exactly what that digest contained.
      const membership = parseRecipients(run.fyi_message_ids);
      const stamped = membership.length ? await dependencies.markDigestFyi(membership) : 0;
      await dependencies.markDigestRunFyiStamped(group.pdSystemUserId, day);
      return { sent: false, recovered: true, fyiStamped: stamped };
    }
    // Another live invocation holds the lease (or a read race): do nothing.
    return { sent: false, skipped: true, fyiStamped: 0 };
  }

  const membership = parseRecipients(run.fyi_message_ids);

  let digest = run.activity_id
    ? await dependencies.getEmailActivity(run.activity_id).catch(() => null)
    : null;
  if (!digest) digest = await recoverByCorrelation(key, dependencies);

  if (!digest || !accepted(digest)) {
    if (!digest) {
      const sections = [
        digestSectionHtml(
          'Waiting on your approval',
          'These will NOT send until you approve them.',
          group.approvalPending,
          base,
        ),
        digestSectionHtml(
          'Sending soon unless you act',
          'These send automatically at the time shown. Open one to edit, stop, or send it now.',
          group.upcoming,
          base,
        ),
        digestSectionHtml(
          'Sent on your behalf',
          'Already sent, with your automation disclosure; replies go directly to you.',
          group.sentFyi,
          base,
        ),
      ].filter(Boolean).join('\n');
      const html = `<p>Your automated email summary:</p>\n${sections}\n<p style="margin-top:18px;"><a href="${escapeHtml(`${base}/scheduled-emails`)}" style="display:inline-block;padding:12px 18px;color:#fff;background:#1a4a7a;text-decoration:none;border-radius:4px;font-weight:600;">Open scheduled emails</a></p>`;
      const emailId = await dependencies.createEmailActivity({
        subject: `Automated email summary for ${day}`,
        body: html,
        from: sender,
        to: group.pdEmail,
        correlationKey: key,
      });
      // Persist the activity identity BEFORE requesting transport.
      await dependencies.recordDigestRunActivity(group.pdSystemUserId, day, emailId);
      digest = await dependencies.getEmailActivity(emailId);
    } else if (!run.activity_id) {
      await dependencies.recordDigestRunActivity(group.pdSystemUserId, day, digest.activityid);
    }
    if (!accepted(digest)) {
      try {
        await dependencies.sendEmail(digest.activityid);
      } catch (error) {
        const ambiguous = await dependencies.getEmailActivity(digest.activityid).catch(() => null);
        if (!accepted(ambiguous)) throw error;
      }
    }
  }

  await dependencies.markDigestRunAccepted(group.pdSystemUserId, day);
  const stamped = membership.length ? await dependencies.markDigestFyi(membership) : 0;
  await dependencies.markDigestRunFyiStamped(group.pdSystemUserId, day);
  return { sent: true, fyiStamped: stamped };
}

export const SCHEDULED_EMAIL_PLACEHOLDER_URL = PLACEHOLDER_URL;
