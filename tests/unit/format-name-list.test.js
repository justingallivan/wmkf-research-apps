import { formatNameList } from '../../lib/utils/format-name-list';

describe('formatNameList — grammatical serial list', () => {
  test('empty / non-array → empty string', () => {
    expect(formatNameList([])).toBe('');
    expect(formatNameList(null)).toBe('');
    expect(formatNameList(undefined)).toBe('');
    expect(formatNameList('not an array')).toBe('');
  });

  test('one name → the name', () => {
    expect(formatNameList(['Dr. Jane Smith'])).toBe('Dr. Jane Smith');
  });

  test('two names → "A and B" (no serial comma)', () => {
    expect(formatNameList(['Dr. Jane Smith', 'Dr. John Doe'])).toBe('Dr. Jane Smith and Dr. John Doe');
  });

  test('three names → serial comma before the final "and"', () => {
    expect(formatNameList(['A', 'B', 'C'])).toBe('A, B, and C');
  });

  test('four+ names → "A, B, C, and D"', () => {
    expect(formatNameList(['A', 'B', 'C', 'D'])).toBe('A, B, C, and D');
  });

  test('drops blank / whitespace-only entries (no dangling comma or stray "and")', () => {
    expect(formatNameList(['A', '', '   ', 'B'])).toBe('A and B');
    expect(formatNameList(['', '  '])).toBe('');
    expect(formatNameList(['A', null, undefined, 'B', 'C'])).toBe('A, B, and C');
  });

  test('trims surrounding whitespace on each name', () => {
    expect(formatNameList(['  A  ', ' B '])).toBe('A and B');
  });
});
