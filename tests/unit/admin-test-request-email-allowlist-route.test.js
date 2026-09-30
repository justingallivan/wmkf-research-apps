/** @jest-environment node */

const requireSuperuser = jest.fn(async () => ({ profileId: 9 }));
const read = jest.fn();
const write = jest.fn();

jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: (...args) => requireSuperuser(...args) }));
jest.mock('../../lib/services/test-requests/email-allowlist', () => ({
  FOUNDATION_EMAIL_DOMAIN: 'wmkeck.org',
  MAX_ALLOWLIST_ADDRESSES: 200,
  readTestRequestEmailAllowlistForAdmin: (...args) => read(...args),
  writeTestRequestEmailAllowlist: (...args) => write(...args),
}));

import handler from '../../pages/api/admin/test-requests/email-allowlist';

function response() {
  return {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

beforeEach(() => jest.clearAllMocks());

test('GET returns the list with the fixed Foundation rule', async () => {
  read.mockResolvedValue({ addresses: ['a@x.org'], unavailable: false });
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ addresses: ['a@x.org'], unavailable: false, foundationDomain: 'wmkeck.org', maxAddresses: 200 });
});

test('PUT writes with the gate profile, never a body-supplied identity', async () => {
  write.mockResolvedValue({ ok: true, addresses: ['a@x.org'] });
  const res = response();
  await handler({ method: 'PUT', body: { addresses: ['a@x.org'] } }, res);
  expect(write).toHaveBeenCalledWith(['a@x.org'], 9);
  expect(res.body).toEqual({ ok: true, addresses: ['a@x.org'] });
});

test.each([
  [{ addresses: 'a@x.org' }],
  [{ addresses: [], profileId: 1 }],
  [null],
])('PUT refuses a malformed body %j', async (body) => {
  const res = response();
  await handler({ method: 'PUT', body }, res);
  expect(res.statusCode).toBe(400);
  expect(write).not.toHaveBeenCalled();
});

test('PUT returns 400 with the validation details', async () => {
  write.mockResolvedValue({ ok: false, errors: ['Not a valid email address: nope'] });
  const res = response();
  await handler({ method: 'PUT', body: { addresses: ['nope'] } }, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.details).toEqual(['Not a valid email address: nope']);
});

test('a non-superuser never reaches the store', async () => {
  requireSuperuser.mockResolvedValueOnce(null);
  const res = response();
  await handler({ method: 'PUT', body: { addresses: ['a@x.org'] } }, res);
  expect(write).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

test('other methods are refused', async () => {
  const res = response();
  await handler({ method: 'DELETE' }, res);
  expect(res.statusCode).toBe(405);
});
