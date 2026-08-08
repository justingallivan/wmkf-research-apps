/**
 * DiscoveryService Track-A verification hub — Stage 5 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * The most connected cluster: `verifyClaudeSuggestions` confirms Claude's NAMED reviewer
 * suggestions against PubMed (or reroutes to the OpenAlex/ORCID spine for non-biomedical
 * proposals), applying name-variant search, author-filtering, dedup, the minimum-publication
 * gate, affiliation/expertise/namesake/incoherence checks, and provenance stamping. Plus the two
 * verifier-routing helpers. Extracted VERBATIM from discovery-service.js as a behavior-freeze —
 * internal `this.X` self-calls became direct imported-function calls across the Stage 0–3 modules,
 * and `MIN_PUBLICATIONS` is passed IN by the facade wrapper so a runtime override of
 * DiscoveryService.MIN_PUBLICATIONS still applies (plan constraint C1). The facade delegates each.
 *
 * Depends on ./constants, ./name-matching, ./pubmed-query, ./match-signals, ./affiliation,
 * ./publications, ./research-area, ./provenance, ../reviewer-identity-runtime, ../pubmed-service,
 * ../../utils/reviewer-provenance. No require cycle (nothing here is imported by those modules).
 * Characterization net: tests/unit/discovery-verification-status.test.js.
 */

const { VERIFICATION_STATUSES, VERIFICATION_SKIPPED_REASON, DEBUG, PUBMED_DELAY } = require('./constants');
const { generateNameVariants, filterToMatchingAuthorMultiVariant, evaluateNameEvidence } = require('./name-matching');
const { buildAuthorQuery, buildDisambiguatedAuthorQuery } = require('./pubmed-query');
const { filterByExpertiseRelevance, calculateExpertiseMatch, checkInstitutionMismatch, checkExpertiseMismatch } = require('./match-signals');
const { extractBestAffiliationMultiVariant, collectAffiliationHistory } = require('./affiliation');
const { dedupePublicationsByTitle, countRecentPublications } = require('./publications');
const { evaluateCrossFieldNamesakeGuard, isClearlyNonBiomedicalVerifierArea } = require('./research-area');
const {
  normalizeSuggestionSource,
  mapSpineVerificationResult,
  evaluateVerificationIncoherence,
  provenanceOriginForVerifiedSuggestion,
  provenanceOriginForUnverifiedSuggestion,
} = require('./provenance');
const { ReviewerIdentityRuntime } = require('../reviewer-identity-runtime');
const { PubMedService } = require('../pubmed-service');
const { withReviewerProvenance } = require('../../utils/reviewer-provenance');

/**
 * "Is PubMed usable at all?" — gates the PubMed coauthorship-COI check in discover.js.
 * INTENTIONALLY NOT field-aware: a non-biomedical proposal still has PubMed available (it just
 * isn't the right Track-A verifier). Keeping this keyed on searchPubmed alone is what lets
 * suggestionVerifierRouting reroute Track-A WITHOUT silently disabling COI detection (S236 E.2).
 */
function pubMedVerificationContract(options = {}) {
  if (options.searchPubmed === false) {
    return { enabled: false, reason: VERIFICATION_SKIPPED_REASON };
  }
  return { enabled: true, reason: null };
}

/**
 * Which verifier confirms Claude's NAMED suggestions (Track-A). Distinct from
 * pubMedVerificationContract: PubMed is biomedical-only and cannot confirm physicists/chemists/etc.,
 * so clearly-non-biomedical proposals verify via the domain-agnostic OpenAlex/ORCID identity spine.
 * Ambiguous/unset fields stay on PubMed (the non-biomedical test requires a POSITIVE match). S236.
 */
function suggestionVerifierRouting(options = {}) {
  if (options.searchPubmed === false) {
    return { verifier: 'spine', reason: VERIFICATION_SKIPPED_REASON };
  }
  if (isClearlyNonBiomedicalVerifierArea(options.proposalInfo?.primaryResearchArea)) {
    return { verifier: 'spine', reason: 'Non-biomedical proposal — PubMed cannot confirm this field' };
  }
  return { verifier: 'pubmed', reason: null };
}

/**
 * Track A: Verify Claude's suggestions via PubMed (or the OpenAlex/ORCID spine).
 * `minPublications` is supplied by the facade wrapper, which passes DiscoveryService.MIN_PUBLICATIONS
 * verbatim, so a runtime override applies (C1). Deliberately NO default: the param must mirror the
 * facade static EXACTLY — including an explicit `undefined` — so a defaulted constant can never
 * silently diverge from what the pre-extraction body read via `this.MIN_PUBLICATIONS` (Codex Stage-5
 * review). The facade is the only caller (verified: no other module imports this).
 */
