/**
 * Cron service — grantee deliverable day-12 reminders
 * (Route→Service Consolidation Plan, Stage 5; decision layer per
 * docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md).
 *
 * Holds the batch orchestration for /api/cron/grantee-deliverable-reminders;
 * the route is a thin shell (method dispatch, verifyCronSecret byte-untouched,
 * DAL context, HTTP mapping).
 *
 * Every Invited deliverable gets a durable `scheduled_email_messages` row on
 * first sight, frozen with its day-12 send time. approval_required is
 * computed once at creation: the PD's review-all override, or any recipient
 * contact (PI or liaison) the PD has VIP-flagged. The due-send worker's
 * store-level claim refuses unapproved approval_required rows; the per-PD
 * daily digest is the only notification surface. There is no legacy direct
 * claim-before-send path and no unconfigured-PD runtime state.
 *
 * RECIPIENTS: To the PI; Cc the Liaison of record
 * (lib/services/contacts/request-liaison.js — the institution Primary Contact
 * for Research, never the Request copy). No Liaison (`none`) → the new row is
 * To the PI with no Cc. A Liaison or contact read failure, or a found Liaison
 * without an email, skips the row this run; neither is weakened to PI-only.
 * Rows already queued keep their stored recipients, except on the PD handoff
 * below, which rebuilds them with the current Liaison.
 *
 * PD HANDOFF: when the request's lead PD no longer matches an unsent ledger
 * row, the row is rebuilt in place under the current PD (mailbox, name,
 * signature, recipients, and the current PD's own review posture); the former
 * PD's edits and approval are deliberately discarded. Reassignment during a
 * single run (after this check, before the due send) is a narrow accepted
 * race, self-healed next run. Rows deferred by a capped scan are not
 * drift-checked that run and self-heal next run.
 *
 * IDEMPOTENCY: the ledger persists the exact draft, Dynamics activity
 * identity, send receipt, digest FYI receipt, and Dataverse finalization so
 * retries reconcile instead of blindly sending again.
 *
 * Contract (plan Decision 3):
 *   - plain argument object, never req/res;
 *   - returns the exact 200 summary envelope (including the misconfigured-
 *     email-defaults short-circuit summary);
 *   - throws ServiceHttpError 503 { error: 'Deliverable query failed.' } on a
 *     top-level query failure;
 *   - ASSUMES a trusted DAL context already exists — the shell establishes it.
 */

import crypto from 'node:crypto';
import { buildGranteeReminderDraftBodyText } from '../../external/grantee-invite-email';
import { readRequiredEmailDefaults } from '../email-defaults';
import { resolveSignatureForRequest } from '../email-signature';
import { GRANTEE_DELIVERABLE_STATUS } from '../../../shared/config/granteeDeliverableStatus';
import * as contactAdapter from '../../dataverse/adapters/contact';
import * as systemUserAdapter from '../../dataverse/adapters/system-user';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import * as granteeDeliverableAdapter from '../../dataverse/adapters/grantee-deliverable';
import { ServiceHttpError } from '../service-http-error';
import { getEmailAutomationPreferenceForSystemUser } from '../email-automation-preferences';
import * as scheduledEmailStore from '../scheduled-email-store';
import { testRequestIsolationEnabled } from '../test-requests/isolation';
import { resolveRequestTestState } from '../test-requests/request-test-state';
import { resolveRequestLiaison, REQUEST_LIAISON_FIELDS } from '../contacts/request-liaison.js';
import {
  deliverScheduledEmail,
  finalizeScheduledEmail,
  groupDigestRowsByPd,
  scheduledSendAtForInvitation,
  sendScheduledEmailDigest,
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
  '_wmkf_programdirector_value',
  ...REQUEST_LIAISON_FIELDS,
].join(',');
const CONTACT_SELECT = 'contactid,fullname,firstname,lastname,emailaddress1';
const PD_SELECT = 'systemuserid,fullname,internalemailaddress,title,isdisabled';
const CONCURRENCY = 4;
const SUBJECT_KEY = 'email.grantee_reminder.subject';
const BODY_KEY = 'email.grantee_reminder.body';

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

/**
 * The Liaison of record with its contact: `{ ok: true, liaison: contact|null }`
 * (null only for a confirmed `none`), or `{ ok: false, reason }` when the
 * Liaison, its contact, or its email cannot be established.
 */
