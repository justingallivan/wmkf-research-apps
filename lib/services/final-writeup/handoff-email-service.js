/**
 * Group-review handoff email (Final Writeup group-review handoff Stage 4).
 *
 * When the lead PD presses "Ready for group review", the request's other
 * Program Directors get one email from the system mailbox. Contract:
 *  - Sent only for Grant Programs listed in FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS
 *    (owner 2026-10-07: Research only). Unset or invalid means no email.
 *  - The ledger row (`final_writeup_handoff_emails`), keyed by the handed-off
 *    draft, is the send intent. The route stages it BEFORE the transition runs,
 *    only for the lead PD or a superuser, only for the request's current draft,
 *    and only when the request has no current Final yet, so writeups already
 *    in group review before this shipped never get one. A commit whose
 *    response was lost still has its intent, so a retry or recovery sends it.
 *    If the intent cannot be persisted for a listed program, or eligibility
 *    cannot be read while any program is listed, the route refuses to start
 *    the transition (503) rather than lose the email.
 *  - Delivery sends only once the request's current Final is confirmed to come
 *    from this draft and is in group review. Until then the row waits; after
 *    AWAITING_TRANSITION_DAYS it is skipped.
 *  - Recipients: the program audience ∩ Program Director persona, minus the
 *    lead PD (same resolver as the Stage 3 sign-off roster), with addresses
 *    read separately so the roster DTO stays names-only. A lookup that fails
 *    for any reason other than "not found" keeps the whole send retryable.
 *  - Nothing here throws to the caller: a failed send never changes the
 *    transition response. Failures stay `pending` and retryable by
 *    `recoverPendingHandoffEmails`. A lease, the stored activity id (persisted
 *    before transport) and the Dynamics correlation key prevent a second email.
 *  - The email is regarding the request, so the transport's TEST-request guard
 *    applies. A refusal is terminal (`skipped`, `test_request_refused`).
 */

import * as emailActivityAdapter from '../../dataverse/adapters/email-activity.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { isGuid } from '../../utils/guid.js';
import { getSettingStrict } from '../settings-service.js';
import { resolveFinalWriteupProgramDirectorAudience } from './matrix-audience-service.js';
import * as store from './handoff-email-store.js';
import { isHandoffEmailEnabledForProgram, readHandoffEmailProgramIds } from './handoff-email-config.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import { FINAL_WRITEUP_SIGN_OFF_ROSTER_STATUS } from '../../../shared/config/finalWriteupSignOff.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../../shared/config/requestDocument.js';

export const FINAL_WRITEUP_HANDOFF_SUBJECT_KEY = 'email.final_writeup_handoff.subject';
export const FINAL_WRITEUP_HANDOFF_BODY_KEY = 'email.final_writeup_handoff.body';
// A staged intent whose transition never commits is skipped after this long.
export const AWAITING_TRANSITION_DAYS = 14;

const SEND_ACCEPTED_STATUS_CODES = new Set([3, 6, 7]);
const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  '_akoya_applicantid_value',
  '_wmkf_programdirector_value',
  '_wmkf_grantprogram_value',
  '_wmkf_currentpresitevisit_value',
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
  getDocument: async (documentId) => {
    const result = await requestDocumentAdapter.findByIds([documentId]);
    return (result?.records || [])[0] || null;
  },
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
  renew: store.renewHandoffEmailLease,
  recordFinal: store.recordHandoffEmailFinal,
  recordActivity: store.recordHandoffEmailActivity,
  markSent: store.markHandoffEmailSent,
  markSkipped: store.markHandoffEmailSkipped,
  release: store.releaseHandoffEmail,
  recordFailure: store.recordHandoffEmailFailure,
  listPending: store.listPendingHandoffEmails,
  programEnabled: (grantProgramId) => isHandoffEmailEnabledForProgram(grantProgramId),
  anyProgramEnabled: () => readHandoffEmailProgramIds().length > 0,
  sender: () => String(process.env.NOTIFICATION_EMAIL_FROM || '').trim(),
  baseUrl: () => publicBaseUrl(),
  now: () => new Date(),
});

function handoffError(code) {
  return Object.assign(new Error(code), { code });
}

function accepted(email) {
  return SEND_ACCEPTED_STATUS_CODES.has(Number(email?.statuscode));
}

