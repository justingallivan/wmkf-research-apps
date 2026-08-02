/**
 * Opaque, short-lived authority handoffs for the explicit Reviewer Find cold
 * search.  Browser state may carry these tokens between streamed endpoints,
 * but no browser field is itself proposal or candidate authority.
 */

import { createHash } from 'crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import {
  normalizeProposalAuthors,
  proposalAuthorFingerprint,
} from '../reviewer-proposal-author-fingerprint';

const ALG = 'HS256';
const LOAD_TYP = 'reviewer-find-proposal-load:v1';
const ANALYSIS_TYP = 'reviewer-find-analysis:v1';
const DISCOVERY_TYP = 'reviewer-find-discovery-candidate:v1';
const TTL_SECONDS = 15 * 60;
const CLOCK_TOLERANCE = '30s';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_CANDIDATE_KEY = /^(?:suggestion|person|orcid|openalex|scholar|seed):[^\s:]{1,512}$/;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

function getSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('NEXTAUTH_SECRET missing/too short — cannot sign reviewer search authority');
  }
  return new TextEncoder().encode(secret);
}

function text(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function requestId(value) {
  const result = text(value, 64);
  return result && GUID_RE.test(result) ? result.toLowerCase() : null;
}

function bindingKey(value) {
  const result = text(value, 1024);
  if (!result) return null;
  const parts = result.split('::');
  return parts.length === 3 && parts.every((part) => text(part, 768)) ? result : null;
}

function blobUrl(value) {
  const result = text(value, 2048);
  if (!result) return null;
  try {
    const url = new URL(result);
    return url.protocol === 'https:' && !url.username && !url.password ? result : null;
  } catch {
    return null;
  }
}

function contentVersion(value) {
  const result = text(value, 160);
  return result && /^[a-f0-9]{64}$/i.test(result) ? result.toLowerCase() : null;
}

export { normalizeProposalAuthors };

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Candidate-attestation verification is reachable with a browser candidate
// DTO. Bound the exact digest projection before hashing it so a malformed
// candidate cannot turn signature verification into unbounded JSON work.
function boundedValue(value, depth = 0, budget = { entries: 0 }) {
  if (depth > 5) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.normalize('NFKC').trim();
    return normalized.length <= 1024 ? normalized : null;
  }
  if (Array.isArray(value)) {
    if (value.length > 16) return null;
    const result = [];
    for (const entry of value) {
      const bounded = boundedValue(entry, depth + 1, budget);
      if (bounded === null && entry !== null) return null;
      result.push(bounded);
    }
    return result;
  }
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 32) return null;
  const result = {};
  for (const [key, entry] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)) return null;
    budget.entries += 1;
    if (budget.entries > 96) return null;
    const bounded = boundedValue(entry, depth + 1, budget);
    if (bounded === null && entry !== null) return null;
    result[key] = bounded;
  }
  return result;
}

function digest(namespace, value) {
  return createHash('sha256')
    .update(`${namespace}\n${stableStringify(value)}`)
    .digest('hex');
}

export function proposalContentVersionForMetadata(request, metadata) {
  const id = requestId(request);
  if (!id || !metadata || typeof metadata !== 'object') return null;
  const driveId = text(metadata.driveId, 512);
  const itemId = text(metadata.id, 512);
  const eTag = text(metadata.eTag, 1024);
  const versionId = text(metadata.versionId, 1024);
  const lastModified = text(metadata.lastModified, 1024);
  if (!driveId || !itemId || !(eTag || versionId || lastModified)) return null;
  return digest('reviewer-warm-proposal-content:v1', {
    requestId: id,
    driveId,
    itemId,
    eTag,
    versionId,
    lastModified,
  });
}

export function parseProposalBindingKey(value) {
  const key = bindingKey(value);
  if (!key) return null;
  const [library, folder, filename] = key.split('::');
  return { bindingKey: key, library, folder, filename };
}

function candidateProjection(candidate = {}) {
  const key = text(candidate?.candidateKey, 560);
  if (!key || !CANONICAL_CANDIDATE_KEY.test(key)) return null;
  const name = text(candidate?.name, 240);
  if (!name) return null;
  const provenance = candidate?.provenance && typeof candidate.provenance === 'object'
    ? candidate.provenance
    : {};
  return {
    candidateKey: key,
    name,
    affiliation: text(candidate?.affiliation || candidate?.primaryAffiliation, 320),
    suggestionId: text(candidate?.suggestionId, 80),
    potentialReviewerId: text(candidate?.potentialReviewerId || candidate?.seedResolvedPotentialReviewerId, 80),
    orcid: text(candidate?.orcid, 80),
    openAlexAuthorId: text(candidate?.openAlexAuthorId || candidate?.openAlexId, 80),
    provenanceKind: text(provenance.kind, 80),
  };
}

