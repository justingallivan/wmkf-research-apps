/**
 * Pure, server-authoritative Reviewer Find stage source versions.
 *
 * This is intentionally dependency-free: a warm roster read supplies only
 * server-owned request/roster/Graph metadata and sealed receipt result
 * versions.  It must never resolve identity, fetch proposal bytes, call an
 * evidence provider, or write durable state.
 */

const { createHash } = require('crypto');
const { isCandidateIdentityAuthoritySatisfied } = require('../../utils/reviewer-identity-authority');
const { institutionDomainInputFingerprint } = require('./institution-domain-input-fingerprint');

const STAGES = Object.freeze([
  'applicant_anchor', 'identity', 'institution_domains', 'institution_coi', 'coauthor_coi',
  'eligibility', 'contact', 'address_trust', 'roster_persistence',
]);
const TERMINAL_UPSTREAM_STAGES = Object.freeze(STAGES.filter((stage) => stage !== 'roster_persistence'));
const CONTRACT_VERSIONS = Object.freeze({
  applicant_anchor: 1, identity: 4, institution_domains: 1, institution_coi: 1,
  coauthor_coi: 1, eligibility: 1, contact: 1, address_trust: 1, roster_persistence: 1,
});

const SOURCE_CONTRACT_VERSIONS = Object.freeze({
  identity: 'reviewer-identity-runtime:v1',
  institution_domains: 'institution-domain-evidence:v1',
  institution_coi: 'institution-coi:v1',
  coauthor_coi: 'reviewer-coauthor-coi:v1',
  eligibility: 'reviewer-eligibility-evidence:v1',
  contact: 'reviewer-contact-source-policy:v1',
  address_trust: 'reviewer-address-trust:v1',
  roster_persistence: 'reviewer-roster-persistence:v1',
});
// This is deliberately *not* a normal stage input version.  It is used only
// to clear an already-expired same-stage lease when an upstream invalidation
// means the normal stage source cannot yet be derived.  Its incomplete
// receipt can never make the stage current: normal planning compares against
// `stageInputVersions`, which never returns this namespace.
const EXPIRED_LEASE_RECOVERY_SOURCE_NAMESPACE = 'reviewer-stage-expired-lease-recovery:v1';

