/**
 * Short-lived bridge until the durable reviewer binding contract exists.
 *
 * `/enrich-contacts` signs the identity-bearing fields it computed on the
 * server. `save-candidates` verifies the receipt before allowing those fields
 * to loosen persistence gates. The browser may carry the receipt, but cannot
 * alter the bound identity bundle or mint a replacement.
 */

import crypto from 'crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { reviewerSaveKey } from '../utils/reviewer-save-key';

const ALG = 'HS256';
const TYP = 'reviewer-auto-identity';
const TTL_SECONDS = 14 * 24 * 60 * 60;
const CLOCK_TOLERANCE = '30s';

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

export function identityAttestationProjection(candidate = {}) {
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

function digestProjection(candidate) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(identityAttestationProjection(candidate)))
    .digest('base64url');
}

export async function mintAutomatedIdentityAttestation({ requestId, candidate }) {
  const candidateKey = identityAttestationProjection(candidate).candidateKey;
  if (!requestId || !candidateKey) throw new Error('requestId and candidate key are required');
  const token = await new SignJWT({
    typ: TYP,
    requestId,
    candidateKey,
    identityDigest: digestProjection(candidate),
  })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    .sign(getSecret());
  return token;
}

export async function verifyAutomatedIdentityAttestation(token, { requestId, candidate }) {
  if (typeof token !== 'string' || !token) return { valid: false, reason: 'no_token' };
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
      clockTolerance: CLOCK_TOLERANCE,
    });
    const candidateKey = identityAttestationProjection(candidate).candidateKey;
    if (
      payload.typ !== TYP
      || payload.requestId !== requestId
      || payload.candidateKey !== candidateKey
      || payload.identityDigest !== digestProjection(candidate)
    ) {
      return { valid: false, reason: 'claim_mismatch' };
    }
    return { valid: true, source: 'automated_resolver' };
  } catch (error) {
    let reason = 'malformed';
    if (error instanceof joseErrors.JWTExpired) reason = 'expired';
    else if (
      error instanceof joseErrors.JWSSignatureVerificationFailed
      || error instanceof joseErrors.JOSEAlgNotAllowed
    ) reason = 'invalid_signature';
    return { valid: false, reason };
  }
}

export { TTL_SECONDS };
