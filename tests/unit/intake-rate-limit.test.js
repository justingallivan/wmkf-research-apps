/**
 * Tests for intake-portal rate limiting (S187 #4).
 *
 * Covers per-applicant-per-route / per-applicant-aggregate / per-IP fixed-
 * window counters, the draft-route IP-only bucket, fail-open + degraded-state
 * alert, Retry-After, and clientIp sentinel behavior. Mirrors
 * tests/unit/external-rate-limit.test.js shape.
 *
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/alert-service', () => ({ createAlert: jest.fn() }));

import { sql } from '@vercel/postgres';
import AlertService from '../../lib/services/alert-service';
import {
  checkIntakeRateLimit,
  clientIp,
  __resetLimiterHealthForTest,
} from '../../lib/intake/rate-limit.js';

const OID = 'contact-oid-uuid-fixture';

function reqWith(ip) {
  return { headers: ip ? { 'x-forwarded-for': ip } : {}, socket: {} };
}

let randomSpy;

beforeEach(() => {
  randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // suppress pruning
  sql.mockReset();
  AlertService.createAlert.mockReset();
  __resetLimiterHealthForTest();
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

  it('falls back to socket.remoteAddress', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '7.7.7.7' } })).toBe('7.7.7.7');
  });

  it('falls back to the "unknown" sentinel when nothing resolves', () => {
    expect(clientIp({ headers: {}, socket: {} })).toBe('unknown');
  });
});

describe('checkIntakeRateLimit — happy path under all limits', () => {
  it('returns ok=true and upserts all three buckets in one round-trip', async () => {
    sql.mockResolvedValueOnce({
      rows: [
        { bucket_key: `intake:oid:${OID}:upload-token`, hit_count: 1 },
        { bucket_key: `intake:oid:${OID}:all`,          hit_count: 1 },
        { bucket_key: 'intake:ip:9.9.9.9',              hit_count: 1 },
      ],
    });
    const rl = await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'upload-token');
    expect(rl).toEqual({ ok: true });
    expect(sql).toHaveBeenCalledTimes(1);
  });

  // Concurrency-safety invariant (Codex Q5): the multi-bucket upsert MUST be
  // a single tagged-template call with multi-row VALUES + ON CONFLICT on the
  // composite (bucket_key, window_start) PK. Anything else (sequential
  // upserts, separate INSERT/UPDATE statements) opens partial-enforcement
  // windows under concurrency. This assertion is intentionally brittle —
  // a refactor that breaks atomicity should fail this test, not silently ship.
  it('non-draft route emits a multi-row VALUES upsert with composite-PK ON CONFLICT', async () => {
    sql.mockResolvedValueOnce({
      rows: [
        { bucket_key: `intake:oid:${OID}:attach`, hit_count: 1 },
        { bucket_key: `intake:oid:${OID}:all`,    hit_count: 1 },
        { bucket_key: 'intake:ip:9.9.9.9',        hit_count: 1 },
      ],
    });
    await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'attach');
    expect(sql).toHaveBeenCalledTimes(1);
    // `@vercel/postgres` invokes the mock as `sql(strings, ...values)` where
    // `strings` is a TemplateStringsArray. Reconstruct the literal template
    // for shape assertions.
    const [stringsArr] = sql.mock.calls[0];
    const template = Array.isArray(stringsArr) ? stringsArr.join('?') : '';
    expect(template).toMatch(/INSERT INTO external_rate_limit/i);
    // Multi-row VALUES: three (?, ?, 1) triples.
    expect(template.match(/VALUES[\s\S]*?\(\?,\s*\?,\s*1\),[\s\S]*?\(\?,\s*\?,\s*1\),[\s\S]*?\(\?,\s*\?,\s*1\)/i)).not.toBeNull();
    expect(template).toMatch(/ON CONFLICT \(bucket_key,\s*window_start\)/i);
    expect(template).toMatch(/DO UPDATE SET hit_count = external_rate_limit\.hit_count \+ 1/i);
    expect(template).toMatch(/RETURNING bucket_key,\s*hit_count/i);
  });
});

describe('checkIntakeRateLimit — per-route exhaustion', () => {
  it('per-applicant cap exceeded → ok=false, scope=route, sane retryAfter', async () => {
    sql.mockResolvedValueOnce({
      rows: [
        { bucket_key: `intake:oid:${OID}:upload-token`, hit_count: 21 }, // > 20
        { bucket_key: `intake:oid:${OID}:all`,          hit_count: 21 },
        { bucket_key: 'intake:ip:9.9.9.9',              hit_count: 21 },
      ],
    });
    const rl = await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'upload-token');
    expect(rl.ok).toBe(false);
    expect(rl.scope).toBe('route');
    expect(rl.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(rl.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('submit cap is tighter (5) — exhausts at 6 hits', async () => {
    sql.mockResolvedValueOnce({
      rows: [
        { bucket_key: `intake:oid:${OID}:submit`, hit_count: 6 },
        { bucket_key: `intake:oid:${OID}:all`,    hit_count: 6 },
        { bucket_key: 'intake:ip:9.9.9.9',        hit_count: 6 },
      ],
    });
    const rl = await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'submit');
    expect(rl.ok).toBe(false);
    expect(rl.scope).toBe('route');
  });
});

describe('checkIntakeRateLimit — aggregate exhaustion (under per-route but over :all)', () => {
  it('per-route OK but aggregate exceeded → ok=false, scope=aggregate', async () => {
    sql.mockResolvedValueOnce({
      rows: [
        { bucket_key: `intake:oid:${OID}:upload-token`, hit_count: 15 }, // under 20
        { bucket_key: `intake:oid:${OID}:all`,          hit_count: 101 }, // > 100
        { bucket_key: 'intake:ip:9.9.9.9',              hit_count: 15 },
      ],
    });
    const rl = await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'upload-token');
    expect(rl.ok).toBe(false);
    expect(rl.scope).toBe('aggregate');
  });
});

describe('checkIntakeRateLimit — per-IP exhaustion', () => {
  it('per-applicant OK but per-IP exceeded → ok=false, scope=ip', async () => {
    sql.mockResolvedValueOnce({
      rows: [
        { bucket_key: `intake:oid:${OID}:attach`, hit_count: 5 },
        { bucket_key: `intake:oid:${OID}:all`,    hit_count: 50 },
        { bucket_key: 'intake:ip:9.9.9.9',        hit_count: 121 }, // > 120
      ],
    });
    const rl = await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'attach');
    expect(rl.ok).toBe(false);
    expect(rl.scope).toBe('ip');
  });
});

describe('checkIntakeRateLimit — draft route is IP-only on dedicated bucket', () => {
  it('upserts only the dedicated per-IP key (one row), no per-applicant rows', async () => {
    sql.mockResolvedValueOnce({
      rows: [{ bucket_key: 'intake:ip:9.9.9.9:draft', hit_count: 1 }],
    });
    const rl = await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'draft');
    expect(rl).toEqual({ ok: true });
    // Only the dedicated draft IP bucket — not the shared `intake:ip:9.9.9.9`.
    const sqlCall = sql.mock.calls[0];
    const params = sqlCall.slice(1).flat();
    expect(params).toContain('intake:ip:9.9.9.9:draft');
    expect(params).not.toContain('intake:ip:9.9.9.9');
    expect(params.some(p => typeof p === 'string' && p.startsWith(`intake:oid:${OID}`))).toBe(false);
  });

  it('draft cap exceeded → ok=false, scope=ip', async () => {
    sql.mockResolvedValueOnce({
      rows: [{ bucket_key: 'intake:ip:9.9.9.9:draft', hit_count: 121 }],
    });
    const rl = await checkIntakeRateLimit(reqWith('9.9.9.9'), null /* OID not required */, 'draft');
    expect(rl.ok).toBe(false);
    expect(rl.scope).toBe('ip');
  });
});