export function handoffCorrelationKey(sourceDocumentId) {
  return `wmkf-final-writeup-handoff:${String(sourceDocumentId).toLowerCase()}`;
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

/**
 * Only a definitive answer drops a recipient: not found (404), disabled, or no
 * usable address. Any other lookup failure throws, so the send stays pending.
 */
async function recipientAddresses(programDirectors, dependencies) {
  const addresses = [];
  let skipped = 0;
  for (const person of programDirectors) {
    let user;
    try {
      user = await dependencies.getSystemUser(person.reviewerId);
    } catch (error) {
      if (error?.status === 404) {
        skipped += 1;
        continue;
      }
      throw handoffError('handoff_email_recipient_lookup_failed');
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

function stagedTooLongAgo(row, dependencies) {
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  return dependencies.now().getTime() - created > AWAITING_TRANSITION_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Before the transition runs: stage the send intent for this draft. Stages
 * only for the lead PD or a superuser, only when the draft is the request's
 * current draft, only while the request has no current Final, and only for a
 * listed program; every other case returns without a row and lets the
 * transition decide. Never throws. `failed` means the intent could not be
 * persisted for a request that should email; the route then refuses to start
 * the transition so the email cannot be silently lost.
 */
export async function stageGroupReviewHandoff(
  {
    requestId, sourceDocumentId, actingUserSystemId = null, isSuperuser = false,
  },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId) || !isGuid(sourceDocumentId)) return { status: 'invalid' };
  // With no program listed the feature is off: read nothing, block nothing.
  if (!dependencies.anyProgramEnabled()) return { status: 'not_enabled' };
  let request;
  try {
    request = await dependencies.getRequest(requestId);
  } catch (error) {
    // Eligibility is unknown, so starting now could commit without an intent.
    console.error('Final Writeup handoff email could not read the request:', error?.message);
    return { status: 'failed', code: 'handoff_email_request_read_failed' };
  }
  if (!request || !sameId(request.akoya_requestid, requestId)) return { status: 'request_unavailable' };
  if (isSuperuser !== true && !sameId(request._wmkf_programdirector_value, actingUserSystemId)) {
    return { status: 'not_authorized' };
  }
  if (!sameId(request._wmkf_currentpresitevisit_value, sourceDocumentId)) return { status: 'not_current_draft' };
  if (request._wmkf_currentfinalwriteup_value) return { status: 'already_in_review' };
  const grantProgramId = normalizedGuid(request._wmkf_grantprogram_value);
  if (!grantProgramId || !dependencies.programEnabled(grantProgramId)) return { status: 'not_enabled' };
  try {
    const { inserted } = await dependencies.insertIntent({
      sourceDocumentId: String(sourceDocumentId).toLowerCase(),
      requestId: String(requestId).toLowerCase(),
      grantProgramId,
      leadSystemUserId: normalizedGuid(request._wmkf_programdirector_value),
    });
    return { status: inserted ? 'staged' : 'already_staged' };
  } catch (error) {
    console.error('Final Writeup handoff email could not be staged:', error?.message);
    return { status: 'failed', code: 'handoff_email_stage_failed' };
  }
}

/**
 * Claim and deliver one pending handoff email. Never throws. Returns
 * { status: 'sent' | 'skipped' | 'awaiting_transition' | 'failed' | 'not_claimed' | 'lease_lost', reason?, code? }.
 *
 * Every ledger write carries the claim's lease token. Before creating an
 * activity and again before SendEmail, the lease is renewed as a fence; a
 * worker whose lease expired and was taken over stops there. The correlation
 * lookup is repeated right after the first fence, and the activity id is
 * recorded only if no other activity is recorded, so overlapping workers
 * cannot both send.
 */
export async function deliverHandoffEmail(sourceDocumentId, dependencies = DEFAULT_DEPENDENCIES) {
  let row;
  try {
    row = await dependencies.claim(sourceDocumentId);
  } catch (error) {
    console.error('Final Writeup handoff email claim failed:', error?.message);
    return { status: 'failed', code: 'handoff_email_claim_failed' };
  }
  if (!row) return { status: 'not_claimed' };
  const token = row.lease_token;

  const skip = async (reason) => {
    await dependencies.markSkipped(sourceDocumentId, reason, token);
    return { status: 'skipped', reason };
  };
  const fence = async () => {
    const owned = await dependencies.renew(sourceDocumentId, token);
    if (!owned) throw handoffError('handoff_email_lease_lost');
    return owned;
  };
  const recordOrStop = async (activity) => {
    const { recorded } = await dependencies.recordActivity(sourceDocumentId, activity, token);
    if (!recorded) throw handoffError('handoff_email_lease_lost');
  };

  try {
    const key = handoffCorrelationKey(sourceDocumentId);
    let email = await findExistingActivity(row, key, dependencies);
    // Already accepted for delivery: record it, never re-check or resend.
    if (email && accepted(email)) {
      if (!row.dynamics_email_id) {
        await recordOrStop({
          emailId: email.activityid,
          toRecipients: partyAddresses(email),
          skippedRecipientCount: 0,
        });
      }
      await dependencies.markSent(sourceDocumentId, email.activityid, token);
      return { status: 'sent' };
    }

    if (!dependencies.programEnabled(row.grant_program_id)) return await skip('program_not_enabled');
    // Not yet sent (new or stored draft activity): the writeup must still be
    // in group review from this draft, or the invitation is obsolete.
    const request = await dependencies.getRequest(row.request_id);
    if (!request || !sameId(request.akoya_requestid, row.request_id)) {
      throw handoffError('handoff_email_request_unavailable');
    }
    const finalDocumentId = normalizedGuid(request._wmkf_currentfinalwriteup_value);
    if (!finalDocumentId) {
      if (email) return await skip('final_withdrawn');
      if (stagedTooLongAgo(row, dependencies)) return await skip('transition_not_committed');
      await dependencies.release(sourceDocumentId, token);
      return { status: 'awaiting_transition' };
    }
    const finalDocument = await dependencies.getDocument(finalDocumentId);
    if (!finalDocument || !sameId(finalDocument.wmkf_requestdocumentid, finalDocumentId)) {
      throw handoffError('handoff_email_final_unavailable');
    }
    if (!sameId(finalDocument._wmkf_sourcedocument_value, sourceDocumentId)) {
      return await skip('final_from_other_draft');
    }
    if (finalDocument.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW) {
      return await skip('no_longer_in_group_review');
    }
    await dependencies.recordFinal(sourceDocumentId, finalDocumentId, token);

    if (!email) {
      const sender = dependencies.sender();
      if (!sender) throw handoffError('handoff_email_sender_missing');
      const base = dependencies.baseUrl();
      if (!base) throw handoffError('handoff_email_base_url_missing');

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

      // Fence before the first external side effect, then look again for an
      // activity another worker may have created while this one was slow.
      const owned = await fence();
      email = await findExistingActivity(owned, key, dependencies);
      if (!email) {
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
        await recordOrStop({ emailId, toRecipients: addresses, skippedRecipientCount: skipped });
        email = await dependencies.getEmailActivity(emailId);
      } else if (!owned.dynamics_email_id) {
        await recordOrStop({
          emailId: email.activityid,
          toRecipients: partyAddresses(email),
          skippedRecipientCount: 0,
        });
      }
    } else if (!row.dynamics_email_id) {
      await recordOrStop({
        emailId: email.activityid,
        toRecipients: partyAddresses(email),
        skippedRecipientCount: 0,
      });
    }

    if (!accepted(email)) {
      await fence();
      try {
        await dependencies.sendEmail(email.activityid);
      } catch (error) {
        const ambiguous = await dependencies.getEmailActivity(email.activityid).catch(() => null);
        if (!accepted(ambiguous)) throw error;
      }
    }
    await dependencies.markSent(sourceDocumentId, email.activityid, token);
    return { status: 'sent' };
  } catch (error) {
    if (error?.code === 'handoff_email_lease_lost') {
      // Another worker owns the row now; it finishes the send.
      return { status: 'lease_lost' };
    }
    if (error?.code === 'test_request_email_denied') {
      try {
        return await skip('test_request_refused');
      } catch {
        return { status: 'failed', code: 'test_request_email_denied' };
      }
    }
    const code = typeof error?.code === 'string' && error.code ? error.code : 'handoff_email_failed';
    console.error('Final Writeup handoff email failed:', code, error?.message);
    await dependencies.recordFailure(sourceDocumentId, code, token).catch(() => {});
    return { status: 'failed', code };
  }
}

/** Route hook after a start that did not end in progress. Never throws. */
export async function deliverGroupReviewHandoff(
  { sourceDocumentId },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(sourceDocumentId)) return { status: 'invalid' };
  return deliverHandoffEmail(String(sourceDocumentId).toLowerCase(), dependencies);
}

/** Owner-run recovery (and Stage 5's cron later): retry pending rows. */
export async function recoverPendingHandoffEmails({ limit = 25 } = {}, dependencies = DEFAULT_DEPENDENCIES) {
  const rows = await dependencies.listPending({ limit });
  const results = [];
  for (const row of rows) {
    const outcome = await deliverHandoffEmail(row.source_document_id, dependencies);
    results.push({ sourceDocumentId: row.source_document_id, ...outcome });
  }
  return results;
}

export const FINAL_WRITEUP_HANDOFF_EMAIL_DEPENDENCIES = DEFAULT_DEPENDENCIES;
