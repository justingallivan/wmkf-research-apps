/**
 * Short-lived, server-signed evidence for repairing a materials dispatch whose
 * inline lifecycle write failed. The receipt binds the rendered due date and
 * dispatch timestamp to the exact pre-dispatch suggestion ETag.
 *
 * Idempotency is recognized from the signed dispatch tuple persisted in the
 * existing lifecycle fields: suggestionId + materialsSentAt +
 * effectiveReviewDueDate. The signed pre-dispatch ETag remains evidence of the
 * row version used for the send, while repair writes bind to a fresh eligible
 * row ETag so later real dispatches are not invalidated by earlier stamps.
 */

import crypto from 'crypto';
import { isYmd } from '../../utils/date-ymd';

const TYPE = 'materials-send-repair';
const VERSION = 1;
const TTL_MS = 15 * 60 * 1000;
const MIN_SECRET_LENGTH = 16;

function secret() {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error('NEXTAUTH_SECRET missing/too short — cannot sign materials repair receipt');
  }
  return value;
}

export function assertMaterialsSendRepairReceiptConfigured() {
  secret();
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signature(encoded) {
  return crypto.createHmac('sha256', secret()).update(encoded).digest('base64url');
}

function validGuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
}

function assertClaims(claims) {
  if (claims?.typ !== TYPE || claims?.v !== VERSION) throw new Error('invalid_repair_receipt');
  if (!validGuid(claims.requestId) || !validGuid(claims.suggestionId)) throw new Error('invalid_repair_receipt');
  if (!isYmd(claims.effectiveReviewDueDate)) throw new Error('invalid_repair_receipt');
  if (!claims.materialsSentAt || !Number.isFinite(new Date(claims.materialsSentAt).getTime())) {
    throw new Error('invalid_repair_receipt');
  }
  if (typeof claims.ifMatch !== 'string' || !claims.ifMatch) throw new Error('invalid_repair_receipt');
  if (typeof claims.nonce !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(claims.nonce)) {
    throw new Error('invalid_repair_receipt');
  }
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= claims.iat) {
    throw new Error('invalid_repair_receipt');
  }
}

export function mintMaterialsSendRepairReceipt({
  requestId,
  suggestionId,
  effectiveReviewDueDate,
  materialsSentAt,
  ifMatch,
  now = Date.now(),
}) {
  const claims = {
    typ: TYPE,
    v: VERSION,
    requestId,
    suggestionId,
    effectiveReviewDueDate,
    materialsSentAt: new Date(materialsSentAt).toISOString(),
    ifMatch,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + TTL_MS) / 1000),
    nonce: crypto.randomBytes(16).toString('base64url'),
  };
  assertClaims(claims);
  const encoded = encode(claims);
  return `${encoded}.${signature(encoded)}`;
}

export function verifyMaterialsSendRepairReceipt(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token) throw new Error('invalid_repair_receipt');
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('invalid_repair_receipt');

  const expected = Buffer.from(signature(parts[0]), 'base64url');
  let presented;
  try {
    presented = Buffer.from(parts[1], 'base64url');
  } catch {
    throw new Error('invalid_repair_receipt');
  }
  const maxLength = Math.max(expected.length, presented.length);
  const expectedPadded = Buffer.alloc(maxLength);
  const presentedPadded = Buffer.alloc(maxLength);
  expected.copy(expectedPadded);
  presented.copy(presentedPadded);
  if (!crypto.timingSafeEqual(expectedPadded, presentedPadded)
      || expected.length !== presented.length) {
    throw new Error('invalid_repair_receipt');
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid_repair_receipt');
  }
  assertClaims(claims);
  const nowSeconds = Math.floor(now / 1000);
  if (claims.iat > nowSeconds + 30 || claims.exp < nowSeconds) throw new Error('expired_repair_receipt');
  return claims;
}
