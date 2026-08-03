/**
 * Short-lived bridge until the durable reviewer binding contract exists.
 *
 * `/enrich-contacts` signs the identity-bearing fields it computed on the
 * server. `save-candidates` verifies the receipt before allowing those fields
 * to loosen persistence gates. New receipts use projection v4; v3/v4 are
 * contact-authoritative when their canonical contact projection is ready and
 * matches, while v4 additionally binds `eligibilityCheckStatus`. v1/v2 remain
 * verifiable against their historical projections but are never
 * contact-authoritative. The browser may carry the receipt, but cannot alter
 * the bound bundle or mint a replacement.
 */

import crypto from 'crypto';
import { SignJWT, jwtVerify, compactVerify, errors as joseErrors } from 'jose';
import { reviewerSaveKey } from '../utils/reviewer-save-key';
import { projectReviewerContact } from '../utils/reviewer-vetted-email';

const ALG = 'HS256';
const TYP = 'reviewer-auto-identity';
const TTL_SECONDS = 14 * 24 * 60 * 60;
const CLOCK_TOLERANCE = '30s';
const PROJECTION_VERSION = 4;
const ACCEPTED_PROJECTION_VERSIONS = new Set([1, 2, 3, 4]);
const CONTACT_BOUND_PROJECTION_VERSION = 3;
// A signed resolver receipt is short lived for mutations.  A separately
// scoped warm-read compatibility projection may use the same signed evidence
// for up to six months; it never grants promotion authority.
const HISTORICAL_SELECTION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

function getSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('NEXTAUTH_SECRET missing/too short — cannot sign reviewer identity receipt');
  }
  return new TextEncoder().encode(secret);
}

function value(value) {
  return value === undefined || value === '' ? null : value;
}

function legacyIdentityAttestationProjection(candidate = {}) {
  const enrichment = candidate.contactEnrichment && typeof candidate.contactEnrichment === 'object'
    ? candidate.contactEnrichment
    : {};
  const identityStatus = value(enrichment.identity?.status || candidate.identityStatus);
  const statusAllowsIdentity = identityStatus === 'confirmed' || identityStatus === 'probable';
  const identityPersistAllowed = candidate.identityPersistAllowed === false
    || enrichment.identityPersistAllowed === false
    ? false
    : statusAllowsIdentity;
  const scholarPersistAllowed = candidate.scholarPersistAllowed === false
    || enrichment.scholarPersistAllowed === false
    || enrichment.tierResults?.openalex_author?.skipped
    ? false
    : identityPersistAllowed;
  // Enrichment is promoted to top-level by the browser before save. Compute the
  // receipt key from that effective shape now so a current-affiliation/email
  // promotion verifies identically before and after the client merge/reload.
  const effectiveCandidate = {
    ...candidate,
    email: enrichment.email || candidate.email,
    affiliation: enrichment.affiliation || candidate.affiliation,
    orcid: enrichment.orcid || enrichment.orcidId || candidate.orcid,
  };
  return {
    candidateKey: reviewerSaveKey(effectiveCandidate),
    identityStatus,
    identityPersistAllowed,
    scholarPersistAllowed,
    orcid: value(candidate.orcid || enrichment.orcidId || enrichment.orcid),
    orcidUrl: value(candidate.orcidUrl || enrichment.orcidUrl),
    googleScholarId: value(candidate.googleScholarId || enrichment.googleScholarId),
    googleScholarUrl: value(candidate.googleScholarUrl || enrichment.googleScholarUrl),
    hIndex: value(candidate.hIndex ?? enrichment.hIndex),
    i10Index: value(candidate.i10Index ?? enrichment.i10Index),
    totalCitations: value(candidate.totalCitations ?? enrichment.totalCitations),
  };
}

