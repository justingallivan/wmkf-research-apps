/**
 * Tests for lib/services/reviewer-time-budget.js — the admin-editable reviewer
 * search time budget reader.
 *
 * Contract (the OPPOSITE failure posture from honorarium-config): this gates
 * search duration, not a money write, so it NEVER throws — absent key,
 * malformed value, and settings fetch failure all fall back to the 600s
 * default. The returned value is always finite and clamped to [120, 800].
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/settings-service', () => ({ getSetting: jest.fn() }));

const { getSetting } = require('../../lib/services/settings-service');
const {
  getReviewerTimeBudgetSeconds,
  DEFAULT_REVIEWER_TIME_BUDGET_SECONDS,
  MIN_REVIEWER_TIME_BUDGET_SECONDS,
  MAX_REVIEWER_TIME_BUDGET_SECONDS,
} = require('../../lib/services/reviewer-time-budget');

beforeEach(() => { getSetting.mockReset(); });

describe('getReviewerTimeBudgetSeconds', () => {
  it('absent key (null) → default 600', async () => {
    getSetting.mockResolvedValueOnce(null);
    await expect(getReviewerTimeBudgetSeconds()).resolves.toBe(DEFAULT_REVIEWER_TIME_BUDGET_SECONDS);
  });

  it('present-but-empty value → default', async () => {
    getSetting.mockResolvedValueOnce('   ');
    await expect(getReviewerTimeBudgetSeconds()).resolves.toBe(600);
  });

  it('valid in-range value → parsed number', async () => {
    getSetting.mockResolvedValueOnce('450');
    await expect(getReviewerTimeBudgetSeconds()).resolves.toBe(450);
  });

  it('below MIN → clamped up to 120', async () => {
    getSetting.mockResolvedValueOnce('30');
    await expect(getReviewerTimeBudgetSeconds()).resolves.toBe(MIN_REVIEWER_TIME_BUDGET_SECONDS);
  });

  it('above MAX → clamped down to 800', async () => {
    getSetting.mockResolvedValueOnce('5000');
    await expect(getReviewerTimeBudgetSeconds()).resolves.toBe(MAX_REVIEWER_TIME_BUDGET_SECONDS);
  });

  it('malformed (non-numeric) → falls back to default, does NOT throw', async () => {
    getSetting.mockResolvedValueOnce('soon-ish');
    await expect(getReviewerTimeBudgetSeconds()).resolves.toBe(600);
  });

  it('zero / negative → falls back to default', async () => {
    getSetting.mockResolvedValueOnce('0');
    await expect(getReviewerTimeBudgetSeconds()).resolves.toBe(600);
    getSetting.mockResolvedValueOnce('-100');
    await expect(getReviewerTimeBudgetSeconds()).resolves.toBe(600);
  });

  it('settings fetch failure (getSetting throws) → default, never throws', async () => {
    getSetting.mockRejectedValueOnce(new Error('Dynamics 503'));
    await expect(getReviewerTimeBudgetSeconds()).resolves.toBe(600);
  });

  it('always returns a finite number in [120, 800]', async () => {
    for (const v of [null, '', 'x', '0', '-5', '1', '119', '120', '800', '801', '99999']) {
      getSetting.mockResolvedValueOnce(v);
      const r = await getReviewerTimeBudgetSeconds();
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(MIN_REVIEWER_TIME_BUDGET_SECONDS);
      expect(r).toBeLessThanOrEqual(MAX_REVIEWER_TIME_BUDGET_SECONDS);
    }
  });
});
