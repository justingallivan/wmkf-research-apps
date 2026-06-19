/**
 * External access token primitive.
 *
 * HMAC-signed JWTs that authenticate external parties (initially: invited
 * reviewers) to our backend for proposal download + review upload, without
 * needing AzureAD accounts. Verification has two layers:
 *
 *   1. Cryptographic + temporal — handled here: signature valid against
 *      EXTERNAL_LINK_SECRET, expiry not yet reached, algorithm pinned to
 *      HS256. Output is `{ valid, payload?, reason? }`.
 *
 *   2. Authorization-state — handled by the caller after this function
 *      returns valid: SHA-256 of the presented token must match
 *      `wmkf_externaltokenhash` on the suggestion row, and
 *      `wmkf_externaltokenrevoked` must be false. The hash check is what
 *      lets a single token be revoked or replaced without rotating the
 *      global secret.
 *
 * The secret is read from `process.env.EXTERNAL_LINK_SECRET` (32+ chars).
 * Kept distinct from `NEXTAUTH_SECRET` so blast radius is bounded.
 *
 * Rotation: `EXTERNAL_LINK_SECRET` can be rotated without invalidating live
 * magic links. Set `EXTERNAL_LINK_SECRET_PREVIOUS` to the outgoing value for
 * the duration of a rotation window — `verifyToken` accepts tokens signed
 * with either secret, while `mintToken` always uses the current one. Once all
 * tokens minted under the old secret have expired, clear the PREVIOUS var.
 * See docs/CREDENTIALS_RUNBOOK.md § "Rotating EXTERNAL_LINK_SECRET".
 */

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { createHash, randomBytes } from 'crypto';

const ALG = 'HS256';
const MIN_SECRET_LEN = 32;

function getSecret() {
  const s = process.env.EXTERNAL_LINK_SECRET;
  if (!s) {
    throw new Error('EXTERNAL_LINK_SECRET is not set');
  }
  if (s.length < MIN_SECRET_LEN) {
    throw new Error(`EXTERNAL_LINK_SECRET must be at least ${MIN_SECRET_LEN} chars`);
  }
  return new TextEncoder().encode(s);
}

/**
 * The outgoing secret during a rotation window, or `null` when not rotating.
 * Verify-only — never used to mint. A set-but-too-short value is a rotation
 * misconfiguration: it is ignored (the primary secret still verifies current
 * tokens) but logged loudly rather than silently weakening verification.
 */
function getPreviousSecret() {
  const s = process.env.EXTERNAL_LINK_SECRET_PREVIOUS;
  if (!s) return null;
  if (s.length < MIN_SECRET_LEN) {
    console.warn(
      `[external-token] EXTERNAL_LINK_SECRET_PREVIOUS is set but under ` +
      `${MIN_SECRET_LEN} chars — ignoring it. Tokens minted under the old ` +
      `secret will not verify until this is corrected.`,
    );
    return null;
  }
  return new TextEncoder().encode(s);
}

/**
 * Mint a new token for a suggestion.
 *
 * @param {Object} args
 * @param {string} args.suggestionId - GUID of the wmkf_appreviewersuggestion row
 * @param {string} args.requestId - GUID of the akoya_request the review is for
 * @param {string[]} args.ops - Operations granted; e.g. ['download_proposal','upload_review']
 * @param {Date} args.expiresAt - Hard expiry (review due date + grace)
 * @returns {Promise<{ jwt: string, jti: string, hash: string }>}
 *   `jwt` is the URL-embeddable token, `jti` is the unique id (for audit logs),
 *   `hash` is the SHA-256 of the JWT (store on the suggestion row).
 */
export async function mintToken({ suggestionId, requestId, ops, expiresAt }) {
  if (!suggestionId || typeof suggestionId !== 'string') {
    throw new Error('mintToken: suggestionId required');
  }
  if (!requestId || typeof requestId !== 'string') {
    throw new Error('mintToken: requestId required');
  }
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error('mintToken: ops must be a non-empty array');
  }
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw new Error('mintToken: expiresAt must be a valid Date');
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new Error('mintToken: expiresAt must be in the future');
  }

  const jti = randomBytes(16).toString('hex');
  const expSeconds = Math.floor(expiresAt.getTime() / 1000);

  const jwt = await new SignJWT({ sub: suggestionId, req: requestId, ops })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(expSeconds)
    .setJti(jti)
    .sign(getSecret());

  return { jwt, jti, hash: hashToken(jwt) };
}

/**
 * Mint a generic audience-scoped token for a non-reviewer external surface
 * (e.g. the grantee deliverables portal). Unlike `mintToken` (which is
 * reviewer-shaped with a separate `sub`/`req`), this signs a single `subject`
 * as `sub` plus a standard `aud` audience claim so a token minted for one
 * surface can be rejected on another. The caller's verify wrapper MUST assert
 * the expected `aud` after `verifyToken` succeeds — `verifyToken` surfaces
 * `aud` but (intentionally) does not enforce it, since it is surface-agnostic.
 *
 * @param {Object} args
 * @param {string} args.subject - the `sub` claim (e.g. an akoya_request GUID)
 * @param {string} args.audience - the `aud` claim (e.g. 'grantee')
 * @param {string[]} args.ops - operations granted; non-empty
 * @param {Date} args.expiresAt - hard expiry, must be in the future
 * @returns {Promise<{ jwt: string, jti: string, hash: string }>}
 */
