/**
 * Tests for the grantee waiver render token (mint/verify) and the fail-closed
 * waiver-policy resolver's error classification.
 *
 * @jest-environment node
 */

import { mintWaiverRenderToken, verifyWaiverRenderToken, hashPolicyBody } from '../../lib/services/external-token.js';
import { SignJWT } from 'jose';

const SECRET = 'test-secret-32-chars-min-aaaaaaaaaaaa';
const REQUEST_ID = '22222222-2222-2222-2222-222222222222';
const VERSION_ID = '33333333-3333-3333-3333-333333333333';
const BODY = 'By submitting, I give the W. M. Keck Foundation permission to publish…';

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe('grantee waiver render token', () => {
  let original;
  beforeEach(() => { original = process.env.EXTERNAL_LINK_SECRET; process.env.EXTERNAL_LINK_SECRET = SECRET; });
  afterEach(() => { if (original === undefined) delete process.env.EXTERNAL_LINK_SECRET; else process.env.EXTERNAL_LINK_SECRET = original; });

  test('round-trips request/version/bodyHash', async () => {
    const jwt = await mintWaiverRenderToken({ requestId: REQUEST_ID, versionId: VERSION_ID, body: BODY, expiresAt: future() });
    const v = await verifyWaiverRenderToken(jwt);
    expect(v).toMatchObject({ valid: true, requestId: REQUEST_ID, versionId: VERSION_ID, bodyHash: hashPolicyBody(BODY) });
  });

  test('rejects an expired token', async () => {
    // Mint against jose directly so we can set a past expiry (the minter refuses past dates).
    const jwt = await new SignJWT({ req: REQUEST_ID, ver: VERSION_ID, bh: hashPolicyBody(BODY) })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(Math.floor(past().getTime() / 1000) - 10)
      .setAudience('grantee-waiver-render')
      .setExpirationTime(Math.floor(past().getTime() / 1000))
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyWaiverRenderToken(jwt)).toEqual({ valid: false, reason: 'expired' });
  });

  test('rejects a foreign-audience token (e.g. a grantee ACCESS token replayed here)', async () => {
    const jwt = await new SignJWT({ sub: REQUEST_ID })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setAudience('grantee')
      .setExpirationTime(Math.floor(future().getTime() / 1000))
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyWaiverRenderToken(jwt)).toEqual({ valid: false, reason: 'invalid_claim' });
  });

  test('rejects a bad signature', async () => {
    const jwt = await new SignJWT({ req: REQUEST_ID, ver: VERSION_ID })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setAudience('grantee-waiver-render')
      .setExpirationTime(Math.floor(future().getTime() / 1000))
      .sign(new TextEncoder().encode('a-different-secret-32-chars-minimum-x'));
    expect(await verifyWaiverRenderToken(jwt)).toEqual({ valid: false, reason: 'invalid_signature' });
  });

  test('empty/missing token → no_token', async () => {
    expect(await verifyWaiverRenderToken('')).toEqual({ valid: false, reason: 'no_token' });
    expect(await verifyWaiverRenderToken(undefined)).toEqual({ valid: false, reason: 'no_token' });
  });
});

describe('resolveActiveWaiverPolicy — fail-closed classification', () => {
  const loadWith = (impl) => {
    jest.resetModules();
    jest.doMock('../../lib/external/policy-fetcher.js', () => ({ getActivePolicy: impl }));
    return require('../../lib/external/grantee-waiver-policy.js').resolveActiveWaiverPolicy;
  };
  afterEach(() => { jest.dontMock('../../lib/external/policy-fetcher.js'); jest.resetModules(); });

  test('resolves a valid policy', async () => {
    const resolve = loadWith(async () => ({ activeVersionId: VERSION_ID, body: BODY, title: 'T' }));
    expect(await resolve()).toEqual({ ok: true, policy: { activeVersionId: VERSION_ID, body: BODY, title: 'T' } });
  });

  test('slot-not-found throw → policy_misconfigured', async () => {
    const resolve = loadWith(async () => { throw new Error("PolicyFetcher: slot 'grantee-waiver' not found or inactive"); });
    expect(await resolve()).toEqual({ ok: false, reason: 'policy_misconfigured' });
  });

  test('no-active-version throw → policy_misconfigured', async () => {
    const resolve = loadWith(async () => { throw new Error("PolicyFetcher: slot 'grantee-waiver' has no active version configured"); });
    expect(await resolve()).toEqual({ ok: false, reason: 'policy_misconfigured' });
  });

  test('resolved-but-empty-body → policy_misconfigured', async () => {
    const resolve = loadWith(async () => ({ activeVersionId: VERSION_ID, body: '   ' }));
    expect(await resolve()).toEqual({ ok: false, reason: 'policy_misconfigured' });
  });

  test('transient/unknown throw → policy_unavailable', async () => {
    const resolve = loadWith(async () => { throw new Error('fetch failed: ECONNRESET'); });
    expect(await resolve()).toEqual({ ok: false, reason: 'policy_unavailable' });
  });
});
