/**
 * Server orchestration for reviewer exact-address trust actions.
 *
 * Pre-promotion verification writes a server-owned Postgres roster receipt.
 * When an exact stable person has a pending conflict, the same action also
 * resolves person-scoped Dataverse state before clearing the roster block;
 * an already-promoted exact suggestion writes that person directly under ETag.
 * Repair requests are durable system_alerts rows and never unblock alone.
 */

import { createHash, randomUUID } from 'crypto';
import NotificationService from './notification-service';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request';
import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer';
import { translateDuplicateKeyError } from '../dataverse/duplicate-key';
import {
  clearAddressTrustBlocks,
  completeStructuredAddressVerification,
  confirmIdentity as persistIdentityConfirmation,
  findCandidateByKey,
  findCandidatesByKeys,
  recordSurfaced,
} from './reviewer-roster-store';
import { resolveTrustedReviewerPerson } from './reviewer-contact-reconciliation';
import { isCandidateIdentityAuthoritySatisfied } from '../utils/reviewer-identity-authority';
import { buildApplicantAnchorRefreshReceipt, projectApplicantWarmInputs, REQUEST_SELECT, resolveReviewerProposalMetadata } from './workbench/reviewer-warm-validation-service';
import * as stageSourceVersions from './workbench/reviewer-stage-source-versions';
import { projectColdReviewerContactEvidence } from './workbench/reviewer-stage-producers/contact';
import { projectStaffConfirmedIdentityEvidence } from './workbench/reviewer-stage-producers/identity';
import { produceAddressTrustEvidence } from './workbench/reviewer-stage-producers/address-trust';
import { projectStageEnvelope } from './workbench/reviewer-stage-projector';
import { withRemediation } from '../utils/reviewer-remediation';
import { emailConfidence } from '../utils/reviewer-invite';
import { reviewerSuggestionCandidateKey } from '../utils/reviewer-candidate-key';
import { candidateStageLease } from './reviewer-stage-freshness';
import {
  addressConflictDisposition,
  buildAttestation,
  createConflictPendingState,
  createStaffVerifiedState,
  normalizeAddress,
  parseAddressTrustState,
  receiptCanResolveConflict,
} from '../utils/reviewer-address-trust';

function sameId(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function isActivePerson(person) {
  return !!person && (person.statecode === undefined || person.statecode === 0);
}

function isPreconditionFailure(error) {
  return error?.status === 412 || error?.response?.status === 412;
}

function repairKey(requestId, candidateKey, code) {
  const digest = createHash('sha256')
    .update(`${requestId}\n${candidateKey}\n${code}`)
    .digest('hex')
    .slice(0, 32);
  return `reviewer-address-repair:${digest}`;
}

async function requireRosterCandidate(requestId, candidateKey, allowedStatuses = null) {
  const [candidate] = await findCandidatesByKeys(requestId, [candidateKey]);
  if (!candidate) return null;
  if (allowedStatuses && !allowedStatuses.has(candidate.rosterStatus)) return null;
  return candidate;
}

async function resolveConflictPerson(requestId, candidate) {
  if (candidate?.suggestionId) {
    const suggestion = await suggestionAdapter.findById(candidate.suggestionId);
    if (!suggestion || !sameId(suggestion._wmkf_request_value, requestId)) return null;
    const personId = suggestion._wmkf_potentialreviewer_value || null;
    const person = personId ? await potentialReviewerAdapter.getById(personId) : null;
    return personId && person ? { personId, person } : null;
  }
  return resolveTrustedReviewerPerson(candidate, { allowInactive: true });
}

function isGuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function canonicalRosterKey(value) {
  return typeof value === 'string'
    && /^(suggestion|person|orcid|openalex|scholar|seed):[^\s:]{1,512}$/i.test(value.trim())
    ? value.trim()
    : null;
}

function sameEtag(left, right) {
  return typeof left === 'string' && left.length > 0 && left === right;
}

function personIdOf(person) {
  const id = person?.wmkf_potentialreviewersid || person?.id || null;
  return isGuid(id) ? id : null;
}

function applicantCandidate(candidate) {
  return candidate?.isApplicantRecommended === true
    || candidate?.provenance?.kind === 'applicant_suggested';
}

function stageLeaseBlock(lease, action) {
  if (!lease) return null;
  if (!lease.valid) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'lease_repair_required',
      message: `The ${lease.stage} evidence refresh has invalid lease data and cannot be treated as running. No changes were made. Ask a Workbench administrator to repair the lease, then reload before ${action}.`,
      leaseStage: lease.stage,
      retryable: false,
    });
  }
  if (lease.expired) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'lease_recovery_required',
      message: `The ${lease.stage} evidence refresh lease must be recovered before ${action}. Reload and retry that named stage.`,
      leaseStage: lease.stage,
      retryable: true,
    });
  }
  return withRemediation({
    success: false,
    decision: 'blocked',
    code: 'refresh_in_progress',
    message: `The ${lease.stage} evidence refresh is still running. Wait for it to finish, then reload before ${action}.`,
    leaseStage: lease.stage,
    retryable: true,
  });
}

function requestCoiContextVersion(request) {
  return stageSourceVersions.buildRequestCoiContextVersion({
    requestId: request?.akoya_requestid,
    applicantOrganization: {
      id: request?._akoya_applicantid_value,
      label: request?._akoya_applicantid_value_formatted,
      organizationName: request?.wmkf_organizationname,
    },
    principalInvestigator: {
      id: request?._wmkf_projectleader_value,
      label: request?._wmkf_projectleader_value_formatted,
    },
  });
}

function identityReceiptIsCurrent(candidate, snapshot) {
  const receipt = candidate?.stageFreshness?.identity;
  const expected = snapshot?.stageInputVersions?.identity;
  return receipt?.state === 'current'
    && receipt?.contractVersion === stageSourceVersions.CONTRACT_VERSIONS.identity
    && typeof expected === 'string'
    && receipt.sourceVersion === expected
    && isCandidateIdentityAuthoritySatisfied(candidate);
}

