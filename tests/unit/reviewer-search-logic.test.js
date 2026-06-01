/**
 * @jest-environment node
 */
import {
  mergeEnrichment,
  asPercent,
  normalizeReviewerName,
  parseExcludeList,
  filterExcluded,
} from '../../shared/components/reviewers/reviewer-search-logic.js';

describe('mergeEnrichment', () => {
  const candidates = [
    { name: 'Dr. A', email: null, website: null, relevanceScore: 90 },
    { name: 'Dr. B', email: 'old@b.edu' },
  ];

  test('attaches contactEnrichment and prefers its email/website by name', () => {
    const out = mergeEnrichment(candidates, [
      { name: 'Dr. A', contactEnrichment: { email: 'a@x.edu', website: 'https://a' } },
    ]);
    expect(out[0].email).toBe('a@x.edu');
    expect(out[0].website).toBe('https://a');
    expect(out[0].contactEnrichment).toEqual({ email: 'a@x.edu', website: 'https://a' });
    // unmatched candidate untouched
    expect(out[1]).toEqual(candidates[1]);
  });

  test('keeps the existing email when enrichment has none', () => {
    const out = mergeEnrichment(candidates, [
      { name: 'Dr. B', contactEnrichment: { website: 'https://b' } },
    ]);
    expect(out[1].email).toBe('old@b.edu');
    expect(out[1].website).toBe('https://b');
  });

  test('returns candidates unchanged when there are no enrichment results', () => {
    expect(mergeEnrichment(candidates, null)).toBe(candidates);
    expect(mergeEnrichment(candidates, [])).toBe(candidates);
  });

  test('non-array candidates → []', () => {
    expect(mergeEnrichment(null, [])).toEqual([]);
  });
});

describe('asPercent', () => {
  test('0–1 confidence → percent', () => {
    expect(asPercent(0.87)).toBe(87);
  });
  test('0–100 score passes through rounded', () => {
    expect(asPercent(87)).toBe(87);
    expect(asPercent(72.4)).toBe(72);
  });
  test('non-number → null', () => {
    expect(asPercent(undefined)).toBeNull();
    expect(asPercent(NaN)).toBeNull();
  });
});

describe('normalizeReviewerName', () => {
  test('strips honorifics and punctuation', () => {
    expect(normalizeReviewerName('Dr. Thomas K. Wood')).toBe('thomas k wood');
    expect(normalizeReviewerName('Prof Jens Hör')).toBe('jens hr');
  });
});

describe('parseExcludeList', () => {
  test('splits on commas and newlines, trims, drops empties', () => {
    expect(parseExcludeList('Tom Wood,  Jens Hör\n\nJane Doe')).toEqual(['Tom Wood', 'Jens Hör', 'Jane Doe']);
    expect(parseExcludeList('')).toEqual([]);
    expect(parseExcludeList(null)).toEqual([]);
  });
});

describe('filterExcluded', () => {
  const candidates = [
    { name: 'Dr. Thomas K. Wood' },
    { name: 'Jane Smith' },
    { name: 'jens hor' },
  ];

  test('removes candidates matching excluded names (normalized, exact)', () => {
    const { kept, removed } = filterExcluded(candidates, ['Thomas K. Wood', 'Jens Hor']);
    expect(kept.map((c) => c.name)).toEqual(['Jane Smith']);
    expect(removed.map((c) => c.name)).toEqual(['Dr. Thomas K. Wood', 'jens hor']);
  });

  test('no exclusions → everything kept', () => {
    expect(filterExcluded(candidates, []).kept).toEqual(candidates);
    expect(filterExcluded(candidates, []).removed).toEqual([]);
  });

  test('does not over-filter on partial/substring names', () => {
    const { kept } = filterExcluded([{ name: 'Thomas Woodward' }], ['Thomas Wood']);
    expect(kept.map((c) => c.name)).toEqual(['Thomas Woodward']);
  });
});
