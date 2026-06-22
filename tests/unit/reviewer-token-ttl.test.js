/**
 * Reviewer-engagement §3.D token-TTL policy (computeReviewerTokenExpiry).
 *
 * The link expiry is keyed on ACCEPTED status, not templateType:
 *   - accepted reviewer + sane future review-due → review-due + 90d (long window)
 *   - non-accepted (invitee/non-responder) + sane future review-due → review-due + 2d (cap)
 *   - no sane FUTURE review-due (null / malformed / past) → now + 90d fallback (never expired)
 */

import { computeReviewerTokenExpiry } from '../../lib/external/reviewer-token-ttl';

const DAY = 24 * 60 * 60 * 1000;

// A YYYY-MM-DD ~60 days out so end-of-day is unambiguously in the future.
function futureYmd(daysOut) {
  const d = new Date(Date.now() + daysOut * DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

describe('computeReviewerTokenExpiry', () => {
  test('accepted + future review-due → review-due end-of-day + 90 days', () => {
    const ymd = futureYmd(60);
    const due = Date.parse(`${ymd}T23:59:59Z`);
    const exp = computeReviewerTokenExpiry({ accepted: true, reviewDueDate: ymd });
    expect(exp.getTime()).toBe(due + 90 * DAY);
  });

  test('non-accepted + future review-due → review-due end-of-day + 2 days (cap)', () => {
    const ymd = futureYmd(30);
    const due = Date.parse(`${ymd}T23:59:59Z`);
    const exp = computeReviewerTokenExpiry({ accepted: false, reviewDueDate: ymd });
    expect(exp.getTime()).toBe(due + 2 * DAY);
  });

  test('the cap is much shorter than the accepted window for the same due date', () => {
    const ymd = futureYmd(45);
    const capped = computeReviewerTokenExpiry({ accepted: false, reviewDueDate: ymd }).getTime();
    const long = computeReviewerTokenExpiry({ accepted: true, reviewDueDate: ymd }).getTime();
    expect(long - capped).toBe(88 * DAY);
  });

  test.each([
    ['null', null],
    ['empty string', ''],
    ['malformed', '2026/07/01'],
    ['impossible date', '2026-02-31'],
  ])('no sane review-due (%s) → ~now + 90 days fallback, regardless of accepted', (_label, ymd) => {
    const before = Date.now();
    const exp = computeReviewerTokenExpiry({ accepted: false, reviewDueDate: ymd }).getTime();
    const after = Date.now();
    expect(exp).toBeGreaterThanOrEqual(before + 90 * DAY);
    expect(exp).toBeLessThanOrEqual(after + 90 * DAY);
  });

  test('a PAST review-due falls back to now + 90 (never mints an expired/past-dated token)', () => {
    const pastYmd = '2020-01-01';
    const before = Date.now();
    const exp = computeReviewerTokenExpiry({ accepted: false, reviewDueDate: pastYmd }).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + 90 * DAY - 1000);
    expect(exp).toBeGreaterThan(Date.now()); // strictly in the future
  });
});