function cleanStructuredContact(verifiedContact = null) {
  if (!verifiedContact || typeof verifiedContact !== 'object' || Array.isArray(verifiedContact)) return {};
  const website = typeof verifiedContact.website === 'string' && verifiedContact.website.trim().length <= 2000
    ? verifiedContact.website.trim()
    : null;
  const affiliation = typeof verifiedContact.affiliation === 'string' && verifiedContact.affiliation.trim().length <= 1000
    ? verifiedContact.affiliation.trim()
    : null;
  return { website, affiliation };
}

function cleanManualIdentityContact(contact = null) {
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) return null;
  const email = normalizeAddress(contact.email);
  if (!email) return null;
  const website = typeof contact.website === 'string' && contact.website.trim().length <= 2000
    ? contact.website.trim()
    : null;
  const affiliation = typeof contact.affiliation === 'string' && contact.affiliation.trim().length <= 1000
    ? contact.affiliation.trim()
    : null;
  return { email, website, affiliation };
}

async function resolveStructuredRosterPerson(requestId, candidate) {
  const anchoredSuggestionId = candidate?.suggestionId;
  if (isGuid(anchoredSuggestionId)) {
    const suggestion = await suggestionAdapter.findById(anchoredSuggestionId);
    const suggestionPersonId = suggestion?._wmkf_potentialreviewer_value || null;
    if (!sameId(suggestion?.wmkf_appreviewersuggestionid || anchoredSuggestionId, anchoredSuggestionId)
      || !sameId(suggestion?._wmkf_request_value, requestId)
      || !isGuid(suggestionPersonId)
      || (candidate?.potentialReviewerId && !sameId(candidate.potentialReviewerId, suggestionPersonId))) {
      return null;
    }
    const person = await potentialReviewerAdapter.getById(suggestionPersonId);
    if (!person || !sameId(personIdOf(person) || suggestionPersonId, suggestionPersonId)) return null;
    return { personId: suggestionPersonId, person, suggestion };
  }
  const storedPersonId = candidate?.potentialReviewerId || candidate?.seedResolvedPotentialReviewerId || null;
  if (isGuid(storedPersonId)) {
    const person = await potentialReviewerAdapter.getById(storedPersonId);
    if (!person || !sameId(personIdOf(person) || storedPersonId, storedPersonId)) return null;
    return { personId: storedPersonId, person, suggestion: null };
  }
  const resolved = await resolveTrustedReviewerPerson(candidate);
  if (!resolved?.personId || !resolved?.person || !sameId(personIdOf(resolved.person) || resolved.personId, resolved.personId)) return null;
  return { personId: resolved.personId, person: resolved.person, suggestion: null };
}

async function structuredAuthoritySnapshot({ requestId, candidate, personId, person }) {
  const request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  if (!sameId(request?.akoya_requestid, requestId) || !request?.akoya_requestnum) return null;
  const proposal = await resolveReviewerProposalMetadata({ requestId, requestNumber: request.akoya_requestnum });
  if (proposal?.state !== 'current' || projectApplicantWarmInputs(request).state !== 'current') return null;
  const anchor = applicantCandidate(candidate)
    ? buildApplicantAnchorRefreshReceipt({ request, candidate, completedAt: new Date().toISOString() })
    : null;
  const preview = {
    ...candidate,
    ...(anchor ? { applicantInputVersion: anchor.sourceVersion } : {}),
    canonicalPersonId: personId,
    canonicalPersonEtag: person?._etag || null,
    personEtag: person?._etag || null,
  };
  const snapshot = stageSourceVersions.buildReviewerStageDependencySnapshot({
    candidate: preview,
    requestId,
    rosterUpdatedAt: candidate.rosterUpdatedAt,
    applicantInputVersion: anchor?.sourceVersion || null,
    proposalContentVersion: proposal.proposalContentVersion,
    requestCoiContextVersion: requestCoiContextVersion(request),
  });
  return { request, proposal, snapshot, candidate: preview };
}

/**
 * Confirm the exact server-read roster identity before accepting staff contact
 * edits.  The browser contributes only the contact corrections; the person,
 * ETag, actor, timestamp, identity receipt, and roster CAS token all come
 * from the authenticated/server reads performed here.
 */
