/**
 * API Route: /api/integrity-screener/history
 *
 * Get screening history and individual screening details.
 * All operations are scoped to the authenticated user's profile.
 *
 * GET /api/integrity-screener/history - List history for authenticated user
 * GET /api/integrity-screener/history?id=N - Get single screening (must belong to user)
 * PATCH /api/integrity-screener/history - Update screening status (must belong to user)
 */

import { requireAppAccess } from '../../../lib/utils/auth';

export default async function handler(req, res) {
  // Require authentication + app access, extract profile ID
  const access = await requireAppAccess(req, res, 'integrity-screener');
  if (!access) return;
  const sessionProfileId = access.profileId;

  try {
    // model-override-warming:ignore reason=db-methods-only — this route calls only
    // IntegrityService.getScreening / getScreeningHistory / updateScreeningStatus
    // (Postgres); it never reaches screenApplicants, the only model-resolving path.
    const { IntegrityService } = await import('../../../lib/services/integrity-service');

    if (req.method === 'GET') {
      const { id, limit = 50, offset = 0 } = req.query;

      // Get single screening with full details (scoped to authenticated user)
      if (id) {
        const screening = await IntegrityService.getScreening(
          parseInt(id),
          sessionProfileId
        );

        if (!screening) {
          return res.status(404).json({ error: 'Screening not found' });
        }

        return res.json(screening);
      }

      // Get history list for authenticated user
      const history = await IntegrityService.getScreeningHistory(
        sessionProfileId,
        parseInt(limit),
        parseInt(offset)
      );

      return res.json({
        history,
        count: history.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
      });

    } else if (req.method === 'PATCH') {
      const { id, status, notes } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Screening id is required' });
      }

      if (!status) {
        return res.status(400).json({ error: 'Status is required' });
      }

      const validStatuses = ['pending', 'reviewed', 'cleared', 'flagged'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        });
      }

      // Verify the screening belongs to the authenticated user before updating
      const screening = await IntegrityService.getScreening(
        parseInt(id),
        sessionProfileId
      );
      if (!screening) {
        return res.status(403).json({ error: 'Not authorized to modify this screening' });
      }

      await IntegrityService.updateScreeningStatus(
        parseInt(id),
        status,
        notes || null
      );

      return res.json({ success: true, id: parseInt(id), status });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('History API error:', error);
    return res.status(500).json({
      error: 'An unexpected error occurred',
    });
  }
}
