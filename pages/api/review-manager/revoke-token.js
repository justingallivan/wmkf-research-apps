/**
 * POST /api/review-manager/revoke-token
 *
 * Sets `wmkf_externaltokenrevoked = true` on the suggestion. The presented
 * token's hash stays in place so audit logs can still identify which token
 * was active at revocation time.
 *
 * Body: { suggestionId: string }
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { revoke } from '../../../lib/external/token-lifecycle';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  try {
    const { suggestionId } = req.body || {};
    if (!suggestionId || typeof suggestionId !== 'string') {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId required.'] });
    }

    try {
      await revoke(suggestionId, { actingUserSystemId });
    } catch (e) {
      if (/update.*failed.*404/i.test(e.message || '')) {
        return res.status(404).json({ ok: false, reason: 'not_found' });
      }
      throw e;
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[review-manager revoke-token] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
