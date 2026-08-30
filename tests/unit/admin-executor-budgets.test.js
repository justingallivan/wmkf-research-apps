/** @jest-environment node */

const requireSuperuser = jest.fn(async () => ({ profileId: 'profile-1' }));
const withDalContext = jest.fn(async (_label, callback) => callback());
const getExecutorBudgetConfig = jest.fn();
const publishExecutorBudgetConfig = jest.fn();

jest.mock('../../lib/utils/auth', () => ({
  requireSuperuser: (...args) => requireSuperuser(...args),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (...args) => withDalContext(...args),
}));
jest.mock('../../lib/services/executor-budget-service', () => ({
  getExecutorBudgetConfig: (...args) => getExecutorBudgetConfig(...args),
  publishExecutorBudgetConfig: (...args) => publishExecutorBudgetConfig(...args),
}));

import handler from '../../pages/api/admin/executor-budgets';
import { ServiceHttpError } from '../../lib/services/service-http-error';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireSuperuser.mockResolvedValue({ profileId: 'profile-1' });
  withDalContext.mockImplementation(async (_label, callback) => callback());
  getExecutorBudgetConfig.mockResolvedValue({ version: 0, source: 'code_fallback' });
  publishExecutorBudgetConfig.mockResolvedValue({ status: 'completed', config: { version: 1 } });
});

test('GET requires superuser context and performs a strict settings read', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  expect(requireSuperuser).toHaveBeenCalledTimes(1);
  expect(withDalContext).toHaveBeenCalledWith('admin-executor-budgets', expect.any(Function));
  expect(getExecutorBudgetConfig).toHaveBeenCalledWith({ strict: true });
  expect(res.body).toEqual({ version: 0, source: 'code_fallback' });
});

test('PUT forwards only the closed publication inputs and authenticated profile', async () => {
  const body = {
    budgets: { example: true },
    expectedVersion: 3,
    requestId: '11111111-1111-4111-8111-111111111111',
    profileId: 'client-forgery',
  };
  const res = mockRes();
  await handler({ method: 'PUT', body }, res);
  expect(publishExecutorBudgetConfig).toHaveBeenCalledWith({
    budgets: body.budgets,
    expectedVersion: 3,
    requestId: body.requestId,
    profileId: 'profile-1',
  });
  expect(res.statusCode).toBe(200);
});

test('typed publication errors preserve status and body', async () => {
  publishExecutorBudgetConfig.mockRejectedValue(new ServiceHttpError('changed', {
    httpStatus: 409,
    code: 'version_conflict',
    body: { error: 'changed', code: 'version_conflict' },
  }));
  const res = mockRes();
  await handler({ method: 'PUT', body: {} }, res);
  expect(res.statusCode).toBe(409);
  expect(res.body).toEqual({ error: 'changed', code: 'version_conflict' });
});

test('unsupported methods expose the allowlist before auth', async () => {
  const res = mockRes();
  await handler({ method: 'POST' }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET, PUT');
  expect(requireSuperuser).not.toHaveBeenCalled();
});
