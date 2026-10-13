/** @jest-environment node */
jest.mock('../../lib/utils/auth.js', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/utils/actor-ref.js', () => ({ actorRefFromSession: jest.fn(() => '77777777-7777-4777-8777-777777777777') }));
jest.mock('../../lib/services/post-presentation-materials/discussion-sentiment-service.js', () => ({
  getDiscussionSentimentStatus: jest.fn(async () => ({ state: 'not_analyzed', run: null })),
  analyzeDiscussionSentiment: jest.fn(async () => ({ run: { id: 'r' } })),
  acceptDiscussionSentiment: jest.fn(async () => ({ run: { id: 'r' } })),
  withdrawDiscussionSentiment: jest.fn(async () => ({ run: { id: 'r' } })),
}));

import { requireAppAccess } from '../../lib/utils/auth.js';
import { withDalContext } from '../../lib/dataverse/core/context.js';
import { ServiceHttpError } from '../../lib/services/service-http-error.js';
import * as service from '../../lib/services/post-presentation-materials/discussion-sentiment-service.js';
import sentiment, { config as sentimentConfig } from '../../pages/api/meeting-tracker/visits/[requestId]/discussion-sentiment.js';
import accept from '../../pages/api/meeting-tracker/visits/[requestId]/discussion-sentiment/accept.js';
import withdraw from '../../pages/api/meeting-tracker/visits/[requestId]/discussion-sentiment/withdraw.js';
import { config as summaryConfig } from '../../pages/api/meeting-tracker/visits/[requestId]/transcriptions/summary-draft.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const ACTOR = '77777777-7777-4777-8777-777777777777';
function response() {
  return { status: jest.fn(function status(value) { this.statusCode = value; return this; }),
    json: jest.fn(function json(value) { this.body = value; return this; }), setHeader: jest.fn() };
}
const call = async (handler, req) => { const res = response(); await handler({ query: { requestId }, ...req }, res); return res; };

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 9, session: { user: {} } });
});

const routes = [
  ['analyze', sentiment, 'POST', {}, service.analyzeDiscussionSentiment],
  ['read', sentiment, 'GET', undefined, service.getDiscussionSentimentStatus],
  ['accept', accept, 'POST', { runId }, service.acceptDiscussionSentiment],
  ['withdraw', withdraw, 'POST', { runId }, service.withdrawDiscussionSentiment],
];

describe.each(routes)('%s route guards', (_name, handler, method, body, serviceFn) => {
  test('no app access is refused before any service call or DAL context', async () => {
    requireAppAccess.mockImplementationOnce(async (_req, res) => { res.status(403).json({ error: 'no access' }); return null; });
    const res = await call(handler, { method, body });
    expect(res.statusCode).toBe(403);
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'meeting-tracker');
    expect(serviceFn).not.toHaveBeenCalled();
    expect(withDalContext).not.toHaveBeenCalled();
  });

  test.each(['not-a-guid', '', ['a', 'b'], undefined])('a bad requestId %p is 400 before auth', async (bad) => {
    const res = await call(handler, { method, body, query: { requestId: bad } });
    expect(res.statusCode).toBe(400);
    expect(requireAppAccess).not.toHaveBeenCalled();
    expect(serviceFn).not.toHaveBeenCalled();
  });

  test('a session without an active linked profile is 401', async () => {
    requireAppAccess.mockResolvedValueOnce({ profileId: null, session: {} });
    const res = await call(handler, { method, body });
    expect(res.statusCode).toBe(401);
    expect(serviceFn).not.toHaveBeenCalled();
  });

  test('a wrong method is 405', async () => {
    const res = await call(handler, { method: 'DELETE', body });
    expect(res.statusCode).toBe(405);
    expect(serviceFn).not.toHaveBeenCalled();
  });

  test('responses are private and run inside a DAL context', async () => {
    const res = await call(handler, { method, body });
    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(withDalContext).toHaveBeenCalledTimes(1);
  });

  test.each([
    [new ServiceHttpError('stale', { httpStatus: 409, code: 'sentiment_out_of_date', body: { error: 'stale', code: 'sentiment_out_of_date' } }), 409, 'sentiment_out_of_date'],
    [new ServiceHttpError('nope', { httpStatus: 404, code: 'sentiment_not_found' }), 404, 'sentiment_not_found'],
    [new ServiceHttpError('typed', { httpStatus: 409, code: 'sentiment_prompt_not_ready', body: { error: 'typed', code: 'sentiment_prompt_not_ready' } }), 409, 'sentiment_prompt_not_ready'],
    [Object.assign(new Error('provider detail'), { code: 'boom' }), 500, 'boom'],
  ])('service error %# maps to %i and a 5xx never leaks the message', async (error, status, code) => {
    serviceFn.mockRejectedValueOnce(error);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(handler, { method, body });
    expect(res.statusCode).toBe(status);
    expect(res.body.code).toBe(code);
    if (status >= 500) expect(JSON.stringify(res.body)).not.toContain('provider detail');
  });
});

