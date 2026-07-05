/**
 * API: POST /api/workbench/grantee-deliverables/preview-invite
 *
 * Render-only preview of the grantee invitation email for the Awardee tab.
 * Returns the EXACT HTML that send-invite would email (same
 * renderGranteeInviteHtml), so staff can see the formatting + the magic-link
 * button before committing.
 *
 * CRITICAL — this is a READ-ONLY RENDER. It NEVER sends an email, mints a real
 * magic-link token, writes Dataverse, or changes any deliverable status. It
 * reads the request's assigned PD so the preview includes the same server-owned
 * signature that send-invite will append.
 *
 * AUTH: requireAppAccess('reviewers') (same as send-invite). requestId is
 * GUID-validated before assigned-PD lookup.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { renderGranteeInviteHtml } from '../../../../lib/external/grantee-invite-email';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { appendSignatureBlock, resolveSignatureForRequest } from '../../../../lib/services/email-signature';
import { isGuid } from '../../../../lib/utils/guid';

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

// Obvious non-functional placeholder so the preview can't be mistaken for a live
// link. The real per-request token is generated only when the invite is sent.
const PLACEHOLDER_LINK =
  'https://[grantee-portal]/external/grantee/[secure link generated when you send]';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  const bodyText = String(req.body?.bodyText || '');
  if (bodyText.trim().length < 10) {
    return res.status(400).json({ error: 'The email body is required.' });
  }

  return withDalContext('grantee-preview-invite', async () => {
    const signatureBlock = await resolveSignatureForRequest(requestId);
    const html = renderGranteeInviteHtml({
      bodyText: appendSignatureBlock(bodyText, signatureBlock),
      url: PLACEHOLDER_LINK,
    });
    return res.status(200).json({ html });
  });
}
