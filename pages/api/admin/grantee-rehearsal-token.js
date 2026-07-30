/**
 * Temporary controlled-rehearsal endpoint.
 *
 * This route is intentionally hard-bound to Justin and request 1002788. It
 * exists only long enough to mint one production-signed link without sending
 * an invitation email, and is removed immediately after that link is captured.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { mintForRequest } from '../../../lib/external/grantee-token-lifecycle';

const REHEARSAL_REQUEST_ID = 'feabe26f-dc1b-f111-8341-000d3a306da2';
const REHEARSAL_USER = 'jgallivan@wmkeck.org';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const email = String(access.session?.user?.azureEmail || '').trim().toLowerCase();
  const requestId = String(req.query?.requestId || '').trim().toLowerCase();
  if (email !== REHEARSAL_USER || requestId !== REHEARSAL_REQUEST_ID) {
    return res.status(403).json({ error: 'This rehearsal endpoint is not available.' });
  }

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const token = await mintForRequest({ requestId: REHEARSAL_REQUEST_ID, expiresAt });
  return res.status(200).json({
    url: token.url,
    jti: token.jti,
    expiresAt: token.expiresAt.toISOString(),
  });
}
