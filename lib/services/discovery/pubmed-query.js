/**
 * DiscoveryService PubMed author-query builders — Stage 3 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * Build the PubMed `[Author]` + date-window query strings used to verify a suggested reviewer,
 * with an optional expertise-disambiguated variant for common names. Extracted VERBATIM from
 * discovery-service.js as a behavior-freeze — the only change is reading `YEARS_LOOKBACK` from
 * ./constants instead of `this.YEARS_LOOKBACK`. The DiscoveryService facade delegates each method.
 *
 * Depends only on ./constants (YEARS_LOOKBACK). Characterization net:
 * tests/unit/discovery-pubmed-query.test.js.
 */

const { YEARS_LOOKBACK } = require('./constants');

/** Build a PubMed author query: `Name[Author] AND (fromYear:thisYear[pdat])`. */
function buildAuthorQuery(name) {
  // Clean up the name
  const cleanName = name
    .replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '')
    .trim();

  // Add author field and date filter
  const cutoffYear = new Date().getFullYear() - YEARS_LOOKBACK;
  return `${cleanName}[Author] AND (${cutoffYear}:${new Date().getFullYear()}[pdat])`;
}

/**
 * Build a disambiguated author query using expertise areas
 * This helps find the right "Jessica Green" by including topic keywords
 */
function buildDisambiguatedAuthorQuery(suggestion) {
  const cleanName = suggestion.name
    .replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '')
    .trim();

  const cutoffYear = new Date().getFullYear() - YEARS_LOOKBACK;

  // Get expertise keywords (take first 2-3 terms)
  let expertiseTerms = [];
  if (suggestion.expertiseAreas && Array.isArray(suggestion.expertiseAreas)) {
    expertiseTerms = suggestion.expertiseAreas
      .slice(0, 2)
      .map(e => e.split(/[\s,]+/).slice(0, 2).join(' ')) // Take first 2 words of each
      .filter(e => e.length > 2);
  }

  // Build query: name + expertise terms
  if (expertiseTerms.length > 0) {
    const expertiseQuery = expertiseTerms
      .map(term => `(${term}[Title/Abstract])`)
      .join(' OR ');
    return `${cleanName}[Author] AND (${expertiseQuery}) AND (${cutoffYear}:${new Date().getFullYear()}[pdat])`;
  }

  // Fallback to just name
  return `${cleanName}[Author] AND (${cutoffYear}:${new Date().getFullYear()}[pdat])`;
}

module.exports = {
  buildAuthorQuery,
  buildDisambiguatedAuthorQuery,
};
