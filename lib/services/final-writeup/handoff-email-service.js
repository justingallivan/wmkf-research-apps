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
 *    applies. Its refusal stays pending and retryable, because the same code
 *    also reports an unreadable marker.
 */

import * as emailActivityAdapter from '../../dataverse/adapters/email-activity.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { isGuid } from '../../utils/guid.js';
import { getSettingStrict } from '../settings-service.js';
import NotificationService from '../notification-service.js';
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
  rebuild: store.rebuildHandoffEmail,
  expire: store.expireHandoffEmail,
  reopenExpired: store.reopenExpiredHandoffEmail,
  recordFailure: store.recordHandoffEmailFailure,
  listPending: store.listPendingHandoffEmails,
  programEnabled: (grantProgramId) => isHandoffEmailEnabledForProgram(grantProgramId),
  anyProgramEnabled: () => readHandoffEmailProgramIds().length > 0,
  sender: () => String(process.env.NOTIFICATION_EMAIL_FROM || '').trim(),
  baseUrl: () => publicBaseUrl(),
  notify: (options) => NotificationService.notify(options),
});

function handoffError(code) {
  return Object.assign(new Error(code), { code });
}

function accepted(email) {
  return SEND_ACCEPTED_STATUS_CODES.has(Number(email?.statuscode));
}

