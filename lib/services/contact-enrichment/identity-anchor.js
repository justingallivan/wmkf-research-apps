/**
 * ContactEnrichmentService — identity-anchor cluster.
 *
 * Stage 1 of the ContactEnrichmentService decomposition
 * (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md). Behavior-freeze, pure
 * code motion: the 8 identity/anchor helpers moved verbatim out of
 * contact-enrichment-service.js. Internal `this._cleanInstitution(...)` self-calls
 * became direct calls to the sibling `cleanInstitution` function. The facade keeps
 * a thin delegating wrapper for each (preserving the exact `ContactEnrichmentService.*`
 * surface). DAG leaf — depends only on ORCIDService + normalizeOrcid.
 *
 * (`_fieldPersistAllowed`, physically interleaved among these methods in the
 * original file, is NOT here — it moves to persistence.js in Stage 8 per R1.)
 */

const { ORCIDService } = require('../orcid-service');
const { normalizeOrcid } = require('../reviewer-work-author-resolver');

function identityAnchorForCandidate(candidate = {}) {
  const orcid = normalizeOrcid(candidate.orcid || candidate.orcidId || candidate.contactEnrichment?.orcidId);
  if (!orcid) return null;
  return {
    orcid,
    institution: candidate.affiliation || candidate.institution || candidate.primaryAffiliation || null,
  };
}

function cleanInstitution(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function effectiveInstitution(candidate = {}, enrichment = {}) {
  return cleanInstitution(enrichment.orcidAffiliation)
    || cleanInstitution(candidate.affiliation)
    || cleanInstitution(candidate.institution)
    || cleanInstitution(candidate.primaryAffiliation)
    || null;
}

function searchCandidateWithInstitution(candidate = {}, institution = null) {
  if (!institution) return candidate;
  return { ...candidate, affiliation: institution };
}

function anchorWithInstitution(anchor = null, institution = null) {
  if (!anchor && !institution) return null;
  return {
    ...(anchor || {}),
    institution: institution || anchor?.institution || null,
  };
}

function hasOrcidAnchor(candidate = {}, enrichment = {}) {
  return !!normalizeOrcid(candidate.orcid || candidate.orcidId || enrichment.orcidId);
}

function markUnanchoredAbstain(enrichment = {}) {
  enrichment.contactStatus = 'unresolved';
  enrichment.contactStatusReason = 'identity_anchor_required';
  enrichment.email = null;
  enrichment.emailSource = null;
  enrichment.website = null;
  enrichment.websiteSource = null;
  enrichment.facultyPageUrl = null;
  enrichment.googleScholarId = null;
  enrichment.googleScholarUrl = null;
  enrichment.hIndex = null;
  enrichment.i10Index = null;
  enrichment.totalCitations = null;
  enrichment.openAlexAffiliation = null;
  enrichment.verifiedInstitutionDomain = null;
  enrichment.emailPersistAllowed = false;
  enrichment.websitePersistAllowed = false;
  enrichment.affiliationPersistAllowed = false;
  enrichment.scholarPersistAllowed = false;
}

async function getAnchoredOrcidProfile(orcid, credentials = {}, signal) {
  const profile = await ORCIDService.getProfile(
    orcid,
    credentials.orcidClientId,
    credentials.orcidClientSecret,
    signal ? { signal } : {},
  );
  if (!profile) {
    return {
      status: 'resolved',
      orcidId: orcid,
      orcidUrl: `https://orcid.org/${orcid}`,
      name: null,
      source: 'orcid_anchor',
      identityStatus: 'probable',
    };
  }
  return {
    status: 'resolved',
    orcidId: profile.orcidId,
    orcidUrl: profile.orcidUrl,
    name: profile.creditName || `${profile.givenNames || ''} ${profile.familyName || ''}`.trim(),
    email: profile.primaryEmail,
    website: profile.primaryUrl,
    affiliation: profile.currentAffiliation,
    affiliations: profile.affiliations || [],
    institutionCorroborated: false,
    matchedInstitution: null,
    source: 'orcid_anchor',
    identityStatus: 'probable',
  };
}

module.exports = {
  identityAnchorForCandidate,
  cleanInstitution,
  effectiveInstitution,
  searchCandidateWithInstitution,
  anchorWithInstitution,
  hasOrcidAnchor,
  markUnanchoredAbstain,
  getAnchoredOrcidProfile,
};
