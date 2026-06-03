/**
 * relevance-score — the single source of truth for reviewer-candidate relevance
 * scoring + ranking. Pure (Math + arrays only, no I/O, no other deps) so it can
 * run on the server (DeduplicationService.rankByRelevance delegates here, used by
 * the /discover ranking) AND in the browser (the Workbench Find tab re-ranks the
 * enriched candidate list client-side).
 *
 * Why a client re-rank exists: /discover ranks BEFORE contact enrichment runs, so
 * at server-rank time h-index/citations are unknown (0). The Workbench fetches
 * bibliometrics during enrichment (post-discover), then re-applies this same
 * scoring so those metrics actually influence the displayed order. Sharing the
 * function keeps the two call sites from drifting.
 *
 * Field aliases are accepted on purpose: the discover path tags candidates
 * `isClaudeSuggestion` / `source: 'claude_suggestion'` / `affiliation` /
 * `expertiseAreas`; the legacy dedup-merge path used `claudeSuggested` /
 * `primaryAffiliation` / `keywords` / `sources[]`. Both are honored.
 */

function scoreRelevance(researcher, proposalKeywords = []) {
  let score = 0;

  // Claude-suggested bonus (25 points) — explicitly identified from the proposal's
  // cited work.
  if (researcher.claudeSuggested || researcher.isClaudeSuggestion || researcher.source === 'claude_suggestion') {
    score += 25;
  }

  // Publication count (0-20 points) — rewards active researchers.
  const pubCount = researcher.publications?.length || 0;
  score += Math.min(pubCount * 5, 20);

  // Identity gate (Phase 2): bibliometrics only count toward relevance when the
  // identity resolver trusts the match (confirmed/probable). A wrong-but-rich
  // profile must not float to the top on borrowed metrics. Default trusted when
  // no verdict is attached (e.g. the pre-enrichment /discover server-rank, where
  // h-index is 0 anyway) so this never regresses the existing ranking.
  const identityStatus = researcher.identityStatus || researcher.contactEnrichment?.identity?.status || null;
  const identityTrusted = !identityStatus || identityStatus === 'confirmed' || identityStatus === 'probable';

  if (identityTrusted) {
    // h-index contribution (0-20 points) — real values arrive via the
    // google_scholar_author enrichment fetch (was always 0 before S211).
    score += Math.min(researcher.hIndex || 0, 20);

    // Citation contribution (0-15 points, log scale).
    const citations = researcher.totalCitations || 0;
    score += citations > 0 ? Math.min(Math.log10(citations) * 5, 15) : 0;
  }

  // Has affiliation bonus (10 points) — indicates an identified researcher.
  if (researcher.primaryAffiliation || researcher.affiliation) {
    score += 10;
  }

  // Multiple sources bonus (0-10 points) — corroborates identity. Discover
  // candidates carry a single `source` string plus `verificationSource` rather
  // than a `sources[]` array — derive a distinct count from whatever is present
  // (so a Claude suggestion verified in PubMed scores 2, not 1).
  const sourceCount = Array.isArray(researcher.sources)
    ? researcher.sources.length
    : new Set([researcher.source, researcher.verificationSource].filter(Boolean)).size || 1;
  score += Math.min(sourceCount * 5, 10);

  // Keyword match bonus (0-10 points).
  const candidateKeywords = researcher.keywords || researcher.expertiseAreas;
  if (proposalKeywords.length > 0 && Array.isArray(candidateKeywords)) {
    const matchingKeywords = proposalKeywords.filter((kw) =>
      candidateKeywords.some(
        (rk) =>
          rk.toLowerCase().includes(kw.toLowerCase()) ||
          kw.toLowerCase().includes(rk.toLowerCase())
      )
    );
    score += Math.min(matchingKeywords.length * 3, 10);
  }

  return score;
}

/**
 * Rank researchers by relevance to the proposal (descending). Returns new objects
 * with `relevanceScore` attached; the input array is not mutated.
 */
function rankByRelevance(researchers, proposalKeywords = []) {
  if (!Array.isArray(researchers)) return [];
  return researchers
    .map((researcher) => ({ ...researcher, relevanceScore: scoreRelevance(researcher, proposalKeywords) }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

module.exports = { scoreRelevance, rankByRelevance };