export async function confirmStructuredRosterIdentity({
  requestId,
  candidateKey,
  manualContact,
  actorProfileId,
  actorSystemUserId,
}) {
  const key = canonicalRosterKey(candidateKey);
  const contact = cleanManualIdentityContact(manualContact);
  if (!key || !contact) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer or exact email is no longer valid. Reload before confirming identity.',
    });
  }
  if (typeof actorSystemUserId !== 'string' || !actorSystemUserId.trim() || actorSystemUserId.trim().length > 120) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'invalid_identity_confirmation',
      message: 'A current authenticated staff actor is required before identity can be confirmed.',
    });
  }
  const candidate = await findCandidateByKey(requestId, key);
  if (!candidate || candidate.candidateKey !== key || candidate.rosterStatus !== 'active' || !candidate.rosterUpdatedAt) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer is no longer in the current Find roster. Reload before confirming identity.',
    });
  }
  const blockingLease = candidateStageLease(candidate);
  const leaseBlock = stageLeaseBlock(blockingLease, 'confirming identity');
  if (leaseBlock) return leaseBlock;
  // Staff may correct contact fields in this action, but never the person
  // binding or identity result. Include those corrections in the dependency
  // snapshot so the identity receipt remains current after the same atomic
  // roster write publishes them.
  const website = contact.website || candidate.website || null;
  const affiliation = contact.affiliation || candidate.affiliation || null;
  const candidateForConfirmation = {
    ...candidate,
    email: contact.email,
    emailSource: 'manual',
    website,
    websiteSource: contact.website ? 'manual' : candidate.websiteSource || null,
    affiliation,
    affiliationSource: contact.affiliation ? 'staff_manual' : candidate.affiliationSource || null,
    contactEnrichment: {
      ...(candidate.contactEnrichment || {}),
      email: contact.email,
      emailSource: 'manual',
      website,
      websiteSource: contact.website ? 'manual' : candidate.contactEnrichment?.websiteSource || candidate.websiteSource || null,
      affiliation,
      affiliationSource: contact.affiliation ? 'staff_manual' : candidate.contactEnrichment?.affiliationSource || candidate.affiliationSource || null,
    },
  };

  let resolved;
  try {
    resolved = await resolveStructuredRosterPerson(requestId, candidate);
  } catch {
    resolved = null;
  }
  if (!resolved || !isActivePerson(resolved.person) || !resolved.person?._etag) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The exact current reviewer record could not be re-established. Reload before confirming identity.',
    });
  }

  let authority;
  try {
    authority = await structuredAuthoritySnapshot({
      requestId,
      candidate: candidateForConfirmation,
      personId: resolved.personId,
      person: resolved.person,
    });
  } catch {
    authority = null;
  }
  const expectedSourceVersion = authority?.snapshot?.stageInputVersions?.identity;
  if (!authority || typeof expectedSourceVersion !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedSourceVersion)) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'identity_authority_unavailable',
      message: 'The current proposal and reviewer context could not be loaded. Reload and retry identity confirmation.',
    });
  }

  const confirmedAt = new Date().toISOString();
  const canonicalPerson = {
    authority: 'server_loaded',
    canonicalPersonId: resolved.personId,
    canonicalPersonEtag: resolved.person._etag,
    actorId: actorSystemUserId.trim(),
    confirmedAt,
  };
  const identityEnvelope = projectStaffConfirmedIdentityEvidence({
    candidate: authority.candidate,
    applicantInputVersion: authority.snapshot.applicantInputVersion,
    proposalContentVersion: authority.snapshot.proposalContentVersion,
    confirmation: canonicalPerson,
    completedAt: confirmedAt,
    expectedSourceVersion,
  });
  const projected = projectStageEnvelope({
    stage: 'identity',
    mode: 'manual_refresh',
    envelope: identityEnvelope,
  });
  if (!projected.ok || projected.value.receipt.sourceVersion !== expectedSourceVersion) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'identity_authority_unavailable',
      message: 'The current identity confirmation could not be projected. Reload and retry.',
    });
  }

  // Re-read immediately before the roster CAS. A changed Dataverse ETag means
  // the evidence is stale; never attach the older confirmation to the row.
  let settledPerson;
  try {
    settledPerson = await potentialReviewerAdapter.getById(resolved.personId);
  } catch {
    settledPerson = null;
  }
  if (!settledPerson || !isActivePerson(settledPerson)
    || !sameId(personIdOf(settledPerson) || resolved.personId, resolved.personId)
    || !sameEtag(settledPerson._etag, resolved.person._etag)) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer changed while identity was being confirmed. Reload and review the current record.',
    });
  }

  const persisted = await persistIdentityConfirmation(requestId, candidateForConfirmation, {
    actorProfileId: actorProfileId ?? null,
    actorSystemUserId: canonicalPerson.actorId,
    canonicalPerson,
    identityEnvelope,
    expectedUpdatedAt: candidate.rosterUpdatedAt,
  });
  if (!persisted) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer card changed while identity was being confirmed. Reload and retry.',
    });
  }
  return {
    success: true,
    decision: 'identity_confirmed',
    code: 'identity_confirmed',
    ...persisted,
    remediation: [],
  };
}

function structuredPreviewCandidate({ candidate, person, personId, verifiedContact }) {
  const email = normalizeAddress(person?.wmkf_emailaddress);
  const emailSource = typeof person?.wmkf_emailsource === 'string' && person.wmkf_emailsource.trim()
    ? person.wmkf_emailsource.trim()
    : null;
  const contact = cleanStructuredContact(verifiedContact);
  const identityDecision = candidate?.identityDecision
    || candidate?.identityEvidence?.decision
    || candidate?.identityEvidence?.status
    || candidate?.identityStatus
    || candidate?.contactEnrichment?.identity?.status
    || null;
  return {
    ...candidate,
    potentialReviewerId: personId,
    canonicalPersonId: personId,
    canonicalPersonEtag: person._etag,
    personEtag: person._etag,
    email,
    emailSource,
    emailPersistAllowed: true,
    ...(contact.website ? { website: contact.website, websiteSource: 'staff_manual', websitePersistAllowed: true } : {}),
    ...(contact.affiliation ? { affiliation: contact.affiliation, affiliationSource: 'staff_manual', affiliationPersistAllowed: true } : {}),
    contactEnrichment: {
      ...(candidate?.contactEnrichment || {}),
      email,
      emailSource,
      emailPersistAllowed: true,
      ...(contact.website ? { website: contact.website, websiteSource: 'staff_manual', websitePersistAllowed: true } : {}),
      ...(contact.affiliation ? { affiliation: contact.affiliation, affiliationSource: 'staff_manual', affiliationPersistAllowed: true } : {}),
      identity: { ...(candidate?.contactEnrichment?.identity || {}), status: identityDecision },
      // This action is a structured staff decision, not a partial contact-tier
      // run.  Old tier failures must not invalidate the exact staff result.
      tierResults: {},
      tiersUsed: ['structured_staff_address'],
    },
  };
}

function legacyStructuredReceipt({ requestId, candidateKey, email, personId, personEtag, attestation }) {
  return {
    receiptId: randomUUID(),
    email,
    personConfirmed: true,
    ...attestation,
    canonicalPersonId: personId,
    canonicalPersonEtag: personEtag,
  };
}

function staleStructuredPartial({ code = 'candidate_stale', message, personUpdated = false } = {}) {
  return withRemediation({
    success: false,
    decision: 'blocked',
    code,
    message: message || 'The address decision was saved to the reviewer record, but the Find card changed. Reload and retry the targeted stage repair.',
    partialSuccess: true,
    personUpdated,
    retryable: true,
  });
}

