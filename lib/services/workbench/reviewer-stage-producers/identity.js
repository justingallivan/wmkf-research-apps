/**
 * Reviewer Find authoritative identity stage producer.
 *
 * This module deliberately owns only one candidate's identity evidence.  It
 * does not read a roster, write Postgres/Dataverse, discover contact details,
 * or invoke eligibility/COI work.  The stage-refresh coordinator supplies the
 * server-owned candidate projection and performs the lease/CAS write.
 */

const { createHash } = require('node:crypto');
const { ReviewerIdentityRuntime } = require('../../reviewer-identity-runtime');
const { isIdentityAuthoritySatisfied } = require('../../../utils/reviewer-identity-authority');
const { isGuid } = require('../../../utils/guid');

const IDENTITY_STAGE_CONTRACT_VERSION = 4;
const IDENTITY_RESOLVER_CONTRACT_VERSION = 'reviewer-identity-runtime:v1';
const IDENTITY_DECISIONS = new Set([
  'confirmed', 'probable', 'ambiguous', 'unresolved', 'abstain',
]);
const TRANSIENT_SOURCE_STATES = new Set(['error', 'timeout', 'partial']);
const MAX_ANCHORS = 6;

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
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function canonicalCompletedAt(value) {
  return canonicalIso(value) ? value : new Date().toISOString();
}

// The coordinator derives this from the exact current request/candidate/
// proposal snapshot.  Producers never derive a successful source locally:
// without this server-owned value they can only emit non-current evidence.
function authoritativeSourceVersion(expectedSourceVersion) {
  return typeof expectedSourceVersion === 'string' && /^[a-f0-9]{64}$/i.test(expectedSourceVersion)
    ? expectedSourceVersion.toLowerCase()
    : null;
}

function unavailableSourceVersion() { return 'stage_source_authority_unavailable'; }

function candidateIdentityInputs(candidate = {}) {
  const name = boundedText(candidate.name || candidate.displayName, 200);
  const suggestedInstitution = boundedText(
    candidate.suggestedInstitution
      || candidate.affiliation
      || candidate.institution
      || candidate.primaryAffiliation,
    320,
  );
  return {
    candidateKey: boundedText(candidate.candidateKey, 560),
    name,
    suggestedInstitution,
    field: boundedText(candidate.field, 240),
    expertiseAreas: (Array.isArray(candidate.expertiseAreas) ? candidate.expertiseAreas : [])
      .map((value) => boundedText(value, 160))
      .filter(Boolean)
      .slice(0, 8),
  };
}

