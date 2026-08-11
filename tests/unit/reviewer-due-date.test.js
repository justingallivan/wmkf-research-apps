import { resolveEffectiveReviewDueDate } from '../../lib/external/reviewer-due-date.js';

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
