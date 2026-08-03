/**
 * One-candidate institution-COI stage producer.
 *
 * The producer reads a fresh server-owned COI context and runs only the pure
 * institution matcher.  It never treats an unavailable context, a missing
 * current affiliation, or an unknown matcher response as a clean result.
 */

const { createHash } = require('node:crypto');
const { loadCoiContext } = require('../../reviewer-request-context');
const {
  canonicalizeInstitutionCoiContext,
  hashInstitutionCoiContext,
  INSTITUTION_COI_RULE_VERSION,
} = require('../../institution-coi-context');
const { DeduplicationService } = require('../../deduplication-service');
const {
  isIdentityAuthoritySatisfied,
  isIdentityStageCurrent,
} = require('./identity');
const { isGuid } = require('../../../utils/guid');

const INSTITUTION_COI_STAGE_CONTRACT_VERSION = 1;
const INSTITUTION_COI_SOURCE_CONTRACT_VERSION = 'institution-coi:v1';
const DROP_DECISIONS = new Set(['dropped', 'flagged', 'exempt']);

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

function currentAffiliation(candidate = {}, identityResult = {}) {
  const selected = identityResult?.selectedRecord || null;
  return boundedText(
    selected?.lastKnownInstitution
      || candidate?.primaryAffiliation
      || candidate?.affiliation
      || candidate?.institution,
    320,
  );
}

function candidateForMatcher(candidate = {}, identityResult = {}) {
  const affiliation = currentAffiliation(candidate, identityResult);
  if (!affiliation) return null;
  const selected = identityResult?.selectedRecord || {};
  // Do not spread `candidate.contactEnrichment`: that generic browser/legacy
  // cache may contain an unsealed affiliation or OpenAlex identifiers.  The
  // matcher gets a closed view built from identity-owned selected-record data
  // and the server roster's claimed affiliation only.
  const contactEnrichment = {
    affiliation,
    affiliationSource: selected.lastKnownInstitution
      ? 'openalex_current'
      : candidate.primaryAffiliationSource
      || candidate.affiliationSource
      || 'claimed',
    openAlexAffiliation: boundedText(selected.lastKnownInstitution, 320),
    openAlexInstitutionId: boundedText(selected.lastKnownInstitutionId, 120),
    openAlexInstitutionRor: boundedText(selected.lastKnownInstitutionRor, 240),
  };
  return {
    candidateKey: candidate.candidateKey,
    affiliation,
    primaryAffiliation: affiliation,
    institution: affiliation,
    contactEnrichment,
  };
}

function canonicalEntriesForMatcher(canonical = {}) {
  return (Array.isArray(canonical.institutions) ? canonical.institutions : []).map((institution) => ({
    identity: {
      name: institution.baseName || institution.expandedName || null,
      openAlexId: institution.openAlexId || null,
      ror: institution.ror || null,
    },
    display: institution.baseName || institution.expandedName || null,
  }));
}

function boundedDetails(details = {}) {
  const result = {};
  for (const key of [
    'piInstitution',
    'reviewerInstitution',
    'dropDecision',
    'corroborationReason',
    'matchedAffiliationSource',
    'contradictoryAffiliationSource',
    'exemptInstitution',
  ]) {
    const value = boundedText(details?.[key], key.includes('Institution') ? 320 : 120);
    if (value) result[key] = value;
  }
  return result;
}

function boundedDecision(decision) {
  if (decision === null) {
    return { hasInstitutionCOI: false, dropDecision: 'clean', details: {} };
  }
  const dropDecision = boundedText(decision?.dropDecision, 40);
  if (!DROP_DECISIONS.has(dropDecision)) return null;
  const candidate = decision?.candidate || {};
  return {
    hasInstitutionCOI: candidate.hasInstitutionCOI === true,
    dropDecision,
    details: boundedDetails(candidate.institutionCOIDetails),
  };
}

function makeEnvelope({ outcome, evidencePatch = {}, sourceVersion, resultVersion, when, reasonCode = null, failureCode = null }) {
  const state = outcome === 'not_applicable' ? 'not_applicable' : outcome === 'current' ? 'current' : 'incomplete';
  const persistenceFailureCode = failureCode && (
    failureCode.includes('aborted') || failureCode.includes('matcher')
  ) ? 'provider_unavailable'
    : failureCode && failureCode.includes('unknown') ? 'partial_coverage'
      : failureCode ? 'missing_required_input' : null;
  return {
    outcome,
    evidencePatch,
    receipt: {
      state,
      contractVersion: INSTITUTION_COI_STAGE_CONTRACT_VERSION,
      sourceVersion,
      resultVersion,
      completedAt: state === 'incomplete' ? null : when,
      reasonCode: state === 'not_applicable' ? reasonCode : null,
      failureCode: state === 'incomplete' ? persistenceFailureCode : null,
    },
  };
}