function leaseRepairStructuredPartial(leaseStage) {
  return withRemediation({
    success: false,
    decision: 'blocked',
    code: 'lease_repair_required',
    message: `The address decision was saved to the reviewer record, but the ${leaseStage || 'current'} evidence refresh has invalid lease data. Do not retry automatically. Ask a Workbench administrator to repair the lease, then reload reviewer status.`,
    leaseStage: leaseStage || null,
    partialSuccess: true,
    personUpdated: true,
    retryable: false,
  });
}

/**
 * The structured address action is the sole two-stage exception to the normal
 * one-stage refresh rule.  It never accepts a client receipt/version: the
 * current request, roster row, canonical person, and every source version are
 * read on the server.  Its one Postgres CAS publishes CONTACT + ADDRESS_TRUST
 * together after any ETag-bound person correction succeeds.
 */
async function verifyStructuredRosterPersonAndAddress({
  requestId,
  candidateKey,
  email,
  verifiedContact,
  evidenceType,
  evidenceUrl,
  note,
  actorProfileId,
  actorSystemUserId,
}) {
  const key = canonicalRosterKey(candidateKey);
  if (!key) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer is no longer an active canonical Find candidate. Reload before verifying.',
    });
  }
  const candidate = await findCandidateByKey(requestId, key);
  if (!candidate || candidate.candidateKey !== key || candidate.rosterStatus !== 'active' || !candidate.rosterUpdatedAt) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer is no longer in the current Find roster. Reload before verifying.',
    });
  }
  const blockingLease = candidateStageLease(candidate);
  const leaseBlock = stageLeaseBlock(blockingLease, 'verifying this address');
  if (leaseBlock) return leaseBlock;

  let resolved;
  try {
    resolved = await resolveStructuredRosterPerson(requestId, candidate);
  } catch {
    resolved = null;
  }
  if (!resolved || !isActivePerson(resolved.person) || !resolved.person?._etag) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The exact current reviewer record could not be re-established. Reload before verifying.',
    });
  }

  let authority;
  try {
    authority = await structuredAuthoritySnapshot({
      requestId,
      candidate,
      personId: resolved.personId,
      person: resolved.person,
    });
  } catch {
    authority = null;
  }
  if (!authority || !identityReceiptIsCurrent(authority.candidate, authority.snapshot)) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'identity_verification_required',
      message: 'A current authoritative identity decision is required before an address can be verified.',
    });
  }
  if (typeof actorSystemUserId !== 'string' || !actorSystemUserId.trim() || actorSystemUserId.trim().length > 120) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'invalid_address_attestation',
      message: 'A current authenticated staff actor is required before an address can be verified.',
    });
  }

  const exactEmail = normalizeAddress(email);
  const currentTrust = parseAddressTrustState(resolved.person.wmkf_addresstruststatejson, {
    storedEmail: resolved.person.wmkf_emailaddress,
  });
  const pendingConflict = currentTrust.valid && currentTrust.state.status === 'conflict_pending'
    ? currentTrust.state.conflict
    : null;
  const permittedEmails = pendingConflict
    ? new Set([normalizeAddress(pendingConflict.storedEmail), normalizeAddress(pendingConflict.foundEmail)].filter(Boolean))
    : null;
  if (!exactEmail || (permittedEmails && !permittedEmails.has(exactEmail))) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: pendingConflict
        ? 'Choose one of the two current conflict addresses after reloading the card.'
        : 'A valid exact reviewer address is required.',
    });
  }

  const attestedAt = new Date().toISOString();
  let attestation;
  try {
    attestation = buildAttestation({
      actorProfileId,
      actorSystemUserId,
      requestId,
      candidateKey: key,
      evidenceType,
      evidenceUrl,
      note,
      attestedAt,
    });
  } catch (error) {
    throw error;
  }
  if (pendingConflict && !receiptCanResolveConflict({ personConfirmed: true, attestedAt }, pendingConflict)) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The address conflict changed while it was being reviewed. Reload and try again.',
    });
  }

  const addressTrustStateJson = JSON.stringify(createStaffVerifiedState({
    email: exactEmail,
    ...attestation,
    resolution: pendingConflict ? {
      conflict: pendingConflict,
      decision: exactEmail === normalizeAddress(pendingConflict.storedEmail) ? 'keep_stored' : 'use_found',
      actorProfileId: attestation.actorProfileId,
      actorSystemUserId: attestation.actorSystemUserId,
      resolvedAt: attestedAt,
    } : null,
  }));
  try {
    await potentialReviewerAdapter.update(resolved.personId, {
      email: exactEmail,
      emailSource: 'staff_verified',
      addressTrustStateJson,
    }, {
      actingUserSystemId: actorSystemUserId,
      ifMatch: resolved.person._etag,
    });
  } catch (error) {
    if (translateDuplicateKeyError(error)) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'email_conflict',
        message: 'That address belongs to another reviewer record. Request repair to resolve the duplicate.',
      });
    }
    if (isPreconditionFailure(error)) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'candidate_stale',
        message: 'The reviewer changed while the address was being verified. Reload and review the current value.',
      });
    }
    throw error;
  }

  // A successful external write is not roster completion. Re-read the exact
  // person before projecting either receipt; a changed/malformed person state
  // is a retryable partial result and never produces stale stage authority.
  let postActionPerson;
  try {
    postActionPerson = await potentialReviewerAdapter.getById(resolved.personId);
  } catch {
    return staleStructuredPartial({ personUpdated: true });
  }
  const postTrust = parseAddressTrustState(postActionPerson?.wmkf_addresstruststatejson, {
    storedEmail: postActionPerson?.wmkf_emailaddress,
  });
  if (!isActivePerson(postActionPerson)
    || !sameId(personIdOf(postActionPerson) || resolved.personId, resolved.personId)
    || !postActionPerson?._etag
    || normalizeAddress(postActionPerson.wmkf_emailaddress) !== exactEmail
    || postActionPerson.wmkf_emailsource !== 'staff_verified'
    || !postTrust.valid
    || postTrust.state.status !== 'staff_verified'
    || postTrust.state.email !== exactEmail
    || postTrust.state.attestation?.attestedAt !== attestedAt
    || postTrust.state.attestation?.actorProfileId !== attestation.actorProfileId
    || postTrust.state.attestation?.actorSystemUserId !== attestation.actorSystemUserId
    || postTrust.state.attestation?.requestId !== attestation.requestId
    || postTrust.state.attestation?.candidateKey !== attestation.candidateKey
    || postTrust.state.attestation?.evidenceType !== attestation.evidenceType
    || postTrust.state.attestation?.evidenceUrl !== attestation.evidenceUrl
    || postTrust.state.attestation?.note !== attestation.note) {
    return staleStructuredPartial({ personUpdated: true });
  }

  const preview = structuredPreviewCandidate({
    candidate: authority.candidate,
    person: postActionPerson,
    personId: resolved.personId,
    verifiedContact,
  });
  let postAuthority;
  try {
    postAuthority = await structuredAuthoritySnapshot({
      requestId,
      candidate: preview,
      personId: resolved.personId,
      person: postActionPerson,
    });
  } catch {
    postAuthority = null;
  }
  if (!postAuthority || !identityReceiptIsCurrent(postAuthority.candidate, postAuthority.snapshot)) {
    return staleStructuredPartial({ personUpdated: true });
  }
  const canonicalPerson = {
    authority: 'server_loaded',
    canonicalPersonId: resolved.personId,
    canonicalPersonEtag: postActionPerson._etag,
    personEtag: postActionPerson._etag,
  };
  const contactExpectedSource = postAuthority.snapshot.stageInputVersions?.contact;
  const contactEnvelope = projectColdReviewerContactEvidence({
    candidate: postAuthority.candidate,
    canonicalPerson,
    expectedSourceVersion: contactExpectedSource,
    complete: true,
  });
  if (contactEnvelope?.receipt?.sourceVersion !== contactExpectedSource) {
    return staleStructuredPartial({ personUpdated: true });
  }

  const afterContact = {
    ...postAuthority.candidate,
    ...contactEnvelope.evidencePatch,
    stageFreshness: {
      ...(postAuthority.candidate.stageFreshness || {}),
      contact: contactEnvelope.receipt,
    },
  };
  const addressAuthority = stageSourceVersions.buildReviewerStageDependencySnapshot({
    candidate: afterContact,
    requestId,
    rosterUpdatedAt: candidate.rosterUpdatedAt,
    applicantInputVersion: postAuthority.snapshot.applicantInputVersion,
    proposalContentVersion: postAuthority.snapshot.proposalContentVersion,
    requestCoiContextVersion: postAuthority.snapshot.requestCoiContextVersion,
  });
  const addressExpectedSource = addressAuthority.stageInputVersions?.address_trust;
  const addressTrustEnvelope = await produceAddressTrustEvidence({
    candidate: afterContact,
    linkedPerson: postActionPerson,
    canonicalPerson,
    expectedSourceVersion: addressExpectedSource,
  });
  if (addressTrustEnvelope?.receipt?.sourceVersion !== addressExpectedSource) {
    return staleStructuredPartial({ personUpdated: true });
  }

  // Re-read immediately before the Postgres CAS. The envelopes bind this exact
  // person ETag and email; any interleaving Dataverse mutation is stale rather
  // than an opportunity to publish a mixed authority pair.
  let settledPerson;
  try {
    settledPerson = await potentialReviewerAdapter.getById(resolved.personId);
  } catch {
    return staleStructuredPartial({ personUpdated: true });
  }
  if (!sameEtag(settledPerson?._etag, postActionPerson._etag)
    || normalizeAddress(settledPerson?.wmkf_emailaddress) !== exactEmail
    || settledPerson?.wmkf_emailsource !== 'staff_verified') {
    return staleStructuredPartial({ personUpdated: true });
  }

  const legacyAddressReceipt = legacyStructuredReceipt({
    requestId,
    candidateKey: key,
    email: exactEmail,
    personId: resolved.personId,
    personEtag: settledPerson._etag,
    attestation,
  });
  const persisted = await completeStructuredAddressVerification(
    requestId,
    key,
    candidate.rosterUpdatedAt,
    {
      contactEnvelope,
      addressTrustEnvelope,
      expectedSourceVersions: {
        contact: contactExpectedSource,
        address_trust: addressExpectedSource,
      },
      legacyAddressReceipt,
    },
  );
  if (persisted.outcome !== 'recorded') {
    if (persisted.outcome === 'lease_repair_required') {
      return leaseRepairStructuredPartial(persisted.leaseStage);
    }
    if (persisted.outcome === 'rejected') {
      return staleStructuredPartial({
        code: 'address_trust_action_failed',
        message: 'The verified address could not be projected into the current Find evidence. Reload and retry.',
        personUpdated: true,
      });
    }
    return staleStructuredPartial({ personUpdated: true });
  }
  const finalStates = [contactEnvelope.receipt.state, addressTrustEnvelope.receipt.state];
  if (!finalStates.every((state) => state === 'current' || state === 'not_applicable')) {
    return staleStructuredPartial({
      code: 'address_trust_action_failed',
      message: 'The reviewer address was updated, but its current Find evidence is incomplete. Reload and use the named targeted retry.',
      personUpdated: true,
    });
  }
  return {
    success: true,
    decision: pendingConflict ? 'address_conflict_resolved' : 'attested_pending_promotion',
    code: 'address_attested',
    message: pendingConflict
      ? 'The address conflict was resolved and the current Find evidence was refreshed.'
      : 'The exact reviewer address and current Find evidence were recorded.',
    receiptId: legacyAddressReceipt.receiptId,
    candidateKey: key,
    candidate: persisted.candidate,
    rosterVersion: persisted.updatedAt || null,
    remediation: [],
  };
}

