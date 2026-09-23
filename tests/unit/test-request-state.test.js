import { resolveRequestTestState } from '../../lib/services/test-requests/request-test-state.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

function reader(result) {
  return jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
}

function httpError(status) {
  return Object.assign(new Error(`dataverse failed (${status})`), { status });
}

describe('resolveRequestTestState', () => {
  test('reads only the marker and run ID for the trimmed request GUID', async () => {
    const getRequestById = reader({ wmkf_istestrequest: null, wmkf_testcreationrunid: null });
    await resolveRequestTestState(` ${REQUEST_ID} `, { getRequestById });
    expect(getRequestById).toHaveBeenCalledWith(REQUEST_ID, {
      select: ['wmkf_istestrequest', 'wmkf_testcreationrunid'],
    });
  });

  test.each([
    ['legacy null row', { wmkf_istestrequest: null, wmkf_testcreationrunid: null }, 'ordinary'],
    ['explicit false row', { wmkf_istestrequest: false, wmkf_testcreationrunid: null }, 'ordinary'],
    ['factory-created row', { wmkf_istestrequest: true, wmkf_testcreationrunid: RUN_ID }, 'synthetic'],
    ['marker without run', { wmkf_istestrequest: true, wmkf_testcreationrunid: null }, 'anomaly'],
    ['projection missing the marker', { wmkf_testcreationrunid: null }, 'unknown'],
  ])('classifies a %s', async (_label, row, kind) => {
    const state = await resolveRequestTestState(REQUEST_ID, { getRequestById: reader(row) });
    expect(state.kind).toBe(kind);
  });

  test.each([
    ['not a GUID', 'request-1', undefined, 'request_id_invalid'],
    ['missing row', REQUEST_ID, httpError(404), 'request_not_found'],
    ['unselectable field before the schema exists', REQUEST_ID, httpError(400), 'read_failed'],
    ['transport failure', REQUEST_ID, new Error('socket hang up'), 'read_failed'],
  ])('fails closed when the request is %s', async (_label, requestId, failure, reason) => {
    const getRequestById = reader(failure);
    const state = await resolveRequestTestState(requestId, { getRequestById });
    expect(state).toEqual({ kind: 'unknown', reason });
    if (reason === 'request_id_invalid') expect(getRequestById).not.toHaveBeenCalled();
  });
});
