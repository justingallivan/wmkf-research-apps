/**
 * Tests for the external-access token primitive.
 *
 * @jest-environment node
 */

import { mintToken, verifyToken, hashToken } from '../../lib/services/external-token.js';
import { SignJWT } from 'jose';

const SECRET = 'test-secret-32-chars-min-aaaaaaaaaaaa';
const OTHER_SECRET = 'other-secret-32-chars-min-bbbbbbbbbbb';

const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';
const REQUEST_ID = '22222222-2222-2222-2222-222222222222';
const OPS = ['download_proposal', 'upload_review'];

describe('external-token', () => {
  let originalSecret;
  beforeEach(() => {
    originalSecret = process.env.EXTERNAL_LINK_SECRET;
    process.env.EXTERNAL_LINK_SECRET = SECRET;
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.EXTERNAL_LINK_SECRET;
    else process.env.EXTERNAL_LINK_SECRET = originalSecret;
  });

  describe('mintToken', () => {
    test('produces a JWT, jti, and hash', async () => {
      const { jwt, jti, hash } = await mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(typeof jwt).toBe('string');
      expect(jwt.split('.')).toHaveLength(3); // header.payload.signature
      expect(jti).toMatch(/^[0-9a-f]{32}$/); // 16 random bytes hex
      expect(hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    });

    test('rejects missing suggestionId', async () => {
      await expect(mintToken({
        suggestionId: '',
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      })).rejects.toThrow(/suggestionId required/);
    });

    test('rejects missing requestId', async () => {
      await expect(mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: null,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      })).rejects.toThrow(/requestId required/);
    });

    test('rejects empty ops', async () => {
      await expect(mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: [],
        expiresAt: new Date(Date.now() + 60_000),
      })).rejects.toThrow(/ops/);
    });

    test('rejects past expiresAt', async () => {
      await expect(mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() - 60_000),
      })).rejects.toThrow(/in the future/);
    });

    test('rejects when secret is missing', async () => {
      delete process.env.EXTERNAL_LINK_SECRET;
      await expect(mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      })).rejects.toThrow(/EXTERNAL_LINK_SECRET is not set/);
    });

    test('rejects when secret is too short', async () => {
      process.env.EXTERNAL_LINK_SECRET = 'short';
      await expect(mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      })).rejects.toThrow(/at least 32/);
    });

    test('two mints produce different jwts and different jtis', async () => {
      const a = await mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const b = await mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(a.jwt).not.toBe(b.jwt);
      expect(a.jti).not.toBe(b.jti);
      expect(a.hash).not.toBe(b.hash);
    });
  });

  describe('verifyToken', () => {
    test('round-trip: minted token verifies and round-trips payload', async () => {
      const { jwt } = await mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const result = await verifyToken(jwt);
      expect(result.valid).toBe(true);
      expect(result.payload.suggestionId).toBe(SUGGESTION_ID);
      expect(result.payload.requestId).toBe(REQUEST_ID);
      expect(result.payload.ops).toEqual(OPS);
      expect(result.payload.jti).toMatch(/^[0-9a-f]{32}$/);
      expect(typeof result.payload.iat).toBe('number');
      expect(typeof result.payload.exp).toBe('number');
    });

    test('rejects empty/missing token', async () => {
      expect((await verifyToken('')).reason).toBe('no_token');
      expect((await verifyToken(null)).reason).toBe('no_token');
      expect((await verifyToken(undefined)).reason).toBe('no_token');
    });

    test('rejects malformed token', async () => {
      const r = await verifyToken('not-a-jwt');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('malformed');
    });

    test('rejects token signed with a different secret', async () => {
      const otherJwt = await new SignJWT({ sub: SUGGESTION_ID, req: REQUEST_ID, ops: OPS })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime(Math.floor((Date.now() + 60_000) / 1000))
        .setJti('00000000000000000000000000000000')
        .sign(new TextEncoder().encode(OTHER_SECRET));
      const r = await verifyToken(otherJwt);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('invalid_signature');
    });

    test('rejects expired token', async () => {
      // Mint with a near-zero exp by signing manually (mintToken refuses past expiresAt).
      const jwt = await new SignJWT({ sub: SUGGESTION_ID, req: REQUEST_ID, ops: OPS })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .setJti('00000000000000000000000000000000')
        .sign(new TextEncoder().encode(SECRET));
      const r = await verifyToken(jwt);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('expired');
    });

    test('rejects "alg: none" attack', async () => {
      // Construct an unsigned-style token (alg: none). jose will reject it
      // because we pin algorithms to HS256.
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        sub: SUGGESTION_ID, req: REQUEST_ID, ops: OPS,
        exp: Math.floor((Date.now() + 60_000) / 1000),
      })).toString('base64url');
      const unsignedToken = `${header}.${payload}.`;
      const r = await verifyToken(unsignedToken);
      expect(r.valid).toBe(false);
      // jose maps this to JOSEAlgNotAllowed → invalid_signature
      expect(['invalid_signature', 'malformed']).toContain(r.reason);
    });
  });

  describe('verifyToken — secret rotation window', () => {
    // OTHER_SECRET stands in for the outgoing ("previous") secret; SECRET is
    // the current one set by the outer beforeEach.
    const THIRD_SECRET = 'third-secret-32-chars-min-ccccccccccc';

    function signWith(secret, { expMs = Date.now() + 60_000 } = {}) {
      return new SignJWT({ sub: SUGGESTION_ID, req: REQUEST_ID, ops: OPS })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime(Math.floor(expMs / 1000))
        .setJti('00000000000000000000000000000000')
        .sign(new TextEncoder().encode(secret));
    }

    afterEach(() => {
      delete process.env.EXTERNAL_LINK_SECRET_PREVIOUS;
    });

    test('accepts a token signed with the previous secret when PREVIOUS is set', async () => {
      const oldToken = await signWith(OTHER_SECRET);
      process.env.EXTERNAL_LINK_SECRET_PREVIOUS = OTHER_SECRET;
      const r = await verifyToken(oldToken);
      expect(r.valid).toBe(true);
      expect(r.payload.suggestionId).toBe(SUGGESTION_ID);
    });

    test('rejects a previous-secret token when PREVIOUS is not set', async () => {
      const oldToken = await signWith(OTHER_SECRET);
      const r = await verifyToken(oldToken);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('invalid_signature');
    });

    test('still accepts a current-secret token while PREVIOUS is set', async () => {
      process.env.EXTERNAL_LINK_SECRET_PREVIOUS = OTHER_SECRET;
      const { jwt } = await mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const r = await verifyToken(jwt);
      expect(r.valid).toBe(true);
    });

    test('surfaces expiry of a previous-secret token (not invalid_signature)', async () => {
      const expiredOld = await signWith(OTHER_SECRET, { expMs: Date.now() - 60_000 });
      process.env.EXTERNAL_LINK_SECRET_PREVIOUS = OTHER_SECRET;
      const r = await verifyToken(expiredOld);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('expired');
    });

    test('rejects a token signed with neither the current nor previous secret', async () => {
      const strayToken = await signWith(THIRD_SECRET);
      process.env.EXTERNAL_LINK_SECRET_PREVIOUS = OTHER_SECRET;
      const r = await verifyToken(strayToken);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('invalid_signature');
    });

    test('ignores a too-short PREVIOUS secret (primary still verifies)', async () => {
      process.env.EXTERNAL_LINK_SECRET_PREVIOUS = 'short';
      const oldToken = await signWith(OTHER_SECRET);
      expect((await verifyToken(oldToken)).reason).toBe('invalid_signature');
      // The current secret is unaffected.
      const { jwt } = await mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect((await verifyToken(jwt)).valid).toBe(true);
    });

    test('a malformed token stays malformed even with PREVIOUS set', async () => {
      process.env.EXTERNAL_LINK_SECRET_PREVIOUS = OTHER_SECRET;
      const r = await verifyToken('not-a-jwt');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('malformed');
    });
  });

  describe('hashToken', () => {
    test('produces stable 64-char hex digest', async () => {
      const { jwt } = await mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const h1 = hashToken(jwt);
      const h2 = hashToken(jwt);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    test('different jwts produce different hashes', async () => {
      const a = await mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const b = await mintToken({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        ops: OPS,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(hashToken(a.jwt)).not.toBe(hashToken(b.jwt));
    });

    test('rejects empty input', () => {
      expect(() => hashToken('')).toThrow();
      expect(() => hashToken(null)).toThrow();
    });
  });
});
