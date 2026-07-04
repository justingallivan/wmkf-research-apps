/**
 * API Route: /api/review-manager/release-settings
 *
 * Reviewer materials/release email delivery setting — whether the release
 * flow offers proposal/file attachments (SharePoint proposal auto-attach +
 * manual Vercel Blob uploads) in addition to the reviewer's tokenized portal
 * link. Default OFF (portal-link-only). See lib/services/reviewer-release-config.js.
 *
 * GET  — App-gated (`review-manager`/`reviewers`), same boundary as the rest of
 *        Review Manager. `ReviewerManagePanel`'s EmailModal reads this fresh
 *        every time it opens (no build-time constant).
 * PUT  — Superuser-gated. Admin panel "Reviewer Release Attachments" section.
 */

import { requireAppAccess, requireSuperuser } from '../../../lib/utils/auth';
import {
  getAttachProposalEmailSetting,
  setAttachProposalEmailSetting,
} from '../../../lib/services/reviewer-release-config';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method === 'GET') {
    const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
    if (!access) return;
    const attachProposalEmail = await getAttachProposalEmailSetting();
    return res.status(200).json({ attachProposalEmail });
  }

  // PUT
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  const { attachProposalEmail } = req.body || {};
  if (typeof attachProposalEmail !== 'boolean') {
    return res.status(400).json({ error: 'attachProposalEmail must be a boolean' });
  }
  const ok = await setAttachProposalEmailSetting(attachProposalEmail, gate.profileId);
  if (!ok) {
    return res.status(500).json({ error: 'Failed to save reviewer release attachment setting' });
  }
  return res.status(200).json({ attachProposalEmail });
}
