/**
 * API: POST /api/workbench/grantee-deliverables/send-invite
 *
 * Chunk 3c of the Grantee Deliverables Portal. Staff-initiated (Awardee tab):
 * email the grantee a magic-link to the deliverables portal (PI in To,
 * liaison Cc'd — owner S268). Staff have already confirmed/overridden the
 * recipients and previewed/edited the body.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 series C):
 * method dispatch → auth guard → sender/recipient/subject/body validation →
 * withDalContext → one service call → result/error→HTTP mapping. The
 * generate-first / already-submitted / request-number guards, server-side
 * magic-link mint + injection, Dynamics email send, and the non-downgrade
 * status flip (partial success = 200 with statusPersisted:false) live in
 * lib/services/workbench/grantee-deliverables/send-invite-service.js.
 *
 * AUTH: requireAppAccess('reviewers'). requestId GUID-validated off req.body.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { sendGranteeInvite } from '../../../../lib/services/workbench/grantee-deliverables/send-invite-service';

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

const isEmail = (s) => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

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

  return withDalContext('grantee-send-invite', async () => {
    try {
      const body = await sendGranteeInvite({
        requestId, toEmail, ccEmail, subject, bodyText, fromEmail, actingUserSystemId,
      });
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[grantee-deliverables/send-invite] error:', error);
      return res.status(500).json({ error: 'Failed to send the invitation.' });
    }
  });
}
