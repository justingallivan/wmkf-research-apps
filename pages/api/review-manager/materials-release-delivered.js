/**
 * POST /api/review-manager/materials-release-delivered
 *
 * Staff "Mark as delivered" for a materials email that was confirmed sent but
 * whose reviewer row was never recorded (D46/D49). Sends nothing.
 *
 * Body: { suggestionId: string }
 *
 * Same send-side authorization as /api/review-manager/send-emails: the lead
 * PD for the request or a superuser. Thin route shell: method dispatch → auth
 * guard → input validation → request authorization → withDalContext → one
 * service call (lib/services/reviewer-engagement/mark-materials-delivered.js)
 * → result/error→HTTP mapping.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';
import { markMaterialsDelivered } from '../../../lib/services/reviewer-engagement/mark-materials-delivered';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const { suggestionId } = req.body || {};
  if (typeof suggestionId !== 'string' || !isGuid(suggestionId)) {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
  }

  const actingUserSystemId = actorRefFromSession(access.session);

  try {
    const result = await withDalContext('review-manager-materials-delivered', async () => {
      await authorizeReviewerRequestMutation({
        profileId: access.profileId,
        callerSystemId: actingUserSystemId,
        suggestionIds: [suggestionId],
      });
      return markMaterialsDelivered({ suggestionId, actorProfileId: access.profileId, actingUserSystemId });
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { ok: false, error: error.message });
    }
    console.error('[review-manager materials-release-delivered] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
