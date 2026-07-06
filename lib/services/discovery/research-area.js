/**
 * DiscoveryService research-area classification cluster — Stage 3 of the DiscoveryService
 * decomposition (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * Keyword heuristics that classify a proposal's primary research area as biomedical vs.
 * physical/engineering, decide whether PubMed is a meaningful verifier for it, and drive the
 * cross-field namesake guard (a physics proposal whose only PubMed "match" is a same-name
 * biomedical author should not be trusted). Extracted VERBATIM from discovery-service.js as a
 * behavior-freeze — internal `this.X` self-calls became direct function calls. The DiscoveryService
 * facade delegates each method here.
 *
 * Pure leaf cluster: no other discovery module, no external service, no constants.
 * Characterization net: tests/unit/discovery-research-area.test.js.
 */

function isClearlyBiomedicalResearchArea(primaryResearchArea) {
  const area = String(primaryResearchArea || '').toLowerCase();
  if (!area) return false;
  return /\b(biology|biological|biomedical|medicine|medical|clinical|health|neuroscience|neurobiology|immunology|immunotherapy|cancer|genomics?|cell|molecular|protein|microbiology|microbial|virology|pharma|pathology|physiology)\b/.test(area);
}

function isPhysicalOrEngineeringResearchArea(primaryResearchArea) {
  const area = String(primaryResearchArea || '').toLowerCase();
  if (!area) return false;
  return /\b(physics|quantum|attosecond|laser|optical|photon|molecular shake|engineering|materials|astronomy|astrophysics|cosmology|chemistry|chemical|computer science|mathematics)\b/.test(area);
}

function isClearlyNonBiomedicalVerifierArea(primaryResearchArea) {
  return isPhysicalOrEngineeringResearchArea(primaryResearchArea)
    && !isClearlyBiomedicalResearchArea(primaryResearchArea);
}

function articlesLookBiomedicalOrClinical(articles = []) {
  const text = articles
    .map((a) => `${a?.title || ''} ${a?.abstract || ''} ${a?.journal || ''}`)
    .join(' ')
    .toLowerCase();
  if (!text) return false;
  return /\b(clinical|patient|patients|disease|diagnosis|therapy|therapeutic|medical|medicine|biomedical|biology|cell|protein|gene|genomic|cancer|immun|neuro|virus|microb|insect|entomolog|parasite|pathogen|epidemiolog|pubmed)\b/.test(text);
}

function evaluateCrossFieldNamesakeGuard({ proposalInfo, articles, expertiseMatch, expertiseMismatchResult }) {
  const primaryResearchArea = proposalInfo?.primaryResearchArea;
  const nonBiomedical = primaryResearchArea && !isClearlyBiomedicalResearchArea(primaryResearchArea);
  if (!nonBiomedical) return { shouldDemote: false, reason: null };

  const topicalOverlap = (expertiseMatch > 0)
    && !expertiseMismatchResult?.hasMismatch
    && (expertiseMismatchResult?.matchedTerms || []).length > 0;
  if (topicalOverlap) return { shouldDemote: false, reason: null };

  const crossFieldBiomedicalMatch = isPhysicalOrEngineeringResearchArea(primaryResearchArea)
    && articlesLookBiomedicalOrClinical(articles);
  if (!crossFieldBiomedicalMatch) return { shouldDemote: false, reason: null };

  return {
    shouldDemote: true,
    // TODO(Fix 10 full): require ORCID/cross-source second-signal
    // corroboration once OpenAlex/ORCID/source expansion is wired.
    reason: 'Non-biomedical proposal with biomedical-only PubMed namesake match and no topical overlap',
  };
}

/**
 * A discovered candidate sourced ONLY from bioRxiv, for a clearly non-biomedical proposal,
 * is cross-field contamination (a biology preprint author surfacing for a physics proposal).
 */
function isCrossFieldDiscoveredContamination(proposalInfo = {}, candidate = {}) {
  const sources = Array.isArray(candidate.sources) && candidate.sources.length
    ? candidate.sources
    : [candidate.source].filter(Boolean);
  const normalizedSources = new Set(sources.map((source) => String(source || '').toLowerCase()));
  const biorxivOnly = normalizedSources.has('biorxiv') && normalizedSources.size === 1;
  if (!biorxivOnly) return false;
  return isClearlyNonBiomedicalVerifierArea(proposalInfo?.primaryResearchArea);
}

module.exports = {
  isClearlyBiomedicalResearchArea,
  isPhysicalOrEngineeringResearchArea,
  isClearlyNonBiomedicalVerifierArea,
  articlesLookBiomedicalOrClinical,
  evaluateCrossFieldNamesakeGuard,
  isCrossFieldDiscoveredContamination,
};
