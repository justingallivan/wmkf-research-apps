/** @jest-environment node */
jest.mock('../../lib/external/reviewer-materials', () => ({ listReviewerMaterialsWithAvailability: jest.fn() }));
const { listReviewerMaterialsWithAvailability } = require('../../lib/external/reviewer-materials');
const { checkInvitationProposalPdf } = require('../../lib/services/review-manager/invitation-proposal-pdf');

const REQUEST = { akoya_requestid: '11111111-1111-4111-8111-111111111111', akoya_requestnum: '1002379' };

test.each([
  [{ files: [{ name: 'p.pdf' }], unavailableSources: ['dynamics'] }, 'present'],
  [{ files: [], unavailableSources: [] }, 'missing'],
  [{ files: [], unavailableSources: ['archive'] }, 'unavailable'],
  [{ files: [], unavailableSources: ['dynamics'] }, 'unavailable'],
])('%j → %s', async (listing, expected) => {
  listReviewerMaterialsWithAvailability.mockResolvedValueOnce(listing);
  expect(await checkInvitationProposalPdf(REQUEST)).toBe(expected);
});

test('a throw or a request without its number is unavailable', async () => {
  listReviewerMaterialsWithAvailability.mockRejectedValueOnce(new Error('graph down'));
  expect(await checkInvitationProposalPdf(REQUEST)).toBe('unavailable');
  expect(await checkInvitationProposalPdf({ akoya_requestid: REQUEST.akoya_requestid })).toBe('unavailable');
});
