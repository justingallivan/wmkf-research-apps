import { formatNameList, stripHonorific } from '../../lib/utils/format-name-list';

describe('stripHonorific — plain full name, no leading honorific', () => {
  test('strips common honorifics (with or without the period)', () => {
    expect(stripHonorific('Dr. Jane Smith')).toBe('Jane Smith');
    expect(stripHonorific('Dr Jane Smith')).toBe('Jane Smith');
    expect(stripHonorific('Prof. Bob Brown')).toBe('Bob Brown');
    expect(stripHonorific('Professor Bob Brown')).toBe('Bob Brown');
    expect(stripHonorific('Mr. Alan Turing')).toBe('Alan Turing');
    expect(stripHonorific('Ms. Ada Lovelace')).toBe('Ada Lovelace');
    expect(stripHonorific('Mrs. Grace Hopper')).toBe('Grace Hopper');
  });

  test('strips a run of leading honorifics', () => {
    expect(stripHonorific('Prof. Dr. Hans Mueller')).toBe('Hans Mueller');
  });

  test('leaves a name without an honorific unchanged, incl. suffixes', () => {
    expect(stripHonorific('Jane Smith')).toBe('Jane Smith');
    expect(stripHonorific('Martin Luther King Jr.')).toBe('Martin Luther King Jr.');
    expect(stripHonorific('Jane Smith PhD')).toBe('Jane Smith PhD');
  });

  test('does NOT strip a name that merely starts with those letters', () => {
    expect(stripHonorific('Drew Barrymore')).toBe('Drew Barrymore');
    expect(stripHonorific('Professorial Jones')).toBe('Professorial Jones');
  });

  test('blank / nullish → empty string', () => {
    expect(stripHonorific('')).toBe('');
    expect(stripHonorific(null)).toBe('');
    expect(stripHonorific(undefined)).toBe('');
  });
});

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
