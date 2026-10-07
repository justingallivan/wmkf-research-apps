/**
 * Group-review handoff email (Final Writeup group-review handoff Stage 4).
 *
 * When the lead PD presses "Ready for group review", the request's other
 * Program Directors get one email from the system mailbox. Contract:
 *  - Sent only for Grant Programs listed in FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS
 *    (owner 2026-10-07: Research only). Unset or invalid means no email.
 *  - The ledger row (`final_writeup_handoff_emails`) is the send intent. Only
 *    the call that committed the transition creates it, so writeups that were
 *    in group review before this shipped are never emailed.
 *  - Recipients: the program audience ∩ Program Director persona, minus the
 *    lead PD (same resolver as the Stage 3 sign-off roster), with addresses
 *    read separately so the roster DTO stays names-only.
 *  - Nothing here throws to the caller: a failed send never changes the
 *    transition response. Failures stay `pending` and retryable by
 *    `recoverPendingHandoffEmails`. A lease, the stored activity id (persisted
 *    before transport) and the Dynamics correlation key prevent a second email.
 *  - The email is regarding the request, so the transport's TEST-request guard
 *    applies. A refusal is terminal (`skipped`, `test_request_refused`).
 */

import * as emailActivityAdapter from '../../dataverse/adapters/email-activity.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { isGuid } from '../../utils/guid.js';
import { getSettingStrict } from '../settings-service.js';
import { resolveFinalWriteupProgramDirectorAudience } from './matrix-audience-service.js';
import * as store from './handoff-email-store.js';
import { isHandoffEmailEnabledForProgram } from './handoff-email-config.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import { FINAL_WRITEUP_SIGN_OFF_ROSTER_STATUS } from '../../../shared/config/finalWriteupSignOff.js';

export const FINAL_WRITEUP_HANDOFF_SUBJECT_KEY = 'email.final_writeup_handoff.subject';
export const FINAL_WRITEUP_HANDOFF_BODY_KEY = 'email.final_writeup_handoff.body';

const SEND_ACCEPTED_STATUS_CODES = new Set([3, 6, 7]);
const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  '_akoya_applicantid_value',
  '_wmkf_programdirector_value',
  '_wmkf_grantprogram_value',
  '_wmkf_currentfinalwriteup_value',
].join(',');

function normalizedGuid(value) {
  return isGuid(value) ? String(value).toLowerCase() : null;
}

function sameId(left, right) {
  const a = normalizedGuid(left);
  return Boolean(a) && a === normalizedGuid(right);
}

function publicBaseUrl(env = process.env) {
  const configured = String(env.NEXTAUTH_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const production = String(env.VERCEL_PROJECT_PRODUCTION_URL || '').trim().replace(/\/$/, '');
  return production ? `https://${production}` : '';
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  getSystemUser: (systemUserId) => systemUserAdapter.getByIdWithSelect(
    systemUserId,
    ['systemuserid', 'internalemailaddress', 'isdisabled'],
  ),
  resolveAudience: (grantProgramId) => resolveFinalWriteupProgramDirectorAudience(grantProgramId),
  getSettingStrict,
  createEmailActivity: emailActivityAdapter.create,
  getEmailActivity: emailActivityAdapter.getById,
  findEmailByCorrelation: emailActivityAdapter.findByCorrelation,
  sendEmail: emailActivityAdapter.send,
  insertIntent: store.insertHandoffEmailIntent,
  getRow: store.getHandoffEmail,
  claim: store.claimHandoffEmail,
  recordActivity: store.recordHandoffEmailActivity,
  markSent: store.markHandoffEmailSent,
  markSkipped: store.markHandoffEmailSkipped,
  recordFailure: store.recordHandoffEmailFailure,
  listPending: store.listPendingHandoffEmails,
  programEnabled: (grantProgramId) => isHandoffEmailEnabledForProgram(grantProgramId),
  sender: () => String(process.env.NOTIFICATION_EMAIL_FROM || '').trim(),
  baseUrl: () => publicBaseUrl(),
});

function handoffError(code) {
  return Object.assign(new Error(code), { code });
}

function accepted(email) {
  return SEND_ACCEPTED_STATUS_CODES.has(Number(email?.statuscode));
}

