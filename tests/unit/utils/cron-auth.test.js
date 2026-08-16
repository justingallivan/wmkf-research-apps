/**
 * @jest-environment node
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { constantTimeEqual, verifyCronSecret } from '../../../lib/utils/cron-auth';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

describe('constantTimeEqual', () => {
  it('accepts equal strings and rejects equal-length mismatches', () => {
    expect(constantTimeEqual('Bearer abc', 'Bearer abc')).toBe(true);
    expect(constantTimeEqual('Bearer abc', 'Bearer xyz')).toBe(false);
  });

  it('pads wrong-length inputs and still invokes timingSafeEqual before rejecting', () => {
    const timingSpy = jest.spyOn(crypto, 'timingSafeEqual');

    expect(constantTimeEqual('short', 'a much longer value')).toBe(false);

    expect(timingSpy).toHaveBeenCalledTimes(1);
    const [left, right] = timingSpy.mock.calls[0];
    expect(left).toBeInstanceOf(Buffer);
    expect(right).toBeInstanceOf(Buffer);
    expect(left.length).toBe(right.length);
  });

  it('rejects non-string inputs without throwing', () => {
    expect(constantTimeEqual(undefined, 'Bearer abc')).toBe(false);
    expect(constantTimeEqual(null, 'Bearer abc')).toBe(false);
  });

  it('remains wired into the strict drain verifier', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'pages/api/cron/drain-submissions.js'),
      'utf8',
    );

    expect(routeSource).toContain("import { constantTimeEqual } from '../../../lib/utils/cron-auth';");
    expect(routeSource).toContain('constantTimeEqual(got, `Bearer ${secret}`)');
    expect(routeSource).not.toContain('got !== `Bearer ${secret}`');
  });
});

describe('verifyCronSecret', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  it('accepts the exact Bearer value', () => {
    const req = { headers: { authorization: 'Bearer test-cron-secret' } };
    const res = makeRes();

    expect(verifyCronSecret(req, res)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a wrong-length Bearer value', () => {
    const req = { headers: { authorization: 'Bearer test-cron-secret-extra' } };
    const res = makeRes();

    expect(verifyCronSecret(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('rejects a missing Authorization header', () => {
    const res = makeRes();

    expect(verifyCronSecret({ headers: {} }, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('preserves the development bypass', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CRON_SECRET;
    const res = makeRes();

    expect(verifyCronSecret({ headers: {} }, res)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('preserves the non-development missing-secret 500', () => {
    delete process.env.CRON_SECRET;
    const res = makeRes();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(verifyCronSecret({ headers: {} }, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cron secret not configured' });
  });
});
