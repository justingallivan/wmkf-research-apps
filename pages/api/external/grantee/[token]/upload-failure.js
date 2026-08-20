/** Authenticated, closed-shape client telemetry for direct Blob upload failures. */

import { verifyGranteeToken } from '../../../../../lib/external/verify-grantee-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import {
  parsePortalUploadFailure,
  recordPortalUploadClientFailure,
} from '../../../../../lib/services/portal-upload-client-failure';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }
  const token = req.query.token;
  const rl = await checkRateLimit(req, token);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return res.status(429).json({ ok: false });
  }
  const verified = await withDalContext('grantee-token-verify', () => verifyGranteeToken(token));
  await recordTokenOutcome(req, token, verified.ok);
  if (!verified.ok) return res.status(verified.reason === 'not_found' ? 404 : 401).json({ ok: false });

  const report = parsePortalUploadFailure(req.body);
  if (!report) return res.status(400).json({ ok: false });
  await recordPortalUploadClientFailure({
    surface: 'external_grantee',
    resourceId: verified.requestId,
    report,
  });
  return res.status(200).json({ ok: true });
}

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };
