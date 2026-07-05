/**
 * API: /api/reviewer-finder/my-proposals
 *
 * Surfaces akoya_request rows assigned to the authenticated user as program
 * director. Replaces the PDF-upload entry path for Reviewer Finder.
 *
 * GET (no cycleCode): distinct cycle codes (Jxx/Dxx) the current PD has
 *   proposals in, newest first.
 * GET ?cycleCode=Jxx [&status=actionable|all]: the proposals in that cycle.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 3): method
 * dispatch → auth guard → session-email validation → withDalContext → one
 * service call → result/error→HTTP mapping. PD resolution, cycle/status
 * filters, and reviewer-count aggregation live in
 * lib/services/reviewer-finder/my-proposals-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { getMyProposals } from '../../../lib/services/reviewer-finder/my-proposals-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const azureEmail = access.session?.user?.azureEmail;
  if (!azureEmail) {
    return res.status(400).json({
      error: 'Could not determine your email from the session. Sign out and back in.',
    });
  }

  // Read-only Dynamics queries; trusted staff endpoint.
  return withDalContext('reviewer-finder-my-proposals', async () => {
    try {
      const { cycleCode, status } = req.query;
      const result = await getMyProposals({ azureEmail, cycleCode, status });
      return res.status(200).json(result);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      console.error('my-proposals error:', err);
      return res.status(500).json({
        error: 'Failed to load proposals',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
