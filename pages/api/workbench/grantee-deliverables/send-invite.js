/**
 * API: POST /api/workbench/grantee-deliverables/send-invite
 *
 * Chunk 3c of the Grantee Deliverables Portal. Staff-initiated (Awardee tab):
 * email the grantee a magic-link to the deliverables portal. The invite
 * addresses the PI in `To` and Cc's the liaison (owner S268). Staff have already
 * confirmed/overridden the recipients and previewed/edited the email body, so
 * this route accepts the final to/cc/subject/body and:
 *   - requires the abstract to be generated first (status >= Drafted),
 *   - refuses if already Submitted+ (don't re-invite a responded package),
 *   - mints a stateless per-request magic-link SERVER-SIDE (chunk 1) and injects
 *     the action button + fallback link into the body (never from staff input),
 *   - sends from the staff member's mailbox (azureEmail) via the Dynamics email
 *     activity (same M365 path as reviewer invites), regarding the request,
 *   - flips status Drafted -> Invited (non-downgrade; never on a later status).
 *
 * AUTH: requireAppAccess('reviewers'). requestId GUID-validated off req.body.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { DynamicsService } from '../../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../../lib/services/dynamics-context';
import { isGuid } from '../../../../lib/utils/guid';
import { mintForRequest } from '../../../../lib/external/grantee-token-lifecycle';
import { renderGranteeInviteHtml } from '../../../../lib/external/grantee-invite-email';
import { GRANTEE_DELIVERABLE_STATUS } from '../../../../shared/config/granteeDeliverableStatus';

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

const isEmail = (s) => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const normStatus = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const fromEmail = access.session?.user?.azureEmail;
  if (!fromEmail) {
    return res.status(400).json({ error: 'Your account has no sending email address.' });
  }

  // GUID-validate off req.body before it becomes a record-id selector (check:trust-boundary-guid).
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  const toEmail = (req.body?.toEmail || '').trim();
  const ccEmail = (req.body?.ccEmail || '').trim();
  const subject = (req.body?.subject || '').trim();
  const bodyText = String(req.body?.bodyText || '');
  if (!isEmail(toEmail)) {
    return res.status(400).json({ error: 'A valid recipient (To) email is required.' });
  }
  if (ccEmail && !isEmail(ccEmail)) {
    return res.status(400).json({ error: 'The Cc email is invalid.' });
  }
  if (!subject) {
    return res.status(400).json({ error: 'A subject is required.' });
  }
  if (bodyText.trim().length < 10) {
    return res.status(400).json({ error: 'The email body is required.' });
  }

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  return bypassDynamicsRestrictions('grantee-send-invite', async () => {
    try {
      let row;
      try {
        row = await DynamicsService.getRecord('akoya_requests', requestId, {
          select: 'akoya_requestid,wmkf_granteedeliverablestatus',
        });
      } catch {
        row = null;
      }
      if (!row?.akoya_requestid) {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }

      const status = normStatus(row.wmkf_granteedeliverablestatus);
      // Must generate the abstract first.
      if (status === null || status < GRANTEE_DELIVERABLE_STATUS.DRAFTED) {
        return res.status(400).json({ error: 'Generate the abstract before sending the invite.' });
      }
      // Don't re-invite a package the grantee has already submitted/closed.
      if (status >= GRANTEE_DELIVERABLE_STATUS.SUBMITTED) {
        return res.status(409).json({ error: 'This package has already been submitted; a new invite cannot be sent.' });
      }

      // Mint the magic-link SERVER-SIDE and inject it — never trust a link in the body.
      const { url } = await mintForRequest({ requestId });
      const html = renderGranteeInviteHtml({ bodyText, url });

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
        return res.status(502).json({ error: 'Failed to send the invitation email.' });
      }

      // Flip Drafted -> Invited. Non-downgrade: a re-send while already Invited /
      // Reminder Sent leaves status unchanged. Non-fatal — the email is already out.
      if (status === GRANTEE_DELIVERABLE_STATUS.DRAFTED) {
        try {
          await DynamicsService.updateRecord(
            'akoya_requests', requestId,
            { wmkf_granteedeliverablestatus: GRANTEE_DELIVERABLE_STATUS.INVITED },
            { actingUserSystemId },
          );
        } catch (e) {
          console.error('[grantee-deliverables/send-invite] status update failed (email already sent):', e.message);
        }
      }

      const newStatus = status === GRANTEE_DELIVERABLE_STATUS.DRAFTED
        ? GRANTEE_DELIVERABLE_STATUS.INVITED
        : status;
      return res.status(200).json({ ok: true, emailId: sent?.emailId || null, status: newStatus });
    } catch (error) {
      console.error('[grantee-deliverables/send-invite] error:', error);
      return res.status(500).json({ error: 'Failed to send the invitation.' });
    }
  });
}
