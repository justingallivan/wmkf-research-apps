/**
 * Cron service — automatic grantee deliverable day-12 reminders
 * (Route→Service Consolidation Plan, Stage 5).
 *
 * Holds the batch orchestration for /api/cron/grantee-deliverable-reminders;
 * the route is a thin shell (method dispatch, verifyCronSecret byte-untouched,
 * DAL context, HTTP mapping).
 *
 * IDEMPOTENCY: PDs with an explicit automation preference use the durable
 * `scheduled_email_messages` ledger. The exact draft, review actions, Dynamics
 * activity identity, send receipt, and Dataverse finalization are persisted so
 * retries reconcile instead of blindly sending again. PDs with no saved choice
 * retain the historical claim-before-send path during rollout.
 *
 * Contract (plan Decision 3):
 *   - plain argument object, never req/res;
 *   - returns the exact 200 summary envelope (including the misconfigured-
 *     email-defaults short-circuit summary);
 *   - throws ServiceHttpError 503 { error: 'Deliverable query failed.' } on a
 *     top-level query failure;
 *   - ASSUMES a trusted DAL context already exists — the shell establishes it
 *     (historical label 'grantee-deliverable-reminders-cron', same scope:
 *     the email-defaults read historically ran inside the bypass too).
 */

import { DynamicsService } from '../dynamics-service';
import { mintForRequest } from '../../external/grantee-token-lifecycle';
import crypto from 'node:crypto';
import {
  buildGranteeReminderDraftBodyText,
  renderGranteeReminderHtml,
} from '../../external/grantee-invite-email';
import { readRequiredEmailDefaults } from '../email-defaults';
import { resolveSignatureForRequest } from '../email-signature';
import { GRANTEE_DELIVERABLE_STATUS } from '../../../shared/config/granteeDeliverableStatus';
import * as contactAdapter from '../../dataverse/adapters/contact';
import * as systemUserAdapter from '../../dataverse/adapters/system-user';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import * as granteeDeliverableAdapter from '../../dataverse/adapters/grantee-deliverable';
import { ServiceHttpError } from '../service-http-error';
import { getEmailAutomationPreferenceForSystemUser } from '../email-automation-preferences';
import {
  EMAIL_AUTOMATION_MODE,
  calculateReviewAvailableAt,
} from '../../../shared/config/emailAutomation';
import * as scheduledEmailStore from '../scheduled-email-store';
import {
  deliverScheduledEmail,
  finalizeScheduledEmail,
  notifyScheduledEmailReview,
  scheduledSendAtForInvitation,
} from '../scheduled-email-service';

const SELECT = [
  'wmkf_granteedeliverableid',
  '_wmkf_request_value',
  'wmkf_deliverablestatus',
  'wmkf_inviteddate',
].join(',');
const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  '_wmkf_projectleader_value',
  '_akoya_primarycontactid_value',
  '_wmkf_programdirector_value',
].join(',');
const CONTACT_SELECT = 'contactid,fullname,firstname,lastname,emailaddress1';
const PD_SELECT = 'systemuserid,fullname,internalemailaddress,title,isdisabled';
const CONCURRENCY = 4;
const SUBJECT_KEY = 'email.grantee_reminder.subject';
const BODY_KEY = 'email.grantee_reminder.body';

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function contactName(c) {
  return c?.fullname || `${c?.firstname || ''} ${c?.lastname || ''}`.trim() || null;
}

async function readContact(id) {
  if (!id) return null;
  try {
    return await contactAdapter.getByIdWithSelect(id, CONTACT_SELECT);
  } catch {
    return null;
  }
}

async function readPd(id) {
  if (!id) return null;
  try {
    const pd = await systemUserAdapter.getByIdWithSelect(id, PD_SELECT);
    if (!pd || pd.isdisabled === true) return null;
    return pd;
  } catch {
    return null;
  }
}

function addFailure(summary, requestNum, reason) {
  summary.failures.push({ requestNum: requestNum || null, reason });
}

/**
 * Run one day-12 reminder batch.
 *
 * @returns {Promise<Object>} the historical 200 summary
 * @throws {ServiceHttpError} 503 { error: 'Deliverable query failed.' }
 */
