/**
 * POST /api/review-manager/regenerate-token
 *
 * Mint a fresh external-access token for a suggestion and persist its hash.
 * Use cases: reviewer lost the email, link was leaked, or the prior token
 * was revoked and the reviewer is now back in good standing.
 *
 * Body: { suggestionId: string, expiresAt?: ISO8601 }
 *
 * `expiresAt` defaults to 90 days from now if omitted. The eventual UI will
 * surface a date picker (review-due-date + 4 weeks grace per plan); until
 * that ships, callers can supply any future date explicitly.
 *
 * Response: { ok: true, url, expiresAt, jti }
 *
 * Side-effect: any prior outstanding token for this suggestion immediately
 * stops verifying — the verifier compares the presented JWT's hash against
 * the stored hash, and we just overwrote it.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 2): method
 * dispatch → auth guard → input validation (incl. expiresAt parsing) →
 * withDalContext → one service call → result/error→HTTP mapping. All
 * business logic (excluded fail-closed chokepoint, mint, best-effort draft
 * cleanup) lives in lib/services/review-manager/regenerate-token-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { regenerateToken } from '../../../lib/services/review-manager/regenerate-token-service';

const DEFAULT_TTL_DAYS = 90;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  const { suggestionId, expiresAt: rawExpires } = req.body || {};
  if (!suggestionId || typeof suggestionId !== 'string') {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId required.'] });
  }
  // GUID-validate before it becomes a Dataverse record-id selector (getRecord
  // interpolates it raw into the request URL).
  if (!isGuid(suggestionId)) {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
  }

  let expiresAt;
  if (rawExpires) {
    expiresAt = new Date(rawExpires);
    if (Number.isNaN(expiresAt.getTime())) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['expiresAt must be a valid ISO date.'] });
    }
    if (expiresAt.getTime() <= Date.now()) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['expiresAt must be in the future.'] });
    }
  } else {
    expiresAt = new Date(Date.now() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  return withDalContext('regenerate-token-lookup', async () => {
    try {
      const result = await regenerateToken({ suggestionId, expiresAt, actingUserSystemId });
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
