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

  test('real h-index and citations now contribute (were always 0 before the enrichment fetch)', () => {
    const [withMetrics] = DeduplicationService.rankByRelevance([
      { name: 'A', hIndex: 30, totalCitations: 10000 },
    ]);
    const [without] = DeduplicationService.rankByRelevance([{ name: 'B' }]);
    // h-index capped at 20, citations log10(10000)*5 = 20 capped at 15 → +35 total.
    expect(withMetrics.relevanceScore - without.relevanceScore).toBe(35);
  });

  test('sorts by descending relevanceScore', () => {
    const ranked = DeduplicationService.rankByRelevance([
      { name: 'low', source: 'pubmed_discovery' },
      { name: 'high', isClaudeSuggestion: true, affiliation: 'MIT', hIndex: 40 },
    ]);
    expect(ranked[0].name).toBe('high');
    expect(ranked[1].name).toBe('low');
  });
});
