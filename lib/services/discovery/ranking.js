/**
 * DiscoveryService ranking cluster — Stage 4 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * Combine the verified + discovered candidate sets, backfill the 5-year publication count for
 * Track-B candidates so the recency-weighted ranker does not structurally bury them, rank by
 * relevance, and sort AI-flagged off-topic candidates last (surfaced, never dropped — S238).
 * Extracted VERBATIM from discovery-service.js as a behavior-freeze — internal
 * `this.countRecentPublications` became the imported function from ./publications; provenance +
 * dedup utilities from the shared libs. The facade delegates this method here.
 *
 * Depends on ./publications, ../deduplication-service, ../../utils/reviewer-provenance.
 * Characterization net: tests/unit/discovery-track-b-identity.test.js (rankAllCandidates).
 */

const { countRecentPublications } = require('./publications');
const { DeduplicationService } = require('../deduplication-service');
const { withReviewerProvenance } = require('../../utils/reviewer-provenance');

function rankAllCandidates(discoveryResults, keywords = []) {
  const { verified, discovered } = discoveryResults;

  // Combine all candidates
  const allCandidates = [
    ...verified.map(c => withReviewerProvenance({ ...c, isClaudeSuggestion: true })),
    ...discovered.map(c => withReviewerProvenance({ ...c, isClaudeSuggestion: false }))
  ];

  // Backfill publicationCount5yr for Track B (discovered) candidates so they
  // aren't structurally buried by the recency-weighted ranker (Codex S223 Q4).
  // Track A already sets it from its FULL article set (pre-slice) — do NOT
  // recompute there, only fill when absent (its `publications` is sliced to 5,
  // which would undercount). Track B's value is its merged-pubs count.
  for (const c of allCandidates) {
    if (!Number.isFinite(c.publicationCount5yr)) {
      c.publicationCount5yr = countRecentPublications(c.publications || []);
    }
  }

  // Use deduplication service's ranking
  const ranked = DeduplicationService.rankByRelevance(allCandidates, keywords);
  // S238: candidates the reasoning pass flagged off-topic are SURFACED but sorted
  // last (kept, not dropped) so they never crowd out relevant ones. Stable within
  // each partition (rankByRelevance already ordered them).
  const offTopic = ranked.filter((c) => c.aiFlaggedNotRelevant);
  if (offTopic.length === 0) return ranked;
  return [...ranked.filter((c) => !c.aiFlaggedNotRelevant), ...offTopic];
}

module.exports = {
  rankAllCandidates,
};
