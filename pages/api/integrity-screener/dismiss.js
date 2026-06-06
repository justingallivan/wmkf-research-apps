/**
 * API Route: /api/integrity-screener/dismiss
 *
 * Dismiss a match as a false positive.
 *
 * POST /api/integrity-screener/dismiss - Create a dismissal
 * GET /api/integrity-screener/dismiss?screeningId=N - Get dismissals for a screening
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { BASE_CONFIG } from '../../../shared/config/baseConfig';

export default async function handler(req, res) {
  // Require authentication + app access
  const access = await requireAppAccess(req, res, 'integrity-screener');
  if (!access) return;

  try {
    // model-override-warming:ignore reason=db-methods-only — this route calls only
    // IntegrityService.dismissMatch / getDismissals (Postgres reads/writes); it
    // never reaches screenApplicants, which is the only model-resolving path.
    const { IntegrityService } = await import('../../../lib/services/integrity-service');

    if (req.method === 'POST') {
      const {
        screeningId,
        source,
        sourceIdentifier,
        screenedName,
        reason,
        notes,
      } = req.body;

      // Validate required fields
      if (!screeningId) {
        return res.status(400).json({ error: 'screeningId is required' });
      }
      if (!source) {
        return res.status(400).json({ error: 'source is required' });
      }
      if (!screenedName) {
        return res.status(400).json({ error: 'screenedName is required' });
      }
      if (!reason) {
        return res.status(400).json({ error: 'reason is required' });
      }

      // Validate source
      const validSources = ['retraction_watch', 'pubpeer', 'news'];
      if (!validSources.includes(source)) {
        return res.status(400).json({
          error: `Invalid source. Must be one of: ${validSources.join(', ')}`,
        });
      }

      // Validate reason
      const validReasons = ['different_person', 'resolved', 'not_relevant'];
      if (!validReasons.includes(reason)) {
        return res.status(400).json({
          error: `Invalid reason. Must be one of: ${validReasons.join(', ')}`,
        });
      }

      await IntegrityService.dismissMatch(
        parseInt(screeningId),
        source,
        sourceIdentifier || null,
        screenedName,
        reason,
        notes || null
      );

      return res.json({
        success: true,
        message: 'Match dismissed successfully',
      });

    } else if (req.method === 'GET') {
      const { screeningId } = req.query;

      if (!screeningId) {
        return res.status(400).json({ error: 'screeningId is required' });
      }

      const dismissals = await IntegrityService.getDismissals(parseInt(screeningId));

      return res.json({
        dismissals,
        count: dismissals.length,
      });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Dismiss API error:', error);
    return res.status(500).json({
      error: BASE_CONFIG.ERROR_MESSAGES.SCREENING_FAILED,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}
