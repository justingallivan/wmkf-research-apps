/** @jest-environment node */

const requireAppAccess = jest.fn();
const withDalContext = jest.fn(async (_label, operation) => operation());
const verifyPersonAndAddress = jest.fn();
const getAddressConflict = jest.fn();
const retryAddressCheck = jest.fn();
const createAddressRepairRequest = jest.fn();

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: (...args) => requireAppAccess(...args),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (...args) => withDalContext(...args),
}));
jest.mock('../../lib/services/reviewer-address-trust-service', () => ({
  verifyPersonAndAddress: (...args) => verifyPersonAndAddress(...args),
  getAddressConflict: (...args) => getAddressConflict(...args),
  retryAddressCheck: (...args) => retryAddressCheck(...args),
  createAddressRepairRequest: (...args) => createAddressRepairRequest(...args),
}));

import handler from '../../pages/api/workbench/reviewer-address-trust';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const PERSON_ID = '33333333-3333-4333-8333-333333333333';

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { this.body = body; return this; },
  };
}

function body(overrides = {}) {
  return {
    action: 'verify_person_and_address',
    requestId: REQUEST_ID,
    candidateKey: `person:${PERSON_ID}`,
    email: 'reviewer@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/reviewer',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    profileId: 'profile-1',
    session: { user: { dynamicsSystemuserId: 'system-1' } },
  });
  verifyPersonAndAddress.mockResolvedValue({ success: true, code: 'address_attested' });
});

test('rejects browser-supplied stage receipts and source/result versions before the address service', async () => {
  for (const forged of [
    body({ sourceVersion: 'browser-asserted' }),
    body({ resultVersion: 'browser-result' }),
    body({ stage: 'address_trust' }),
    body({ canonicalPersonEtag: 'W/"browser"' }),
    body({ receipt: { state: 'current' } }),
  ]) {
    const res = response();
    await handler({ method: 'POST', body: forged }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'client_authority_claim_rejected' });
  }
  expect(verifyPersonAndAddress).not.toHaveBeenCalled();
  expect(withDalContext).not.toHaveBeenCalled();
});

test('forwards only the structured staff choice/evidence and authenticated actor', async () => {
  const res = response();
  await handler({ method: 'POST', body: body({
    verifiedContact: { website: 'https://example.edu/reviewer', affiliation: 'Example University' },
    note: 'Verified on institutional profile.',
  }) }, res);

  expect(res.statusCode).toBe(200);
  expect(withDalContext).toHaveBeenCalledWith('workbench-reviewer-address-trust', expect.any(Function));
  expect(verifyPersonAndAddress).toHaveBeenCalledWith(expect.objectContaining({
    requestId: REQUEST_ID,
    candidateKey: `person:${PERSON_ID}`,
    email: 'reviewer@example.edu',
    actorProfileId: 'profile-1',
    actorSystemUserId: 'system-1',
  }));
});

test('rejects a noncanonical roster key for the structured verification action', async () => {
  const res = response();
  await handler({ method: 'POST', body: body({ candidateKey: 'legacy-row:42' }) }, res);
  expect(res.statusCode).toBe(400);
  expect(res.body).toMatchObject({ success: false, code: 'candidate_stale' });
  expect(verifyPersonAndAddress).not.toHaveBeenCalled();
});
