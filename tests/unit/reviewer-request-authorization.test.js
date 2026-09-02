/** @jest-environment node */

const getUserRole = jest.fn();
jest.mock('../../lib/utils/auth', () => ({ getUserRole: (...args) => getUserRole(...args) }));

const findByIds = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  findByIds: (...args) => findByIds(...args),
}));

const queryAllSuggestions = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion.js', () => ({
  queryAllSuggestions: (...args) => queryAllSuggestions(...args),
}));

import { authorizeReviewerRequestMutation } from '../../lib/services/reviewer-request-authorization';

const REQUEST_A = '11111111-1111-4111-8111-111111111111';
const REQUEST_B = '22222222-2222-4222-8222-222222222222';
const REQUEST_CASE = 'abcdef12-abcd-4abc-8abc-abcdefabcdef';
const SUGGESTION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUGGESTION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  jest.clearAllMocks();
  getUserRole.mockResolvedValue('read_write');
  queryAllSuggestions.mockResolvedValue({ records: [], capped: false });
  findByIds.mockImplementation(async (ids) => ({
    records: ids.map((id) => ({ akoya_requestid: id, _wmkf_programdirector_value: 'pd-1' })),
  }));
});

test('authorizes a lead PD case-insensitively using server-resolved suggestion ownership', async () => {
  queryAllSuggestions.mockResolvedValue({
    records: [{ wmkf_appreviewersuggestionid: SUGGESTION_A.toUpperCase(), _wmkf_request_value: REQUEST_A }],
    capped: false,
  });
  await expect(authorizeReviewerRequestMutation({
    profileId: 7,
    callerSystemId: 'PD-1',
    suggestionIds: [SUGGESTION_A],
  })).resolves.toEqual({ requestIds: [REQUEST_A], isSuperuser: false });
});

test('superuser override does not require a linked Dynamics actor', async () => {
  getUserRole.mockResolvedValue('superuser');
  findByIds.mockResolvedValue({
    records: [{ akoya_requestid: REQUEST_A, _wmkf_programdirector_value: 'someone-else' }],
  });
  await expect(authorizeReviewerRequestMutation({
    profileId: 1,
    callerSystemId: null,
    requestIds: [REQUEST_A],
  })).resolves.toMatchObject({ isSuperuser: true });
});

test.each([
  ['foreign request', 'pd-2'],
  ['missing caller actor', null],
])('fails closed for a non-superuser with %s', async (_label, callerSystemId) => {
  await expect(authorizeReviewerRequestMutation({
    profileId: 7,
    callerSystemId,
    requestIds: [REQUEST_A],
  })).rejects.toMatchObject({ httpStatus: 403 });
});

test('fails closed for a request with no lead PD', async () => {
  findByIds.mockResolvedValue({
    records: [{ akoya_requestid: REQUEST_A, _wmkf_programdirector_value: null }],
  });
  await expect(authorizeReviewerRequestMutation({
    profileId: 7,
    callerSystemId: 'pd-1',
    requestIds: [REQUEST_A],
  })).rejects.toMatchObject({ httpStatus: 403 });
});

test('deduplicates repeated targets before authorization reads', async () => {
  await expect(authorizeReviewerRequestMutation({
    profileId: 7,
    callerSystemId: 'pd-1',
    requestIds: [REQUEST_CASE, REQUEST_CASE.toUpperCase()],
  })).resolves.toEqual({ requestIds: [REQUEST_CASE], isSuperuser: false });
  expect(findByIds).toHaveBeenCalledWith([REQUEST_CASE], expect.any(Object));
});

test('preauthorizes every request in a batch and rejects when any target is foreign', async () => {
  queryAllSuggestions.mockResolvedValue({
    records: [
      { wmkf_appreviewersuggestionid: SUGGESTION_A, _wmkf_request_value: REQUEST_A },
      { wmkf_appreviewersuggestionid: SUGGESTION_B, _wmkf_request_value: REQUEST_B },
    ],
    capped: false,
  });
  findByIds.mockResolvedValue({
    records: [
      { akoya_requestid: REQUEST_A, _wmkf_programdirector_value: 'pd-1' },
      { akoya_requestid: REQUEST_B, _wmkf_programdirector_value: 'pd-2' },
    ],
  });
  await expect(authorizeReviewerRequestMutation({
    profileId: 7,
    callerSystemId: 'pd-1',
    suggestionIds: [SUGGESTION_A, SUGGESTION_B],
  })).rejects.toMatchObject({ httpStatus: 403 });
});

test('fails closed when a suggestion or request is missing, or the suggestion scan is capped', async () => {
  await expect(authorizeReviewerRequestMutation({
    profileId: 7,
    callerSystemId: 'pd-1',
    suggestionIds: [SUGGESTION_A],
  })).rejects.toMatchObject({ httpStatus: 404 });

  findByIds.mockResolvedValue({ records: [] });
  await expect(authorizeReviewerRequestMutation({
    profileId: 7,
    callerSystemId: 'pd-1',
    requestIds: [REQUEST_A],
  })).rejects.toMatchObject({ httpStatus: 404 });

  queryAllSuggestions.mockResolvedValue({ records: [], capped: true });
  await expect(authorizeReviewerRequestMutation({
    profileId: 7,
    callerSystemId: 'pd-1',
    suggestionIds: [SUGGESTION_A],
  })).rejects.toMatchObject({ httpStatus: 503 });
});

test('maps ownership adapter failures to sanitized 502 responses', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  queryAllSuggestions.mockRejectedValueOnce(new Error('Dataverse suggestion read failed'));
  await expect(authorizeReviewerRequestMutation({
    profileId: 7,
    callerSystemId: 'pd-1',
    suggestionIds: [SUGGESTION_A],
  })).rejects.toMatchObject({
    httpStatus: 502,
    message: 'Reviewer ownership could not be verified.',
  });

  findByIds.mockRejectedValueOnce(new Error('Dataverse request read failed'));
  await expect(authorizeReviewerRequestMutation({
    profileId: 7,
    callerSystemId: 'pd-1',
    requestIds: [REQUEST_A],
  })).rejects.toMatchObject({
    httpStatus: 502,
    message: 'Request ownership could not be verified.',
  });
  expect(errorSpy).toHaveBeenCalledTimes(2);
  errorSpy.mockRestore();
});