const NOT_APPLICABLE_STATES = new Set(['not_applicable']);
const SEALED_RECEIPT_STATES = new Set(['current', ...NOT_APPLICABLE_STATES]);
const NOT_APPLICABLE_REASONS = new Set([
  'server_not_applicable',
  'identity_not_authoritative',
  'no_proposal_authors',
  'no_trusted_domains',
  'missing_email',
]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function opaqueVersion(namespace, value) {
  return createHash('sha256')
    .update(`${namespace}\n${stableStringify(value)}`)
    .digest('hex');
}

function boundedText(value, maxLength = 320) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function boundedVersion(value) {
  return boundedText(value, 160);
}

function normalizedText(value, maxLength = 320) {
  const text = boundedText(value, maxLength);
  return text ? text.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('en-US') : null;
}

function canonicalIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function canonicalCandidateKey(value) {
  const key = boundedText(value, 560);
  return key && /^(suggestion|person|orcid|openalex|scholar|seed):[^\s:]{1,512}$/.test(key) ? key : null;
}

function canonicalRequestId(value) {
  const id = boundedText(value, 80);
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id.toLowerCase()
    : null;
}

/**
 * Server-derived marker for the narrow expired-lease escape hatch.  It
 * intentionally contains no browser input, provider result, proposal bytes,
 * or timing/attempt data.  Callers must still enforce active row, CAS token,
 * exact stage/attempt, and expiry before writing an incomplete receipt.
 */
function expiredLeaseRecoverySourceVersion({ requestId, candidateKey: rawCandidateKey, stage } = {}) {
  const id = canonicalRequestId(requestId);
  const key = canonicalCandidateKey(rawCandidateKey);
  return id && key && STAGES.includes(stage)
    ? opaqueVersion(EXPIRED_LEASE_RECOVERY_SOURCE_NAMESPACE, { requestId: id, candidateKey: key, stage })
    : null;
}

function candidateKey(candidate) {
  return canonicalCandidateKey(candidate?.candidateKey);
}

function stageReceipt(candidate, stage) {
  const receipt = candidate?.stageFreshness?.[stage];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  return receipt;
}

function sealedStageReceipt(candidate, stage) {
  const receipt = stageReceipt(candidate, stage);
  if (!receipt || !SEALED_RECEIPT_STATES.has(receipt.state)) return null;
  if (!boundedVersion(receipt.sourceVersion) || !boundedVersion(receipt.resultVersion)) return null;
  if (!canonicalIso(receipt.completedAt)) return null;
  return receipt;
}

function terminalUpstreamReceipts(stageFreshness) {
  if (!stageFreshness || typeof stageFreshness !== 'object' || Array.isArray(stageFreshness)) return null;
  const upstream = {};
  for (const stage of TERMINAL_UPSTREAM_STAGES) {
    const receipt = stageFreshness[stage];
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
    if (!SEALED_RECEIPT_STATES.has(receipt.state)) return null;
    if (receipt.contractVersion !== CONTRACT_VERSIONS[stage]) return null;
    if (!boundedVersion(receipt.sourceVersion) || !boundedVersion(receipt.resultVersion)) return null;
    if (!canonicalIso(receipt.completedAt)) return null;
    if (receipt.state === 'current'
      && (receipt.reasonCode !== null || receipt.failureCode !== null)) return null;
    if (receipt.state === 'not_applicable'
      && (!NOT_APPLICABLE_REASONS.has(receipt.reasonCode) || receipt.failureCode !== null)) return null;
    upstream[stage] = receipt;
  }
  return upstream;
}

function rosterPersistenceSourceVersion({ candidateKey: rawCandidateKey, stageFreshness } = {}) {
  const key = canonicalCandidateKey(rawCandidateKey);
  const upstream = terminalUpstreamReceipts(stageFreshness);
  return key && upstream
    ? opaqueVersion('reviewer-roster-persistence:v1', { candidateKey: key, upstream })
    : null;
}

function rosterPersistenceResultVersion({ stageFreshness } = {}) {
  const upstream = terminalUpstreamReceipts(stageFreshness);
  return upstream ? opaqueVersion('reviewer-roster-persistence-result:v1', upstream) : null;
}

function buildRosterPersistenceReceipt({ candidateKey: rawCandidateKey, stageFreshness, completedAt } = {}) {
  const sourceVersion = rosterPersistenceSourceVersion({ candidateKey: rawCandidateKey, stageFreshness });
  const resultVersion = rosterPersistenceResultVersion({ stageFreshness });
  if (!sourceVersion || !resultVersion || !canonicalIso(completedAt)) return null;
  return {
    state: 'current',
    contractVersion: CONTRACT_VERSIONS.roster_persistence,
    sourceVersion,
    resultVersion,
    completedAt,
    reasonCode: null,
    failureCode: null,
  };
}

function applicantAnchorLane(candidate) {
  if (candidate?.isApplicantRecommended === true || candidate?.provenance?.kind === 'applicant_suggested') {
    return 'applicant';
  }
  if (boundedText(candidate?.provenance?.kind, 80)) return 'non_applicant';
  return candidateKey(candidate)?.startsWith('suggestion:') ? 'ambiguous' : 'non_applicant';
}

function applicantAnchorSourceVersion({ candidate, applicantInputVersion } = {}) {
  const key = candidateKey(candidate);
  const lane = applicantAnchorLane(candidate);
  if (!key || lane === 'ambiguous') return null;
  if (lane === 'applicant') {
    const inputVersion = boundedVersion(applicantInputVersion);
    return inputVersion && /^[a-f0-9]{64}$/i.test(inputVersion)
      ? inputVersion.toLowerCase()
      : null;
  }
  return opaqueVersion('reviewer-warm-applicant-anchor-not-applicable:v1', { candidateKey: key });
}

function staffIdentityConfirmation(candidate) {
  const confirmation = candidate?.staffIdentityConfirmation
    || candidate?.identityEvidence?.staffConfirmation
    || candidate?.identityEvidence?.staffIdentityConfirmation;
  if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) return null;
  const canonicalPersonId = boundedText(confirmation.canonicalPersonId, 80);
  const canonicalPersonEtag = boundedText(confirmation.canonicalPersonEtag, 240);
  const actorId = boundedText(confirmation.actorId, 120);
  if (
    confirmation.state !== 'confirmed'
    || !canonicalPersonId
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(canonicalPersonId)
    || !canonicalPersonEtag
    || !actorId
    || !canonicalIso(confirmation.confirmedAt)
  ) return null;
  return {
    canonicalPersonId: canonicalPersonId.toLowerCase(),
    canonicalPersonEtag,
    actorId,
    confirmedAt: confirmation.confirmedAt,
  };
}

