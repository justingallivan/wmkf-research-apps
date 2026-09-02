/**
 * POST /api/review-manager/regenerate-token
 *
 * Mint a fresh external-access token for a suggestion and persist its hash.
 * Use cases: reviewer lost the email, link was leaked, or the prior token
 * was revoked and the reviewer is now back in good standing.
 *
 * Body: { suggestionId: string }
 *
 * Expiry is server-derived from the suggestion's effective review due date
 * (per-reviewer override, then request default) and accepted state. Clients
 * cannot supply a divergent expiry.
 *
 * Response: { ok: true, url, expiresAt, jti }
 *
 * Side-effect: any prior outstanding token for this suggestion immediately
 * stops verifying — the verifier compares the presented JWT's hash against
 * the stored hash, and we just overwrote it.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 2): method
 * dispatch → auth guard → input validation →
 * withDalContext → one service call → result/error→HTTP mapping. All
 * business logic (excluded fail-closed chokepoint, mint, best-effort draft
 * cleanup) lives in lib/services/review-manager/regenerate-token-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { regenerateToken } from '../../../lib/services/review-manager/regenerate-token-service';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = actorRefFromSession(access.session);

  const { suggestionId } = req.body || {};
  if (!suggestionId || typeof suggestionId !== 'string') {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId required.'] });
  }
  // GUID-validate before it becomes a Dataverse record-id selector (getRecord
  // interpolates it raw into the request URL).
  if (!isGuid(suggestionId)) {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
  }

  return withDalContext('regenerate-token-lookup', async () => {
    try {
      await authorizeReviewerRequestMutation({
        profileId: access.profileId,
        callerSystemId: actingUserSystemId,
        suggestionIds: [suggestionId],
      });
      const result = await regenerateToken({ suggestionId, actingUserSystemId });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[review-manager regenerate-token] error:', error);
      return res.status(500).json({ ok: false, reason: 'server_error' });
    }
  });
}
