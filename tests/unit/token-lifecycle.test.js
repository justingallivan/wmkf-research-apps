/**
 * Tests for the token-lifecycle helper (mintAndStore + revoke).
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { mintAndStore, revoke, buildExternalUrl, getReviewerPortalBaseUrl, ensureToken, extendForPostSubmissionWindow } from '../../lib/external/token-lifecycle.js';
import { hashToken } from '../../lib/services/external-token.js';

const SECRET = 'test-secret-32-chars-min-aaaaaaaaaaaa';
const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';
const REQUEST_ID = '22222222-2222-2222-2222-222222222222';

let originalUpdate;
let originalGetRecord;
let originalSecret;
let originalNextauth;
let originalReviewerPortalBaseUrl;

describe('token-lifecycle', () => {
  beforeEach(() => {
    originalSecret = process.env.EXTERNAL_LINK_SECRET;
    originalNextauth = process.env.NEXTAUTH_URL;
    originalReviewerPortalBaseUrl = process.env.REVIEWER_PORTAL_BASE_URL;
    process.env.EXTERNAL_LINK_SECRET = SECRET;
    process.env.NEXTAUTH_URL = 'https://reviewer.example.com';
    delete process.env.REVIEWER_PORTAL_BASE_URL;
    originalUpdate = DynamicsService.updateRecord;
    originalGetRecord = DynamicsService.getRecord;
    DynamicsService.updateRecord = jest.fn().mockResolvedValue({});
    DynamicsService.getRecord = jest.fn();
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.EXTERNAL_LINK_SECRET;
    else process.env.EXTERNAL_LINK_SECRET = originalSecret;
    if (originalNextauth === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalNextauth;
    if (originalReviewerPortalBaseUrl === undefined) delete process.env.REVIEWER_PORTAL_BASE_URL;
    else process.env.REVIEWER_PORTAL_BASE_URL = originalReviewerPortalBaseUrl;
    DynamicsService.updateRecord = originalUpdate;
    DynamicsService.getRecord = originalGetRecord;
  });

  describe('mintAndStore', () => {
    test('mints a JWT, persists hash + timestamps, clears revoked, returns URL', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const result = await mintAndStore({
        suggestionId: SUGGESTION_ID,
        requestId: REQUEST_ID,
        expiresAt,
      });

      expect(typeof result.jwt).toBe('string');
      expect(result.jwt.split('.')).toHaveLength(3);
      expect(result.hash).toBe(hashToken(result.jwt));
      expect(result.url).toBe(`https://reviewer.example.com/external/review/${result.jwt}`);

      expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(1);
      const [entitySet, id, patch] = DynamicsService.updateRecord.mock.calls[0];
      expect(entitySet).toBe('wmkf_appreviewersuggestions');
      expect(id).toBe(SUGGESTION_ID);
      expect(patch.wmkf_externaltokenhash).toBe(result.hash);
      expect(patch.wmkf_externaltokenexpires).toBe(expiresAt.toISOString());
      expect(patch.wmkf_externaltokenrevoked).toBe(false);
      expect(typeof patch.wmkf_externaltokenissued).toBe('string');
    });

    test('rejects missing args', async () => {
      await expect(
        mintAndStore({ suggestionId: '', requestId: REQUEST_ID, expiresAt: new Date(Date.now() + 1000) }),
      ).rejects.toThrow(/suggestionId required/);
      await expect(
        mintAndStore({ suggestionId: SUGGESTION_ID, requestId: '', expiresAt: new Date(Date.now() + 1000) }),
      ).rejects.toThrow(/requestId required/);
      await expect(
        mintAndStore({ suggestionId: SUGGESTION_ID, requestId: REQUEST_ID, expiresAt: 'not-a-date' }),
      ).rejects.toThrow(/expiresAt must be a valid Date/);
    });
  });

  describe('revoke', () => {
    test('PATCHes wmkf_externaltokenrevoked = true', async () => {
      await revoke(SUGGESTION_ID);
      expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
        'wmkf_appreviewersuggestions',
        SUGGESTION_ID,
        { wmkf_externaltokenrevoked: true },
        { actingUserSystemId: undefined },
      );
    });

    test('rejects missing id', async () => {
      await expect(revoke()).rejects.toThrow(/suggestionId required/);
    });
  });

  describe('ensureToken', () => {
    function row({ hash = null, revoked = false, expires = null } = {}) {
      return {
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_externaltokenhash: hash,
        wmkf_externaltokenrevoked: revoked,
        wmkf_externaltokenexpires: expires,
        _wmkf_request_value: REQUEST_ID,
      };
    }

    test('mints when no hash exists', async () => {
      DynamicsService.getRecord.mockResolvedValue(row());
      const result = await ensureToken(SUGGESTION_ID);
      expect(result.minted).toBe(true);
      expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(1);
    });

    test('skips when an active token exists (idempotent)', async () => {
      DynamicsService.getRecord.mockResolvedValue(row({
        hash: 'a'.repeat(64),
        expires: new Date(Date.now() + 60_000).toISOString(),
      }));
      const result = await ensureToken(SUGGESTION_ID);
      expect(result).toEqual({ minted: false, reason: 'already_active' });
      expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
    });

    test('re-mints when prior token was revoked', async () => {
      DynamicsService.getRecord.mockResolvedValue(row({
        hash: 'a'.repeat(64),
        revoked: true,
        expires: new Date(Date.now() + 60_000).toISOString(),
      }));
      const result = await ensureToken(SUGGESTION_ID);
      expect(result.minted).toBe(true);
      expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(1);
      const patch = DynamicsService.updateRecord.mock.calls[0][2];
      expect(patch.wmkf_externaltokenrevoked).toBe(false);
    });

    test('re-mints when prior token expired', async () => {
      DynamicsService.getRecord.mockResolvedValue(row({
        hash: 'a'.repeat(64),
        expires: new Date(Date.now() - 60_000).toISOString(),
      }));
      const result = await ensureToken(SUGGESTION_ID);
      expect(result.minted).toBe(true);
    });

    test('returns no_request when suggestion has no linked request', async () => {
      DynamicsService.getRecord.mockResolvedValue({
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_externaltokenhash: null,
        _wmkf_request_value: null,
      });
      const result = await ensureToken(SUGGESTION_ID);
      expect(result).toEqual({ minted: false, reason: 'no_request' });
      expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
    });

    test('rejects missing id', async () => {
      await expect(ensureToken()).rejects.toThrow(/suggestionId required/);
    });
  });

  describe('extendForPostSubmissionWindow', () => {
    test('rejects missing id', async () => {
      await expect(extendForPostSubmissionWindow()).rejects.toThrow(/suggestionId required/);
    });

    test('rejects non-positive days', async () => {
      await expect(extendForPostSubmissionWindow(SUGGESTION_ID, { days: 0 }))
        .rejects.toThrow(/days must be a positive number/);
      await expect(extendForPostSubmissionWindow(SUGGESTION_ID, { days: -3 }))
        .rejects.toThrow(/days must be a positive number/);
      await expect(extendForPostSubmissionWindow(SUGGESTION_ID, { days: 'seven' }))
        .rejects.toThrow(/days must be a positive number/);
    });

    test('PATCHes only wmkf_externaltokenexpires (~now+7 days by default)', async () => {
      const before = Date.now();
      const result = await extendForPostSubmissionWindow(SUGGESTION_ID);
      const after = Date.now();

      expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(1);
      const [entitySet, id, patch] = DynamicsService.updateRecord.mock.calls[0];
      expect(entitySet).toBe('wmkf_appreviewersuggestions');
      expect(id).toBe(SUGGESTION_ID);
      // Critical: patch must contain ONLY the expiry field. Mutating
      // wmkf_externaltokenrevoked or wmkf_externaltokenhash here would
      // collapse two separate state axes (expiry vs. revocation vs.
      // identity) into one write — easy to do, hard to debug.
      expect(Object.keys(patch)).toEqual(['wmkf_externaltokenexpires']);

      const expiresMs = new Date(patch.wmkf_externaltokenexpires).getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000 - 1000);
      expect(expiresMs).toBeLessThanOrEqual(after + 7 * 24 * 60 * 60 * 1000 + 1000);
      expect(result.expiresAt.getTime()).toBe(expiresMs);
    });

    test('honors a custom days override', async () => {
      const before = Date.now();
      await extendForPostSubmissionWindow(SUGGESTION_ID, { days: 14 });
      const after = Date.now();
      const expiresMs = new Date(
        DynamicsService.updateRecord.mock.calls[0][2].wmkf_externaltokenexpires,
      ).getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 14 * 24 * 60 * 60 * 1000 - 1000);
      expect(expiresMs).toBeLessThanOrEqual(after + 14 * 24 * 60 * 60 * 1000 + 1000);
    });

    test('successive calls bump the window forward (now-relative)', async () => {
      await extendForPostSubmissionWindow(SUGGESTION_ID);
      const first = new Date(
        DynamicsService.updateRecord.mock.calls[0][2].wmkf_externaltokenexpires,
      ).getTime();
      await new Promise(r => setTimeout(r, 25));
      await extendForPostSubmissionWindow(SUGGESTION_ID);
      const second = new Date(
        DynamicsService.updateRecord.mock.calls[1][2].wmkf_externaltokenexpires,
      ).getTime();
      expect(second).toBeGreaterThan(first);
      expect(second - first).toBeLessThan(1000);
    });
  });

  describe('buildExternalUrl', () => {
    test('joins REVIEWER_PORTAL_BASE_URL and the JWT when configured', () => {
      process.env.REVIEWER_PORTAL_BASE_URL = 'https://reviews.wmkeck.org';
      expect(buildExternalUrl('abc.def.ghi')).toBe(
        'https://reviews.wmkeck.org/external/review/abc.def.ghi',
      );
    });

    test('falls back to NEXTAUTH_URL and the JWT', () => {
      expect(buildExternalUrl('abc.def.ghi')).toBe(
        'https://reviewer.example.com/external/review/abc.def.ghi',
      );
    });

    test('strips trailing slash on the base', () => {
      process.env.REVIEWER_PORTAL_BASE_URL = 'https://reviews.wmkeck.org/';
      expect(buildExternalUrl('xyz')).toBe('https://reviews.wmkeck.org/external/review/xyz');
    });

    test('reports the configured reviewer portal base URL', () => {
      process.env.REVIEWER_PORTAL_BASE_URL = 'https://reviews.wmkeck.org/';
      expect(getReviewerPortalBaseUrl()).toBe('https://reviews.wmkeck.org');
    });
  });
});
