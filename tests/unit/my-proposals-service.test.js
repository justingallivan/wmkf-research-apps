/**
 * @jest-environment node
 *
 * Unit tests for lib/services/reviewer-finder/my-proposals-service.js
 * (Route→Service Consolidation Plan, Stage 3 wave) — logic-level coverage
 * with the PD resolver and adapters mocked: cycle dedupe/sort, status
 * filters, reviewer-count aggregation buckets/chunking, and the typed
 * 404/400 domain errors.
 */

jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  __esModule: true,
  queryAllRequests: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  queryAllSuggestions: jest.fn(),
  notExcludedFilter: jest.fn(() => 'not-excluded'),
  RESPONSE_TYPE_MAP: { accepted: 100000001, declined: 100000002, held: 100000003 },
}));

const { resolveByEmail } = require('../../lib/services/program-director-resolver');
const { queryAllRequests } = require('../../lib/dataverse/adapters/grant-request');
const { queryAllSuggestions } = require('../../lib/dataverse/adapters/reviewer-suggestion');
const { getMyProposals, MyProposalsError } = require('../../lib/services/reviewer-finder/my-proposals-service');

const PD = { systemuserid: 'pd-1', fullName: 'Dr. PD' };
const EMAIL = 'pd@example.org';

beforeEach(() => {
  jest.clearAllMocks();
  resolveByEmail.mockResolvedValue(PD);
  queryAllRequests.mockResolvedValue({ records: [] });
  queryAllSuggestions.mockResolvedValue({ records: [] });
});

test('404 MyProposalsError when no active systemuser resolves for the email', async () => {
  resolveByEmail.mockResolvedValue(null);
  const err = await getMyProposals({ azureEmail: EMAIL }).catch((e) => e);
  expect(err).toBeInstanceOf(MyProposalsError);
  expect(err.httpStatus).toBe(404);
  expect(err.message).toBe(`No active Dynamics systemuser found for ${EMAIL}.`);
  expect(err.body).toBeUndefined();
});

test('400 MyProposalsError on an invalid cycleCode', async () => {
  const err = await getMyProposals({ azureEmail: EMAIL, cycleCode: 'not-a-cycle' }).catch((e) => e);
  expect(err).toBeInstanceOf(MyProposalsError);
  expect(err.httpStatus).toBe(400);
  expect(err.message).toBe('Invalid cycleCode: not-a-cycle');
});

test('cycle-list mode dedupes meeting dates into cycle codes with counts, newest first', async () => {
  queryAllRequests.mockResolvedValue({
    records: [
      { akoya_requestid: 'r1', wmkf_meetingdate: '2026-06-15' },
      { akoya_requestid: 'r2', wmkf_meetingdate: '2026-06-20' },
      { akoya_requestid: 'r3', wmkf_meetingdate: '2025-12-10' },
    ],
  });

  const out = await getMyProposals({ azureEmail: EMAIL });

  expect(out).toEqual({
    success: true,
    programDirector: { systemuserid: 'pd-1', fullName: 'Dr. PD' },
    cycles: [
      { code: 'J26', year: 2026, month: 6, count: 2, latestMeetingDate: '2026-06-15' },
      { code: 'D25', year: 2025, month: 12, count: 1, latestMeetingDate: '2025-12-10' },
    ],
  });
});

test('actionable (default) status requires Phase II Pending AND null wmkf_phaseiistatus in the filter', async () => {
  await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26' });
  const { filter } = queryAllRequests.mock.calls[0][0];
  expect(filter).toContain(`akoya_requeststatus eq 'Phase II Pending' and wmkf_phaseiistatus eq null`);
});

test("status='all' drops only the phaseiistatus clause; unknown statuses fall back to actionable", async () => {
  await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26', status: 'all' });
  expect(queryAllRequests.mock.calls[0][0].filter).not.toContain('wmkf_phaseiistatus eq null');

  await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26', status: 'bogus' });
  expect(queryAllRequests.mock.calls[1][0].filter).toContain('wmkf_phaseiistatus eq null');
});

