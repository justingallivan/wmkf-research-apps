/**
 * ContactEnrichmentService — cost estimation.
 *
 * Stage 7 of the ContactEnrichmentService decomposition
 * (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md). Behavior-freeze, pure
 * code motion: `estimateCost` moved verbatim out of contact-enrichment-service.js.
 * DAG leaf — depends only on the COSTS constant.
 */

const { COSTS } = require('./constants');

function estimateCost(candidates, options = {}) {
  const { useClaudeSearch = false, useSerpSearch = false } = options;

  const estimate = {
    total: candidates.length,
    freeOperations: candidates.length, // PubMed + ORCID are free
    paidOperations: 0,
    estimatedCost: 0,
    breakdown: {
      pubmed: { count: candidates.length, cost: 0 },
      orcid: { count: candidates.length, cost: 0 },
      claude_search: { count: 0, cost: 0 },
      serp_search: { count: 0, cost: 0 },
    },
  };

  let estimatedNeedingPaidSearch = candidates.length * 0.5; // ~50% might need paid search

  if (useClaudeSearch) {
    // Estimate that ~50% of candidates might need Claude search
    // (those where PubMed and ORCID don't find contact info)
    const estimatedClaudeSearches = Math.ceil(estimatedNeedingPaidSearch);
    estimate.breakdown.claude_search = {
      count: estimatedClaudeSearches,
      cost: estimatedClaudeSearches * COSTS.CLAUDE_WEB_SEARCH,
    };
    estimate.paidOperations += estimatedClaudeSearches;
    estimate.estimatedCost += estimate.breakdown.claude_search.cost;

    // If Claude search is enabled, Tier 4 only runs for candidates where Claude failed
    // Estimate ~20% of those needing Claude search might still need Tier 4
    estimatedNeedingPaidSearch = estimatedNeedingPaidSearch * 0.2;
  }

  if (useSerpSearch) {
    // If no Claude search, ~50% need SerpAPI
    // If Claude search is enabled, only ~10% of total (20% of 50%) need SerpAPI
    const estimatedSerpSearches = Math.ceil(estimatedNeedingPaidSearch);
    estimate.breakdown.serp_search = {
      count: estimatedSerpSearches,
      cost: estimatedSerpSearches * COSTS.SERP_GOOGLE_SEARCH,
    };
    estimate.paidOperations += estimatedSerpSearches;
    estimate.estimatedCost += estimate.breakdown.serp_search.cost;
  }

  return estimate;
}

module.exports = { estimateCost };