function canonicalOrcid(value) {
  const id = String(value || '').replace(/^https?:\/\/orcid\.org\//i, '').trim();
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(id) ? id.toUpperCase() : null;
}

function shortOpenAlexAuthorId(value) {
  const id = String(value || '').trim().replace(/^https?:\/\/openalex\.org\//i, '');
  return /^A\d{3,20}$/i.test(id) ? id.toUpperCase() : null;
}

function sanitizeAnchor(anchor = {}) {
  const type = boundedText(anchor?.type, 80);
  const strength = boundedText(anchor?.strength, 40);
  if (!type || !strength) return null;
  const values = {};
  const orcid = canonicalOrcid(anchor?.value || anchor?.orcid);
  const openAlexAuthorId = shortOpenAlexAuthorId(anchor?.openAlexAuthorId || anchor?.authorId);
  if (orcid) values.orcid = orcid;
  if (openAlexAuthorId) values.openAlexAuthorId = openAlexAuthorId;
  return { type, strength, ...(Object.keys(values).length ? values : {}) };
}

function sourceOutcomeIncomplete(identityResult = {}) {
  return Object.values(identityResult?.sources || {}).some((value) =>
    TRANSIENT_SOURCE_STATES.has(String(value || '').toLowerCase()));
}

function normalizeIdentityDecision(identityResult = {}) {
  const raw = String(identityResult.status || identityResult.resolverStatus || identityResult.identity?.status || '')
    .trim()
    .toLowerCase();
  if (IDENTITY_DECISIONS.has(raw)) return raw;
  return null;
}

function isIdentityStageCurrent(receipt) {
  return receipt?.state === 'current'
    && Number(receipt.contractVersion) === IDENTITY_STAGE_CONTRACT_VERSION
    && typeof receipt.resultVersion === 'string'
    && receipt.resultVersion.length > 0;
}

function boundedIdentityEvidence(identityResult = {}) {
  const decision = normalizeIdentityDecision(identityResult);
  if (!decision) return null;
  const anchors = (Array.isArray(identityResult.anchors) ? identityResult.anchors : [])
    .map(sanitizeAnchor)
    .filter(Boolean)
    .slice(0, MAX_ANCHORS);
  const orcid = canonicalOrcid(identityResult.orcid);
  const openAlexAuthorId = shortOpenAlexAuthorId(identityResult.selectedRecord?.openAlexId);
  const result = {
    decision,
    status: decision,
    anchors,
  };
  if (orcid) result.orcid = orcid;
  if (openAlexAuthorId) result.openAlexAuthorId = openAlexAuthorId;
  return result;
}

function receipt({ state, sourceVersion, resultVersion, completedAt, reasonCode = null, failureCode = null }) {
  return {
    state,
    contractVersion: IDENTITY_STAGE_CONTRACT_VERSION,
    sourceVersion,
    resultVersion,
    completedAt: state === 'incomplete' || state === 'failed' ? null : completedAt,
    reasonCode,
    failureCode,
  };
}

function incompleteIdentityEnvelope({ sourceVersion, completedAt, failureCode }) {
  const persistenceFailureCode = failureCode === 'identity_provider_incomplete'
    ? 'provider_unavailable'
    : failureCode === 'identity_result_unknown'
      ? 'partial_coverage'
      : 'missing_required_input';
  const evidencePatch = {};
  return {
    outcome: 'incomplete',
    evidencePatch,
    receipt: receipt({
      state: 'incomplete',
      sourceVersion,
      resultVersion: version('reviewer-stage-identity:incomplete:v1', { failureCode }),
      completedAt,
      failureCode: persistenceFailureCode,
    }),
  };
}

function identityEvidencePatch(identityEvidence, when, resolverContractVersion, proposalContentVersion) {
  const patch = {
    identityEvidence,
    identityDecision: identityEvidence.decision,
    identityResolverVersion: boundedText(resolverContractVersion, 160),
    identityResolvedAt: when,
  };
  if (identityEvidence.orcid) patch.orcid = identityEvidence.orcid;
  if (identityEvidence.openAlexAuthorId) patch.openAlexAuthorId = identityEvidence.openAlexAuthorId;
  if (typeof proposalContentVersion === 'string' && /^[a-f0-9]{64}$/i.test(proposalContentVersion)) {
    patch.proposalContentVersion = proposalContentVersion.toLowerCase();
  }
  return patch;
}

/**
 * Turn a server-computed runtime identity result into the closed stage
 * envelope.  It is pure and is used both by cold emission and manual refresh.
 */
function projectIdentityEvidence({
  candidate = {},
  applicantInputVersion = null,
  proposalContentVersion = null,
  identityResult = null,
  completedAt,
  resolverContractVersion = IDENTITY_RESOLVER_CONTRACT_VERSION,
  expectedSourceVersion = null,
} = {}) {
  const inputs = candidateIdentityInputs(candidate);
  const sourceVersion = authoritativeSourceVersion(expectedSourceVersion);
  const when = canonicalCompletedAt(completedAt);
  if (!sourceVersion) {
    return incompleteIdentityEnvelope({
      sourceVersion: unavailableSourceVersion(), completedAt: when, failureCode: 'identity_source_unavailable',
    });
  }
  if (!inputs.candidateKey || !inputs.name || !inputs.suggestedInstitution) {
    return incompleteIdentityEnvelope({ sourceVersion, completedAt: when, failureCode: 'identity_inputs_unavailable' });
  }
  if (!boundedText(proposalContentVersion, 160)) {
    return incompleteIdentityEnvelope({ sourceVersion, completedAt: when, failureCode: 'proposal_content_unavailable' });
  }
  if (!identityResult || typeof identityResult !== 'object') {
    return incompleteIdentityEnvelope({ sourceVersion, completedAt: when, failureCode: 'identity_result_unavailable' });
  }
  if (sourceOutcomeIncomplete(identityResult)) {
    return incompleteIdentityEnvelope({ sourceVersion, completedAt: when, failureCode: 'identity_provider_incomplete' });
  }
  const identityEvidence = boundedIdentityEvidence(identityResult);
  if (!identityEvidence) {
    return incompleteIdentityEnvelope({ sourceVersion, completedAt: when, failureCode: 'identity_result_unknown' });
  }
  const resultVersion = version('reviewer-stage-identity:result:v1', identityEvidence);
  return {
    outcome: 'current',
    evidencePatch: identityEvidencePatch(identityEvidence, when, resolverContractVersion, proposalContentVersion),
    receipt: receipt({
      state: 'current',
      sourceVersion,
      resultVersion,
      completedAt: when,
    }),
  };
}

/**
 * Execute the existing one-candidate identity seam only after the coordinator
 * has acquired a lease.  A supplied resolver is test injection; no caller can
 * choose a runtime mode or a batch evaluator through this API.
 */
async function produceIdentityEvidence({
  candidate = {},
  applicantInputVersion = null,
  proposalContentVersion = null,
  proposalInfo = {},
  signal,
  completedAt,
  resolver = ReviewerIdentityRuntime,
  resolverContractVersion = IDENTITY_RESOLVER_CONTRACT_VERSION,
  expectedSourceVersion = null,
} = {}) {
  const inputs = candidateIdentityInputs(candidate);
  // Preflight directly rather than interpreting a projected generic failure
  // code: the closed persistence envelope intentionally has no detailed
  // failure code, while this executor still needs to prove it skipped the
  // runtime provider for missing authoritative inputs.
  if (!inputs.candidateKey || !inputs.name || !inputs.suggestedInstitution
    || !boundedText(proposalContentVersion, 160)) {
    return projectIdentityEvidence({
      candidate,
      applicantInputVersion,
      proposalContentVersion,
      identityResult: null,
      completedAt,
      resolverContractVersion,
      expectedSourceVersion,
    });
  }
  if (!resolver || typeof resolver.evaluateSuggestion !== 'function') {
    return projectIdentityEvidence({
      candidate,
      applicantInputVersion,
      proposalContentVersion,
      identityResult: null,
      completedAt,
      resolverContractVersion,
      expectedSourceVersion,
    });
  }
  try {
    const identityResult = await resolver.evaluateSuggestion({
      name: inputs.name,
      suggestedInstitution: inputs.suggestedInstitution,
      field: inputs.field,
      expertiseAreas: inputs.expertiseAreas,
    }, { proposalInfo, signal });
    return projectIdentityEvidence({
      candidate,
      applicantInputVersion,
      proposalContentVersion,
      identityResult,
      completedAt,
      resolverContractVersion,
      expectedSourceVersion,
    });
  } catch (error) {
    return projectIdentityEvidence({
      candidate,
      applicantInputVersion,
      proposalContentVersion,
      identityResult: {
        status: 'abstain',
        sources: { runtime: signal?.aborted || error?.name === 'AbortError' ? 'timeout' : 'error' },
      },
      completedAt,
      resolverContractVersion,
      expectedSourceVersion,
    });
  }
}

/**
 * Shared projector for the existing structured staff-confirmation action.
 * The action supplies a server-read canonical person/ETag and actor; this
 * projector intentionally rejects a browser-only confirmation object.
 */
function projectStaffConfirmedIdentityEvidence({
  candidate = {},
  applicantInputVersion = null,
  proposalContentVersion = null,
  confirmation = {},
  completedAt,
  resolverContractVersion = IDENTITY_RESOLVER_CONTRACT_VERSION,
  expectedSourceVersion = null,
} = {}) {
  const personId = boundedText(confirmation.canonicalPersonId, 80);
  const personEtag = boundedText(confirmation.canonicalPersonEtag, 240);
  const actorId = boundedText(confirmation.actorId, 120);
  const confirmedAt = canonicalIso(confirmation.confirmedAt) ? confirmation.confirmedAt : null;
  if (!personId || !isGuid(personId)
    || !personEtag || !actorId || !confirmedAt || confirmation.authority !== 'server_loaded') {
    return projectIdentityEvidence({
      candidate,
      applicantInputVersion,
      proposalContentVersion,
      identityResult: null,
      completedAt,
      resolverContractVersion,
      expectedSourceVersion,
    });
  }
  const base = projectIdentityEvidence({
    candidate,
    applicantInputVersion,
    proposalContentVersion,
    identityResult: { status: 'confirmed', anchors: [] },
    completedAt,
    resolverContractVersion,
    expectedSourceVersion,
  });
  if (base.outcome !== 'current') return base;
  const identityEvidence = {
    ...base.evidencePatch.identityEvidence,
    staffConfirmation: {
      state: 'confirmed',
      canonicalPersonId: personId.toLowerCase(),
      canonicalPersonEtag: personEtag,
      actorId,
      confirmedAt,
    },
  };
  return {
    outcome: 'current',
    evidencePatch: {
      ...identityEvidencePatch(identityEvidence, base.receipt.completedAt, resolverContractVersion, proposalContentVersion),
      staffIdentityConfirmation: identityEvidence.staffConfirmation,
    },
    receipt: {
      ...base.receipt,
      sourceVersion: authoritativeSourceVersion(expectedSourceVersion),
      resultVersion: version('reviewer-stage-identity:staff-confirmation:v1', identityEvidence),
    },
  };
}

module.exports = {
  IDENTITY_STAGE_CONTRACT_VERSION,
  IDENTITY_RESOLVER_CONTRACT_VERSION,
  isIdentityStageCurrent,
  isIdentityAuthoritySatisfied,
  projectIdentityEvidence,
  produceIdentityEvidence,
  projectStaffConfirmedIdentityEvidence,
  _internals: {
    boundedIdentityEvidence,
    candidateIdentityInputs,
    canonicalCompletedAt,
    canonicalOrcid,
    normalizeIdentityDecision,
    shortOpenAlexAuthorId,
    sourceOutcomeIncomplete,
    stableStringify,
    version,
  },
};
