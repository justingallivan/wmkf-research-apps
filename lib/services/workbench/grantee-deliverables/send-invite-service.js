/**
 * Workbench grantee-deliverables — invite-send service
 * (Route→Service Consolidation Plan, Stage 4 series C).
 *
 * Holds ALL business logic for POST /api/workbench/grantee-deliverables/
 * send-invite (chunk 3c); the route is a thin shell (method, auth, sender +
 * recipient/subject/body validation, DAL context, HTTP mapping).
 * Pipeline preserved verbatim:
 *   - requires the abstract to be generated first (status >= Drafted),
 *   - refuses if already Submitted+ (don't re-invite a responded package),
 *   - fails loud on a corrupt non-numeric status BEFORE mint/send,
 *   - refuses outgoing text containing the internal request number,
 *   - mints the stateless magic-link SERVER-SIDE and injects it (+ the
 *     assigned-PD signature) into the body — never from staff input,
 *   - sends from the staff member's mailbox via the Dynamics email activity,
 *   - flips status Drafted -> Invited (non-downgrade; PARTIAL SUCCESS is a
 *     200: a failed status write after a successful send reports the ACTUAL
 *     status with statusPersisted:false — the email is already out).
 *
 * Contract (plan Decision 3): plain args; returns
 * { ok, emailId, status, statusPersisted }; throws ServiceHttpError with
 * default `{ error }` bodies — 404, 400 request-number leak, 500 corrupt
 * status, 400 generate-first, 409 already submitted, 502 send failure.
 * ASSUMES a trusted DAL context already exists.
 */

import { DynamicsService } from '../../dynamics-service';
import * as grantRequestAdapter from '../../../dataverse/adapters/grant-request';
import { mintForRequest } from '../../../external/grantee-token-lifecycle';
import { renderGranteeInviteHtml } from '../../../external/grantee-invite-email';
import { appendSignatureBlock, resolveSignatureForRequest } from '../../email-signature';
import {
  ensureDeliverableForRequest,
  patchDeliverable,
} from '../../grantee-deliverable-record';
import { GRANTEE_DELIVERABLE_STATUS } from '../../../../shared/config/granteeDeliverableStatus';
import { ServiceHttpError } from '../../service-http-error';

const normStatus = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const containsRequestNumber = (text, requestNumber) => {
  const n = String(requestNumber || '').trim();
  return Boolean(n && String(text || '').includes(n));
};

/**
 * @param {Object} args - shell-validated inputs
 * @param {string} args.requestId - GUID
 * @param {string} args.toEmail
 * @param {string} args.ccEmail - '' when absent
 * @param {string} args.subject
 * @param {string} args.bodyText
 * @param {string} args.fromEmail - staff sender (session azureEmail)
 * @param {string|null} args.actingUserSystemId
 * @returns {Promise<{ ok: true, emailId: string|null, status: number, statusPersisted: boolean }>}
 * @throws {ServiceHttpError} per the historical status codes
 */
export async function sendGranteeInvite({ requestId, toEmail, ccEmail, subject, bodyText, fromEmail, actingUserSystemId }) {
  let row;
  try {
    row = await grantRequestAdapter.getById(requestId, { select: grantRequestAdapter.SELECT_PROFILES.IDENTITY });
  } catch {
    row = null;
  }
  if (!row?.akoya_requestid) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }
  if (containsRequestNumber(subject, row.akoya_requestnum) || containsRequestNumber(bodyText, row.akoya_requestnum)) {
    throw new ServiceHttpError('Email subject/body cannot include the internal request number.', { httpStatus: 400 });
  }

  const deliverable = await ensureDeliverableForRequest(requestId, {
    requestNumber: row.akoya_requestnum,
    actingUserSystemId,
  });
  const status = normStatus(deliverable?.wmkf_deliverablestatus);
  // Corrupt/non-numeric status must NOT slip past the guards — NaN comparisons
  // are all false, which would otherwise let a bad value reach mint/send. Fail loud.
  if (status !== null && Number.isNaN(status)) {
    console.error('[grantee-deliverables/send-invite] non-numeric status on', requestId);
    throw new ServiceHttpError('This request has an invalid deliverable status; cannot send.', { httpStatus: 500 });
  }
  // Must generate the abstract first.
  if (status === null || status < GRANTEE_DELIVERABLE_STATUS.DRAFTED) {
    throw new ServiceHttpError('Generate the abstract before sending the invite.', { httpStatus: 400 });
  }
  // Don't re-invite a package the grantee has already submitted/closed.
  if (status >= GRANTEE_DELIVERABLE_STATUS.SUBMITTED) {
    throw new ServiceHttpError('This package has already been submitted; a new invite cannot be sent.', { httpStatus: 409 });
  }

  // Mint the magic-link SERVER-SIDE and inject it — never trust a link in the body.
  const { url } = await mintForRequest({ requestId });
  const signatureBlock = await resolveSignatureForRequest(requestId);
  const html = renderGranteeInviteHtml({
    bodyText: appendSignatureBlock(bodyText, signatureBlock),
    url,
  });

  let sent;
  try {
    sent = await DynamicsService.createAndSendEmail({
      subject,
      body: html,
      from: fromEmail,
      to: toEmail,
      cc: ccEmail || undefined,
      regardingId: requestId,
      regardingType: 'akoya_request',
      actingUserSystemId,
    });
  } catch (e) {
    console.error('[grantee-deliverables/send-invite] send failed:', e.message);
    throw new ServiceHttpError('Failed to send the invitation email.', { httpStatus: 502 });
  }

  // Flip Drafted -> Invited. Non-downgrade: a re-send while already Invited /
  // Reminder Sent leaves status unchanged. Non-fatal — the email is already out.
  // Report the ACTUAL persisted status: a failed write must NOT be reported as
  // Invited (the email sent, but status stays Drafted durably).
  let finalStatus = status;
  let statusPersisted = true;
  if (status === GRANTEE_DELIVERABLE_STATUS.DRAFTED) {
    try {
      await patchDeliverable(requestId, {
        wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.INVITED,
        wmkf_inviteddate: new Date().toISOString(),
      }, {
        ifMatch: deliverable._etag,
        actingUserSystemId,
      });
      finalStatus = GRANTEE_DELIVERABLE_STATUS.INVITED;
    } catch (e) {
      console.error('[grantee-deliverables/send-invite] status update failed (email already sent):', e.message);
      statusPersisted = false;
    }
  }

  return { ok: true, emailId: sent?.emailId || null, status: finalStatus, statusPersisted };
}