async function verifyClaudeSuggestions(suggestions, onProgress = () => {}, options = {}, minPublications) {
  const verified = [];
  const unverified = [];
  const normalizedSuggestions = (Array.isArray(suggestions) ? suggestions : [])
    .map((suggestion) => normalizeSuggestionSource(suggestion));
  const verifierRouting = suggestionVerifierRouting(options);

  if (verifierRouting.verifier === 'spine') {
    console.log(`[Verification] Verifying ${normalizedSuggestions.length} suggestion(s) via OpenAlex/ORCID spine instead of PubMed: ${verifierRouting.reason}`);
    const spineResults = await ReviewerIdentityRuntime.evaluateSuggestions(
      normalizedSuggestions,
      {
        proposalInfo: options.proposalInfo,
        signal: options.signal,
        deadlineAt: options.deadlineAt,
      },
      {
        entryPoint: options.resolverEntryPoint || null,
        onBeforeLegacy: (suggestion, index, total) => onProgress({
        stage: 'verification',
        status: 'verifying',
          message: `Verifying ${suggestion.name} with OpenAlex/ORCID (${index + 1}/${total})...`,
        }),
      },
    );
    for (let i = 0; i < normalizedSuggestions.length; i++) {
      const suggestion = normalizedSuggestions[i];
      const spineResult = spineResults[i];
      const mapped = mapSpineVerificationResult(suggestion, spineResult);
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
    const nameVariants = generateNameVariants(suggestion.name);
    let allSimpleArticles = [];
    let allDisambiguatedArticles = [];

    for (const nameVariant of nameVariants) {
      // Simple author search for this variant
      const simpleQuery = buildAuthorQuery(nameVariant);
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
      const disambiguatedQuery = buildDisambiguatedAuthorQuery(suggestionVariant);
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
    const filteredSimple = filterToMatchingAuthorMultiVariant(allSimpleArticles, nameVariants);
    const filteredDisambiguated = filterToMatchingAuthorMultiVariant(allDisambiguatedArticles, nameVariants);

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
    if (dedupedDisambiguated.length >= minPublications) {
      // Prefer disambiguated if it has enough results (more relevant)
      finalArticles = dedupedDisambiguated;
      selectionReason = 'disambiguated';
    } else if (dedupedSimple.length >= minPublications) {
      // Filter simple results by expertise relevance
      const relevantSimple = filterByExpertiseRelevance(dedupedSimple, suggestion.expertiseAreas);
      finalArticles = relevantSimple.length >= minPublications ? relevantSimple : dedupedSimple;
      selectionReason = relevantSimple.length >= minPublications ? 'relevantSimple' : 'simple';
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
    finalArticles = dedupePublicationsByTitle(finalArticles);

    if (DEBUG) {
      console.log(`[${suggestion.name}] Final: ${finalArticles.length} articles (${selectionReason}), need ${minPublications}`);
    }

    if (finalArticles.length >= minPublications) {
      // Extract affiliation for this specific author (not just any author on the paper)
      // Try all name variants to find the best affiliation
      const affiliation = extractBestAffiliationMultiVariant(finalArticles, nameVariants);

      // Calculate a confidence score based on expertise match
      const expertiseMatch = calculateExpertiseMatch(finalArticles, suggestion.expertiseAreas);

      // Check if verified institution matches Claude's suggested institution
      // This helps catch cases where we verified the wrong person with the same name
      const institutionMismatch = checkInstitutionMismatch(
        affiliation,
        suggestion.suggestedInstitution
      );

      // Check if Claude's claimed expertise terms appear in publications
      const expertiseMismatchResult = checkExpertiseMismatch(
        finalArticles,
        suggestion.expertiseAreas
      );

      const nameEvidence = evaluateNameEvidence(suggestion.name, finalArticles);
      const demotionReasons = [];
      if (!nameEvidence.hasFullForenameMatch) {
        demotionReasons.push(nameEvidence.reason || 'No returned author full forename matches the suggested full forename');
      }
      const namesakeGuard = evaluateCrossFieldNamesakeGuard({
        proposalInfo: options.proposalInfo,
        articles: finalArticles,
        expertiseMatch,
        expertiseMismatchResult,
      });
      if (namesakeGuard.shouldDemote) {
        demotionReasons.push(namesakeGuard.reason);
      }

      const verificationStatus = demotionReasons.length === 0
        ? VERIFICATION_STATUSES.VERIFIED
        : VERIFICATION_STATUSES.UNRESOLVED;
      const incoherence = evaluateVerificationIncoherence({
        institutionMismatch,
        expertiseMismatchResult,
        verificationStatus,
      });
      if (incoherence.hasIncoherence) {
        console.log(`[Verification] ${suggestion.name}: verification incoherence flagged (${incoherence.reasons.join('; ')})`);
      }
      const provenanceOrigin = provenanceOriginForVerifiedSuggestion(suggestion);

      const candidate = withReviewerProvenance({
        ...suggestion,
        verified: verificationStatus === VERIFICATION_STATUSES.VERIFIED,
        verificationStatus,
        identityStatus: verificationStatus,
        verificationSource: 'pubmed',
        verificationConfidence: expertiseMatch,
        verificationReason: verificationStatus === VERIFICATION_STATUSES.VERIFIED
          ? 'PubMed publications matched the suggested full forename and surname'
          : demotionReasons.join('; '),
        nameEvidence,
        affiliation: affiliation || suggestion.affiliation,
        // Full affiliation history (most-recent-first) so a FORMER shared
        // institution with the PI is caught by markInstitutionCOI even after
        // the reviewer has moved (the current `affiliation` is recency-best only).
        affiliationHistory: collectAffiliationHistory(finalArticles, nameVariants),
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
        publicationCount5yr: countRecentPublications(finalArticles),
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

      if (verificationStatus === VERIFICATION_STATUSES.VERIFIED) {
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
        : `Only ${finalArticles.length} relevant publications (minimum: ${minPublications})`;
      console.log(`[Verification] ${suggestion.name}: REJECTED - ${reason}`);
      unverified.push(withReviewerProvenance({
        ...suggestion,
        verified: false,
        verificationStatus: VERIFICATION_STATUSES.UNRESOLVED,
        identityStatus: VERIFICATION_STATUSES.UNRESOLVED,
        reason
      }, provenanceOriginForUnverifiedSuggestion(suggestion)));
    }
  }

  console.log(`[Verification] Complete: ${verified.length} verified, ${unverified.length} unverified`);
  return { verified, unverified };
}

module.exports = {
  verifyClaudeSuggestions,
  pubMedVerificationContract,
  suggestionVerifierRouting,
};
