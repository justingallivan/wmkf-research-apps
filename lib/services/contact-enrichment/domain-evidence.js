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

// The composite batch keeps its historical lookup behavior (rather than
// silently skipping additional affiliations), while persisted cold evidence is
// deliberately bounded by the stage contract. More lookups than this can
// still inform the live display, but cannot certify complete cache authority.
const MAX_COMPAT_PERSISTED_INSTITUTION_LOOKUPS = 8;

async function buildInstitutionDomainEvidence(candidate, result, { signal } = {}) {
  const ce = result?.contactEnrichment;
  if (!ce) return { anchoredDomains: [], plausibleDomains: [] };

  const anchored = new Set();
  const plausible = new Set();
  const institutions = [];
  const lookups = [];
  let incompleteReason = null;
  const addInstitution = (value) => {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || institutions.some((existing) => existing.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))) return;
    institutions.push(name);
  };
  const recordFailure = (error) => {
    const state = lookupErrorState(error, signal);
    if (!incompleteReason) {
      incompleteReason = state === 'aborted'
        ? 'institution_lookup_aborted'
        : state === 'timeout'
          ? 'institution_lookup_timeout'
          : 'institution_lookup_failed';
    }
    return state;
  };
  const identityTrusted = mayPersistIdentity(ce.identity?.status);
  const currentOrcidNames = identityTrusted ? currentOrcidInstitutionNames(ce) : [];
  const currentOrcidNameSet = new Set(currentOrcidNames);

  if (identityTrusted) {
    addInstitutionDomain(anchored, ce.verifiedInstitutionDomain);
    for (const ref of currentOrcidInstitutionRefs(ce)) {
      const lookup = { kind: 'ror', key: String(ref.id).slice(0, 160), state: 'started' };
      lookups.push(lookup);
      try {
        const inst = await OpenAlexService.getInstitution(ref.id, { signal });
        addInstitutionDomain(anchored, inst?.domain);
        lookup.state = inst?.domain ? 'resolved' : 'no_domain';
        addInstitution(inst?.displayName);
      } catch (err) {
        if (signal?.aborted) throw err;
        lookup.state = recordFailure(err);
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
    const lookup = { kind: 'name', key: name.slice(0, 160), state: 'started' };
    lookups.push(lookup);
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
      lookup.state = top?.domain && strongInstitutionDisplayMatch(name, top.displayName) ? 'resolved' : 'no_domain';
      addInstitution(top?.displayName || name);
    } catch (err) {
      if (signal?.aborted) throw err;
      lookup.state = recordFailure(err);
    }
  }

  ce.anchoredInstitutionDomains = [...anchored];
  ce.plausibleInstitutionDomains = [...plausible];
  const coverageTruncated = lookups.length > MAX_COMPAT_PERSISTED_INSTITUTION_LOOKUPS;
  ce.institutionDomainEvidence = {
    outcome: incompleteReason || coverageTruncated ? 'incomplete' : 'current',
    reasonCode: incompleteReason || (coverageTruncated
      ? 'partial_coverage'
      : ce.anchoredInstitutionDomains.length || ce.plausibleInstitutionDomains.length ? null : 'no_trusted_domains'),
    anchoredDomains: ce.anchoredInstitutionDomains,
    plausibleDomains: ce.plausibleInstitutionDomains,
    institutions: dedupeBounded(institutions),
    lookups,
    lookupCount: lookups.length,
    coverageTruncated,
  };
  return {
    anchoredDomains: ce.anchoredInstitutionDomains,
    plausibleDomains: ce.plausibleInstitutionDomains,
    institutionDomainEvidence: ce.institutionDomainEvidence,
  };
}

// ---------------------------------------------------------------------------
// Authoritative warm-stage producer support
//
// `buildInstitutionDomainEvidence` above is a compatibility helper for the
// composite cold-enrichment pipeline.  Its historical best-effort behaviour
// intentionally catches individual OpenAlex failures, because that pipeline
// still has useful contact work to finish.  A targeted warm-stage refresh has
// a different safety contract: it must record every required lookup and must
// never turn a provider failure into the clean `no_trusted_domains` outcome.
// Keep that stricter contract additive so the cold path remains behavior-free.

const MAX_STAGE_INSTITUTION_LOOKUPS = 8;

function boundedText(value, maxLength = 240) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function dedupeBounded(values, limit = 4) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const normalized = boundedText(value);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function lookupErrorState(error, signal) {
  if (signal?.aborted || error?.name === 'AbortError') return 'aborted';
  if (error?.code === 'orcid_timeout' || error?.code === 'timeout') return 'timeout';
  return 'error';
}

function stageContactEnrichment(candidate = {}, result = {}, identityEvidence = {}) {
  const selected = identityEvidence?.selectedRecord || result?.selectedRecord || null;
  const contactEnrichment = {
    ...(candidate?.contactEnrichment || {}),
    ...(result?.contactEnrichment || {}),
    ...(identityEvidence?.contactEnrichment || {}),
  };
  if (!contactEnrichment.openAlexAffiliation && boundedText(selected?.lastKnownInstitution)) {
    contactEnrichment.openAlexAffiliation = selected.lastKnownInstitution;
  }
  if (!contactEnrichment.openAlexInstitutionId && boundedText(selected?.lastKnownInstitutionId)) {
    contactEnrichment.openAlexInstitutionId = selected.lastKnownInstitutionId;
  }
  if (!contactEnrichment.openAlexInstitutionRor && boundedText(selected?.lastKnownInstitutionRor)) {
    contactEnrichment.openAlexInstitutionRor = selected.lastKnownInstitutionRor;
  }
  return contactEnrichment;
}

