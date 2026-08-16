/**
 * Cron Authentication Utility
 *
 * Verifies that cron endpoint requests carry a valid Bearer token
 * matching the CRON_SECRET environment variable. In dev mode, auth
 * is bypassed to allow local testing via curl.
 *
 * Usage:
 *   const { verifyCronSecret } = require('../../lib/utils/cron-auth');
 *   const ok = verifyCronSecret(req, res);
 *   if (!ok) return;
 */

const crypto = require('crypto');

/**
 * Compare two strings without an early-exit content comparison. Buffers are
 * padded to the same length so timingSafeEqual also runs for wrong-length
 * inputs; the original lengths are checked only after that comparison.
 */
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  const len = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  return crypto.timingSafeEqual(aPad, bPad) && aBuf.length === bBuf.length;
}

/**
 * Verify that the request carries a valid cron secret.
 * Sends an error response and returns false if invalid.
 *
 * @param {Object} req - Next.js API request
 * @param {Object} res - Next.js API response
 * @returns {boolean} true if authorized
 */
function verifyCronSecret(req, res) {
  // Dev mode bypass — no secret required locally
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET not configured in production');
    res.status(500).json({ error: 'Cron secret not configured' });
    return false;
  }

  const authHeader = req.headers.authorization;
  if (!constantTimeEqual(authHeader, `Bearer ${secret}`)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
}

module.exports = { constantTimeEqual, verifyCronSecret };
