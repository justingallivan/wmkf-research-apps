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
import { testRequestIsolationEnabled } from './test-requests/isolation.js';
import { resolveRequestTestState } from './test-requests/request-test-state.js';
import {
  buildGranteeReminderNoticeText,
  composeScheduledGranteeReminderBodyText,
  renderGranteeInviteHtml,
} from '../external/grantee-invite-email.js';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus.js';
import { classifyEmailDispatchError } from '../../shared/utils/email-send-outcome.js';
import {
  isSendUnconfirmed,
  scheduledEmailAttentionReason,
} from '../../shared/utils/scheduled-email-attention.js';
import * as store from './scheduled-email-store.js';

const ERROR_CODES = store.SCHEDULED_EMAIL_ERROR_CODES;

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
  claimReconciliation: store.claimScheduledEmailReconciliation,
  releaseReconciliation: store.releaseScheduledEmailReconciliation,
  claimActivityRead: store.claimScheduledEmailActivityRead,
  clearActivityCode: store.clearScheduledEmailActivityCode,
  recordStoppedSent: store.recordStoppedScheduledEmailSent,
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
  isolationEnabled: testRequestIsolationEnabled,
  resolveTestState: resolveRequestTestState,
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

/**
 * A5: the recipient activity's correlation key carries the row's current
 * recipient_generation. Generation 0 keeps the pre-059 key so existing rows
 * still recover; a PD-handoff rebuild increments the generation, so a draft a
 * crashed worker left under the previous key is never adopted.
 */
export function recipientCorrelationKey(message) {
  const generation = Number(message?.recipient_generation) || 0;
  const base = correlationKey('recipient', message.id);
  return generation > 0 ? `${base}:g${generation}` : base;
}

/**
 * A3: read the STORED activity. Absence is never assumed from a failed read.
 * 404 → activity_missing (definitive, manual recovery); 403 → activity_forbidden
 * (transient, stays in the read lane); 401/408/429/5xx/network → transient
 * read failure. Each throws a coded error; only a successful read returns.
 */
