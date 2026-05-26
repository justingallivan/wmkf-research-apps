/**
 * POST /api/webhooks/bill
 *
 * BILL.com webhook scaffold (slice 1).
 *
 * Responsibilities in this slice:
 *   - Verify HMAC-SHA256 signature (`x-bill-sha-signature`) against
 *     `BILL_WEBHOOK_SECRET` using a constant-time comparison.
 *   - Dedup deliveries by `(subscription_id, event_id)` to defeat BILL's
 *     retry-replay (no replay protection documented on BILL's side).
 *   - Structured log of every received event so we can observe real
 *     payload shapes during sandbox setup before designing the
 *     event-type dispatch in the next slice.
 *   - Return 200 OK (so BILL doesn't auto-disable the subscription).
 *
 * NOT in this slice (deferred until sandbox reveals the actual
 * `vendor.updated` payload shape):
 *   - Event-type dispatch
 *   - Dataverse PATCH (`wmkf_exisitngbillcomaccount` → "Recently Confirmed")
 *
 * Auth and method failure modes mirror pages/api/irs/verify-ein.js.
 *
 * See docs/BILL_LIB_DESIGN.md (v3).
 */

import { verifyBillWebhook } from '../../../lib/bill';
import { redactString } from '../../../lib/bill/redact';
import { sql } from '@vercel/postgres';

// Raw body required for HMAC verification — disable Next.js body parsing.
export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BODY_BYTES = 256 * 1024; // 256 KB cap on webhook payload (defensive)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Fail closed when the secret isn't configured in non-dev environments.
  const secret = process.env.BILL_WEBHOOK_SECRET;
  if (process.env.NODE_ENV !== 'development') {
    if (!secret) {
      console.error('[bill-webhook] BILL_WEBHOOK_SECRET not configured in production');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }
  }

  // Read raw body.
  let rawBody;
  try {
    rawBody = await readRawBody(req, MAX_BODY_BYTES);
  } catch (err) {
    console.warn('[bill-webhook] body read failed:', err?.message || String(err));
    return res.status(400).json({ error: 'Could not read request body' });
  }
  if (!rawBody || rawBody.length === 0) {
    return res.status(400).json({ error: 'Empty request body' });
  }

  // Verify signature. In dev with no secret, skip verification (mirrors IRS pattern).
  if (process.env.NODE_ENV !== 'development' || secret) {
    const signature = req.headers['x-bill-sha-signature'];
    if (typeof signature !== 'string' || !verifyBillWebhook(rawBody, signature, secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // Parse payload.
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Extract dedup correlators. Path inside payload is unconfirmed — sandbox
  // observation will pin it. For now, accept either `eventId` or `metadata.eventId`,
  // and `subscriptionId` or `metadata.subscriptionId`. MUST be non-empty strings —
  // anything else (object, array, number) would yield a malformed dedup key.
  const eventIdRaw = payload?.eventId ?? payload?.metadata?.eventId ?? null;
  const subscriptionIdRaw = payload?.subscriptionId ?? payload?.metadata?.subscriptionId ?? null;
  const eventId = typeof eventIdRaw === 'string' && eventIdRaw.length > 0 ? eventIdRaw : null;
  const subscriptionId = typeof subscriptionIdRaw === 'string' && subscriptionIdRaw.length > 0 ? subscriptionIdRaw : null;

  if (!eventId || !subscriptionId) {
    // Don't 4xx — BILL would retry forever. Log + 200 so the subscription
    // stays healthy while we figure out the real payload shape.
    console.warn('[bill-webhook] missing or non-string eventId/subscriptionId in payload', {
      hasEventId: !!eventId,
      hasSubscriptionId: !!subscriptionId,
      payloadKeys: Object.keys(payload || {}).slice(0, 20),
    });
    return res.status(200).json({ received: true, deduped: false, reason: 'missing_correlators' });
  }

  // Atomic dedup gate: INSERT ON CONFLICT DO NOTHING; if no row returned, this
  // is a duplicate delivery. Compound key (subscription_id, event_id) defends
  // against eventId-uniqueness scope not being guaranteed across subscriptions.
  let inserted;
  try {
    const result = await sql`
      INSERT INTO bill_webhook_events (subscription_id, event_id)
      VALUES (${subscriptionId}, ${eventId})
      ON CONFLICT (subscription_id, event_id) DO NOTHING
      RETURNING id
    `;
    inserted = result.rows.length > 0;
  } catch (err) {
    // Don't 4xx/5xx — would cause BILL retry storms. Log + 200 so the
    // subscription stays healthy; investigate via logs.
    console.error('[bill-webhook] dedup insert failed:', err?.message || String(err));
    return res.status(200).json({ received: true, deduped: 'unknown' });
  }

  if (!inserted) {
    // Duplicate delivery — already processed.
    return res.status(200).json({ received: true, deduped: true });
  }

  // Structured log of first delivery. We log keys + event type only — NOT the
  // payload body — because BILL webhooks carry vendor PII (name, email, address)
  // and we don't want that in production logs. To inspect raw payloads during
  // sandbox, set BILL_WEBHOOK_DEBUG=true (gated server-side env-var, redacted via
  // the BILL secret redactor; PII like names/emails still passes through, so use
  // ONLY in sandbox).
  const eventType = payload?.eventType ?? payload?.type ?? payload?.metadata?.eventType ?? 'unknown';
  const logEntry = {
    subscriptionId,
    eventId,
    eventType,
    payloadKeys: Object.keys(payload || {}),
  };
  if (process.env.BILL_WEBHOOK_DEBUG === 'true') {
    logEntry.payloadSample = redactString(JSON.stringify(payload)).slice(0, 1000);
  }
  console.log('[bill-webhook] event received', logEntry);

  return res.status(200).json({ received: true, deduped: false, eventType });
}

/**
 * Read the raw request body up to `maxBytes`. Rejects if the body exceeds
 * the cap (defends against memory pressure from a misbehaving sender).
 *
 * Cleans up listeners on resolve/reject and handles 'close'/'aborted' so a
 * client disconnect doesn't leak a pending promise.
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

    // Defensive: if req.on() throws partway through registration (e.g., the
    // stream has been destroyed underneath us), remove any listeners we
    // already attached so we don't leak. Cleanup is idempotent.
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
