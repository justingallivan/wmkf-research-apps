/** Dedicated fail-closed limiter for one-shot presentation media resolution. */
import { createHash } from 'node:crypto';
import { sql } from '@vercel/postgres';
import { clientIp } from './rate-limit.js';

const WINDOW_MS = 60_000;
const TOKEN_LIMIT = 20;
const IP_LIMIT = 60;

export async function checkPresentationMediaRateLimit(req, token, dependencies = {}) {
  const query = dependencies.query || sql;
  const now = dependencies.now ? dependencies.now() : Date.now();
  const windowStartMs = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const windowStartIso = new Date(windowStartMs).toISOString();
  const digest = createHash('sha256').update(String(token || '')).digest('hex');
  const tokenBucket = `presentation-media-tok:${digest}`;
  const ipBucket = `presentation-media-ip:${clientIp(req)}`;
  try {
    const { rows } = await query`
      INSERT INTO external_rate_limit (bucket_key, window_start, hit_count)
      VALUES (${tokenBucket}, ${windowStartIso}, 1), (${ipBucket}, ${windowStartIso}, 1)
      ON CONFLICT (bucket_key, window_start)
      DO UPDATE SET hit_count = external_rate_limit.hit_count + 1
      RETURNING bucket_key, hit_count
    `;
    const counts = new Map(rows.map((row) => [row.bucket_key, Number(row.hit_count)]));
    if ((counts.get(tokenBucket) || 0) > TOKEN_LIMIT || (counts.get(ipBucket) || 0) > IP_LIMIT) {
      return {
        ok: false,
        reason: 'rate_limited',
        retryAfterSeconds: Math.max(1, Math.ceil((windowStartMs + WINDOW_MS - now) / 1000)),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'rate_limit_unavailable', retryAfterSeconds: 5 };
  }
}
