/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  APPLICANT_DISPOSITION_EXCLUDED: 100000001,
  getForExternalVerification: jest.fn(async () => null),
}));

import { hashToken, mintScopedToken, mintToken } from '../../lib/services/external-token.js';
import {
  PRESENTATION_AUDIENCE,
  buildPresentationUrl,
  computePresentationLinkExpiry,
  ensureLivePresentationLink,
  getLivePresentationLink,
  reissuePresentationLink,
} from '../../lib/services/post-presentation-materials/presentation-link-service.js';
import { verifyPresentationToken } from '../../lib/external/verify-presentation-token.js';
import { verifyBriefingToken } from '../../lib/external/verify-briefing-token.js';
import { verifyGranteeToken } from '../../lib/external/verify-grantee-token.js';
import { verifySuggestionToken } from '../../lib/external/verify-suggestion-token.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const LINK_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-25T12:00:00.000Z');

function row(overrides = {}) {
  return {
    id: LINK_ID,
    request_id: REQUEST_ID,
    jti: 'jti',
    token_digest: hashToken('jwt-one'),
    token_ciphertext: 'sealed:jwt-one',
    expires_at: computePresentationLinkExpiry(NOW),
    created_at: NOW,
    created_by: ACTOR_ID,
    revoked_at: null,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  return {
    schemaReady: () => true,
    requestAllowed: () => true,
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST_ID })),
    getLiveLink: jest.fn(async () => null),
    insertLink: jest.fn(async (value) => row({
      id: value.id,
      jti: value.jti,
      token_digest: value.tokenDigest,
      token_ciphertext: value.tokenCiphertext,
      expires_at: value.expiresAt,
    })),
    replaceLiveLink: jest.fn(async (_requestId, value) => row({
      id: value.id,
      jti: value.jti,
      token_digest: value.tokenDigest,
      token_ciphertext: value.tokenCiphertext,
      expires_at: value.expiresAt,
    })),
    mint: jest.fn(async () => ({ jwt: 'jwt-one', jti: 'jti-one', hash: hashToken('jwt-one') })),
    seal: (value) => `sealed:${value}`,
    unseal: (value) => value.replace('sealed:', ''),
    now: () => NOW,
    randomUUID: () => '44444444-4444-4444-8444-444444444444',
    publicBaseUrl: () => 'https://materials.example.test',
    ...overrides,
  };
}

test('mints an exact 60-day materials-only link and then reuses the readable live row', async () => {
  expect(computePresentationLinkExpiry(NOW).toISOString()).toBe('2026-11-24T12:00:00.000Z');
  expect(buildPresentationUrl('token', 'https://materials.example.test'))
    .toBe('https://materials.example.test/external/presentation/token');
  const deps = dependencies();
  const created = await ensureLivePresentationLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(created.reused).toBe(false);
  expect(created.link.url).toBe('https://materials.example.test/external/presentation/jwt-one');
  expect(deps.insertLink).toHaveBeenCalledWith(expect.objectContaining({ requestId: REQUEST_ID }));

  const live = row();
  deps.getLiveLink.mockResolvedValue(live);
  const reused = await ensureLivePresentationLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(reused.reused).toBe(true);
  expect(deps.replaceLiveLink).not.toHaveBeenCalled();
});

test('reissue is compare-and-swap and the staff read marks unreadable ciphertext', async () => {
  const deps = dependencies({ getLiveLink: jest.fn(async () => row()), unseal: () => { throw new Error('rotated'); } });
  const unreadable = await getLivePresentationLink({ requestId: REQUEST_ID }, deps);
  expect(unreadable).toMatchObject({ id: LINK_ID, url: null, unreadable: true });

  await reissuePresentationLink({ requestId: REQUEST_ID, actorId: ACTOR_ID, expectedLinkId: LINK_ID }, deps);
  expect(deps.replaceLiveLink).toHaveBeenCalledWith(
    REQUEST_ID,
    expect.any(Object),
    { revokedBy: ACTOR_ID, expectedLiveId: LINK_ID },
  );
});

test.each([
  ['expired', () => row({ expires_at: new Date('2026-09-25T11:59:59.000Z') })],
  ['unreadable', () => row({ token_ciphertext: 'sealed:not-the-hashed-token' })],
])('ensure replaces an %s live row instead of reusing it', async (_label, existingRow) => {
  const deps = dependencies({ getLiveLink: jest.fn(async () => existingRow()) });
  const result = await ensureLivePresentationLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(result.reused).toBe(false);
  expect(deps.replaceLiveLink).toHaveBeenCalledWith(
    REQUEST_ID,
    expect.any(Object),
    { revokedBy: ACTOR_ID, expectedLiveId: LINK_ID },
  );
  expect(deps.insertLink).not.toHaveBeenCalled();
});