async function readStoredActivity(message, dependencies) {
  try {
    const email = await dependencies.getEmailActivity(message.dynamics_email_id);
    if (!email) {
      throw Object.assign(new Error(`Dynamics email ${message.dynamics_email_id} was not returned.`), { status: 404 });
    }
    return email;
  } catch (error) {
    const status = Number(error?.status);
    const coded = new Error(
      status === 404
        ? `Dynamics email ${message.dynamics_email_id} no longer exists.`
        : `Could not read Dynamics email ${message.dynamics_email_id}: ${error?.message || error}`,
    );
    coded.cause = error;
    coded.status = Number.isFinite(status) ? status : null;
    if (status === 404) {
      coded.code = ERROR_CODES.ACTIVITY_MISSING;
      coded.retryable = false;
    } else if (status === 403) {
      coded.code = ERROR_CODES.ACTIVITY_FORBIDDEN;
      coded.retryable = true;
    } else {
      coded.code = 'scheduled_email_activity_read_failed';
      coded.retryable = true;
    }
    throw coded;
  }
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

/** Create the recipient activity for a row with NO stored activity id (A3: stored ids are read by readStoredActivity). */
async function resolveEmailActivity(message, createInput, dependencies, persist) {
  const key = recipientCorrelationKey(message);
  let email = await recoverByCorrelation(key, dependencies);
  if (!email) {
    try {
      const emailId = await dependencies.createEmailActivity({ ...createInput, correlationKey: key });
      message = await persist(message, emailId);
      if (!message) throw new Error('Dynamics email identity could not be persisted');
      email = await dependencies.getEmailActivity(emailId);
    } catch (error) {
      email = await recoverByCorrelation(key, dependencies);
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
    recipientContactIds: parseRecipients(message.recipient_contact_ids),
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
    approvalRequired: message.approval_required === true,
    status: message.status,
    version: message.version,
    reviewedAt: message.reviewed_at,
    approvedAt: message.approved_at,
    editedAt: message.edited_at,
    stoppedAt: message.stopped_at,
    sentAt: message.sent_at,
    sendRequestedAt: message.send_requested_at || null,
    hasActivity: Boolean(message.dynamics_email_id),
    recipientGeneration: Number(message.recipient_generation) || 0,
    lastErrorCode: message.last_error_code || null,
    attentionReason: scheduledEmailAttentionReason(message),
    error: message.last_error_message,
    previewHtml: renderScheduledEmailPreview(message),
  };
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

function activityStateUnknown(message, cause = null) {
  const error = new Error(`Could not confirm transport state for scheduled email ${message.id}.`);
  error.code = 'scheduled_email_activity_state_unknown';
  error.retryable = true;
  if (cause) error.cause = cause;
  return error;
}

async function reconcileTestRequestScheduledEmail(message, dependencies) {
  if (message.status === 'sent') {
    const finalized = await finalizeScheduledEmail(message, dependencies);
    return { sent: true, message: projectScheduledEmail(finalized || message) };
  }
  if (!message.dynamics_email_id && !message.send_requested_at) return null;

  let existing;
  try {
    existing = message.dynamics_email_id
      ? await dependencies.getEmailActivity(message.dynamics_email_id)
      : await recoverByCorrelation(recipientCorrelationKey(message), dependencies);
  } catch (error) {
    throw activityStateUnknown(message, error);
  }
  if (!existing) throw activityStateUnknown(message);

  if (accepted(existing)) {
    let receipted = message;
    if (!receipted.dynamics_email_id) {
      receipted = await dependencies.recordEmailActivity(receipted, existing.activityid);
      if (!receipted) throw new Error('Recovered Dynamics email identity could not be persisted');
    }
    const sent = await dependencies.recordSent(receipted, existing);
    if (!sent) throw new Error('Transport acceptance could not be persisted');
    const finalized = await finalizeScheduledEmail(sent, dependencies);
    return { sent: true, message: projectScheduledEmail(finalized || sent) };
  }

  // A recorded dispatch intent can race Dynamics status propagation. Never
  // resend or cancel while that outcome is still ambiguous.
  if (message.send_requested_at) throw activityStateUnknown(message);
  return null;
}

export async function deliverScheduledEmail(
  id,
  { force = false, pdSystemUserId = null, expectedVersion = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  // Test requests never receive grantee reminders (Stage 1b). Checked before
  // the claim: a verified-unsent row is stopped with one terminal write, while
  // a row with prior transport state is reconciled without resend. An
  // unreadable marker or activity throws with no write and is retried later.
  // The marker is immutable, so nothing can change between this read and the
  // claim.
  if (dependencies.isolationEnabled?.()) {
    const pending = await dependencies.getMessage(id);
    if (!pending) return { skipped: true };
    // GUIDs compare case-insensitively, as the claim's UUID comparison does.
    if (pdSystemUserId && String(pending.pd_systemuser_id || '').toLowerCase() !== String(pdSystemUserId).toLowerCase()) {
      return { skipped: true };
    }
    const testState = await dependencies.resolveTestState(pending.request_id);
    if (testState.kind === 'unknown') {
      throw Object.assign(new Error('Could not confirm the request is an ordinary request.'), {
        code: 'test_request_state_unknown',
      });
    }
    if (testState.kind !== 'ordinary') {
      const reconciled = await reconcileTestRequestScheduledEmail(pending, dependencies);
      if (reconciled) return reconciled;
      const stopped = await dependencies.cancelForSource(pending.id, 'test_request');
      return { stopped: true, message: stopped ? projectScheduledEmail(stopped) : null };
    }
  }

  // A1/A2: the ordinary claim refuses rows with send intent in SQL; those
  // rows are only ever READ back by reconcileScheduledEmailCandidate.
  let message = await dependencies.claimSend(id, { force, pdSystemUserId, expectedVersion });
  if (!message) return { skipped: true };

  try {
    if (!await sourceStillEligible(message, dependencies)) {
      const stopped = await dependencies.cancelForSource(message.id, undefined, { leaseToken: message.lease_token });
      return { stopped: true, message: projectScheduledEmail(stopped || message) };
    }

    // A3: a stored activity is read with classification; absence is never
    // inferred from a failed read, and correlation recovery runs only when no
    // id is stored.
    let existing = message.dynamics_email_id
      ? await readStoredActivity(message, dependencies)
      : await recoverByCorrelation(recipientCorrelationKey(message), dependencies);

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
        const stopped = await dependencies.cancelForSource(message.id, undefined, { leaseToken: message.lease_token });
        return { stopped: true, message: projectScheduledEmail(stopped || message) };
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
    if (message?.send_requested_at) {
      // A1/A2: send intent is the point of no return. Whatever failed after
      // it — the SendEmail call, the readback, or persistence — the row is
      // marked unconfirmed NOW (status failed, lease released) so it is
      // visible under Needs attention and reconciled daily; it is never
      // re-sent, even when the transport error claims a provable non-send.
      const classification = classifyEmailDispatchError(error);
      error.emailOutcome = classification.outcome;
      error.retryable = false;
      if (message.lease_token) {
        await dependencies.recordFailure(message, error, ERROR_CODES.SEND_UNCONFIRMED).catch(() => {});
      }
      throw error;
    }
    error.emailOutcome = 'failed';
    error.retryable = error.retryable !== false;
    if (message?.lease_token) {
      await dependencies.recordFailure(message, error, error?.code || 'scheduled_email_send_failed').catch(() => {});
    }
    throw error;
  }
}

/* --------------------------- reconciliation passes ------------------------ */

/**
 * A2/A7: one reconciliation-style candidate from
 * listScheduledEmailReconciliationCandidates. Reads the saved activity only;
 * never calls sendEmail, never creates, never recovers by correlation.
 *  - send intent: accepted → sent + finalized; otherwise released unresolved
 *    with the unconfirmed marker retained (checked again next run).
 *  - forbidden read lane (no intent): a successful read clears the code and
 *    returns the row to ordinary eligibility; 404 → missing; 403/other →
 *    code retained, lease released (rotates behind untouched candidates).
 */
export async function reconcileScheduledEmailCandidate(row, dependencies = DEFAULT_DEPENDENCIES) {
  if (row?.send_requested_at) {
    const message = await dependencies.claimReconciliation(row.id);
    if (!message) return { skipped: true };
    let existing;
    try {
      existing = await readStoredActivity(message, dependencies);
    } catch (error) {
      await dependencies.releaseReconciliation(message, error);
      return { unresolved: true, reason: error.code || 'read_failed' };
    }
    if (!accepted(existing)) {
      await dependencies.releaseReconciliation(message);
      return { unresolved: true, reason: 'not_accepted' };
    }
    const sent = await dependencies.recordSent(message, existing);
    if (!sent) throw new Error('Transport acceptance could not be persisted');
    const finalized = await finalizeScheduledEmail(sent, dependencies);
    return { sent: true, message: projectScheduledEmail(finalized || sent) };
  }

  const message = await dependencies.claimActivityRead(row.id);
  if (!message) return { skipped: true };
  try {
    await readStoredActivity(message, dependencies);
  } catch (error) {
    const code = error.code === ERROR_CODES.ACTIVITY_MISSING
      ? ERROR_CODES.ACTIVITY_MISSING
      : ERROR_CODES.ACTIVITY_FORBIDDEN;
    await dependencies.recordFailure(message, error, code).catch(() => {});
    return { unresolved: true, reason: code };
  }
  const cleared = await dependencies.clearActivityCode(message);
  return { cleared: Boolean(cleared) };
}

/**
 * A2 late acceptance: a stopped row that had requested a send. Stopped wins
 * unless Dynamics proves the email went, in which case the row becomes
 * `sent` and is finalized. Never calls sendEmail; takes no claim.
 */
export async function reconcileStoppedScheduledEmail(row, dependencies = DEFAULT_DEPENDENCIES) {
  if (!row?.send_requested_at || !row.dynamics_email_id || row.status !== 'stopped') {
    return { skipped: true };
  }
  let existing;
  try {
    existing = await readStoredActivity(row, dependencies);
  } catch (error) {
    return { unresolved: true, reason: error.code || 'read_failed' };
  }
  if (!accepted(existing)) return { unresolved: true, reason: 'not_accepted' };
  const sent = await dependencies.recordStoppedSent(row, existing);
  if (!sent) return { skipped: true };
  const finalized = await finalizeScheduledEmail(sent, dependencies);
  return { sent: true, message: projectScheduledEmail(finalized || sent) };
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
 * A PD appears only when at least one section is non-empty. Rows that need
 * a person (A2/A3, decided by scheduledEmailAttentionReason) go under
 * needsAttention, never upcoming; like approval-pending they repeat daily
 * until resolved. `total`/`capped` come from the store's per-PD window
 * (pd_total) so the cron can warn when a PD has more work than one digest
 * shows.
 */
export function groupDigestRowsByPd(rows, { perPdLimit = 100 } = {}) {
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
        needsAttention: [],
        sentFyi: [],
        total: 0,
        capped: false,
      };
      byPd.set(row.pd_systemuser_id, entry);
    }
    const total = Number(row.pd_total);
    if (Number.isFinite(total) && total > entry.total) {
      entry.total = total;
      entry.capped = total > perPdLimit;
    }
    if (row.status === 'sent') {
      entry.sentFyi.push(row);
    } else if (scheduledEmailAttentionReason(row)) {
      entry.needsAttention.push(row);
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
          'Needs attention',
          'The send status of these could not be confirmed, or their Dynamics email could not be read. Check the email history in Dynamics before acting.',
          group.needsAttention || [],
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
export { isSendUnconfirmed, scheduledEmailAttentionReason };
