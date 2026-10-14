import { createPrivateSaveQueue } from '../../shared/components/proposal-ranking/private-save-queue';
import { requestEnvelope } from '../../shared/utils/api-request';
jest.mock('../../shared/utils/api-request', () => ({ requestEnvelope: jest.fn() }));
const clone = value => JSON.parse(JSON.stringify(value));
const base = () => ({
  roundId: 'r', viewer: { systemUserId: 'alice' }, round: { state: 'active', etag: '1', policyRevision: 1 },
  workflow: { stage: 'private', preparationVersion: 1, revealId: null },
  own: { mr: { order: ['a', 'b'], boundaries: [1, 2], confidence: {}, version: 1 },
    se: { order: [], boundaries: [0, 0], confidence: {}, version: 1 }, co: null, ready: null },
});
function success(view, body) {
  const next = clone(view);
  next.round.etag = String(Number(view.round.etag) + 1);
  next.own[body.programKey] = { ...next.own[body.programKey], ...body.assessment, version: body.listVersion + 1 };
  if (next.own.co) next.own.co.confirmed = false;
  next.operation = { status: 'confirmed', operationId: body.operationId };
  return next;
}
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const choose = value => current => ({ ...current, confidence: { ...current.confidence, a: value } });
function setup(options = {}) {
  let state;
  const onView = jest.fn(), onAuthLost = jest.fn();
  const queue = createPrivateSaveQueue({ onChange: next => { state = next; }, onView, onAuthLost, ...options });
  return { queue, onView, onAuthLost, state: () => state };
}
beforeEach(() => jest.resetAllMocks());

test('real transport rebases peer conflict, uncertain replay uses final ID, then drains newest draft', async () => {
  const initial = base(), peer = base(); peer.round.etag = '2';
  let finalBody;
  requestEnvelope.mockResolvedValueOnce({ ok: false, status: 409, data: { error: { code: 'conflict' } } })
    .mockResolvedValueOnce({ ok: true, data: peer })
    .mockImplementationOnce(async (_, { body }) => { finalBody = clone(body); throw new Error('lost response'); });
  const h = setup();
  h.queue.edit(initial, 'mr', choose('confident'));
  h.queue.edit(initial, 'mr', choose('not-sure'));
  await tick();
  expect(h.state().blocked.kind).toBe('uncertain');
  const acknowledged = success(peer, finalBody);
  requestEnvelope.mockResolvedValueOnce({ ok: true, data: acknowledged })
    .mockImplementationOnce(async (_, { body }) => ({ ok: true, data: success(acknowledged, body) }));
  h.queue.retry(); await tick();
  expect(requestEnvelope.mock.calls[3][1].body).toEqual(finalBody);
  expect(requestEnvelope.mock.calls[4][1].body.assessment.confidence.a).toBe('not-sure');
  expect(h.queue.isDirty()).toBe(false);
});

test.each(['same-pd', 'stage', 'actor', 'receipt'])('confirmed readback blocks queued overwrite after %s changes', async kind => {
  let resolve, body;
  const h = setup({ send: request => { body = request; return new Promise(r => { resolve = r; }); } });
  const initial = base();
  h.queue.edit(initial, 'mr', choose('confident'));
  h.queue.edit(initial, 'mr', choose('not-sure'));
  const next = success(initial, body);
  if (kind === 'same-pd') next.own.se.version++;
  if (kind === 'stage') next.workflow.stage = 'revealed';
  if (kind === 'actor') next.viewer.systemUserId = 'bob';
  if (kind === 'receipt') next.operation.operationId = 'different';
  resolve(next); await tick();
  expect(h.state().blocked.kind).toBe(kind === 'receipt' ? 'uncertain' : 'changed');
  expect(h.state().draft.confidence.a).toBe('not-sure');
  expect(h.onView).not.toHaveBeenCalled();
});

test('timeout preserves final attempted request and ignores late completion', async () => {
  jest.useFakeTimers();
  let resolve;
  const send = jest.fn((body, { onAttempt }) => { onAttempt({ ...body, operationId: 'final' }); return new Promise(r => { resolve = r; }); });
  const h = setup({ send, timeoutMs: 100 });
  h.queue.edit(base(), 'mr', choose('confident'));
  await jest.advanceTimersByTimeAsync(101);
  expect(h.state().blocked.kind).toBe('uncertain');
  send.mockImplementationOnce(async body => success(base(), body));
  h.queue.retry(); await tick();
  expect(send.mock.calls[1][0].operationId).toBe('final');
  resolve(success(base(), send.mock.calls[0][0])); await tick();
  expect(h.onView).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test.each([401, 403])('auth loss %s clears local preparation', async status => {
  const h = setup({ send: async () => { throw Object.assign(new Error('denied'), { status }); } });
  h.queue.edit(base(), 'mr', choose('confident')); await tick();
  expect(h.state().draft).toBeNull(); expect(h.onAuthLost).toHaveBeenCalledTimes(1);
});

test('definite rejection reloads only unchanged own state before fresh operation', async () => {
  const initial = base(); const peer = base(); peer.round.etag = '8';
  const send = jest.fn().mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409, code: 'conflict', requestMethod: 'POST' }))
    .mockImplementationOnce(async body => success(peer, body));
  const h = setup({ send, load: async () => peer });
  h.queue.edit(initial, 'mr', choose('confident')); await tick();
  expect(h.state().blocked.kind).toBe('rejected');
  h.queue.retry(); await tick();
  expect(send.mock.calls[1][0].roundEtag).toBe('8');
  expect(send.mock.calls[1][0].operationId).not.toBe(send.mock.calls[0][0].operationId);
  expect(h.queue.isDirty()).toBe(false);
});