test('proposals-in-cycle projects slots, counts all four lifecycle buckets, and uppercases the cycle code', async () => {
  queryAllRequests.mockResolvedValue({
    records: [{
      akoya_requestid: 'r1',
      akoya_requestnum: 'REQ-1',
      wmkf_meetingdate: '2026-06-15',
      akoya_requeststatus: 'Phase II Pending',
      _wmkf_potentialreviewer1_value: 'p1',
      _wmkf_potentialreviewer3_value: 'p3',
    }],
  });
  queryAllSuggestions.mockResolvedValue({
    records: [
      { _wmkf_request_value: 'r1', wmkf_invited: true },
      { _wmkf_request_value: 'r1', wmkf_emailsentat: '2026-01-01', wmkf_responsetype: 100000001 },
      { _wmkf_request_value: 'r1', wmkf_declined: true },
      { _wmkf_request_value: 'r1', wmkf_responsetype: 100000003 },
    ],
  });

  const out = await getMyProposals({ azureEmail: EMAIL, cycleCode: 'j26' });

  expect(out.cycleCode).toBe('J26');
  expect(out.status).toBe('actionable');
  expect(out.proposals[0]).toMatchObject({
    requestId: 'r1',
    reviewerInvited: 2, // wmkf_invited OR wmkf_emailsentat
    reviewerAccepted: 1, // responsetype accepted
    reviewerDeclined: 1,
    reviewerHeld: 1,
    reviewerSlotsFilled: 2,
    reviewerSlotsTotal: 5,
  });
});

test('a request with no suggestion rows gets 0/0/0/0 counts', async () => {
  queryAllRequests.mockResolvedValue({
    records: [{ akoya_requestid: 'r1', akoya_requestnum: 'REQ-1', wmkf_meetingdate: '2026-06-15' }],
  });
  const out = await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26' });
  expect(out.proposals[0]).toMatchObject({
    reviewerInvited: 0, reviewerAccepted: 0, reviewerDeclined: 0, reviewerHeld: 0,
  });
});

test('reviewer-count aggregation chunks the OR-chain at 25 request ids per query: first call gets ids 0-24 in order, second gets ids 25-29', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `r${i}`);
  queryAllRequests.mockResolvedValue({
    records: ids.map((id) => ({
      akoya_requestid: id, akoya_requestnum: `REQ-${id}`, wmkf_meetingdate: '2026-06-15',
    })),
  });

  await getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26' });

  expect(queryAllSuggestions).toHaveBeenCalledTimes(2);
  const firstFilter = queryAllSuggestions.mock.calls[0][0].filter;
  const secondFilter = queryAllSuggestions.mock.calls[1][0].filter;
  expect(firstFilter.split(' or ')).toHaveLength(25);
  expect(secondFilter.split(' or ')).toHaveLength(5);
  expect(firstFilter).toContain('not-excluded');
  // Exact contents + order: first call gets elements 0..24 in order, second gets element 25..29.
  const firstOrChainStart = firstFilter.indexOf('(') + 1;
  const firstOrChain = firstFilter.slice(firstOrChainStart, firstFilter.indexOf(')'));
  expect(firstOrChain.split(' or ')).toEqual(ids.slice(0, 25).map((id) => `_wmkf_request_value eq ${id}`));
  const secondOrChainStart = secondFilter.indexOf('(') + 1;
  const secondOrChain = secondFilter.slice(secondOrChainStart, secondFilter.indexOf(')'));
  expect(secondOrChain.split(' or ')).toEqual(ids.slice(25).map((id) => `_wmkf_request_value eq ${id}`));
});

test('a suggestion-count chunk failure propagates untyped (clean 500 beats an undercount)', async () => {
  queryAllRequests.mockResolvedValue({
    records: [{ akoya_requestid: 'r1', akoya_requestnum: 'REQ-1', wmkf_meetingdate: '2026-06-15' }],
  });
  queryAllSuggestions.mockRejectedValue(new Error('Dataverse unavailable'));
  await expect(getMyProposals({ azureEmail: EMAIL, cycleCode: 'J26' })).rejects.toThrow('Dataverse unavailable');
});
