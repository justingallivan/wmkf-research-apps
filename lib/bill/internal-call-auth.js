/**
 * Internal-call HMAC auth for /api/bill/onboard-reviewer.
 *
 * Same-deployment server-to-server caller (respond.js → /api/bill/onboard-reviewer).
 * The reviewer-side respond.js endpoint is HMAC-token-authenticated; no staff
 * session exists. Bearer-secret auth (cron-auth.js shape) leaks the secret
 * over any header-capturing tracing layer, so we sign the body instead.
 *
 * Signing string (v1):
 *   v1:${timestamp}:${nonce}:${rawBodyBytes}
 *
 * Headers:
 *   x-bill-timestamp     Unix seconds (string)
 *   x-bill-nonce         UUID per call
 *   x-bill-internal-sig  base64 HMAC-SHA256
 *
 * Defenses:
 *   - Constant-time compare via crypto.timingSafeEqual (pad-to-longest)
 *   - ±300s skew window (no nonce store — Vercel instances don't share memory
 *     reliably; the skew window is the actual replay defense)
 *
 * See docs/BILL_CHUNK_6_ENDPOINT_DESIGN.md "Auth" section.
 */

import crypto from 'crypto';

const SKEW_SECONDS = 300;
const SIG_VERSION = 'v1';

/**
 * Compute the canonical signing payload and HMAC. Exported so the caller
 * (respond.js, future chunk 4) can produce a matching signature.
 *
 * @param {Object} opts
 * @param {string|Buffer} opts.rawBody — raw bytes the endpoint will hash
 * @param {number} opts.timestamp — Unix seconds
 * @param {string} opts.nonce — UUID
 * @param {string} opts.secret — BILL_INTEGRATION_SECRET
 * @returns {string} base64 HMAC-SHA256
 */
export function signInternalCall({ rawBody, timestamp, nonce, secret }) {
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const payload = `${SIG_VERSION}:${timestamp}:${nonce}:${bodyStr}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('base64');
}

/**
 * Verify a signed internal call.
 *
 * @param {Object} opts
 * @param {string|Buffer} opts.rawBody
 * @param {Object} opts.headers — req.headers
 * @param {string} opts.secret — BILL_INTEGRATION_SECRET
 * @param {number} [opts.nowSeconds] — injectable for tests
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyInternalCall({ rawBody, headers, secret, nowSeconds }) {
  if (typeof secret !== 'string' || secret.length === 0) {
    return { ok: false, reason: 'secret_missing' };
  }
  if (!headers || typeof headers !== 'object') {
    return { ok: false, reason: 'headers_missing' };
  }

  const timestampHeader = headers['x-bill-timestamp'];
  const nonceHeader = headers['x-bill-nonce'];
  const sigHeader = headers['x-bill-internal-sig'];

  if (typeof timestampHeader !== 'string' || timestampHeader.length === 0) {
    return { ok: false, reason: 'timestamp_header_missing' };
  }
  if (typeof nonceHeader !== 'string' || nonceHeader.length === 0) {
    return { ok: false, reason: 'nonce_header_missing' };
  }
  if (typeof sigHeader !== 'string' || sigHeader.length === 0) {
    return { ok: false, reason: 'sig_header_missing' };
  }

  const timestamp = parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'timestamp_not_numeric' };
  }
  const now = typeof nowSeconds === 'number' ? nowSeconds : Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > SKEW_SECONDS) {
    return { ok: false, reason: 'timestamp_skew' };
  }

  const expected = signInternalCall({ rawBody, timestamp, nonce: nonceHeader, secret });
  if (!constantTimeEqual(expected, sigHeader)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}

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