function candidateEvidenceProjection(candidate = {}) {
  return boundedValue({
    identity: candidate?.identityEvidence && typeof candidate.identityEvidence === 'object'
      ? candidate.identityEvidence
      : candidate?.contactEnrichment?.identity || null,
    identityDecision: text(candidate?.identityDecision || candidate?.identityStatus, 80),
    hasInstitutionCOI: candidate?.hasInstitutionCOI === true,
    institutionCOIDetails: candidate?.institutionCOIDetails || null,
    coauthorCheckStatus: text(candidate?.coauthorCheckStatus, 80),
    hasCoauthorCOI: candidate?.hasCoauthorCOI === true,
    coauthorships: Array.isArray(candidate?.coauthorships) ? candidate.coauthorships : [],
    coauthorCheckFailures: Array.isArray(candidate?.coauthorCheckFailures) ? candidate.coauthorCheckFailures : [],
    coauthorSharedPaperTotal: Number.isSafeInteger(candidate?.coauthorSharedPaperTotal)
      ? candidate.coauthorSharedPaperTotal
      : null,
    coauthorMaxWithOneAuthor: Number.isSafeInteger(candidate?.coauthorMaxWithOneAuthor)
      ? candidate.coauthorMaxWithOneAuthor
      : null,
  });
}

function analysisClaims({ requestId: rawRequestId, proposalContentVersion, bindingKey: rawBindingKey, blobUrl: rawBlobUrl, proposalAuthors }) {
  const req = requestId(rawRequestId);
  const version = contentVersion(proposalContentVersion);
  const binding = bindingKey(rawBindingKey);
  const blob = blobUrl(rawBlobUrl);
  if (!req || !version || !binding || !blob) return null;
  const authors = normalizeProposalAuthors(proposalAuthors);
  const proposalAuthorVersion = proposalAuthorFingerprint(version, authors);
  if (!proposalAuthorVersion) return null;
  return {
    requestId: req,
    proposalContentVersion: version,
    bindingKey: binding,
    blobUrl: blob,
    proposalAuthors: authors,
    proposalAuthorVersion,
  };
}

function tokenReason(error) {
  if (error instanceof joseErrors.JWTExpired) return 'expired';
  if (error instanceof joseErrors.JWSSignatureVerificationFailed
    || error instanceof joseErrors.JOSEAlgNotAllowed) return 'invalid_signature';
  return 'malformed';
}

// Node's Base64URL decoder deliberately accepts alternate spellings that
// decode to the same bytes. JWT signatures cover bytes, so reject those
// aliases before verification and accept only the compact serialization we
// would emit ourselves.
function isCanonicalBase64UrlSegment(value) {
  if (typeof value !== 'string' || !BASE64URL_SEGMENT.test(value)) return false;
  try {
    return Buffer.from(value, 'base64url').toString('base64url') === value;
  } catch {
    return false;
  }
}

function isCanonicalCompactJwt(token) {
  const segments = token.split('.');
  return segments.length === 3 && segments.every(isCanonicalBase64UrlSegment);
}

async function signedToken(type, claims) {
  return new SignJWT({ typ: type, ...claims })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    .sign(getSecret());
}

async function verifiedPayload(token, type) {
  if (typeof token !== 'string' || !token) return { valid: false, reason: 'no_token' };
  if (!isCanonicalCompactJwt(token)) return { valid: false, reason: 'malformed' };
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
      clockTolerance: CLOCK_TOLERANCE,
    });
    if (payload.typ !== type) return { valid: false, reason: 'wrong_type' };
    return { valid: true, payload };
  } catch (error) {
    return { valid: false, reason: tokenReason(error) };
  }
}

export async function mintProposalLoadAttestation({
  requestId: rawRequestId,
  bindingKey: rawBindingKey,
  blobUrl: rawBlobUrl,
  proposalContentVersion,
  manualOverride = false,
} = {}) {
  const req = requestId(rawRequestId);
  const binding = bindingKey(rawBindingKey);
  const blob = blobUrl(rawBlobUrl);
  const version = contentVersion(proposalContentVersion);
  if (!req || !binding || !blob || !version || typeof manualOverride !== 'boolean') {
    throw new Error('invalid proposal-load authority claims');
  }
  return signedToken(LOAD_TYP, {
    requestId: req,
    bindingKey: binding,
    blobUrl: blob,
    proposalContentVersion: version,
    manualOverride,
  });
}

