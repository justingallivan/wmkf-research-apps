/**
 * verifyProposalListToken — signature, audience, stored digest, revocation,
 * row expiry, and the readiness flag
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * @jest-environment node
 */
import { mintScopedToken, hashToken } from '../../lib/services/external-token';
import { verifyProposalListToken } from '../../lib/external/verify-proposal-list-token';
import { verifyBriefingToken } from '../../lib/external/verify-briefing-token';

const SECRET = 'test-secret-32-chars-min-proposal-list-aaaa';
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

function mint(audience = 'proposal-list') {
  return mintScopedToken({ subject: 'list-subject', audience, ops: ['view_proposal_list'], expiresAt: FUTURE });
}

function deps(rowsByDigest, { ready = true, now = () => new Date() } = {}) {
  return {
    schemaReady: () => ready,
    getLinkByDigest: jest.fn(async (digest) => rowsByDigest[digest] || null),
    now,
  };
}

function row(jwt, overrides = {}) {
  return { id: 'link-1', token_digest: hashToken(jwt), expires_at: FUTURE, revoked_at: null, ...overrides };
}

describe('verifyProposalListToken', () => {
  test('accepts a live link and returns its row', async () => {
    const { jwt } = await mint();
    const result = await verifyProposalListToken(jwt, deps({ [hashToken(jwt)]: row(jwt) }));
    expect(result.ok).toBe(true);
    expect(result.link.id).toBe('link-1');
  });

  test('flag off answers not_found even for a live link, without reading the row', async () => {
    const { jwt } = await mint();
    const d = deps({ [hashToken(jwt)]: row(jwt) }, { ready: false });
    expect(await verifyProposalListToken(jwt, d)).toEqual({ ok: false, reason: 'not_found' });
    expect(d.getLinkByDigest).not.toHaveBeenCalled();
  });

  test('rejects a validly signed token minted for another audience, even with a matching row', async () => {
    const { jwt } = await mint('briefing');
    const d = deps({ [hashToken(jwt)]: row(jwt) });
    expect(await verifyProposalListToken(jwt, d)).toEqual({ ok: false, reason: 'invalid_claim' });
    expect(d.getLinkByDigest).not.toHaveBeenCalled();
  });

  test('a proposal-list token does not open the briefing page', async () => {
    const { jwt } = await mint();
    const result = await verifyBriefingToken(jwt, {
      schemaReady: () => true,
      getLinkByDigest: jest.fn(async () => ({ id: 'b', request_id: 'list-subject', token_digest: hashToken(jwt), expires_at: FUTURE, revoked_at: null })),
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_claim' });
  });

  test('rejects a signed token with no stored row', async () => {
    const { jwt } = await mint();
    expect(await verifyProposalListToken(jwt, deps({}))).toEqual({ ok: false, reason: 'invalid_claim' });
  });

  test('rejects a revoked link', async () => {
    const { jwt } = await mint();
    const d = deps({ [hashToken(jwt)]: row(jwt, { revoked_at: new Date() }) });
    expect(await verifyProposalListToken(jwt, d)).toEqual({ ok: false, reason: 'revoked' });
  });

  test('the row expiry governs even while the token itself is still valid', async () => {
    const { jwt } = await mint();
    const d = deps({ [hashToken(jwt)]: row(jwt, { expires_at: new Date(Date.now() - 1000) }) });
    expect(await verifyProposalListToken(jwt, d)).toEqual({ ok: false, reason: 'expired' });
  });

  test('rejects a tampered token and a missing token', async () => {
    const { jwt } = await mint();
    const tampered = `${jwt.slice(0, -3)}abc`;
    expect((await verifyProposalListToken(tampered, deps({ [hashToken(jwt)]: row(jwt) }))).ok).toBe(false);
    expect(await verifyProposalListToken('', deps({}))).toEqual({ ok: false, reason: 'no_token' });
  });
});
