/**
 * @jest-environment node
 *
 * lib/services/workbench/decline-referrals-service — logic-level tests
 * (adapters mocked). Pins: only DECLINED rows with a non-empty referral are
 * returned; decliner names are resolved from wmkf_potentialreviewer; the shape
 * is stable; and an all-declined request with no accepted reviewers still
 * surfaces referrals (the scenario the review-manager GET would drop).
 */

const findByRequest = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findByRequest: (...a) => findByRequest(...a),
}));

const queryReviewers = jest.fn();
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  queryReviewers: (...a) => queryReviewers(...a),
}));

const { getDeclineReferrals } = require('../../lib/services/workbench/decline-referrals-service');

const REQ = '11111111-2222-3333-4444-555555555555';

function suggestion(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: 'sug-1',
    _wmkf_potentialreviewer_value: 'pr-1',
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_declinereferral: null,
    wmkf_responsereceivedat: null,
    ...overrides,
  };
}

beforeEach(() => {
  findByRequest.mockReset();
  queryReviewers.mockReset();
  queryReviewers.mockResolvedValue({ records: [] });
});

test('returns declined rows that carry a non-empty referral, with decliner name resolved', async () => {
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-decl',
      _wmkf_potentialreviewer_value: 'pr-decl',
      wmkf_declined: true,
      wmkf_declinereferral: 'Try Dr. Jane Smith at MIT',
      wmkf_responsereceivedat: '2026-07-08T10:00:00Z',
    }),
  ]);
  queryReviewers.mockResolvedValue({
    records: [{ wmkf_potentialreviewersid: 'pr-decl', wmkf_name: 'Dr. Alan Decliner' }],
  });

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(findByRequest).toHaveBeenCalledWith(REQ, { selectedOnly: false });
  expect(out).toEqual({
    success: true,
    referrals: [
      {
        suggestionId: 'sug-decl',
        reviewerName: 'Dr. Alan Decliner',
        referralText: 'Try Dr. Jane Smith at MIT',
        declinedAt: '2026-07-08T10:00:00Z',
      },
    ],
  });
});

test('excludes accepted rows, declined rows without a referral, and whitespace-only referrals', async () => {
  findByRequest.mockResolvedValue([
    suggestion({ wmkf_accepted: true, wmkf_declinereferral: 'ignored — accepted, not declined' }),
    suggestion({ wmkf_declined: true, wmkf_declinereferral: null }),
    suggestion({ wmkf_declined: true, wmkf_declinereferral: '   ' }),
  ]);

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toEqual([]);
  // No referrals → no name-resolution round-trip.
  expect(queryReviewers).not.toHaveBeenCalled();
});

test('surfaces referrals even when NO reviewer has accepted (all declined)', async () => {
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-a',
      _wmkf_potentialreviewer_value: 'pr-a',
      wmkf_declined: true,
      wmkf_declinereferral: 'Prof. B would be great',
    }),
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-b',
      _wmkf_potentialreviewer_value: 'pr-b',
      wmkf_declined: true,
      wmkf_declinereferral: 'maybe C',
    }),
  ]);
  queryReviewers.mockResolvedValue({
    records: [
      { wmkf_potentialreviewersid: 'pr-a', wmkf_name: 'Decliner A' },
      { wmkf_potentialreviewersid: 'pr-b', wmkf_name: 'Decliner B' },
    ],
  });

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toHaveLength(2);
  expect(out.referrals.map((r) => r.referralText)).toEqual(['Prof. B would be great', 'maybe C']);
});

test('falls back to null reviewerName when the decliner person cannot be resolved', async () => {
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_declined: true,
      wmkf_declinereferral: 'someone',
      _wmkf_potentialreviewer_value: 'pr-missing',
    }),
  ]);
  queryReviewers.mockResolvedValue({ records: [] });

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals[0].reviewerName).toBeNull();
  expect(out.referrals[0].referralText).toBe('someone');
});