export async function verifyProposalLoadAttestation(token, expected = {}) {
  const verified = await verifiedPayload(token, LOAD_TYP);
  if (!verified.valid) return verified;
  const payload = verified.payload;
  const claims = {
    requestId: requestId(payload.requestId),
    bindingKey: bindingKey(payload.bindingKey),
    blobUrl: blobUrl(payload.blobUrl),
    proposalContentVersion: contentVersion(payload.proposalContentVersion),
    manualOverride: typeof payload.manualOverride === 'boolean' ? payload.manualOverride : null,
  };
  if (!claims.requestId || !claims.bindingKey || !claims.blobUrl
    || !claims.proposalContentVersion || claims.manualOverride === null) {
    return { valid: false, reason: 'malformed_claims' };
  }
  if ((expected.requestId && claims.requestId !== requestId(expected.requestId))
    || (expected.bindingKey && claims.bindingKey !== bindingKey(expected.bindingKey))
    || (expected.blobUrl && claims.blobUrl !== blobUrl(expected.blobUrl))
    || (expected.proposalContentVersion
      && claims.proposalContentVersion !== contentVersion(expected.proposalContentVersion))
    || (typeof expected.manualOverride === 'boolean'
      && claims.manualOverride !== expected.manualOverride)) {
    return { valid: false, reason: 'claim_mismatch' };
  }
  return { valid: true, ...claims };
}

export async function mintAnalysisAttestation(input = {}) {
  const claims = analysisClaims(input);
  if (!claims) throw new Error('invalid analysis authority claims');
  const analysisDigest = digest('reviewer-find-analysis:v1', claims);
  return signedToken(ANALYSIS_TYP, { ...claims, analysisDigest });
}

export async function verifyAnalysisAttestation(token, expected = {}) {
  const verified = await verifiedPayload(token, ANALYSIS_TYP);
  if (!verified.valid) return verified;
  const claims = analysisClaims(verified.payload);
  const analysisDigest = contentVersion(verified.payload.analysisDigest);
  if (!claims || !analysisDigest || analysisDigest !== digest('reviewer-find-analysis:v1', claims)) {
    return { valid: false, reason: 'malformed_claims' };
  }
  if ((expected.requestId && claims.requestId !== requestId(expected.requestId))
    || (expected.proposalContentVersion
      && claims.proposalContentVersion !== contentVersion(expected.proposalContentVersion))) {
    return { valid: false, reason: 'claim_mismatch' };
  }
  return { valid: true, ...claims, analysisDigest };
}

export async function mintDiscoveryCandidateAttestation({
  requestId: rawRequestId,
  analysisDigest,
  candidate,
} = {}) {
  const req = requestId(rawRequestId);
  const analysis = contentVersion(analysisDigest);
  const correlation = candidateProjection(candidate);
  const evidence = candidateEvidenceProjection(candidate);
  if (!req || !analysis || !correlation || !evidence) throw new Error('invalid discovery candidate authority claims');
  const evidenceDigest = digest('reviewer-find-discovery-evidence:v1', evidence);
  const correlationDigest = digest('reviewer-find-discovery-correlation:v1', correlation);
  return signedToken(DISCOVERY_TYP, {
    requestId: req,
    analysisDigest: analysis,
    candidateKey: correlation.candidateKey,
    correlationDigest,
    evidenceDigest,
  });
}

export async function verifyDiscoveryCandidateAttestation(token, {
  requestId: rawRequestId,
  analysisDigest,
  candidate,
} = {}) {
  const verified = await verifiedPayload(token, DISCOVERY_TYP);
  if (!verified.valid) return verified;
  const req = requestId(rawRequestId);
  const analysis = contentVersion(analysisDigest);
  const correlation = candidateProjection(candidate);
  const evidence = candidateEvidenceProjection(candidate);
  const payload = verified.payload;
  if (!req || !analysis || !correlation || !evidence
    || payload.requestId !== req
    || payload.analysisDigest !== analysis
    || payload.candidateKey !== correlation.candidateKey
    || payload.correlationDigest !== digest('reviewer-find-discovery-correlation:v1', correlation)
    || payload.evidenceDigest !== digest('reviewer-find-discovery-evidence:v1', evidence)) {
    return { valid: false, reason: 'claim_mismatch' };
  }
  return { valid: true, candidateKey: correlation.candidateKey };
}

export const REVIEWER_SEARCH_ATTESTATION_TTL_SECONDS = TTL_SECONDS;
