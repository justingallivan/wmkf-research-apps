/**
 * @jest-environment node
 *
 * S223: PubMed affiliation extraction is RECENCY-WEIGHTED (was most-common), so a
 * researcher who recently moved is labeled with their CURRENT institution even
 * when the postdoc-era one appears in more papers. Years are relative to "now"
 * so the test is date-stable.
 */
const { DiscoveryService } = require('../../lib/services/discovery-service');

const Y = new Date().getFullYear();
const author = (name, affiliation) => ({ name, affiliation });

describe('extractBestAffiliation — recency-weighted', () => {
  test('recent institution beats a more-common older one', () => {
    const articles = [
      // 4 older papers at the postdoc lab (dominant by count)
      { year: Y - 10, authors: [author('Jane Smith', 'Old Postdoc University, Dept of Biology')] },
      { year: Y - 9, authors: [author('Jane Smith', 'Old Postdoc University, Dept of Biology')] },
      { year: Y - 9, authors: [author('Jane Smith', 'Old Postdoc University, Dept of Biology')] },
      { year: Y - 8, authors: [author('Jane Smith', 'Old Postdoc University, Dept of Biology')] },
      // 2 recent papers at the new faculty position (fewer, but current)
      { year: Y, authors: [author('Jane Smith', 'New Faculty University, Dept of Chemistry')] },
      { year: Y - 1, authors: [author('Jane Smith', 'New Faculty University, Dept of Chemistry')] },
    ];
    const aff = DiscoveryService.extractBestAffiliation(articles, 'Jane Smith');
    expect(aff).toMatch(/New Faculty University/);
  });

  test('multi-variant aggregates across spellings (not first-variant-wins)', () => {
    const articles = [
      { year: Y - 10, authors: [author('W Harcombe', 'Old Postdoc University, Dept of Biology')] },
      { year: Y, authors: [author('William Harcombe', 'New Faculty University, Dept of Chemistry')] },
    ];
    // Variant order puts the OLD-only spelling first; first-variant-wins would
    // return the old affiliation. Aggregated recency picks the recent one.
    const aff = DiscoveryService.extractBestAffiliationMultiVariant(articles, ['W Harcombe', 'William Harcombe']);
    expect(aff).toMatch(/New Faculty University/);
  });

  test('no-name fallback returns the most recent article’s affiliation', () => {
    const articles = [
      { year: Y - 5, authors: [author('A', 'Old Institute of Science, Boston')] },
      { year: Y, authors: [author('B', 'New Institute of Science, Chicago')] },
    ];
    expect(DiscoveryService.extractBestAffiliation(articles, null)).toMatch(/New Institute/);
  });
});

describe('collectAffiliationHistory — all distinct affiliations, most-recent-first', () => {
  test('returns every distinct institution (current pick alone would hide the former one)', () => {
    const articles = [
      { year: Y - 8, authors: [author('Jane Smith', 'Old Postdoc University, Dept of Biology')] },
      { year: Y - 8, authors: [author('Jane Smith', 'Old Postdoc University, Dept of Biology')] },
      { year: Y, authors: [author('Jane Smith', 'New Faculty University, Dept of Chemistry')] },
    ];
    const hist = DiscoveryService.collectAffiliationHistory(articles, ['Jane Smith']);
    // Recency-best pick is only New Faculty — but history retains Old Postdoc too.
    expect(hist.some((a) => /New Faculty University/.test(a))).toBe(true);
    expect(hist.some((a) => /Old Postdoc University/.test(a))).toBe(true);
    // Most-recent-first ordering.
    expect(hist[0]).toMatch(/New Faculty University/);
  });

  test('empty when no name variants match', () => {
    const articles = [{ year: Y, authors: [author('Someone Else', 'X University')] }];
    expect(DiscoveryService.collectAffiliationHistory(articles, ['Jane Smith'])).toEqual([]);
  });
});
