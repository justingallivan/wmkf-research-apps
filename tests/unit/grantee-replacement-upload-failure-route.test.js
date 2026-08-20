/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/portal-upload-client-failure', () => ({
  parsePortalUploadFailure: jest.fn(), recordPortalUploadClientFailure: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { parsePortalUploadFailure, recordPortalUploadClientFailure } from '../../lib/services/portal-upload-client-failure';
import handler from '../../pages/api/workbench/grantee-deliverables/replacement-upload-failure';

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const response = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } });

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  parsePortalUploadFailure.mockReturnValue({ stage: 'blob_put', category: 'sdk_failure' });
});

test('requires staff app access and a GUID before recording', async () => {
  const res = response();
  await handler({ method: 'POST', body: { requestId: REQUEST_ID }, headers: {} }, res);
  expect(recordPortalUploadClientFailure).toHaveBeenCalledWith({
    surface: 'staff_grantee_replacement', resourceId: REQUEST_ID,
    report: { stage: 'blob_put', category: 'sdk_failure' },
  });
});

test('rejects malformed client telemetry', async () => {
  parsePortalUploadFailure.mockReturnValue(null);
  const res = response();
  await handler({ method: 'POST', body: { requestId: REQUEST_ID }, headers: {} }, res);
  expect(res.statusCode).toBe(400);
  expect(recordPortalUploadClientFailure).not.toHaveBeenCalled();
});
