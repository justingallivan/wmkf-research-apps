/**
 * Server binding for the dormant reviewer institution Phase 2 evidence bundle.
 *
 * Discovery may return this bounded projection through the browser, but the
 * roster accepts it only when the request/candidate-bound JWT verifies. The
 * stored receipt is a compact digest used after reload; it never grants person,
 * selection, or Dataverse-write authority by itself.
 */

import crypto from 'crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { reviewerCandidateKey } from '../utils/reviewer-candidate-key';

const ALG = 'HS256';
const TYP = 'reviewer-institution-evidence';
const PROJECTION_VERSION = 1;
const TTL_SECONDS = 14 * 24 * 60 * 60;
const CLOCK_TOLERANCE = '30s';
const MAX_ASSERTIONS = 24;

const IDENTITY_RESULTS = new Set(['sufficient', 'insufficient', 'contradicted', 'not_evaluable']);
const IDENTITY_METHODS = new Set([
  'pubmed_multi_work_author',
  'exact_work_unique_author',
  'forename_work_grounding',
  'hard_id_join',
]);
const PROVIDER_STATES = new Set(['complete', 'partial', 'failed']);
const SOURCE_TYPES = new Set([
  'publication',
  'orcid_employment',
  'official_profile',
  'applicant_record',
  'staff_record',
  'reviewer_self_report',
]);
const CURRENTNESS = new Set(['current', 'historical', 'unknown']);

export const REVIEWER_INSTITUTION_PHASE2_FLAG = 'REVIEWER_INSTITUTION_PHASE2';

export function reviewerInstitutionPhase2Enabled(env = process.env) {
  return env?.[REVIEWER_INSTITUTION_PHASE2_FLAG] === 'on';
}

function getSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('NEXTAUTH_SECRET missing/too short — cannot sign reviewer institution evidence');
  }
  return new TextEncoder().encode(secret);
}

function text(value, max) {
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  return normalized ? normalized.slice(0, max) : null;
}

function integer(value, min, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

function validIso(value) {
  const normalized = text(value, 80);
  return normalized && Number.isFinite(Date.parse(normalized))
    ? new Date(Date.parse(normalized)).toISOString()
    : null;
}

export function projectIndependentIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const evaluatedAt = validIso(value.evaluatedAt);
  const providerObservedAt = validIso(value.providerObservedAt);
  const expiresAt = validIso(value.expiresAt);
  const requestBinding = text(value.requestBinding, 160);
  const candidateKey = text(value.candidateKey, 200);
  const identityInputDigest = text(value.identityInputDigest, 128);
  const evidenceDigest = text(value.evidenceDigest, 128);
  const resolverVersion = text(value.resolverVersion, 100);
  const reason = text(value.reason, 160);
  const valid = value.version === 'independent-identity/v1'
    && IDENTITY_RESULTS.has(value.result)
    && value.excludesAffiliation === true
    && IDENTITY_METHODS.has(value.method)
    && PROVIDER_STATES.has(value.providerState)
    && requestBinding
    && candidateKey
    && identityInputDigest
    && evidenceDigest
    && resolverVersion
    && reason
    && evaluatedAt
    && providerObservedAt
    && expiresAt
    && Date.parse(providerObservedAt) <= Date.parse(evaluatedAt) + (5 * 60 * 1000)
    && Date.parse(expiresAt) > Date.parse(evaluatedAt)
    && Date.parse(expiresAt) <= Date.parse(providerObservedAt) + (TTL_SECONDS * 1000);
  if (!valid) return null;
  return {
    version: 'independent-identity/v1',
    result: value.result,
    reason,
    excludesAffiliation: true,
    method: value.method,
    resolverVersion,
    requestBinding,
    candidateKey,
    identityInputDigest,
    evidenceDigest,
    evaluatedAt,
    providerObservedAt,
    expiresAt,
    providerState: value.providerState,
  };
}

export function projectAffiliationAssertions(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, MAX_ASSERTIONS).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const rawText = text(value.rawText, 1000);
    const sourceReference = text(value.sourceReference, 500);
    const observedAt = value.observedAt == null ? null : validIso(value.observedAt);
    const publicationYear = value.publicationYear == null
      ? null
      : integer(value.publicationYear, 1800, 2200);
    const startYear = value.startYear == null ? null : integer(value.startYear, 1800, 2200);
    const endYear = value.endYear == null ? null : integer(value.endYear, 1800, 2200);
    const ror = text(value.ror, 200);
    const openAlexId = text(value.openAlexId, 200);
    if (!rawText
      || !SOURCE_TYPES.has(value.sourceType)
      || !CURRENTNESS.has(value.currentness)
      || ![true, false, 'unknown'].includes(value.authorSpecific)
      || (value.observedAt != null && !observedAt)
      || (value.publicationYear != null && publicationYear == null)
      || (value.startYear != null && startYear == null)
      || (value.endYear != null && endYear == null)
      || (startYear != null && endYear != null && endYear < startYear)) return [];
    return [{
      rawText,
      sourceType: value.sourceType,
      sourceReference,
      observedAt,
      currentness: value.currentness,
      authorSpecific: value.authorSpecific,
      publicationYear,
      startYear,
      endYear,
      ror,
      openAlexId,
    }];
  });
}

