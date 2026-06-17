/**
 * @jest-environment node
 *
 * /api/workbench/promote-applicant-reviewer — explicit PD promotion for an
 * applicant-recommended suggestion row.
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 7, session: { user: { dynamicsSystemuserId: 'u-1' } } })),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

const findById = jest.fn();
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000, excluded: 100000001 },
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
}));

import handler from '../../pages/api/workbench/promote-applicant-reviewer';
import { requireAppAccess } from '../../lib/utils/auth';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_REQUEST_ID = '22222222-2222-2222-2222-222222222222';
const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';

function res() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function post(body) {
  return { method: 'POST', body };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: { dynamicsSystemuserId: 'u-1' } } });
  findById.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_applicantdisposition: 100000000,
  });
});

it('405s on non-POST', async () => {
  const r = res();
  await handler({ method: 'GET' }, r);
  expect(r.statusCode).toBe(405);
  expect(r.headers.Allow).toBe('POST');
});

it('400s on non-GUID ids before any Dataverse selector', async () => {
  const r = res();
  await handler(post({ requestId: 'not-a-guid', suggestionId: SUGGESTION_ID }), r);
  expect(r.statusCode).toBe(400);
  expect(findById).not.toHaveBeenCalled();
  expect(updateLifecycle).not.toHaveBeenCalled();
});

it('404s when the suggestion does not belong to the request', async () => {
  findById.mockResolvedValueOnce({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: OTHER_REQUEST_ID,
    wmkf_applicantdisposition: 100000000,
  });

  const r = res();
  await handler(post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID }), r);

  expect(r.statusCode).toBe(404);
  expect(updateLifecycle).not.toHaveBeenCalled();
});

it('400s when the row is not applicant-recommended', async () => {
  findById.mockResolvedValueOnce({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_applicantdisposition: null,
  });

  const r = res();
  await handler(post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID }), r);

  expect(r.statusCode).toBe(400);
  expect(updateLifecycle).not.toHaveBeenCalled();
});

it('400s when the adapter refuses an applicant-excluded row', async () => {
  findById.mockRejectedValueOnce(new Error('reviewer-suggestion.findById: refusing to act on an applicant-excluded suggestion'));

  const r = res();
  await handler(post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID }), r);

  expect(r.statusCode).toBe(400);
  expect(updateLifecycle).not.toHaveBeenCalled();
});

it('selects the existing applicant-recommended row', async () => {
  const r = res();
  await handler(post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID }), r);

  expect(r.statusCode).toBe(200);
  expect(r.body).toEqual({ success: true, suggestionId: SUGGESTION_ID });
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION_ID,
    { selected: true },
    { actingUserSystemId: 'u-1' },
  );
});
