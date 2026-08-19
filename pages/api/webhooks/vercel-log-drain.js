/**
 * POST /api/webhooks/vercel-log-drain
 *
 * Authenticated ingestion endpoint for a Vercel Log Drain (custom HTTP
 * endpoint, JSON or NDJSON encoding, compression "none"). Selected entries
 * are retained as `operational_events` rows so runtime failures stay
 * diagnosable after Vercel's log-retention window.
 *
 * Auth (fail closed):
 *   * `VERCEL_LOG_DRAIN_SECRET` unset outside development → 500, nothing read.
 *   * Every request must carry `x-vercel-signature` = HMAC-SHA1 hex of the raw
 *     body keyed with that secret (per https://vercel.com/docs/drains/security,
 *     verified 2026-08-19). Constant-time comparison; mismatch → 403.
 *   * Dev with no secret configured skips verification (mirrors
 *     pages/api/webhooks/bill.js).
 *
 * Robustness under Vercel's at-least-once delivery:
 *   * Per-entry dedup on Vercel's stable log id (`vercel:<id>` unique key).
 *   * Body capped at 4 MB (413 above), batch selection/storage caps live in
 *     lib/services/vercel-log-drain-ingest.js; dropped counts are returned
 *     and logged, never silent.
 *   * Parse problems (malformed/skipped/invalid entries) return 200 with
 *     counters — redelivering unparseable data cannot help. Storage FAILURES
 *     return 503 so Vercel redelivers: per-entry dedup makes the retry safe,
 *     and a sustained Postgres outage correctly surfaces as an errored drain
 *     instead of silently dropping the outage's own evidence.
 *   * `content-encoding` other than identity → 415 (configure the drain with
 *     compression "none"); the drain-creation test delivery gets a 200.
 *
 * This route never calls NotificationService (no recursive alert loops) and
 * persists only redacted, allowlisted fields — see the ingest service header.
 */

import crypto from 'crypto';
import {
  parseDrainBody,
  ingestDrainEntries,
} from '../../../lib/services/vercel-log-drain-ingest';

// Raw body required for HMAC verification — disable Next.js body parsing.
export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MB cap per delivery (defensive)

/**
 * Constant-time HMAC-SHA1 verification of a drain delivery. Exported-by-name
 * contract: this identifier is registered in HMAC_GUARDS in
 * scripts/check-api-route-security-matrix.js.
 */
export function verifyVercelLogDrainSignature(rawBody, signature, secret) {
  if (typeof signature !== 'string' || !signature || !secret) return false;
  const expected = crypto.createHmac('sha1', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export default async function handler(req, res) {
  // Legacy endpoint-verification compatibility: if a verification token is
  // configured, echo it on every response. The current Drains flow tests the
  // endpoint with a signed delivery instead, so this is optional.
  if (process.env.VERCEL_LOG_DRAIN_VERIFY) {
    res.setHeader('x-vercel-verify', process.env.VERCEL_LOG_DRAIN_VERIFY);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Fail closed when the secret isn't configured in non-dev environments.
  const secret = process.env.VERCEL_LOG_DRAIN_SECRET;
  if (process.env.NODE_ENV !== 'development' && !secret) {
    console.error('[vercel-log-drain] VERCEL_LOG_DRAIN_SECRET not configured');
    return res.status(500).json({ error: 'Drain secret not configured' });
  }

  const encoding = String(req.headers['content-encoding'] || '').trim().toLowerCase();
  if (encoding && encoding !== 'identity') {
    // Configure the drain with compression "none"; the signature covers the
    // raw body and we deliberately do not decompress.
    return res.status(415).json({ error: `Unsupported content-encoding: ${encoding}` });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req, MAX_BODY_BYTES);
  } catch (err) {
    const message = err?.message || String(err);
    if (message.includes('body too large')) {
      console.warn('[vercel-log-drain] delivery over size cap rejected');
      return res.status(413).json({ error: 'Payload too large' });
    }
    console.warn('[vercel-log-drain] body read failed:', message);
    return res.status(400).json({ error: 'Could not read request body' });
  }

  // Verify signature. In dev with no secret, skip verification (mirrors the
  // BILL webhook pattern).
  if (process.env.NODE_ENV !== 'development' || secret) {
    const signature = req.headers['x-vercel-signature'];
    if (!verifyVercelLogDrainSignature(rawBody, signature, secret)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }
  }

  // Empty body: the drain-creation test may send one — acknowledge it.
  if (!rawBody || rawBody.length === 0) {
    return res.status(200).json({ ok: true, received: 0, stored: 0 });
  }

  const { entries, malformed } = parseDrainBody(rawBody.toString('utf8'));
  const counts = await ingestDrainEntries(entries);

  // Storage failures must NOT be acknowledged: a 200 here would stop Vercel's
  // at-least-once redelivery and permanently drop the very failure evidence a
  // Postgres outage produces (Codex adversarial finding, cycle 3). The
  // per-entry dedup makes redelivery of the already-stored remainder safe;
  // sustained 503s surface on Vercel's Drains page as an errored drain, which
  // is the correct loud signal for a storage outage.
  const status = counts.storageFailures > 0 ? 503 : 200;
  return res.status(status).json({
    ok: counts.storageFailures === 0,
    received: entries.length,
    malformed,
    stored: counts.stored,
    duplicates: counts.duplicates,
    skipped: counts.skipped,
    invalid: counts.invalid,
    droppedByCap: counts.droppedByCap,
    storageFailures: counts.storageFailures,
  });
}

/**
 * Read the raw request body up to `maxBytes` (same defensive shape as
 * pages/api/webhooks/bill.js — listener cleanup + close/aborted handling).
 */
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
      req.off('aborted', onAborted);
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    const onData = chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        try { req.destroy(); } catch { /* noop */ }
        settle(reject, new Error(`body too large (>${maxBytes} bytes)`));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => settle(resolve, Buffer.concat(chunks));
    const onError = err => settle(reject, err);
    const onClose = () => settle(reject, new Error('client disconnected before body completed'));
    const onAborted = () => settle(reject, new Error('client aborted before body completed'));

    try {
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
      req.on('close', onClose);
      req.on('aborted', onAborted);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}
