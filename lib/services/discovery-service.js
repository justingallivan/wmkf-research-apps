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
const { ReviewerIdentityEvidence } = require('./reviewer-identity-evidence');
const { ReviewerWorkAuthorResolver, normalizeOrcid } = require('./reviewer-work-author-resolver');
const { OpenAlexService } = require('./openalex-service');
const { PROVENANCE_KINDS, SEED_ROLES, withReviewerProvenance } = require('../utils/reviewer-provenance');
const { ContactParser } = require('../utils/contact-parser');
const { chunk: chunked } = require('../utils/chunk.js');

// Shared discovery constants (Stage 0 extraction — docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
// Domain constants (below, re-exposed as static props) and the env-derived runtime config
// (DEBUG / NCBI_API_KEY / PUBMED_DELAY) now have a single source of truth in ./discovery/constants
// so the per-cluster modules extracted in later stages share one evaluation (plan constraints C1/C7).
const C = require('./discovery/constants');
const { DEBUG, NCBI_API_KEY, PUBMED_DELAY } = C;
// Stage 1: name-matching cluster extracted to ./discovery/name-matching; the methods below delegate.
const nameMatching = require('./discovery/name-matching');
// Stage 2: affiliation cluster extracted to ./discovery/affiliation; the methods below delegate.
const affiliation = require('./discovery/affiliation');
// Stage 3: research-area + pubmed-query + match-signals + provenance + publications clusters
// extracted to ./discovery/*; the methods below delegate.
const researchArea = require('./discovery/research-area');
const pubmedQuery = require('./discovery/pubmed-query');
const matchSignals = require('./discovery/match-signals');
const provenance = require('./discovery/provenance');
const publications = require('./discovery/publications');
// Stage 4: mid-tier clusters extracted to ./discovery/*; the methods below delegate.
const trackBIdentity = require('./discovery/track-b-identity');
const coauthorCoi = require('./discovery/coauthor-coi');
const literatureSearch = require('./discovery/literature-search');
const ranking = require('./discovery/ranking');
// Stage 5: Track-A verification hub extracted to ./discovery/verification; the methods below delegate.
const verification = require('./discovery/verification');

