/**
 * Characterization suite for estimateCost (Stage 7 / cost cluster of the
 * ContactEnrichmentService decomposition,
 * docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * estimateCost already has route-level coverage (reviewer-enrich-contacts-route);
 * this pins the exact cost math directly so the Stage-7 move to
 * lib/services/contact-enrichment/cost.js is a verified behavior-freeze.
 */

const { ContactEnrichmentService: S } = require('../../lib/services/contact-enrichment-service');

const mk = (n) => Array.from({ length: n }, (_, i) => ({ name: `c${i}` }));

describe('ContactEnrichmentService.estimateCost (characterization)', () => {
  it('free-only: no paid ops, zero cost, free counts = total', () => {
    expect(S.estimateCost(mk(4))).toEqual({
      total: 4, freeOperations: 4, paidOperations: 0, estimatedCost: 0,
      breakdown: {
        pubmed: { count: 4, cost: 0 }, orcid: { count: 4, cost: 0 },
        claude_search: { count: 0, cost: 0 }, serp_search: { count: 0, cost: 0 },
      },
    });
  });

  it('claude only: ~50% (ceil) claude searches at CLAUDE_WEB_SEARCH each', () => {
    const e = S.estimateCost(mk(4), { useClaudeSearch: true });
    expect(e.paidOperations).toBe(2);
    expect(e.breakdown.claude_search).toEqual({ count: 2, cost: 0.03 });
    expect(e.estimatedCost).toBeCloseTo(0.03, 10);
  });

  it('serp only: ~50% (ceil) serp searches at SERP_GOOGLE_SEARCH each', () => {
    const e = S.estimateCost(mk(4), { useSerpSearch: true });
    expect(e.breakdown.serp_search).toEqual({ count: 2, cost: 0.01 });
    expect(e.estimatedCost).toBeCloseTo(0.01, 10);
  });

  it('both: claude on ~50%, then serp on ~20% of that remainder', () => {
    const e = S.estimateCost(mk(10), { useClaudeSearch: true, useSerpSearch: true });
    expect(e.breakdown.claude_search).toEqual({ count: 5, cost: 0.075 });
    expect(e.breakdown.serp_search).toEqual({ count: 1, cost: 0.005 });
    expect(e.paidOperations).toBe(6);
    expect(e.estimatedCost).toBeCloseTo(0.08, 10);
  });
});