function identityDecisionProjection(candidate = {}) {
  const identity = candidate.contactEnrichment?.identity;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null;
  return {
    status: value(identity.status),
    confidenceBand: value(identity.confidenceBand),
    resolverVersion: value(identity.resolverVersion),
    resolvedAt: value(identity.resolvedAt),
    evidenceSummary: value(identity.evidenceSummary),
    anchors: Array.isArray(identity.anchors)
      ? identity.anchors.map((anchor) => ({
          type: value(anchor?.type),
          canonicalKey: value(anchor?.canonicalKey),
          sourceUrl: value(anchor?.sourceUrl),
          verifier: value(anchor?.verifier),
        }))
      : null,
  };
}

export function identityAttestationProjection(candidate = {}) {
  return {
    ...legacyIdentityAttestationProjection(candidate),
    identityDecision: identityDecisionProjection(candidate),
  };
}

function identityDecisionReceiptProjection(candidate = {}) {
  const enrichment = candidate?.contactEnrichment || {};
  const name = typeof candidate?.name === 'string'
    ? candidate.name.trim().toLowerCase()
    : null;
  return {
    name: name || null,
    orcid: value(enrichment.orcidId || enrichment.orcid || candidate?.orcid),
    identityDecision: identityDecisionProjection(candidate),
  };
}

/**
 * Persistable server receipt proving that the current compact roster identity
 * decision was accepted from a valid automated-resolver attestation. The
 * roster route strips client copies before creating or preserving this value;
 * consumers must still compare its canonical identity-only digest to the current
 * row. Email/affiliation are deliberately excluded: address adjudication may
 * change them without changing which person the resolver identified.
 */
export function createServerIdentityDecisionReceipt(candidate = {}) {
  const projection = identityDecisionReceiptProjection(candidate);
  if (!projection.identityDecision) return null;
  return {
    version: 1,
    source: 'automated_resolver',
    identityDigest: digest(projection),
  };
}

export function hasServerIdentityDecisionReceipt(candidate = {}) {
  const receipt = candidate?.serverIdentityDecisionReceipt;
  if (receipt?.version !== 1 || receipt.source !== 'automated_resolver') return false;
  return typeof receipt.identityDigest === 'string'
    && receipt.identityDigest === digest(identityDecisionReceiptProjection(candidate));
}

export function contactAttestationProjection(candidate = {}) {
  return projectReviewerContact(candidate);
}

function identityProjectionForVersion(candidate, projectionVersion) {
  return projectionVersion === 1
    ? legacyIdentityAttestationProjection(candidate)
    : identityAttestationProjection(candidate);
}

function digest(valueToDigest) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(valueToDigest))
    .digest('base64url');
}

function identityDigest(candidate, projectionVersion) {
  return digest(identityProjectionForVersion(candidate, projectionVersion));
}

function contactDigest(candidate) {
  return digest(contactAttestationProjection(candidate));
}

function eligibilityProjection(candidate = {}, { includeCheckStatus = true } = {}) {
  const enrichment = candidate.contactEnrichment && typeof candidate.contactEnrichment === 'object'
    ? candidate.contactEnrichment
    : {};
  const evidence = candidate.eligibilityEvidence || enrichment.eligibilityEvidence;
  return {
    status: value(candidate.eligibilityStatus || enrichment.eligibilityStatus || 'unknown'),
    ...(includeCheckStatus
      ? { checkStatus: value(candidate.eligibilityCheckStatus || enrichment.eligibilityCheckStatus) }
      : {}),
    reason: value(candidate.eligibilityReason || enrichment.eligibilityReason),
    evidence: evidence && typeof evidence === 'object' && !Array.isArray(evidence)
      ? {
        status: value(evidence.status),
        url: value(evidence.url),
        title: value(evidence.title),
        snippet: value(evidence.snippet),
        sourceDomain: value(evidence.sourceDomain),
        checkedAt: value(evidence.checkedAt),
      }
      : null,
  };
}

function eligibilityDigest(candidate, projectionVersion = PROJECTION_VERSION) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(eligibilityProjection(candidate, {
      includeCheckStatus: projectionVersion >= 4,
    })))
    .digest('base64url');
}

