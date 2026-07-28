/**
 * Pure review-synthesis readiness state machine.
 *
 * The caller supplies selected suggestion rows. This helper still re-checks
 * selection and applicant exclusion so a wider future query cannot silently
 * expand the participating population.
 *
 * The returned inputHash covers both the submitted-review content hash and the
 * lifecycle classification of every participant. Including the classification
 * is important for time-based token expiry: the stored fields do not change
 * when a token crosses its expiry instant, but the synthesis becomes eligible
 * and must receive a new fingerprint.
 */

import crypto from 'crypto';
import {
  APPLICANT_DISPOSITION_EXCLUDED,
  RESPONSE_TYPE_MAP,
  REVIEW_STATUS_MAP,
} from '../../shared/config/reviewerLifecycle.js';

const KNOWN_RESPONSE_TYPES = new Set(Object.values(RESPONSE_TYPE_MAP));
const KNOWN_REVIEW_STATUSES = new Set(Object.values(REVIEW_STATUS_MAP));
const NON_REVIEW_RESPONSE_TYPES = new Set([
  RESPONSE_TYPE_MAP.declined,
  RESPONSE_TYPE_MAP.no_response,
  RESPONSE_TYPE_MAP.withdrawn_sufficient,
]);
const TERMINAL_REVIEW_STATUSES = new Set([
  REVIEW_STATUS_MAP.withdrew,
  REVIEW_STATUS_MAP.released,
]);

function isNil(value) {
  return value === null || value === undefined || value === '';
}

function parseOptionalDate(value) {
  if (isNil(value)) return { present: false, valid: true, iso: null, millis: null };
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis)) {
    return { present: true, valid: false, iso: String(value), millis: null };
  }
  return { present: true, valid: true, iso: new Date(millis).toISOString(), millis };
}

function invalidBoolean(row, field) {
  const value = row[field];
  return !isNil(value) && typeof value !== 'boolean';
}

function suggestionId(row, index) {
  return row.wmkf_appreviewersuggestionid || `missing-id-${index}`;
}

function classifyParticipant(row, nowMillis) {
  const responseType = isNil(row.wmkf_responsetype) ? null : row.wmkf_responsetype;
  const reviewStatus = isNil(row.wmkf_reviewstatus) ? null : row.wmkf_reviewstatus;

  if (responseType !== null && !KNOWN_RESPONSE_TYPES.has(responseType)) {
    return { resolved: false, reason: 'unknown_response_type' };
  }
  if (reviewStatus !== null && !KNOWN_REVIEW_STATUSES.has(reviewStatus)) {
    return { resolved: false, reason: 'unknown_review_status' };
  }
  for (const field of [
    'wmkf_invited',
    'wmkf_accepted',
    'wmkf_declined',
    'wmkf_externaltokenrevoked',
  ]) {
    if (invalidBoolean(row, field)) {
      return { resolved: false, reason: `malformed_${field}` };
    }
  }

  const received = parseOptionalDate(row.wmkf_reviewreceivedat);
  if (!received.valid) {
    return { resolved: false, reason: 'malformed_review_received_at' };
  }
  if (received.present) {
    return { resolved: true, reason: 'review_received', submitted: true };
  }

  if (row.wmkf_declined === true || NON_REVIEW_RESPONSE_TYPES.has(responseType)) {
    return { resolved: true, reason: 'non_review_response', submitted: false };
  }
  if (TERMINAL_REVIEW_STATUSES.has(reviewStatus)) {
    return { resolved: true, reason: 'terminal_review_status', submitted: false };
  }

  const tokenIssued = parseOptionalDate(row.wmkf_externaltokenissued);
  const tokenExpires = parseOptionalDate(row.wmkf_externaltokenexpires);
  if (!tokenIssued.valid) {
    return { resolved: false, reason: 'malformed_token_issued_at' };
  }
  if (!tokenExpires.valid) {
    return { resolved: false, reason: 'malformed_token_expires_at' };
  }

  const hasTokenHash = typeof row.wmkf_externaltokenhash === 'string'
    && row.wmkf_externaltokenhash.trim().length > 0;
  if (!hasTokenHash) {
    return { resolved: false, reason: 'missing_current_token' };
  }
  if (!tokenIssued.present) {
    return { resolved: false, reason: 'missing_token_issued_at' };
  }
  if (!tokenExpires.present) {
    return { resolved: false, reason: 'missing_token_expires_at' };
  }
  if (row.wmkf_externaltokenrevoked === true) {
    return { resolved: true, reason: 'token_revoked', submitted: false };
  }
  if (tokenExpires.millis <= nowMillis) {
    return { resolved: true, reason: 'token_expired', submitted: false };
  }
  return { resolved: false, reason: 'active_invitation' };
}

function canonicalParticipant(row, id, classification) {
  return {
    id,
    invited: row.wmkf_invited === true,
    accepted: row.wmkf_accepted === true,
    declined: row.wmkf_declined === true,
    responseType: isNil(row.wmkf_responsetype) ? null : row.wmkf_responsetype,
    reviewStatus: isNil(row.wmkf_reviewstatus) ? null : row.wmkf_reviewstatus,
    reviewReceivedAt: parseOptionalDate(row.wmkf_reviewreceivedat).iso,
    tokenIssuedAt: parseOptionalDate(row.wmkf_externaltokenissued).iso,
    tokenExpiresAt: parseOptionalDate(row.wmkf_externaltokenexpires).iso,
    tokenRevoked: row.wmkf_externaltokenrevoked === true,
    resolution: classification.reason,
  };
}

/**
 * @param {Array<object>} rows reviewer-suggestion rows
 * @param {{now?: Date|string|number, contentHash?: string|null}} [options]
 */
export function evaluateReviewSynthesisReadiness(rows, {
  now = new Date(),
  contentHash = null,
} = {}) {
  const nowMillis = new Date(now).getTime();
  if (!Number.isFinite(nowMillis)) {
    throw new TypeError('evaluateReviewSynthesisReadiness: now must be a valid date');
  }

  const participants = [];
  const blockers = [];
  let submittedCount = 0;
  let resolvedCount = 0;

  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    if (row?.wmkf_selected !== true) continue;
    if (row.wmkf_applicantdisposition === APPLICANT_DISPOSITION_EXCLUDED) continue;
    if (row.wmkf_invited !== true && row.wmkf_accepted !== true) continue;

    const id = suggestionId(row, index);
    const classification = classifyParticipant(row, nowMillis);
    const canonical = canonicalParticipant(row, id, classification);
    participants.push(canonical);
    if (classification.submitted === true) submittedCount += 1;
    if (classification.resolved) resolvedCount += 1;
    else blockers.push({ suggestionId: id, reason: classification.reason });
  }

  participants.sort((a, b) => a.id.localeCompare(b.id));
  blockers.sort((a, b) => a.suggestionId.localeCompare(b.suggestionId));

  const canonicalInput = JSON.stringify({
    version: 1,
    contentHash: contentHash || null,
    participants,
  });
  const inputHash = crypto.createHash('sha256').update(canonicalInput).digest('hex');
  const participantCount = participants.length;
  const ready = participantCount > 0 && submittedCount > 0 && blockers.length === 0;

  return {
    ready,
    canRunManually: submittedCount > 0,
    participantCount,
    submittedCount,
    resolvedCount,
    blockingCount: blockers.length,
    blockers,
    inputHash,
  };
}
