/**
 * Reviewer "hold step" chunk 2 — readiness-gated view dispatch.
 *
 * `computeEngagementState(suggestion, isReady)` decides which portal view renders.
 * The hold step adds two readiness-gated views for pre-materials reviewers:
 *   - fresh (no response) + not ready → 'hold-invite'
 *   - held + not ready               → 'held'
 *   - either, when ready             → 'stage2a' (the existing finalize/accept form)
 * All terminal/post-accept states are unchanged and ignore readiness.
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
const { isProposalReadyForReviewers } = require('../../lib/external/proposal-readiness');

const RESPONSE_TYPE_DECLINED = 100000001;
const RESPONSE_TYPE_WITHDRAWN_SUFFICIENT = 100000003;
const RESPONSE_TYPE_HELD = 100000004;
const REVIEW_STATUS_MATERIALS_SENT = 100000001;

describe('computeEngagementState — readiness-gated hold dispatch', () => {
  test('fresh (no response) + NOT ready → hold-invite', () => {
    expect(computeEngagementState({}, false).view).toBe('hold-invite');
  });

  test('fresh (no response) + ready → stage2a (existing finalize form)', () => {
    expect(computeEngagementState({}, true).view).toBe('stage2a');
  });

  test('default isReady (omitted) preserves today\'s direct-to-accept behavior → stage2a', () => {
    expect(computeEngagementState({}).view).toBe('stage2a');
  });

  test('held + NOT ready → held (sit-tight confirmation)', () => {
    const r = computeEngagementState({ wmkf_responsetype: RESPONSE_TYPE_HELD }, false);
    expect(r.view).toBe('held');
    expect(r.held).toBe(true);
  });

  test('held + ready → stage2a (finalize; held→accept runs the full accept path)', () => {
    expect(computeEngagementState({ wmkf_responsetype: RESPONSE_TYPE_HELD }, true).view).toBe('stage2a');
  });

  test('held row exposes heldAt in the returned state', () => {
    const r = computeEngagementState(
      { wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: '2026-06-14T00:00:00Z' },
      false,
    );
    expect(r.heldAt).toBe('2026-06-14T00:00:00Z');
  });
});

describe('computeEngagementState — existing states ignore readiness (regression)', () => {
  // Each asserted under BOTH readiness values to prove the hold gate doesn't leak.
  for (const isReady of [true, false]) {
    test(`accepted → accepted-pre-materials (isReady=${isReady})`, () => {
      expect(computeEngagementState({ wmkf_accepted: true }, isReady).view).toBe('accepted-pre-materials');
    });

    test(`declined → declined (isReady=${isReady})`, () => {
      expect(
        computeEngagementState({ wmkf_declined: true, wmkf_responsetype: RESPONSE_TYPE_DECLINED }, isReady).view,
      ).toBe('declined');
    });

    test(`materials_sent → stage2b (isReady=${isReady})`, () => {
      expect(
        computeEngagementState({ wmkf_reviewstatus: REVIEW_STATUS_MATERIALS_SENT }, isReady).view,
      ).toBe('stage2b');
    });

    test(`review received → submitted (isReady=${isReady})`, () => {
      expect(
        computeEngagementState({ wmkf_reviewreceivedat: '2026-06-14T00:00:00Z' }, isReady).view,
      ).toBe('submitted');
    });

    test(`withdrawn-sufficient → withdrawn-sufficient (isReady=${isReady})`, () => {
      expect(
        computeEngagementState({ wmkf_responsetype: RESPONSE_TYPE_WITHDRAWN_SUFFICIENT }, isReady).view,
      ).toBe('withdrawn-sufficient');
    });
  }

  test('canFlipState locks once materials are sent', () => {
    expect(computeEngagementState({ wmkf_reviewstatus: REVIEW_STATUS_MATERIALS_SENT }, true).canFlipState).toBe(false);
    expect(computeEngagementState({}, true).canFlipState).toBe(true);
  });
});

describe('computeEngagementState — anomalous held+terminal rows (precedence + no contradictory held flag)', () => {
  // A held row that also carries a terminal/response marker is "impossible" in the
  // happy path, but the terminal MUST win the view AND `held`/`heldAt` must not leak
  // true alongside a terminal view (else consumers see contradictory state).
  const HELD_AT = '2026-06-14T00:00:00Z';

  test('held + submitted → submitted, held=false, heldAt=null', () => {
    const r = computeEngagementState(
      { wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: HELD_AT, wmkf_reviewreceivedat: HELD_AT },
      false,
    );
    expect(r.view).toBe('submitted');
    expect(r.held).toBe(false);
    expect(r.heldAt).toBeNull();
  });

  test('held + accepted → accepted-pre-materials, held=false', () => {
    const r = computeEngagementState(
      { wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: HELD_AT, wmkf_accepted: true },
      false,
    );
    expect(r.view).toBe('accepted-pre-materials');
    expect(r.held).toBe(false);
    expect(r.heldAt).toBeNull();
  });

  test('held + declined → declined, held=false', () => {
    const r = computeEngagementState(
      { wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: HELD_AT, wmkf_declined: true },
      false,
    );
    expect(r.view).toBe('declined');
    expect(r.held).toBe(false);
  });

  test('held + materials_sent → stage2b, held=false', () => {
    const r = computeEngagementState(
      { wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: HELD_AT, wmkf_reviewstatus: REVIEW_STATUS_MATERIALS_SENT },
      false,
    );
    expect(r.view).toBe('stage2b');
    expect(r.held).toBe(false);
  });

  test('active held (no terminal) keeps held=true + heldAt under both readiness values', () => {
    const notReady = computeEngagementState({ wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: HELD_AT }, false);
    expect(notReady.view).toBe('held');
    expect(notReady.held).toBe(true);
    expect(notReady.heldAt).toBe(HELD_AT);

    const ready = computeEngagementState({ wmkf_responsetype: RESPONSE_TYPE_HELD, wmkf_heldat: HELD_AT }, true);
    expect(ready.view).toBe('stage2a');
    expect(ready.held).toBe(true);
    expect(ready.heldAt).toBe(HELD_AT);
  });
});

describe('isProposalReadyForReviewers — current go-live gate', () => {
  // Until the staff release signal is wired AND the hold UI ships, every proposal is
  // treated as ready (hold bypassed), preserving today's direct-to-accept flow.
  test('returns true for a normal request row', () => {
    expect(isProposalReadyForReviewers({ akoya_requestid: 'x', wmkf_phaseiisubmittedat: null })).toBe(true);
  });

  test('returns true even when phase-II receipt is stamped (receipt != released)', () => {
    expect(isProposalReadyForReviewers({ wmkf_phaseiisubmittedat: '2026-06-14T00:00:00Z' })).toBe(true);
  });

  test('null/undefined request is tolerated', () => {
    expect(isProposalReadyForReviewers(null)).toBe(true);
    expect(isProposalReadyForReviewers(undefined)).toBe(true);
  });
});
