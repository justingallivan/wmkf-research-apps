/**
 * DiscoveryService coauthor-COI cluster — Stage 4 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * PubMed-based coauthorship detection between a candidate reviewer and the proposal authors,
 * the COI grading (S238: tier on the strongest single-author tie, not the total), the PubMed
 * author-name formatter, and the batched parallel COI check across candidates. Extracted VERBATIM
 * from discovery-service.js as a behavior-freeze — internal `this.X` self-calls became direct
 * function calls; `COAUTHOR_COI_STRONG_MIN`, and the env-derived `NCBI_API_KEY` / `PUBMED_DELAY`,
 * come from ./constants. `gradeCoauthorCOI` lives here with its only caller (plan Q3). The facade
 * delegates each method here.
 *
 * Depends on ./constants, ../pubmed-service. Characterization net:
 * tests/unit/discovery-coauthor-coi.test.js (+ gradeCoauthorCOI in discovery-track-b-identity.test.js).
 */

const { COAUTHOR_COI_STRONG_MIN, NCBI_API_KEY, PUBMED_DELAY } = require('./constants');
const { PubMedService } = require('../pubmed-service');

/**
 * Grade a coauthor-COI relationship (S238). Tiers on the STRONGEST single co-author tie
 * (sustained 2-person collaboration = real conflict) rather than the total across authors.
 * Returns 'likely' (>= COAUTHOR_COI_STRONG_MIN shared papers with one author), 'possible'
 * (1..threshold-1), or null (no shared papers).
 */
function gradeCoauthorCOI({ hasCoauthorship, maxSharedWithOneAuthor } = {}) {
  if (!hasCoauthorship) return null;
  return (maxSharedWithOneAuthor || 0) >= COAUTHOR_COI_STRONG_MIN ? 'likely' : 'possible';
}

async function checkCoauthorHistory(candidateName, proposalAuthors) {
  if (!proposalAuthors || proposalAuthors.length === 0) {
    return { hasCoauthorship: false, coauthorships: [] };
  }

  const coauthorships = [];

  for (const proposalAuthor of proposalAuthors) {
    const cleanAuthorName = proposalAuthor
      .replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '')
      .trim();

    if (!cleanAuthorName || cleanAuthorName.toLowerCase() === 'not specified') {
      continue;
    }

    // Convert names to PubMed format: "LastName FirstInitial" works best
    const candidatePubmedName = toPubMedAuthorFormat(candidateName);
    const authorPubmedName = toPubMedAuthorFormat(cleanAuthorName);

    // Search PubMed for papers coauthored by both
    // Use format: "LastName FI[Author]" which is more reliable
    const query = `${candidatePubmedName}[Author] AND ${authorPubmedName}[Author]`;

    try {
      const articles = await PubMedService.search(query, 10);

      if (articles && articles.length > 0) {
        coauthorships.push({
          proposalAuthor: proposalAuthor,
          paperCount: articles.length,
          recentPapers: articles.slice(0, 3).map(a => ({
            title: a.title,
            year: a.year,
            pmid: a.pmid,
            url: a.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}` : null
          }))
        });
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, PUBMED_DELAY));
    } catch (error) {
      console.warn(`Error checking coauthorship for ${candidateName} & ${proposalAuthor}:`, error.message);
    }
  }

  // Grade the relationship by the STRONGEST single co-author tie (S238): a sustained
  // 2-person collaboration (many shared papers with one proposal author) is a real
  // conflict, while a single shared paper is often an incidental hub artifact — a
  // corresponding-author invites two collaborators onto one large paper. Max-per-author
  // separates "sustained relationship" from "co-appeared once"; total is kept for display.
  const sharedPaperTotal = coauthorships.reduce((s, co) => s + (co.paperCount || 0), 0);
  const maxSharedWithOneAuthor = coauthorships.reduce((m, co) => Math.max(m, co.paperCount || 0), 0);
  return {
    hasCoauthorship: coauthorships.length > 0,
    coauthorships,
    sharedPaperTotal,
    maxSharedWithOneAuthor
  };
}

/**
 * Convert a name to PubMed author search format
 * "Forest Rohwer" -> "Rohwer F"; "Dr. Mya Breitbart" -> "Breitbart M"
 */
function toPubMedAuthorFormat(name) {
  const cleanName = name
    .replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '')
    .trim();

  const parts = cleanName.split(/\s+/);
  if (parts.length < 2) {
    return cleanName; // Return as-is if can't parse
  }

  // Get last name (last part)
  const lastName = parts[parts.length - 1];
  // Get first initial
  const firstInitial = parts[0][0].toUpperCase();

  return `${lastName} ${firstInitial}`;
}

/**
 * Check coauthorship for multiple candidates in parallel batches (with rate limiting),
 * attaching coauthorship info + the S238 COI grade to each candidate.
 */
async function checkCoauthorshipsForCandidates(candidates, proposalAuthors, onProgress = () => {}) {
  if (!proposalAuthors || proposalAuthors.length === 0) {
    return candidates;
  }

  // Process in parallel batches - 5 with API key, 2 without
  // Each candidate check may make multiple queries (one per proposal author)
  // So we're conservative: 5 candidates * 2 authors = 10 queries max per batch
  const BATCH_SIZE = NCBI_API_KEY ? 5 : 2;
  const results = [];

  // Process candidates in batches
  // Index-bearing batch loop; not consolidated onto lib/utils/chunk.js (needs i). See docs/CHUNK_CONSOLIDATION_PLAN.md.
  for (let batchStart = 0; batchStart < candidates.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, candidates.length);
    const batch = candidates.slice(batchStart, batchEnd);

    onProgress({
      stage: 'coi_check',
      status: 'checking',
      message: `Checking COI for candidates ${batchStart + 1}-${batchEnd} of ${candidates.length}...`
    });

    // Process batch in parallel
    const batchPromises = batch.map(async (candidate) => {
      const coauthorInfo = await checkCoauthorHistory(candidate.name, proposalAuthors);
      return {
        ...candidate,
        coauthorships: coauthorInfo.coauthorships,
        // Keep the binary flag for all existing consumers (notes, counts, save).
        hasCoauthorCOI: coauthorInfo.hasCoauthorship,
        // S238 grading (additive): 'likely' = a strong single-author tie (>= threshold
        // shared papers) → a real COI; 'possible' = 1..threshold-1 → may be incidental
        // (e.g. a shared large-collaboration paper), surfaced softer to protect the
        // methods/technique experts who accumulate hub co-authorships.
        coauthorSharedPaperTotal: coauthorInfo.sharedPaperTotal,
        coauthorMaxWithOneAuthor: coauthorInfo.maxSharedWithOneAuthor,
        coauthorCOIStrength: gradeCoauthorCOI(coauthorInfo)
      };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Rate limit between batches (not after last batch)
    if (batchEnd < candidates.length) {
      await new Promise(resolve => setTimeout(resolve, PUBMED_DELAY * 2));
    }
  }

  return results;
}

module.exports = {
  gradeCoauthorCOI,
  checkCoauthorHistory,
  toPubMedAuthorFormat,
  checkCoauthorshipsForCandidates,
};
