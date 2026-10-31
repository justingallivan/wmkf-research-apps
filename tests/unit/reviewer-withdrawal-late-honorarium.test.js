/**
 * @jest-environment node
 *
 * Late-honorarium compensation (acceptance worker race): staff-ended rows keep
 * the honorarium and mark it Withdrawn; a reviewer's own decline still deletes.
 */
import {
  deleteLateHonorariumForWithdrawnReviewer,
  cancelLateHonorariumForReleasedReviewer,
} from '../../lib/services/reviewer-withdrawal.js';

const ID = '11111111-1111-4111-8111-111111111111';
const HON = '22222222-2222-4222-8222-222222222222';

function deps(row, honorarium) {
  const suggestions = {
    getForAcceptanceDrain: jest.fn(async () => row),
    deleteLinkedHonorariumForDeclinedSuggestion: jest.fn(async () => {}),
    withdrawLinkedHonorariumForEndedSuggestion: jest.fn(async () => {}),
    withdrawLinkedHonorariumForReleasedSuggestion: jest.fn(async () => {}),
  };
  return { suggestions, readHonorarium: jest.fn(async () => honorarium) };
}
const declined = (overrides = {}) => ({
  wmkf_accepted: false, wmkf_declined: true, _wmkf_honorariumrequest_value: HON, _etag: 'W/"9"', ...overrides,
});
const open = { akoya_requeststatus: 'Pending', akoya_paid: 0, _etag: 'W/"2"' };

test.each([
  ['Withdrew', 100000005],
  ['Did not submit', 100000007],
])('a staff-ended %s row keeps the honorarium and marks it Withdrawn', async (_label, status) => {
  const d = deps(declined({ wmkf_reviewstatus: status }), open);
  await expect(deleteLateHonorariumForWithdrawnReviewer(ID, d))
    .resolves.toEqual({ deleted: false, withdrawn: true, honorariumRequestId: HON });
  expect(d.suggestions.withdrawLinkedHonorariumForEndedSuggestion)
    .toHaveBeenCalledWith(ID, HON, { ifMatch: 'W/"9"', honorariumIfMatch: 'W/"2"' });
  expect(d.suggestions.deleteLinkedHonorariumForDeclinedSuggestion).not.toHaveBeenCalled();
});

test('a reviewer\'s own decline (no terminal status) still deletes', async () => {
  const d = deps(declined({ wmkf_reviewstatus: null }), open);
  await expect(deleteLateHonorariumForWithdrawnReviewer(ID, d)).resolves.toEqual({ deleted: true, honorariumRequestId: HON });
  expect(d.suggestions.withdrawLinkedHonorariumForEndedSuggestion).not.toHaveBeenCalled();
  expect(d.readHonorarium).not.toHaveBeenCalled();
});

test.each([
  ['paid', { ...open, akoya_paid: 250 }],
  ['authorized', { ...open, wmkf_authorizationtoremitpaymentflag: true }],
  ['not Pending', { ...open, akoya_requeststatus: 'Approved' }],
  ['unversioned', { ...open, _etag: undefined }],
])('a staff-ended row refuses a %s honorarium without writing', async (_label, honorarium) => {
  const d = deps(declined({ wmkf_reviewstatus: 100000007 }), honorarium);
  await expect(deleteLateHonorariumForWithdrawnReviewer(ID, d))
    .rejects.toMatchObject({ code: 'ended_reviewer_honorarium_not_cancellable', retryable: false });
  expect(d.suggestions.withdrawLinkedHonorariumForEndedSuggestion).not.toHaveBeenCalled();
  expect(d.suggestions.deleteLinkedHonorariumForDeclinedSuggestion).not.toHaveBeenCalled();
});

test('an already Withdrawn honorarium on a staff-ended row is left alone', async () => {
  const d = deps(declined({ wmkf_reviewstatus: 100000005 }), { akoya_requeststatus: 'Withdrawn', _etag: 'W/"2"' });
  await expect(deleteLateHonorariumForWithdrawnReviewer(ID, d))
    .resolves.toMatchObject({ withdrawn: false, reason: 'already_withdrawn' });
  expect(d.suggestions.withdrawLinkedHonorariumForEndedSuggestion).not.toHaveBeenCalled();
});

test('released rows keep their existing withdraw path', async () => {
  const d = deps({ wmkf_reviewstatus: 100000006, _wmkf_honorariumrequest_value: HON, _etag: 'W/"9"' }, open);
  await expect(cancelLateHonorariumForReleasedReviewer(ID, d)).resolves.toEqual({ cancelled: true, honorariumRequestId: HON });
  expect(d.suggestions.withdrawLinkedHonorariumForReleasedSuggestion).toHaveBeenCalled();
});
