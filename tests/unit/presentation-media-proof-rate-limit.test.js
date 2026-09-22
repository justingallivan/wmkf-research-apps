/** @jest-environment node */

import { checkPresentationMediaProofRateLimit } from '../../lib/external/presentation-media-proof-rate-limit';

const req = { headers: { 'x-forwarded-for': '203.0.113.8' }, socket: {} };

test('uses separate hashed-token and IP buckets without storing the bearer token', async () => {
  const query = jest.fn(async (_strings, ...values) => ({
    rows: [
      { bucket_key: values[0], hit_count: 1 },
      { bucket_key: values[2], hit_count: 1 },
    ],
  }));
  await expect(checkPresentationMediaProofRateLimit(req, 'secret.jwt.value', { query, now: () => 10_000 }))
    .resolves.toEqual({ ok: true });
  const values = query.mock.calls[0].slice(1);
  expect(values[0]).toMatch(/^proof-tok:[a-f0-9]{64}$/);
  expect(values[0]).not.toContain('secret.jwt.value');
  expect(values[2]).toBe('proof-ip:203.0.113.8');
});

test('rate limits either bucket and fails closed when the counter store fails', async () => {
  const limitedQuery = jest.fn(async (_strings, ...values) => ({
    rows: [
      { bucket_key: values[0], hit_count: 21 },
      { bucket_key: values[2], hit_count: 1 },
    ],
  }));
  await expect(checkPresentationMediaProofRateLimit(req, 'token', { query: limitedQuery, now: () => 10_000 }))
    .resolves.toMatchObject({ ok: false, reason: 'rate_limited' });

  const failingQuery = jest.fn(async () => { throw new Error('database offline'); });
  await expect(checkPresentationMediaProofRateLimit(req, 'token', { query: failingQuery, now: () => 10_000 }))
    .resolves.toEqual({ ok: false, reason: 'rate_limit_unavailable', retryAfterSeconds: 5 });
});