async function readLiaison(request) {
  let result;
  try {
    result = await resolveRequestLiaison(request);
  } catch (error) {
    return { ok: false, reason: `liaison read failed: ${error.message}` };
  }
  if (result.status === 'none') return { ok: true, liaison: null };
  let contact;
  try {
    contact = await contactAdapter.getByIdWithSelect(result.contactId, CONTACT_SELECT);
  } catch (error) {
    return { ok: false, reason: `liaison contact read failed: ${error.message}` };
  }
  if (!contact?.emailaddress1) return { ok: false, reason: 'liaison has no email' };
  return { ok: true, liaison: contact };
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
 * Run one reminder batch: create ledger rows for newly Invited deliverables,
 * send digests, process due sends, repair unfinalized rows.
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
    skippedTestRequest: 0,
    testStateUnknown: 0,
    claimFailed: 0,
    sendFailed: 0,
    scheduled: 0,
    reassigned: 0,
    digestsSent: 0,
    digestFailed: 0,
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
    // Per-run cache: one override read per PD, not per deliverable row.
    const overrideByPd = new Map();
    let nextIndex = 0;
    async function worker() {
      while (true) {
        const i = nextIndex++;
        if (i >= records.length) return;
        await processRow(records[i], summary, emailDefaults.values, overrideByPd);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, records.length || 1) }, () => worker()));
  }

  const digestRows = await scheduledEmailStore.listScheduledEmailDigestRows();
  for (const group of groupDigestRowsByPd(digestRows)) {
    try {
      const outcome = await sendScheduledEmailDigest(group);
      if (outcome.sent) summary.digestsSent++;
    } catch (error) {
      summary.digestFailed++;
      addFailure(summary, null, `digest failed for PD ${group.pdSystemUserId}: ${error.message}`);
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

  const log = summary.sendFailed || summary.claimFailed || summary.testStateUnknown || summary.skippedNoPd
    || summary.skippedNoRecipient || summary.preferenceFailed
    || summary.digestFailed || summary.finalizeFailed || summary.capped
    ? console.error
    : console.log;
  log('[grantee-deliverable-reminders] summary', JSON.stringify(summary));
  return summary;
}

async function processRow(row, summary, emailDefaultValues, overrideByPd) {
  const deliverableId = row.wmkf_granteedeliverableid;
  const requestId = row._wmkf_request_value;
  let requestNum = null;

  if (!deliverableId || !requestId) {
    summary.claimFailed++;
    addFailure(summary, requestNum, 'missing deliverable id or request lookup');
    return;
  }

  // Scheduled jobs never act on test requests (Test Request Factory Stage 1):
  // skip before any recipient read or ledger write. An unreadable marker skips
  // this run only. Rows created before the switch was on are stopped by
  // deliverScheduledEmail on their due date.
  if (testRequestIsolationEnabled()) {
    const testState = await resolveRequestTestState(requestId);
    if (testState.kind === 'unknown') {
      summary.testStateUnknown++;
      addFailure(summary, requestNum, `test-request state unknown (${testState.reason})`);
      return;
    }
    if (testState.kind !== 'ordinary') {
      summary.skippedTestRequest++;
      return;
    }
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

  const [pi, liaisonRead, pd] = await Promise.all([
    readContact(request._wmkf_projectleader_value),
    readLiaison(request),
    readPd(request._wmkf_programdirector_value),
  ]);

  const piName = contactName(pi);
  const to = pi?.emailaddress1 || null;
  if (!piName || !to) {
    summary.skippedNoRecipient++;
    addFailure(summary, requestNum, 'missing PI name/email');
    return;
  }
  if (!liaisonRead.ok) {
    summary.skippedNoRecipient++;
    addFailure(summary, requestNum, liaisonRead.reason);
    return;
  }
  const liaison = liaisonRead.liaison;

  const pdName = pd?.fullname || null;
  const from = pd?.internalemailaddress || null;
  if (!pd?.systemuserid || !from || !pdName) {
    summary.skippedNoPd++;
    addFailure(summary, requestNum, 'missing PD systemuser/email/name');
    return;
  }

  // The review-all override and VIP flags decide approval_required ONCE, at
  // row creation. A read failure is not absence: fail closed (skip the row)
  // so a transient error can never weaken a PD's review posture.
  let approvalRequired;
  const recipientContactIds = [pi.contactid, liaison?.contactid].filter(Boolean);
  try {
    let override = overrideByPd.get(pd.systemuserid);
    if (override === undefined) {
      override = await getEmailAutomationPreferenceForSystemUser(pd.systemuserid);
      overrideByPd.set(pd.systemuserid, override);
    }
    if (override?.reviewAll === true) {
      approvalRequired = true;
    } else {
      const flagged = await scheduledEmailStore.filterVipFlaggedContacts(
        pd.systemuserid,
        recipientContactIds,
      );
      approvalRequired = flagged.size > 0;
    }
  } catch (error) {
    summary.preferenceFailed++;
    addFailure(summary, requestNum, `review posture read failed: ${error.message}`);
    return;
  }

  try {
    const signatureBlock = await resolveSignatureForRequest(requestId);
    const draft = {
      workflowType: 'grantee_abstract_reminder',
      sourceRecordId: deliverableId,
      requestId,
      deliverableId,
      pdSystemUserId: pd.systemuserid,
      pdName,
      pdEmail: from,
      toRecipients: [to],
      ccRecipients: liaison ? [liaison.emailaddress1] : [],
      recipientName: piName,
      recipientContactIds,
      subject: emailDefaultValues[SUBJECT_KEY],
      bodyText: buildGranteeReminderDraftBodyText({
        bodyTemplate: emailDefaultValues[BODY_KEY],
        piName,
        title: request.akoya_title || 'your W. M. Keck Foundation award',
        invitedDate: row.wmkf_inviteddate,
      }),
      signatureText: signatureBlock.signature,
      scheduledSendAt: scheduledSendAtForInvitation(row.wmkf_inviteddate).toISOString(),
      approvalRequired,
    };
    const ledgerRow = await scheduledEmailStore.createOrGetScheduledEmail({
      id: crypto.randomUUID(),
      ...draft,
    });
    // PD handoff: an unsent row still owned by a previous PD is rebuilt in
    // place under the current PD with the posture computed above. The store
    // WHERE makes this a no-op for sent/stopped/transport-started/leased rows
    // and for concurrent rebuilds.
    if (
      ledgerRow &&
      String(ledgerRow.pd_systemuser_id).toLowerCase() !== String(pd.systemuserid).toLowerCase()
    ) {
      const rebuilt = await scheduledEmailStore.reassignScheduledEmail(draft);
      if (rebuilt) {
        summary.reassigned++;
      } else {
        addFailure(
          summary,
          requestNum,
          `pd handoff deferred: transport state or lease on unsent row ${ledgerRow.id}`,
        );
      }
    }
    summary.scheduled++;
  } catch (error) {
    summary.sendFailed++;
    addFailure(summary, requestNum, `scheduled message creation failed: ${error.message}`);
  }
}
