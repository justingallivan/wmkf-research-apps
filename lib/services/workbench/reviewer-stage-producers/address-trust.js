/**
 * Pure, server-input address-trust stage producer.
 *
 * This does not verify an address and does not accept a browser acknowledgement.
 * Structured staff verification remains the sole writer of the versioned
 * address-trust bundle; this producer only reads that server-owned bundle and
 * the deterministic source policy to project the current stage evidence.
 */

import { createHash } from 'crypto';
import { projectReviewerContact } from '../../../utils/reviewer-vetted-email.js';
import { emailConfidence } from '../../../utils/reviewer-invite.js';
import { addressTrustDecision, normalizeAddress } from '../../../utils/reviewer-address-trust.js';
import { abortError } from '../../contact-enrichment/abort.js';
import { isIdentityAuthoritySatisfied } from './identity.js';

const CONTRACT_VERSION = 1;
const MAX_SOURCE_VERSION_LENGTH = 160;
const MAX_URL_LENGTH = 2000;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVIDENCE_TYPES = new Set([
  'publication_corresponding_author', 'institution_page', 'direct_correspondence', 'other',
]);

function canonicalNow(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return date.toISOString();
}

function validSourceVersion(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SOURCE_VERSION_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function authoritativeSourceVersion(expectedSourceVersion) {
  return typeof expectedSourceVersion === 'string' && /^[a-f0-9]{64}$/i.test(expectedSourceVersion)
    ? expectedSourceVersion.toLowerCase()
    : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function resultVersion(value) {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function stageEnvelope({
  outcome,
  evidencePatch = {},
  sourceVersion,
  reasonCode = null,
  failureCode = null,
  now,
}) {
  const boundedSourceVersion = validSourceVersion(sourceVersion) ? sourceVersion : 'source_version_missing';
  return {
    outcome,
    evidencePatch,
    receipt: {
      state: outcome,
      contractVersion: CONTRACT_VERSION,
      sourceVersion: boundedSourceVersion,
      resultVersion: resultVersion({ outcome, evidencePatch, reasonCode, failureCode }),
      completedAt: outcome === 'current' || outcome === 'not_applicable' ? canonicalNow(now) : null,
      reasonCode,
      failureCode,
    },
  };
}

function throwIfAborted(signal, deadlineAt) {
  if (signal?.aborted) throw abortError(signal);
  if (Number.isFinite(deadlineAt) && Date.now() >= deadlineAt) {
    const error = new Error('reviewer_time_budget_exceeded');
    error.code = 'reviewer_time_budget_exceeded';
    throw error;
  }
}

function cleanString(value, max = 300) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function canonicalIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function serverCanonicalPerson(value) {
  if (!value || typeof value !== 'object' || value.authority !== 'server_loaded') return null;
  const canonicalPersonId = cleanString(value.canonicalPersonId, 80);
  const canonicalPersonEtag = cleanString(value.canonicalPersonEtag || value.personEtag, 240);
  if (!canonicalPersonId || !GUID_RE.test(canonicalPersonId) || !canonicalPersonEtag) return null;
  return { canonicalPersonId: canonicalPersonId.toLowerCase(), canonicalPersonEtag };
}

function staffVerifiedEvidence(canonicalPerson, personTrust) {
  const person = serverCanonicalPerson(canonicalPerson);
  const attestation = personTrust?.state?.attestation || {};
  const actorId = cleanString(attestation.actorSystemUserId, 120);
  const attestedAt = attestation.attestedAt;
  const evidenceType = attestation.evidenceType;
  const evidenceUrl = cleanString(attestation.evidenceUrl, MAX_URL_LENGTH);
  if (!person || !actorId || !canonicalIso(attestedAt) || !EVIDENCE_TYPES.has(evidenceType)
    || (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl))) return null;
  return {
    ...person,
    actorId,
    attestedAt,
    evidenceType,
    evidenceUrl: evidenceUrl || null,
  };
}

function trustedIdentityStatus(candidate) {
  const persisted = candidate?.identityEvidence && typeof candidate.identityEvidence === 'object'
    ? candidate.identityEvidence
    : {};
  const decision = persisted.decision
    || persisted.status
    || candidate?.identityDecision
    || candidate?.contactEnrichment?.identity?.status
    || candidate?.identityStatus
    || null;
  const identityEvidence = {
    decision,
    status: decision,
    staffConfirmation: persisted.staffConfirmation || candidate?.staffIdentityConfirmation || null,
  };
  if (!isIdentityAuthoritySatisfied({ candidate, identityEvidence })) return null;
  return String(decision).toLowerCase() === 'probable' ? 'probable' : 'confirmed';
}

function candidateWithAuthoritativeIdentity(candidate, identityStatus) {
  const previous = candidate?.contactEnrichment && typeof candidate.contactEnrichment === 'object'
    ? candidate.contactEnrichment
    : {};
  const previousIdentity = previous.identity && typeof previous.identity === 'object'
    ? previous.identity
    : {};
  // `projectReviewerContact` predates receipt-backed identity. Normalize a
  // short-lived projection rather than mutating the server candidate blob.
  return {
    ...candidate,
    identityStatus,
    contactEnrichment: {
      ...previous,
      identity: { ...previousIdentity, status: identityStatus },
    },
  };
}

function patch({ status, reason = null, email = null, source = null, evidence = null } = {}) {
  return {
    addressTrustStatus: status,
    addressTrustReason: cleanString(reason, 240),
    addressTrustEmail: normalizeAddress(email),
    addressTrustSource: cleanString(source, 80),
    addressTrustEvidence: evidence || null,
  };
}

/**
 * Project current address trust from server-loaded contact/person state only.
 * `linkedPerson` is intentionally a server service input, never a client DTO.
 */
export async function produceAddressTrustEvidence({
  candidate,
  linkedPerson = null,
  canonicalPerson = null,
  sourceVersion,
  expectedSourceVersion = null,
  signal,
  deadlineAt,
  now = () => new Date().toISOString(),
} = {}) {
  const authoritativeSource = authoritativeSourceVersion(expectedSourceVersion);
  if (!validSourceVersion(authoritativeSource)) {
    return stageEnvelope({ outcome: 'failed', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }
  throwIfAborted(signal, deadlineAt);
  const identityStatus = trustedIdentityStatus(candidate);
  if (!identityStatus) {
    return stageEnvelope({
      outcome: 'not_applicable',
      sourceVersion: authoritativeSource,
      reasonCode: 'identity_not_authoritative',
      evidencePatch: patch({ status: 'not_applicable', reason: 'identity_not_authoritative' }),
      now,
    });
  }
  const contact = projectReviewerContact(candidateWithAuthoritativeIdentity(candidate, identityStatus));
  if (contact?.decision === 'missing_email') {
    return stageEnvelope({
      outcome: 'not_applicable',
      sourceVersion: authoritativeSource,
      reasonCode: 'missing_email',
      evidencePatch: patch({ status: 'not_applicable', reason: 'missing_email' }),
      now,
    });
  }
  if (contact?.decision !== 'ready' || !normalizeAddress(contact.email)) {
    return stageEnvelope({ outcome: 'incomplete', sourceVersion: authoritativeSource, failureCode: 'missing_required_input', now });
  }

  const email = normalizeAddress(contact.email);
  const source = contact.emailSource;
  const personTrust = linkedPerson && typeof linkedPerson === 'object'
    ? addressTrustDecision(linkedPerson)
    : null;
  if (personTrust?.status === 'conflict_pending') {
    return stageEnvelope({
      outcome: 'incomplete',
      sourceVersion: authoritativeSource,
      evidencePatch: patch({ status: 'conflict_pending', reason: personTrust.reason, email, source }),
      failureCode: 'partial_coverage',
      now,
    });
  }
  if (personTrust?.status === 'staff_verified') {
    const storedEmail = normalizeAddress(linkedPerson?.wmkf_emailaddress ?? linkedPerson?.email);
    if (storedEmail !== email) {
      return stageEnvelope({
        outcome: 'incomplete',
        sourceVersion: authoritativeSource,
        evidencePatch: patch({ status: 'address_mismatch', reason: 'linked_person_address_mismatch', email, source }),
        failureCode: 'partial_coverage',
        now,
      });
    }
    const evidence = staffVerifiedEvidence(canonicalPerson, personTrust);
    if (!evidence) {
      return stageEnvelope({
        outcome: 'incomplete',
        sourceVersion: authoritativeSource,
        evidencePatch: patch({ status: 'staff_verified', reason: 'staff_authority_unavailable', email, source: 'staff_verified' }),
        failureCode: 'missing_required_input',
        now,
      });
    }
    return stageEnvelope({
      outcome: 'current',
      sourceVersion: authoritativeSource,
      evidencePatch: patch({
        status: 'staff_verified',
        email,
        source: 'staff_verified',
        evidence,
      }),
      now,
    });
  }

  const readiness = emailConfidence({ email, emailSource: source });
  if (readiness.action === 'ready' || readiness.action === 'quick_check') {
    return stageEnvelope({
      outcome: 'current',
      sourceVersion: authoritativeSource,
      evidencePatch: patch({ status: readiness.action, reason: readiness.reason, email, source }),
      now,
    });
  }
  if (readiness.action === 'research_only') {
    return stageEnvelope({
      outcome: 'incomplete',
      sourceVersion: authoritativeSource,
      evidencePatch: patch({ status: 'research_only', reason: readiness.reason, email, source }),
      failureCode: 'missing_required_input',
      now,
    });
  }
  return stageEnvelope({
    outcome: 'incomplete',
    sourceVersion: authoritativeSource,
    evidencePatch: patch({ status: 'blocked', reason: readiness.reason, email, source }),
    failureCode: 'missing_required_input',
    now,
  });
}

// Cold emission is exactly the same deterministic server projection as the
// manual path. It accepts only the already-reconciled server person bundle and
// therefore never calls an address provider or turns browser acknowledgement
// into address authority.
export async function projectColdAddressTrustEvidence(input = {}) {
  return produceAddressTrustEvidence(input);
}

export const ADDRESS_TRUST_EVIDENCE_PATCH_KEYS = Object.freeze([
  'addressTrustStatus', 'addressTrustReason', 'addressTrustEmail',
  'addressTrustSource', 'addressTrustEvidence',
]);
