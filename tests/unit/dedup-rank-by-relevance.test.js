/**
 * @jest-environment node
 *
 * Guards the rankByRelevance scoring against the field-name regression fixed in
 * S211: the ranker read `claudeSuggested`/`primaryAffiliation`/`keywords`/`sources[]`
 * but discover-path candidates carry `isClaudeSuggestion`/`source`/`affiliation`/
 * `expertiseAreas`, so 4 of 7 score terms silently never fired. These tests assert
 * the terms now fire for the REAL candidate shape.
 */
const { DeduplicationService } = require('../../lib/services/deduplication-service');

describe('rankByRelevance — fires for the discover-path candidate shape', () => {
  test('Claude-suggested bonus fires via isClaudeSuggestion / source', () => {
    const [viaFlag] = DeduplicationService.rankByRelevance([{ name: 'A', isClaudeSuggestion: true }]);
    const [viaSource] = DeduplicationService.rankByRelevance([{ name: 'B', source: 'claude_suggestion' }]);
    const [neither] = DeduplicationService.rankByRelevance([{ name: 'C', source: 'pubmed_discovery' }]);
    // +25 Claude bonus, then +5 from the always-on single-source term.
    expect(viaFlag.relevanceScore).toBe(30);
    expect(viaSource.relevanceScore).toBe(30);
    // No Claude bonus: just the +5 single-source term.
    expect(neither.relevanceScore).toBe(5);
  });

  test('affiliation bonus fires off `affiliation` (not just primaryAffiliation)', () => {
    const [withAff] = DeduplicationService.rankByRelevance([{ name: 'A', affiliation: 'MIT' }]);
    const [without] = DeduplicationService.rankByRelevance([{ name: 'B' }]);
    expect(withAff.relevanceScore - without.relevanceScore).toBe(10);
  });

  test('keyword bonus fires off `expertiseAreas` against proposal keywords', () => {
    const candidate = { name: 'A', expertiseAreas: ['CRISPR gene editing', 'microbiome'] };
    const [matched] = DeduplicationService.rankByRelevance([candidate], ['CRISPR', 'genomics', 'microbiome']);
    const [noKeywords] = DeduplicationService.rankByRelevance([{ name: 'A' }], ['CRISPR', 'microbiome']);
    // 2 matching keywords × 3 = 6 points above the keyword-less baseline.
    expect(matched.relevanceScore - noKeywords.relevanceScore).toBe(6);
  });

  test('multi-source bonus counts distinct source + verificationSource', () => {
    const [twoSources] = DeduplicationService.rankByRelevance([
      { name: 'A', source: 'claude_suggestion', verificationSource: 'pubmed' },
    ]);
    const [oneSource] = DeduplicationService.rankByRelevance([
      { name: 'B', source: 'claude_suggestion' },
    ]);
    // Both get the +25 Claude bonus; the two-source candidate gets +10 vs +5.
    expect(twoSources.relevanceScore - oneSource.relevanceScore).toBe(5);
  });

  test('h-index and citations do NOT contribute to the score (S223 — longevity-biased, excluded)', () => {
    const [withMetrics] = DeduplicationService.rankByRelevance([
      { name: 'A', hIndex: 80, totalCitations: 500000 },
    ]);
    const [without] = DeduplicationService.rankByRelevance([{ name: 'B' }]);
    // Cumulative bibliometrics are excluded from the rank order — no delta.
    expect(withMetrics.relevanceScore).toBe(without.relevanceScore);
  });

  test('recent publication activity drives the score (publicationCount5yr)', () => {
    const [active] = DeduplicationService.rankByRelevance([{ name: 'A', publicationCount5yr: 5 }]);
    const [dormant] = DeduplicationService.rankByRelevance([{ name: 'B', publicationCount5yr: 0 }]);
    // 7 * min(5,5) = 35, above the single-source baseline (+5 each) → Δ 35.
    expect(active.relevanceScore - dormant.relevanceScore).toBe(35);
  });

  test('recency is pure-linear (7 pts/recent pub, capped at 35)', () => {
    const at = (n) => DeduplicationService.rankByRelevance([{ name: 'X', publicationCount5yr: n }])[0].relevanceScore;
    expect(at(1) - at(0)).toBe(7);   // linear step
    expect(at(3) - at(2)).toBe(7);   // still linear (no floor/step at 3)
    expect(at(5) - at(4)).toBe(7);   // up to the cap
    expect(at(8) - at(5)).toBe(0);   // capped at 5 pubs (35 pts)
    expect(at(-3)).toBe(at(0));      // negative count clamped to 0
  });

  test('a currently-active newcomer outranks a dormant superstar', () => {
    const ranked = DeduplicationService.rankByRelevance([
      { name: 'dormant-superstar', hIndex: 90, totalCitations: 1000000, publicationCount5yr: 0 },
      { name: 'active-newcomer', publicationCount5yr: 5 },
    ]);
    expect(ranked[0].name).toBe('active-newcomer');
  });

  test('sorts by descending relevanceScore', () => {
    const ranked = DeduplicationService.rankByRelevance([
      { name: 'low', source: 'pubmed_discovery' },
      { name: 'high', isClaudeSuggestion: true, affiliation: 'MIT', publicationCount5yr: 4 },
    ]);
    expect(ranked[0].name).toBe('high');
    expect(ranked[1].name).toBe('low');
  });
});
