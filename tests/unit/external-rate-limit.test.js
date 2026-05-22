/**
 * Tests for external-reviewer rate limiting (security audit A6).
 *
 * Covers the per-token / per-IP fixed-window counters, the invalid-token
 * spike alert, IP extraction, and the fail-open contract.
 *
 * @jest-environment node
 */

// Mock the DB and alert layers. Inline `jest.fn()` factories (the repo
// pattern — see execute-prompt-payload-boundary.test.js); uses the global
// `jest` (not an `@jest/globals` import) so the `jest.mock` calls hoist
// above the imports. The mocked bindings are imported below and driven
// per-test.
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/alert-service', () => ({ createAlert: jest.fn() }));

import { createHash } from 'crypto';
import { sql } from '@vercel/postgres';
import AlertService from '../../lib/services/alert-service';
import {
  checkRateLimit,
  recordTokenOutcome,
  clientIp,
} from '../../lib/external/rate-limit.js';

const TOKEN = 'reviewer-magic-link-jwt-value';
// Mirrors the helper's bucket-key derivation (sha256 hex of the token).
const tokKey = `tok:${createHash('sha256').update(TOKEN).digest('hex')}`;

function reqWith(ip) {
  return { headers: ip ? { 'x-forwarded-for': ip } : {}, socket: {} };
}

let randomSpy;

beforeEach(() => {
  // Suppress opportunistic pruning so `sql` call counts are deterministic.
  randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  sql.mockReset();
  AlertService.createAlert.mockReset();
});

afterEach(() => {
  randomSpy.mockRestore();
});

describe('clientIp', () => {
  it('takes the left-most x-forwarded-for entry', () => {
    expect(clientIp(reqWith('9.9.9.9, 10.0.0.1, 10.0.0.2'))).toBe('9.9.9.9');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp({ headers: { 'x-real-ip': '5.5.5.5' }, socket: {} })).toBe('5.5.5.5');
  });

  it('falls back to the socket address', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '7.7.7.7' } })).toBe('7.7.7.7');
  });

  it('uses a sentinel when nothing resolves', () => {
    expect(clientIp({ headers: {}, socket: {} })).toBe('unknown');
  });
});

describe('checkRateLimit', () => {
  it('allows a request under both limits', async () => {
    sql.mockResolvedValueOnce({
      rows: [
        { bucket_key: tokKey, hit_count: 3 },
        { bucket_key: 'ip:1.2.3.4', hit_count: 8 },
      ],
    });
    const res = await checkRateLimit(reqWith('1.2.3.4'), TOKEN);
    expect(res).toEqual({ ok: true });
  });

  it('blocks when the per-token bucket is exceeded', async () => {
    sql.mockResolvedValueOnce({
      rows: [
        { bucket_key: tokKey, hit_count: 31 },       // over TOKEN_LIMIT (30)
        { bucket_key: 'ip:1.2.3.4', hit_count: 5 },  // IP fine
      ],
    });
    const res = await checkRateLimit(reqWith('1.2.3.4'), TOKEN);
    expect(res.ok).toBe(false);
    expect(res.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('blocks when the per-IP bucket is exceeded independently of the token', async () => {
    sql.mockResolvedValueOnce({
      rows: [
        { bucket_key: tokKey, hit_count: 2 },          // token fine
        { bucket_key: 'ip:1.2.3.4', hit_count: 121 },  // over IP_LIMIT (120)
      ],
    });
    const res = await checkRateLimit(reqWith('1.2.3.4'), TOKEN);
    expect(res.ok).toBe(false);
  });

  it('fails open when Postgres errors (never locks out reviewers)', async () => {
    sql.mockRejectedValueOnce(new Error('connection refused'));
    const res = await checkRateLimit(reqWith('1.2.3.4'), TOKEN);
    expect(res).toEqual({ ok: true });
  });
});

describe('recordTokenOutcome', () => {
  it('is a no-op for a valid token (no DB write, no alert)', async () => {
    await recordTokenOutcome(reqWith('1.2.3.4'), TOKEN, true);
    expect(sql).not.toHaveBeenCalled();
    expect(AlertService.createAlert).not.toHaveBeenCalled();
  });

  it('increments invalid_count for an invalid token without alerting below threshold', async () => {
    sql.mockResolvedValueOnce({ rows: [{ invalid_count: 19 }] });
    await recordTokenOutcome(reqWith('1.2.3.4'), TOKEN, false);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(AlertService.createAlert).not.toHaveBeenCalled();
  });

  it('raises a deduplicated alert when the invalid-token threshold is crossed', async () => {
    sql.mockResolvedValueOnce({ rows: [{ invalid_count: 20 }] });
    await recordTokenOutcome(reqWith('1.2.3.4'), TOKEN, false);
    expect(AlertService.createAlert).toHaveBeenCalledTimes(1);
    const arg = AlertService.createAlert.mock.calls[0][0];
    expect(arg.autoResolveKey).toBe('external-rate-limit-invalid-spike');
    expect(arg.metadata.ip).toBe('1.2.3.4');
  });

  it('does not re-alert past the threshold (fires only on the exact crossing)', async () => {
    sql.mockResolvedValueOnce({ rows: [{ invalid_count: 25 }] });
    await recordTokenOutcome(reqWith('1.2.3.4'), TOKEN, false);
    expect(AlertService.createAlert).not.toHaveBeenCalled();
  });

  it('does not throw when alerting fails', async () => {
    sql.mockResolvedValueOnce({ rows: [{ invalid_count: 20 }] });
    AlertService.createAlert.mockRejectedValueOnce(new Error('alert store down'));
    await expect(
      recordTokenOutcome(reqWith('1.2.3.4'), TOKEN, false),
    ).resolves.toBeUndefined();
  });

  it('does not throw when the DB write fails', async () => {
    sql.mockRejectedValueOnce(new Error('connection refused'));
    await expect(
      recordTokenOutcome(reqWith('1.2.3.4'), TOKEN, false),
    ).resolves.toBeUndefined();
  });
});
