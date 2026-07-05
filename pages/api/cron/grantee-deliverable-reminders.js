/**
 * Cron: automatic grantee deliverable day-12 reminders.
 *
 * Selects package rows still Invited at least 12 days after first invite. Each
 * row is claimed before email send by moving it out of Invited, so a post-send
 * failure cannot double-send on the next run.
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { mintForRequest } from '../../../lib/external/grantee-token-lifecycle';
import { renderGranteeReminderHtml } from '../../../lib/external/grantee-invite-email';
import { readRequiredEmailDefaults } from '../../../lib/services/email-defaults';
import { resolveSignatureForRequest } from '../../../lib/services/email-signature';
import { GRANTEE_DELIVERABLE_STATUS } from '../../../shared/config/granteeDeliverableStatus';
import * as contactAdapter from '../../../lib/dataverse/adapters/contact';
import * as systemUserAdapter from '../../../lib/dataverse/adapters/system-user';
import * as grantRequestAdapter from '../../../lib/dataverse/adapters/grant-request';
import * as granteeDeliverableAdapter from '../../../lib/dataverse/adapters/grantee-deliverable';

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

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  return bypassDynamicsRestrictions('grantee-deliverable-reminders-cron', async () => {
    const emailDefaults = await readRequiredEmailDefaults([SUBJECT_KEY, BODY_KEY], {
      source: 'grantee-deliverable-reminders',
    });
    const cutoff = isoDaysAgo(12);
    const filter =
      `wmkf_deliverablestatus eq ${GRANTEE_DELIVERABLE_STATUS.INVITED}` +
      ` and wmkf_inviteddate ne null and wmkf_inviteddate le ${cutoff}`;

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
      return res.status(503).json({ error: 'Deliverable query failed.' });
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
      console.error('[grantee-deliverable-reminders] summary', JSON.stringify(summary));
      return res.status(200).json(summary);
    }

    let nextIndex = 0;
    async function worker() {
      while (true) {
        const i = nextIndex++;
        if (i >= records.length) return;
        await processRow(records[i], summary, emailDefaults.values);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, records.length || 1) }, () => worker()));

    const log = summary.sendFailed || summary.claimFailed || summary.skippedNoPd || summary.skippedNoRecipient || summary.capped
      ? console.error
      : console.log;
    log('[grantee-deliverable-reminders] summary', JSON.stringify(summary));
    return res.status(200).json(summary);
  });
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
