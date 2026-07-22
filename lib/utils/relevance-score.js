/**
 * relevance-score — the single source of truth for reviewer-candidate relevance
 * scoring + ranking. Pure (Math + arrays only, no I/O, no other deps) so it can
 * run on the server (DeduplicationService.rankByRelevance delegates here, used by
 * the /discover ranking) AND in the browser (the Workbench Find tab re-ranks the
 * enriched candidate list client-side).
 *
 * Why a client re-rank exists: /discover ranks BEFORE enrichment, and enrichment
 * can refine the candidate (e.g. current affiliation, merged publications). The
 * Workbench re-applies this same scoring post-enrichment so the displayed order
 * reflects the refined fields. Sharing the function keeps the two sites from
 * drifting. NOTE (S223): the score is driven by RECENT in-area activity, NOT by
 * cumulative h-index/citations — those are longevity-biased and excluded from the
 * rank order (kept only for identity corroboration + human display). So the
 * server↔client divergence is small: recency comes from publication years, which
 * are known at /discover time, not from enrichment-only metrics.
 *
 * Field aliases are accepted on purpose: the discover path tags candidates
 * `isClaudeSuggestion` / `source: 'claude_suggestion'` / `affiliation` /
 * `expertiseAreas`; the legacy dedup-merge path used `claudeSuggested` /
 * `primaryAffiliation` / `keywords` / `sources[]`. Both are honored.
 */

const { hasGroundedProvenanceRankingBonus } = require('./reviewer-provenance');

function scoreRelevance(researcher, proposalKeywords = []) {
  let score = 0;

  // Grounded-provenance bonus (25 points) — reserved for cited-reference and
  // proposal-named candidates, not for legacy parametric Claude suggestions.
  if (hasGroundedProvenanceRankingBonus(researcher)) {
    score += 25;
  }

  // Recent activity (0-35 points) — the DOMINANT positive signal (S223). Reviewer
  // relevance is about being *currently active in the area*, not cumulative fame.
  // Cumulative citation metrics (h-index, total citations) are DELIBERATELY
  // EXCLUDED from the rank order: they are longevity-biased (older work has had
  // more years to accrue; h-index only ever grows) and bury the current active
  // expert — often a new professor, sparse-but-correct — under the dormant-but-
  // famous emeritus. h-index/citations remain ON the candidate for identity
  // corroboration + human-facing display (a seniority hint in the detail pane),
  // but never enter the score. See docs/REVIEWER_RECENCY_WEIGHTING_PLAN.md and
  // project-reviewer-ranking-recency-over-citations.
  // Pure linear in the last-5yr count, capped at 35 (7 pts/pub up to 5). Count
  // clamped to ≥0 so a corrupt negative `publicationCount5yr` can't drive the
  // score negative. (An earlier "activity floor" was dropped — S223: it was
  // inert above count=1 and reintroduced a seniority-ish step against the
  // recency-only intent.)
  const recentCount = Math.max(0, recentPublicationCount(researcher));
  score += Math.min(35, 7 * Math.min(recentCount, 5));

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

  // Coarse Fix 11: a PubMed verification can be identity-grounded by name while
  // its retrieved affiliation/publications conflict with suggested attributes.
  // Down-weight those composites until full source-attributed reconciliation exists.
  // TODO(Fix 11 full): replace with identity-redesign attribute reconciliation.
  if (researcher.verificationIncoherence || researcher.incoherentVerification) {
    score -= 15;
  }

  return Math.max(0, score);
}

/**
 * Rank researchers by relevance to the proposal (descending). Returns new objects
 * with `relevanceScore` attached; the input array is not mutated.
 */
function rankByRelevance(researchers, proposalKeywords = []) {
  if (!Array.isArray(researchers)) return [];
  const eligibilityBucket = (researcher) => {
    const status = researcher?.eligibilityStatus
      || researcher?.contactEnrichment?.eligibilityStatus
      || 'unknown';
    if (status === 'deceased') return 2;
    if (status === 'emeritus') return 1;
    return 0;
  };
  return researchers
    .map((researcher) => ({ ...researcher, relevanceScore: scoreRelevance(researcher, proposalKeywords) }))
    .sort((a, b) => (
      eligibilityBucket(a) - eligibilityBucket(b)
      || b.relevanceScore - a.relevanceScore
    ));
}

/**
 * Count of the candidate's publications in the last 5 years. Prefers the
 * precomputed `publicationCount5yr` (Track A sets it from the FULL article set
 * before truncation; Track B derives it from merged publications) — that path is
 * deterministic + pure. Falls back to counting `publications[].year` against a
 * current-year cutoff only when the field is absent.
 */
const YEARS_LOOKBACK = 5;
function recentPublicationCount(researcher) {
  if (Number.isFinite(researcher.publicationCount5yr)) {
    return researcher.publicationCount5yr;
  }
  const pubs = Array.isArray(researcher.publications) ? researcher.publications : [];
  if (pubs.length === 0) return 0;
  const cutoff = new Date().getFullYear() - YEARS_LOOKBACK;
  return pubs.filter((p) => (Number(p && p.year) || 0) >= cutoff).length;
}

module.exports = { scoreRelevance, rankByRelevance };
