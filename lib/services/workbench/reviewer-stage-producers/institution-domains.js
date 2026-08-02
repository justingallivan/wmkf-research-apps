/**
 * One-candidate authoritative institution-domain stage producer.
 *
 * It is intentionally narrower than contact enrichment: no identity resolver,
 * contact lookup, eligibility classification, persistence, or metrics.  The
 * coordinator owns prerequisite planning and all durable writes.
 */

const { createHash } = require('node:crypto');
const domainEvidence = require('../../contact-enrichment/domain-evidence');
const {
  currentOrcidRorInputs,
  institutionDomainInputFingerprint,
} = require('../institution-domain-input-fingerprint');
const {
  isIdentityAuthoritySatisfied,
  isIdentityStageCurrent,
} = require('./identity');

const INSTITUTION_DOMAINS_STAGE_CONTRACT_VERSION = 1;
const INSTITUTION_DOMAINS_SOURCE_CONTRACT_VERSION = 'institution-domain-evidence:v1';
const MAX_DOMAINS = 4;
const MAX_INSTITUTIONS = 4;
const MAX_LOOKUPS = 8;
const LOOKUP_STATES = new Set(['resolved', 'no_domain', 'error', 'timeout', 'aborted']);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function version(namespace, value) {
  return createHash('sha256').update(`${namespace}\n${stableStringify(value)}`, 'utf8').digest('hex');
}

function boundedText(value, maxLength = 240) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function canonicalIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function completedAt(value) {
  return canonicalIso(value) ? value : new Date().toISOString();
}

function authoritativeSourceVersion(expectedSourceVersion) {
  return typeof expectedSourceVersion === 'string' && /^[a-f0-9]{64}$/i.test(expectedSourceVersion)
    ? expectedSourceVersion.toLowerCase()
    : null;
}

function unavailableSourceVersion() { return 'stage_source_authority_unavailable'; }

