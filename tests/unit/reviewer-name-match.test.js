/**
 * @jest-environment node
 *
 * The shared CJS name-match util (S224) — single source of truth for reviewer
 * name normalization + EXACT exclusion, used by `/discover`'s server-side dedup,
 * the roster store, and (re-exported) the client `reviewer-search-logic`.
 */
const { normalizeReviewerName, buildExcludedSet, partitionByExcluded } = require('../../lib/utils/reviewer-name-match');

describe('normalizeReviewerName', () => {
  test('strips honorifics + punctuation, lowercases, collapses space', () => {
    expect(normalizeReviewerName('Dr. Thomas K. Wood')).toBe('thomas k wood');
    expect(normalizeReviewerName('Prof. Jane   Q. Researcher ')).toBe('jane q researcher');
  });

  test('folds diacritics so accented == plain (the Jens Hör case)', () => {
    expect(normalizeReviewerName('Jens Hör')).toBe(normalizeReviewerName('Jens Hor'));
    expect(normalizeReviewerName('José Núñez')).toBe('jose nunez');
    expect(normalizeReviewerName('Straße Müller')).toBe('strasse muller');
  });

  test('empty / junk → empty', () => {
    expect(normalizeReviewerName('')).toBe('');
    expect(normalizeReviewerName(null)).toBe('');
    expect(normalizeReviewerName('()')).toBe('');
  });
});

describe('partitionByExcluded — EXACT (not fuzzy) normalized match', () => {
  test('removes exact normalized matches, keeps the rest', () => {
    const { kept, removed } = partitionByExcluded(
      [{ name: 'Jens Hor' }, { name: 'Ann Lee' }, { name: 'Dr. Ann Lee' }],
      ['Jens Hör'],
    );
    expect(kept.map((c) => c.name)).toEqual(['Ann Lee', 'Dr. Ann Lee']);
    expect(removed.map((c) => c.name)).toEqual(['Jens Hor']);
  });

  test('does NOT over-filter on partial/substring names (exact only)', () => {
    const { kept } = partitionByExcluded(
      [{ name: 'Thomas Woodward' }, { name: 'Ann Leeson' }],
      ['Thomas Wood', 'Ann Lee'],
    );
    expect(kept.map((c) => c.name)).toEqual(['Thomas Woodward', 'Ann Leeson']);
  });

  test('empty exclude list → everything kept', () => {
    const items = [{ name: 'A' }, { name: 'B' }];
    expect(partitionByExcluded(items, []).kept).toBe(items);
    expect(partitionByExcluded(items, null).removed).toEqual([]);
  });

  test('honors a custom name extractor', () => {
    const { removed } = partitionByExcluded(
      [{ who: 'Ann Lee' }, { who: 'Bob' }],
      ['ann lee'],
      (x) => x.who,
    );
    expect(removed.map((x) => x.who)).toEqual(['Ann Lee']);
  });
});

describe('buildExcludedSet', () => {
  test('normalizes + drops blanks', () => {
    const s = buildExcludedSet(['Dr. Ann Lee', '', '  ', 'Jens Hör']);
    expect(s.has('ann lee')).toBe(true);
    expect(s.has('jens hor')).toBe(true);
    expect(s.size).toBe(2);
  });
});
