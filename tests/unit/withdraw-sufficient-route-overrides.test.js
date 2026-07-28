/**
 * @jest-environment node
 *
 * Route-boundary narrowing for staff-reviewed withdraw email overrides.
 */

const withdrawSufficient = jest.fn(async () => ({ ok: true, withdrawn: 0, results: [] }));

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({
    session: { user: { dynamicsSystemuserId: 'staff-1' } },
  })),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_source, fn) => fn()),
}));
jest.mock('../../lib/services/review-manager/withdraw-sufficient-service', () => ({
  withdrawSufficient: (...args) => withdrawSufficient(...args),
}));

const { createMockReq, createMockRes } = require('../helpers/auth-mock');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const OTHER_ID = 'fedcbafe-dcba-4fed-8cba-fedcbafedcba';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/withdraw-sufficient')).default;
});

beforeEach(() => {
  withdrawSufficient.mockClear();
});

async function run(overrides) {
  const req = createMockReq({
    method: 'POST',
    body: {
      requestId: REQUEST_ID,
      suggestionIds: [SUGGESTION_ID],
      overrides,
    },
  });
  const res = createMockRes();
  await handler(req, res);
  return res;
}

test('canonicalizes a mixed-case selected GUID and drops prototype-like and unrelated keys', async () => {
  const upperSelected = SUGGESTION_ID.toUpperCase();
  const overrides = JSON.parse(JSON.stringify({
    [upperSelected]: {
      subject: 'Reviewed subject',
      bodyText: 'Reviewed body',
      to: 'reviewer@example.org',
      from: 'pd@example.org',
      senderId: '11111111-2222-4333-8444-555555555555',
      constructor: 'ignored',
      __proto__: 'ignored',
    },
    [OTHER_ID]: {
      subject: 'Unrelated subject',
      bodyText: 'Unrelated body',
      to: 'other@example.org',
    },
  }));
  Object.defineProperty(overrides, '__proto__', {
    value: { subject: 'pollute' },
    enumerable: true,
  });
  Object.defineProperty(overrides, 'constructor', {
    value: { subject: 'pollute' },
    enumerable: true,
  });

  const res = await run(overrides);

  expect(res.statusCode).toBe(200);
  const serviceArgs = withdrawSufficient.mock.calls[0][0];
  expect(Object.keys(serviceArgs.overrides)).toEqual([SUGGESTION_ID]);
  expect(serviceArgs.overrides[SUGGESTION_ID]).toEqual({
    subject: 'Reviewed subject',
    bodyText: 'Reviewed body',
    to: 'reviewer@example.org',
    from: 'pd@example.org',
    senderId: '11111111-2222-4333-8444-555555555555',
  });
  expect(Object.getPrototypeOf(serviceArgs.overrides)).toBeNull();
});

test('rejects incomplete or non-string selected overrides', async () => {
  const res = await run({
    [SUGGESTION_ID]: {
      subject: 42,
      bodyText: null,
      to: { address: 'reviewer@example.org' },
    },
    [OTHER_ID]: ['not', 'an', 'entry'],
  });

  expect(res.statusCode).toBe(400);
  expect(res._data.error).toMatch(/requires complete .* overrides/i);
  expect(withdrawSufficient).not.toHaveBeenCalled();
});
