/**
 * ContactEnrichmentService — shared constants.
 *
 * Stage 0 of the ContactEnrichmentService decomposition
 * (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md). Pure code motion,
 * behavior-freeze: these values moved verbatim out of contact-enrichment-service.js.
 * The facade re-exposes `COSTS` as a static prop (`ContactEnrichmentService.COSTS`)
 * for its internal reads; the other three are imported directly by the modules
 * that consume them.
 */

// A7 Part 6: output schema for the Tier-3 Claude web-search contact lookup.
// Validated after JSON.parse so an injected model cannot smuggle extra keys
// into the contact record.
const CLAUDE_WEB_SEARCH_SCHEMA = {
  type: 'object',
  fields: {
    email: { type: 'string', required: false, default: null, nullable: true, maxLength: 320 },
    facultyPageUrl: { type: 'string', required: false, default: null, nullable: true, maxLength: 2_000 },
    website: { type: 'string', required: false, default: null, nullable: true, maxLength: 2_000 },
  },
};

const SEARCH_EMAIL_SOURCES = new Set(['serp_search', 'claude_search']);
const EXPLICIT_EMAIL_PERSIST_SOURCES = new Set(['serp_search', 'claude_search', 'search_contested']);

// Cost estimates for UI display
// Haiku: $0.80/MTok input, $4/MTok output + $0.01/search
// SerpAPI: ~$50/5000 searches = $0.01 per search, but we use num=10 results so ~$0.005
const COSTS = {
  PUBMED: 0,
  ORCID: 0,
  CLAUDE_WEB_SEARCH: 0.015, // ~$0.01 search + ~$0.005 Haiku tokens
  SERP_GOOGLE_SEARCH: 0.005, // ~$0.005 per search (cheaper than Claude)
};

module.exports = {
  CLAUDE_WEB_SEARCH_SCHEMA,
  SEARCH_EMAIL_SOURCES,
  EXPLICIT_EMAIL_PERSIST_SOURCES,
  COSTS,
};
