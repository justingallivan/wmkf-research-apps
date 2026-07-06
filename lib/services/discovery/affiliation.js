/**
 * DiscoveryService affiliation cluster — Stage 2 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * Recency-weighted extraction of an author's current institution from retrieved article
 * bylines, plus the full affiliation HISTORY used for former-institution COI checks, and
 * the institution-name normalizer that groups spelling variants. Extracted VERBATIM from
 * discovery-service.js as a behavior-freeze — internal `this.X` self-calls became direct
 * function calls; author-name matching (`normalizeNameForMatch`, `namesMatch`) is imported
 * from ./name-matching. The DiscoveryService facade delegates each method here.
 *
 * Depends only on ./name-matching (no other discovery module, no external service).
 * Characterization net: tests/unit/discovery-affiliation-recency.test.js.
 */

const { normalizeNameForMatch, namesMatch } = require('./name-matching');

/**
 * Extract the author's best (recency-weighted current) affiliation. With no author name,
 * falls back to any substantial affiliation from the most recent article.
 */
function extractBestAffiliation(articles, authorName = null) {
  if (!authorName) {
    // Fallback: return any affiliation from most recent article
    const sortedArticles = [...articles].sort((a, b) => (b.year || 0) - (a.year || 0));
    for (const article of sortedArticles) {
      if (article.authors) {
        for (const author of article.authors) {
          if (author.affiliation && author.affiliation.length > 10) {
            return author.affiliation;
          }
        }
      }
    }
    return null;
  }

  return _recencyWeightedAffiliation(articles, [authorName]);
}

/**
 * Core recency-weighted affiliation picker, matching an author against ANY of
 * the supplied name variants (so multi-variant aggregates in one pass rather
 * than returning the first variant with any hit — Codex S223). Weight per
 * institution = Σ 1/(currentYear − pubYear + 1); undated papers count as old.
 * The displayed string is taken from the most recent matching paper.
 */
function _affiliationWeightsMap(articles, nameVariants) {
  const currentYear = new Date().getFullYear();
  const normalizedVariants = (nameVariants || [])
    .map((v) => normalizeNameForMatch(v))
    .filter(Boolean);
  if (normalizedVariants.length === 0) return new Map();

  const weights = new Map(); // normalizedInstitution -> { weight, fullText, year }

  for (const article of articles) {
    if (!article.authors) continue;
    const year = Number(article.year) || null;
    const age = year ? Math.max(0, currentYear - year) : 10; // undated → old-ish
    const weight = 1 / (age + 1);

    for (const author of article.authors) {
      const normalizedAuthorName = normalizeNameForMatch(author.name);
      if (!normalizedVariants.some((v) => namesMatch(v, normalizedAuthorName))) continue;
      if (!(author.affiliation && author.affiliation.length > 10)) continue;

      const key = normalizeAffiliationForComparison(author.affiliation);
      const entry = weights.get(key) || { weight: 0, fullText: author.affiliation, year: year || 0 };
      entry.weight += weight;
      if ((year || 0) >= entry.year) {
        entry.fullText = author.affiliation; // keep the most-recent paper's text
        entry.year = year || 0;
      }
      weights.set(key, entry);
    }
  }

  return weights;
}

function _recencyWeightedAffiliation(articles, nameVariants) {
  const weights = _affiliationWeightsMap(articles, nameVariants);
  if (weights.size === 0) return null;

  let best = null;
  let bestWeight = -1;
  for (const [, data] of weights) {
    if (data.weight > bestWeight) {
      bestWeight = data.weight;
      best = data.fullText;
    }
  }
  return best;
}

/**
 * All DISTINCT affiliations the author has published under, across all
 * articles (the affiliation HISTORY — not just the recency-best current pick),
 * most-recent-first. Used to flag a FORMER shared institution with the PI
 * (e.g. a reviewer who has since moved) — a real COI the current-affiliation
 * check structurally misses, because the recency weighting deliberately keeps
 * only the latest institution. See markInstitutionCOI.
 */
function collectAffiliationHistory(articles, nameVariants) {
  const weights = _affiliationWeightsMap(articles, nameVariants);
  return [...weights.values()]
    .sort((a, b) => (b.year || 0) - (a.year || 0))
    .map((d) => d.fullText)
    .filter(Boolean);
}

/**
 * Normalize affiliation string for comparison
 * Extracts the core institution name to group similar affiliations
 */
function normalizeAffiliationForComparison(affiliation) {
  if (!affiliation) return '';

  // Convert to lowercase
  let normalized = affiliation.toLowerCase();

  // Remove common suffixes like email addresses, department details
  normalized = normalized.replace(/\s*\.\s*\S+@\S+/g, ''); // Remove emails
  normalized = normalized.replace(/,?\s*(usa|united states|uk|france|germany|canada)\.?$/i, ''); // Remove country

  // Extract university/institution name (usually first part before comma or department)
  // Look for patterns like "University of X" or "X University" or "X Institute"
  const uniMatch = normalized.match(/(university of [^,]+|[^,]+ university|[^,]+ institute of technology|[^,]+ institute)/i);
  if (uniMatch) {
    return uniMatch[1].trim();
  }

  // Fallback: take first 50 chars
  return normalized.substring(0, 50).trim();
}

/**
 * Extract the best affiliation trying multiple name variants
 * Useful when searching for Will/William/W Harcombe
 */
function extractBestAffiliationMultiVariant(articles, nameVariants) {
  if (!nameVariants || nameVariants.length === 0) {
    return extractBestAffiliation(articles, null);
  }

  // Aggregate across ALL variants in a single recency-weighted pass (do not
  // return-first-variant — that hid a better/more-recent affiliation found
  // under a later spelling variant). Fall back to any affiliation.
  return _recencyWeightedAffiliation(articles, nameVariants)
    || extractBestAffiliation(articles, null);
}

module.exports = {
  extractBestAffiliation,
  _affiliationWeightsMap,
  _recencyWeightedAffiliation,
  collectAffiliationHistory,
  normalizeAffiliationForComparison,
  extractBestAffiliationMultiVariant,
};
