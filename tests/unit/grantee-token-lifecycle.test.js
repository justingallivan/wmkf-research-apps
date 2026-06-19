/**
 * Grantee token lifecycle (stateless) + the shared mintScopedToken primitive.
 *
 * @jest-environment node
 */
import { mintScopedToken, verifyToken, mintToken } from '../../lib/services/external-token.js';
import {
  mintForRequest,
  buildGranteeUrl,
  getGranteePortalBaseUrl,
  GRANTEE_AUDIENCE,
  DEFAULT_TTL_DAYS,
} from '../../lib/external/grantee-token-lifecycle.js';

const SECRET = 'test-secret-32-chars-min-aaaaaaaaaaaa';
const REQUEST_ID = '22222222-2222-2222-2222-222222222222';

let originalSecret;
let originalBase;
let originalNextAuth;

beforeEach(() => {
  originalSecret = process.env.EXTERNAL_LINK_SECRET;
  originalBase = process.env.GRANTEE_PORTAL_BASE_URL;
  originalNextAuth = process.env.NEXTAUTH_URL;
  process.env.EXTERNAL_LINK_SECRET = SECRET;
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.EXTERNAL_LINK_SECRET;
  else process.env.EXTERNAL_LINK_SECRET = originalSecret;
  if (originalBase === undefined) delete process.env.GRANTEE_PORTAL_BASE_URL;
  else process.env.GRANTEE_PORTAL_BASE_URL = originalBase;
  if (originalNextAuth === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = originalNextAuth;
});

describe('mintScopedToken (shared primitive)', () => {
  test('mints a verifiable token surfacing aud + subject', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const { jwt, jti, hash } = await mintScopedToken({
      subject: REQUEST_ID, audience: 'grantee', ops: ['edit_abstract'], expiresAt,
    });
    expect(typeof jwt).toBe('string');
    expect(jti).toHaveLength(32);
    expect(hash).toHaveLength(64);

    const v = await verifyToken(jwt);
    expect(v.valid).toBe(true);
    expect(v.payload.aud).toBe('grantee');
    expect(v.payload.subject).toBe(REQUEST_ID);
    expect(v.payload.suggestionId).toBe(REQUEST_ID); // sub alias
  });

  test('rejects missing subject / audience / ops / bad expiry', async () => {
    const future = new Date(Date.now() + 60_000);
    await expect(mintScopedToken({ audience: 'grantee', ops: ['x'], expiresAt: future })).rejects.toThrow();
    await expect(mintScopedToken({ subject: REQUEST_ID, ops: ['x'], expiresAt: future })).rejects.toThrow();
    await expect(mintScopedToken({ subject: REQUEST_ID, audience: 'grantee', ops: [], expiresAt: future })).rejects.toThrow();
    await expect(mintScopedToken({ subject: REQUEST_ID, audience: 'grantee', ops: ['x'], expiresAt: new Date(Date.now() - 1000) })).rejects.toThrow();
  });

  test('reviewer mintToken carries NO aud (so the grantee surface can reject it)', async () => {
    const { jwt } = await mintToken({
      suggestionId: '11111111-1111-1111-1111-111111111111',
      requestId: REQUEST_ID,
      ops: ['download_proposal'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    const v = await verifyToken(jwt);
    expect(v.valid).toBe(true);
    expect(v.payload.aud).toBeUndefined();
  });
});

describe('mintForRequest', () => {
  test('mints a grantee-audience token with a /external/grantee/ url and ~30-day expiry', async () => {
    process.env.GRANTEE_PORTAL_BASE_URL = 'https://applications.wmkeck.org';
    const before = Date.now();
    const { jwt, expiresAt, url } = await mintForRequest({ requestId: REQUEST_ID });

    expect(url).toBe(`https://applications.wmkeck.org/external/grantee/${jwt}`);
    const ttlMs = expiresAt.getTime() - before;
    const expectedMs = DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(ttlMs - expectedMs)).toBeLessThan(5_000);

    const v = await verifyToken(jwt);
    expect(v.payload.aud).toBe(GRANTEE_AUDIENCE);
    expect(v.payload.subject).toBe(REQUEST_ID);
  });

  test('requires a requestId', async () => {
    await expect(mintForRequest({})).rejects.toThrow();
  });

  test('base url falls back to NEXTAUTH_URL, trailing slash trimmed', () => {
    delete process.env.GRANTEE_PORTAL_BASE_URL;
    process.env.NEXTAUTH_URL = 'https://app.example.org/';
    expect(getGranteePortalBaseUrl()).toBe('https://app.example.org');
    expect(buildGranteeUrl('JWT')).toBe('https://app.example.org/external/grantee/JWT');
  });
});