export function handoffCorrelationKey(finalDocumentId) {
  return `wmkf-final-writeup-handoff:${String(finalDocumentId).toLowerCase()}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveTokens(template, tokens) {
  return Object.entries(tokens).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value || ''),
    String(template || ''),
  ).replace(/[ \t]{2,}/g, ' ').trim();
}

export function renderHandoffEmail({ subjectTemplate, bodyTemplate, request, writeupUrl }) {
  const tokens = {
    requestNumber: String(request.akoya_requestnum || '').trim(),
    requestTitle: String(request.akoya_title || '').trim(),
    institution: requestInstitution(request) || '',
    leadProgramDirector: String(request._wmkf_programdirector_value_formatted || '').trim()
      || 'The lead Program Director',
  };
  const subject = resolveTokens(subjectTemplate, tokens).replace(/\s+/g, ' ');
  const message = resolveTokens(bodyTemplate, tokens);
  const paragraphs = message.split(/\n{2,}/).map((part) => (
    `<p>${escapeHtml(part).replaceAll('\n', '<br>')}</p>`
  ));
  const html = [
    ...paragraphs,
    `<p style="margin-top:18px;"><a href="${escapeHtml(writeupUrl)}" style="display:inline-block;padding:12px 18px;color:#fff;background:#1a4a7a;text-decoration:none;border-radius:4px;font-weight:600;">Open the writeup</a></p>`,
  ].join('\n');
  return { subject, html };
}

async function readCopy(key, dependencies) {
  try {
    const result = await dependencies.getSettingStrict(key);
    const value = result?.found ? String(result.value ?? '') : '';
    return value.trim() ? value : null;
  } catch {
    return null;
  }
}

async function recipientAddresses(programDirectors, dependencies) {
  const addresses = [];
  let skipped = 0;
  for (const person of programDirectors) {
    let user = null;
    try {
      user = await dependencies.getSystemUser(person.reviewerId);
    } catch {
      user = null;
    }
    const address = String(user?.internalemailaddress || '').trim();
    if (user && user.isdisabled === false && /^[^\s@]+@[^\s@]+$/.test(address)) {
      addresses.push(address);
    } else {
      skipped += 1;
    }
  }
  return { addresses: [...new Set(addresses)], skipped };
}

function partyAddresses(email) {
  const parties = Array.isArray(email?.email_activity_parties) ? email.email_activity_parties : [];
  return parties
    .filter((party) => Number(party?.participationtypemask) === 2 && party?.addressused)
    .map((party) => String(party.addressused));
}

async function findExistingActivity(row, key, dependencies) {
  if (row.dynamics_email_id) {
    const stored = await dependencies.getEmailActivity(row.dynamics_email_id).catch(() => null);
    if (stored) return stored;
  }
  const matches = await dependencies.findEmailByCorrelation(key);
  if (matches.length > 1) throw handoffError('handoff_email_correlation_ambiguous');
  return matches[0] || null;
}

/**
 * Claim and deliver one pending handoff email. Never throws. Returns
 * { status: 'sent' | 'skipped' | 'failed' | 'not_claimed', reason?, code? }.
 */
export async function deliverHandoffEmail(finalDocumentId, dependencies = DEFAULT_DEPENDENCIES) {
  let row;
  try {
    row = await dependencies.claim(finalDocumentId);
  } catch (error) {
    console.error('Final Writeup handoff email claim failed:', error?.message);
    return { status: 'failed', code: 'handoff_email_claim_failed' };
  }
  if (!row) return { status: 'not_claimed' };

  const skip = async (reason) => {
    await dependencies.markSkipped(finalDocumentId, reason);
    return { status: 'skipped', reason };
  };

  try {
    if (!dependencies.programEnabled(row.grant_program_id)) return await skip('program_not_enabled');
    const key = handoffCorrelationKey(finalDocumentId);
    let email = await findExistingActivity(row, key, dependencies);

    if (!email) {
      const sender = dependencies.sender();
      if (!sender) throw handoffError('handoff_email_sender_missing');
      const base = dependencies.baseUrl();
      if (!base) throw handoffError('handoff_email_base_url_missing');

      const request = await dependencies.getRequest(row.request_id);
      if (!request || !sameId(request.akoya_requestid, row.request_id)) {
        throw handoffError('handoff_email_request_unavailable');
      }
      if (!sameId(request._wmkf_currentfinalwriteup_value, finalDocumentId)) {
        return await skip('final_not_current');
      }

      const audience = await dependencies.resolveAudience(row.grant_program_id);
      if (audience?.status === FINAL_WRITEUP_SIGN_OFF_ROSTER_STATUS.PROGRAM_NOT_CONFIGURED) {
        return await skip('program_not_configured');
      }
      if (audience?.status === FINAL_WRITEUP_SIGN_OFF_ROSTER_STATUS.STAFFING_NOT_CONFIGURED) {
        return await skip('staffing_not_configured');
      }
      if (audience?.status !== FINAL_WRITEUP_SIGN_OFF_ROSTER_STATUS.CONFIGURED
        || !Array.isArray(audience.programDirectors)) {
        throw handoffError('handoff_email_audience_unavailable');
      }
      const leadId = row.lead_systemuser_id || request._wmkf_programdirector_value;
      const programDirectors = audience.programDirectors
        .filter((person) => !sameId(person.reviewerId, leadId));
      const { addresses, skipped } = await recipientAddresses(programDirectors, dependencies);
      if (addresses.length === 0) return await skip('no_recipients');

      const [subjectTemplate, bodyTemplate] = await Promise.all([
        readCopy(FINAL_WRITEUP_HANDOFF_SUBJECT_KEY, dependencies),
        readCopy(FINAL_WRITEUP_HANDOFF_BODY_KEY, dependencies),
      ]);
      if (!subjectTemplate || !bodyTemplate) throw handoffError('handoff_email_copy_unavailable');

      const requestNumber = String(request.akoya_requestnum || '').trim();
      const writeupUrl = `${base}/workbench/${encodeURIComponent(row.request_id)}?tab=final-writeup`
        + (requestNumber ? `&n=${encodeURIComponent(requestNumber)}` : '');
      const { subject, html } = renderHandoffEmail({ subjectTemplate, bodyTemplate, request, writeupUrl });

      const emailId = await dependencies.createEmailActivity({
        subject,
        body: html,
        from: sender,
        to: addresses,
        regardingId: row.request_id,
        regardingType: 'akoya_request',
        correlationKey: key,
      });
      // Persist the activity identity BEFORE requesting transport.
      await dependencies.recordActivity(finalDocumentId, {
        emailId,
        toRecipients: addresses,
        skippedRecipientCount: skipped,
      });
      email = await dependencies.getEmailActivity(emailId);
    } else if (!row.dynamics_email_id) {
      await dependencies.recordActivity(finalDocumentId, {
        emailId: email.activityid,
        toRecipients: partyAddresses(email),
        skippedRecipientCount: 0,
      });
    }

    if (!accepted(email)) {
      try {
        await dependencies.sendEmail(email.activityid);
      } catch (error) {
        const ambiguous = await dependencies.getEmailActivity(email.activityid).catch(() => null);
        if (!accepted(ambiguous)) throw error;
      }
    }
    await dependencies.markSent(finalDocumentId, email.activityid);
    return { status: 'sent' };
  } catch (error) {
    if (error?.code === 'test_request_email_denied') {
      try {
        return await skip('test_request_refused');
      } catch {
        return { status: 'failed', code: 'test_request_email_denied' };
      }
    }
    const code = typeof error?.code === 'string' && error.code ? error.code : 'handoff_email_failed';
    console.error('Final Writeup handoff email failed:', code, error?.message);
    await dependencies.recordFailure(finalDocumentId, code).catch(() => {});
    return { status: 'failed', code };
  }
}

/**
 * Route hook after `startFinalWriteup` resolved with inProgress === false.
 * Creates the intent only when this call committed the transition, then
 * attempts delivery. Never throws.
 */
export async function notifyGroupReviewHandoff(
  { requestId, finalDocumentId, committedByThisCall },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  try {
    if (!isGuid(requestId) || !isGuid(finalDocumentId)) return { status: 'invalid' };
    if (committedByThisCall === true) {
      const request = await dependencies.getRequest(requestId);
      const grantProgramId = normalizedGuid(request?._wmkf_grantprogram_value);
      if (!grantProgramId || !dependencies.programEnabled(grantProgramId)) {
        return { status: 'not_enabled' };
      }
      await dependencies.insertIntent({
        finalDocumentId: String(finalDocumentId).toLowerCase(),
        requestId: String(requestId).toLowerCase(),
        grantProgramId,
        leadSystemUserId: normalizedGuid(request?._wmkf_programdirector_value),
      });
    } else {
      const existing = await dependencies.getRow(String(finalDocumentId).toLowerCase());
      if (!existing) return { status: 'no_intent' };
      if (existing.state !== 'pending') return { status: existing.state };
    }
    return await deliverHandoffEmail(String(finalDocumentId).toLowerCase(), dependencies);
  } catch (error) {
    console.error('Final Writeup handoff email could not be queued:', error?.message);
    return { status: 'failed', code: 'handoff_email_queue_failed' };
  }
}

/** Owner-run recovery (and Stage 5's cron later): retry pending rows. */
export async function recoverPendingHandoffEmails({ limit = 25 } = {}, dependencies = DEFAULT_DEPENDENCIES) {
  const rows = await dependencies.listPending({ limit });
  const results = [];
  for (const row of rows) {
    const outcome = await deliverHandoffEmail(row.final_document_id, dependencies);
    results.push({ finalDocumentId: row.final_document_id, ...outcome });
  }
  return results;
}

export const FINAL_WRITEUP_HANDOFF_EMAIL_DEPENDENCIES = DEFAULT_DEPENDENCIES;
