/**
 * @jest-environment node
 *
 * Phase 2: scoreRelevance must NOT count bibliometrics (h-index/citations) when
 * the identity resolver doesn't trust the match — a wrong-but-rich profile can't
 * float to the top on borrowed metrics. Trusted (confirmed/probable) or no-verdict
 * (pre-enrichment discover) → metrics count as before.
 */
const { scoreRelevance } = require('../../lib/utils/relevance-score');

const base = { name: 'X', hIndex: 20, totalCitations: 10000, affiliation: 'MIT' };

describe('scoreRelevance — identity gate on bibliometrics', () => {
  test('no identity verdict → metrics count (backward-compatible, e.g. discover server-rank)', () => {
    const withMetrics = scoreRelevance(base);
    const noMetrics = scoreRelevance({ ...base, hIndex: 0, totalCitations: 0 });
    expect(withMetrics).toBeGreaterThan(noMetrics);
  });

  test('probable → metrics count', () => {
    const probable = scoreRelevance({ ...base, identityStatus: 'probable' });
    const stripped = scoreRelevance({ ...base, hIndex: 0, totalCitations: 0, identityStatus: 'probable' });
    expect(probable).toBeGreaterThan(stripped);
  });

  test('unresolved → h-index + citations excluded', () => {
    const unresolved = scoreRelevance({ ...base, identityStatus: 'unresolved' });
    const noMetrics = scoreRelevance({ ...base, hIndex: 0, totalCitations: 0, identityStatus: 'unresolved' });
    expect(unresolved).toBe(noMetrics); // metrics contributed nothing
  });

  test('ambiguous and rejected also exclude metrics', () => {
    const noMetrics = scoreRelevance({ ...base, hIndex: 0, totalCitations: 0, identityStatus: 'ambiguous' });
    expect(scoreRelevance({ ...base, identityStatus: 'ambiguous' })).toBe(noMetrics);
    expect(scoreRelevance({ ...base, identityStatus: 'rejected' })).toBe(noMetrics);
  });

  test('reads status from contactEnrichment.identity too', () => {
    const viaCe = scoreRelevance({ ...base, contactEnrichment: { identity: { status: 'unresolved' } } });
    const noMetrics = scoreRelevance({ ...base, hIndex: 0, totalCitations: 0, identityStatus: 'unresolved' });
    expect(viaCe).toBe(noMetrics);
  });
});