function incompleteEnvelope({ candidate, identityReceipt, identityResult = {}, when, failureCode, contextHash = null, sourceContractVersion, expectedSourceVersion = null }) {
  const sourceVersion = authoritativeSourceVersion(expectedSourceVersion) || unavailableSourceVersion();
  return makeEnvelope({
    outcome: 'incomplete',
    sourceVersion,
    resultVersion: version('reviewer-stage-institution-coi:incomplete:v1', { failureCode, contextHash }),
    when,
    failureCode,
  });
}

function notApplicableEnvelope({ candidate, identityReceipt, when, sourceContractVersion, expectedSourceVersion = null }) {
  const sourceVersion = authoritativeSourceVersion(expectedSourceVersion) || unavailableSourceVersion();
  const institutionCoiEvidence = {
    hasInstitutionCOI: false,
    dropDecision: 'not_applicable',
    details: {},
    reasonCode: 'identity_not_authoritative',
  };
  return makeEnvelope({
    outcome: 'not_applicable',
    evidencePatch: {
      institutionCoiEvidence,
      hasInstitutionCOI: false,
      institutionCOIDetails: {},
    },
    sourceVersion,
    resultVersion: version('reviewer-stage-institution-coi:na:v1', institutionCoiEvidence),
    when,
    reasonCode: 'identity_not_authoritative',
  });
}

/**
 * Pure stage projection.  `context` must be the server result of
 * `loadCoiContext`; it is canonicalized and hashed before a decision is
 * accepted.  A `null` matcher decision is the only clean outcome.
 */
function projectInstitutionCoiEvidence({
  requestId,
  candidate = {},
  identityReceipt = {},
  identityEvidence = {},
  identityResult = {},
  context = null,
  decision = undefined,
  completedAt: completed,
  sourceContractVersion = INSTITUTION_COI_SOURCE_CONTRACT_VERSION,
  expectedSourceVersion = null,
} = {}) {
  const when = completedAt(completed);
  if (!authoritativeSourceVersion(expectedSourceVersion)) {
    return incompleteEnvelope({
      candidate, identityReceipt, identityResult, when,
      failureCode: 'coi_source_unavailable', sourceContractVersion, expectedSourceVersion,
    });
  }
  if (!isIdentityStageCurrent(identityReceipt)) {
    return incompleteEnvelope({ candidate, identityReceipt, identityResult, when, failureCode: 'identity_stage_not_current', sourceContractVersion, expectedSourceVersion });
  }
  if (!isIdentityAuthoritySatisfied({ candidate, identityEvidence, identityResult })) {
    return notApplicableEnvelope({ candidate, identityReceipt, when, sourceContractVersion, expectedSourceVersion });
  }
  if (!isGuid(requestId)) {
    return incompleteEnvelope({ candidate, identityReceipt, identityResult, when, failureCode: 'coi_request_unavailable', sourceContractVersion, expectedSourceVersion });
  }
  if (!candidateForMatcher(candidate, identityResult)) {
    return incompleteEnvelope({ candidate, identityReceipt, identityResult, when, failureCode: 'candidate_affiliation_unavailable', sourceContractVersion, expectedSourceVersion });
  }
  if (!context || typeof context !== 'object' || context.piResolution?.state === 'failed') {
    return incompleteEnvelope({ candidate, identityReceipt, identityResult, when, failureCode: 'coi_context_incomplete', sourceContractVersion, expectedSourceVersion });
  }
  let contextHash;
  try {
    contextHash = hashInstitutionCoiContext({
      requestId,
      institutionEntries: context.institutionEntries,
      authority: 'server_loaded',
    }).hash;
  } catch {
    return incompleteEnvelope({ candidate, identityReceipt, identityResult, when, failureCode: 'coi_context_incomplete', sourceContractVersion, expectedSourceVersion });
  }
  if (typeof decision === 'undefined') {
    return incompleteEnvelope({ candidate, identityReceipt, identityResult, when, failureCode: 'coi_decision_unavailable', contextHash, sourceContractVersion, expectedSourceVersion });
  }
  const institutionCoiEvidence = boundedDecision(decision);
  if (!institutionCoiEvidence) {
    return incompleteEnvelope({ candidate, identityReceipt, identityResult, when, failureCode: 'coi_decision_unknown', contextHash, sourceContractVersion, expectedSourceVersion });
  }
  const sourceVersion = authoritativeSourceVersion(expectedSourceVersion);
  return makeEnvelope({
    outcome: 'current',
    evidencePatch: {
      institutionCoiEvidence,
      hasInstitutionCOI: institutionCoiEvidence.hasInstitutionCOI,
      institutionCOIDetails: institutionCoiEvidence.details,
    },
    sourceVersion,
    resultVersion: version('reviewer-stage-institution-coi:result:v1', institutionCoiEvidence),
    when,
  });
}

