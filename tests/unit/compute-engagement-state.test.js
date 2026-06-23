/**
 * `computeEngagementState(suggestion)` decides which portal view renders.
 *
 * The route pulls in the token verifier → jose (ESM) and other I/O libs at import
 * time. We only exercise the pure dispatch helper, so stub those to keep module
 * load side-effect-free (mirrors respond-required-address.test.js).
 */
jest.mock('../../lib/external/verify-suggestion-token', () => ({ verifySuggestionToken: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {} }));
jest.mock('../../lib/services/graph-service', () => ({ GraphService: {} }));
jest.mock('../../lib/utils/sharepoint-buckets', () => ({ getRequestSharePointBuckets: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({ bypassDynamicsRestrictions: jest.fn() }));
jest.mock('../../lib/external/review-form-schema', () => ({ reviewFormSchema: {} }));
jest.mock('../../lib/external/reviewer-materials', () => ({ isReviewerMaterial: jest.fn() }));
jest.mock('../../lib/external/policy-fetcher', () => ({ getActivePolicies: jest.fn() }));
jest.mock('../../lib/external/rate-limit', () => ({ checkRateLimit: jest.fn(), recordTokenOutcome: jest.fn() }));

const { computeEngagementState } = require('../../pages/api/external/review/[token]/context');

const RESPONSE_TYPE_DECLINED = 100000001;
const RESPONSE_TYPE_WITHDRAWN_SUFFICIENT = 100000003;
const RESPONSE_TYPE_HELD = 100000004;
const REVIEW_STATUS_MATERIALS_SENT = 100000001;

describe('computeEngagementState — direct accept dispatch', () => {
  test('fresh (no response) → stage2a', () => {
    expect(computeEngagementState({}).view).toBe('stage2a');
  });

  test('historical held row → stage2a so it can complete the single accept flow', () => {
    const r = computeEngagementState({ wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: '2026-06-14T00:00:00Z' });
    expect(r.view).toBe('stage2a');
    expect(r).not.toHaveProperty('held');
    expect(r).not.toHaveProperty('heldAt');
  });
});

describe('computeEngagementState — existing states keep priority', () => {
  test('accepted → accepted-pre-materials', () => {
    expect(computeEngagementState({ wmkf_accepted: true }).view).toBe('accepted-pre-materials');
  });

  test('declined → declined', () => {
    expect(
      computeEngagementState({ wmkf_declined: true, wmkf_responsetype: RESPONSE_TYPE_DECLINED }).view,
    ).toBe('declined');
  });

  test('materials_sent → stage2b', () => {
    expect(
      computeEngagementState({ wmkf_reviewstatus: REVIEW_STATUS_MATERIALS_SENT }).view,
    ).toBe('stage2b');
  });

  test('review received → submitted', () => {
    expect(
      computeEngagementState({ wmkf_reviewreceivedat: '2026-06-14T00:00:00Z' }).view,
    ).toBe('submitted');
  });

  test('withdrawn-sufficient → withdrawn-sufficient', () => {
    expect(
      computeEngagementState({ wmkf_responsetype: RESPONSE_TYPE_WITHDRAWN_SUFFICIENT }).view,
    ).toBe('withdrawn-sufficient');
  });

  test('canFlipState locks once materials are sent', () => {
    expect(computeEngagementState({ wmkf_reviewstatus: REVIEW_STATUS_MATERIALS_SENT }).canFlipState).toBe(false);
    expect(computeEngagementState({}).canFlipState).toBe(true);
  });
});

describe('computeEngagementState — anomalous held+terminal rows keep terminal precedence', () => {
  const HELD_AT = '2026-06-14T00:00:00Z';

  test('held + submitted → submitted', () => {
    const r = computeEngagementState(
      { wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: HELD_AT, wmkf_reviewreceivedat: HELD_AT },
    );
    expect(r.view).toBe('submitted');
  });

  test('held + accepted → accepted-pre-materials', () => {
    const r = computeEngagementState(
      { wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: HELD_AT, wmkf_accepted: true },
    );
    expect(r.view).toBe('accepted-pre-materials');
  });

  test('held + declined → declined', () => {
    const r = computeEngagementState(
      { wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: HELD_AT, wmkf_declined: true },
    );
    expect(r.view).toBe('declined');
  });

  test('held + materials_sent → stage2b', () => {
    const r = computeEngagementState(
      { wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: HELD_AT, wmkf_reviewstatus: REVIEW_STATUS_MATERIALS_SENT },
    );
    expect(r.view).toBe('stage2b');
  });
});
