/**
 * DiscoveryService - Stage 2 of Expert Reviewer Finder
 *
 * Orchestrates the two-track discovery process:
 * - Track A: Verify Claude's reviewer suggestions via database searches
 * - Track B: Discover new candidates from search queries
 *
 * Uses PubMed, ArXiv, BioRxiv, and ChemRxiv (all free APIs)
 */

const { PubMedService } = require('./pubmed-service');
const { ArXivService } = require('./arxiv-service');
const { BioRxivService } = require('./biorxiv-service');
const { ChemRxivService } = require('./chemrxiv-service');
const { DeduplicationService } = require('./deduplication-service');

// Enable verbose logging only in development with DEBUG_REVIEWER_FINDER env var
const DEBUG = process.env.DEBUG_REVIEWER_FINDER === 'true';

// PubMed rate limiting: 10 req/sec with API key, 3 req/sec without
const NCBI_API_KEY = process.env.NCBI_API_KEY;
const PUBMED_DELAY = NCBI_API_KEY ? 100 : 350;

class DiscoveryService {
  // Minimum publications in last 5 years to be considered "active"
  static MIN_PUBLICATIONS = 3;
  static YEARS_LOOKBACK = 5;
  static VERIFICATION_STATUSES = {
    UNRESOLVED: 'unresolved',
    AMBIGUOUS: 'ambiguous',
    PROBABLE: 'probable',
    VERIFIED: 'verified',
  };

  static NICKNAME_MAP = {
    will: 'William',
    bill: 'William',
    bob: 'Robert',
    rob: 'Robert',
    mike: 'Michael',
    jim: 'James',
    joe: 'Joseph',
    tom: 'Thomas',
    dan: 'Daniel',
    dave: 'David',
    ed: 'Edward',
    ted: 'Edward',
    ben: 'Benjamin',
    matt: 'Matthew',
    chris: 'Christopher',
    alex: 'Alexander',
    nick: 'Nicholas',
    tony: 'Anthony',
    steve: 'Steven',
    tim: 'Timothy',
    sam: 'Samuel',
    andy: 'Andrew',
    drew: 'Andrew',
    pete: 'Peter',
    pat: 'Patrick',
    greg: 'Gregory',
    phil: 'Philip',
    ken: 'Kenneth',
    kate: 'Katherine',
    kathy: 'Katherine',
    cathy: 'Catherine',
    liz: 'Elizabeth',
    beth: 'Elizabeth',
    sue: 'Susan',
    jenny: 'Jennifer',
    jen: 'Jennifer',
    meg: 'Margaret',
    maggie: 'Margaret',
    peg: 'Margaret',
    sally: 'Sarah',
    vicky: 'Victoria',
    vic: 'Victoria',
    nicky: 'Nicole',
  };

  /**
   * Main discovery function - runs both tracks
   *
   * @param {Object} analysisResult - Result from Stage 1 Claude analysis
   * @param {Object} options - Discovery options
   * @param {boolean} options.searchPubmed - Search PubMed (default: true)
   * @param {boolean} options.searchArxiv - Search ArXiv (default: true)
   * @param {boolean} options.searchBiorxiv - Search BioRxiv (default: true)
   * @param {boolean} options.searchChemrxiv - Search ChemRxiv (default: true)
   * @param {Function} options.onProgress - Progress callback
   * @returns {Promise<Object>} Combined discovery results
   */
  static async discover(analysisResult, options = {}) {
    const {
      searchPubmed = true,
      searchArxiv = true,
      searchBiorxiv = true,
      searchChemrxiv = true,
      onProgress = () => {}
    } = options;

    const results = {
      verified: [],      // Claude suggestions verified in databases
      unverified: [],    // Claude suggestions not found
      discovered: [],    // New candidates from database searches
      stats: {
        claudeSuggestionsTotal: 0,
        claudeSuggestionsVerified: 0,
        candidatesFromPubmed: 0,
        candidatesFromArxiv: 0,
        candidatesFromBiorxiv: 0,
        candidatesFromChemrxiv: 0,
        totalBeforeDedup: 0,
        totalAfterDedup: 0,
        filteredByCOI: 0
      }
    };

    const { proposalInfo, reviewerSuggestions, searchQueries } = analysisResult;

    results.stats.claudeSuggestionsTotal = reviewerSuggestions?.length || 0;

    // ============================================
    // TRACK A: Verify Claude's Suggestions
    // ============================================
    onProgress({
      stage: 'discovery',
      track: 'A',
      status: 'starting',
      message: `Verifying ${reviewerSuggestions?.length || 0} Claude suggestions...`
    });

    if (reviewerSuggestions && reviewerSuggestions.length > 0) {
      const verificationResults = await this.verifyClaudeSuggestions(
        reviewerSuggestions,
        (progress) => onProgress({ ...progress, track: 'A' })
      );

      results.verified = verificationResults.verified;
      results.unverified = verificationResults.unverified;
      results.stats.claudeSuggestionsVerified = verificationResults.verified.length;
    }

    // ============================================
    // TRACK B: Discover New Candidates
    // ============================================
    onProgress({
      stage: 'discovery',
      track: 'B',
      status: 'starting',
      message: 'Searching databases for additional candidates...'
    });

    const allDiscovered = [];

    // Search PubMed
    if (searchPubmed && searchQueries?.pubmed?.length > 0) {
      onProgress({
        stage: 'discovery',
        track: 'B',
        status: 'searching',
        message: 'Searching PubMed...',
        source: 'pubmed'
      });

      const pubmedCandidates = await this.searchPubMed(searchQueries.pubmed, onProgress);
      allDiscovered.push(...pubmedCandidates);
      results.stats.candidatesFromPubmed = pubmedCandidates.length;
    }

    // Search ArXiv
    if (searchArxiv && searchQueries?.arxiv?.length > 0) {
      onProgress({
        stage: 'discovery',
        track: 'B',
        status: 'searching',
        message: 'Searching ArXiv...',
        source: 'arxiv'
      });

      const arxivCandidates = await this.searchArXiv(searchQueries.arxiv, onProgress);
      allDiscovered.push(...arxivCandidates);
      results.stats.candidatesFromArxiv = arxivCandidates.length;
    }

    // Search BioRxiv
    if (searchBiorxiv && searchQueries?.biorxiv?.length > 0) {
      onProgress({
        stage: 'discovery',
        track: 'B',
        status: 'searching',
        message: 'Searching BioRxiv...',
        source: 'biorxiv'
      });

      const biorxivCandidates = await this.searchBioRxiv(searchQueries.biorxiv, onProgress);
      allDiscovered.push(...biorxivCandidates);
      results.stats.candidatesFromBiorxiv = biorxivCandidates.length;
    }

    // Search ChemRxiv
    if (searchChemrxiv && searchQueries?.chemrxiv?.length > 0) {
      onProgress({
        stage: 'discovery',
        track: 'B',
        status: 'searching',
        message: 'Searching ChemRxiv...',
        source: 'chemrxiv'
      });

      const chemrxivCandidates = await this.searchChemRxiv(searchQueries.chemrxiv, onProgress);
      allDiscovered.push(...chemrxivCandidates);
      results.stats.candidatesFromChemrxiv = chemrxivCandidates.length;
    }

    results.stats.totalBeforeDedup = allDiscovered.length;

    // ============================================
    // Deduplicate and Filter
    // ============================================
    onProgress({
      stage: 'discovery',
      status: 'deduplicating',
      message: `Deduplicating ${allDiscovered.length} candidates...`
    });

    // Remove candidates that match verified Claude suggestions
    const verifiedNames = results.verified.map(v => v.name.toLowerCase());
    const newCandidates = allDiscovered.filter(c =>
      !verifiedNames.some(vn =>
        DeduplicationService.areNamesSimilar(c.name, vn)
      )
    );

    // Deduplicate among discovered candidates
    const deduplicated = await DeduplicationService.deduplicateAndStore(newCandidates);

    results.stats.totalAfterDedup = deduplicated.length;

    // Filter by COI (exclude author's institution)
    const authorInstitution = proposalInfo?.authorInstitution;
    const filtered = DeduplicationService.filterConflicts(
      deduplicated,
      authorInstitution
    );

    results.stats.filteredByCOI = deduplicated.length - filtered.length;

    // Filter by minimum publications
    const qualified = filtered.filter(c =>
      (c.publications?.length || 0) >= this.MIN_PUBLICATIONS
    );

    results.discovered = qualified;

    onProgress({
      stage: 'discovery',
      status: 'complete',
      message: `Discovery complete: ${results.verified.length} verified, ${results.discovered.length} discovered`
    });

    return results;
  }

