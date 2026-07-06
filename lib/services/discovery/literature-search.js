/**
 * DiscoveryService literature-search cluster (Track B) — Stage 4 of the DiscoveryService
 * decomposition (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * The four scholarly-source searches that turn generated keyword queries into candidate
 * reviewers by extracting each paper's senior/corresponding author. This is Track-B ORIGINATION,
 * ARCHIVED OFF (TRACK_B_ENABLED=false, S248) — kept intact and dormant for future repurposing.
 * Extracted VERBATIM from discovery-service.js as a behavior-freeze — the only changes are reading
 * `YEARS_LOOKBACK` / `PUBMED_DELAY` from ./constants, provenance helpers from the shared util, and
 * adjusting the bioRxiv/chemRxiv lazy-require paths for this subdirectory (`../biorxiv-service`,
 * `../chemrxiv-service`). The facade delegates each method here.
 *
 * Depends on ./constants, ../pubmed-service, ../arxiv-service, (lazy) ../biorxiv-service,
 * ../chemrxiv-service, ../../utils/reviewer-provenance.
 * Characterization net: tests/unit/discovery-literature-search.test.js.
 */

const { YEARS_LOOKBACK, PUBMED_DELAY } = require('./constants');
const { PubMedService } = require('../pubmed-service');
const { ArXivService } = require('../arxiv-service');
const { PROVENANCE_KINDS, SEED_ROLES, withReviewerProvenance } = require('../../utils/reviewer-provenance');

async function searchPubMed(queries, onProgress) {
  const candidates = [];
  const cutoffYear = new Date().getFullYear() - YEARS_LOOKBACK;

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];

    onProgress({
      stage: 'discovery',
      track: 'B',
      status: 'searching',
      message: `PubMed query ${i + 1}/${queries.length}: "${query.substring(0, 40)}..."`,
      source: 'pubmed'
    });

    // Add date filter to query
    const dateQuery = `${query} AND (${cutoffYear}:${new Date().getFullYear()}[pdat])`;
    const articles = await PubMedService.search(dateQuery, 50);

    // Extract senior authors (last author of each paper)
    for (const article of articles) {
      if (article.authors && article.authors.length > 0) {
        const seniorAuthor = article.authors[article.authors.length - 1];
        if (seniorAuthor?.name) {
          candidates.push(withReviewerProvenance({
            name: seniorAuthor.name,
            affiliation: seniorAuthor.affiliation,
            publications: [{
              title: article.title,
              year: article.year,
              pmid: article.pmid,
              journal: article.journal,
              doi: article.doi,
              url: article.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}` : null
            }],
            source: 'pubmed'
          }, {
            kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED,
            sources: ['pubmed'],
            seedRole: SEED_ROLES.QUERY_SEED,
          }));
        }
      }
    }

    // Rate limit between queries
    if (i < queries.length - 1) {
      await new Promise(resolve => setTimeout(resolve, PUBMED_DELAY));
    }
  }

  // Log summary
  console.log(`[Discovery] PubMed search complete: ${candidates.length} candidates from ${queries.length} queries`);
  if (candidates.length > 0) {
    const uniqueNames = [...new Set(candidates.map(c => c.name))];
    console.log(`[Discovery] PubMed unique authors: ${uniqueNames.length}`, uniqueNames.slice(0, 5).join(', ') + (uniqueNames.length > 5 ? '...' : ''));
  }

  return candidates;
}

async function searchArXiv(queries, onProgress) {
  const candidates = [];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];

    onProgress({
      stage: 'discovery',
      track: 'B',
      status: 'searching',
      message: `ArXiv query ${i + 1}/${queries.length}: "${query.substring(0, 40)}..."`,
      source: 'arxiv'
    });

    const articles = await ArXivService.search(query, 50);

    // Extract senior authors
    for (const article of articles) {
      if (article.authors && article.authors.length > 0) {
        const seniorAuthor = article.authors[article.authors.length - 1];
        if (seniorAuthor) {
          candidates.push(withReviewerProvenance({
            name: typeof seniorAuthor === 'string' ? seniorAuthor : seniorAuthor.name,
            publications: [{
              title: article.title,
              year: article.year,
              arxivId: article.arxivId,
              doi: article.doi,
              url: article.arxivId ? `https://arxiv.org/abs/${article.arxivId}` : null
            }],
            source: 'arxiv'
          }, {
            kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED,
            sources: ['arxiv'],
            seedRole: SEED_ROLES.QUERY_SEED,
          }));
        }
      }
    }

    // Note: ArXiv service already has built-in 3000ms rate limiting per request
  }

  // Log summary
  console.log(`[Discovery] ArXiv search complete: ${candidates.length} candidates from ${queries.length} queries`);
  if (candidates.length > 0) {
    const uniqueNames = [...new Set(candidates.map(c => c.name))];
    console.log(`[Discovery] ArXiv unique authors: ${uniqueNames.length}`, uniqueNames.slice(0, 5).join(', ') + (uniqueNames.length > 5 ? '...' : ''));
  }

  return candidates;
}

