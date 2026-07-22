/**
 * DiscoveryService coauthor-COI cluster — Stage 4 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * PubMed-based coauthorship detection between a candidate reviewer and the proposal authors,
 * the COI grading (S238: tier on the strongest single-author tie, not the total), the PubMed
 * author-name formatter, and the bounded parallel COI check across candidates. Originally
 * extracted from discovery-service.js as a behavior-freeze; the facade delegates each method
 * here. `COAUTHOR_COI_STRONG_MIN` comes from ./constants. `gradeCoauthorCOI` lives here with its
 * only caller (plan Q3).
 *
 * Depends on ./constants, ../pubmed-service. Characterization net:
 * tests/unit/discovery-coauthor-coi.test.js (+ gradeCoauthorCOI in discovery-track-b-identity.test.js).
 */

const { COAUTHOR_COI_STRONG_MIN } = require('./constants');
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

function summarizeCoauthorChecks(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const coiCount = list.filter((candidate) => candidate?.hasCoauthorCOI).length;
  const incompleteCount = list.filter(
    (candidate) => candidate?.coauthorCheckStatus === 'incomplete'
  ).length;
  return {
    coiCount,
    incompleteCount,
    status: incompleteCount > 0 ? 'partial' : 'complete',
    message: incompleteCount > 0
      ? `PubMed coauthorship checks were incomplete for ${incompleteCount} candidate(s) after automatic retries`
      : coiCount > 0
        ? `Found ${coiCount} candidate(s) with coauthorship history`
        : 'No coauthorship conflicts found',
  };
}

async function checkCoauthorHistory(candidateName, proposalAuthors, { signal } = {}) {
  if (!proposalAuthors || proposalAuthors.length === 0) {
    return { hasCoauthorship: false, coauthorships: [] };
  }

  const coauthorships = [];
  const coauthorCheckFailures = [];

  for (const proposalAuthor of proposalAuthors) {
    if (signal?.aborted) {
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }

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
      // COI must distinguish "no shared papers" from "PubMed was unavailable".
      // PubMedService retries transient failures first; exhausted failures are
      // reconciled below as an explicit incomplete status.
      const articles = await PubMedService.search(query, 10, {
        throwOnError: true,
        ...(signal ? { signal } : {}),
      });

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
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) {
        throw error;
      }
      console.warn(`Error checking coauthorship for ${candidateName} & ${proposalAuthor}:`, error.message);
      coauthorCheckFailures.push({
        proposalAuthor,
        status: Number.isFinite(error?.status) ? error.status : null,
        reason: error?.status === 429 ? 'rate_limited' : 'unavailable',
      });
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
    maxSharedWithOneAuthor,
    coauthorCheckStatus: coauthorCheckFailures.length > 0 ? 'incomplete' : 'complete',
    coauthorCheckFailures,
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
 * Check coauthorship for multiple candidates in bounded parallel batches,
 * attaching coauthorship info + the S238 COI grade and completeness state to
 * each candidate. PubMed request pacing is centralized at its HTTP seam.
 */
async function checkCoauthorshipsForCandidates(
  candidates,
  proposalAuthors,
  onProgress = () => {},
  { signal } = {}
) {
  if (!proposalAuthors || proposalAuthors.length === 0) {
    return candidates;
  }

  // Bound candidate-level work without treating batch size as a rate limiter.
  // PubMedService serializes and paces every actual ESearch/EFetch request.
  const BATCH_SIZE = 5;
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
      const coauthorInfo = await checkCoauthorHistory(candidate.name, proposalAuthors, { signal });
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
        coauthorCOIStrength: gradeCoauthorCOI(coauthorInfo),
        coauthorCheckStatus: coauthorInfo.coauthorCheckStatus,
        coauthorCheckFailures: coauthorInfo.coauthorCheckFailures,
      };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

  }

  return results;
}

module.exports = {
  gradeCoauthorCOI,
  summarizeCoauthorChecks,
  checkCoauthorHistory,
  toPubMedAuthorFormat,
  checkCoauthorshipsForCandidates,
};
