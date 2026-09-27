/** @jest-environment node */
const requireAppAccess = jest.fn();
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: (...args) => requireAppAccess(...args) }));
const withDalContext = jest.fn((label, fn) => fn());
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (...args) => withDalContext(...args) }));
const loadModelOverrides = jest.fn();
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: (...args) => loadModelOverrides(...args) }));
const runWorkbenchIntegrityScreen = jest.fn();
const getWorkbenchIntegrityContext = jest.fn();
jest.mock('../../lib/services/workbench/integrity-service', () => ({
  runWorkbenchIntegrityScreen: (...args) => runWorkbenchIntegrityScreen(...args),
  getWorkbenchIntegrityContext: (...args) => getWorkbenchIntegrityContext(...args),
}));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({ nextRateLimiter: () => jest.fn(async () => true) }));

import runHandler from '../../pages/api/workbench/integrity/[requestId]/run';
import getHandler from '../../pages/api/workbench/integrity/[requestId]';

function response() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 77 });
  loadModelOverrides.mockResolvedValue(undefined);
  runWorkbenchIntegrityScreen.mockResolvedValue({ requestId: '11111111-1111-4111-8111-111111111111', people: [], run: {} });
  getWorkbenchIntegrityContext.mockResolvedValue({ requestId: '11111111-1111-4111-8111-111111111111', people: [], latestRun: null });
  delete process.env.CLAUDE_API_KEY;
  delete process.env.SERP_API_KEY;
});

test('requires Integrity app access before any model or service work', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = response();
  await runHandler({ method: 'POST', query: { requestId: '11111111-1111-4111-8111-111111111111' }, body: {} }, res);
  expect(runWorkbenchIntegrityScreen).not.toHaveBeenCalled();
  expect(loadModelOverrides).not.toHaveBeenCalled();
});

test('rejects malformed or array GUIDs before model warming', async () => {
  for (const requestId of ['invalid', ['11111111-1111-4111-8111-111111111111']]) {
    const res = response();
    await runHandler({ method: 'POST', query: { requestId }, body: {} }, res);
    expect(res.statusCode).toBe(400);
  }
  expect(loadModelOverrides).not.toHaveBeenCalled();
});

test('ignores body identity fields; uses authenticated actor and route GUID only', async () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  process.env.CLAUDE_API_KEY = 'server-claude-key';
  process.env.SERP_API_KEY = 'server-serp-key';
  const res = response();
  await runHandler({
    method: 'POST',
    query: { requestId },
    body: { applicants: [{ name: 'Attacker Supplied', institution: 'Wrong Org' }], actorProfileId: 4, people: [{ contactId: 'deadbeef' }] },
  }, res);
  expect(res.statusCode).toBe(200);
  expect(loadModelOverrides).toHaveBeenCalledTimes(1);
  expect(withDalContext).toHaveBeenCalledWith('workbench-integrity-run', expect.any(Function));
  expect(runWorkbenchIntegrityScreen).toHaveBeenCalledWith({
    requestId,
    actorProfileId: 77,
    claudeApiKey: 'server-claude-key',
    serpApiKey: 'server-serp-key',
  });
});


test('GET refuses denied access before loading request context', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const req = { method: 'GET', query: { requestId: '11111111-1111-4111-8111-111111111111' } };
  const res = response();
  await getHandler(req, res);
  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'integrity-screener');
  expect(getWorkbenchIntegrityContext).not.toHaveBeenCalled();
  expect(withDalContext).not.toHaveBeenCalled();
});

test('GET rejects a bad GUID before opening a DAL scope', async () => {
  const res = response();
  await getHandler({ method: 'GET', query: { requestId: 'bad' } }, res);
  expect(res.statusCode).toBe(400);
  expect(getWorkbenchIntegrityContext).not.toHaveBeenCalled();
  expect(withDalContext).not.toHaveBeenCalled();
});

test('GET requires the exact Integrity Screener grant and forwards only the route GUID', async () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const req = { method: 'GET', query: { requestId } };
  const res = response();
  await getHandler(req, res);
  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'integrity-screener');
  expect(withDalContext).toHaveBeenCalledWith('workbench-integrity-latest', expect.any(Function));
  expect(getWorkbenchIntegrityContext).toHaveBeenCalledWith({ requestId });
});
