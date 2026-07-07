/**
 * API Route: /api/review-manager/campaign-timeline-defaults
 *
 * Reviewer campaign timeline defaults for the current grant cycle.
 *
 * GET  — App-gated (`review-manager`/`reviewers`) so InviteEmailModal can
 *        pre-fill timeline fields for staff.
 * PUT  — Superuser-gated. Admin panel card writes the single Dataverse
 *        `wmkf_appsystemsettings` JSON value.
 */

import { requireAppAccess, requireSuperuser } from '../../../lib/utils/auth';
import {
  getReviewerCampaignTimeline,
  setReviewerCampaignTimeline,
} from '../../../lib/services/reviewer-campaign-timeline';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method === 'GET') {
    const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
    if (!access) return;
    const result = await getReviewerCampaignTimeline();
    return res.status(200).json(result);
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  try {
    const result = await setReviewerCampaignTimeline(req.body?.timeline, gate.profileId);
    if (!result) {
      return res.status(500).json({ error: 'Failed to save reviewer campaign timeline defaults' });
    }
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
