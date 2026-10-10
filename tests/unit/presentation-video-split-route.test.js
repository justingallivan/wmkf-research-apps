/** @jest-environment node */
jest.mock('../../lib/utils/auth.js', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/utils/actor-ref.js', () => ({ actorRefFromSession: jest.fn(() => '77777777-7777-4777-8777-777777777777') }));
jest.mock('../../lib/services/meeting-tracker-recordings/presentation-video-split-service.js', () => ({
  getPresentationVideoSplits: jest.fn(async () => ({ available: true, splits: [] })),
  startPresentationVideoSplit: jest.fn(async () => ({ status: 202, body: { split: { id: 's', state: 'queued' } } })),
}));
jest.mock('../../lib/services/meeting-tracker-recordings/presentation-video-approval-service.js', () => ({
  approvePresentationVideoSplit: jest.fn(async () => ({ status: 200, body: { split: { id: 's', state: 'approved' } } })),
}));

import { requireAppAccess } from '../../lib/utils/auth.js';
import { withDalContext } from '../../lib/dataverse/core/context.js';
import { actorRefFromSession } from '../../lib/utils/actor-ref.js';
import { ServiceHttpError } from '../../lib/services/service-http-error.js';
import { getPresentationVideoSplits, startPresentationVideoSplit } from '../../lib/services/meeting-tracker-recordings/presentation-video-split-service.js';
import { approvePresentationVideoSplit } from '../../lib/services/meeting-tracker-recordings/presentation-video-approval-service.js';
import route, { config } from '../../pages/api/meeting-tracker/visits/[requestId]/presentation-video-splits.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const ACTOR = '77777777-7777-4777-8777-777777777777';
function response() {
  return { status: jest.fn(function status(v) { this.statusCode = v; return this; }), json: jest.fn(function json(v) { this.body = v; return this; }), setHeader: jest.fn() };
}
const post = (body, res = response(), query = { requestId }) => route({ method: 'POST', query, body }, res).then(() => res);
const noService = () => [getPresentationVideoSplits, startPresentationVideoSplit, approvePresentationVideoSplit].forEach(fn => expect(fn).not.toHaveBeenCalled());
beforeEach(() => { jest.clearAllMocks(); requireAppAccess.mockResolvedValue({ profileId: 9, session: { user: {} } }); });

describe('GET', () => {
  test('checks the app grant, is private/no-store and runs in a DAL context', async () => {
    const res = response();
    await route({ method: 'GET', query: { requestId } }, res);
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'meeting-tracker');
    expect(withDalContext).toHaveBeenCalledWith('meeting-tracker-presentation-video-splits', expect.any(Function));
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(getPresentationVideoSplits).toHaveBeenCalledWith({ requestId });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ available: true, splits: [] });
  });
  test('rejects extra query keys, array ids and bad GUIDs before the service', async () => {
    for (const query of [{ requestId, days: '3' }, { requestId: [requestId] }, { requestId: 'nope' }]) {
      const res = response(); await route({ method: 'GET', query }, res); expect(res.statusCode).toBe(400);
    }
    noService();
  });
});

describe('POST start', () => {
  test('passes the session actor and profile only', async () => {
    const res = await post({ action: 'start' });
    expect(actorRefFromSession).toHaveBeenCalled();
    expect(startPresentationVideoSplit).toHaveBeenCalledWith({ requestId, actorProfileId: 9, actingUserSystemId: ACTOR });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ split: { id: 's', state: 'queued' } });
  });
  test.each([
    ['an extra key', { action: 'start', actorProfileId: 1 }],
    ['an extra id key', { action: 'start', requestId }],
    ['an unknown action', { action: 'cancel' }],
    ['no action', {}],
    ['an array body', []],
    ['a null body', null],
    ['a string body', 'x'],
  ])('rejects %s with 400 before any service call', async (_l, payload) => {
    expect((await post(payload)).statusCode).toBe(400);
    noService();
  });
});

describe('POST approve', () => {
  const SPLIT = '66666666-6666-4666-8666-666666666666';
  test('passes the session actor, profile and the split id only', async () => {
    const res = await post({ action: 'approve', splitId: SPLIT });
    expect(approvePresentationVideoSplit).toHaveBeenCalledWith({ requestId, actorProfileId: 9, actingUserSystemId: ACTOR, splitId: SPLIT });
    expect(startPresentationVideoSplit).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ split: { id: 's', state: 'approved' } });
  });
  test.each([
    ['no split id', { action: 'approve' }],
    ['a non-GUID split id', { action: 'approve', splitId: 'nope' }],
    ['a padded split id', { action: 'approve', splitId: ` ${SPLIT}` }],
    ['an array split id', { action: 'approve', splitId: [SPLIT] }],
    ['an extra key', { action: 'approve', splitId: SPLIT, actorProfileId: 1 }],
    ['a split id on start', { action: 'start', splitId: SPLIT }],
  ])('rejects %s with 400 before any service call', async (_l, payload) => {
    expect((await post(payload)).statusCode).toBe(400);
    noService();
  });
});

describe('shared guards', () => {
  test('rejects other methods (405) and bad request ids (400) before any service call', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) { const res = response(); await route({ method, query: { requestId }, body: { action: 'start' } }, res); expect(res.statusCode).toBe(405); }
    expect((await post({ action: 'start' }, response(), { requestId: 'nope' })).statusCode).toBe(400);
    expect((await post({ action: 'start' }, response(), { requestId: [requestId] })).statusCode).toBe(400);
    noService();
  });
  test('stops when the app grant is refused, and requires a linked profile', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    await route({ method: 'POST', query: { requestId }, body: { action: 'start' } }, response());
    requireAppAccess.mockResolvedValueOnce({ profileId: null, session: {} });
    const res = await post({ action: 'start' });
    expect(res.statusCode).toBe(401);
    noService();
  });
  test('service errors keep their status and body; unexpected errors are generic', async () => {
    const body = { error: 'busy', code: 'presentation_video_split_active' };
    startPresentationVideoSplit.mockRejectedValueOnce(new ServiceHttpError('busy', { httpStatus: 409, code: body.code, body }));
    const a = await post({ action: 'start' });
    expect(a.statusCode).toBe(409); expect(a.body).toEqual(body);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    startPresentationVideoSplit.mockRejectedValueOnce(new Error('token abc https://zoom.us/x'));
    const b = await post({ action: 'start' });
    expect(b.statusCode).toBe(500); expect(JSON.stringify(b.body)).not.toMatch(/token|zoom\.us/);
  });
  test('uses an 8 kb body limit and maxDuration 120', () => {
    expect(config.api.bodyParser.sizeLimit).toBe('8kb');
    expect(config.maxDuration).toBe(120);
  });
});