export function handoffCorrelationKey(sourceDocumentId, recipientGeneration = 0) {
  const base = `wmkf-final-writeup-handoff:${String(sourceDocumentId).toLowerCase()}`;
  const generation = Number(recipientGeneration) || 0;
  return generation > 0 ? `${base}:g${generation}` : base;
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

function sameAddressSet(left, right) {
  const normalize = (list) => [...new Set((list || []).map((value) => String(value).trim().toLowerCase()))].sort();
  const a = normalize(left);
  const b = normalize(right);
  return a.length > 0 && a.length === b.length && a.every((value, index) => value === b[index]);
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

// Skips that mean an email was owed but cannot be sent until staff fix the
// configuration. Each raises an ops alert so someone tells the PDs directly.
const UNDELIVERABLE_SKIP_REASONS = new Set(['program_not_configured', 'staffing_not_configured', 'no_recipients']);
export const HANDOFF_EMAIL_ALERT_AFTER_ATTEMPTS = 3;

/**
 * Claim and deliver one pending handoff email. Never throws. Returns
 * { status: 'sent' | 'skipped' | 'awaiting_transition' | 'failed' | 'not_claimed' | 'lease_lost', reason?, code? }.
 * An owed email that cannot be delivered (a configuration skip, or a failure
 * after HANDOFF_EMAIL_ALERT_AFTER_ATTEMPTS attempts) raises an ops alert.
 */
export async function deliverHandoffEmail(sourceDocumentId, dependencies = DEFAULT_DEPENDENCIES) {
  const outcome = await deliverOnce(sourceDocumentId, dependencies);
  await alertIfUndeliverable(sourceDocumentId, outcome, dependencies);
  return outcome;
}

async function alertIfUndeliverable(sourceDocumentId, outcome, dependencies) {
  try {
    let reason = null;
    let row = null;
    if (outcome.status === 'skipped' && UNDELIVERABLE_SKIP_REASONS.has(outcome.reason)) {
      reason = outcome.reason;
    } else if (outcome.status === 'failed') {
      row = await dependencies.getRow(sourceDocumentId);
      if (!row || row.state !== 'pending'
        || Number(row.attempt_count) < HANDOFF_EMAIL_ALERT_AFTER_ATTEMPTS) return;
      reason = outcome.code;
    } else {
      return;
    }
    if (!row) row = await dependencies.getRow(sourceDocumentId).catch(() => null);
    await dependencies.notify({
      type: 'final_writeup_handoff_email_undelivered',
      severity: 'error',
      category: 'ops',
      source: 'final-writeup-handoff-email',
      title: 'Group review email not delivered',
      message: `The email telling Program Directors that a writeup is ready for group review has not been sent (${reason}). Let them know directly, then fix the cause; pending emails retry automatically.`,
      metadata: { sourceDocumentId, requestId: row?.request_id || null, reason },
      autoResolveKey: `final-writeup-handoff-email:${sourceDocumentId}`,
    });
  } catch (error) {
    console.error('Final Writeup handoff email alert failed:', error?.message);
  }
}

/*
 * Every ledger write carries the claim's lease token. Before creating an
 * activity and again before SendEmail, the lease is renewed as a fence; a
 * worker whose lease expired and was taken over stops there. The correlation
 * lookup is repeated right after the first fence, and the activity id is
 * recorded only if no other activity is recorded, so overlapping workers
 * cannot both send. An unsent activity that no longer addresses the current
 * recipients is abandoned (never sent) and a fresh one is built under the next
 * recipient generation, so the email still goes out.
 */
async function deliverOnce(sourceDocumentId, dependencies) {
  let row;
  try {
    row = await dependencies.claim(sourceDocumentId);
  } catch (error) {
    console.error('Final Writeup handoff email claim failed:', error?.message);
    return { status: 'failed', code: 'handoff_email_claim_failed' };
  }
  if (!row) return { status: 'not_claimed' };
  const token = row.lease_token;
  let generation = Number(row.recipient_generation || 0);
  const key = () => handoffCorrelationKey(sourceDocumentId, generation);

  const skip = async (reason) => {
    await dependencies.markSkipped(sourceDocumentId, reason, token);
    return { status: 'skipped', reason };
  };
  const fence = async () => {
    const owned = await dependencies.renew(sourceDocumentId, token);
    if (!owned) throw handoffError('handoff_email_lease_lost');
    return owned;
  };
  // Every recorded activity carries the program and lead its recipients were
  // resolved for.
  let context = {
    grantProgramId: normalizedGuid(row.grant_program_id),
    leadSystemUserId: normalizedGuid(row.lead_systemuser_id),
  };
  const recordOrStop = async (activity) => {
    const { recorded } = await dependencies.recordActivity(
      sourceDocumentId,
      { ...activity, ...context },
      token,
    );
    if (!recorded) throw handoffError('handoff_email_lease_lost');
  };
  const rebuild = async () => {
    const rebuilt = await dependencies.rebuild(sourceDocumentId, token);
    if (!rebuilt) throw handoffError('handoff_email_lease_lost');
    row = rebuilt;
    generation = Number(rebuilt.recipient_generation || 0);
  };

  try {
    let email = await findExistingActivity(row, key(), dependencies);
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

    // Not yet sent: eligibility, audience and lead come from the request as
    // it is now, not as it was when staged.
    const request = await dependencies.getRequest(row.request_id);
    if (!request || !sameId(request.akoya_requestid, row.request_id)) {
      throw handoffError('handoff_email_request_unavailable');
    }
    const currentProgramId = normalizedGuid(request._wmkf_grantprogram_value);
    const currentLeadId = normalizedGuid(request._wmkf_programdirector_value);
    if (!currentProgramId || !dependencies.programEnabled(currentProgramId)) {
      return await skip('program_not_enabled');
    }
    context = { grantProgramId: currentProgramId, leadSystemUserId: currentLeadId };
    const finalDocumentId = normalizedGuid(request._wmkf_currentfinalwriteup_value);
    if (!finalDocumentId) {
      if (email) return await skip('final_withdrawn');
      const { expired } = await dependencies.expire(sourceDocumentId, token, AWAITING_TRANSITION_DAYS);
      if (expired) return { status: 'skipped', reason: 'transition_not_committed' };
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

    // Recipients as the request stands now: audience, persona, role, account
    // state and address all current.
    const audience = await dependencies.resolveAudience(currentProgramId);
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
    const recipients = await recipientAddresses(
      audience.programDirectors.filter((person) => !sameId(person.reviewerId, currentLeadId)),
      dependencies,
    );
    if (recipients.addresses.length === 0) return await skip('no_recipients');
    const matchesRecipients = (activity) => sameAddressSet(partyAddresses(activity), recipients.addresses);
    const adopt = (activity) => recordOrStop({
      emailId: activity.activityid,
      toRecipients: recipients.addresses,
      skippedRecipientCount: recipients.skipped,
    });

    // An existing unsent activity (a recorded draft whose send failed, or an
    // orphan the ledger never recorded) is sent only if it addresses exactly
    // these recipients; otherwise it is abandoned and rebuilt.
    if (email) {
      if (!matchesRecipients(email)) {
        await rebuild();
        email = null;
      } else if (!row.dynamics_email_id) {
        await adopt(email);
      }
    }

    if (!email) {
      const sender = dependencies.sender();
      if (!sender) throw handoffError('handoff_email_sender_missing');
      const base = dependencies.baseUrl();
      if (!base) throw handoffError('handoff_email_base_url_missing');
      const [subjectTemplate, bodyTemplate] = await Promise.all([
        readCopy(FINAL_WRITEUP_HANDOFF_SUBJECT_KEY, dependencies),
        readCopy(FINAL_WRITEUP_HANDOFF_BODY_KEY, dependencies),
      ]);
      if (!subjectTemplate || !bodyTemplate) throw handoffError('handoff_email_copy_unavailable');
      const requestNumber = String(request.akoya_requestnum || '').trim();
      const writeupUrl = `${base}/workbench/${encodeURIComponent(row.request_id)}?tab=final-writeup`
        + (requestNumber ? `&n=${encodeURIComponent(requestNumber)}` : '');
      const { subject, html } = renderHandoffEmail({ subjectTemplate, bodyTemplate, request, writeupUrl });
      const createFresh = async () => {
        const emailId = await dependencies.createEmailActivity({
          subject,
          body: html,
          from: sender,
          to: recipients.addresses,
          regardingId: row.request_id,
          regardingType: 'akoya_request',
          correlationKey: key(),
        });
        // Persist the activity identity BEFORE requesting transport.
        await adopt({ activityid: emailId });
        return dependencies.getEmailActivity(emailId);
      };

      // Fence before the first external side effect, then look again for an
      // activity another worker may have created while this one was slow.
      const owned = await fence();
      email = await findExistingActivity(owned, key(), dependencies);
      if (!email) {
        email = await createFresh();
      } else if (owned.dynamics_email_id) {
        // Another worker recorded an activity after our claim; it owns the send.
        throw handoffError('handoff_email_lease_lost');
      } else if (accepted(email)) {
        await adopt(email);
      } else if (matchesRecipients(email)) {
        await adopt(email);
      } else {
        await rebuild();
        email = await createFresh();
      }
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
    // test_request_email_denied is not terminal: the transport also uses it
    // when the request marker or the activity cannot be read (a transient
    // Dataverse failure), so it stays pending and retryable like any failure.
    const code = typeof error?.code === 'string' && error.code ? error.code : 'handoff_email_failed';
    console.error('Final Writeup handoff email failed:', code, error?.message);
    await dependencies.recordFailure(sourceDocumentId, code, token).catch(() => {});
    return { status: 'failed', code };
  }
}

/**
 * Route hook after a start that did not end in progress. The transition for
 * this draft is committed, so an intent that recovery expired meanwhile as
 * transition_not_committed is reopened first. Never throws.
 */
export async function deliverGroupReviewHandoff(
  { sourceDocumentId },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(sourceDocumentId)) return { status: 'invalid' };
  const id = String(sourceDocumentId).toLowerCase();
  try {
    await dependencies.reopenExpired(id);
  } catch (error) {
    console.error('Final Writeup handoff email could not reopen an expired intent:', error?.message);
  }
  return deliverHandoffEmail(id, dependencies);
}

/** Retry pending rows: the 15-minute cron and the owner-run recovery script. */
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