  /**
   * Track A: Verify Claude's suggestions via PubMed
   *
   * Uses expertise areas from Claude to disambiguate common names.
   * Searches with name + expertise keywords to find the right person.
   */
  static async verifyClaudeSuggestions(suggestions, onProgress) {
    const verified = [];
    const unverified = [];

    // Always log verification start
    console.log(`[Verification] Starting verification of ${suggestions.length} candidates`);

    for (let i = 0; i < suggestions.length; i++) {
      const suggestion = suggestions[i];

      onProgress({
        stage: 'verification',
        status: 'verifying',
        message: `Verifying ${suggestion.name} (${i + 1}/${suggestions.length})...`
      });

      // W5 caller migration: the previous Postgres-researchers cache check
      // (DatabaseService.findResearcher → early-return with `verified:
      // 'database'`) was a PubMed-cost optimization. After W1+W2 cutover
      // there is no name-keyed cache (Dataverse `wmkf_potentialreviewer`
      // is email-keyed; we don't have email at this discovery stage).
      // PubMed is fast; removing the cache check eliminates a stale-data
      // hazard at a small perf cost. A future match-on-discovery pass
      // (post-pilot) can reintroduce a Dataverse-backed cache against
      // `contact` once email lookup is available earlier in the flow.

      // Try multiple name variants to handle nicknames (Will -> William)
      const nameVariants = this.generateNameVariants(suggestion.name);
      let allSimpleArticles = [];
      let allDisambiguatedArticles = [];

      for (const nameVariant of nameVariants) {
        // Simple author search for this variant
        const simpleQuery = this.buildAuthorQuery(nameVariant);
        console.log(`[Verification] ${suggestion.name}: Querying PubMed (simple) for variant "${nameVariant}"`);
        try {
          const simpleArticles = await PubMedService.search(simpleQuery, 30);
          console.log(`[Verification] ${suggestion.name}: Simple search returned ${simpleArticles.length} articles`);
          allSimpleArticles.push(...simpleArticles);
        } catch (err) {
          console.error(`[Verification] ${suggestion.name}: Simple search FAILED:`, err.message);
        }
        await new Promise(resolve => setTimeout(resolve, PUBMED_DELAY));

        // Disambiguated search with expertise for this variant
        const suggestionVariant = { ...suggestion, name: nameVariant };
        const disambiguatedQuery = this.buildDisambiguatedAuthorQuery(suggestionVariant);
        console.log(`[Verification] ${suggestion.name}: Querying PubMed (disambiguated) for variant "${nameVariant}"`);
        try {
          const disambiguatedArticles = await PubMedService.search(disambiguatedQuery, 20);
          console.log(`[Verification] ${suggestion.name}: Disambiguated search returned ${disambiguatedArticles.length} articles`);
          allDisambiguatedArticles.push(...disambiguatedArticles);
        } catch (err) {
          console.error(`[Verification] ${suggestion.name}: Disambiguated search FAILED:`, err.message);
        }
        await new Promise(resolve => setTimeout(resolve, PUBMED_DELAY));
      }

      // CRITICAL: Filter results to only include papers where our target is actually an author
      // This fixes the cache problem where "Will Harcombe" cached results include "Helen Harcombe"
      // Filter against ALL name variants
      const filteredSimple = this.filterToMatchingAuthorMultiVariant(allSimpleArticles, nameVariants);
      const filteredDisambiguated = this.filterToMatchingAuthorMultiVariant(allDisambiguatedArticles, nameVariants);

      if (DEBUG) {
        console.log(`[${suggestion.name}] Search results: simple=${allSimpleArticles.length}, disambiguated=${allDisambiguatedArticles.length}`);
        console.log(`[${suggestion.name}] After author filter: simple=${filteredSimple.length}, disambiguated=${filteredDisambiguated.length}`);
      }

      // Deduplicate by PMID
      const dedupeByPmid = (articles) => {
        const seen = new Set();
        return articles.filter(a => {
          if (!a.pmid || seen.has(a.pmid)) return false;
          seen.add(a.pmid);
          return true;
        });
      };

      const dedupedSimple = dedupeByPmid(filteredSimple);
      const dedupedDisambiguated = dedupeByPmid(filteredDisambiguated);

      if (DEBUG) {
        console.log(`[${suggestion.name}] After dedup: simple=${dedupedSimple.length}, disambiguated=${dedupedDisambiguated.length}`);
      }

      // Use whichever gives better results
      let finalArticles;
      let selectionReason;
      if (dedupedDisambiguated.length >= this.MIN_PUBLICATIONS) {
        // Prefer disambiguated if it has enough results (more relevant)
        finalArticles = dedupedDisambiguated;
        selectionReason = 'disambiguated';
      } else if (dedupedSimple.length >= this.MIN_PUBLICATIONS) {
        // Filter simple results by expertise relevance
        const relevantSimple = this.filterByExpertiseRelevance(dedupedSimple, suggestion.expertiseAreas);
        finalArticles = relevantSimple.length >= this.MIN_PUBLICATIONS ? relevantSimple : dedupedSimple;
        selectionReason = relevantSimple.length >= this.MIN_PUBLICATIONS ? 'relevantSimple' : 'simple';
      } else {
        // Take whatever we have
        finalArticles = dedupedSimple.length > dedupedDisambiguated.length ? dedupedSimple : dedupedDisambiguated;
        selectionReason = 'fallback';
      }

      if (DEBUG) {
        console.log(`[${suggestion.name}] Final: ${finalArticles.length} articles (${selectionReason}), need ${this.MIN_PUBLICATIONS}`);
      }

      if (finalArticles.length >= this.MIN_PUBLICATIONS) {
        // Extract affiliation for this specific author (not just any author on the paper)
        // Try all name variants to find the best affiliation
        const affiliation = this.extractBestAffiliationMultiVariant(finalArticles, nameVariants);

        // Calculate a confidence score based on expertise match
        const expertiseMatch = this.calculateExpertiseMatch(finalArticles, suggestion.expertiseAreas);

        // Check if verified institution matches Claude's suggested institution
        // This helps catch cases where we verified the wrong person with the same name
        const institutionMismatch = this.checkInstitutionMismatch(
          affiliation,
          suggestion.suggestedInstitution
        );

        // Check if Claude's claimed expertise terms appear in publications
        const expertiseMismatchResult = this.checkExpertiseMismatch(
          finalArticles,
          suggestion.expertiseAreas
        );

        const nameEvidence = this.evaluateNameEvidence(suggestion.name, finalArticles);
        const demotionReasons = [];
        if (!nameEvidence.hasFullForenameMatch) {
          demotionReasons.push(nameEvidence.reason || 'No returned author full forename matches the suggested full forename');
        }

        const verificationStatus = demotionReasons.length === 0
          ? this.VERIFICATION_STATUSES.VERIFIED
          : this.VERIFICATION_STATUSES.UNRESOLVED;

        const candidate = {
          ...suggestion,
          verified: verificationStatus === this.VERIFICATION_STATUSES.VERIFIED,
          verificationStatus,
          identityStatus: verificationStatus,
          verificationSource: 'pubmed',
          verificationConfidence: expertiseMatch,
          verificationReason: verificationStatus === this.VERIFICATION_STATUSES.VERIFIED
            ? 'PubMed publications matched the suggested full forename and surname'
            : demotionReasons.join('; '),
          nameEvidence,
          affiliation: affiliation || suggestion.affiliation,
          // Full affiliation history (most-recent-first) so a FORMER shared
          // institution with the PI is caught by markInstitutionCOI even after
          // the reviewer has moved (the current `affiliation` is recency-best only).
          affiliationHistory: this.collectAffiliationHistory(finalArticles, nameVariants),
          institutionMismatch: institutionMismatch,
          expertiseMismatch: expertiseMismatchResult.hasMismatch,
          expertiseMismatchDetails: expertiseMismatchResult.hasMismatch ? {
            claimedTerms: expertiseMismatchResult.claimedTerms,
            matchedTerms: expertiseMismatchResult.matchedTerms
          } : null,
          publications: finalArticles.slice(0, 5).map(a => ({
            title: a.title,
            year: a.year,
            pmid: a.pmid,
            journal: a.journal,
            url: a.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}` : null
          })),
          publicationCount5yr: this.countRecentPublications(finalArticles),
          source: 'claude_suggestion'
        };

        console.log(`[Verification] ${suggestion.name}: ${verificationStatus.toUpperCase()} with ${finalArticles.length} publications (confidence: ${Math.round(expertiseMatch * 100)}%)`);
        if (institutionMismatch) {
          console.log(`[Verification] ${suggestion.name}: ⚠️ INSTITUTION MISMATCH - Claude suggested "${suggestion.suggestedInstitution}", PubMed found "${affiliation}"`);
        }
        if (expertiseMismatchResult.hasMismatch) {
          console.log(`[Verification] ${suggestion.name}: ⚠️ EXPERTISE MISMATCH - Claude claimed "${suggestion.expertiseAreas?.join(', ')}" but no publications match these terms`);
        }
        if (!nameEvidence.hasFullForenameMatch) {
          console.log(`[Verification] ${suggestion.name}: ⚠️ NAME EVIDENCE WEAK - ${nameEvidence.reason}`);
        }
        if (DEBUG && expertiseMatch < 0.35) {
          console.log(`[${suggestion.name}] Low expertise match: ${Math.round(expertiseMatch * 100)}% - accepting (has ${finalArticles.length} publications)`);
        }

        if (verificationStatus === this.VERIFICATION_STATUSES.VERIFIED) {
          verified.push(candidate);
        } else {
          unverified.push({
            ...candidate,
            verified: false,
            reason: candidate.verificationReason,
          });
        }
      } else {
        const reason = finalArticles.length === 0
          ? 'No publications found matching expertise'
          : `Only ${finalArticles.length} relevant publications (minimum: ${this.MIN_PUBLICATIONS})`;
        console.log(`[Verification] ${suggestion.name}: REJECTED - ${reason}`);
        unverified.push({
          ...suggestion,
          verified: false,
          verificationStatus: this.VERIFICATION_STATUSES.UNRESOLVED,
          identityStatus: this.VERIFICATION_STATUSES.UNRESOLVED,
          reason
        });
      }
    }

    console.log(`[Verification] Complete: ${verified.length} verified, ${unverified.length} unverified`);
    return { verified, unverified };
  }

  /**
   * Track B: Search PubMed with generated queries
   */
  static async searchPubMed(queries, onProgress) {
    const candidates = [];
    const cutoffYear = new Date().getFullYear() - this.YEARS_LOOKBACK;

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
            candidates.push({
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
            });
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

  /**
   * Track B: Search ArXiv with generated queries
   */
  static async searchArXiv(queries, onProgress) {
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
            candidates.push({
              name: typeof seniorAuthor === 'string' ? seniorAuthor : seniorAuthor.name,
              publications: [{
                title: article.title,
                year: article.year,
                arxivId: article.arxivId,
                doi: article.doi,
                url: article.arxivId ? `https://arxiv.org/abs/${article.arxivId}` : null
              }],
              source: 'arxiv'
            });
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

  /**
   * Track B: Search BioRxiv with generated queries
   */
  static async searchBioRxiv(queries, onProgress) {
    const candidates = [];

    // Import BioRxivService dynamically to handle potential missing dependency
    let BioRxivService;
    try {
      BioRxivService = require('./biorxiv-service').BioRxivService;
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
          candidates.push({
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
          });
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

  /**
   * Track B: Search ChemRxiv with generated queries
   */
  static async searchChemRxiv(queries, onProgress) {
    const candidates = [];

    // Import ChemRxivService dynamically to handle potential missing dependency
    let ChemRxivService;
    try {
      ChemRxivService = require('./chemrxiv-service').ChemRxivService;
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
          candidates.push({
            name: typeof authorName === 'string' ? authorName : authorName.name,
            affiliation: article.institution || undefined,
            publications: [{
              title: article.title,
              year: article.year,
              doi: article.doi,
              url: article.doi ? `https://doi.org/${article.doi}` : null
            }],
            source: 'chemrxiv'
          });
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

  /**
   * Build a PubMed author query
   */
  static buildAuthorQuery(name) {
    // Clean up the name
    const cleanName = name
      .replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '')
      .trim();

    // Add author field and date filter
    const cutoffYear = new Date().getFullYear() - this.YEARS_LOOKBACK;
    return `${cleanName}[Author] AND (${cutoffYear}:${new Date().getFullYear()}[pdat])`;
  }

  /**
   * Generate alternative name variants for PubMed search
   * "Will Harcombe" -> ["Will Harcombe", "William Harcombe", "W Harcombe"]
   * Handles common nickname expansions
   */
  static generateNameVariants(name) {
    const cleanName = name
      .replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '')
      .trim();

    const parts = cleanName.split(' ');
    if (parts.length < 2) return [cleanName];

    const firstName = parts[0];
    const restOfName = parts.slice(1).join(' ');
    const variants = [cleanName];

    // Try full name if we have a nickname
    const lowerFirst = firstName.toLowerCase();
    if (this.NICKNAME_MAP[lowerFirst]) {
      variants.push(`${this.NICKNAME_MAP[lowerFirst]} ${restOfName}`);
    }

    // Try initial + last name (common in PubMed)
    if (firstName.length > 1) {
      variants.push(`${firstName[0]} ${restOfName}`);
    }

    return variants;
  }

  /**
   * Build a disambiguated author query using expertise areas
   * This helps find the right "Jessica Green" by including topic keywords
   */
  static buildDisambiguatedAuthorQuery(suggestion) {
    const cleanName = suggestion.name
      .replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '')
      .trim();

    const cutoffYear = new Date().getFullYear() - this.YEARS_LOOKBACK;

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

  /**
   * Filter articles by expertise relevance
   * Checks if article titles/abstracts contain expertise keywords
   */
  static filterByExpertiseRelevance(articles, expertiseAreas) {
    if (!expertiseAreas || !Array.isArray(expertiseAreas) || expertiseAreas.length === 0) {
      return articles;
    }

    // Extract keywords from expertise areas
    const keywords = expertiseAreas
      .flatMap(area => area.toLowerCase().split(/[\s,]+/))
      .filter(word => word.length > 3); // Ignore short words

    if (keywords.length === 0) {
      return articles;
    }

    return articles.filter(article => {
      const searchText = `${article.title || ''} ${article.abstract || ''}`.toLowerCase();
      // Article must match at least one keyword
      return keywords.some(keyword => searchText.includes(keyword));
    });
  }

  /**
   * Calculate how well the found articles match the expected expertise
   * Returns a confidence score from 0 to 1
   *
   * More lenient matching for scientific terminology:
   * - Accepts single significant keyword matches
   * - Expands common scientific synonyms
   * - Gives partial credit for related terms
   */
  static calculateExpertiseMatch(articles, expertiseAreas) {
    if (!expertiseAreas || !Array.isArray(expertiseAreas) || expertiseAreas.length === 0) {
      return 0.5; // Unknown confidence - benefit of the doubt
    }

    if (articles.length === 0) {
      return 0;
    }

    // Common scientific synonyms to expand matching
    const synonyms = {
      'viral': ['virus', 'virology', 'viruses', 'phage', 'bacteriophage'],
      'virus': ['viral', 'virology', 'viruses', 'phage'],
      'virology': ['viral', 'virus', 'viruses'],
      'ecology': ['ecological', 'ecosystem', 'ecological'],
      'ecological': ['ecology', 'ecosystem'],
      'marine': ['ocean', 'oceanic', 'aquatic', 'sea'],
      'ocean': ['marine', 'oceanic', 'aquatic', 'sea'],
      'microbial': ['microbe', 'microbiome', 'bacterial', 'bacteria'],
      'microbe': ['microbial', 'microbiome', 'bacterial'],
      'bacteria': ['bacterial', 'microbial', 'microbe'],
      'bacterial': ['bacteria', 'microbial', 'microbe'],
      'evolution': ['evolutionary', 'evolve', 'evolved'],
      'evolutionary': ['evolution', 'evolve'],
      'phage': ['bacteriophage', 'viral', 'virus'],
      'bacteriophage': ['phage', 'viral', 'virus'],
      'population': ['populations', 'community', 'communities'],
      'community': ['communities', 'population', 'populations'],
      'dynamics': ['dynamic', 'interactions', 'interaction'],
      'modeling': ['model', 'models', 'mathematical', 'computational'],
      'model': ['modeling', 'models', 'mathematical'],
      'quantitative': ['mathematical', 'computational', 'modeling']
    };

    // Extract all unique keywords from expertise areas (with synonyms)
    const allKeywords = new Set();
    for (const area of expertiseAreas) {
      const words = area.toLowerCase().split(/[\s,]+/).filter(w => w.length > 3);
      for (const word of words) {
        allKeywords.add(word);
        // Add synonyms
        if (synonyms[word]) {
          synonyms[word].forEach(syn => allKeywords.add(syn));
        }
      }
    }

    const keywordArray = Array.from(allKeywords);

    // Count articles that match ANY keyword (more lenient)
    let matchingArticles = 0;
    let totalKeywordMatches = 0;

    for (const article of articles) {
      const searchText = `${article.title || ''} ${article.abstract || ''}`.toLowerCase();
      const matchedKeywords = keywordArray.filter(kw => searchText.includes(kw));

      if (matchedKeywords.length > 0) {
        matchingArticles++;
        totalKeywordMatches += matchedKeywords.length;
      }
    }

    // Calculate confidence:
    // - Base: percentage of articles with at least one keyword match
    // - Bonus: average keyword matches per article (capped at +20%)
    const baseConfidence = matchingArticles / articles.length;
    const avgMatches = totalKeywordMatches / articles.length;
    const bonus = Math.min(0.2, avgMatches * 0.05); // 5% per avg match, max 20% bonus

    const confidence = Math.min(1, baseConfidence + bonus);
    return Math.round(confidence * 100) / 100;
  }

  /**
   * Extract the best affiliation from a list of articles for a specific author.
   *
   * RECENCY-WEIGHTED (S223): each institution occurrence is weighted by
   * 1/(age+1), so a researcher's CURRENT affiliation (recent papers) outweighs a
   * dominant historical one. Previously this used MOST-COMMON, which mislabeled
   * people who recently moved — a new professor stayed tagged with their (more
   * prolific) postdoc lab. This is the PubMed fallback in the affiliation
   * authority chain (ORCID > Scholar > here); see
   * docs/REVIEWER_RECENCY_WEIGHTING_PLAN.md.
   *
   * @param {Array} articles - List of articles from PubMed
   * @param {string} authorName - The name of the author to find affiliation for
   * @returns {string|null} The author's affiliation, or null if not found
   */
  static extractBestAffiliation(articles, authorName = null) {
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

    return this._recencyWeightedAffiliation(articles, [authorName]);
  }

  /**
   * Core recency-weighted affiliation picker, matching an author against ANY of
   * the supplied name variants (so multi-variant aggregates in one pass rather
   * than returning the first variant with any hit — Codex S223). Weight per
   * institution = Σ 1/(currentYear − pubYear + 1); undated papers count as old.
   * The displayed string is taken from the most recent matching paper.
   */
  static _affiliationWeightsMap(articles, nameVariants) {
    const currentYear = new Date().getFullYear();
    const normalizedVariants = (nameVariants || [])
      .map((v) => this.normalizeNameForMatch(v))
      .filter(Boolean);
    if (normalizedVariants.length === 0) return new Map();

    const weights = new Map(); // normalizedInstitution -> { weight, fullText, year }

    for (const article of articles) {
      if (!article.authors) continue;
      const year = Number(article.year) || null;
      const age = year ? Math.max(0, currentYear - year) : 10; // undated → old-ish
      const weight = 1 / (age + 1);

      for (const author of article.authors) {
        const normalizedAuthorName = this.normalizeNameForMatch(author.name);
        if (!normalizedVariants.some((v) => this.namesMatch(v, normalizedAuthorName))) continue;
        if (!(author.affiliation && author.affiliation.length > 10)) continue;

        const key = this.normalizeAffiliationForComparison(author.affiliation);
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

  static _recencyWeightedAffiliation(articles, nameVariants) {
    const weights = this._affiliationWeightsMap(articles, nameVariants);
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
  static collectAffiliationHistory(articles, nameVariants) {
    const weights = this._affiliationWeightsMap(articles, nameVariants);
    return [...weights.values()]
      .sort((a, b) => (b.year || 0) - (a.year || 0))
      .map((d) => d.fullText)
      .filter(Boolean);
  }

  /**
   * Normalize affiliation string for comparison
   * Extracts the core institution name to group similar affiliations
   */
  static normalizeAffiliationForComparison(affiliation) {
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
  static extractBestAffiliationMultiVariant(articles, nameVariants) {
    if (!nameVariants || nameVariants.length === 0) {
      return this.extractBestAffiliation(articles, null);
    }

    // Aggregate across ALL variants in a single recency-weighted pass (do not
    // return-first-variant — that hid a better/more-recent affiliation found
    // under a later spelling variant). Fall back to any affiliation.
    return this._recencyWeightedAffiliation(articles, nameVariants)
      || this.extractBestAffiliation(articles, null);
  }

  /**
   * Filter articles to only include those where the target author is actually in the author list
   * This is critical to handle stale/incorrect cache data
   */
  static filterToMatchingAuthor(articles, targetName) {
    if (!articles || !targetName) return [];

    const normalizedTarget = this.normalizeNameForMatch(targetName);

    return articles.filter(article => {
      if (!article.authors) return false;

      // Check if the target author is in this article's author list
      return article.authors.some(author => {
        const normalizedAuthor = this.normalizeNameForMatch(author.name);
        return this.namesMatch(normalizedTarget, normalizedAuthor);
      });
    });
  }

  /**
   * Filter articles to include those where ANY of the name variants match an author
   * Used when searching for nickname variants (Will/William/W Harcombe)
   */
  static filterToMatchingAuthorMultiVariant(articles, nameVariants) {
    if (!articles || !nameVariants || nameVariants.length === 0) return [];

    const normalizedVariants = nameVariants.map(v => this.normalizeNameForMatch(v));

    return articles.filter(article => {
      if (!article.authors) return false;

      return article.authors.some(author => {
        const normalizedAuthor = this.normalizeNameForMatch(author.name);
        // Match if ANY variant matches this author
        return normalizedVariants.some(variant =>
          this.namesMatch(variant, normalizedAuthor)
        );
      });
    });
  }

  /**
   * Normalize a name for matching (lowercase, remove titles, etc.)
   */
  static normalizeNameForMatch(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/^(dr\.?|prof\.?|professor)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static firstNamesEquivalent(first1, first2) {
    if (!first1 || !first2) return false;
    const f1 = first1.toLowerCase();
    const f2 = first2.toLowerCase();
    if (f1 === f2) return true;
    return this.NICKNAME_MAP[f1]?.toLowerCase() === f2
      || this.NICKNAME_MAP[f2]?.toLowerCase() === f1;
  }

  static nameMatchEvidence(name1, name2) {
    const normalized1 = this.normalizeNameForMatch(name1);
    const normalized2 = this.normalizeNameForMatch(name2);
    if (!normalized1 || !normalized2) {
      return { matches: false, fullForenameMatch: false, initialOnly: false, reason: 'Missing name' };
    }

    const parts1 = normalized1.split(' ');
    const parts2 = normalized2.split(' ');
    const lastName1 = parts1[parts1.length - 1];
    const lastName2 = parts2[parts2.length - 1];
    if (lastName1 !== lastName2) {
      return { matches: false, fullForenameMatch: false, initialOnly: false, reason: 'Surnames differ' };
    }

    const first1 = parts1[0] || '';
    const first2 = parts2[0] || '';
    const first1IsInitial = first1.length <= 2;
    const first2IsInitial = first2.length <= 2;

    if (!first1IsInitial && !first2IsInitial && this.firstNamesEquivalent(first1, first2)) {
      return {
        matches: true,
        fullForenameMatch: true,
        initialOnly: false,
        matchedAuthorName: normalized2,
        reason: 'Full forename and surname matched',
      };
    }

    if (first1IsInitial && first2.toLowerCase().startsWith(first1.toLowerCase())) {
      return {
        matches: true,
        fullForenameMatch: false,
        initialOnly: true,
        matchedAuthorName: normalized2,
        reason: 'Only first initial matched the returned author forename',
      };
    }
    if (first2IsInitial && first1.toLowerCase().startsWith(first2.toLowerCase())) {
      return {
        matches: true,
        fullForenameMatch: false,
        initialOnly: true,
        matchedAuthorName: normalized2,
        reason: 'Returned author only provided a first initial',
      };
    }

    const firstInitial1 = first1[0]?.toLowerCase();
    const firstInitial2 = first2[0]?.toLowerCase();
    if (firstInitial1 && firstInitial2 && firstInitial1 === firstInitial2) {
      if ((parts1.length === 3 && parts2.length === 2) || (parts2.length === 3 && parts1.length === 2)) {
        return {
          matches: true,
          fullForenameMatch: false,
          initialOnly: true,
          matchedAuthorName: normalized2,
          reason: 'Only initials matched between author strings',
        };
      }
    }

    return {
      matches: false,
      fullForenameMatch: false,
      initialOnly: false,
      reason: 'Full forenames differ',
    };
  }

  /**
   * Check if two names match (handles initials, partial names)
   * More strict matching to avoid confusion between different people
   */
  static namesMatch(name1, name2, options = {}) {
    const { allowInitialOnly = true } = options;
    const evidence = this.nameMatchEvidence(name1, name2);
    if (!evidence.matches) return false;
    return allowInitialOnly || !evidence.initialOnly;
  }

  static evaluateNameEvidence(suggestedName, articles) {
    const evidence = {
      suggestedName: this.normalizeNameForMatch(suggestedName),
      hasFullForenameMatch: false,
      hasInitialOnlyMatch: false,
      matchedAuthorName: null,
      reason: 'No matching author byline found',
    };

    for (const article of articles || []) {
      for (const author of article.authors || []) {
        const match = this.nameMatchEvidence(suggestedName, author.name);
        if (!match.matches) continue;
        if (match.fullForenameMatch) {
          return {
            ...evidence,
            hasFullForenameMatch: true,
            hasInitialOnlyMatch: false,
            matchedAuthorName: match.matchedAuthorName || this.normalizeNameForMatch(author.name),
            reason: match.reason,
          };
        }
        if (match.initialOnly) {
          evidence.hasInitialOnlyMatch = true;
          evidence.matchedAuthorName = evidence.matchedAuthorName || match.matchedAuthorName || this.normalizeNameForMatch(author.name);
          evidence.reason = match.reason;
        }
      }
    }

    if (!evidence.hasInitialOnlyMatch) {
      evidence.reason = 'No returned author full forename matches the suggested full forename';
    }
    return evidence;
  }

  /**
   * Count publications in the last N years
   */
  static countRecentPublications(articles) {
    const cutoffYear = new Date().getFullYear() - this.YEARS_LOOKBACK;
    return articles.filter(a => (a.year || 0) >= cutoffYear).length;
  }

  /**
   * Check if the verified affiliation matches Claude's suggested institution
   * Returns true if there's a mismatch (potential wrong person)
   *
   * @param {string} verifiedAffiliation - Affiliation found via PubMed (e.g., "Department of Biology, University of Michigan, Ann Arbor, MI")
   * @param {string} suggestedInstitution - Institution Claude suggested (e.g., "University of Michigan")
   * @returns {boolean} True if there's a mismatch
   */
  static checkInstitutionMismatch(verifiedAffiliation, suggestedInstitution) {
    if (!verifiedAffiliation || !suggestedInstitution) {
      return false; // Can't check without both
    }

    const verifiedLower = verifiedAffiliation.toLowerCase();
    const suggestedLower = suggestedInstitution.toLowerCase();

    // Simple check first: does the suggested institution appear anywhere in the full affiliation?
    // This handles cases like "Department of X, University of Michigan" matching "University of Michigan"
    if (verifiedLower.includes(suggestedLower)) {
      return false; // Match - suggested institution is contained in affiliation
    }

    // Check for common abbreviations and variations
    const institutionAliases = {
      'mit': ['massachusetts institute of technology', 'mit'],
      'caltech': ['california institute of technology', 'caltech'],
      'uc berkeley': ['university of california berkeley', 'uc berkeley', 'ucb', 'berkeley'],
      'ucla': ['university of california los angeles', 'ucla'],
      'ucsf': ['university of california san francisco', 'ucsf'],
      'ucsd': ['university of california san diego', 'ucsd'],
      'ucd': ['university of california davis', 'uc davis', 'ucd'],
      'uci': ['university of california irvine', 'uc irvine', 'uci'],
      'stanford': ['stanford university', 'stanford'],
      'harvard': ['harvard university', 'harvard medical school', 'harvard'],
      'yale': ['yale university', 'yale school of medicine', 'yale'],
      'princeton': ['princeton university', 'princeton'],
      'columbia': ['columbia university', 'columbia'],
      'cornell': ['cornell university', 'weill cornell', 'cornell'],
      'upenn': ['university of pennsylvania', 'upenn', 'penn', 'perelman school'],
      'brandeis': ['brandeis university', 'brandeis'],
      'rockefeller': ['rockefeller university', 'rockefeller'],
      'hhmi': ['howard hughes medical institute', 'hhmi', 'janelia'],
      'nih': ['national institutes of health', 'nih', 'niehs', 'nimh', 'nci'],
      'wustl': ['washington university', 'wustl', 'wash u', 'washington university in st. louis'],
      'umich': ['university of michigan', 'umich', 'u-m', 'michigan'],
      'uw': ['university of washington', 'uw', 'u washington'],
      'wisc': ['university of wisconsin', 'uw-madison', 'wisconsin'],
      'jhu': ['johns hopkins', 'jhu', 'hopkins'],
      'duke': ['duke university', 'duke'],
      'unc': ['university of north carolina', 'unc', 'unc-chapel hill'],
      'emory': ['emory university', 'emory'],
      'vanderbilt': ['vanderbilt university', 'vanderbilt'],
      'northwestern': ['northwestern university', 'northwestern'],
      'uchicago': ['university of chicago', 'uchicago', 'u chicago'],
      'nyu': ['new york university', 'nyu'],
      'bu': ['boston university', 'bu'],
      'bc': ['boston college', 'bc'],
      'pitt': ['university of pittsburgh', 'pitt'],
      'osu': ['ohio state university', 'osu', 'ohio state'],
      'psu': ['penn state', 'pennsylvania state university', 'psu'],
      'msu': ['michigan state university', 'msu', 'michigan state'],
      'uva': ['university of virginia', 'uva'],
      'gt': ['georgia tech', 'georgia institute of technology'],
      'ut austin': ['university of texas at austin', 'ut austin', 'texas'],
      'ucsb': ['university of california santa barbara', 'ucsb'],
      'ucsc': ['university of california santa cruz', 'ucsc'],
      'scripps': ['scripps research', 'scripps institute', 'scripps'],
      'salk': ['salk institute', 'salk'],
      'broad': ['broad institute', 'broad'],
      'whitehead': ['whitehead institute', 'whitehead'],
      'cshl': ['cold spring harbor', 'cshl'],
      'mbl': ['marine biological laboratory', 'mbl', 'woods hole'],
    };

    // Check if both match any common alias
    for (const aliases of Object.values(institutionAliases)) {
      const verifiedMatches = aliases.some(a => verifiedLower.includes(a));
      const suggestedMatches = aliases.some(a => suggestedLower.includes(a));
      if (verifiedMatches && suggestedMatches) {
        return false; // Same institution via alias
      }
    }

    // Extract institution name from full affiliation string
    // Look for patterns like "University of X", "X University", "X Institute", etc.
    const extractInstitution = (text) => {
      const lower = text.toLowerCase();

      // Try to find university/institute patterns anywhere in the text
      const patterns = [
        /university of [\w\s]+/i,
        /[\w\s]+ university/i,
        /[\w\s]+ institute of technology/i,
        /[\w\s]+ institute/i,
        /[\w\s]+ college/i,
        /[\w\s]+ school of medicine/i,
        /[\w\s]+ medical school/i,
        /[\w\s]+ medical center/i,
      ];

      for (const pattern of patterns) {
        const match = lower.match(pattern);
        if (match) {
          return match[0].trim();
        }
      }

      return lower;
    };

    const verifiedInst = extractInstitution(verifiedLower);
    const suggestedInst = extractInstitution(suggestedLower);

    // Check if extracted institutions match
    if (verifiedInst.includes(suggestedInst) || suggestedInst.includes(verifiedInst)) {
      return false; // Match
    }

    // Check for significant word overlap (institution names often share key words)
    const getSignificantWords = (text) => {
      const stopWords = new Set(['of', 'the', 'at', 'in', 'and', 'for', 'school', 'department', 'dept', 'center', 'centre']);
      return text.split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w))
        .map(w => w.replace(/[^a-z]/g, ''));
    };

    const verifiedWords = getSignificantWords(verifiedInst);
    const suggestedWords = getSignificantWords(suggestedInst);
    const commonWords = verifiedWords.filter(w => suggestedWords.includes(w));

    // If they share the key institution word (e.g., "michigan", "stanford"), it's a match
    if (commonWords.length >= 1 && commonWords.some(w => w.length > 4)) {
      return false; // Enough overlap
    }

    // Institutions don't match
    return true;
  }

  /**
   * Check if Claude's claimed expertise terms appear in the candidate's publications
   * Returns mismatch info if none of the specific expertise terms are found
   *
   * @param {Array} publications - List of publications from PubMed
   * @param {string[]} claimedExpertise - Expertise areas Claude claimed
   * @returns {Object} { hasMismatch, claimedTerms, matchedTerms }
   */
  static checkExpertiseMismatch(publications, claimedExpertise) {
    if (!claimedExpertise || !Array.isArray(claimedExpertise) || claimedExpertise.length === 0) {
      return { hasMismatch: false, claimedTerms: [], matchedTerms: [] };
    }

    if (!publications || publications.length === 0) {
      return { hasMismatch: true, claimedTerms: claimedExpertise, matchedTerms: [] };
    }

    // Extract significant terms from Claude's expertise claims
    // Filter out very common/generic words
    const genericWords = new Set([
      'biology', 'research', 'science', 'study', 'analysis', 'methods',
      'molecular', 'cellular', 'genetic', 'genomic', 'protein', 'proteins',
      'mechanism', 'mechanisms', 'function', 'regulation', 'development',
      'evolution', 'evolutionary', 'structure', 'structural', 'model', 'models'
    ]);

    const claimedTerms = claimedExpertise
      .flatMap(area => {
        // Split by comma and common delimiters, then by spaces
        return area.toLowerCase()
          .split(/[,;\/]+/)
          .flatMap(part => {
            // Keep multi-word phrases that might be specific (e.g., "HnRNP proteins")
            const words = part.trim().split(/\s+/).filter(w => w.length > 3);
            // If it's a 2-3 word phrase, keep it as a phrase too
            if (words.length >= 2 && words.length <= 3) {
              return [...words, words.join(' ')];
            }
            return words;
          });
      })
      .filter(term => term.length > 4 && !genericWords.has(term))
      .filter((term, index, arr) => arr.indexOf(term) === index); // dedupe

    if (claimedTerms.length === 0) {
      // All terms were generic, can't check
      return { hasMismatch: false, claimedTerms: [], matchedTerms: [] };
    }

    // Combine all publication titles (and abstracts if available) into searchable text
    const titlesText = publications
      .map(p => `${p.title || ''} ${p.abstract || ''}`.toLowerCase())
      .join(' ');

    // Check which claimed terms appear in publications
    const matchedTerms = claimedTerms.filter(term => titlesText.includes(term));

    // Mismatch if NONE of the specific terms were found
    return {
      hasMismatch: matchedTerms.length === 0,
      claimedTerms,
      matchedTerms
    };
  }

  /**
   * Check for coauthorship history between a candidate and proposal authors
   *
   * @param {string} candidateName - Name of the reviewer candidate
   * @param {string[]} proposalAuthors - List of proposal author names
   * @returns {Promise<Object>} Coauthorship information
   */
  static async checkCoauthorHistory(candidateName, proposalAuthors) {
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
      const candidatePubmedName = this.toPubMedAuthorFormat(candidateName);
      const authorPubmedName = this.toPubMedAuthorFormat(cleanAuthorName);

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

    return {
      hasCoauthorship: coauthorships.length > 0,
      coauthorships
    };
  }

  /**
   * Convert a name to PubMed author search format
   * "Forest Rohwer" -> "Rohwer F"
   * "Dr. Mya Breitbart" -> "Breitbart M"
   */
  static toPubMedAuthorFormat(name) {
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
   * Check coauthorship for multiple candidates in parallel batches (with rate limiting)
   *
   * Processes candidates in parallel batches to speed up COI checks while
   * respecting PubMed rate limits (10 req/sec with API key, 3 req/sec without).
   *
   * @param {Array} candidates - List of verified candidates
   * @param {string[]} proposalAuthors - List of proposal author names
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Array>} Candidates with coauthorship info added
   */
  static async checkCoauthorshipsForCandidates(candidates, proposalAuthors, onProgress = () => {}) {
    if (!proposalAuthors || proposalAuthors.length === 0) {
      return candidates;
    }

    // Process in parallel batches - 5 with API key, 2 without
    // Each candidate check may make multiple queries (one per proposal author)
    // So we're conservative: 5 candidates * 2 authors = 10 queries max per batch
    const BATCH_SIZE = NCBI_API_KEY ? 5 : 2;
    const results = [];

    // Process candidates in batches
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
        const coauthorInfo = await this.checkCoauthorHistory(candidate.name, proposalAuthors);
        return {
          ...candidate,
          coauthorships: coauthorInfo.coauthorships,
          hasCoauthorCOI: coauthorInfo.hasCoauthorship
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

  /**
   * Combine and rank all candidates
   *
   * @param {Object} discoveryResults - Results from discover()
   * @param {string[]} keywords - Proposal keywords for relevance scoring
   * @returns {Array} Ranked list of all candidates
   */
  static rankAllCandidates(discoveryResults, keywords = []) {
    const { verified, discovered } = discoveryResults;

    // Combine all candidates
    const allCandidates = [
      ...verified.map(c => ({ ...c, isClaudeSuggestion: true })),
      ...discovered.map(c => ({ ...c, isClaudeSuggestion: false }))
    ];

    // Backfill publicationCount5yr for Track B (discovered) candidates so they
    // aren't structurally buried by the recency-weighted ranker (Codex S223 Q4).
    // Track A already sets it from its FULL article set (pre-slice) — do NOT
    // recompute there, only fill when absent (its `publications` is sliced to 5,
    // which would undercount). Track B's value is its merged-pubs count.
    for (const c of allCandidates) {
      if (!Number.isFinite(c.publicationCount5yr)) {
        c.publicationCount5yr = this.countRecentPublications(c.publications || []);
      }
    }

    // Use deduplication service's ranking
    return DeduplicationService.rankByRelevance(allCandidates, keywords);
  }
}

module.exports = { DiscoveryService };
