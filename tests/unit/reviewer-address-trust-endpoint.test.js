/** @jest-environment node */

const requireAppAccess = jest.fn();
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: (...args) => requireAppAccess(...args),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (_name, work) => work(),
}));

const retryAddressCheck = jest.fn();
jest.mock('../../lib/services/reviewer-address-trust-service', () => ({
  verifyPersonAndAddress: jest.fn(),
  getAddressConflict: jest.fn(),
  retryAddressCheck: (...args) => retryAddressCheck(...args),
  createAddressRepairRequest: jest.fn(),
}));

import handler from '../../pages/api/workbench/reviewer-address-trust';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader: jest.fn(),
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    profileId: 7,
    session: { user: { dynamicsSystemuserId: 'system-7' } },
  });
  retryAddressCheck.mockResolvedValue({
    success: true,
    decision: 'structural_state_refreshed',
    candidate: { candidateKey: 'candidate:reviewer' },
  });
});

test('forwards the bounded structural reason to the server-owned retry recheck', async () => {
  const res = response();
  await handler({
    method: 'POST',
    body: {
      requestId: REQUEST_ID,
      candidateKey: 'candidate:reviewer',
      action: 'retry_check',
      code: 'contact_linked_elsewhere',
    },
  }, res);

  expect(res.statusCode).toBe(200);
  expect(retryAddressCheck).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    candidateKey: 'candidate:reviewer',
    code: 'contact_linked_elsewhere',
    actorProfileId: 7,
    actorSystemUserId: 'system-7',
  });
});