describe('checkIntakeRateLimit — fail-open + degraded-state alert', () => {
  it('PG throws → returns ok=true (fail open), increments failure counter', async () => {
    sql.mockRejectedValueOnce(new Error('connection terminated'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const rl = await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'attach');
      expect(rl).toEqual({ ok: true });
    } finally {
      errSpy.mockRestore();
    }
    expect(AlertService.createAlert).not.toHaveBeenCalled();
  });

  it('raises a deduplicated alert at the 5th consecutive failure', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (let i = 0; i < 5; i++) {
        sql.mockRejectedValueOnce(new Error(`fail ${i + 1}`));
        await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'attach');
      }
    } finally {
      errSpy.mockRestore();
    }
    expect(AlertService.createAlert).toHaveBeenCalledTimes(1);
    const arg = AlertService.createAlert.mock.calls[0][0];
    expect(arg.type).toBe('security');
    expect(arg.severity).toBe('warning');
    expect(arg.source).toBe('intake-rate-limit');
    expect(arg.autoResolveKey).toBe('intake-rate-limit-db-degraded');
    expect(arg.metadata.consecutiveFailures).toBe(5);
  });

  it('counter resets after a successful round-trip — alert does not re-fire prematurely', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // 4 failures (under threshold)
      for (let i = 0; i < 4; i++) {
        sql.mockRejectedValueOnce(new Error(`fail ${i + 1}`));
        await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'attach');
      }
      // 1 success → resets counter
      sql.mockResolvedValueOnce({ rows: [
        { bucket_key: `intake:oid:${OID}:attach`, hit_count: 1 },
        { bucket_key: `intake:oid:${OID}:all`,    hit_count: 1 },
        { bucket_key: 'intake:ip:9.9.9.9',        hit_count: 1 },
      ] });
      await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'attach');
      // 4 more failures (still under threshold post-reset)
      for (let i = 0; i < 4; i++) {
        sql.mockRejectedValueOnce(new Error(`fail ${i + 5}`));
        await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'attach');
      }
    } finally {
      errSpy.mockRestore();
    }
    expect(AlertService.createAlert).not.toHaveBeenCalled();
  });
});

describe('checkIntakeRateLimit — misuse', () => {
  it('unknown routeKey → fail-open, no SQL', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const rl = await checkIntakeRateLimit(reqWith('9.9.9.9'), OID, 'unknown-route');
      expect(rl).toEqual({ ok: true });
    } finally {
      errSpy.mockRestore();
    }
    expect(sql).not.toHaveBeenCalled();
  });

  it('non-draft route without contactOid → fail-open, no SQL', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const rl = await checkIntakeRateLimit(reqWith('9.9.9.9'), null, 'submit');
      expect(rl).toEqual({ ok: true });
    } finally {
      errSpy.mockRestore();
    }
    expect(sql).not.toHaveBeenCalled();
  });
});
