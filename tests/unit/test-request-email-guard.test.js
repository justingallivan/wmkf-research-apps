/**
 * Test Request email refusal (Stage 1b): the shared delivery seam in
 * DynamicsService.createEmailActivity and the early service-level refusal
 * helper. Both are inactive unless TEST_REQUEST_ISOLATION=on.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import { assertRequestEmailAllowed } from '../../lib/services/test-requests/request-test-state.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

function ctx(fn) {
  return () => bypassDynamicsRestrictions('test:test-request-email-guard', fn);
}

const EMAIL = {
  subject: 'Invitation',
  body: '<p>Hello</p>',
  from: 'pd@example.org',
  to: 'reviewer@example.org',
  regardingId: REQUEST_ID,
  regardingType: 'akoya_request',
};

let getRecord;
let writeFetch;

beforeAll(() => {
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
});

beforeEach(() => {
  delete process.env.TEST_REQUEST_ISOLATION;
  getRecord = jest.spyOn(DynamicsService, 'getRecord');
  jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('tok');
  jest.spyOn(DynamicsService, 'resolveSystemUser').mockResolvedValue('33333333-3333-4333-8333-333333333333');
  jest.spyOn(DynamicsService, 'resolveEntitySetName').mockResolvedValue('akoya_requests');
  writeFetch = jest.spyOn(DynamicsService, '_writeFetch').mockResolvedValue({
    ok: true,
    json: async () => ({ activityid: 'email-1' }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.TEST_REQUEST_ISOLATION;
});

describe('createEmailActivity delivery seam', () => {
  test('does nothing extra while the switch is off', ctx(async () => {
    await DynamicsService.createEmailActivity(EMAIL);
    expect(getRecord).not.toHaveBeenCalled();
    expect(writeFetch).toHaveBeenCalledTimes(1);
  }));

  test('sends email about a verified ordinary (legacy-null) request', ctx(async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    getRecord.mockResolvedValue({ wmkf_istestrequest: null, wmkf_testcreationrunid: null });
    await expect(DynamicsService.createEmailActivity(EMAIL)).resolves.toBe('email-1');
    expect(getRecord).toHaveBeenCalledWith('akoya_requests', REQUEST_ID, {
      select: 'wmkf_istestrequest,wmkf_testcreationrunid',
    });
    expect(writeFetch).toHaveBeenCalledTimes(1);
  }));

  test.each([
    ['a test request', async () => ({ wmkf_istestrequest: true, wmkf_testcreationrunid: RUN_ID })],
    ['an anomalous marker', async () => ({ wmkf_istestrequest: true, wmkf_testcreationrunid: null })],
    ['an unreadable marker (column missing before the schema apply)', async () => {
      throw Object.assign(new Error('Could not find a property named wmkf_istestrequest'), { status: 400 });
    }],
  ])('refuses email about %s before any write', (_label, read) => ctx(async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    getRecord.mockImplementation(read);
    await expect(DynamicsService.createEmailActivity(EMAIL))
      .rejects.toMatchObject({ code: 'test_request_email_denied' });
    expect(writeFetch).not.toHaveBeenCalled();
  })());

  test('createAndSendEmail reports a refusal as not dispatched', ctx(async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    getRecord.mockResolvedValue({ wmkf_istestrequest: true, wmkf_testcreationrunid: RUN_ID });
    const send = jest.spyOn(DynamicsService, 'sendEmail');
    await expect(DynamicsService.createAndSendEmail(EMAIL))
      .rejects.toMatchObject({ code: 'test_request_email_denied', dispatched: false });
    expect(send).not.toHaveBeenCalled();
  }));

  test('leaves email that is not about a request unchanged', ctx(async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    await DynamicsService.createEmailActivity({ ...EMAIL, regardingId: undefined, regardingType: undefined });
    expect(getRecord).not.toHaveBeenCalled();
    expect(writeFetch).toHaveBeenCalledTimes(1);
  }));

  test('only the literal value "on" enables the switch', ctx(async () => {
    process.env.TEST_REQUEST_ISOLATION = 'true';
    await DynamicsService.createEmailActivity(EMAIL);
    expect(getRecord).not.toHaveBeenCalled();
  }));
});

describe('assertRequestEmailAllowed', () => {
  const on = { TEST_REQUEST_ISOLATION: 'on' };

  test('is inactive while the switch is off', async () => {
    const resolve = jest.fn();
    await expect(assertRequestEmailAllowed(REQUEST_ID, { resolve, env: {} })).resolves.toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  test('allows a verified ordinary request', async () => {
    const resolve = jest.fn(async () => ({ kind: 'ordinary', reason: 'marker_null_and_run_null' }));
    await expect(assertRequestEmailAllowed(REQUEST_ID, { resolve, env: on })).resolves.toBeUndefined();
    expect(resolve).toHaveBeenCalledWith(REQUEST_ID);
  });

  test.each([
    ['synthetic', 'Email is disabled for test requests.'],
    ['anomaly', 'Email is disabled for test requests.'],
    ['unknown', 'Email was not sent: the request could not be confirmed as an ordinary request. Try again.'],
  ])('refuses a %s request with a 409', async (kind, message) => {
    const resolve = jest.fn(async () => ({ kind, reason: 'x' }));
    await expect(assertRequestEmailAllowed(REQUEST_ID, { resolve, env: on }))
      .rejects.toMatchObject({ httpStatus: 409, code: 'test_request_email_denied', message });
  });
});
