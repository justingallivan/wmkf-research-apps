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
  dismissDeclineReferral: jest.fn(),
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
    wmkf_selected: false,
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
        referralId: 'sug-decl',
        suggestionId: 'sug-decl',
        referralIndex: 0,
        reviewerName: 'Dr. Alan Decliner',
        referralName: null,
        institution: null,
        email: null,
        referralText: 'Try Dr. Jane Smith at MIT',
        legacy: true,
        dismissible: true,
        referralVersion: 'legacy:Try Dr. Jane Smith at MIT',
        declinedAt: '2026-07-08T10:00:00Z',
      },
    ],
  });
});

test('omits a structured referral after an exact referred candidate is durably selected', async () => {
  const { normalizeDeclineReferrals } = require('../../shared/utils/decline-referrals');
  const stored = normalizeDeclineReferrals([
    { name: 'Sarah Chen', institution: 'Stanford', email: 'chen@example.edu' },
    { name: 'Alex Rivera', institution: 'UCLA', email: '' },
  ]).storedValue;
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-decliner',
      _wmkf_potentialreviewer_value: 'pr-decliner',
      wmkf_declined: true,
      wmkf_declinereferral: stored,
    }),
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-sarah',
      _wmkf_potentialreviewer_value: 'pr-sarah',
      wmkf_sources: 'staff_manual,referred',
      wmkf_selected: true,
    }),
  ]);
  queryReviewers.mockResolvedValue({
    records: [
      { wmkf_potentialreviewersid: 'pr-decliner', wmkf_name: 'Alan Decliner' },
      {
        wmkf_potentialreviewersid: 'pr-sarah',
        wmkf_name: 'Sarah Chen',
        wmkf_emailaddress: 'CHEN@example.edu',
      },
    ],
  });

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toHaveLength(1);
  expect(out.referrals[0]).toMatchObject({
    referralId: 'sug-decliner:1',
    referralIndex: 1,
    referralName: 'Alex Rivera',
  });
});

test('keeps a structured referral when the same-name candidate has a different supplied email', async () => {
  const { normalizeDeclineReferrals } = require('../../shared/utils/decline-referrals');
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-decliner',
      _wmkf_potentialreviewer_value: 'pr-decliner',
      wmkf_declined: true,
      wmkf_declinereferral: normalizeDeclineReferrals([
        { name: 'Sarah Chen', email: 'right@example.edu' },
      ]).storedValue,
    }),
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-sarah',
      _wmkf_potentialreviewer_value: 'pr-sarah',
      wmkf_sources: 'referred',
      wmkf_selected: true,
    }),
  ]);
  queryReviewers.mockResolvedValue({
    records: [
      { wmkf_potentialreviewersid: 'pr-decliner', wmkf_name: 'Alan Decliner' },
      {
        wmkf_potentialreviewersid: 'pr-sarah',
        wmkf_name: 'Sarah Chen',
        wmkf_emailaddress: 'wrong@example.edu',
      },
    ],
  });

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toHaveLength(1);
  expect(out.referrals[0].referralName).toBe('Sarah Chen');
});

test('keeps a structured referral when an exact selected candidate lacks referred provenance', async () => {
  const { normalizeDeclineReferrals } = require('../../shared/utils/decline-referrals');
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-decliner',
      _wmkf_potentialreviewer_value: 'pr-decliner',
      wmkf_declined: true,
      wmkf_declinereferral: normalizeDeclineReferrals([{ name: 'Sarah Chen' }]).storedValue,
    }),
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-sarah',
      _wmkf_potentialreviewer_value: 'pr-sarah',
      wmkf_sources: 'proposal_named',
      wmkf_selected: true,
    }),
  ]);
  queryReviewers.mockResolvedValue({
    records: [
      { wmkf_potentialreviewersid: 'pr-decliner', wmkf_name: 'Alan Decliner' },
      { wmkf_potentialreviewersid: 'pr-sarah', wmkf_name: 'Sarah Chen' },
    ],
  });

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toHaveLength(1);
  expect(out.referrals[0].referralName).toBe('Sarah Chen');
});

test('omits a referred candidate that is already engaged even if it is no longer selected', async () => {
  const { normalizeDeclineReferrals } = require('../../shared/utils/decline-referrals');
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-decliner',
      _wmkf_potentialreviewer_value: 'pr-decliner',
      wmkf_declined: true,
      wmkf_declinereferral: normalizeDeclineReferrals([{ name: 'Sarah Chen' }]).storedValue,
    }),
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-sarah',
      _wmkf_potentialreviewer_value: 'pr-sarah',
      wmkf_sources: 'staff_manual,referred',
      wmkf_selected: false,
      wmkf_invited: true,
    }),
  ]);
  queryReviewers.mockResolvedValue({
    records: [
      { wmkf_potentialreviewersid: 'pr-decliner', wmkf_name: 'Alan Decliner' },
      { wmkf_potentialreviewersid: 'pr-sarah', wmkf_name: 'Sarah Chen' },
    ],
  });

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toEqual([]);
});

