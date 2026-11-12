/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { updateRecord } from '../../lib/services/dynamics/write-core.js';
import { withDalContext } from '../../lib/dataverse/core/context.js';
import { createRequestFieldDelivery, TITLE_DESTINATION as FIELD } from '../../lib/services/prompt-jobs/request-field-delivery.js';
import { canonical, sha256 } from '../../lib/services/prompt-jobs/profile.js';

const id = randomUUID();
const requestId = randomUUID();
const operationId = randomUUID();
const job = () => ({ id, request_id: requestId, operation: 'initialize', environment: 'test',
  principal_key: 'app:fixture', authorization_scope: 'pa:fixture', target_etag: 'W/"123"' });
const tasks = [{ task_key: 'preflight.short-title', destination_field: FIELD }];
function setup(value = null) {
  const authorize = jest.fn(async () => true);
  const readRequest = jest.fn(async () => ({ _etag: 'W/"123"', [FIELD]: value }));
  const patchRequest = jest.fn(async () => undefined);
  const delivery = createRequestFieldDelivery({ authorize, readRequest, patchRequest });
  return { authorize, readRequest, patchRequest, delivery };
}
const write = (overrides = {}) => ({ job: job(), operationId, expectedEtag: 'W/"123"', fields: { [FIELD]: 'To explore cell signaling' }, ...overrides });

describe('conditional Request field delivery, unbound transport', () => {
  test.each([null, '', ' ', '\n', 'Staff edited content'])('captures exact baseline for %j', async value => {
    const { delivery, authorize, readRequest, patchRequest } = setup(value);
    expect(await delivery.readTarget({ job: job(), tasks })).toEqual({ etag: 'W/"123"', fields: {
      [FIELD]: { blank: value === null || value === '', sha256: sha256(canonical(value)) },
    } });
    expect(readRequest).toHaveBeenCalledWith(requestId, { select: FIELD });
    expect(authorize.mock.calls.map(([phase]) => phase)).toEqual(['preGET', 'postGET']);
    expect(patchRequest).not.toHaveBeenCalled();
  });
  test('null and empty baselines have distinct stable hashes', async () => {
    const a = await setup(null).delivery.readTarget({ job: job(), tasks });
    const b = await setup('').delivery.readTarget({ job: job(), tasks });
    expect(a.fields[FIELD].sha256).not.toBe(b.fields[FIELD].sha256);
  });
  test.each([undefined, '*', 'W/"12"\r\n', 'W/12', ''])('missing/wildcard/malformed ETag rejects before write: %j', async expectedEtag => {
    const s = setup();
    await expect(s.delivery.writer(write({ expectedEtag }))).rejects.toMatchObject({ code: 'invalid_field_delivery' });
    expect(s.patchRequest).not.toHaveBeenCalled();
  });
  test.each([{}, { [FIELD]: undefined }, { [FIELD]: 7 }, { _etag: 'W/"123"' }])('incomplete or invalid read projection fails closed', async row => {
    const s = setup(); s.readRequest.mockResolvedValue(row);
    await expect(s.delivery.readTarget({ job: job(), tasks })).rejects.toMatchObject({ httpStatus: 503 });
    expect(s.patchRequest).not.toHaveBeenCalled();
  });
  test.each([null, [], {}, { [FIELD]: '' }, { [FIELD]: ' ' }, { [FIELD]: 4 }, { [FIELD]: 'a'.repeat(2001) },
    { [FIELD]: 'To explore', ownerid: randomUUID() }, { wmkf_ai_summary: 'Unapproved field' }].map(fields => ({ fields })))('invalid/extra fields never reach transport', async ({ fields }) => {
    const s = setup();
    await expect(s.delivery.writer(write({ fields }))).rejects.toMatchObject({ code: 'invalid_field_delivery' });
    expect(s.patchRequest).not.toHaveBeenCalled();
  });
  test('canonical IDs and byte-exact values use original ETag in one PATCH', async () => {
    const s = setup(); const j = { ...job(), id: id.toUpperCase(), request_id: requestId.toUpperCase() };
    const value = '  To explore cell signaling\n';
    expect(await s.delivery.writer(write({ job: j, operationId: operationId.toUpperCase(), fields: { [FIELD]: value } }))).toBe('applied');
    expect(s.patchRequest).toHaveBeenCalledTimes(1);
    expect(s.patchRequest).toHaveBeenCalledWith(requestId, { [FIELD]: value }, { ifMatch: 'W/"123"', noFallback: true });
    expect(s.authorize.mock.calls[0]).toEqual(['prePATCH', { jobId: id, requestId, environment: 'test', principalKey: 'app:fixture',
      authorizationScope: 'pa:fixture', operationId, fields: [FIELD] }]);
    expect(s.readRequest).not.toHaveBeenCalled();
  });
  test.each([412, 401, 403, 404, 429, 500, undefined])('transport status %j never retries or refreshes ETag', async status => {
    const s = setup(); s.patchRequest.mockRejectedValue(Object.assign(new Error('private diagnostic'), { status }));
    expect(await s.delivery.writer(write())).toBe(status === 412 ? 'conflict' : 'unknown');
    expect(s.patchRequest).toHaveBeenCalledTimes(1);
    expect(s.readRequest).not.toHaveBeenCalled();
  });
  test('mismatched frozen baseline denies before PATCH', async () => {
    const s = setup();
    await expect(s.delivery.writer(write({ job: { ...job(), target_etag: 'W/"124"' } }))).rejects.toMatchObject({ code: 'invalid_field_delivery' });
    expect(s.patchRequest).not.toHaveBeenCalled();
  });
  test.each(['preGET', 'postGET', 'prePATCH'])('current authorization denial at %s prevents protected result/action', async blockedPhase => {
    const s = setup(); s.authorize.mockImplementation(async phase => phase !== blockedPhase);
    const action = blockedPhase === 'prePATCH' ? s.delivery.writer(write()) : s.delivery.readTarget({ job: job(), tasks });
    await expect(action).rejects.toMatchObject({ httpStatus: 403, code: 'field_delivery_denied' });
    expect(s.patchRequest).not.toHaveBeenCalled();
    expect(s.readRequest).toHaveBeenCalledTimes(blockedPhase === 'postGET' ? 1 : 0);
  });
  test('mutable caller objects cannot change authorized command during await', async () => {
    const s = setup(); const args = write(); const capturedJob = args.job;
    s.authorize.mockImplementation(async (_phase, snapshot) => {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.fields)).toBe(true);
      capturedJob.request_id = randomUUID(); capturedJob.target_etag = 'W/"999"';
      args.fields[FIELD] = 'Changed'; args.expectedEtag = 'W/"999"';
      return true;
    });
    expect(await s.delivery.writer(args)).toBe('applied');
    expect(s.patchRequest).toHaveBeenCalledWith(requestId, { [FIELD]: 'To explore cell signaling' }, { ifMatch: 'W/"123"', noFallback: true });
  });
  test('read observation copied before postGET await', async () => {
    const s = setup('Staff text'); const row = { _etag: 'W/"123"', [FIELD]: 'Staff text' };
    s.readRequest.mockResolvedValue(row);
    s.authorize.mockImplementation(async phase => { if (phase === 'postGET') { row[FIELD] = ''; row._etag = 'W/"999"'; } return true; });
    const result = await s.delivery.readTarget({ job: job(), tasks });
    expect(result).toEqual({ etag: 'W/"123"', fields: { [FIELD]: { blank: false, sha256: sha256(canonical('Staff text')) } } });
  });
  test.each([[], [{ ...tasks[0], destination_field: 'ownerid' }], [{ ...tasks[0], task_key: 'proposal.executive-summary' }], [...tasks, ...tasks]].map(badTasks => ({ badTasks })))('unapproved task mapping rejected', async ({ badTasks }) => {
    const s = setup();
    await expect(s.delivery.readTarget({ job: job(), tasks: badTasks })).rejects.toMatchObject({ code: 'invalid_field_delivery' });
    expect(s.readRequest).not.toHaveBeenCalled();
  });
  test.each([{ operation: 'generate-draft' }, { request_id: 'bad' }, { id: 'bad' }, { principal_key: '' }])('invalid job never reaches adapters', async change => {
    const s = setup();
    await expect(s.delivery.writer(write({ job: { ...job(), ...change } }))).rejects.toMatchObject({ code: 'invalid_field_delivery' });
    expect(s.patchRequest).not.toHaveBeenCalled();
  });
  test('unavailable authorization and GET hide diagnostics', async () => {
    const s = setup(); s.authorize.mockRejectedValue(new Error('private auth details'));
    await expect(s.delivery.writer(write())).rejects.toMatchObject({ httpStatus: 503, message: 'field_delivery_unavailable' });
    s.authorize.mockResolvedValue(true); s.readRequest.mockRejectedValue(new Error('private row details'));
    await expect(s.delivery.readTarget({ job: job(), tasks })).rejects.toMatchObject({ httpStatus: 503, message: 'field_delivery_unavailable' });
  });
});

