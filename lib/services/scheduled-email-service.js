/**
 * Personalized scheduled-email coordinator.
 *
 * One durable Postgres row binds a PD's exact editable draft to a future send.
 * Dynamics activity correlation + readback makes retries reconcile transport
 * state instead of blindly creating a second email. Secure grantee links are
 * minted only while creating the real recipient activity, never for previews.
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
  claimNotification: store.claimScheduledEmailNotification,
  recordNotificationActivity: store.recordScheduledEmailNotificationActivity,
  recordNotified: store.recordScheduledEmailNotified,
  recordNotificationFailure: store.recordScheduledEmailNotificationFailure,
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

function reviewNotificationHtml(message) {
  const base = publicBaseUrl();
  if (!base) throw new Error('NEXTAUTH_URL or VERCEL_PROJECT_PRODUCTION_URL is required for review notifications');
  const href = `${base}/scheduled-emails?message=${encodeURIComponent(message.id)}`;
  return `<p>A personalized reminder to ${escapeHtml(message.recipient_name)} is scheduled to be sent automatically on your behalf at <strong>${escapeHtml(formatDateTime(message.scheduled_send_at))}</strong>.</p>
<p><strong>Recipient:</strong> ${escapeHtml(parseRecipients(message.to_recipients).join(', '))}<br>
<strong>Subject:</strong> ${escapeHtml(message.subject)}</p>
<p>You may review, edit, send now, or stop this message. If you take no action, it will be sent automatically as shown.</p>
<p><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 18px;color:#fff;background:#1a4a7a;text-decoration:none;border-radius:4px;font-weight:600;">Review scheduled email</a></p>`;
}

async function recoverByCorrelation(key, dependencies) {
  const matches = await dependencies.findEmailByCorrelation(key);
  if (matches.length > 1) {
    throw new Error(`Multiple Dynamics email activities share correlation ${key}`);
  }
  return matches[0] || null;
}

async function resolveEmailActivity(message, kind, createInput, dependencies, persist) {
  let email = message[kind === 'recipient' ? 'dynamics_email_id' : 'notification_email_id']
    ? await dependencies.getEmailActivity(
      message[kind === 'recipient' ? 'dynamics_email_id' : 'notification_email_id'],
    ).catch(() => null)
    : null;
  if (!email) email = await recoverByCorrelation(correlationKey(kind, message.id), dependencies);
  if (!email) {
    try {
      const emailId = await dependencies.createEmailActivity({
        ...createInput,
        correlationKey: correlationKey(kind, message.id),
      });
      message = await persist(message, emailId);
      if (!message) throw new Error('Dynamics email identity could not be persisted');
      email = await dependencies.getEmailActivity(emailId);
    } catch (error) {
      email = await recoverByCorrelation(correlationKey(kind, message.id), dependencies);
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

export function renderScheduledEmailPreview(message) {
  const bodyText = composeScheduledGranteeReminderBodyText({
    bodyText: message.body_text,
    signatureText: message.signature_text,
  });
  return renderGranteeInviteHtml({
    bodyText,
    url: PLACEHOLDER_URL,
    automationNotice: {
      senderName: message.pd_name,
      senderEmail: message.pd_email,
      kind: 'reminder',
    },
  });
}

export function projectScheduledEmail(message) {
  if (!message) return null;
  return {
    id: message.id,
    workflowType: message.workflow_type,
    requestId: message.request_id,
    recipientName: message.recipient_name,
    toRecipients: parseRecipients(message.to_recipients),
    ccRecipients: parseRecipients(message.cc_recipients),
    subject: message.subject,
    bodyText: message.body_text,
    signatureText: message.signature_text,
    automationNotice: buildGranteeReminderNoticeText({
      senderName: message.pd_name,
      senderEmail: message.pd_email,
    }),
    scheduledSendAt: message.scheduled_send_at,
    reviewAvailableAt: message.review_available_at,
    reviewLeadDays: message.review_lead_days,
    status: message.status,
    version: message.version,
    reviewedAt: message.reviewed_at,
    approvedAt: message.approved_at,
    editedAt: message.edited_at,
    stoppedAt: message.stopped_at,
    notifiedAt: message.notified_at,
    sentAt: message.sent_at,
    error: message.last_error_message,
    previewHtml: renderScheduledEmailPreview(message),
  };
}

export async function notifyScheduledEmailReview(id, dependencies = DEFAULT_DEPENDENCIES) {
  let message = await dependencies.claimNotification(id);
  if (!message) return { skipped: true };
  try {
    const sender = String(process.env.NOTIFICATION_EMAIL_FROM || '').trim();
    if (!sender) throw new Error('NOTIFICATION_EMAIL_FROM is required for review notifications');
    let resolved = await resolveEmailActivity(
      message,
      'review',
      {
        subject: `Review available: email to ${message.recipient_name} scheduled ${formatDateTime(message.scheduled_send_at)}`,
        body: reviewNotificationHtml(message),
        from: sender,
        to: message.pd_email,
      },
      dependencies,
      dependencies.recordNotificationActivity,
    );
    message = resolved.message;
    if (!accepted(resolved.email)) {
      try {
        await dependencies.sendEmail(message.notification_email_id);
      } catch (error) {
        const ambiguous = await dependencies.getEmailActivity(message.notification_email_id).catch(() => null);
        if (!accepted(ambiguous)) throw error;
      }
    }
    const notified = await dependencies.recordNotified(message);
    if (!notified) throw new Error('Review notification receipt could not be persisted');
    return { notified: true, message: projectScheduledEmail(notified) };
  } catch (error) {
    await dependencies.recordNotificationFailure(message, error).catch(() => {});
    throw error;
  }
}

export async function finalizeScheduledEmail(message, dependencies = DEFAULT_DEPENDENCIES) {
  if (!message || message.status !== 'sent' || message.finalized_at) return message;
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
    if (!await sourceStillEligible(message, dependencies)) {
      const stopped = await dependencies.cancelForSource(message.id);
      return { stopped: true, message: projectScheduledEmail(stopped) };
    }

    let existing = message.dynamics_email_id
      ? await dependencies.getEmailActivity(message.dynamics_email_id).catch(() => null)
      : await recoverByCorrelation(correlationKey('recipient', message.id), dependencies);

    if (!existing) {
      const { url } = await dependencies.mintForRequest({ requestId: message.request_id });
      const bodyText = composeScheduledGranteeReminderBodyText({
        bodyText: message.body_text,
        signatureText: message.signature_text,
      });
      const html = renderGranteeInviteHtml({
        bodyText,
        url,
        automationNotice: {
          senderName: message.pd_name,
          senderEmail: message.pd_email,
          kind: 'reminder',
        },
      });
      const resolved = await resolveEmailActivity(
        message,
        'recipient',
        {
          subject: message.subject,
          body: html,
          from: message.pd_email,
          to: parseRecipients(message.to_recipients),
          cc: parseRecipients(message.cc_recipients),
          regardingId: message.request_id,
          regardingType: 'akoya_request',
          actingUserSystemId: message.pd_systemuser_id,
          noFallback: true,
        },
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
      if (!await sourceStillEligible(message, dependencies)) {
        const stopped = await dependencies.cancelForSource(message.id);
        return { stopped: true, message: projectScheduledEmail(stopped) };
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

export const SCHEDULED_EMAIL_PLACEHOLDER_URL = PLACEHOLDER_URL;