test('keeps a structured referral when the matching referred candidate still needs restore', async () => {
  const { normalizeDeclineReferrals } = require('../../shared/utils/decline-referrals');
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-decliner',
      _wmkf_potentialreviewer_value: 'pr-decliner',
      wmkf_declined: true,
      wmkf_declinereferral: normalizeDeclineReferrals([{ name: 'Sarah Chen' }]).storedValue,
    }),
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-sarah',
      _wmkf_potentialreviewer_value: 'pr-sarah',
      wmkf_sources: 'referred',
      wmkf_selected: false,
      wmkf_declined: true,
    }),
  ]);
  queryReviewers.mockResolvedValue({
    records: [
      { wmkf_potentialreviewersid: 'pr-decliner', wmkf_name: 'Alan Decliner' },
      { wmkf_potentialreviewersid: 'pr-sarah', wmkf_name: 'Sarah Chen' },
    ],
  });

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toHaveLength(1);
  expect(out.referrals[0].referralName).toBe('Sarah Chen');
});

test('omits a legacy note after it is explicitly resolved', async () => {
  const { resolveLegacyDeclineReferral } = require('../../shared/utils/decline-referrals');
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_declined: true,
      wmkf_declinereferral: resolveLegacyDeclineReferral('Try Jane Smith').storedValue,
    }),
  ]);

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toEqual([]);
});

test('expands a structured memo into one actionable DTO per referred person', async () => {
  const { normalizeDeclineReferrals } = require('../../shared/utils/decline-referrals');
  const stored = normalizeDeclineReferrals([
    { name: 'Sarah Chen', institution: 'Stanford', email: 'chen@example.edu' },
    { name: 'Alex Rivera', institution: 'UCLA', email: '' },
  ]).storedValue;
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-structured',
      wmkf_declined: true,
      wmkf_declinereferral: stored,
    }),
  ]);

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toHaveLength(2);
  expect(out.referrals[0]).toMatchObject({
    referralId: 'sug-structured:0',
    suggestionId: 'sug-structured',
    referralName: 'Sarah Chen',
    institution: 'Stanford',
    email: 'chen@example.edu',
    legacy: false,
  });
  expect(out.referrals[1]).toMatchObject({
    referralId: 'sug-structured:1',
    referralName: 'Alex Rivera',
    institution: 'UCLA',
  });
});

test('omits only the structured row durably marked resolved', async () => {
  const {
    normalizeDeclineReferrals,
    resolveStructuredDeclineReferral,
  } = require('../../shared/utils/decline-referrals');
  const stored = normalizeDeclineReferrals([
    { name: 'Sarah Chen', institution: 'Stanford' },
    { name: 'Alex Rivera', institution: 'UCLA' },
  ]).storedValue;
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-structured',
      wmkf_declined: true,
      wmkf_declinereferral: resolveStructuredDeclineReferral(stored, 0).storedValue,
    }),
  ]);

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toHaveLength(1);
  expect(out.referrals[0]).toMatchObject({
    referralId: 'sug-structured:1',
    referralIndex: 1,
    referralName: 'Alex Rivera',
  });
});

test('keeps an unreadable reserved envelope visible but non-dismissible', async () => {
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-corrupt',
      wmkf_declined: true,
      wmkf_declinereferral: 'wmkf-referrals:v2:[{"n":"Future Person"}]',
    }),
  ]);

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toHaveLength(1);
  expect(out.referrals[0]).toMatchObject({
    referralId: 'sug-corrupt',
    legacy: true,
    dismissible: false,
    referralVersion: null,
    referralText: 'wmkf-referrals:v2:[{"n":"Future Person"}]',
  });
});

test('keeps an overlength legacy note visible but does not offer an impossible dismissal', async () => {
  const referralText = 'x'.repeat(1975);
  findByRequest.mockResolvedValue([
    suggestion({
      wmkf_appreviewersuggestionid: 'sug-long-legacy',
      wmkf_declined: true,
      wmkf_declinereferral: referralText,
    }),
  ]);

  const out = await getDeclineReferrals({ requestId: REQ });

  expect(out.referrals).toHaveLength(1);
  expect(out.referrals[0]).toMatchObject({
    referralId: 'sug-long-legacy',
    legacy: true,
    dismissible: false,
    referralVersion: `legacy:${referralText}`,
    referralText,
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