test('disposed queue ignores response callbacks', async () => {
  let resolve, body;
  const h = setup({ send: request => { body = request; return new Promise(r => { resolve = r; }); } });
  h.queue.edit(base(), 'mr', choose('confident')); h.queue.dispose();
  resolve(success(base(), body)); await tick();
  expect(h.onView).not.toHaveBeenCalled();
});

test('recovery GET failure stays uncertain and does not permit a new operation', async () => {
  requestEnvelope.mockResolvedValueOnce({ ok: false, status: 409, data: { error: { code: 'conflict' } } })
    .mockResolvedValueOnce({ ok: false, status: 503, data: { error: { code: 'dependency_unavailable' } } });
  const h = setup(); h.queue.edit(base(), 'mr', choose('confident')); await tick();
  expect(h.state().blocked.kind).toBe('uncertain');
  h.queue.discard(); await tick(); expect(h.queue.isDirty()).toBe(true);
  const original = requestEnvelope.mock.calls[0][1].body;
  requestEnvelope.mockImplementationOnce(async (_, { body }) => ({ ok: true, data: success(base(), body) }));
  h.queue.retry(); await tick(); expect(requestEnvelope.mock.calls[2][1].body).toEqual(original);
});

test('ready/reveal changes during rejected retry never create a fresh save', async () => {
  const next = base(); next.own.ready = { at: 'now' }; next.workflow.stage = 'revealed';
  const send = jest.fn().mockRejectedValue(Object.assign(new Error('conflict'), { status: 409, code: 'conflict', requestMethod: 'POST' }));
  const h = setup({ send, load: async () => next });
  h.queue.edit(base(), 'mr', choose('confident')); await tick(); h.queue.retry(); await tick();
  expect(h.state().blocked.kind).toBe('changed'); expect(send).toHaveBeenCalledTimes(1);
  h.queue.discard(); await tick(); expect(h.onView).toHaveBeenCalledWith(next); expect(h.queue.isDirty()).toBe(false);
});

test('no-op and unchanged latest draft do not increment versions again', async () => {
  let resolve, body;
  const send = jest.fn(request => { body = request; return new Promise(r => { resolve = r; }); });
  const h = setup({ send }); const initial = base();
  h.queue.edit(initial, 'mr', current => clone(current)); expect(send).not.toHaveBeenCalled();
  h.queue.edit(initial, 'mr', choose('confident'));
  h.queue.edit(initial, 'mr', choose('not-sure'));
  h.queue.edit(initial, 'mr', choose('confident'));
  resolve(success(initial, body)); await tick();
  expect(send).toHaveBeenCalledTimes(1); expect(h.queue.isDirty()).toBe(false);
});

test('combined save preserves source versions and clears confirmation, ignoring mirrored ready', async () => {
  const initial = base(); initial.own.co = { ...clone(initial.own.mr), sourceVersions: { mr: 1, se: 1 }, confirmed: true, ready: null };
  const h = setup({ send: async body => { const next = success(initial, body); delete next.own.co.ready; return next; } });
  h.queue.edit(initial, 'co', choose('confident')); await tick();
  expect(h.queue.isDirty()).toBe(false);
  expect(h.onView.mock.calls[0][0].own.co).toMatchObject({ confirmed: false, version: 2, sourceVersions: { mr: 1, se: 1 } });
});

test('operation identifier reuse blocks retry and discard', async () => {
  const send = jest.fn().mockRejectedValue(Object.assign(new Error('ID reused'), { code: 'operation_id_reused' }));
  const h = setup({ send }); h.queue.edit(base(), 'mr', choose('confident')); await tick();
  expect(h.state().blocked.kind).toBe('integrity'); h.queue.retry(); h.queue.discard(); await tick();
  expect(send).toHaveBeenCalledTimes(1); expect(h.queue.isDirty()).toBe(true);
});