function identityAuthoritySatisfied(candidate) {
  return isCandidateIdentityAuthoritySatisfied(candidate);
}

function candidateIdentityInputs(candidate) {
  return {
    candidateKey: candidateKey(candidate),
    name: normalizedText(candidate?.name || candidate?.displayName, 200),
    suggestedInstitution: normalizedText(
      candidate?.suggestedInstitution
        || candidate?.affiliation
        || candidate?.institution
        || candidate?.primaryAffiliation,
      320,
    ),
    field: normalizedText(candidate?.field, 240),
    expertiseAreas: (Array.isArray(candidate?.expertiseAreas) ? candidate.expertiseAreas : [])
      .map((value) => normalizedText(value, 160))
      .filter(Boolean)
      .slice(0, 8),
  };
}

function currentAffiliation(candidate) {
  return normalizedText(
    candidate?.identityEvidence?.selectedRecord?.lastKnownInstitution
      || candidate?.primaryAffiliation
      || candidate?.affiliation
      || candidate?.institution,
    320,
  );
}

function currentOrcidRorFingerprint(candidate, { allowUnsealedPreview = false } = {}) {
  const fingerprint = boundedVersion(candidate?.institutionDomainEvidence?.inputFingerprint);
  if (fingerprint && /^[a-f0-9]{64}$/i.test(fingerprint)) return fingerprint;
  if (!allowUnsealedPreview) {
    return null;
  }
  const preview = institutionDomainInputFingerprint(candidate);
  return typeof preview === 'string' && /^[a-f0-9]{64}$/i.test(preview) ? preview : null;
}

function normalizedDomains(value) {
  const seen = new Set();
  const domains = [];
  for (const raw of (Array.isArray(value) ? value : [])) {
    const text = normalizedText(raw, 253);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    domains.push(text);
    if (domains.length >= 4) break;
  }
  return domains;
}

function trustedDomainsFingerprint(candidate) {
  return opaqueVersion('reviewer-stage-trusted-domains:v1', normalizedDomains(
    candidate?.trustedInstitutionDomains || candidate?.institutionDomainEvidence?.anchoredDomains,
  ));
}

function proposalAuthorVersion(candidate) {
  const version = boundedVersion(candidate?.proposalAuthorVersion || candidate?.proposalEvidence?.proposalAuthorVersion);
  // This is a sealed content fingerprint, not a display label or raw proposal
  // material. Legacy prose-like values remain readable but cannot make the
  // coauthor stage warm-current.
  return version && /^[a-f0-9]{64}$/i.test(version) ? version : null;
}

function canonicalPersonVersion(candidate) {
  // Only the contact-stage projector may persist this coupled person/ETag
  // pair. Raw cold/browser candidate IDs are deliberately ignored.
  const personId = boundedText(candidate?.canonicalPersonId, 80);
  const etag = boundedText(candidate?.personEtag || candidate?.canonicalPersonEtag, 240);
  if (personId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(personId)
    && etag) {
    return opaqueVersion('reviewer-stage-canonical-person:v1', { personId, etag });
  }
  // A server-issued identity confirmation remains a fallback only until the
  // contact/address action has persisted its newer exact person ETag.
  const confirmation = staffIdentityConfirmation(candidate);
  return confirmation
    ? opaqueVersion('reviewer-stage-canonical-person:v1', {
      personId: confirmation.canonicalPersonId,
      etag: confirmation.canonicalPersonEtag,
    })
    : null;
}