export async function mintAutomatedIdentityAttestation({ requestId, candidate }) {
  const candidateKey = identityAttestationProjection(candidate).candidateKey;
  if (!requestId || !candidateKey) throw new Error('requestId and candidate key are required');
  const rosterCandidateKey = typeof candidate?.candidateKey === 'string'
    ? candidate.candidateKey.trim()
    : '';
  const eligibilityStatus = candidate?.eligibilityStatus
    || candidate?.contactEnrichment?.eligibilityStatus
    || 'unknown';
  const eligibilityCheckStatus = candidate?.eligibilityCheckStatus
    || candidate?.contactEnrichment?.eligibilityCheckStatus
    || null;
  const token = await new SignJWT({
    typ: TYP,
    requestId,
    candidateKey,
    projectionVersion: PROJECTION_VERSION,
    baseIdentityDigest: identityDigest(candidate, 1),
    identityDigest: identityDigest(candidate, 2),
    contactDigest: contactDigest(candidate),
    eligibilityStatus,
    eligibilityCheckStatus,
    eligibilityDigest: eligibilityDigest(candidate, PROJECTION_VERSION),
    ...(rosterCandidateKey ? { rosterCandidateKey } : {}),
  })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    .sign(getSecret());
  return token;
}

function verifiedAttestationClaims({ payload, protectedHeader, requestId, candidate, requireProtectedTyp = false }) {
  const projectionVersion = payload.projectionVersion === undefined
    ? 1
    : Number(payload.projectionVersion);
  const candidateKey = identityAttestationProjection(candidate).candidateKey;
  const candidateRosterKey = typeof candidate?.candidateKey === 'string'
    ? candidate.candidateKey.trim()
    : '';
  const rosterKeyMatches = payload.rosterCandidateKey === undefined
    || payload.rosterCandidateKey === candidateRosterKey;
  const eligibilityDigestMatches = payload.eligibilityDigest === undefined
    || payload.eligibilityDigest === eligibilityDigest(candidate, projectionVersion);
  const fullDigestMatches = payload.identityDigest === identityDigest(
    candidate,
    projectionVersion === 1 ? 1 : 2,
  );
  const identityDecisionMissing = identityDecisionProjection(candidate) === null;
  const baseDigestMatches = projectionVersion >= 2
    && identityDecisionMissing
    && payload.baseIdentityDigest === identityDigest(candidate, 1);
  const contactDigestMatches = projectionVersion < CONTACT_BOUND_PROJECTION_VERSION
    || payload.contactDigest === contactDigest(candidate);
  if (
    (requireProtectedTyp && (protectedHeader?.alg !== ALG || protectedHeader?.typ !== 'JWT'))
    || payload.typ !== TYP
    || payload.requestId !== requestId
    || payload.candidateKey !== candidateKey
    || !rosterKeyMatches
    || !eligibilityDigestMatches
    || !ACCEPTED_PROJECTION_VERSIONS.has(projectionVersion)
    || !contactDigestMatches
    || (!fullDigestMatches && !baseDigestMatches)
  ) {
    return { valid: false, reason: 'claim_mismatch' };
  }
  const eligibilityStatus = ['deceased', 'emeritus', 'unknown'].includes(payload.eligibilityStatus)
    ? payload.eligibilityStatus
    : null;
  const eligibilityCheckStatus = ['complete', 'not_applicable', 'pending', 'incomplete', 'error']
    .includes(payload.eligibilityCheckStatus)
    ? payload.eligibilityCheckStatus
    : null;
  return {
    valid: true,
    source: 'automated_resolver',
    ...(eligibilityStatus ? { eligibilityStatus } : {}),
    ...(eligibilityCheckStatus ? { eligibilityCheckStatus } : {}),
    ...(typeof payload.rosterCandidateKey === 'string' && payload.rosterCandidateKey
      ? { rosterCandidateKey: payload.rosterCandidateKey }
      : {}),
    eligibilityEvidenceBound: payload.eligibilityDigest !== undefined
      && eligibilityDigestMatches,
    identityDecisionBound:
      projectionVersion >= 2 && fullDigestMatches,
    contactAuthorityBound:
      projectionVersion >= CONTACT_BOUND_PROJECTION_VERSION
      && contactDigestMatches
      && contactAttestationProjection(candidate)?.decision === 'ready',
    projectionVersion,
  };
}

