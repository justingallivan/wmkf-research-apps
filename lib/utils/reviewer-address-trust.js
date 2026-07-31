/**
 * Pure contract for the versioned `wmkf_addresstruststatejson` bundle.
 *
 * The bundle grants authority only when it is structurally valid and bound to
 * the exact email currently stored on the reviewer person. Unknown versions,
 * malformed/oversized JSON, and email mismatches fail closed. This module owns
 * current-state validation only; authentication, ETag writes, and evidence
 * authorization remain server-service concerns.
 */

const ADDRESS_TRUST_VERSION = 1;
const MAX_ADDRESS_TRUST_BYTES = 48000;
const MAX_CANDIDATE_KEY_LENGTH = 1200;
const MAX_NOTE_LENGTH = 1000;
const MAX_URL_LENGTH = 2000;

const EVIDENCE_TYPES = new Set([
  'publication_corresponding_author',
  'institution_page',
  'direct_correspondence',
  'other',
]);

const CONFLICT_REASONS = new Set([
  'email_mismatch',
  'orcid_email_split',
  'contact_linked_elsewhere',
  'email_conflict',
]);

function utf8Bytes(value) {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(value, 'utf8');
  return new TextEncoder().encode(value).byteLength;
}

function boundedString(value, maxLength, { required = false } = {}) {
  const out = typeof value === 'string' ? value.trim() : '';
  if (!out) {
    if (required) throw new Error('Required text value is missing');
    return null;
  }
  if (out.length > maxLength) throw new Error(`Text value exceeds ${maxLength} characters`);
  return out;
}

function normalizeAddress(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized || normalized.length > 254) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeHttpUrl(value, { required = false } = {}) {
  const raw = boundedString(value, MAX_URL_LENGTH, { required });
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Evidence URL must be a valid HTTP(S) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Evidence URL must use HTTP(S)');
  }
  return parsed.toString();
}