class DiscoveryService {
  // Domain constants now live in ./discovery/constants (Stage 0 — behavior-freeze; values unchanged).
  // Each is re-exposed as an OWN static property so external reads keep resolving
  // (DiscoveryService.MIN_PUBLICATIONS / .YEARS_LOOKBACK / .TRACK_B_ENABLED /
  // .OPENALEX_PUB_BACKFILL_CONCURRENCY) AND so a test that reassigns DiscoveryService.MIN_PUBLICATIONS
  // still overrides this class property (plan constraint C1). TRACK_B_ENABLED stays code-level
  // dormant (S248) — see the rationale comment in ./discovery/constants.js.
  static MIN_PUBLICATIONS = C.MIN_PUBLICATIONS;
  static YEARS_LOOKBACK = C.YEARS_LOOKBACK;
  static COAUTHOR_COI_STRONG_MIN = C.COAUTHOR_COI_STRONG_MIN;
  static VERIFICATION_STATUSES = C.VERIFICATION_STATUSES;
  static VERIFICATION_SKIPPED_REASON = C.VERIFICATION_SKIPPED_REASON;
  static TRACK_B_IDENTITY_RESOLUTION_LIMIT = C.TRACK_B_IDENTITY_RESOLUTION_LIMIT;
  static TRACK_B_ENABLED = C.TRACK_B_ENABLED;
  static NICKNAME_MAP = C.NICKNAME_MAP;

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
      signal,
      onProgress = () => {},
      // S240 Chunk 2a: the PI-institution UNION (structured ORCID-current +
      // OpenAlex last-known + LLM authorInstitution), resolved server-side by the
      // discover route. Preferred over the LLM-only authorInstitution for the
      // institution hard drop below. Empty/absent → falls back to authorInstitution.
      piInstitutions = null,
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
        filteredByCOI: 0,
        flaggedByCOI: 0,
        trackBIdentityResolved: 0,
        trackBIdentityDeferred: 0,
        trackBMergedBySharedOrcid: 0,
      }
    };
    results.coiDropped = [];
    results.coiFlagged = [];

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
        (progress) => onProgress({ ...progress, track: 'A' }),
        { searchPubmed, proposalInfo, signal }
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
    if (DiscoveryService.TRACK_B_ENABLED && searchPubmed && searchQueries?.pubmed?.length > 0) {
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
    if (DiscoveryService.TRACK_B_ENABLED && searchArxiv && searchQueries?.arxiv?.length > 0) {
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
    if (DiscoveryService.TRACK_B_ENABLED && searchBiorxiv && searchQueries?.biorxiv?.length > 0) {
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
    if (DiscoveryService.TRACK_B_ENABLED && searchChemrxiv && searchQueries?.chemrxiv?.length > 0) {
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

    // Remove Track-B candidates that match a VERIFIED Track-A reviewer (honorific-robust
    // areNamesSimilar) so a confirmed proposal-named / spine reviewer is not duplicated by a
    // literature-retrieved find. (Restored — the Track-B identity rework had dropped it.)
    const verifiedNames = results.verified.map((v) => v.name);
    const newCandidates = allDiscovered.filter((c) =>
      !verifiedNames.some((vn) => DeduplicationService.areNamesSimilar(c.name, vn))
    );

    // Deduplicate among the remaining discovered candidates
    const deduplicatedAll = await DeduplicationService.deduplicateAndStore(newCandidates);
    const deduplicated = deduplicatedAll.filter((candidate) =>
      !this.isCrossFieldDiscoveredContamination(proposalInfo, candidate)
    );

    results.stats.totalAfterDedup = deduplicated.length;

    // Filter by COI (exclude the PI's institution[s]). Prefer the structured union
    // when the route resolved it; else the LLM-extracted authorInstitution (S240 2a).
    const authorInstitution = proposalInfo?.authorInstitution;
    const coiInstitutions = (Array.isArray(piInstitutions) && piInstitutions.length)
      ? piInstitutions
      : authorInstitution;
    const conflictPartition = DeduplicationService.partitionConflicts(
      deduplicated,
      coiInstitutions
    );
    const filtered = conflictPartition.filtered;
    results.coiDropped = conflictPartition.institutionConflicts;
    results.coiFlagged = conflictPartition.institutionFlagged;

    results.stats.filteredByCOI = deduplicated.length - filtered.length;
    results.stats.flaggedByCOI = conflictPartition.institutionFlagged.length;

    // Minimum-publication bar — SURFACE as a warning, do NOT silently drop (S238).
    // A real reviewer can fall under the bar when dedup collapses a preprint + its
    // published version of the same work, so a hard drop on the retrieval pool is
    // exactly the silent recall loss the redesign fights. Qualified (>= MIN)
    // candidates keep priority for the bounded identity-resolution budget; low-pub
    // candidates are tagged for a UI warning and appended AFTER them so they are
    // surfaced (and resolved only if budget remains) rather than discarded.
    const { qualified: qualifiedBeforeIdentity, lowPublication: lowPublicationBeforeIdentity } =
      this.partitionByPublicationBar(filtered);
    results.stats.lowPublicationCountSurfaced = lowPublicationBeforeIdentity.length;

    const proposalKeywords = [
      ...(proposalInfo?.keywords || []),
      proposalInfo?.primaryResearchArea,
      proposalInfo?.title,
    ].filter(Boolean);
    const rankedForIdentity = [
      ...DeduplicationService.rankByRelevance(qualifiedBeforeIdentity, proposalKeywords),
      ...DeduplicationService.rankByRelevance(lowPublicationBeforeIdentity, proposalKeywords),
    ];
    const identityLimit = this.TRACK_B_IDENTITY_RESOLUTION_LIMIT;
    const toResolve = rankedForIdentity.slice(0, identityLimit);
    const deferred = rankedForIdentity.slice(identityLimit);
    results.stats.trackBIdentityDeferred = deferred.length;
    if (deferred.length > 0) {
      console.log(`[Discovery] Track B identity deferred for ${deferred.length} candidate(s) after top ${identityLimit} by relevance`);
    }

    const resolvedTrackB = await this.resolveTrackBIdentities(toResolve, { signal, onProgress });
    results.stats.trackBIdentityResolved = resolvedTrackB.filter((c) =>
      c.identityStatus === 'confirmed' || c.identityStatus === 'probable'
    ).length;

    // Deferred Track-B candidates never went through identity resolution, so they
    // carry no verdict and would land in the SELECTABLE `literature_retrieved`
    // group (provenanceGroupOf keys on identity fields). Stamp them explicitly
    // unresolved so they route to `needs_identity_review` (anchor-or-abstain at the
    // UI/persistence boundary). Done AFTER resolved mapping and only when not already
    // confirmed/probable, so it can never overwrite a real verdict; the shared-ORCID
    // merge below only fires on confirmed/probable rows, so it is unaffected.
    const deferredStamped = deferred.map((candidate) => {
      if (candidate.identityStatus === 'confirmed' || candidate.identityStatus === 'probable') {
        return candidate;
      }
      return {
        ...candidate,
        needsIdentification: true,
        identityStatus: this.VERIFICATION_STATUSES.UNRESOLVED,
        verificationStatus: candidate.verificationStatus || this.VERIFICATION_STATUSES.UNRESOLVED,
        verified: false,
      };
    });

    const mergeResult = this.mergeTrackBWithNeedsReviewBySharedOrcid(
      results.unverified,
      [...resolvedTrackB, ...deferredStamped]
    );
    results.stats.trackBMergedBySharedOrcid = mergeResult.mergedCount;
    results.discovered = mergeResult.discovered;

    // A needs-review Track-A candidate upgraded by an ORCID-matched Track-B author is now
    // trusted (confirmed/probable). Move it into the selectable `verified` bucket — the UI
    // renders the `unverified` bucket read-only, so leaving an upgraded reviewer there would
    // silently defeat the §8 recovery (the right person would still be unselectable).
    const upgraded = [];
    const stillUnverified = [];
    for (const candidate of mergeResult.unverified) {
      const trusted = candidate.verified === true
        || candidate.verificationStatus === this.VERIFICATION_STATUSES.VERIFIED
        || candidate.verificationStatus === this.VERIFICATION_STATUSES.PROBABLE;
      (trusted ? upgraded : stillUnverified).push(candidate);
    }
    results.verified = [...results.verified, ...upgraded];
    results.unverified = stillUnverified;

    // Backfill the publication LIST for trusted candidates confirmed via the OpenAlex/ORCID
    // identity paths (the spine / Track-B), which set identity + (later) bibliometrics but
    // never attach a works list — so a non-biomedical confirmed reviewer (e.g. an attosecond
    // physicist resolved without PubMed) shows "0 publications" and gets publicationCount5yr=0,
    // which the recency-weighted ranker penalizes. The works come from the SAME confirmed
    // OpenAlex author (identity-anchored, no namesake risk). Empty-pubs only (never clobbers a
    // PubMed list), abort-aware, degrades to no-op on OpenAlex failure.
    await this.backfillOpenAlexPublications([...results.verified, ...results.discovered], { signal });

    onProgress({
      stage: 'discovery',
      status: 'complete',
      message: `Discovery complete: ${results.verified.length} verified, ${results.discovered.length} discovered`
    });

    return results;
  }

  // A publication looks like a preprint (so it loses to a published version of the same paper
  // in dedup): a preprint-server journal name (PubMed indexes some preprints, e.g. journal
  // "bioRxiv"), or a preprint DOI/host in the URL (10.1101 bioRxiv, 10.48550 arXiv).
  static _isPreprintPublication(pub) {
    return publications._isPreprintPublication(pub);
  }

  static dedupePublicationsByTitle(pubs, { limit } = {}) {
    return publications.dedupePublicationsByTitle(pubs, { limit });
  }

  static OPENALEX_PUB_BACKFILL_LIMIT = C.OPENALEX_PUB_BACKFILL_LIMIT;
  static OPENALEX_PUB_BACKFILL_CONCURRENCY = C.OPENALEX_PUB_BACKFILL_CONCURRENCY;

  static async backfillOpenAlexPublications(candidates, { signal } = {}) {
    return publications.backfillOpenAlexPublications(candidates, { signal });
  }

  /**
   * Track A: Verify Claude's suggestions via PubMed
   *
   * Uses expertise areas from Claude to disambiguate common names.
   * Searches with name + expertise keywords to find the right person.
   */
  static async verifyClaudeSuggestions(suggestions, onProgress = () => {}, options = {}) {
    return verification.verifyClaudeSuggestions(suggestions, onProgress, options, this.MIN_PUBLICATIONS);
  }

  static pubMedVerificationContract(options = {}) {
    return verification.pubMedVerificationContract(options);
  }

  static suggestionVerifierRouting(options = {}) {
    return verification.suggestionVerifierRouting(options);
  }

  static normalizeSuggestionSource(suggestion = {}) {
    return provenance.normalizeSuggestionSource(suggestion);
  }

  static provenanceOriginForVerifiedSuggestion(suggestion = {}) {
    return provenance.provenanceOriginForVerifiedSuggestion(suggestion);
  }

  static provenanceOriginForUnverifiedSuggestion(suggestion = {}) {
    return provenance.provenanceOriginForUnverifiedSuggestion(suggestion);
  }

  static provenanceOriginForSpineSuggestion(suggestion = {}, evidenceSources = [], verified = false) {
    return provenance.provenanceOriginForSpineSuggestion(suggestion, evidenceSources, verified);
  }

  static mapSpineVerificationResult(suggestion, spineResult = {}) {
    return provenance.mapSpineVerificationResult(suggestion, spineResult);
  }

  static unverifiedSuggestion(suggestion, reason) {
    return provenance.unverifiedSuggestion(suggestion, reason);
  }

  static isCrossFieldDiscoveredContamination(proposalInfo = {}, candidate = {}) {
    return researchArea.isCrossFieldDiscoveredContamination(proposalInfo, candidate);
  }

  /**
   * Partition Track-B candidates by the minimum-publication bar. Candidates under the
   * bar are NOT dropped (S238): a real reviewer can fall under it when dedup collapses a
   * preprint + its published version of the same work, so a silent drop on the retrieval
   * pool is the recall loss the redesign fights. Under-bar candidates are tagged for a UI
   * warning and returned separately so the caller can keep qualified candidates' priority
   * for the bounded identity-resolution budget while still surfacing the low-count ones.
   */
  static partitionByPublicationBar(candidates = []) {
    return trackBIdentity.partitionByPublicationBar(candidates, this.MIN_PUBLICATIONS);
  }

  static gradeCoauthorCOI(coauthorInfo = {}) {
    return coauthorCoi.gradeCoauthorCOI(coauthorInfo);
  }

  static async resolveTrackBIdentities(candidates = [], { signal, onProgress = () => {} } = {}) {
    return trackBIdentity.resolveTrackBIdentities(candidates, { signal, onProgress });
  }

  static mapTrackBIdentityResult(candidate = {}, resolverResult = {}) {
    return trackBIdentity.mapTrackBIdentityResult(candidate, resolverResult);
  }

  static mergeTrackBWithNeedsReviewBySharedOrcid(unverified = [], discovered = []) {
    return trackBIdentity.mergeTrackBWithNeedsReviewBySharedOrcid(unverified, discovered);
  }

  static isClearlyBiomedicalResearchArea(primaryResearchArea) {
    return researchArea.isClearlyBiomedicalResearchArea(primaryResearchArea);
  }

  static isPhysicalOrEngineeringResearchArea(primaryResearchArea) {
    return researchArea.isPhysicalOrEngineeringResearchArea(primaryResearchArea);
  }

  static isClearlyNonBiomedicalVerifierArea(primaryResearchArea) {
    return researchArea.isClearlyNonBiomedicalVerifierArea(primaryResearchArea);
  }

  static articlesLookBiomedicalOrClinical(articles = []) {
    return researchArea.articlesLookBiomedicalOrClinical(articles);
  }

  static evaluateCrossFieldNamesakeGuard({ proposalInfo, articles, expertiseMatch, expertiseMismatchResult }) {
    return researchArea.evaluateCrossFieldNamesakeGuard({ proposalInfo, articles, expertiseMatch, expertiseMismatchResult });
  }

  static evaluateVerificationIncoherence({ institutionMismatch, expertiseMismatchResult, verificationStatus }) {
    return provenance.evaluateVerificationIncoherence({ institutionMismatch, expertiseMismatchResult, verificationStatus });
  }

  /**
   * Track B: Search PubMed with generated queries
   */
  static async searchPubMed(queries, onProgress) {
    return literatureSearch.searchPubMed(queries, onProgress);
  }

  /**
   * Track B: Search ArXiv with generated queries
   */
  static async searchArXiv(queries, onProgress) {
    return literatureSearch.searchArXiv(queries, onProgress);
  }

  /**
   * Track B: Search BioRxiv with generated queries
   */
  static async searchBioRxiv(queries, onProgress) {
    return literatureSearch.searchBioRxiv(queries, onProgress);
  }

  /**
   * Track B: Search ChemRxiv with generated queries
   */
  static async searchChemRxiv(queries, onProgress) {
    return literatureSearch.searchChemRxiv(queries, onProgress);
  }

  /**
   * Build a PubMed author query
   */
  static buildAuthorQuery(name) {
    return pubmedQuery.buildAuthorQuery(name);
  }

  /**
   * Generate alternative name variants for PubMed search
   * "Will Harcombe" -> ["Will Harcombe", "William Harcombe", "W Harcombe"]
   * Handles common nickname expansions
   */
  static generateNameVariants(name) {
    return nameMatching.generateNameVariants(name);
  }

  /**
   * Build a disambiguated author query using expertise areas
   * This helps find the right "Jessica Green" by including topic keywords
   */
  static buildDisambiguatedAuthorQuery(suggestion) {
    return pubmedQuery.buildDisambiguatedAuthorQuery(suggestion);
  }

  /**
   * Filter articles by expertise relevance
   * Checks if article titles/abstracts contain expertise keywords
   */
  static filterByExpertiseRelevance(articles, expertiseAreas) {
    return matchSignals.filterByExpertiseRelevance(articles, expertiseAreas);
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
    return matchSignals.calculateExpertiseMatch(articles, expertiseAreas);
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
    return affiliation.extractBestAffiliation(articles, authorName);
  }

  static _affiliationWeightsMap(articles, nameVariants) {
    return affiliation._affiliationWeightsMap(articles, nameVariants);
  }

  static _recencyWeightedAffiliation(articles, nameVariants) {
    return affiliation._recencyWeightedAffiliation(articles, nameVariants);
  }

  static collectAffiliationHistory(articles, nameVariants) {
    return affiliation.collectAffiliationHistory(articles, nameVariants);
  }

  static normalizeAffiliationForComparison(affiliationString) {
    return affiliation.normalizeAffiliationForComparison(affiliationString);
  }

  static extractBestAffiliationMultiVariant(articles, nameVariants) {
    return affiliation.extractBestAffiliationMultiVariant(articles, nameVariants);
  }

  /**
   * Filter articles to only include those where the target author is actually in the author list
   * This is critical to handle stale/incorrect cache data
   */
  static filterToMatchingAuthor(articles, targetName) {
    return nameMatching.filterToMatchingAuthor(articles, targetName);
  }

  /**
   * Filter articles to include those where ANY of the name variants match an author
   * Used when searching for nickname variants (Will/William/W Harcombe)
   */
  static filterToMatchingAuthorMultiVariant(articles, nameVariants) {
    return nameMatching.filterToMatchingAuthorMultiVariant(articles, nameVariants);
  }

  /**
   * Normalize a name for matching (lowercase, remove titles, etc.)
   */
  static normalizeNameForMatch(name) {
    return nameMatching.normalizeNameForMatch(name);
  }

  static firstNamesEquivalent(first1, first2) {
    return nameMatching.firstNamesEquivalent(first1, first2);
  }

  static nameMatchEvidence(name1, name2) {
    return nameMatching.nameMatchEvidence(name1, name2);
  }

  /**
   * Check if two names match (handles initials, partial names)
   * More strict matching to avoid confusion between different people
   */
  static namesMatch(name1, name2, options = {}) {
    return nameMatching.namesMatch(name1, name2, options);
  }

  static evaluateNameEvidence(suggestedName, articles) {
    return nameMatching.evaluateNameEvidence(suggestedName, articles);
  }

  /**
   * Count publications in the last N years
   */
  static countRecentPublications(articles) {
    return publications.countRecentPublications(articles);
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
    return matchSignals.checkInstitutionMismatch(verifiedAffiliation, suggestedInstitution);
  }

  /**
   * Check if Claude's claimed expertise terms appear in the candidate's publications
   * Returns mismatch info if none of the specific expertise terms are found
   *
   * @param {Array} publications - List of publications from PubMed
   * @param {string[]} claimedExpertise - Expertise areas Claude claimed
   * @returns {Object} { hasMismatch, claimedTerms, matchedTerms }
   */
  static checkExpertiseMismatch(pubs, claimedExpertise) {
    return matchSignals.checkExpertiseMismatch(pubs, claimedExpertise);
  }

  /**
   * Check for coauthorship history between a candidate and proposal authors
   *
   * @param {string} candidateName - Name of the reviewer candidate
   * @param {string[]} proposalAuthors - List of proposal author names
   * @returns {Promise<Object>} Coauthorship information
   */
  static async checkCoauthorHistory(candidateName, proposalAuthors) {
    return coauthorCoi.checkCoauthorHistory(candidateName, proposalAuthors);
  }

  static toPubMedAuthorFormat(name) {
    return coauthorCoi.toPubMedAuthorFormat(name);
  }

  static async checkCoauthorshipsForCandidates(candidates, proposalAuthors, onProgress = () => {}) {
    return coauthorCoi.checkCoauthorshipsForCandidates(candidates, proposalAuthors, onProgress);
  }

  /**
   * Combine and rank all candidates
   *
   * @param {Object} discoveryResults - Results from discover()
   * @param {string[]} keywords - Proposal keywords for relevance scoring
   * @returns {Array} Ranked list of all candidates
   */
  static rankAllCandidates(discoveryResults, keywords = []) {
    return ranking.rankAllCandidates(discoveryResults, keywords);
  }
}

module.exports = { DiscoveryService };
