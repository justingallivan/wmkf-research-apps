/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/pre-site-visit/distribution-service', () => ({
  preparePreSiteDistribution: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { preparePreSiteDistribution } from '../../lib/services/pre-site-visit/distribution-service';
import handler from '../../pages/api/workbench/pre-site-visit/distribution/prepare';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const ARTIFACT_ID = '33333333-3333-3333-3333-333333333333';
const HEX64 = 'a'.repeat(64);

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

function post(body) {
  return { method: 'POST', body: { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID, ...body } };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    session: {
      user: {
        azureEmail: 'staff@example.org',
        dynamicsSystemuserId: '22222222-2222-2222-2222-222222222222',
      },
    },
  });
  preparePreSiteDistribution.mockResolvedValue({ ok: true });
});

test.each([
  ['the literal string "false"', 'false'],
  ['a boolean true', true],
  ['uppercase 64-char hex', HEX64.toUpperCase()],
  ['63-char hex (too short)', HEX64.slice(0, 63)],
  ['65-char hex (too long)', `${HEX64}a`],
])('rejects acknowledgeStaleInputs as %s with 400 and does not call the service', async (_label, value) => {
  const res = mockRes();
  await handler(post({ acknowledgeStaleInputs: value }), res);
  expect(res.statusCode).toBe(400);
  expect(preparePreSiteDistribution).not.toHaveBeenCalled();
});

test('calls the service with the exact 64-char lowercase-hex acknowledgement', async () => {
  const res = mockRes();
  await handler(post({ acknowledgeStaleInputs: HEX64 }), res);
  expect(preparePreSiteDistribution).toHaveBeenCalledWith(expect.objectContaining({
    acknowledgeStaleInputs: HEX64,
  }));
  expect(res.statusCode).toBe(200);
});

test('calls the service with acknowledgeStaleInputs omitted when the field is not sent', async () => {
  const res = mockRes();
  await handler(post({}), res);
  expect(preparePreSiteDistribution).toHaveBeenCalled();
  const callArg = preparePreSiteDistribution.mock.calls[0][0];
  expect(callArg.acknowledgeStaleInputs).toBeUndefined();
  expect(res.statusCode).toBe(200);
});
