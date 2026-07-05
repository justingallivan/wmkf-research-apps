/**
 * POST /api/review-manager/synthesize-reviews
 *
 * AI synthesis of a proposal's SUBMITTED peer reviews (workbench Reviews tab
 * Phase 4, docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * Body: { requestId: string, overwrite?: boolean } — requestId is a Dataverse
 * GUID, validated BEFORE it reaches any Dataverse selector.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 2): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. All business logic (submitted-review
 * gathering, digest composition, the regeneration gate, Executor call,
 * writeback checks) lives in
 * lib/services/review-manager/synthesize-reviews-service.js.
 *
 * Data boundary: staff-shared, matching every other `/api/review-manager/*`
 * route — any `review-manager`/`reviewers` user can synthesize any proposal's
 * reviews.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { synthesizeReviews } from '../../../lib/services/review-manager/synthesize-reviews-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  const { requestId, overwrite = false } = req.body || {};
  if (!requestId || typeof requestId !== 'string' || !isGuid(requestId)) {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['requestId must be a valid GUID.'] });
  }

  return withDalContext('review-manager-synthesize-reviews', async () => {
    try {
      const result = await synthesizeReviews({ requestId, overwrite, actingUserSystemId });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[review-manager synthesize-reviews] error:', error);
      return res.status(500).json({ ok: false, reason: 'server_error' });
    }
  });
}