// Real Dynamics write-core serialization, with only the physical HTTP seam
// replaced. This proves options survive beyond a mocked adapter function.

test('real Dataverse write-core carries exact If-Match and noFallback to one physical seam', async () => {
  const physical = jest.fn(async () => ({ ok: true, status: 204 }));
  const svc = { baseUrl: 'https://fixture.invalid/api/data/v9.2', getAccessToken: async () => 'offline-fixture',
    buildHeaders: () => ({ 'Content-Type': 'application/json' }), _withCallerId: headers => headers, _writeFetch: physical };
  const delivery = createRequestFieldDelivery({ authorize: async () => true, readRequest: async () => { throw Error('unexpected GET'); },
    patchRequest: (request, fields, options) => updateRecord(svc, 'akoya_requests', request, fields, options) });
  expect(await withDalContext('offline-field-delivery-test', () => delivery.writer(write()))).toBe('applied');
  expect(physical).toHaveBeenCalledTimes(1);
  expect(physical).toHaveBeenCalledWith(`https://fixture.invalid/api/data/v9.2/akoya_requests(${requestId})`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': 'W/"123"' },
    body: JSON.stringify({ [FIELD]: 'To explore cell signaling' }),
  }, undefined, { noFallback: true });
});

test.each([412, 500])('real write-core HTTP %i maps to one safe outcome', async status => {
  const physical = jest.fn(async () => ({ ok: false, status, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: 'private transport detail' } }) }));
  const svc = { baseUrl: 'https://fixture.invalid/api/data/v9.2', getAccessToken: async () => 'offline-fixture',
    buildHeaders: () => ({}), _withCallerId: headers => headers, _writeFetch: physical };
  const delivery = createRequestFieldDelivery({ authorize: async () => true, readRequest: async () => { throw Error('unexpected GET'); },
    patchRequest: (request, fields, options) => updateRecord(svc, 'akoya_requests', request, fields, options) });
  expect(await withDalContext('offline-field-error-test', () => delivery.writer(write()))).toBe(status === 412 ? 'conflict' : 'unknown');
  expect(physical).toHaveBeenCalledTimes(1);
  expect(physical.mock.calls[0][1].headers['If-Match']).toBe('W/"123"');
  expect(physical.mock.calls[0][3]).toEqual({ noFallback: true });
});