function buildRequestCoiContextVersion({ requestId, applicantOrganization = {}, principalInvestigator = {} } = {}) {
  const id = boundedText(requestId, 80);
  const applicant = {
    id: normalizedText(applicantOrganization?.id, 80),
    label: normalizedText(applicantOrganization?.label, 320),
    organizationName: normalizedText(applicantOrganization?.organizationName, 320),
  };
  const pi = {
    id: normalizedText(principalInvestigator?.id, 80),
    label: normalizedText(principalInvestigator?.label, 320),
  };
  if (!id || !(applicant.id || applicant.label || applicant.organizationName) || !(pi.id || pi.label)) return null;
  return opaqueVersion('reviewer-stage-request-coi-context:v1', { requestId: id, applicant, principalInvestigator: pi });
}

function sourceVersion(namespace, inputs) {
  return opaqueVersion(namespace, inputs);
}

function stageInputVersions({
  candidate = {},
  requestId = null,
  applicantInputVersion = null,
  proposalContentVersion = null,
  requestCoiContextVersion = null,
  allowUnsealedDomainPreview = false,
} = {}) {
  const key = candidateKey(candidate);
  if (!key) return Object.fromEntries(STAGES.map((stage) => [stage, null]));

  const applicantAnchor = applicantAnchorSourceVersion({ candidate, applicantInputVersion });
  const anchorReceipt = sealedStageReceipt(candidate, 'applicant_anchor');
  const applicantAnchorResultVersion = anchorReceipt?.sourceVersion === applicantAnchor
    ? boundedVersion(anchorReceipt.resultVersion)
    : null;
  const inputs = candidateIdentityInputs(candidate);
  const proposalVersion = boundedVersion(proposalContentVersion);
  const identity = applicantAnchorResultVersion && proposalVersion && inputs.name && inputs.suggestedInstitution
    ? sourceVersion('reviewer-stage-identity:source:v2', {
      ...inputs,
      applicantAnchorResultVersion,
      proposalContentVersion: proposalVersion,
      resolverContractVersion: SOURCE_CONTRACT_VERSIONS.identity,
    })
    : null;
  const identityReceipt = sealedStageReceipt(candidate, 'identity');
  const identityResultVersion = identityReceipt?.sourceVersion === identity
    ? boundedVersion(identityReceipt.resultVersion)
    : null;
  const identityAuthoritative = identityAuthoritySatisfied(candidate);
  const affiliation = currentAffiliation(candidate);
  const institutionDomainInputFingerprint = currentOrcidRorFingerprint(candidate, { allowUnsealedPreview: allowUnsealedDomainPreview });
  const institutionDomains = identityResultVersion && (!identityAuthoritative || institutionDomainInputFingerprint)
    ? sourceVersion('reviewer-stage-institution-domains:source:v2', {
      candidateKey: key,
      identityResultVersion,
      institutionDomainInputFingerprint: identityAuthoritative ? institutionDomainInputFingerprint : null,
      sourceContractVersion: SOURCE_CONTRACT_VERSIONS.institution_domains,
    })
    : null;
  const domainsReceipt = sealedStageReceipt(candidate, 'institution_domains');
  const institutionDomainsResultVersion = domainsReceipt?.sourceVersion === institutionDomains
    ? boundedVersion(domainsReceipt.resultVersion)
    : null;
  const requestContextVersion = boundedVersion(requestCoiContextVersion);
  const institutionCoi = identityResultVersion && (!identityAuthoritative || (affiliation && requestContextVersion))
    ? sourceVersion('reviewer-stage-institution-coi:source:v2', {
      candidateKey: key,
      identityResultVersion,
      identityAuthoritative,
      affiliation: identityAuthoritative ? affiliation : null,
      requestCoiContextVersion: identityAuthoritative ? requestContextVersion : null,
      sourceContractVersion: SOURCE_CONTRACT_VERSIONS.institution_coi,
    })
    : null;
  const coauthor = identityResultVersion && (!identityAuthoritative || (proposalVersion && proposalAuthorVersion(candidate)))
    ? sourceVersion('reviewer-stage-coauthor-coi:source:v2', {
      candidateKey: key,
      identityResultVersion,
      identityAuthoritative,
      proposalContentVersion: identityAuthoritative ? proposalVersion : null,
      proposalAuthorVersion: identityAuthoritative ? proposalAuthorVersion(candidate) : null,
      sourceContractVersion: SOURCE_CONTRACT_VERSIONS.coauthor_coi,
    })
    : null;
  const eligibility = identityResultVersion && (!identityAuthoritative || institutionDomainsResultVersion)
    ? sourceVersion('reviewer-stage-eligibility:source:v2', {
      candidateKey: key,
      identityResultVersion,
      identityAuthoritative,
      institutionDomainsResultVersion: identityAuthoritative ? institutionDomainsResultVersion : null,
      trustedDomainsFingerprint: identityAuthoritative ? trustedDomainsFingerprint(candidate) : null,
      sourceContractVersion: SOURCE_CONTRACT_VERSIONS.eligibility,
    })
    : null;
  const personVersion = canonicalPersonVersion(candidate);
  const contact = identityResultVersion && (!identityAuthoritative || institutionDomainsResultVersion)
    ? sourceVersion('reviewer-stage-contact:source:v2', {
      candidateKey: key,
      identityResultVersion,
      identityAuthoritative,
      institutionDomainsResultVersion: identityAuthoritative ? institutionDomainsResultVersion : null,
      trustedDomainsFingerprint: identityAuthoritative ? trustedDomainsFingerprint(candidate) : null,
      contactInputs: identityAuthoritative ? {
        name: inputs.name,
        affiliation,
        canonicalPersonVersion: personVersion,
      } : null,
      sourceContractVersion: SOURCE_CONTRACT_VERSIONS.contact,
    })
    : null;
  const contactReceipt = sealedStageReceipt(candidate, 'contact');
  const contactResultVersion = contactReceipt?.sourceVersion === contact
    ? boundedVersion(contactReceipt.resultVersion)
    : null;
  const addressTrust = identityResultVersion && (!identityAuthoritative || contactResultVersion)
    ? sourceVersion('reviewer-stage-address-trust:source:v2', {
      candidateKey: key,
      identityResultVersion,
      identityAuthoritative,
      contactResultVersion: identityAuthoritative ? contactResultVersion : null,
      address: identityAuthoritative ? {
        email: normalizedText(candidate?.email || candidate?.contactEnrichment?.email, 254),
        source: normalizedText(candidate?.emailSource || candidate?.contactEnrichment?.emailSource, 80),
        canonicalPersonVersion: personVersion,
      } : null,
      sourceContractVersion: SOURCE_CONTRACT_VERSIONS.address_trust,
    })
    : null;
  const versions = {
    applicant_anchor: applicantAnchor,
    identity,
    institution_domains: institutionDomains,
    institution_coi: institutionCoi,
    coauthor_coi: coauthor,
    eligibility,
    contact,
    address_trust: addressTrust,
    roster_persistence: null,
  };
  if (TERMINAL_UPSTREAM_STAGES.every((stage) => boundedVersion(versions[stage]))) {
    versions.roster_persistence = rosterPersistenceSourceVersion({
      candidateKey: key,
      stageFreshness: candidate.stageFreshness,
    });
  }
  return versions;
}

