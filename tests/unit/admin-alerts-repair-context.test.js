/** @jest-environment node */

const getAlertById = jest.fn();
const getAddressRepairRequestContext = jest.fn();
const withDalContext = jest.fn(async (_label, callback) => callback());

jest.mock('../../lib/utils/auth', () => ({
  requireSuperuser: jest.fn(async () => ({ profileId: 9 })),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (...args) => withDalContext(...args),
}));
jest.mock('../../lib/services/alert-service', () => ({
  __esModule: true,
  default: {
    getAlertById: (...args) => getAlertById(...args),
    getAlerts: jest.fn(async () => []),
    getAlertSummary: jest.fn(async () => ({})),
  },
}));
jest.mock('../../lib/services/reviewer-address-trust-service', () => ({
  getAddressRepairRequestContext: (...args) => getAddressRepairRequestContext(...args),
}));

import handler from '../../pages/api/admin/alerts';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getAlertById.mockResolvedValue({
    id: 491,
    alert_type: 'reviewer_address_repair_requested',
    status: 'active',
    metadata: {
      requestId: 'request-guid',
      candidateKey: 'candidate:reviewer',
      suggestionId: null,
      code: 'address_conflict_pending',
    },
  });
  getAddressRepairRequestContext.mockResolvedValue({
    request: { id: 'request-guid', number: '1000001' },
    reviewer: { name: 'Reviewer Name' },
  });
});

test('repair detail re-reads context from the matched alert metadata under DAL context', async () => {
  const res = response();
  await handler({ method: 'GET', query: { repairContext: '491' } }, res);

  expect(getAlertById).toHaveBeenCalledWith(491);
  expect(withDalContext).toHaveBeenCalledWith('admin-reviewer-repair-context', expect.any(Function));
  expect(getAddressRepairRequestContext).toHaveBeenCalledWith({
    requestId: 'request-guid',
    candidateKey: 'candidate:reviewer',
    suggestionId: null,
    code: 'address_conflict_pending',
    repairSurface: undefined,
  });
  expect(res.body.context).toMatchObject({ reviewer: { name: 'Reviewer Name' } });
});

test('repair detail rejects a client-selected non-repair alert before Dataverse reads', async () => {
  getAlertById.mockResolvedValueOnce({
    id: 15,
    alert_type: 'health_check_failure',
    status: 'active',
    metadata: { requestId: 'request-guid' },
  });
  const res = response();
  await handler({ method: 'GET', query: { repairContext: '15' } }, res);

  expect(res.statusCode).toBe(404);
  expect(withDalContext).not.toHaveBeenCalled();
  expect(getAddressRepairRequestContext).not.toHaveBeenCalled();
});

test('repair detail rejects malformed alert ids', async () => {
  const res = response();
  await handler({ method: 'GET', query: { repairContext: '491oops' } }, res);
  expect(res.statusCode).toBe(400);
  expect(getAlertById).not.toHaveBeenCalled();
});
