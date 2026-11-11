/** Default-off, staff-authorized Sandbox recommendation results. */
import { withDalContext } from '../../../lib/dataverse/core/context';
import { readRecommendationsAccessPolicy } from '../../../lib/services/prompt-jobs/recommendations-sandbox-policy';
import { readStaffRecommendation } from '../../../lib/services/prompt-jobs/staff-recommendations-service';
import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';

export const config = { maxDuration: 180 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const unavailable = () => res.status(404).json({ error: 'recommendation_not_found' });
  if (!readRecommendationsAccessPolicy()) return unavailable();
  const access = await requireAppAccess(req, res, 'expertise-finder');
  if (!access) return;
  const user = access.session?.user;
  if (access.authBypassed || access.session?.authBypassed || user?.authBypassed || user?.userType !== 'staff'
    || !Number.isSafeInteger(access.profileId) || access.profileId < 1 || user.profileId !== access.profileId
    || !isGuid(user.azureId) || !isGuid(user.dynamicsSystemuserId)) {
    return res.status(403).json({ error: 'Staff access required' });
  }
  const { requestId, jobId } = req.query || {};
  if (Object.keys(req.query || {}).length !== 2 || !isGuid(requestId) || !isGuid(jobId)) {
    return res.status(400).json({ error: 'Request and job GUIDs required' });
  }
  try {
    const value = await withDalContext('expertise-recommendations-read', () => readStaffRecommendation({
      access, requestId: requestId.trim().toLowerCase(), jobId: jobId.trim().toLowerCase(),
    }));
    return value ? res.status(200).json(value) : unavailable();
  } catch { return unavailable(); }
}
