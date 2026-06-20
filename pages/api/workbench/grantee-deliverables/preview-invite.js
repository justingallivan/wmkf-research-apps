/**
 * API: POST /api/workbench/grantee-deliverables/preview-invite
 *
 * Render-only preview of the grantee invitation email for the Awardee tab.
 * Returns the EXACT HTML that send-invite would email (same
 * renderGranteeInviteHtml), so staff can see the formatting + the magic-link
 * button before committing.
 *
 * CRITICAL — this is a PURE RENDER. It NEVER sends an email, mints a real
 * magic-link token, reads/writes Dataverse, or changes any deliverable status.
 * The staff-edited body is rendered with a clearly-marked PLACEHOLDER link; the
 * real per-request magic-link is minted only by send-invite at actual send time.
 *
 * AUTH: requireAppAccess('reviewers') (same as send-invite). No client id
 * reaches a selector (no requestId, no Dataverse access) — nothing to validate
 * beyond the body length, and no trust-boundary surface.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { renderGranteeInviteHtml } from '../../../../lib/external/grantee-invite-email';

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

  const bodyText = String(req.body?.bodyText || '');
  if (bodyText.trim().length < 10) {
    return res.status(400).json({ error: 'The email body is required.' });
  }

  const html = renderGranteeInviteHtml({ bodyText, url: PLACEHOLDER_LINK });
  return res.status(200).json({ html });
}
