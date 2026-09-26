/** @jest-environment node */
import {
  checkPresentationContextRateLimit,
  checkPresentationMediaRateLimit,
} from '../../lib/external/presentation-media-rate-limit.js';

const req = { headers: { 'x-forwarded-for': '203.0.113.8' }, socket: {} };

function queryWithCounts(tokenHits, ipHits) {
  return async (strings, ...values) => ({
    rows: [
      { bucket_key: values[0], hit_count: tokenHits },
      { bucket_key: values[2], hit_count: ipHits },
    ],
  });
}

test('presentation resolver limiter permits bounded traffic and never stores the raw token bucket key', async () => {
  const result = await checkPresentationMediaRateLimit(req, 'raw-secret-token', {
    query: queryWithCounts(1, 1),
    now: () => 10_000,
  });
  expect(result).toEqual({ ok: true });
});

test('presentation resolver limiter enforces token/IP limits and fails closed on Postgres error', async () => {
  await expect(checkPresentationMediaRateLimit(req, 'token', {
    query: queryWithCounts(21, 1),
    now: () => 10_000,
  })).resolves.toMatchObject({ ok: false, reason: 'rate_limited' });
  await expect(checkPresentationMediaRateLimit(req, 'token', {
    query: async () => { throw new Error('postgres down'); },
    now: () => 10_000,
  })).resolves.toEqual({ ok: false, reason: 'rate_limit_unavailable', retryAfterSeconds: 5 });
});

test('page context uses a separate fail-closed bucket and budget from media actions', async () => {
  const seen = [];
  const query = async (strings, ...values) => {
    seen.push(values);
    return {
      rows: [
        { bucket_key: values[0], hit_count: 21 },
        { bucket_key: values[2], hit_count: 1 },
      ],
    };
  };
  await expect(checkPresentationContextRateLimit(req, 'token', {
    query,
    now: () => 10_000,
  })).resolves.toEqual({ ok: true });
  expect(seen[0][0]).toMatch(/^presentation-context-tok:/);
  expect(seen[0][2]).toMatch(/^presentation-context-ip:/);
  await expect(checkPresentationContextRateLimit(req, 'token', {
    query: async () => { throw new Error('postgres down'); },
    now: () => 10_000,
  })).resolves.toEqual({ ok: false, reason: 'rate_limit_unavailable', retryAfterSeconds: 5 });
});
