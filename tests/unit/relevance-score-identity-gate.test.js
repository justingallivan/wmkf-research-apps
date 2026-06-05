/**
 * @jest-environment node
 *
 * S223: cumulative bibliometrics (h-index / total citations) are EXCLUDED from
 * the rank order entirely — they are longevity-biased and bury the current
 * active expert. They stay on the candidate for identity corroboration + human
 * display only. (This supersedes the Phase-2 "identity gate on bibliometrics in
 * the score" — the metrics simply aren't in the score anymore, regardless of
 * identity status, so there is nothing for that gate to do.)
 */
const { scoreRelevance } = require('../../lib/utils/relevance-score');

const base = { name: 'X', affiliation: 'MIT', publicationCount5yr: 4 };

describe('scoreRelevance — bibliometrics excluded from the rank order', () => {
  test('h-index / citations never change the score (no identity verdict)', () => {
    const withMetrics = scoreRelevance({ ...base, hIndex: 80, totalCitations: 500000 });
    const without = scoreRelevance(base);
    expect(withMetrics).toBe(without);
  });

  test('excluded regardless of identity status (probable / unresolved / ambiguous / rejected)', () => {
    const without = scoreRelevance(base);
    for (const identityStatus of ['probable', 'unresolved', 'ambiguous', 'rejected']) {
      const withMetrics = scoreRelevance({ ...base, hIndex: 50, totalCitations: 99999, identityStatus });
      expect(withMetrics).toBe(without);
    }
  });

  test('recent activity, not citations, drives the score', () => {
    const active = scoreRelevance({ name: 'A', publicationCount5yr: 5 });
    const dormantSuperstar = scoreRelevance({ name: 'B', publicationCount5yr: 0, hIndex: 90, totalCitations: 1e6 });
    expect(active).toBeGreaterThan(dormantSuperstar);
  });

  test('falls back to counting publications[].year when publicationCount5yr is absent', () => {
    const yr = new Date().getFullYear();
    const recent = scoreRelevance({ name: 'A', publications: [{ year: yr }, { year: yr - 1 }, { year: yr - 2 }] });
    const old = scoreRelevance({ name: 'B', publications: [{ year: yr - 20 }, { year: yr - 21 }] });
    expect(recent).toBeGreaterThan(old);
  });
});
