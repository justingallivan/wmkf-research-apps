/**
 * Tests for the combined token + suggestion-row verifier.
 *
 * Covers the layer that lives on top of `verifyToken`: hash match against
 * the stored digest, revocation flag, expiry-passed, and not-found paths.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { mintToken } from '../../lib/services/external-token.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { verifySuggestionToken } from '../../lib/external/verify-suggestion-token.js';

const SECRET = 'test-secret-32-chars-min-aaaaaaaaaaaa';
const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';
const REQUEST_ID = '22222222-2222-2222-2222-222222222222';

let originalGetRecord;
let originalSecret;

function suggestionRow({ hash, revoked = false, expires = null, override = {} }) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    wmkf_externaltokenhash: hash,
    wmkf_externaltokenrevoked: revoked,
    wmkf_externaltokenexpires: expires,
    wmkf_proposalfirstaccessed: null,
    wmkf_reviewreceivedat: null,
    wmkf_reviewfilename: null,
    wmkf_Request: {
      akoya_requestid: REQUEST_ID,
      akoya_requestnum: '1001289',
      akoya_title: 'Test proposal',
    },
    wmkf_PotentialReviewer: {
      wmkf_potentialreviewersid: '33333333-3333-3333-3333-333333333333',
      wmkf_name: 'Dr. Test Reviewer',
    },
    ...override,
  };
}

describe('verifySuggestionToken', () => {
  beforeEach(() => {
    originalSecret = process.env.EXTERNAL_LINK_SECRET;
    process.env.EXTERNAL_LINK_SECRET = SECRET;
    originalGetRecord = DynamicsService.getRecord;
    DynamicsService.getRecord = jest.fn();
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.EXTERNAL_LINK_SECRET;
    else process.env.EXTERNAL_LINK_SECRET = originalSecret;
    DynamicsService.getRecord = originalGetRecord;
  });

  test('returns ok with suggestion + request + reviewer on happy path', async () => {
    const { jwt, hash } = await mintToken({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      ops: ['download_proposal', 'upload_review'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    DynamicsService.getRecord.mockResolvedValue(suggestionRow({ hash }));

    const result = await verifySuggestionToken(jwt);
    expect(result.ok).toBe(true);
    expect(result.suggestion.wmkf_appreviewersuggestionid).toBe(SUGGESTION_ID);
    expect(result.request.akoya_requestid).toBe(REQUEST_ID);
    expect(result.reviewer.wmkf_name).toBe('Dr. Test Reviewer');
  });

  test('rejects missing token', async () => {
    const result = await verifySuggestionToken(undefined);
    expect(result).toEqual({ ok: false, reason: 'no_token' });
  });

  test('rejects expired JWT before any Dataverse call', async () => {
    // Mint with a future expiry, then time-travel so jose sees it expired.
    const { jwt } = await mintToken({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      ops: ['download_proposal'],
      expiresAt: new Date(Date.now() + 1000),
    });
    await new Promise(r => setTimeout(r, 1100));
    const result = await verifySuggestionToken(jwt);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  });

  test('rejects when suggestion has no stored hash', async () => {
    const { jwt } = await mintToken({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      ops: ['upload_review'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    DynamicsService.getRecord.mockResolvedValue(suggestionRow({ hash: null }));
    const result = await verifySuggestionToken(jwt);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test('rejects on hash mismatch (replaced token)', async () => {
    const { jwt } = await mintToken({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      ops: ['upload_review'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    DynamicsService.getRecord.mockResolvedValue(
      suggestionRow({ hash: 'a'.repeat(64) }),
    );
    const result = await verifySuggestionToken(jwt);
    expect(result).toEqual({ ok: false, reason: 'hash_mismatch' });
  });

  test('rejects revoked tokens', async () => {
    const { jwt, hash } = await mintToken({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      ops: ['upload_review'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    DynamicsService.getRecord.mockResolvedValue(
      suggestionRow({ hash, revoked: true }),
    );
    const result = await verifySuggestionToken(jwt);
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });

  test('rejects an applicant-excluded row even with a valid live token', async () => {
    // 100000001 = APPLICANT_DISPOSITION_EXCLUDED. A token minted before the row
    // was excluded must still fail closed at this single external chokepoint;
    // reported as `revoked` so the distinction isn't leaked.
    const { jwt, hash } = await mintToken({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      ops: ['upload_review'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    DynamicsService.getRecord.mockResolvedValue(
      suggestionRow({ hash, override: { wmkf_applicantdisposition: 100000001 } }),
    );
    const result = await verifySuggestionToken(jwt);
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });

  test('rejects when row-level expires has passed even if JWT exp is later', async () => {
    const { jwt, hash } = await mintToken({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      ops: ['upload_review'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    DynamicsService.getRecord.mockResolvedValue(
      suggestionRow({
        hash,
        expires: new Date(Date.now() - 1000).toISOString(),
      }),
    );
    const result = await verifySuggestionToken(jwt);
    expect(result).toEqual({ ok: false, reason: 'token_expires_passed' });
  });

  test('maps Dataverse 404 to not_found', async () => {
    const { jwt } = await mintToken({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      ops: ['upload_review'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    DynamicsService.getRecord.mockRejectedValue(
      new Error('Get record failed (404): {"error":{"message":"not found"}}'),
    );
    const result = await verifySuggestionToken(jwt);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test('returns not_found when suggestion has no expanded request', async () => {
    const { jwt, hash } = await mintToken({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      ops: ['upload_review'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    DynamicsService.getRecord.mockResolvedValue(
      suggestionRow({
        hash,
        override: { wmkf_Request: null },
      }),
    );
    const result = await verifySuggestionToken(jwt);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});