function validIsoTimestamp(value) {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function buildAttestation({
  actorProfileId = null,
  actorSystemUserId = null,
  requestId,
  candidateKey,
  evidenceType,
  evidenceUrl = null,
  note = null,
  attestedAt = new Date().toISOString(),
}) {
  if (!EVIDENCE_TYPES.has(evidenceType)) throw new Error('Unsupported address evidence type');
  const urlRequired = evidenceType === 'publication_corresponding_author'
    || evidenceType === 'institution_page';
  const normalizedNote = boundedString(note, MAX_NOTE_LENGTH, { required: evidenceType === 'other' });
  if (!validIsoTimestamp(attestedAt)) throw new Error('Attestation timestamp must be canonical ISO-8601');
  return {
    actorProfileId: boundedString(actorProfileId, 128),
    actorSystemUserId: boundedString(actorSystemUserId, 128),
    requestId: boundedString(requestId, 64, { required: true }),
    candidateKey: boundedString(candidateKey, MAX_CANDIDATE_KEY_LENGTH, { required: true }),
    evidenceType,
    evidenceUrl: normalizeHttpUrl(evidenceUrl, { required: urlRequired }),
    note: normalizedNote,
    attestedAt,
  };
}

function assertBundleSize(bundle) {
  const encoded = JSON.stringify(bundle);
  if (utf8Bytes(encoded) > MAX_ADDRESS_TRUST_BYTES) {
    throw new Error(`Address trust bundle exceeds ${MAX_ADDRESS_TRUST_BYTES} bytes`);
  }
  return bundle;
}

function createStaffVerifiedState({ email, resolution = null, ...attestation }) {
  const normalizedEmail = normalizeAddress(email);
  if (!normalizedEmail) throw new Error('A valid exact email is required for address attestation');
  return assertBundleSize({
    version: ADDRESS_TRUST_VERSION,
    email: normalizedEmail,
    status: 'staff_verified',
    attestation: buildAttestation(attestation),
    conflict: null,
    resolution,
  });
}

function createConflictPendingState({
  currentState = null,
  email,
  reason,
  foundEmail,
  source = null,
  requestId,
  candidateKey,
  detectedAt = new Date().toISOString(),
}) {
  const storedEmail = normalizeAddress(email);
  const normalizedFound = normalizeAddress(foundEmail);
  if (!storedEmail || !normalizedFound) throw new Error('Stored and found emails must both be valid');
  if (!CONFLICT_REASONS.has(reason)) throw new Error('Unsupported address conflict reason');
  if (!validIsoTimestamp(detectedAt)) throw new Error('Conflict timestamp must be canonical ISO-8601');
  return assertBundleSize({
    version: ADDRESS_TRUST_VERSION,
    email: storedEmail,
    status: 'conflict_pending',
    attestation: currentState?.attestation || null,
    conflict: {
      reason,
      storedEmail,
      foundEmail: normalizedFound,
      source: boundedString(source, 64),
      requestId: boundedString(requestId, 64, { required: true }),
      candidateKey: boundedString(candidateKey, MAX_CANDIDATE_KEY_LENGTH, { required: true }),
      detectedAt,
    },
    resolution: null,
  });
}

function parseAddressTrustState(raw, { storedEmail } = {}) {
  if (raw === null || raw === undefined || raw === '') return { valid: false, reason: 'absent', state: null };
  let state;
  try {
    const encoded = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (utf8Bytes(encoded) > MAX_ADDRESS_TRUST_BYTES) {
      return { valid: false, reason: 'oversized', state: null };
    }
    state = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { valid: false, reason: 'malformed', state: null };
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return { valid: false, reason: 'malformed', state: null };
  if (state.version !== ADDRESS_TRUST_VERSION) return { valid: false, reason: 'unknown_version', state: null };
  const bundleEmail = normalizeAddress(state.email);
  if (!bundleEmail) return { valid: false, reason: 'invalid_email', state: null };
  const normalizedStored = storedEmail === undefined ? null : normalizeAddress(storedEmail);
  if (storedEmail !== undefined && (!normalizedStored || normalizedStored !== bundleEmail)) {
    return { valid: false, reason: 'email_mismatch', state: null };
  }
  if (state.status === 'staff_verified') {
    try {
      const rebuilt = buildAttestation(state.attestation || {});
      return {
        valid: true,
        reason: null,
        state: { ...state, email: bundleEmail, attestation: rebuilt, conflict: null },
      };
    } catch {
      return { valid: false, reason: 'invalid_attestation', state: null };
    }
  }
  if (state.status === 'conflict_pending') {
    const conflict = state.conflict;
    const foundEmail = normalizeAddress(conflict?.foundEmail);
    if (!conflict || !CONFLICT_REASONS.has(conflict.reason)
      || normalizeAddress(conflict.storedEmail) !== bundleEmail
      || !foundEmail || !validIsoTimestamp(conflict.detectedAt)
      || !boundedString(conflict.requestId, 64)
      || !boundedString(conflict.candidateKey, MAX_CANDIDATE_KEY_LENGTH)) {
      return { valid: false, reason: 'invalid_conflict', state: null };
    }
    return { valid: true, reason: null, state: { ...state, email: bundleEmail } };
  }
  return { valid: false, reason: 'unknown_status', state: null };
}

function addressTrustDecision(person) {
  const email = person?.wmkf_emailaddress ?? person?.email ?? null;
  const raw = person?.wmkf_addresstruststatejson ?? person?.addressTrustStateJson ?? null;
  const parsed = parseAddressTrustState(raw, { storedEmail: email });
  if (!parsed.valid) return { status: 'untrusted', reason: parsed.reason, state: null };
  if (parsed.state.status === 'conflict_pending') {
    return { status: 'conflict_pending', reason: parsed.state.conflict.reason, state: parsed.state };
  }
  return { status: 'staff_verified', reason: null, state: parsed.state };
}

module.exports = {
  ADDRESS_TRUST_VERSION,
  MAX_ADDRESS_TRUST_BYTES,
  EVIDENCE_TYPES,
  CONFLICT_REASONS,
  normalizeAddress,
  buildAttestation,
  createStaffVerifiedState,
  createConflictPendingState,
  parseAddressTrustState,
  addressTrustDecision,
};
