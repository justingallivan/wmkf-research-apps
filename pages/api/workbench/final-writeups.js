/**
 * API: /api/workbench/final-writeups
 *
 * GET returns the ordinary Workbench-user Final Writeups queue. Optional
 * `requestId` returns the same bounded projection plus one focused row and its
 * server-derived previous/next navigation. The index response adds a complete
 * coordinator matrix for superusers. Persona-specific leadership/PC lenses
 * remain rollout-disabled pending their separate access proof.
 */

import { withDalContext } from '../../../lib/dataverse/core/context';
import { loadFinalWriteupsDashboard } from '../../../lib/services/final-writeup/dashboard-service';
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
  const queryKeys = Object.keys(req.query || {});
  if (queryKeys.some((key) => key !== 'requestId')) {
    return res.status(400).json({ error: 'Only the optional requestId query parameter is supported' });
  }
  if (req.query?.requestId !== undefined && typeof req.query.requestId !== 'string') {
    return res.status(400).json({ error: 'requestId must be a single GUID' });
  }
  const selectedRequestId = typeof req.query?.requestId === 'string'
    ? req.query.requestId.trim()
    : null;
  if (selectedRequestId !== null && !isGuid(selectedRequestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  return withDalContext('workbench-final-writeups-dashboard', async () => {
    try {
      const body = await loadFinalWriteupsDashboard({
        actingUserSystemId,
        selectedRequestId,
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
