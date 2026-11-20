/**
 * API Route: /api/expertise-finder/history
 *
 * GET: Fetch match history for the current user
 *
 * Query parameters:
 *   limit: number  - Default: 50
 *   offset: number - Default: 0
 */

import { sql } from '@vercel/postgres';
import { requireAppAccess } from '../../../lib/utils/auth';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'expertise-finder');
  if (!access) return;

  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const result = await sql`
      SELECT id, proposal_title, proposal_filename, match_results,
             model_used, input_tokens, output_tokens, estimated_cost_cents,
             created_at
      FROM expertise_matches
      WHERE user_profile_id = ${access.profileId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await sql`
      SELECT COUNT(*) as total FROM expertise_matches
      WHERE user_profile_id = ${access.profileId}
    `;

    return res.status(200).json({
      success: true,
      matches: result.rows,
      total: parseInt(countResult.rows[0].total),
    });
  } catch (error) {
    console.error('Match history error:', error);
    return res.status(500).json({ error: 'Failed to fetch match history' });
  }
}
