/** @jest-environment node */

const getForAcceptanceDrain = jest.fn();
const withdrawLinkedHonorariumForReleasedSuggestion = jest.fn();
const getHonorariumCancellationState = jest.fn();

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion.js', () => ({
  REVIEW_STATUS_MAP: { released: 100000006 },
  getForAcceptanceDrain: (...args) => getForAcceptanceDrain(...args),
  withdrawLinkedHonorariumForReleasedSuggestion: (...args) =>
    withdrawLinkedHonorariumForReleasedSuggestion(...args),
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getHonorariumCancellationState: (...args) => getHonorariumCancellationState(...args),
}));

import { cancelLateHonorariumForReleasedReviewer } from '../../lib/services/reviewer-withdrawal';

const SUGGESTION = '11111111-1111-4111-8111-111111111111';
const HONORARIUM = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  getForAcceptanceDrain.mockResolvedValue({
    wmkf_reviewstatus: 100000006,
    _wmkf_honorariumrequest_value: HONORARIUM,
    _etag: 'W/"5"',
  });
  getHonorariumCancellationState.mockResolvedValue({
    akoya_requestid: HONORARIUM,
    akoya_requeststatus: 'Pending',
    wmkf_authorizationtoremitpaymentflag: false,
    akoya_paid: 0,
    _etag: 'W/"8"',
  });
  withdrawLinkedHonorariumForReleasedSuggestion.mockResolvedValue(undefined);
});

test('retains and marks a late open honorarium Withdrawn under both fresh ETags', async () => {
  await expect(cancelLateHonorariumForReleasedReviewer(SUGGESTION)).resolves.toEqual({
    cancelled: true,
    honorariumRequestId: HONORARIUM,
  });
  expect(withdrawLinkedHonorariumForReleasedSuggestion).toHaveBeenCalledWith(
    SUGGESTION,
    HONORARIUM,
    { ifMatch: 'W/"5"', honorariumIfMatch: 'W/"8"' },
  );
});

test('fails closed rather than altering an authorized late honorarium', async () => {
  getHonorariumCancellationState.mockResolvedValue({
    akoya_requestid: HONORARIUM,
    akoya_requeststatus: 'Pending',
    wmkf_authorizationtoremitpaymentflag: true,
    akoya_paid: 0,
    _etag: 'W/"8"',
  });
  await expect(cancelLateHonorariumForReleasedReviewer(SUGGESTION)).rejects.toMatchObject({
    code: 'released_reviewer_honorarium_not_cancellable',
    retryable: false,
  });
  expect(withdrawLinkedHonorariumForReleasedSuggestion).not.toHaveBeenCalled();
});
