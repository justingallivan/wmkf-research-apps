/** @jest-environment node */
jest.mock('../../lib/utils/auth.js', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/utils/actor-ref.js', () => ({ actorRefFromSession: jest.fn(() => '77777777-7777-4777-8777-777777777777') }));
jest.mock('../../lib/services/meeting-tracker-recordings/video-copy-service.js', () => ({
  getZoomVideoCopies: jest.fn(async () => ({ available: true, copies: [] })),
  startZoomVideoCopy: jest.fn(async () => ({ status: 202, body: { copy: { id: 'c', state: 'queued' } } })),
  cancelZoomVideoCopy: jest.fn(async () => ({ status: 202, body: { copy: { id: 'c', state: 'queued' } } })),
}));
jest.mock('../../lib/services/meeting-tracker-recordings/zoom-client.js', () => ({ listHostRecordings: jest.fn(), getMeetingRecordings: jest.fn() }));

import { requireAppAccess } from '../../lib/utils/auth.js';
import { withDalContext } from '../../lib/dataverse/core/context.js';
import { actorRefFromSession } from '../../lib/utils/actor-ref.js';
import { ServiceHttpError } from '../../lib/services/service-http-error.js';
import { listHostRecordings, getMeetingRecordings } from '../../lib/services/meeting-tracker-recordings/zoom-client.js';
import { getZoomVideoCopies, startZoomVideoCopy, cancelZoomVideoCopy } from '../../lib/services/meeting-tracker-recordings/video-copy-service.js';
import route, { config } from '../../pages/api/meeting-tracker/visits/[requestId]/zoom-video-copies.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const ACTOR = '77777777-7777-4777-8777-777777777777';
const ARTIFACT = '33333333-3333-4333-8333-333333333333';
const COPY = '44444444-4444-4444-8444-444444444444';
function response() {
  return { status: jest.fn(function status(v) { this.statusCode = v; return this; }), json: jest.fn(function json(v) { this.body = v; return this; }), setHeader: jest.fn() };
}
const start = (over = {}) => ({ action: 'start', meetingUuid: 'abc==', replaces: null, ...over });
const cancel = (over = {}) => ({ action: 'cancel', copyId: COPY, ...over });
const post = (body, res = response(), query = { requestId }) => route({ method: 'POST', query, body }, res).then(() => res);
const noService = () => [getZoomVideoCopies, startZoomVideoCopy, cancelZoomVideoCopy].forEach(fn => expect(fn).not.toHaveBeenCalled());
beforeEach(() => { jest.clearAllMocks(); requireAppAccess.mockResolvedValue({ profileId: 9, session: { user: {} } }); });

describe('GET', () => {
  test('checks the app grant, is private/no-store, runs in a DAL context and makes no Zoom call', async () => {
    const res = response();
    await route({ method: 'GET', query: { requestId } }, res);
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'meeting-tracker');
    expect(withDalContext).toHaveBeenCalledWith('meeting-tracker-zoom-video-copies', expect.any(Function));
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(getZoomVideoCopies).toHaveBeenCalledWith({ requestId });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ available: true, copies: [] });
    expect(listHostRecordings).not.toHaveBeenCalled();
    expect(getMeetingRecordings).not.toHaveBeenCalled();
  });
  test('rejects extra query keys, array ids and bad GUIDs before the service', async () => {
    for (const query of [{ requestId, days: '3' }, { requestId: [requestId] }, { requestId: 'nope' }]) {
      const res = response(); await route({ method: 'GET', query }, res); expect(res.statusCode).toBe(400);
    }
    noService();
  });
});