describe('analyze', () => {
  test('passes the request, the session profile and the session Dataverse actor, and the body names no actor', async () => {
    const res = await call(sentiment, { method: 'POST', body: {} });
    expect(res.statusCode).toBe(200);
    expect(service.analyzeDiscussionSentiment).toHaveBeenCalledWith({ requestId, ownerProfileId: 9, actingUserSystemId: ACTOR });
  });

  test('a spoofed actor in the body is refused and never reaches the service', async () => {
    for (const body of [{ ownerProfileId: 1 }, { actingUserSystemId: '99999999-9999-4999-8999-999999999999' }, { profileId: 1 }]) {
      const res = await call(sentiment, { method: 'POST', body });
      expect(res.statusCode).toBe(400);
    }
    expect(service.analyzeDiscussionSentiment).not.toHaveBeenCalled();
  });

  test('a spoofed actor in the query string is ignored in favor of the session', async () => {
    await call(sentiment, { method: 'POST', body: {}, query: { requestId, ownerProfileId: '1', actingUserSystemId: '99999999-9999-4999-8999-999999999999' } });
    expect(service.analyzeDiscussionSentiment).toHaveBeenCalledWith({ requestId, ownerProfileId: 9, actingUserSystemId: ACTOR });
  });

  test('an array body is 400', async () => {
    expect((await call(sentiment, { method: 'POST', body: [] })).statusCode).toBe(400);
  });

  test('allows the same 300 s as the summary draft', () => {
    expect(sentimentConfig.maxDuration).toBe(300);
    expect(sentimentConfig.maxDuration).toBe(summaryConfig.maxDuration);
  });
});

describe('read', () => {
  test('passes the request and the session profile only', async () => {
    const res = await call(sentiment, { method: 'GET', query: { requestId, ownerProfileId: '1' } });
    expect(res.body).toEqual({ state: 'not_analyzed', run: null });
    expect(service.getDiscussionSentimentStatus).toHaveBeenCalledWith({ requestId, ownerProfileId: 9 });
  });
});

describe.each([['accept', accept, service.acceptDiscussionSentiment], ['withdraw', withdraw, service.withdrawDiscussionSentiment]])('%s', (_n, handler, serviceFn) => {
  test('passes the session profile and the run id from the body', async () => {
    await call(handler, { method: 'POST', body: { runId } });
    expect(serviceFn).toHaveBeenCalledWith({ requestId, ownerProfileId: 9, runId });
  });

  test.each([
    [{ runId: 'nope' }], [{ runId: 5 }], [{}], [{ runId, ownerProfileId: 1 }], [{ runId, profileId: 1 }], [[runId]], [null],
  ])('a bad body %j is 400 and never reaches the service', async (body) => {
    const res = await call(handler, { method: 'POST', body });
    expect(res.statusCode).toBe(400);
    expect(serviceFn).not.toHaveBeenCalled();
  });
});
