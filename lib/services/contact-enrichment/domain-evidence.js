/**
 * ContactEnrichmentService — domain-evidence cluster.
 *
 * Stage 2 of the ContactEnrichmentService decomposition
 * (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md). Behavior-freeze, pure
 * code motion: the 11 institution/domain-evidence helpers moved verbatim out of
 * contact-enrichment-service.js; internal `this._x(...)` self-calls became direct
 * sibling-function calls. The facade keeps a thin delegating wrapper for each.
 * DAG leaf — depends only on ContactParser, normalizeOrcid, mayPersistIdentity,
 * and OpenAlexService (all stateless).
 */

const { ContactParser } = require('../../utils/contact-parser');
const { mayPersistIdentity } = require('../reviewer-identity-resolver');
const { OpenAlexService } = require('../openalex-service');
const { normalizeOrcid } = require('../reviewer-work-author-resolver');

function institutionTokens(value) {
  return ContactParser.normalizeNameForMatch(value || '')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !['department', 'university', 'institute', 'school', 'college'].includes(token));
}

function institutionsContradict(anchorInstitution, resultInstitution) {
  if (!anchorInstitution || !resultInstitution) return false;
  const anchorTokens = new Set(institutionTokens(anchorInstitution));
  const resultTokens = institutionTokens(resultInstitution);
  if (!anchorTokens.size || !resultTokens.length) return false;
  return !resultTokens.some((token) => anchorTokens.has(token));
}

function resultContradictsAnchor(result = {}, anchor = null) {
  if (!anchor) return false;
  const resultOrcid = normalizeOrcid(result.orcid || result.orcidId);
  if (resultOrcid && anchor.orcid && resultOrcid !== anchor.orcid) return true;
  const resultInstitution = result.affiliation || result.institution || result.organization || null;
  return institutionsContradict(anchor.institution, resultInstitution);
}

// Normalize a domain for comparison: extract the host, lowercase, strip hyphens
// (Google Scholar drops them in its "Verified email at X" hint, so its
// mbiberlin.de must compare equal to the real mbi-berlin.de).
function normalizeDomain(value) {
  if (!value) return null;
  const m = String(value).toLowerCase().match(/[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0].replace(/-/g, '') : null;
}

function emailDomain(email) {
  if (!email || !String(email).includes('@')) return null;
  return normalizeDomain(String(email).split('@').pop());
}

function domainRelated(domain, verifiedDomain) {
  const a = normalizeDomain(domain);
  const b = normalizeDomain(verifiedDomain);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function emailDomainRelatedToAny(email, domains = []) {
  const emailDom = emailDomain(email);
  if (!emailDom) return false;
  return domains.some((domain) => domainRelated(emailDom, domain));
}

function addInstitutionDomain(set, domain) {
  if (!set || !domain) return;
  const value = String(domain).trim().toLowerCase();
  if (value && value.includes('.')) set.add(value);
}

function currentOrcidInstitutionRefs(ce = {}) {
  const affiliations = ce.tierResults?.orcid?.affiliations;
  if (!Array.isArray(affiliations)) return [];
  return affiliations
    .filter((aff) => aff?.current === true)
    .map((aff) => ({
      id: aff.disambiguatedOrganizationId || null,
      source: aff.disambiguationSource || null,
    }))
    .filter((ref) => ref.id && String(ref.source || '').toUpperCase() === 'ROR');
}

function currentOrcidInstitutionNames(ce = {}) {
  const affiliations = ce.tierResults?.orcid?.affiliations;
  if (!Array.isArray(affiliations)) return [];
  return [...new Set(affiliations
    .filter((aff) => aff?.current === true)
    .map((aff) => typeof aff.organization === 'string' ? aff.organization.trim() : '')
    .filter(Boolean))]
    .slice(0, 4);
}

function strongInstitutionDisplayMatch(query, displayName) {
  const q = ContactParser.normalizeNameForMatch(query || '');
  const d = ContactParser.normalizeNameForMatch(displayName || '');
  if (!q || !d) return false;
  return q === d || q.includes(d) || d.includes(q);
}

async function buildInstitutionDomainEvidence(candidate, result, { signal } = {}) {
  const ce = result?.contactEnrichment;
  if (!ce) return { anchoredDomains: [], plausibleDomains: [] };

  const anchored = new Set();
  const plausible = new Set();
  const identityTrusted = mayPersistIdentity(ce.identity?.status);
  const currentOrcidNames = identityTrusted ? currentOrcidInstitutionNames(ce) : [];
  const currentOrcidNameSet = new Set(currentOrcidNames);

  if (identityTrusted) {
    addInstitutionDomain(anchored, ce.verifiedInstitutionDomain);
    for (const ref of currentOrcidInstitutionRefs(ce)) {
      try {
        const inst = await OpenAlexService.getInstitution(ref.id, { signal });
        addInstitutionDomain(anchored, inst?.domain);
      } catch (err) {
        if (signal?.aborted) throw err;
      }
    }
  }

  for (const domain of anchored) addInstitutionDomain(plausible, domain);

  const institutionNames = [
    ...currentOrcidNames,
    ce.orcidAffiliation,
    ce.openAlexAffiliation,
    candidate?.affiliation,
    candidate?.institution,
    candidate?.primaryAffiliation,
  ].filter((v, i, arr) => typeof v === 'string' && v.trim() && arr.indexOf(v) === i);
  for (const name of institutionNames) {
    try {
      const [top] = await OpenAlexService.searchInstitutions(name, { signal, limit: 1 });
      if (top?.domain && strongInstitutionDisplayMatch(name, top.displayName)) {
        addInstitutionDomain(plausible, top.domain);
        // Every current ORCID employment belongs to the already-resolved
        // researcher identity. Once OpenAlex strongly resolves that institution
        // name, its domain is safe to use as a first-party eligibility source.
        // This preserves co-affiliations (e.g. lab + university) instead of
        // trusting only ORCID's first current employment.
        if (currentOrcidNameSet.has(name)) addInstitutionDomain(anchored, top.domain);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }

  ce.anchoredInstitutionDomains = [...anchored];
  ce.plausibleInstitutionDomains = [...plausible];
  return {
    anchoredDomains: ce.anchoredInstitutionDomains,
    plausibleDomains: ce.plausibleInstitutionDomains,
  };
}

module.exports = {
  institutionTokens,
  institutionsContradict,
  resultContradictsAnchor,
  normalizeDomain,
  emailDomain,
  domainRelated,
  emailDomainRelatedToAny,
  addInstitutionDomain,
  currentOrcidInstitutionRefs,
  currentOrcidInstitutionNames,
  strongInstitutionDisplayMatch,
  buildInstitutionDomainEvidence,
};
