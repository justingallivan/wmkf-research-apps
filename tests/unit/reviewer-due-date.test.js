import { resolveEffectiveReviewDueDate } from '../../lib/external/reviewer-due-date.js';
import {
  currentYmdInTimeZone,
  isCurrentOrFutureYmd,
} from '../../lib/utils/date-ymd.js';

describe('resolveEffectiveReviewDueDate', () => {
  test('a valid suggestion override wins over the request default', () => {
    expect(resolveEffectiveReviewDueDate({
      overrideDate: '2026-09-15',
      defaultDate: '2026-09-01',
    })).toBe('2026-09-15');
  });

  test('a missing or malformed override falls back to the request default', () => {
    expect(resolveEffectiveReviewDueDate({
      overrideDate: null,
      defaultDate: '2026-09-01',
    })).toBe('2026-09-01');
    expect(resolveEffectiveReviewDueDate({
      overrideDate: '09/15/2026',
      defaultDate: '2026-09-01',
    })).toBe('2026-09-01');
  });

  test('returns null when neither date is a valid YYYY-MM-DD value', () => {
    expect(resolveEffectiveReviewDueDate({
      overrideDate: '',
      defaultDate: 'not-a-date',
    })).toBeNull();
  });
});

describe('reviewer due-date calendar boundary', () => {
  test('uses the Foundation timezone on both sides of Pacific midnight', () => {
    const justBeforeMidnight = new Date('2026-08-11T06:59:00Z');
    const justAfterMidnight = new Date('2026-08-11T07:01:00Z');

    expect(currentYmdInTimeZone(justBeforeMidnight)).toBe('2026-08-10');
    expect(currentYmdInTimeZone(justAfterMidnight)).toBe('2026-08-11');
    expect(isCurrentOrFutureYmd('2026-08-10', { now: justBeforeMidnight })).toBe(true);
    expect(isCurrentOrFutureYmd('2026-08-10', { now: justAfterMidnight })).toBe(false);
    expect(isCurrentOrFutureYmd('not-a-date', { now: justAfterMidnight })).toBe(false);
  });
});
