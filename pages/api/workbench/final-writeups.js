/**
 * API: /api/workbench/final-writeups
 *
 * GET returns the ordinary Workbench-user Final Writeups queue for one grant
 * cycle. Optional `cycleCode` (a cycle code such as `D26`, or `none` for
 * requests without a meeting date) selects the cycle; without it the service
 * picks the newest cycle with a row visible to the viewer. Optional `requestId`
 * returns the focused row plus server-derived previous/next navigation inside
 * that request's own cycle; it never accepts `cycleCode`. The index response
 * adds a complete coordinator matrix for superusers. Persona-specific lenses
 * are derived from the published v2 staffing configuration and current
 * reviewer-role roster.
 */

import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  isFinalWriteupCycleSelector,
  loadFinalWriteupsDashboard,
} from '../../../lib/services/final-writeup/dashboard-service';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { getUserRole, requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  const role = access.profileId === null ? 'superuser' : await getUserRole(access.profileId);
  const isSuperuser = role === 'superuser';
  const ALLOWED_QUERY_KEYS = new Set(['requestId', 'cycleCode']);
  const queryKeys = Object.keys(req.query || {});
  if (queryKeys.some((key) => !ALLOWED_QUERY_KEYS.has(key))) {
    return res.status(400).json({ error: 'Only the optional requestId or cycleCode query parameter is supported' });
  }
  if (req.query?.requestId !== undefined && typeof req.query.requestId !== 'string') {
    return res.status(400).json({ error: 'requestId must be a single GUID' });
  }
  if (req.query?.cycleCode !== undefined && typeof req.query.cycleCode !== 'string') {
    return res.status(400).json({ error: 'cycleCode must be a single cycle code' });
  }
  const selectedRequestId = typeof req.query?.requestId === 'string'
    ? req.query.requestId.trim()
    : null;
  if (selectedRequestId !== null && !isGuid(selectedRequestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }
  const cycleCode = typeof req.query?.cycleCode === 'string'
    ? req.query.cycleCode.trim()
    : null;
  if (cycleCode !== null && !isFinalWriteupCycleSelector(cycleCode)) {
    return res.status(400).json({ error: 'cycleCode must be a cycle code such as D26, or none' });
  }
  if (selectedRequestId !== null && cycleCode !== null) {
    return res.status(400).json({ error: 'A focused request derives its own cycle; do not combine requestId with cycleCode' });
  }

  return withDalContext('workbench-final-writeups-dashboard', async () => {
    try {
      const body = await loadFinalWriteupsDashboard({
        actingUserSystemId,
        selectedRequestId,
        cycleCode,
        isSuperuser,
      });
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('workbench final-writeups dashboard error:', error);
      return res.status(500).json({
        error: 'Failed to load Final Writeups.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
