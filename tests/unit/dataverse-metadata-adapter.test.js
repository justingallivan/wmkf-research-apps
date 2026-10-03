/**
 * @jest-environment node
 */

jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: { getAccessToken: jest.fn() },
}));
jest.mock('../../lib/services/dynamics/http.js', () => ({
  buildHeaders: jest.fn(token => ({ Authorization: `Bearer ${token}` })),
  fetchWithTimeout: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context.js', () => ({ hasTrustedDalContext: jest.fn() }));

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { fetchWithTimeout } from '../../lib/services/dynamics/http.js';
import { hasTrustedDalContext } from '../../lib/dataverse/core/context.js';
import { getMetadataBatch } from '../../lib/dataverse/adapters/metadata.js';

const originalUrl = process.env.DYNAMICS_URL;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMICS_URL = 'https://sandbox.example.crm.dynamics.com';
  hasTrustedDalContext.mockReturnValue(true);
});

afterAll(() => {
  if (originalUrl === undefined) delete process.env.DYNAMICS_URL;
  else process.env.DYNAMICS_URL = originalUrl;
});

test('uses one OAuth token and client for a bounded metadata batch', async () => {
  DynamicsService.getAccessToken.mockResolvedValue('token');
  fetchWithTimeout
    .mockResolvedValueOnce({ ok: true, json: async () => ({ value: ['one'] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ value: ['two'] }) });
  const paths = [
    "/EntityDefinitions(LogicalName='akoya_request')/Attributes",
    "/EntityDefinitions(LogicalName='akoya_request')/ManyToOneRelationships",
  ];

  await expect(getMetadataBatch(paths)).resolves.toEqual([
    { value: ['one'] },
    { value: ['two'] },
  ]);
  expect(DynamicsService.getAccessToken).toHaveBeenCalledTimes(1);
  expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  expect(fetchWithTimeout.mock.calls[0][0]).toContain('/api/data/v9.2/EntityDefinitions(');
  expect(fetchWithTimeout.mock.calls[0][2]).toBe(30_000);
});

test('rejects unsupported paths before requesting a token', async () => {
  await expect(getMetadataBatch(['/akoya_requests'])).rejects.toThrow('Unsupported Dataverse metadata path.');
  await expect(getMetadataBatch(['/EntityDefinitions(x)evil'])).rejects.toThrow('Unsupported Dataverse metadata path.');
  await expect(getMetadataBatch(['/EntityDefinitions(x)/../../akoya_requests'])).rejects.toThrow('Unsupported Dataverse metadata path.');
  await expect(getMetadataBatch(['/EntityDefinitions(x)/%2e%2e/akoya_requests'])).rejects.toThrow('Unsupported Dataverse metadata path.');
  expect(DynamicsService.getAccessToken).not.toHaveBeenCalled();
});

test('requires a trusted DAL context before requesting a token', async () => {
  hasTrustedDalContext.mockReturnValue(false);
  await expect(getMetadataBatch(["/EntityDefinitions(LogicalName='akoya_request')/Attributes"]))
    .rejects.toThrow('trusted DAL context');
  expect(DynamicsService.getAccessToken).not.toHaveBeenCalled();
});