export async function getAddressConflict({ requestId, candidateKey }) {
  const candidate = await requireRosterCandidate(requestId, candidateKey, new Set(['active']));
  if (!candidate) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer is no longer in the current Find roster. Reload the request.',
    });
  }
  const resolved = await resolveConflictPerson(requestId, candidate);
  if (resolved && !isActivePerson(resolved.person)) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'person_inactive',
      message: 'This reviewer record is inactive and must be repaired before its address can be reviewed.',
    });
  }
  if (candidate.conflictRecordUnavailable === true && !resolved) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'conflict_record_unavailable',
      message: 'The exact reviewer record could not be re-established. Retry or create a repair request.',
    });
  }
  const parsed = resolved ? parseAddressTrustState(
    resolved.person.wmkf_addresstruststatejson,
    { storedEmail: resolved.person.wmkf_emailaddress },
  ) : null;
  if (!parsed?.valid || parsed.state.status !== 'conflict_pending') {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The address conflict is no longer current. Reload or create a repair request from this reviewer card.',
    });
  }
  return {
    success: true,
    decision: 'review_address_conflict',
    code: 'address_conflict_pending',
    candidateKey,
    conflict: {
      storedEmail: parsed.state.conflict.storedEmail,
      foundEmail: parsed.state.conflict.foundEmail,
      reason: parsed.state.conflict.reason,
      detectedAt: parsed.state.conflict.detectedAt,
    },
    remediation: [],
  };
}

