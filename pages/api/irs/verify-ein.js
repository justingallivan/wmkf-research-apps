/**
 * API: /api/irs/verify-ein
 *
 * Look up an EIN against the IRS Exempt Organizations Business Master
 * File extract held in Postgres. Read-only, stateless. The verified
 * result is written back to Dynamics `account` rows by PowerAutomate;
 * this endpoint never touches Dynamics.
 *
 * Auth: shared secret in the `x-irs-verify-secret` request header,
 *   matching the `IRS_VERIFY_SECRET` env var. PowerAutomate sends this
 *   header from its connector configuration. The endpoint is allowlisted
 *   in `proxy.js` so it does not require an NextAuth session JWT.
 *
 * Request:
 *   GET /api/irs/verify-ein?ein=XX-XXXXXXX
 *   Headers:
 *     x-irs-verify-secret: <shared secret>
 *
 * 200 OK (found):
 *   {
 *     "ein": "123456789",
 *     "found": true,
 *     "name": "Example University",
 *     "subsection": "03",
 *     "subsectionDescription": "Charitable / Educational / Religious / Scientific (501(c)(3))",
 *     "status": "01",
 *     "statusDescription": "Unconditional Exemption",
 *     "deductibility": "1",
 *     "deductibilityDescription": "Contributions are deductible",
 *     "foundation": "15",
 *     "rulingDate": "198501",
 *     "state": "MA",
 *     "is501c3PublicCharity": true,
 *     "asOfRefreshDate": "2026-05-12"
 *   }
 *
 * 200 OK (not found): { "ein": "123456789", "found": false }
 * 400: missing/malformed EIN
 * 401: missing/invalid shared secret
 *
 * The `is501c3PublicCharity` derived flag is true when subsection='03'
 * AND status IN ('01','02'). Callers (PA) make policy decisions from
 * the full payload; they should not depend on the derived flag alone
 * for edge cases (e.g., status='12' 4947(a)(2) trusts).
 *
 * See:
 *   lib/services/irs-bmf-service.js
 *   docs/atlas/postgres-irs-exempt-orgs.md
 */

import { timingSafeEqual } from 'crypto';
import { verifyEin } from '../../../lib/services/irs-bmf-service';

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // timingSafeEqual requires equal-length buffers; pad to longest so
  // mismatched lengths don't short-circuit and leak length via timing.
  const len = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  return timingSafeEqual(aPad, bPad) && aBuf.length === bBuf.length;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Shared-secret auth. Dev mode bypasses for local testing — matches
  // the convention used by the cron auth helper. Production uses
  // constant-time comparison so a timing oracle can't peel the secret
  // byte-by-byte (defense in depth — high-entropy secret + HTTPS, but
  // the fix is two lines and removes a known footgun).
  const expected = process.env.IRS_VERIFY_SECRET;
  if (process.env.NODE_ENV !== 'development') {
    if (!expected) {
      console.error('IRS_VERIFY_SECRET not configured in production');
      return res.status(500).json({ error: 'Verify secret not configured' });
    }
    const provided = req.headers['x-irs-verify-secret'];
    if (!provided || !constantTimeEqual(provided, expected)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const { ein } = req.query;
  if (!ein || typeof ein !== 'string') {
    return res.status(400).json({ error: 'ein query parameter is required' });
  }

  try {
    const result = await verifyEin(ein);
    if (result.error === 'invalid_ein') {
      return res.status(400).json({ error: result.message });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('verify-ein error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