test('ensure adopts the readable winner after a concurrent first insert', async () => {
  const winner = row();
  const deps = dependencies({
    getLiveLink: jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner),
    insertLink: jest.fn(async () => { throw Object.assign(new Error('unique'), { code: '23505' }); }),
  });
  const result = await ensureLivePresentationLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(result).toMatchObject({ reused: true, link: { id: LINK_ID } });
});

test('ensure adopts the readable winner after a concurrent compare-and-swap replacement', async () => {
  const inspected = row();
  const winner = row({
    id: '55555555-5555-4555-8555-555555555555',
    token_digest: hashToken('jwt-two'),
    token_ciphertext: 'sealed:jwt-two',
  });
  const deps = dependencies({
    getLiveLink: jest.fn()
      .mockResolvedValueOnce(inspected)
      .mockResolvedValueOnce(winner),
    unseal: jest.fn()
      .mockImplementationOnce(() => null)
      .mockImplementation((value) => value.replace('sealed:', '')),
    replaceLiveLink: jest.fn(async () => {
      throw Object.assign(new Error('superseded'), { code: 'presentation_link_superseded' });
    }),
  });
  const result = await ensureLivePresentationLink({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);
  expect(result).toMatchObject({ reused: true, link: { id: winner.id } });
});

test('presentation verifier enforces its audience, durable row, revocation, expiry, and rollout request', async () => {
  process.env.EXTERNAL_LINK_SECRET = 'presentation-link-test-secret-is-long-enough';
  const expiresAt = new Date(Date.now() + 60_000);
  const minted = await mintScopedToken({
    subject: REQUEST_ID,
    audience: PRESENTATION_AUDIENCE,
    ops: ['view_presentation_materials'],
    expiresAt,
  });
  const stored = row({ token_digest: minted.hash, expires_at: expiresAt });
  const deps = {
    schemaReady: () => true,
    requestAllowed: () => true,
    getLinkByDigest: jest.fn(async () => stored),
    now: () => new Date(),
  };
  await expect(verifyPresentationToken(minted.jwt, deps)).resolves.toMatchObject({ ok: true, requestId: REQUEST_ID });
  await expect(verifyPresentationToken(minted.jwt, { ...deps, schemaReady: () => false }))
    .resolves.toEqual({ ok: false, reason: 'not_found' });
  await expect(verifyBriefingToken(minted.jwt, {
    schemaReady: () => true,
    getLinkByDigest: jest.fn(),
    now: () => new Date(),
  })).resolves.toEqual({ ok: false, reason: 'invalid_claim' });
  await expect(verifyPresentationToken(minted.jwt, { ...deps, requestAllowed: () => false }))
    .resolves.toEqual({ ok: false, reason: 'not_found' });
  await expect(verifyPresentationToken(minted.jwt, { ...deps, getLinkByDigest: async () => ({ ...stored, revoked_at: new Date() }) }))
    .resolves.toEqual({ ok: false, reason: 'revoked' });
  await expect(verifyPresentationToken(minted.jwt, {
    ...deps,
    getLinkByDigest: async () => ({ ...stored, expires_at: new Date('2026-09-25T11:59:59.000Z') }),
  })).resolves.toEqual({ ok: false, reason: 'expired' });
  const briefing = await mintScopedToken({ subject: REQUEST_ID, audience: 'briefing', ops: ['view_briefing'], expiresAt });
  await expect(verifyPresentationToken(briefing.jwt, deps)).resolves.toEqual({ ok: false, reason: 'invalid_claim' });

  const grantee = await mintScopedToken({ subject: REQUEST_ID, audience: 'grantee', ops: ['edit_abstract'], expiresAt });
  await expect(verifyPresentationToken(grantee.jwt, deps)).resolves.toEqual({ ok: false, reason: 'invalid_claim' });

  const reviewer = await mintToken({
    suggestionId: '55555555-5555-4555-8555-555555555555',
    requestId: REQUEST_ID,
    ops: ['download_proposal'],
    expiresAt,
  });
  await expect(verifyPresentationToken(reviewer.jwt, deps)).resolves.toEqual({ ok: false, reason: 'invalid_claim' });
  await expect(verifyGranteeToken(minted.jwt)).resolves.toEqual({ ok: false, reason: 'invalid_claim' });
  await expect(verifySuggestionToken(minted.jwt)).resolves.toEqual({ ok: false, reason: 'not_found' });
});