export async function mintScopedToken({ subject, audience, ops, expiresAt }) {
  if (!subject || typeof subject !== 'string') {
    throw new Error('mintScopedToken: subject required');
  }
  if (!audience || typeof audience !== 'string') {
    throw new Error('mintScopedToken: audience required');
  }
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error('mintScopedToken: ops must be a non-empty array');
  }
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw new Error('mintScopedToken: expiresAt must be a valid Date');
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new Error('mintScopedToken: expiresAt must be in the future');
  }

  const jti = randomBytes(16).toString('hex');
  const expSeconds = Math.floor(expiresAt.getTime() / 1000);

  const jwt = await new SignJWT({ sub: subject, ops })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt()
    .setAudience(audience)
    .setExpirationTime(expSeconds)
    .setJti(jti)
    .sign(getSecret());

  return { jwt, jti, hash: hashToken(jwt) };
}

/** Verify `jwt` against a single secret. Shared by the primary + rotation paths. */
async function verifyAgainst(jwt, secret) {
  try {
    const { payload } = await jwtVerify(jwt, secret, {
      algorithms: [ALG],
    });
    return {
      valid: true,
      payload: {
        // Reviewer-shaped fields (mintToken). `subject` is the surface-agnostic
        // alias for `sub` used by audience-scoped tokens (mintScopedToken); `aud`
        // is surfaced (not enforced here) so a caller's verify wrapper can assert
        // the expected audience and reject cross-surface token replay.
        suggestionId: payload.sub,
        requestId: payload.req,
        subject: payload.sub,
        aud: payload.aud,
        ops: payload.ops,
        jti: payload.jti,
        iat: payload.iat,
        exp: payload.exp,
      },
    };
  } catch (e) {
    let reason = 'malformed';
    if (e instanceof joseErrors.JWTExpired) reason = 'expired';
    else if (e instanceof joseErrors.JWSSignatureVerificationFailed) reason = 'invalid_signature';
    else if (e instanceof joseErrors.JWTClaimValidationFailed) reason = 'invalid_claim';
    else if (e instanceof joseErrors.JOSEAlgNotAllowed) reason = 'invalid_signature';
    return { valid: false, reason };
  }
}

/**
 * Verify a token's signature and expiry. Does NOT check revocation or
 * suggestion-row state — the caller does that with `hashToken(jwt)`.
 *
 * During a secret rotation a token signed with the previous secret fails the
 * primary check on the signature only; it is retried against
 * `EXTERNAL_LINK_SECRET_PREVIOUS` so live magic links survive the rotation.
 *
 * @param {string} jwt
 * @returns {Promise<{ valid: true, payload: { suggestionId, requestId, ops, jti, iat, exp } }
 *                  | { valid: false, reason: 'no_token'|'expired'|'invalid_signature'|'invalid_claim'|'malformed' }>}
 */
export async function verifyToken(jwt) {
  if (typeof jwt !== 'string' || !jwt) {
    return { valid: false, reason: 'no_token' };
  }

  let primarySecret;
  try {
    primarySecret = getSecret();
  } catch {
    // Missing/short EXTERNAL_LINK_SECRET is a server misconfiguration; keep
    // the historical client-facing reason rather than leaking config state.
    return { valid: false, reason: 'malformed' };
  }

  const primary = await verifyAgainst(jwt, primarySecret);
  if (primary.valid) return primary;

  // Rotation window: only a signature mismatch is worth retrying against the
  // previous secret (an expired/malformed token fails the same way regardless
  // of which secret signed it).
  if (primary.reason === 'invalid_signature') {
    const previous = getPreviousSecret();
    if (previous) {
      const fallback = await verifyAgainst(jwt, previous);
      // Accept a valid old-secret token. Also surface a non-signature failure
      // from the old secret (e.g. that old-secret token is genuinely expired)
      // rather than masking it behind the primary's invalid_signature.
      if (fallback.valid || fallback.reason !== 'invalid_signature') {
        return fallback;
      }
    }
  }
  return primary;
}

/**
 * SHA-256 hex digest of a JWT. Stored on the suggestion row at mint time;
 * compared at verify time so a leaked or replaced token can be invalidated
 * without rotating the global secret.
 *
 * @param {string} jwt
 * @returns {string} 64-char hex digest
 */
export function hashToken(jwt) {
  if (typeof jwt !== 'string' || !jwt) {
    throw new Error('hashToken: jwt required');
  }
  return createHash('sha256').update(jwt).digest('hex');
}
