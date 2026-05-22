/**
 * Rate limiting for the public external-reviewer token routes
 * (`/api/external/review/[token]/*`). Security audit A6.
 *
 * Two bucket scopes, both required to pass:
 *   - per-token: tighter — one magic link should not be hammered
 *   - per-IP:    looser  — tolerates several reviewers behind shared NAT
 *
 * Backed by Postgres (`external_rate_limit`), not in-memory: Vercel Fluid
 * Compute spreads requests across instances, so per-instance memory buckets
 * never enforce a real shared limit. Fixed 60s windows; atomic
 * `INSERT ... ON CONFLICT DO UPDATE` counters (race-free, no SELECT-then-UPDATE).
 *
 * Fail-open by design: a Postgres error here must not lock legitimate
 * reviewers out during the pilot. On any infra error the request is allowed.
 *
 * Usage in a handler (after the method check, before token verification):
 *
 *   const rl = await checkRateLimit(req, token);
 *   if (!rl.ok) {
 *     res.setHeader('Retry-After', String(rl.retryAfterSeconds));
 *     return res.status(429).json({ ok: false, reason: 'rate_limited' });
 *   }
 *   const verified = await verifySuggestionToken(token);
 *   await recordTokenOutcome(req, token, verified.ok);
 */

import { createHash } from 'crypto';
import { sql } from '@vercel/postgres';
import AlertService from '../services/alert-service';

const WINDOW_MS = 60 * 1000;          // fixed-window size
const TOKEN_LIMIT = 30;               // max requests per token per window
const IP_LIMIT = 120;                 // max requests per IP per window
const INVALID_ALERT_THRESHOLD = 20;   // invalid-token verifications per IP per window
const PRUNE_PROBABILITY = 0.02;       // opportunistic cleanup of expired windows
const ALERT_DEDUP_KEY = 'external-rate-limit-invalid-spike';

/**
 * Extract the client IP. On Vercel the edge appends the real client as the
 * left-most `x-forwarded-for` entry. Falls back to `x-real-ip` then the raw
 * socket address; a constant sentinel keeps the bucket functional if none
 * resolve (better a coarse bucket than no rate limiting).
 */
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  return req.socket?.remoteAddress || 'unknown';
}

/** Start of the current fixed window, as an ISO string (TIMESTAMPTZ-safe). */
function currentWindowStartMs() {
  return Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
}

function tokenKey(token) {
  // Bucket key only — a SHA-256 hex digest, never the raw JWT. (Deliberately
  // not importing `hashToken` from external-token.js: that module pulls in
  // `jose`, an ESM-only package that breaks jsdom-env test transforms for
  // every route that touches this helper.)
  if (typeof token !== 'string' || !token) return 'tok:none';
  return `tok:${createHash('sha256').update(token).digest('hex')}`;
}

async function maybePrune(cutoffIso) {
  if (Math.random() >= PRUNE_PROBABILITY) return;
  try {
    await sql`DELETE FROM external_rate_limit WHERE window_start < ${cutoffIso}`;
  } catch {
    /* opportunistic — ignore */
  }
}

/**
 * Increments the per-token and per-IP counters for this request and reports
 * whether either bucket is now over its limit.
 *
 * @returns {Promise<{ok:true} | {ok:false, retryAfterSeconds:number}>}
 */
export async function checkRateLimit(req, token) {
  const windowStartMs = currentWindowStartMs();
  const windowStartIso = new Date(windowStartMs).toISOString();
  const tokKey = tokenKey(token);
  const ipKey = `ip:${clientIp(req)}`;

  try {
    // One round trip: upsert both buckets, return both hit counts.
    const { rows } = await sql`
      INSERT INTO external_rate_limit (bucket_key, window_start, hit_count)
      VALUES (${tokKey}, ${windowStartIso}, 1), (${ipKey}, ${windowStartIso}, 1)
      ON CONFLICT (bucket_key, window_start)
      DO UPDATE SET hit_count = external_rate_limit.hit_count + 1
      RETURNING bucket_key, hit_count
    `;

    let tokHits = 0;
    let ipHits = 0;
    for (const r of rows) {
      if (r.bucket_key === tokKey) tokHits = r.hit_count;
      else if (r.bucket_key === ipKey) ipHits = r.hit_count;
    }

    await maybePrune(new Date(windowStartMs - 2 * WINDOW_MS).toISOString());

    if (tokHits > TOKEN_LIMIT || ipHits > IP_LIMIT) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStartMs + WINDOW_MS - Date.now()) / 1000),
      );
      return { ok: false, retryAfterSeconds };
    }
    return { ok: true };
  } catch (err) {
    // Fail open — never lock out a legitimate reviewer on an infra fault.
    console.error('[external rate-limit] checkRateLimit error:', err.message);
    return { ok: true };
  }
}

/**
 * Records the outcome of token verification. A valid token is a no-op (the
 * request was already counted by checkRateLimit). An invalid token increments
 * the per-IP `invalid_count`; crossing the per-window threshold raises a
 * deduplicated CRITICAL-adjacent `system_alerts` entry.
 *
 * Best-effort and never throws — an alerting failure must not break the
 * handler's own error response.
 */
export async function recordTokenOutcome(req, token, valid) {
  if (valid) return;

  const windowStartMs = currentWindowStartMs();
  const windowStartIso = new Date(windowStartMs).toISOString();
  const ip = clientIp(req);
  const ipKey = `ip:${ip}`;

  let invalidCount = 0;
  try {
    const { rows } = await sql`
      INSERT INTO external_rate_limit (bucket_key, window_start, invalid_count)
      VALUES (${ipKey}, ${windowStartIso}, 1)
      ON CONFLICT (bucket_key, window_start)
      DO UPDATE SET invalid_count = external_rate_limit.invalid_count + 1
      RETURNING invalid_count
    `;
    invalidCount = rows[0]?.invalid_count ?? 0;
  } catch (err) {
    console.error('[external rate-limit] recordTokenOutcome error:', err.message);
    return;
  }

  if (invalidCount !== INVALID_ALERT_THRESHOLD) return;

  // Threshold crossed exactly once per window (== not >=) so a sustained
  // attack does not re-fire on every subsequent request; autoResolveKey
  // dedups across windows until an admin clears the alert.
  try {
    console.error(JSON.stringify({
      level: 'warn',
      event: 'external_rate_limit.invalid_token_spike',
      ip,
      invalidCount,
      windowStart: windowStartIso,
    }));
    await AlertService.createAlert({
      type: 'security',
      severity: 'warning',
      title: 'External-reviewer invalid-token spike',
      message:
        `${invalidCount}+ invalid external-reviewer token attempts from a single ` +
        `IP within one minute. Possible token-guessing or scanning activity ` +
        `against /api/external/review/[token]/*.`,
      metadata: { ip, invalidCount, windowStart: windowStartIso },
      source: 'external-rate-limit',
      autoResolveKey: ALERT_DEDUP_KEY,
    });
  } catch (err) {
    console.error('[external rate-limit] alert raise failed:', err.message);
  }
}