async function resolveRepairCandidate(requestId, candidateKey, suggestionId) {
  if (candidateKey) {
    const candidate = await requireRosterCandidate(requestId, candidateKey);
    return candidate ? { candidate, candidateKey } : null;
  }
  if (!suggestionId) return null;
  const suggestion = await suggestionAdapter.findById(suggestionId);
  if (!suggestion || !sameId(suggestion._wmkf_request_value, requestId)) return null;
  const personId = suggestion._wmkf_potentialreviewer_value || null;
  const person = personId ? await potentialReviewerAdapter.getById(personId) : null;
  return {
    candidateKey: reviewerSuggestionCandidateKey(suggestionId),
    candidate: {
      suggestionId,
      potentialReviewerId: personId,
      name: person?.wmkf_name || null,
      email: person?.wmkf_emailaddress || null,
    },
  };
}

export async function verifyPersonAndAddress({
  requestId,
  candidateKey,
  suggestionId = null,
  email,
  verifiedContact = null,
  evidenceType,
  evidenceUrl,
  note,
  actorProfileId,
  actorSystemUserId,
}) {
  if (suggestionId && !candidateKey) {
    const suggestion = await suggestionAdapter.findById(suggestionId);
    if (!suggestion || !sameId(suggestion._wmkf_request_value, requestId)) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'candidate_stale',
        message: 'The reviewer is no longer attached to this request. Reload before verifying.',
      });
    }
    const personId = suggestion._wmkf_potentialreviewer_value;
    const person = personId ? await potentialReviewerAdapter.getById(personId) : null;
    if (person && !isActivePerson(person)) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'person_inactive',
        message: 'This reviewer record is inactive and must be repaired before its address can be verified.',
      });
    }
    const exactEmail = normalizeAddress(email);
    const currentTrust = parseAddressTrustState(person?.wmkf_addresstruststatejson, {
      storedEmail: person?.wmkf_emailaddress,
    });
    const pendingConflict = currentTrust.valid && currentTrust.state.status === 'conflict_pending'
      ? currentTrust.state.conflict
      : null;
    const permittedEmails = new Set([
      normalizeAddress(person?.wmkf_emailaddress),
      pendingConflict ? normalizeAddress(pendingConflict.foundEmail) : null,
    ].filter(Boolean));
    if (!person?._etag || !exactEmail || !permittedEmails.has(exactEmail)) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'candidate_stale',
        message: 'The reviewer address changed. Reload and verify the current value.',
      });
    }
    const readiness = emailConfidence(person);
    if (readiness.action === 'ready') {
      return {
        success: true,
        decision: 'already_ready',
        code: 'address_already_ready',
        message: 'This reviewer address already has invite-ready provenance.',
        suggestionId,
        remediation: [],
      };
    }
    const stableCandidateKey = reviewerSuggestionCandidateKey(suggestionId);
    const attestedAt = new Date().toISOString();
    if (pendingConflict && !receiptCanResolveConflict({
      personConfirmed: true,
      attestedAt,
    }, pendingConflict)) {
      return withRemediation({
        success: false,
        decision: 'blocked',
        code: 'candidate_stale',
        message: 'The address conflict changed while it was being reviewed. Reload and try again.',
      });
    }
    const resolution = currentTrust.valid && currentTrust.state.status === 'conflict_pending'
      ? {
          conflict: currentTrust.state.conflict,
          decision: exactEmail === currentTrust.state.email ? 'keep_stored' : 'use_found',
          actorProfileId: actorProfileId || null,
          actorSystemUserId: actorSystemUserId || null,
          resolvedAt: attestedAt,
        }
      : null;
    const addressTrustStateJson = JSON.stringify(createStaffVerifiedState({
      email: exactEmail,
      actorProfileId,
      actorSystemUserId,
      requestId,
      candidateKey: stableCandidateKey,
      evidenceType,
      evidenceUrl,
      note,
      attestedAt,
      resolution,
    }));
    try {
      await potentialReviewerAdapter.update(personId, {
        email: exactEmail,
        emailSource: 'staff_verified',
        addressTrustStateJson,
      }, {
        actingUserSystemId: actorSystemUserId,
        ifMatch: person._etag,
      });
    } catch (error) {
      if (translateDuplicateKeyError(error)) {
        return withRemediation({
          success: false,
          decision: 'blocked',
          code: 'email_conflict',
          message: 'That address belongs to another reviewer record. Request repair to resolve the duplicate.',
        });
      }
      if (isPreconditionFailure(error)) {
        return withRemediation({
          success: false,
          decision: 'blocked',
          code: 'candidate_stale',
          message: 'The reviewer changed while the address was being verified. Reload and review the current value.',
        });
      }
      throw error;
    }
    return {
      success: true,
      decision: 'person_address_verified',
      code: 'address_attested',
      message: 'The exact reviewer address and evidence were recorded.',
      suggestionId,
      remediation: [],
    };
  }
  if (candidateKey) {
    // Canonical roster candidates always use the structured flow. In
    // particular, an address action must not create or replace its own
    // identity authority through the historical receipt-only path.
    return verifyStructuredRosterPersonAndAddress({
      requestId,
      candidateKey,
      email,
      verifiedContact,
      evidenceType,
      evidenceUrl,
      note,
      actorProfileId,
      actorSystemUserId,
    });
  }
  // The API contract accepts exactly one of the two identifier-backed flows
  // above. Keep direct service callers fail-closed instead of falling through
  // to the retired receipt-only roster mutation path.
  return withRemediation({
    success: false,
    decision: 'blocked',
    code: 'candidate_stale',
    message: 'A current reviewer identifier is required. Reload before verifying.',
  });
}

