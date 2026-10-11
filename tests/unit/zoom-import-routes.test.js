/** @jest-environment node */
jest.mock('../../lib/utils/auth.js', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: (_name, fn) => fn() }));
jest.mock('../../lib/utils/actor-ref.js', () => ({ actorRefFromSession: jest.fn(() => '77777777-7777-4777-8777-777777777777') }));
jest.mock('../../lib/services/transcription-pilot/runtime.js', () => ({ TranscriptionPilotError: class TranscriptionPilotError extends Error {} }));
jest.mock('../../lib/services/meeting-tracker-recordings/import-service.js', () => ({
  listZoomRecordingsForVisit: jest.fn(async () => ({ available: true, windowDays: 30, meetings: [] })),
  importZoomRecording: jest.fn(async () => ({ import: { id: 'i', state: 'started', failureCode: null }, job: { id: 'j' } })),
}));

import { requireAppAccess } from '../../lib/utils/auth.js';
import { actorRefFromSession } from '../../lib/utils/actor-ref.js';
import { ServiceHttpError } from '../../lib/services/service-http-error.js';
import { listZoomRecordingsForVisit, importZoomRecording } from '../../lib/services/meeting-tracker-recordings/import-service.js';
import listRoute from '../../pages/api/meeting-tracker/visits/[requestId]/zoom-recordings.js';
import importRoute, { config as importConfig } from '../../pages/api/meeting-tracker/visits/[requestId]/zoom-imports.js';
import { config as listConfig } from '../../pages/api/meeting-tracker/visits/[requestId]/zoom-recordings.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const ACTOR = '77777777-7777-4777-8777-777777777777';
function response() {
  return { status: jest.fn(function status(v) { this.statusCode = v; return this; }), json: jest.fn(function json(v) { this.body = v; return this; }), setHeader: jest.fn() };
}
const body = (over = {}) => ({ meetingUuid: 'abc==', nonSensitiveAcknowledged: true, ...over });
beforeEach(() => { jest.clearAllMocks(); requireAppAccess.mockResolvedValue({ profileId: 9, session: { user: {} } }); });

describe('GET zoom-recordings', () => {
  test('checks the app grant, is private/no-store and returns the service result', async () => {
    const res = response();
    await listRoute({ method: 'GET', query: { requestId, days: '14' } }, res);
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'meeting-tracker');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(listZoomRecordingsForVisit).toHaveBeenCalledWith({ requestId, days: '14' });
    expect(res.statusCode).toBe(200);
  });
  test('rejects other methods, bad GUIDs, repeated or unknown query keys before any service call', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) { const res = response(); await listRoute({ method, query: { requestId } }, res); expect(res.statusCode).toBe(405); }
    const bad = response(); await listRoute({ method: 'GET', query: { requestId: 'nope' } }, bad); expect(bad.statusCode).toBe(400);
    const arr = response(); await listRoute({ method: 'GET', query: { requestId: [requestId] } }, arr); expect(arr.statusCode).toBe(400);
    const dup = response(); await listRoute({ method: 'GET', query: { requestId, days: ['1', '2'] } }, dup); expect(dup.statusCode).toBe(400);
    const extra = response(); await listRoute({ method: 'GET', query: { requestId, host: 'x@y.org' } }, extra); expect(extra.statusCode).toBe(400);
    expect(listZoomRecordingsForVisit).not.toHaveBeenCalled();
  });
  test('stops when the app grant is refused, and requires a linked profile', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    await listRoute({ method: 'GET', query: { requestId } }, response());
    expect(listZoomRecordingsForVisit).not.toHaveBeenCalled();
    requireAppAccess.mockResolvedValueOnce({ profileId: null, session: {} });
    const res = response(); await listRoute({ method: 'GET', query: { requestId } }, res);
    expect(res.statusCode).toBe(401);
  });
  test('service errors keep their status; unexpected errors are generic', async () => {
    listZoomRecordingsForVisit.mockRejectedValueOnce(new ServiceHttpError('days must be a whole number from 1 to 90.', { httpStatus: 400, code: 'invalid_days' }));
    const a = response(); await listRoute({ method: 'GET', query: { requestId, days: '0' } }, a);
    expect(a.statusCode).toBe(400); expect(a.body.code).toBe('invalid_days');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    listZoomRecordingsForVisit.mockRejectedValueOnce(new Error('token abc https://zoom.us/x'));
    const b = response(); await listRoute({ method: 'GET', query: { requestId } }, b);
    expect(b.statusCode).toBe(500); expect(JSON.stringify(b.body)).not.toMatch(/token|zoom\.us/);
  });
  test('maxDuration is 60', () => { expect(listConfig.maxDuration).toBe(60); });
});

describe('POST zoom-imports', () => {
  test('passes the session actor and profile, never body identity', async () => {
    const res = response();
    await importRoute({ method: 'POST', query: { requestId }, body: body() }, res);
    expect(actorRefFromSession).toHaveBeenCalled();
    expect(importZoomRecording).toHaveBeenCalledWith({ requestId, ownerProfileId: 9, actingUserSystemId: ACTOR, meetingUuid: 'abc==', acknowledged: true });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.statusCode).toBe(200);
    expect(res.body.import.state).toBe('started');
  });
  test.each([
    ['an extra key', { ...body(), actingUserSystemId: 'x' }],
    ['an extra profile key', { ...body(), ownerProfileId: 1 }],
    ['a missing acknowledgement', { meetingUuid: 'abc==' }],
    ['a missing uuid', { nonSensitiveAcknowledged: true }],
    ['an array body', []],
    ['a null body', null],
    ['a string body', 'x'],
  ])('rejects %s with 400 before any service call', async (_l, payload) => {
    const res = response();
    await importRoute({ method: 'POST', query: { requestId }, body: payload }, res);
    expect(res.statusCode).toBe(400);
    expect(importZoomRecording).not.toHaveBeenCalled();
  });
  test('rejects other methods and bad GUIDs', async () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) { const res = response(); await importRoute({ method, query: { requestId }, body: body() }, res); expect(res.statusCode).toBe(405); }
    const bad = response(); await importRoute({ method: 'POST', query: { requestId: 'nope' }, body: body() }, bad); expect(bad.statusCode).toBe(400);
    expect(importZoomRecording).not.toHaveBeenCalled();
  });
  test('stops when the app grant is refused', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    await importRoute({ method: 'POST', query: { requestId }, body: body() }, response());
    expect(importZoomRecording).not.toHaveBeenCalled();
  });
  test('a 409 in-progress error keeps its status and code', async () => {
    importZoomRecording.mockRejectedValueOnce(new ServiceHttpError('This recording is already being imported.', { httpStatus: 409, code: 'zoom_import_in_progress', body: { error: 'This recording is already being imported.', code: 'zoom_import_in_progress' } }));
    const res = response(); await importRoute({ method: 'POST', query: { requestId }, body: body() }, res);
    expect(res.statusCode).toBe(409); expect(res.body.code).toBe('zoom_import_in_progress');
  });
  test('a Zoom-shaped error keeps its status and shows only its code', async () => {
    importZoomRecording.mockRejectedValueOnce(Object.assign(new Error('zoom_download_invalid'), { code: 'zoom_download_invalid', httpStatus: 502 }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = response(); await importRoute({ method: 'POST', query: { requestId }, body: body() }, res);
    expect(res.statusCode).toBe(502); expect(res.body.code).toBe('zoom_download_invalid');
  });
  test('uses an 8 kb body limit and the full 300 s duration', () => {
    expect(importConfig.api.bodyParser.sizeLimit).toBe('8kb');
    expect(importConfig.maxDuration).toBe(300);
  });
});