function dedupe(values, { max = MAX_DOMAINS, normalize = (value) => String(value).toLowerCase() } = {}) {
  const seen = new Set();
  const result = [];
  for (const raw of values || []) {
    const value = boundedText(raw);
    if (!value) continue;
    const key = normalize(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

function boundedLookup(value = {}) {
  const kind = boundedText(value.kind, 20);
  const key = boundedText(value.key, 160);
  const state = boundedText(value.state, 20);
  if (!kind || !key || !LOOKUP_STATES.has(state)) return null;
  return { kind, key, state };
}

function boundedEvidence(domainResult = {}, { inputFingerprint = null } = {}) {
  const anchoredDomains = dedupe(domainResult.anchoredDomains, {
    normalize: (value) => value.toLocaleLowerCase('en-US'),
  });
  const plausibleDomains = dedupe(domainResult.plausibleDomains, {
    normalize: (value) => value.toLocaleLowerCase('en-US'),
  });
  const institutions = dedupe(domainResult.institutions, {
    max: MAX_INSTITUTIONS,
    normalize: (value) => value.toLocaleLowerCase('en-US'),
  });
  const lookups = (Array.isArray(domainResult.lookups) ? domainResult.lookups : [])
    .map(boundedLookup)
    .filter(Boolean)
    .slice(0, MAX_LOOKUPS);
  const reasonCode = boundedText(domainResult.reasonCode, 80);
  const outcome = String(domainResult.outcome || '').toLowerCase();
  const completeness = outcome === 'current' ? 'complete'
    : outcome === 'not_applicable' ? 'not_applicable'
      : 'incomplete';
  return {
    ...(typeof inputFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(inputFingerprint)
      ? { inputFingerprint } : {}),
    anchoredDomains,
    plausibleDomains,
    institutions,
    lookups,
    completeness,
    ...(reasonCode ? { reasonCode } : {}),
  };
}

function envelope({ outcome, evidencePatch, sourceVersion, resultVersion, when, reasonCode = null, failureCode = null }) {
  const state = outcome === 'not_applicable' ? 'not_applicable'
    : outcome === 'current' ? 'current'
      : 'incomplete';
  const persistenceFailureCode = failureCode && (
    failureCode.includes('lookup') || failureCode.includes('provider')
  ) ? 'provider_unavailable'
    : failureCode && failureCode.includes('unknown') ? 'partial_coverage'
      : failureCode ? 'missing_required_input' : null;
  return {
    outcome,
    evidencePatch,
    receipt: {
      state,
      contractVersion: INSTITUTION_DOMAINS_STAGE_CONTRACT_VERSION,
      sourceVersion,
      resultVersion,
      completedAt: state === 'incomplete' ? null : when,
      reasonCode: state === 'not_applicable' ? reasonCode : null,
      failureCode: state === 'incomplete' ? persistenceFailureCode : null,
    },
  };
}

function identityPrerequisiteEnvelope({ sourceVersion, when, failureCode }) {
  return envelope({
    outcome: 'incomplete',
    evidencePatch: {},
    sourceVersion,
    resultVersion: version('reviewer-stage-institution-domains:incomplete:v1', { failureCode }),
    when,
    failureCode,
  });
}

function institutionDomainEvidencePatch(institutionDomainEvidence) {
  return {
    institutionDomainEvidence,
    trustedInstitutionDomains: institutionDomainEvidence.anchoredDomains,
    plausibleInstitutionDomains: institutionDomainEvidence.plausibleDomains,
  };
}

// The generic roster/contact blob can contain browser-provided enrichment from
// an earlier search.  It is useful as a display artifact, but it cannot be an
// authority for a trusted institution domain.  Give the domain resolver only
// the sealed identity decision plus a claimed top-level affiliation.  The
// latter may yield *plausible* evidence after a live lookup; it can never
// manufacture an ORCID/ROR or verified-domain anchor.
function candidateForDomainResolver(candidate = {}, identityEvidence = {}, identityResult = {}) {
  const identity = identityEvidence && typeof identityEvidence === 'object' && !Array.isArray(identityEvidence)
    ? identityEvidence
    : {};
  const result = identityResult && typeof identityResult === 'object' && !Array.isArray(identityResult)
    ? identityResult
    : {};
  const selected = result.selectedRecord && typeof result.selectedRecord === 'object'
    ? result.selectedRecord
    : null;
  const claimedAffiliation = boundedText(
    selected?.lastKnownInstitution
      || candidate.primaryAffiliation
      || candidate.affiliation
      || candidate.institution,
    320,
  );
  const decision = boundedText(identity.decision || identity.status || result.status || result.resolverStatus, 40);
  return {
    candidateKey: boundedText(candidate.candidateKey, 560),
    ...(claimedAffiliation ? {
      primaryAffiliation: claimedAffiliation,
      affiliation: claimedAffiliation,
      institution: claimedAffiliation,
    } : {}),
    contactEnrichment: {
      identity: decision ? { status: decision } : {},
      ...(selected?.lastKnownInstitution ? {
        openAlexAffiliation: boundedText(selected.lastKnownInstitution, 320),
        openAlexInstitutionId: boundedText(selected.lastKnownInstitutionId, 120),
        openAlexInstitutionRor: boundedText(selected.lastKnownInstitutionRor, 240),
      } : {}),
    },
  };
}

/**
 * Pure projection of a single domain-resolution result.  A lookup error,
 * timeout, abort, missing outcome, or unknown outcome can never become the
 * otherwise valid `no_trusted_domains` result.
 */
function projectInstitutionDomainsEvidence({
  candidate = {},
  identityReceipt = {},
  identityEvidence = {},
  identityResult = {},
  domainResult = null,
  completedAt: completed,
  sourceContractVersion = INSTITUTION_DOMAINS_SOURCE_CONTRACT_VERSION,
  expectedSourceVersion = null,
  expectedInputFingerprint = null,
} = {}) {
  const when = completedAt(completed);
  const inputFingerprint = institutionDomainInputFingerprint(candidate);
  const sourceVersion = authoritativeSourceVersion(expectedSourceVersion);
  if (!sourceVersion) {
    return identityPrerequisiteEnvelope({
      sourceVersion: unavailableSourceVersion(), when, failureCode: 'institution_source_unavailable',
    });
  }
  if (expectedInputFingerprint !== null && expectedInputFingerprint !== inputFingerprint) {
    return identityPrerequisiteEnvelope({ sourceVersion, when, failureCode: 'institution_input_changed' });
  }
  if (!isIdentityStageCurrent(identityReceipt)) {
    return identityPrerequisiteEnvelope({ sourceVersion, when, failureCode: 'identity_stage_not_current' });
  }
  if (!isIdentityAuthoritySatisfied({ candidate, identityEvidence, identityResult })) {
    const institutionDomainEvidence = {
      inputFingerprint,
      anchoredDomains: [],
      plausibleDomains: [],
      institutions: [],
      lookups: [],
      completeness: 'not_applicable',
      reasonCode: 'identity_not_authoritative',
    };
    return envelope({
      outcome: 'not_applicable',
      evidencePatch: institutionDomainEvidencePatch(institutionDomainEvidence),
      sourceVersion,
      resultVersion: version('reviewer-stage-institution-domains:na:v1', institutionDomainEvidence),
      when,
      reasonCode: 'identity_not_authoritative',
    });
  }
  if (!domainResult || typeof domainResult !== 'object') {
    return identityPrerequisiteEnvelope({ sourceVersion, when, failureCode: 'institution_result_unavailable' });
  }
  const outcome = String(domainResult.outcome || '').toLowerCase();
  const institutionDomainEvidence = boundedEvidence(domainResult, { inputFingerprint });
  if (outcome === 'current') {
    return envelope({
      outcome: 'current',
      evidencePatch: institutionDomainEvidencePatch(institutionDomainEvidence),
      sourceVersion,
      resultVersion: version('reviewer-stage-institution-domains:result:v1', institutionDomainEvidence),
      when,
      // `no_trusted_domains` is a complete current result, not a stage N/A:
      // keep its detail in bounded evidence and leave the receipt reason null.
      reasonCode: null,
    });
  }
  // A direct resolver invocation should only yield N/A on an identity gate,
  // which is handled above.  Any other N/A from a dependency is unknown and
  // therefore remains incomplete.
  return envelope({
    outcome: 'incomplete',
    evidencePatch: institutionDomainEvidencePatch(institutionDomainEvidence),
    sourceVersion,
    resultVersion: version('reviewer-stage-institution-domains:incomplete:v1', {
      evidence: institutionDomainEvidence,
      outcome: boundedText(outcome, 40),
    }),
    when,
    failureCode: boundedText(domainResult.reasonCode, 80) || 'institution_lookup_incomplete',
  });
}

/**
 * Execute the strict single-candidate resolver.  `resolveDomains` is injected
 * for unit tests; it must use the caller's AbortSignal and must not perform
 * contact/eligibility/identity/persistence work.
 */
async function produceInstitutionDomainsEvidence({
  candidate = {},
  identityReceipt = {},
  identityEvidence = {},
  identityResult = {},
  signal,
  completedAt: completed,
  resolveDomains = domainEvidence.resolveInstitutionDomainEvidence,
  sourceContractVersion = INSTITUTION_DOMAINS_SOURCE_CONTRACT_VERSION,
  expectedSourceVersion = null,
  expectedInputFingerprint = null,
} = {}) {
  if (!isIdentityStageCurrent(identityReceipt)) {
    return projectInstitutionDomainsEvidence({
      candidate,
      identityReceipt,
      identityEvidence,
      identityResult,
      domainResult: null,
      completedAt: completed,
      sourceContractVersion,
      expectedSourceVersion,
      expectedInputFingerprint,
    });
  }
  if (!isIdentityAuthoritySatisfied({ candidate, identityEvidence, identityResult })) {
    return projectInstitutionDomainsEvidence({
      candidate,
      identityReceipt,
      identityEvidence,
      identityResult,
      domainResult: null,
      completedAt: completed,
      sourceContractVersion,
      expectedSourceVersion,
      expectedInputFingerprint,
    });
  }
  const preflight = projectInstitutionDomainsEvidence({
    candidate,
    identityReceipt,
    identityEvidence,
    identityResult,
    domainResult: null,
    completedAt: completed,
    sourceContractVersion,
    expectedSourceVersion,
    expectedInputFingerprint,
  });
  if (typeof resolveDomains !== 'function') return preflight;
  try {
    const resolverCandidate = candidateForDomainResolver(candidate, identityEvidence, identityResult);
    const domainResult = await resolveDomains(resolverCandidate, { identityEvidence, identityResult }, {
      signal,
      identityEvidence: {
        status: identityEvidence?.status || identityEvidence?.decision || identityResult?.status || null,
        orcid: identityEvidence?.orcid || null,
        selectedRecord: identityResult?.selectedRecord || null,
      },
      identityTrusted: true,
    });
    return projectInstitutionDomainsEvidence({
      candidate,
      identityReceipt,
      identityEvidence,
      identityResult,
      domainResult,
      completedAt: completed,
      sourceContractVersion,
      expectedSourceVersion,
      expectedInputFingerprint,
    });
  } catch (error) {
    return projectInstitutionDomainsEvidence({
      candidate,
      identityReceipt,
      identityEvidence,
      identityResult,
      domainResult: {
        outcome: 'incomplete',
        reasonCode: signal?.aborted || error?.name === 'AbortError'
          ? 'institution_lookup_aborted'
          : 'institution_lookup_failed',
      },
      completedAt: completed,
      sourceContractVersion,
      expectedSourceVersion,
      expectedInputFingerprint,
    });
  }
}

module.exports = {
  INSTITUTION_DOMAINS_STAGE_CONTRACT_VERSION,
  INSTITUTION_DOMAINS_SOURCE_CONTRACT_VERSION,
  projectInstitutionDomainsEvidence,
  produceInstitutionDomainsEvidence,
  _internals: {
    boundedEvidence,
    boundedLookup,
    candidateForDomainResolver,
    completedAt,
    currentOrcidRorInputs,
    institutionDomainInputFingerprint,
    stableStringify,
    version,
  },
};