async function searchBioRxiv(queries, onProgress) {
  const candidates = [];

  // Import BioRxivService dynamically to handle potential missing dependency
  let BioRxivService;
  try {
    BioRxivService = require('../biorxiv-service').BioRxivService;
  } catch {
    console.warn('BioRxiv service not available');
    return [];
  }

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];

    onProgress({
      stage: 'discovery',
      track: 'B',
      status: 'searching',
      message: `BioRxiv query ${i + 1}/${queries.length}: "${query.substring(0, 40)}..."`,
      source: 'biorxiv'
    });

    const articles = await BioRxivService.search(query, 50);

    // Extract senior authors
    // BioRxiv returns correspondingAuthor as name and institution as separate field
    for (const article of articles) {
      // Use corresponding author (typically the PI/lab head) - BioRxiv provides this directly
      const authorName = article.correspondingAuthor || (article.authors && article.authors[0]);
      if (authorName) {
        candidates.push(withReviewerProvenance({
          name: typeof authorName === 'string' ? authorName : authorName.name,
          // BioRxiv provides institution at article level, not author level
          affiliation: article.institution || undefined,
          publications: [{
            title: article.title,
            year: article.year,
            doi: article.doi,
            url: article.doi ? `https://doi.org/${article.doi}` : null
          }],
          source: 'biorxiv'
        }, {
          kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED,
          sources: ['biorxiv'],
          seedRole: SEED_ROLES.QUERY_SEED,
        }));
      }
    }

    // Note: BioRxiv service already has built-in 5000ms rate limiting per request
  }

  // Log summary
  console.log(`[Discovery] BioRxiv search complete: ${candidates.length} candidates from ${queries.length} queries`);
  if (candidates.length > 0) {
    const uniqueNames = [...new Set(candidates.map(c => c.name))];
    console.log(`[Discovery] BioRxiv unique authors: ${uniqueNames.length}`, uniqueNames.slice(0, 5).join(', ') + (uniqueNames.length > 5 ? '...' : ''));
  }

  return candidates;
}

async function searchChemRxiv(queries, onProgress) {
  const candidates = [];

  // Import ChemRxivService dynamically to handle potential missing dependency
  let ChemRxivService;
  try {
    ChemRxivService = require('../chemrxiv-service').ChemRxivService;
  } catch {
    console.warn('ChemRxiv service not available');
    return [];
  }

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];

    onProgress({
      stage: 'discovery',
      track: 'B',
      status: 'searching',
      message: `ChemRxiv query ${i + 1}/${queries.length}: "${query.substring(0, 40)}..."`,
      source: 'chemrxiv'
    });

    const articles = await ChemRxivService.search(query, 50);

    // Extract senior authors (corresponding author or first author)
    for (const article of articles) {
      const authorName = article.correspondingAuthor || (article.authors && article.authors[0]);
      if (authorName) {
        candidates.push(withReviewerProvenance({
          name: typeof authorName === 'string' ? authorName : authorName.name,
          affiliation: article.institution || undefined,
          publications: [{
            title: article.title,
            year: article.year,
            doi: article.doi,
            url: article.doi ? `https://doi.org/${article.doi}` : null
          }],
          source: 'chemrxiv'
        }, {
          kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED,
          sources: ['chemrxiv'],
          seedRole: SEED_ROLES.QUERY_SEED,
        }));
      }
    }

    // Small delay between queries to avoid rate limiting
    if (i < queries.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Log summary
  console.log(`[Discovery] ChemRxiv search complete: ${candidates.length} candidates from ${queries.length} queries`);
  if (candidates.length > 0) {
    const uniqueNames = [...new Set(candidates.map(c => c.name))];
    console.log(`[Discovery] ChemRxiv unique authors: ${uniqueNames.length}`, uniqueNames.slice(0, 5).join(', ') + (uniqueNames.length > 5 ? '...' : ''));
  }

  return candidates;
}

module.exports = {
  searchPubMed,
  searchArXiv,
  searchBioRxiv,
  searchChemRxiv,
};
