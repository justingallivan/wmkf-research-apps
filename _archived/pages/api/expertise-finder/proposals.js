/**
 * API Route: /api/expertise-finder/proposals
 *
 * GET: Query Dynamics for historical proposals, filtered by grant cycle and program.
 *
 * Query parameters:
 *   cycleCode: string   - grant cycle code, Jyy/Dyy (required)
 *   program: string     - "SE" or "MR" (optional, filters by internal program)
 *
 * Returns: { proposals: [...], totalCount: number }
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. Business logic lives in
 * lib/services/expertise-finder/proposals-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { queryProposals } from '../../../lib/services/expertise-finder/proposals-service';
import { parseCycleCode } from '../../../lib/utils/cycle-code';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'expertise-finder');
  if (!access) return;

  const { cycleCode, program } = req.query;

  if (!cycleCode) {
    return res.status(400).json({ error: 'cycleCode is required' });
  }
  if (typeof cycleCode !== 'string' || !parseCycleCode(cycleCode)) {
    return res.status(400).json({ error: 'cycleCode must be a grant cycle code such as D26' });
  }

  return withDalContext('expertise-finder-proposals', async () => {
    try {
      const result = await queryProposals({ cycleCode: cycleCode.trim().toUpperCase(), program });
      return res.status(200).json(result);
    } catch (error) {
      console.error('[ExpertiseFinder] Proposals query error:', error);
      return res.status(500).json({
        error: 'Failed to query proposals from Dynamics',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