export async function runGranteeDeliverableReminders() {
  const emailDefaults = await readRequiredEmailDefaults([SUBJECT_KEY, BODY_KEY], {
    source: 'grantee-deliverable-reminders',
  });
  const filter =
    `wmkf_deliverablestatus eq ${GRANTEE_DELIVERABLE_STATUS.INVITED}` +
    ' and wmkf_inviteddate ne null';

  let records = [];
  let capped = false;
  let totalCount = 0;
  try {
    const result = await granteeDeliverableAdapter.queryAllDeliverables({
      select: SELECT,
      filter,
      orderby: 'wmkf_inviteddate asc',
    });
    records = result.records || [];
    capped = Boolean(result.capped);
    totalCount = result.totalCount || records.length;
  } catch (err) {
    console.error('[grantee-deliverable-reminders] query failed:', err.message);
    throw new ServiceHttpError('Deliverable query failed.', {
      httpStatus: 503,
      body: { error: 'Deliverable query failed.' },
    });
  }

  const summary = {
    totalCount,
    scanned: records.length,
    reminded: 0,
    skippedNoPd: 0,
    skippedNoRecipient: 0,
    skippedMisconfigured: 0,
    claimFailed: 0,
    sendFailed: 0,
    scheduled: 0,
    notified: 0,
    notificationFailed: 0,
    stoppedNoLongerEligible: 0,
    preferenceFailed: 0,
    finalizeFailed: 0,
    capped,
    deferred: capped ? Math.max(totalCount - records.length, 0) : 0,
    failures: [],
  };

  if (!emailDefaults.ok) {
    summary.skippedMisconfigured = records.length;
    summary.failures.push(...emailDefaults.failures.map((failure) => ({
      requestNum: null,
      reason: `email default ${failure.key} ${failure.reason}`,
    })));
  } else {
    let nextIndex = 0;
    async function worker() {
      while (true) {
        const i = nextIndex++;
        if (i >= records.length) return;
        await processRow(records[i], summary, emailDefaults.values);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, records.length || 1) }, () => worker()));
  }

  const needingNotification = await scheduledEmailStore.listScheduledEmailsNeedingNotification();
  for (const message of needingNotification) {
    try {
      const outcome = await notifyScheduledEmailReview(message.id);
      if (outcome.notified) summary.notified++;
    } catch (error) {
      summary.notificationFailed++;
      addFailure(summary, null, `review notification failed for ${message.id}: ${error.message}`);
    }
  }

  const dueMessages = await scheduledEmailStore.listDueScheduledEmails();
  for (const message of dueMessages) {
    try {
      const outcome = await deliverScheduledEmail(message.id);
      if (outcome.sent) summary.reminded++;
      if (outcome.stopped) summary.stoppedNoLongerEligible++;
    } catch (error) {
      summary.sendFailed++;
      addFailure(summary, null, `scheduled send failed for ${message.id}: ${error.message}`);
    }
  }

  const unfinalized = await scheduledEmailStore.listUnfinalizedScheduledEmails();
  for (const message of unfinalized) {
    try {
      await finalizeScheduledEmail(message);
    } catch (error) {
      summary.finalizeFailed++;
      addFailure(summary, null, `scheduled finalize failed for ${message.id}: ${error.message}`);
    }
  }

  const log = summary.sendFailed || summary.claimFailed || summary.skippedNoPd
    || summary.skippedNoRecipient || summary.preferenceFailed
    || summary.notificationFailed || summary.finalizeFailed || summary.capped
    ? console.error
    : console.log;
  log('[grantee-deliverable-reminders] summary', JSON.stringify(summary));
  return summary;
}