function legacyEvidenceDependencies({ candidate = {}, requestId = null, applicantInputVersion = null, proposalContentVersion = null, requestCoiContextVersion = null, versions = {} } = {}) {
  const key = candidateKey(candidate);
  if (!key) return {};
  const identityReceipt = sealedStageReceipt(candidate, 'identity');
  const domainsReceipt = sealedStageReceipt(candidate, 'institution_domains');
  const contactReceipt = sealedStageReceipt(candidate, 'contact');
  const dependencies = {
    applicant_anchor: {
      candidateKey: key,
      requestId: boundedVersion(requestId),
      applicantInputVersion: boundedVersion(applicantInputVersion),
    },
    identity: {
      candidateKey: key,
      applicantAnchorResultVersion: boundedVersion(sealedStageReceipt(candidate, 'applicant_anchor')?.resultVersion),
      proposalContentVersion: boundedVersion(proposalContentVersion),
    },
    institution_domains: {
      candidateKey: key,
      identityResultVersion: boundedVersion(identityReceipt?.resultVersion),
    },
    institution_coi: {
      candidateKey: key,
      requestId: boundedVersion(requestId),
      identityResultVersion: boundedVersion(identityReceipt?.resultVersion),
      requestCoiContextVersion: boundedVersion(requestCoiContextVersion),
    },
    coauthor_coi: {
      candidateKey: key,
      requestId: boundedVersion(requestId),
      identityResultVersion: boundedVersion(identityReceipt?.resultVersion),
      proposalContentVersion: boundedVersion(proposalContentVersion),
      proposalAuthorVersion: proposalAuthorVersion(candidate),
    },
    eligibility: {
      candidateKey: key,
      identityResultVersion: boundedVersion(identityReceipt?.resultVersion),
      institutionDomainsResultVersion: boundedVersion(domainsReceipt?.resultVersion),
      trustedDomainsVersion: trustedDomainsFingerprint(candidate),
    },
    contact: {
      candidateKey: key,
      identityResultVersion: boundedVersion(identityReceipt?.resultVersion),
      institutionDomainsResultVersion: boundedVersion(domainsReceipt?.resultVersion),
      canonicalPersonVersion: canonicalPersonVersion(candidate),
    },
    address_trust: {
      candidateKey: key,
      identityResultVersion: boundedVersion(identityReceipt?.resultVersion),
      contactResultVersion: boundedVersion(contactReceipt?.resultVersion),
      canonicalPersonVersion: canonicalPersonVersion(candidate),
    },
    roster_persistence: {
      candidateKey: key,
      rosterProjectionVersion: boundedVersion(versions.roster_persistence),
    },
  };
  return Object.fromEntries(Object.entries(dependencies).map(([stage, value]) => [
    stage,
    Object.fromEntries(Object.entries(value).filter(([, entry]) => boundedVersion(entry))),
  ]));
}