export async function retryAddressCheck({
  requestId,
  candidateKey,
  actorSystemUserId = null,
}) {
  const candidate = await requireRosterCandidate(requestId, candidateKey, new Set(['active']));
  if (!candidate) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer is no longer in the current Find roster. Reload the request.',
    });
  }
  if (candidate.conflictRecordUnavailable !== true && candidate.addressConflictPending !== true) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'This reviewer no longer has an address check that needs retrying. Reload the request.',
    });
  }
  const refreshed = {
    ...candidate,
    addressConflictPending: false,
    conflictRecordUnavailable: false,
    contactEnrichment: {
      ...(candidate.contactEnrichment || {}),
      addressConflictPending: false,
      conflictRecordUnavailable: false,
    },
  };
  delete refreshed.rosterUpdatedAt;
  delete refreshed.rosterStatus;
  const resolved = await resolveConflictPerson(requestId, candidate);
  if (!resolved) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'conflict_record_unavailable',
      message: 'The exact reviewer record could not be re-established. Retry or create a repair request.',
    });
  }
  if (!isActivePerson(resolved.person)) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'person_inactive',
      message: 'This reviewer record is inactive and must be repaired before its address can be checked.',
    });
  }
  const currentTrust = parseAddressTrustState(
    resolved.person.wmkf_addresstruststatejson,
    { storedEmail: resolved.person.wmkf_emailaddress },
  );
  const storedEmail = normalizeAddress(resolved.person.wmkf_emailaddress);
  const foundEmail = normalizeAddress(candidate.contactEnrichment?.email || candidate.email);
  const receipt = candidate.addressTrustReceipt || null;
  const receiptEmail = normalizeAddress(receipt?.email);
  const projectResolved = (person = resolved.person) => {
    const readiness = emailConfidence(person);
    refreshed.applicantContactMismatch = false;
    refreshed.addressConflictPending = false;
    refreshed.email = storedEmail;
    refreshed.emailSource = person.wmkf_emailsource || null;
    refreshed.emailPersistAllowed = false;
    refreshed.contactEnrichment.addressConflictPending = false;
    refreshed.contactEnrichment.email = storedEmail;
    refreshed.contactEnrichment.emailSource = person.wmkf_emailsource || null;
    refreshed.contactEnrichment.emailPersistAllowed = false;
    if (refreshed.applicantKnownReviewer) {
      refreshed.applicantKnownReviewer = {
        ...refreshed.applicantKnownReviewer,
        email: storedEmail,
        emailSource: person.wmkf_emailsource || null,
        addressConflictPending: false,
        addressTrustVerified: readiness.action === 'ready',
        emailReadiness: {
          level: readiness.level,
          action: readiness.action,
          reason: readiness.reason,
        },
      };
    }
  };

  // A receipt can replay only an already-durable conflict whose exact A/B pair
  // it postdates. If no conflict bundle exists, retry must first persist the
  // contradiction below; one-sided evidence cannot manufacture adjudication.
  if (
    receipt?.personConfirmed === true
    && receiptEmail
    && currentTrust.valid
    && currentTrust.state.status === 'conflict_pending'
  ) {
    const conflict = currentTrust.state.conflict;
    const allowed = new Set([
      normalizeAddress(conflict.storedEmail),
      normalizeAddress(conflict.foundEmail),
    ]);
    if (allowed.has(receiptEmail) && receiptCanResolveConflict(receipt, conflict)) {
      if (!resolved.person._etag) {
        return withRemediation({
          success: false,
          decision: 'blocked',
          code: 'candidate_stale',
          message: 'The reviewer version could not be confirmed. Reload before retrying the recorded evidence.',
        });
      }
      const verifiedState = createStaffVerifiedState({
        email: receiptEmail,
        actorProfileId: receipt.actorProfileId,
        actorSystemUserId: receipt.actorSystemUserId,
        requestId,
        candidateKey,
        evidenceType: receipt.evidenceType,
        evidenceUrl: receipt.evidenceUrl,
        note: receipt.note,
        attestedAt: receipt.attestedAt,
        resolution: {
          conflict,
          decision: receiptEmail === normalizeAddress(conflict.storedEmail) ? 'keep_stored' : 'use_found',
          actorProfileId: receipt.actorProfileId || null,
          actorSystemUserId: receipt.actorSystemUserId || null,
          resolvedAt: receipt.attestedAt,
        },
      });
      try {
        await potentialReviewerAdapter.update(resolved.personId, {
          email: receiptEmail,
          emailSource: 'staff_verified',
          addressTrustStateJson: JSON.stringify(verifiedState),
        }, {
          actingUserSystemId: actorSystemUserId,
          ifMatch: resolved.person._etag,
        });
      } catch (error) {
        if (translateDuplicateKeyError(error)) {
          return withRemediation({
            success: false,
            decision: 'blocked',
            code: 'email_conflict',
            message: 'That address belongs to another reviewer record. Request repair to resolve the duplicate.',
          });
        }
        if (isPreconditionFailure(error)) {
          return withRemediation({
            success: false,
            decision: 'blocked',
            code: 'candidate_stale',
            message: 'The reviewer changed while the recorded evidence was being retried. Reload and review the current address.',
          });
        }
        return withRemediation({
          success: false,
          decision: 'blocked',
          code: 'conflict_record_unavailable',
          message: 'The evidence remains recorded, but the reviewer address still could not be updated. Retry or create a repair request.',
        });
      }
      const cleared = await clearAddressTrustBlocks(requestId, candidateKey, {
        receiptId: receipt.receiptId,
        expectedUpdatedAt: candidate.rosterUpdatedAt,
      });
      if (!cleared) {
        return withRemediation({
          success: false,
          decision: 'blocked',
          code: 'candidate_stale',
          message: 'The reviewer address was resolved, but the card changed meanwhile. Reload the request.',
          partialSuccess: true,
          personUpdated: true,
        });
      }
      return {
        success: true,
        decision: 'address_conflict_resolved',
        code: 'address_attested',
        message: 'The recorded evidence was applied and the reviewer address is invite-ready.',
        candidateKey,
        candidate: cleared,
        remediation: [],
      };
    }
  }

  if (currentTrust.valid && currentTrust.state.status === 'conflict_pending') {
    refreshed.addressConflictPending = true;
    refreshed.contactEnrichment.addressConflictPending = true;
  } else {
    const canRecordContradiction = !!storedEmail && !!foundEmail
      && storedEmail !== foundEmail
      && candidate.contactEnrichment?.emailPersistAllowed === true;
    if (canRecordContradiction) {
      const disposition = addressConflictDisposition(currentTrust.state, {
        email: storedEmail,
        foundEmail,
        reason: 'email_mismatch',
      });
      if (disposition === 'write') {
        const conflictState = createConflictPendingState({
          currentState: currentTrust.state,
          email: storedEmail,
          reason: 'email_mismatch',
          foundEmail,
          source: candidate.contactEnrichment?.emailSource || null,
          requestId,
          candidateKey,
        });
        if (!resolved.person._etag) {
          return withRemediation({
            success: false,
            decision: 'blocked',
            code: 'candidate_stale',
            message: 'The reviewer version could not be confirmed. Reload before retrying the conflict check.',
          });
        }
        try {
          await potentialReviewerAdapter.update(resolved.personId, {
            addressTrustStateJson: JSON.stringify(conflictState),
          }, {
            actingUserSystemId: actorSystemUserId,
            ifMatch: resolved.person._etag,
          });
        } catch (error) {
          if (isPreconditionFailure(error)) {
            return withRemediation({
              success: false,
              decision: 'blocked',
              code: 'candidate_stale',
              message: 'The reviewer changed while the conflict check was retried. Reload and review the current address.',
            });
          }
          return withRemediation({
            success: false,
            decision: 'blocked',
            code: 'conflict_record_unavailable',
            message: 'The conflict still could not be recorded. Retry or create a repair request.',
          });
        }
      }
      if (disposition === 'resolved') projectResolved();
      else {
        refreshed.addressConflictPending = true;
        refreshed.contactEnrichment.addressConflictPending = true;
      }
    } else if (currentTrust.valid && currentTrust.state.status === 'staff_verified') {
      projectResolved();
    }
  }
  const recorded = await recordSurfaced(requestId, [refreshed], {
    expectedUpdatedAt: candidate.rosterUpdatedAt,
  });
  if (!recorded) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer changed while the check was running. Reload and retry.',
    });
  }
  const current = await requireRosterCandidate(requestId, candidateKey);
  return {
    success: true,
    decision: 'refreshed',
    code: 'candidate_refreshed',
    candidateKey,
    candidate: current,
    remediation: [],
  };
}

