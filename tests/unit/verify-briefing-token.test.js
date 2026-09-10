/**
 * verifyBriefingToken — signature, audience, stored digest, revocation, row
 * expiry, and request binding (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §4).
 *
 * @jest-environment node
 */
import { mintScopedToken, hashToken } from '../../lib/services/external-token';
import { verifyBriefingToken } from '../../lib/external/verify-briefing-token';

const SECRET = 'briefing-verifier-test-secret-at-least-32-chars';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_REQUEST = '22222222-2222-4222-8222-222222222222';
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

let originalSecret;
beforeAll(() => {
  originalSecret = process.env.EXTERNAL_LINK_SECRET;
  process.env.EXTERNAL_LINK_SECRET = SECRET;
});
afterAll(() => {
  if (originalSecret === undefined) delete process.env.EXTERNAL_LINK_SECRET;
  else process.env.EXTERNAL_LINK_SECRET = originalSecret;
});

async function mintBriefing(subject = REQUEST_ID, audience = 'briefing') {
  return mintScopedToken({ subject, audience, ops: ['view_briefing'], expiresAt: FUTURE });
}

function deps(rowsByDigest, { ready = true, now = () => new Date() } = {}) {
  return {
    schemaReady: () => ready,
    getLinkByDigest: jest.fn(async (digest) => rowsByDigest[digest] || null),
    now,
  };
}

function row(jwt, overrides = {}) {
  return { id: 'link-1', request_id: REQUEST_ID, token_digest: hashToken(jwt), expires_at: FUTURE, revoked_at: null, ...overrides };
}

test('valid token whose digest matches a live row verifies', async () => {
  const { jwt } = await mintBriefing();
  const stored = row(jwt);
  const result = await verifyBriefingToken(jwt, deps({ [stored.token_digest]: stored }));
  expect(result.ok).toBe(true);
  expect(result.requestId).toBe(REQUEST_ID);
  expect(result.link.id).toBe('link-1');
});

test('the same token after revocation is refused', async () => {
  const { jwt } = await mintBriefing();
  const stored = row(jwt, { revoked_at: new Date() });
  expect(await verifyBriefingToken(jwt, deps({ [stored.token_digest]: stored }))).toEqual({ ok: false, reason: 'revoked' });
});

test('a validly signed token with no matching row digest is refused', async () => {
  const { jwt } = await mintBriefing();
  const result = await verifyBriefingToken(jwt, deps({}));
  expect(result).toEqual({ ok: false, reason: 'invalid_claim' });
});

test('a grantee-audience token is refused before any row read', async () => {
  const { jwt } = await mintBriefing(REQUEST_ID, 'grantee');
  const d = deps({});
  expect(await verifyBriefingToken(jwt, d)).toEqual({ ok: false, reason: 'invalid_claim' });
  expect(d.getLinkByDigest).not.toHaveBeenCalled();
});

test('a row past its own expiry is refused even though the JWT still verifies', async () => {
  const { jwt } = await mintBriefing();
  const stored = row(jwt, { expires_at: new Date(Date.now() - 1000) });
  expect(await verifyBriefingToken(jwt, deps({ [stored.token_digest]: stored }))).toEqual({ ok: false, reason: 'expired' });
});

test('a row bound to a different request than the token subject is refused', async () => {
  const { jwt } = await mintBriefing();
  const stored = row(jwt, { request_id: OTHER_REQUEST });
  expect(await verifyBriefingToken(jwt, deps({ [stored.token_digest]: stored }))).toEqual({ ok: false, reason: 'invalid_claim' });
});

test('flag off answers not_found without touching the token', async () => {
  const { jwt } = await mintBriefing();
  const d = deps({}, { ready: false });
  expect(await verifyBriefingToken(jwt, d)).toEqual({ ok: false, reason: 'not_found' });
  expect(d.getLinkByDigest).not.toHaveBeenCalled();
});

test('garbage and missing tokens fail with the primitive reasons', async () => {
  expect(await verifyBriefingToken('', deps({}))).toEqual({ ok: false, reason: 'no_token' });
  expect((await verifyBriefingToken('not-a-jwt', deps({}))).ok).toBe(false);
});