/**
 * Resolve bounded institution-domain evidence for exactly one authoritative
 * identity.  The returned `lookups` array is deliberately data-minimal: it
 * records that each source lookup completed, failed, timed out, or was
 * aborted, without retaining provider payloads or query prose.
 *
 * This helper does no persistence, email discovery, identity resolution, or
 * eligibility work.  Callers decide whether the identity is authoritative
 * before invoking it; `identityTrusted` is retained as a defensive gate for
 * direct callers.
 */
async function resolveInstitutionDomainEvidence(candidate = {}, result = {}, {
  signal,
  identityEvidence = result?.identityEvidence || result?.identity || null,
  identityTrusted = mayPersistIdentity(identityEvidence?.status || result?.identity?.status),
  openAlexService = OpenAlexService,
} = {}) {
  if (!identityTrusted) {
    return {
      outcome: 'not_applicable',
      reasonCode: 'identity_not_authoritative',
      anchoredDomains: [],
      plausibleDomains: [],
      institutions: [],
      lookups: [],
    };
  }

  const ce = stageContactEnrichment(candidate, result, identityEvidence || {});
  const anchored = new Set();
  const plausible = new Set();
  const institutions = [];
  const lookups = [];
  const addDomain = (set, value) => {
    const domain = normalizeDomain(value);
    if (domain) set.add(domain);
  };
  const addInstitution = (value, source, anchoredSource = false) => {
    const name = boundedText(value);
    if (!name) return;
    const key = name.toLocaleLowerCase('en-US');
    const existing = institutions.find((entry) => entry.key === key);
    if (existing) {
      existing.anchored = existing.anchored || anchoredSource;
      return;
    }
    institutions.push({ key, name, source, anchored: !!anchoredSource });
  };

  addDomain(anchored, ce.verifiedInstitutionDomain);
  for (const ref of currentOrcidInstitutionRefs(ce)) {
    if (lookups.length >= MAX_STAGE_INSTITUTION_LOOKUPS) {
      return {
        outcome: 'incomplete',
        reasonCode: 'institution_lookup_limit_exceeded',
        anchoredDomains: dedupeBounded([...anchored]),
        plausibleDomains: dedupeBounded([...plausible, ...anchored]),
        institutions: dedupeBounded(institutions.map((entry) => entry.name)),
        lookups,
      };
    }
    const lookup = { kind: 'ror', key: String(ref.id).slice(0, 160), state: 'started' };
    lookups.push(lookup);
    try {
      const institution = await openAlexService.getInstitution(ref.id, { signal });
      const domain = normalizeDomain(institution?.domain);
      lookup.state = domain ? 'resolved' : 'no_domain';
      if (domain) {
        addDomain(anchored, domain);
        addDomain(plausible, domain);
      }
      addInstitution(institution?.displayName, 'orcid_ror', true);
    } catch (error) {
      lookup.state = lookupErrorState(error, signal);
      return {
        outcome: 'incomplete',
        reasonCode: lookup.state === 'aborted' ? 'institution_lookup_aborted' : 'institution_lookup_failed',
        anchoredDomains: dedupeBounded([...anchored]),
        plausibleDomains: dedupeBounded([...plausible, ...anchored]),
        institutions: dedupeBounded(institutions.map((entry) => entry.name)),
        lookups,
      };
    }
  }

  const currentOrcidNames = currentOrcidInstitutionNames(ce);
  const currentOrcidNameSet = new Set(currentOrcidNames.map((name) => name.toLocaleLowerCase('en-US')));
  const names = dedupeBounded([
    ...currentOrcidNames,
    ce.orcidAffiliation,
    ce.openAlexAffiliation,
    candidate?.affiliation,
    candidate?.institution,
    candidate?.primaryAffiliation,
  ], MAX_STAGE_INSTITUTION_LOOKUPS - lookups.length);

  for (const name of names) {
    const lookup = { kind: 'name', key: name.slice(0, 160), state: 'started' };
    lookups.push(lookup);
    try {
      const found = await openAlexService.searchInstitutions(name, { signal, limit: 1 });
      const institution = Array.isArray(found) ? found[0] : null;
      const matches = !!(institution?.domain && strongInstitutionDisplayMatch(name, institution.displayName));
      lookup.state = matches ? 'resolved' : 'no_domain';
      if (matches) {
        addDomain(plausible, institution.domain);
        if (currentOrcidNameSet.has(name.toLocaleLowerCase('en-US'))) {
          addDomain(anchored, institution.domain);
        }
      }
      addInstitution(institution?.displayName || name, currentOrcidNameSet.has(name.toLocaleLowerCase('en-US')) ? 'orcid_current' : 'claimed', currentOrcidNameSet.has(name.toLocaleLowerCase('en-US')));
    } catch (error) {
      lookup.state = lookupErrorState(error, signal);
      return {
        outcome: 'incomplete',
        reasonCode: lookup.state === 'aborted' ? 'institution_lookup_aborted' : 'institution_lookup_failed',
        anchoredDomains: dedupeBounded([...anchored]),
        plausibleDomains: dedupeBounded([...plausible, ...anchored]),
        institutions: dedupeBounded(institutions.map((entry) => entry.name)),
        lookups,
      };
    }
  }

  const anchoredDomains = dedupeBounded([...anchored]);
  const plausibleDomains = dedupeBounded([...plausible, ...anchored]);
  return {
    outcome: 'current',
    reasonCode: anchoredDomains.length || plausibleDomains.length ? null : 'no_trusted_domains',
    anchoredDomains,
    plausibleDomains,
    institutions: dedupeBounded(institutions.map((entry) => entry.name)),
    lookups,
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
  resolveInstitutionDomainEvidence,
};