export async function createAddressRepairRequest({
  requestId,
  candidateKey,
  suggestionId = null,
  code,
  actorProfileId,
  actorSystemUserId,
}) {
  const resolved = await resolveRepairCandidate(requestId, candidateKey, suggestionId);
  if (!resolved) {
    return withRemediation({
      success: false,
      decision: 'blocked',
      code: 'candidate_stale',
      message: 'The reviewer is no longer in the current Find roster. Reload before requesting repair.',
    });
  }
  const candidate = resolved.candidate;
  const repairCandidateKey = resolved.candidateKey;
  const normalizedCode = typeof code === 'string' && code.trim()
    ? code.trim().slice(0, 100)
    : 'unknown';
  const alert = await NotificationService.notify({
    type: 'reviewer_address_repair_requested',
    severity: 'warning',
    title: 'Reviewer address repair requested',
    message: `Staff requested reviewer identity/address repair for request ${requestId}.`,
    metadata: {
      requestId,
      candidateKey: repairCandidateKey,
      candidateName: candidate.name || null,
      suggestionId: candidate.suggestionId || suggestionId || null,
      potentialReviewerId: candidate.potentialReviewerId || null,
      code: normalizedCode,
      requestedByProfileId: actorProfileId || null,
      requestedBySystemUserId: actorSystemUserId || null,
    },
    source: 'reviewer-address-trust',
    category: 'reviewers',
    autoResolveKey: repairKey(requestId, repairCandidateKey, normalizedCode),
  });
  return {
    success: true,
    decision: 'repair_requested',
    code: normalizedCode,
    repairReference: alert?.id || repairKey(requestId, repairCandidateKey, normalizedCode),
    adminUrl: '/admin#system-alerts',
    message: alert
      ? 'Repair request created. The reviewer remains blocked until the underlying record is fixed.'
      : 'An active repair request already exists. The reviewer remains blocked until it is resolved.',
    remediation: [],
  };
}