export function institutionEvidenceProjection(candidate = {}) {
  const sourceAssertions = Array.isArray(candidate.affiliationAssertions)
    ? candidate.affiliationAssertions
    : [];
  return {
    candidateKey: reviewerCandidateKey(candidate),
    independentIdentity: projectIndependentIdentity(candidate.independentIdentity),
    affiliationAssertions: projectAffiliationAssertions(sourceAssertions),
    affiliationAssertionsComplete: candidate.affiliationAssertionsComplete !== false
      && sourceAssertions.length <= MAX_ASSERTIONS,
  };
}

function hasEvidence(projection) {
  return !!projection?.independentIdentity || projection?.affiliationAssertions?.length > 0;
}

function identityMatchesBinding(projection, requestId) {
  const identity = projection?.independentIdentity;
  return !identity || (
    identity.requestBinding === requestId
    && identity.candidateKey === projection.candidateKey
  );
}

export async function mintInstitutionEvidenceAttestation({ requestId, candidate }) {
  const projection = institutionEvidenceProjection(candidate);
  if (!requestId
    || !projection.candidateKey
    || !hasEvidence(projection)
    || !identityMatchesBinding(projection, requestId)) return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const identityExpiry = projection.independentIdentity
    ? Math.floor(Date.parse(projection.independentIdentity.expiresAt) / 1000)
    : nowSeconds + TTL_SECONDS;
  const expiry = Math.min(nowSeconds + TTL_SECONDS, identityExpiry);
  if (!Number.isFinite(expiry) || expiry <= nowSeconds) return null;
  return new SignJWT({
    typ: TYP,
    projectionVersion: PROJECTION_VERSION,
    requestId,
    candidateKey: projection.candidateKey,
    evidenceDigest: digest(projection),
  })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiry)
    .sign(getSecret());
}

export async function verifyInstitutionEvidenceAttestation(token, { requestId, candidate }) {
  if (typeof token !== 'string' || !token) return { valid: false, reason: 'no_token' };
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
      clockTolerance: CLOCK_TOLERANCE,
    });
    const projection = institutionEvidenceProjection(candidate);
    if (payload.typ !== TYP
      || payload.projectionVersion !== PROJECTION_VERSION
      || payload.requestId !== requestId
      || !projection.candidateKey
      || payload.candidateKey !== projection.candidateKey
      || typeof payload.evidenceDigest !== 'string'
      || payload.evidenceDigest !== digest(projection)
      || !hasEvidence(projection)
      || !identityMatchesBinding(projection, requestId)) {
      return { valid: false, reason: 'claim_mismatch' };
    }
    return {
      valid: true,
      source: 'server_institution_evidence',
      candidateKey: projection.candidateKey,
      independentIdentityBound: !!projection.independentIdentity,
      affiliationAssertionsBound: projection.affiliationAssertions.length > 0,
      affiliationAssertionsComplete: projection.affiliationAssertionsComplete,
      projectionVersion: PROJECTION_VERSION,
      expiresAt: new Date(Number(payload.exp) * 1000).toISOString(),
    };
  } catch (error) {
    let reason = 'malformed';
    if (error instanceof joseErrors.JWTExpired) reason = 'expired';
    else if (error instanceof joseErrors.JWSSignatureVerificationFailed
      || error instanceof joseErrors.JOSEAlgNotAllowed) reason = 'invalid_signature';
    return { valid: false, reason };
  }
}

export function createServerInstitutionEvidenceReceipt({ requestId, candidate, expiresAt }) {
  const projection = institutionEvidenceProjection(candidate);
  const normalizedRequestId = text(requestId, 160);
  const suppliedExpiry = validIso(expiresAt);
  const identityExpiry = projection.independentIdentity?.expiresAt || null;
  const normalizedExpiry = suppliedExpiry && identityExpiry
    ? new Date(Math.min(Date.parse(suppliedExpiry), Date.parse(identityExpiry))).toISOString()
    : (suppliedExpiry || identityExpiry);
  if (!normalizedRequestId
    || !projection.candidateKey
    || !hasEvidence(projection)
    || !identityMatchesBinding(projection, normalizedRequestId)
    || !normalizedExpiry) {
    return null;
  }
  return {
    version: 1,
    source: 'server_institution_evidence',
    requestBinding: normalizedRequestId,
    candidateKey: projection.candidateKey,
    evidenceDigest: digest({ requestId: normalizedRequestId, projection }),
    expiresAt: normalizedExpiry,
  };
}

export function hasServerInstitutionEvidenceReceipt({ requestId, candidate, now = Date.now() }) {
  const receipt = candidate?.serverInstitutionEvidenceReceipt;
  if (receipt?.version !== 1
    || receipt.source !== 'server_institution_evidence'
    || receipt.requestBinding !== requestId
    || receipt.candidateKey !== reviewerCandidateKey(candidate)
    || !validIso(receipt.expiresAt)
    || Date.parse(receipt.expiresAt) <= new Date(now).getTime()) return false;
  const expected = createServerInstitutionEvidenceReceipt({
    requestId,
    candidate,
    expiresAt: receipt.expiresAt,
  });
  return !!expected && receipt.evidenceDigest === expected.evidenceDigest;
}

export { MAX_ASSERTIONS, PROJECTION_VERSION, TTL_SECONDS };
