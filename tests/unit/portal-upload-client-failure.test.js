/** @jest-environment node */

jest.mock('../../lib/services/operational-event-service', () => ({
  __esModule: true,
  default: { recordEvent: jest.fn() },
}));

import OperationalEventService from '../../lib/services/operational-event-service';
import {
  parsePortalUploadFailure,
  recordPortalUploadClientFailure,
} from '../../lib/services/portal-upload-client-failure';

test('accepts only the closed, bounded telemetry shape', () => {
  expect(parsePortalUploadFailure({
    stage: 'blob_put', category: 'sdk_failure', declaredBytes: 9564384, contentType: 'image/png',
  })).toEqual({
    stage: 'blob_put', category: 'sdk_failure', httpStatus: null,
    declaredBytes: 9564384, contentType: 'image/png',
  });
  expect(parsePortalUploadFailure({ stage: 'blob_put', category: 'raw_error', error: 'secret' })).toBeNull();
  expect(parsePortalUploadFailure({ stage: 'blob_put', category: 'sdk_failure', declaredBytes: 20 * 1024 * 1024 })).toBeNull();
});

test('records a labeled client report without client text or path fields', async () => {
  OperationalEventService.recordEvent.mockResolvedValue({ id: 1 });
  await recordPortalUploadClientFailure({
    surface: 'external_grantee',
    resourceId: '11111111-1111-4111-8111-111111111111',
    report: parsePortalUploadFailure({
      stage: 'blob_put', category: 'sdk_failure', declaredBytes: 9564384, contentType: 'image/png',
    }),
  });
  expect(OperationalEventService.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'portal_upload_client_failure',
    stage: 'blob_put',
    metadata: expect.objectContaining({ clientReported: true, declaredBytes: 9564384 }),
  }));
  expect(JSON.stringify(OperationalEventService.recordEvent.mock.calls[0][0])).not.toMatch(/filename|pathname|exception|caption|abstract/i);
});
