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
    const verified = [];
    const unverified = [];
    const normalizedSuggestions = (Array.isArray(suggestions) ? suggestions : [])
      .map((suggestion) => this.normalizeSuggestionSource(suggestion));
    const verifierRouting = this.suggestionVerifierRouting(options);

    if (verifierRouting.verifier === 'spine') {
      console.log(`[Verification] Verifying ${normalizedSuggestions.length} suggestion(s) via OpenAlex/ORCID spine instead of PubMed: ${verifierRouting.reason}`);
      for (let i = 0; i < normalizedSuggestions.length; i++) {
        const suggestion = normalizedSuggestions[i];
        onProgress({
          stage: 'verification',
          status: 'verifying',
          message: `Verifying ${suggestion.name} with OpenAlex/ORCID (${i + 1}/${normalizedSuggestions.length})...`,
        });
        const spineResult = await ReviewerIdentityEvidence.evaluateSuggestion(suggestion, {
          proposalInfo: options.proposalInfo,
          signal: options.signal,
        });
        const mapped = this.mapSpineVerificationResult(suggestion, spineResult);
        if (mapped.verified) verified.push(mapped.candidate);
        else unverified.push(mapped.candidate);
      }
      return { verified, unverified };
    }

    // Always log verification start
    console.log(`[Verification] Starting verification of ${normalizedSuggestions.length} candidates`);

    for (let i = 0; i < normalizedSuggestions.length; i++) {
      const suggestion = normalizedSuggestions[i];

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

      // Collapse preprint+published duplicates of the same paper (the article selection above
      // dedups by article id, not title, so a bioRxiv preprint + the published version survive
      // as two rows) BEFORE the eligibility gate — otherwise two rows of ONE paper could clear
      // the MIN_PUBLICATIONS "≥N distinct works" bar (Codex post-impl HIGH). Everything
      // downstream (affiliation/expertise/display/recency count) then sees distinct works.
      finalArticles = this.dedupePublicationsByTitle(finalArticles);

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
        const namesakeGuard = this.evaluateCrossFieldNamesakeGuard({
          proposalInfo: options.proposalInfo,
          articles: finalArticles,
          expertiseMatch,
          expertiseMismatchResult,
        });
        if (namesakeGuard.shouldDemote) {
          demotionReasons.push(namesakeGuard.reason);
        }

        const verificationStatus = demotionReasons.length === 0
          ? this.VERIFICATION_STATUSES.VERIFIED
          : this.VERIFICATION_STATUSES.UNRESOLVED;
        const incoherence = this.evaluateVerificationIncoherence({
          institutionMismatch,
          expertiseMismatchResult,
          verificationStatus,
        });
        if (incoherence.hasIncoherence) {
          console.log(`[Verification] ${suggestion.name}: verification incoherence flagged (${incoherence.reasons.join('; ')})`);
        }
        const provenanceOrigin = this.provenanceOriginForVerifiedSuggestion(suggestion);

        const candidate = withReviewerProvenance({
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
          verificationIncoherence: incoherence.hasIncoherence,
          verificationIncoherenceReasons: incoherence.reasons,
          // TODO(Fix 11 full): replace this coarse flag with source-attributed
          // identity/attribute reconciliation before ranking/persistence.
          incoherentVerification: incoherence.hasIncoherence,
          publications: finalArticles.slice(0, 5).map(a => ({
            title: a.title,
            year: a.year,
            pmid: a.pmid,
            journal: a.journal,
            url: a.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}` : null
          })),
          publicationCount5yr: this.countRecentPublications(finalArticles),
          source: suggestion.source
        }, provenanceOrigin);

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
        unverified.push(withReviewerProvenance({
          ...suggestion,
          verified: false,
          verificationStatus: this.VERIFICATION_STATUSES.UNRESOLVED,
          identityStatus: this.VERIFICATION_STATUSES.UNRESOLVED,
          reason
        }, this.provenanceOriginForUnverifiedSuggestion(suggestion)));
      }
    }

    console.log(`[Verification] Complete: ${verified.length} verified, ${unverified.length} unverified`);
    return { verified, unverified };
  }

  // "Is PubMed usable at all?" — gates the PubMed coauthorship-COI check in
  // discover.js. INTENTIONALLY NOT field-aware: a non-biomedical proposal still
  // has PubMed available (it just isn't the right Track-A verifier). Keeping this
  // keyed on searchPubmed alone is what lets suggestionVerifierRouting reroute
  // Track-A WITHOUT silently disabling COI detection (Codex S236 E.2).
  static pubMedVerificationContract(options = {}) {
    if (options.searchPubmed === false) {
      return { enabled: false, reason: this.VERIFICATION_SKIPPED_REASON };
    }
    return { enabled: true, reason: null };
  }

  // Which verifier confirms Claude's NAMED suggestions (Track-A). Distinct from
  // pubMedVerificationContract above: PubMed is biomedical-only and cannot confirm
  // physicists/chemists/etc., so clearly-non-biomedical proposals verify via the
  // domain-agnostic OpenAlex/ORCID identity spine. Ambiguous/unset fields stay on
  // PubMed (the non-biomedical test requires a POSITIVE physical/eng match). S236.
  static suggestionVerifierRouting(options = {}) {
    if (options.searchPubmed === false) {
      return { verifier: 'spine', reason: this.VERIFICATION_SKIPPED_REASON };
    }
    if (this.isClearlyNonBiomedicalVerifierArea(options.proposalInfo?.primaryResearchArea)) {
      return { verifier: 'spine', reason: 'Non-biomedical proposal — PubMed cannot confirm this field' };
    }
    return { verifier: 'pubmed', reason: null };
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
    const qualified = [];
    const lowPublication = [];
    for (const c of candidates) {
      const found = c.publications?.length || 0;
      if (found >= this.MIN_PUBLICATIONS) {
        qualified.push(c);
      } else {
        lowPublication.push({ ...c, lowPublicationCount: true, lowPublicationCountFound: found });
      }
    }
    return { qualified, lowPublication };
  }

  /**
   * Grade a coauthor-COI relationship (S238). Tiers on the STRONGEST single co-author
   * tie (sustained 2-person collaboration = real conflict) rather than the total across
   * authors (which a single large-collaboration paper inflates). Returns 'likely' (>=
   * COAUTHOR_COI_STRONG_MIN shared papers with one author), 'possible' (1..threshold-1,
   * may be incidental), or null (no shared papers).
   */
  static gradeCoauthorCOI({ hasCoauthorship, maxSharedWithOneAuthor } = {}) {
    if (!hasCoauthorship) return null;
    return (maxSharedWithOneAuthor || 0) >= this.COAUTHOR_COI_STRONG_MIN ? 'likely' : 'possible';
  }

  static async resolveTrackBIdentities(candidates = [], { signal, onProgress = () => {} } = {}) {
    const resolved = [];
    for (let i = 0; i < candidates.length; i += 1) {
      if (signal?.aborted) throw signal.reason || new Error('reviewer_time_budget_exceeded');
      const candidate = candidates[i];
      onProgress({
        stage: 'discovery',
        track: 'B',
        status: 'identity_resolving',
        message: `Resolving literature author identity ${i + 1}/${candidates.length}: ${candidate.name}`,
      });
      const result = await ReviewerWorkAuthorResolver.resolveCandidate(candidate, { signal });
      resolved.push(this.mapTrackBIdentityResult(candidate, result));
    }
    return resolved;
  }

  static mapTrackBIdentityResult(candidate = {}, resolverResult = {}) {
    const sourceNames = new Set([
      ...(Array.isArray(candidate.sources) ? candidate.sources : []),
      ...(resolverResult.sources?.openalex === 'ok' ? ['openalex'] : []),
      ...(resolverResult.sources?.orcid === 'ok' || resolverResult.orcid ? ['orcid'] : []),
    ].filter(Boolean));
    const status = resolverResult.resolverStatus || resolverResult.status || this.VERIFICATION_STATUSES.UNRESOLVED;
    const trusted = status === 'confirmed' || status === 'probable';
    const verificationStatus = status === 'confirmed'
      ? this.VERIFICATION_STATUSES.VERIFIED
      : status === 'probable'
        ? this.VERIFICATION_STATUSES.PROBABLE
        : this.VERIFICATION_STATUSES.UNRESOLVED;
    const resolvedOrcid = normalizeOrcid(resolverResult.orcid);
    const candidateOrcid = normalizeOrcid(candidate.orcid || candidate.orcidId);
    const verificationReason = resolverResult.reason || 'Literature author identity unresolved';

    return withReviewerProvenance({
      ...candidate,
      verified: trusted,
      verificationStatus,
      identityStatus: trusted ? status : this.VERIFICATION_STATUSES.UNRESOLVED,
      verificationSource: trusted ? 'openalex' : null,
      verificationConfidence: status === 'confirmed' ? 0.95 : (status === 'probable' ? 0.75 : null),
      verificationReason,
      reason: trusted ? candidate.reason : verificationReason,
      needsIdentification: !trusted,
      openAlexAuthorId: resolverResult.openAlexAuthorId || candidate.openAlexAuthorId || null,
      openAlexWorkId: resolverResult.work?.openAlexId || candidate.openAlexWorkId || null,
      orcid: resolvedOrcid || candidateOrcid,
      orcidId: resolvedOrcid || candidateOrcid,
      orcidUrl: resolvedOrcid ? `https://orcid.org/${resolvedOrcid}` : candidate.orcidUrl,
      affiliation: resolverResult.institution || candidate.affiliation,
      topics: resolverResult.topics || candidate.topics || [],
      identityEvidence: resolverResult.identity || null,
      identityAnchors: resolverResult.anchors || [],
      identityNote: resolverResult.identityNote || null,
      source: candidate.source,
    }, {
      kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED,
      sources: Array.from(sourceNames),
      seedRole: SEED_ROLES.QUERY_SEED,
      force: true,
    });
  }

  static mergeTrackBWithNeedsReviewBySharedOrcid(unverified = [], discovered = []) {
    const remainingDiscovered = [];
    const unverifiedOut = unverified.map((candidate) => ({ ...candidate }));
    let mergedCount = 0;

    for (const candidate of discovered) {
      const candidateOrcid = normalizeOrcid(candidate.orcid || candidate.orcidId);
      const workResolved = !!candidate.openAlexAuthorId
        && (candidate.identityStatus === 'confirmed' || candidate.identityStatus === 'probable');
      const matchIndex = candidateOrcid
        ? unverifiedOut.findIndex((trackA) => {
            const trackAOrcid = normalizeOrcid(trackA.orcid || trackA.orcidId);
            return workResolved && trackAOrcid && trackAOrcid === candidateOrcid;
          })
        : -1;

      if (matchIndex === -1) {
        remainingDiscovered.push(candidate);
        continue;
      }

      unverifiedOut[matchIndex] = withReviewerProvenance({
        ...unverifiedOut[matchIndex],
        ...candidate,
        name: unverifiedOut[matchIndex].name || candidate.name,
        source: unverifiedOut[matchIndex].source,
        isClaudeSuggestion: true,
      }, {
        kind: unverifiedOut[matchIndex].provenance?.kind || unverifiedOut[matchIndex].provenanceKind || PROVENANCE_KINDS.BARRED_PARAMETRIC,
        sources: [
          ...(unverifiedOut[matchIndex].sources || []),
          ...(candidate.sources || []),
        ],
        seedRole: unverifiedOut[matchIndex].provenance?.seedRole || SEED_ROLES.PEER_OR_COMPETITOR,
        force: true,
      });
      mergedCount += 1;
    }

    return { unverified: unverifiedOut, discovered: remainingDiscovered, mergedCount };
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
        const coauthorInfo = await this.checkCoauthorHistory(candidate.name, proposalAuthors);
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
          coauthorCOIStrength: this.gradeCoauthorCOI(coauthorInfo)
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
        c.publicationCount5yr = this.countRecentPublications(c.publications || []);
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
}

module.exports = { DiscoveryService };