/**
 * Execute a fresh server-context read plus the pure institution matcher for a
 * single candidate.  Non-authoritative identity is short-circuited before the
 * loader is called, proving that it cannot create provider traffic.
 */
async function produceInstitutionCoiEvidence({
  requestId,
  candidate = {},
  identityReceipt = {},
  identityEvidence = {},
  identityResult = {},
  signal,
  completedAt: completed,
  loadContext = loadCoiContext,
  decideCoi = (matcherCandidate, institutions) =>
    DeduplicationService.institutionCOIDecision(matcherCandidate, institutions),
  sourceContractVersion = INSTITUTION_COI_SOURCE_CONTRACT_VERSION,
  expectedSourceVersion = null,
} = {}) {
  if (!isIdentityStageCurrent(identityReceipt)
    || !isIdentityAuthoritySatisfied({ candidate, identityEvidence, identityResult })
    || !isGuid(requestId)
    || !candidateForMatcher(candidate, identityResult)) {
    return projectInstitutionCoiEvidence({
      requestId,
      candidate,
      identityReceipt,
      identityEvidence,
      identityResult,
      context: null,
      completedAt: completed,
      sourceContractVersion,
      expectedSourceVersion,
    });
  }
  const preflight = projectInstitutionCoiEvidence({
    requestId,
    candidate,
    identityReceipt,
    identityEvidence,
    identityResult,
    context: null,
    completedAt: completed,
    sourceContractVersion,
    expectedSourceVersion,
  });
  if (typeof loadContext !== 'function' || typeof decideCoi !== 'function') return preflight;
  let context;
  try {
    context = await loadContext(requestId, {
      signal,
      resolvePi: true,
      includeCoPIs: false,
      requireCompleteInstitutions: true,
    });
  } catch (error) {
    return incompleteEnvelope({
      candidate,
      identityReceipt,
      identityResult,
      when: completedAt(completed),
      failureCode: signal?.aborted || error?.name === 'AbortError' ? 'coi_context_aborted' : 'coi_context_incomplete',
      sourceContractVersion,
      expectedSourceVersion,
    });
  }
  let canonical;
  try {
    canonical = canonicalizeInstitutionCoiContext({
      requestId,
      institutionEntries: context?.institutionEntries,
      authority: 'server_loaded',
    });
  } catch {
    return incompleteEnvelope({
      candidate,
      identityReceipt,
      identityResult,
      when: completedAt(completed),
      failureCode: 'coi_context_incomplete',
      sourceContractVersion,
      expectedSourceVersion,
    });
  }
  let decision;
  try {
    decision = decideCoi(
      candidateForMatcher(candidate, identityResult),
      canonicalEntriesForMatcher(canonical),
    );
  } catch (error) {
    return incompleteEnvelope({
      candidate,
      identityReceipt,
      identityResult,
      when: completedAt(completed),
      contextHash: hashInstitutionCoiContext({
        requestId,
        institutionEntries: context.institutionEntries,
        authority: 'server_loaded',
      }).hash,
      failureCode: signal?.aborted || error?.name === 'AbortError' ? 'coi_matcher_aborted' : 'coi_matcher_failed',
      sourceContractVersion,
      expectedSourceVersion,
    });
  }
  return projectInstitutionCoiEvidence({
    requestId,
    candidate,
    identityReceipt,
    identityEvidence,
    identityResult,
    context,
    decision,
    completedAt: completed,
    sourceContractVersion,
    expectedSourceVersion,
  });
}

module.exports = {
  INSTITUTION_COI_STAGE_CONTRACT_VERSION,
  INSTITUTION_COI_SOURCE_CONTRACT_VERSION,
  projectInstitutionCoiEvidence,
  produceInstitutionCoiEvidence,
  _internals: {
    boundedDecision,
    candidateForMatcher,
    canonicalEntriesForMatcher,
    currentAffiliation,
    stableStringify,
    version,
  },
};