function buildReviewerStageDependencySnapshot({
  candidate = {},
  requestId = null,
  rosterUpdatedAt = null,
  applicantInputVersion = null,
  proposalContentVersion = null,
  requestCoiContextVersion = null,
  allowUnsealedDomainPreview = false,
} = {}) {
  const versions = stageInputVersions({
    candidate,
    requestId,
    applicantInputVersion,
    proposalContentVersion,
    requestCoiContextVersion,
    allowUnsealedDomainPreview,
  });
  return {
    requestId: boundedVersion(requestId),
    candidateKey: candidateKey(candidate),
    rosterUpdatedAt: boundedText(rosterUpdatedAt, 128),
    applicantInputVersion: boundedVersion(applicantInputVersion),
    proposalContentVersion: boundedVersion(proposalContentVersion),
    requestCoiContextVersion: boundedVersion(requestCoiContextVersion),
    canonicalPersonVersion: canonicalPersonVersion(candidate),
    stageInputVersions: versions,
    versions,
    legacyEvidenceDependencies: legacyEvidenceDependencies({
      candidate,
      requestId,
      applicantInputVersion,
      proposalContentVersion,
      requestCoiContextVersion,
      versions,
    }),
    identityAuthoritySatisfied: identityAuthoritySatisfied(candidate),
  };
}

module.exports = {
  STAGES,
  TERMINAL_UPSTREAM_STAGES,
  CONTRACT_VERSIONS,
  SOURCE_CONTRACT_VERSIONS,
  EXPIRED_LEASE_RECOVERY_SOURCE_NAMESPACE,
  stableStringify,
  opaqueVersion,
  boundedVersion,
  canonicalRequestId,
  canonicalCandidateKey,
  expiredLeaseRecoverySourceVersion,
  canonicalIso,
  terminalUpstreamReceipts,
  rosterPersistenceSourceVersion,
  rosterPersistenceResultVersion,
  buildRosterPersistenceReceipt,
  applicantAnchorLane,
  applicantAnchorSourceVersion,
  identityAuthoritySatisfied,
  buildRequestCoiContextVersion,
  stageInputVersions,
  buildReviewerStageDependencySnapshot,
};