async function processRow(row, summary, emailDefaultValues) {
  const deliverableId = row.wmkf_granteedeliverableid;
  const requestId = row._wmkf_request_value;
  let requestNum = null;

  if (!deliverableId || !requestId) {
    summary.claimFailed++;
    addFailure(summary, requestNum, 'missing deliverable id or request lookup');
    return;
  }

  let request;
  try {
    request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
    requestNum = request?.akoya_requestnum || null;
  } catch (err) {
    summary.skippedNoRecipient++;
    addFailure(summary, requestNum, `request read failed: ${err.message}`);
    return;
  }

  const [pi, liaison, pd] = await Promise.all([
    readContact(request._wmkf_projectleader_value),
    readContact(request._akoya_primarycontactid_value),
    readPd(request._wmkf_programdirector_value),
  ]);

  const piName = contactName(pi);
  const to = pi?.emailaddress1 || null;
  const cc = liaison?.emailaddress1 || null;
  if (!piName || !to || !cc) {
    summary.skippedNoRecipient++;
    addFailure(summary, requestNum, 'missing PI name/email or liaison email');
    return;
  }

  const pdName = pd?.fullname || null;
  const from = pd?.internalemailaddress || null;
  if (!pd?.systemuserid || !from || !pdName) {
    summary.skippedNoPd++;
    addFailure(summary, requestNum, 'missing PD systemuser/email/name');
    return;
  }

  let automationPreference;
  try {
    automationPreference = await getEmailAutomationPreferenceForSystemUser(pd.systemuserid);
  } catch (error) {
    // Preference read failure is not absence. Fail closed so a transient
    // Dataverse read cannot silently convert a review-mode PD to automatic.
    summary.preferenceFailed++;
    addFailure(summary, requestNum, `email automation preference read failed: ${error.message}`);
    return;
  }

  if (automationPreference) {
    const scheduledSendAt = scheduledSendAtForInvitation(row.wmkf_inviteddate);
    const reviewAvailableAt = calculateReviewAvailableAt(scheduledSendAt, automationPreference);
    if (Date.now() < reviewAvailableAt.getTime()) return;

    try {
      const signatureBlock = await resolveSignatureForRequest(requestId);
      await scheduledEmailStore.createOrGetScheduledEmail({
        id: crypto.randomUUID(),
        workflowType: 'grantee_abstract_reminder',
        sourceRecordId: deliverableId,
        requestId,
        deliverableId,
        pdSystemUserId: pd.systemuserid,
        pdName,
        pdEmail: from,
        toRecipients: [to],
        ccRecipients: [cc],
        recipientName: piName,
        subject: emailDefaultValues[SUBJECT_KEY],
        bodyText: buildGranteeReminderDraftBodyText({
          bodyTemplate: emailDefaultValues[BODY_KEY],
          piName,
          title: request.akoya_title || 'your W. M. Keck Foundation award',
          invitedDate: row.wmkf_inviteddate,
        }),
        signatureText: signatureBlock.signature,
        scheduledSendAt: scheduledSendAt.toISOString(),
        reviewAvailableAt: reviewAvailableAt.toISOString(),
        reviewLeadDays: automationPreference.mode === EMAIL_AUTOMATION_MODE.REVIEW
          ? automationPreference.leadDays
          : null,
      });
      summary.scheduled++;
    } catch (error) {
      summary.sendFailed++;
      addFailure(summary, requestNum, `scheduled message creation failed: ${error.message}`);
    }
    return;
  }

  // Rollout compatibility for a PD who has not made an explicit choice yet:
  // preserve the existing day-12 automatic path until their preference is set.
  if (new Date(row.wmkf_inviteddate).getTime() > new Date(isoDaysAgo(12)).getTime()) return;

  try {
    await granteeDeliverableAdapter.update(
      deliverableId,
      { wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT },
      { ifMatch: row._etag },
    );
  } catch (err) {
    summary.claimFailed++;
    addFailure(summary, requestNum, `claim failed: ${err.message}`);
    return;
  }

  let url;
  try {
    ({ url } = await mintForRequest({ requestId }));
    const signatureBlock = await resolveSignatureForRequest(requestId);
    const html = renderGranteeReminderHtml({
      bodyTemplate: emailDefaultValues[BODY_KEY],
      piName,
      title: request.akoya_title || 'your W. M. Keck Foundation award',
      signatureBlock,
      invitedDate: row.wmkf_inviteddate,
      url,
      senderName: pdName,
      senderEmail: from,
    });
    await DynamicsService.createAndSendEmail({
      subject: emailDefaultValues[SUBJECT_KEY],
      body: html,
      from,
      to,
      cc,
      regardingId: requestId,
      regardingType: 'akoya_request',
      actingUserSystemId: pd.systemuserid,
      noFallback: true,
    });
  } catch (err) {
    summary.sendFailed++;
    addFailure(summary, requestNum, `send failed: ${err.message}`);
    return;
  }

  try {
    await granteeDeliverableAdapter.update(
      deliverableId,
      {
        wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT,
        wmkf_remindeddate: new Date().toISOString(),
      },
    );
    summary.reminded++;
  } catch (err) {
    summary.sendFailed++;
    addFailure(summary, requestNum, `finalize failed after send: ${err.message}`);
  }
}