function attestationFailure(error) {
    let reason = 'malformed';
    if (error instanceof joseErrors.JWTExpired) reason = 'expired';
    else if (error instanceof joseErrors.JWSSignatureVerificationFailed) reason = 'invalid_signature';
    else if (error instanceof joseErrors.JOSEAlgNotAllowed) reason = 'invalid_algorithm';
    return { valid: false, reason };
}

export async function verifyAutomatedIdentityAttestation(token, { requestId, candidate }) {
  if (typeof token !== 'string' || !token) return { valid: false, reason: 'no_token' };
  try {
    const { payload, protectedHeader } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
      clockTolerance: CLOCK_TOLERANCE,
    });
    return verifiedAttestationClaims({ payload, protectedHeader, requestId, candidate });
  } catch (error) {
    return attestationFailure(error);
  }
}

/**
 * Read-only compatibility verifier for a signed historical resolver result.
 *
 * This intentionally does not relax the normal attestation verifier used by
 * mutations: JWT expiration remains mandatory there. Here `compactVerify`
 * verifies the signature before parsing any claims; the explicit issued-at
 * bound below replaces expiration only for this selection-only projection.
 */
export async function verifyHistoricalAutomatedIdentitySelection(token, { requestId, candidate, now = Date.now() }) {
  if (typeof token !== 'string' || !token) return { valid: false, reason: 'no_token' };
  try {
    const { payload: verifiedPayload, protectedHeader } = await compactVerify(token, getSecret(), {
      algorithms: [ALG],
    });
    const payload = JSON.parse(new TextDecoder().decode(verifiedPayload));
    const issuedAtSeconds = payload?.iat;
    const issuedAtMs = Number.isInteger(issuedAtSeconds) ? issuedAtSeconds * 1000 : NaN;
    if (!Number.isFinite(issuedAtMs) || issuedAtMs > now + 30_000) {
      return { valid: false, reason: 'invalid_issued_at' };
    }
    if (now - issuedAtMs > HISTORICAL_SELECTION_MAX_AGE_SECONDS * 1000) {
      return { valid: false, reason: 'historical_evidence_stale' };
    }
    const verified = verifiedAttestationClaims({
      payload,
      protectedHeader,
      requestId,
      candidate,
      requireProtectedTyp: true,
    });
    if (!verified.valid) return verified;
    const projectionVersion = verified.projectionVersion;
    const candidateRosterKey = typeof candidate?.candidateKey === 'string'
      ? candidate.candidateKey.trim()
      : '';
    if (
      projectionVersion < 2
      || !candidateRosterKey
      || verified.rosterCandidateKey !== candidateRosterKey
      || !verified.identityDecisionBound
      || !verified.eligibilityEvidenceBound
      || (projectionVersion >= CONTACT_BOUND_PROJECTION_VERSION && !verified.contactAuthorityBound)
    ) {
      return { valid: false, reason: 'selection_claims_insufficient' };
    }
    return {
      ...verified,
      historicalSelection: true,
      issuedAt: new Date(issuedAtMs).toISOString(),
    };
  } catch (error) {
    return attestationFailure(error);
  }
}

export {
  PROJECTION_VERSION,
  TTL_SECONDS,
  HISTORICAL_SELECTION_MAX_AGE_SECONDS,
  ACCEPTED_PROJECTION_VERSIONS,
  legacyIdentityAttestationProjection,
};
