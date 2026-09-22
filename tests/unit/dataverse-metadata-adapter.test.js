/**
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/client.js', () => ({
  createClient: jest.fn(),
  getAccessToken: jest.fn(),
}));

import { createClient, getAccessToken } from '../../lib/dataverse/client.js';
import { getMetadataBatch } from '../../lib/dataverse/adapters/metadata.js';

const originalUrl = process.env.DYNAMICS_URL;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMICS_URL = 'https://sandbox.example.crm.dynamics.com';
});

afterAll(() => {
  if (originalUrl === undefined) delete process.env.DYNAMICS_URL;
  else process.env.DYNAMICS_URL = originalUrl;
});

test('uses one OAuth token and client for a bounded metadata batch', async () => {
  getAccessToken.mockResolvedValue('token');
  const get = jest.fn()
    .mockResolvedValueOnce({ ok: true, body: { value: ['one'] } })
    .mockResolvedValueOnce({ ok: true, body: { value: ['two'] } });
  createClient.mockReturnValue({ get });
  const paths = [
    "/EntityDefinitions(LogicalName='akoya_request')/Attributes",
    "/EntityDefinitions(LogicalName='akoya_request')/ManyToOneRelationships",
  ];

  await expect(getMetadataBatch(paths)).resolves.toEqual([
    { value: ['one'] },
    { value: ['two'] },
  ]);
  expect(getAccessToken).toHaveBeenCalledTimes(1);
  expect(createClient).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledTimes(2);
});

test('rejects unsupported paths before requesting a token', async () => {
  await expect(getMetadataBatch(['/akoya_requests'])).rejects.toThrow('Unsupported Dataverse metadata path.');
  expect(getAccessToken).not.toHaveBeenCalled();
});
