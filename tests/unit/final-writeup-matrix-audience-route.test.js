/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/final-writeup/matrix-audience-service', () => ({
  getFinalWriteupMatrixAudienceAdminState: jest.fn(),
  writeFinalWriteupMatrixAudienceConfig: jest.fn(),
}));

import { withDalContext } from '../../lib/dataverse/core/context';
import {
  getFinalWriteupMatrixAudienceAdminState,
  writeFinalWriteupMatrixAudienceConfig,
} from '../../lib/services/final-writeup/matrix-audience-service';
import { requireSuperuser } from '../../lib/utils/auth';
import handler, { config as routeConfig } from '../../pages/api/admin/final-writeup-matrix-audiences';

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(key, value) { this.headers[key] = value; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireSuperuser.mockResolvedValue({ profileId: 42 });
  getFinalWriteupMatrixAudienceAdminState.mockResolvedValue({
    configured: false,
    storedVersion: null,
    migrationRequired: false,
    config: { version: 2, personas: [], programs: [] },
    revision: null,
    programs: [],
    reviewers: [],
    staleReferences: { grantProgramIds: [], reviewerIds: [] },
    unassignedReviewerIds: [],
  });
  writeFinalWriteupMatrixAudienceConfig.mockResolvedValue({ configured: true });
});

test('GET is superuser-gated, rejects query input, and reads inside DAL context', async () => {
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(requireSuperuser).toHaveBeenCalled();
  expect(withDalContext).toHaveBeenCalledWith('admin-final-writeup-matrix-audiences', expect.any(Function));
  expect(getFinalWriteupMatrixAudienceAdminState).toHaveBeenCalled();
  expect(res.body).toMatchObject({ success: true, configured: false });

  const rejected = response();
  await handler({ method: 'GET', query: { program: 'Research' } }, rejected);
  expect(rejected.statusCode).toBe(400);
});

test('PUT accepts only config plus its expected revision and passes the authenticated profile id', async () => {
  const config = { version: 2, personas: [], programs: [] };
  const res = response();
  await handler({ method: 'PUT', query: {}, body: { config, expectedRevision: null } }, res);
  expect(writeFinalWriteupMatrixAudienceConfig).toHaveBeenCalledWith(config, null, 42);

  const rejected = response();
  await handler({ method: 'PUT', query: {}, body: { config, expectedRevision: null, extra: true } }, rejected);
  expect(rejected.statusCode).toBe(400);
});

test('route body limit covers the bounded v2 contract', () => {
  expect(routeConfig.api.bodyParser.sizeLimit).toBe('96kb');
});

test('unauthenticated and unsupported methods stop before service reads', async () => {
  requireSuperuser.mockResolvedValueOnce(null);
  await handler({ method: 'GET', query: {} }, response());
  expect(getFinalWriteupMatrixAudienceAdminState).not.toHaveBeenCalled();

  const unsupported = response();
  await handler({ method: 'POST', query: {} }, unsupported);
  expect(unsupported.statusCode).toBe(405);
  expect(unsupported.headers.Allow).toBe('GET, PUT');
});