describe('POST start', () => {
  test('passes the session actor and profile, never body identity; replaces null', async () => {
    const res = await post(start());
    expect(actorRefFromSession).toHaveBeenCalled();
    expect(startZoomVideoCopy).toHaveBeenCalledWith({ requestId, actorProfileId: 9, actingUserSystemId: ACTOR, meetingUuid: 'abc==', replaces: null });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ copy: { id: 'c', state: 'queued' } });
  });
  test('passes a well-formed replaces through and relays the service status (200 replay)', async () => {
    startZoomVideoCopy.mockResolvedValueOnce({ status: 200, body: { copy: { id: 'c', state: 'copied' }, replayed: true } });
    const res = await post(start({ replaces: { artifactId: ARTIFACT, slotVersion: 4 } }));
    expect(startZoomVideoCopy.mock.calls[0][0].replaces).toEqual({ artifactId: ARTIFACT, slotVersion: 4 });
    expect(res.statusCode).toBe(200);
  });
  test.each([
    ['an extra key', { ...start(), actingUserSystemId: 'x' }],
    ['an extra profile key', { ...start(), actorProfileId: 1 }],
    ['a missing replaces', { action: 'start', meetingUuid: 'abc==' }],
    ['a missing meetingUuid', { action: 'start', replaces: null }],
    ['a non-string meetingUuid', start({ meetingUuid: 5 })],
    ['replaces undefined-ish (false)', start({ replaces: false })],
    ['replaces as an array', start({ replaces: [] })],
    ['replaces with an extra key', start({ replaces: { artifactId: ARTIFACT, slotVersion: 1, x: 1 } })],
    ['replaces with a non-GUID artifact', start({ replaces: { artifactId: 'nope', slotVersion: 1 } })],
    ['replaces with a padded GUID', start({ replaces: { artifactId: ` ${ARTIFACT}`, slotVersion: 1 } })],
    ['replaces with a string slotVersion', start({ replaces: { artifactId: ARTIFACT, slotVersion: '1' } })],
    ['replaces with slotVersion 0', start({ replaces: { artifactId: ARTIFACT, slotVersion: 0 } })],
    ['an unknown action', { action: 'retry', meetingUuid: 'abc==', replaces: null }],
    ['no action', { meetingUuid: 'abc==', replaces: null }],
    ['a cancel body with start keys', { action: 'cancel', meetingUuid: 'abc==', replaces: null }],
    ['an array body', []],
    ['a null body', null],
    ['a string body', 'x'],
  ])('rejects %s with 400 before any service call', async (_l, payload) => {
    expect((await post(payload)).statusCode).toBe(400);
    noService();
  });
});

describe('POST cancel', () => {
  test('passes the request and copy id only', async () => {
    const res = await post(cancel());
    expect(cancelZoomVideoCopy).toHaveBeenCalledWith({ requestId, copyId: COPY });
    expect(res.statusCode).toBe(202);
  });
  test.each([
    ['a non-GUID copyId', cancel({ copyId: 'nope' })],
    ['a padded copyId', cancel({ copyId: ` ${COPY}` })],
    ['a numeric copyId', cancel({ copyId: 5 })],
    ['a missing copyId', { action: 'cancel' }],
    ['an extra key', { ...cancel(), replaces: null }],
  ])('rejects %s with 400 before any service call (so before any query)', async (_l, payload) => {
    expect((await post(payload)).statusCode).toBe(400);
    noService();
  });
});

describe('shared guards', () => {
  test('rejects other methods (405) and bad request ids (400) before any service call', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) { const res = response(); await route({ method, query: { requestId }, body: start() }, res); expect(res.statusCode).toBe(405); }
    expect((await post(start(), response(), { requestId: 'nope' })).statusCode).toBe(400);
    expect((await post(start(), response(), { requestId: [requestId] })).statusCode).toBe(400);
    noService();
  });
  test('stops when the app grant is refused, and requires a linked profile', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    await route({ method: 'POST', query: { requestId }, body: start() }, response());
    requireAppAccess.mockResolvedValueOnce({ profileId: null, session: {} });
    const res = await post(start());
    expect(res.statusCode).toBe(401);
    noService();
  });
  test('service errors keep their status and body (confirmation winner included); unexpected errors are generic', async () => {
    const body = { error: 'confirm', code: 'zoom_video_replace_confirmation_required', winner: { artifactId: ARTIFACT, slotVersion: 4, filename: 'a.mp4', size: 5 } };
    startZoomVideoCopy.mockRejectedValueOnce(new ServiceHttpError('confirm', { httpStatus: 409, code: body.code, body }));
    const a = await post(start());
    expect(a.statusCode).toBe(409); expect(a.body).toEqual(body);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    startZoomVideoCopy.mockRejectedValueOnce(new Error('token abc https://zoom.us/x'));
    const b = await post(start());
    expect(b.statusCode).toBe(500); expect(JSON.stringify(b.body)).not.toMatch(/token|zoom\.us/);
    cancelZoomVideoCopy.mockRejectedValueOnce(new ServiceHttpError('saving', { httpStatus: 409, code: 'zoom_video_copy_saving' }));
    expect((await post(cancel())).statusCode).toBe(409);
  });
  test('uses an 8 kb body limit and maxDuration 60', () => {
    expect(config.api.bodyParser.sizeLimit).toBe('8kb');
    expect(config.maxDuration).toBe(60);
  });
});
