/**
 * S333 bypass-strip Stage 4 characterization for lib/external/token-lifecycle.js:
 *
 * Stage 4a (nested-redundant REMOVAL) — sites 47 mintAndStore/external-token-mint,
 * 49 ensureToken/ensure-token-read, 50 extendForPostSubmissionWindow/
 * external-token-post-submission. Every real production caller of these three
 * functions was traced this session and confirmed to already wrap the WHOLE
 * call in an outer withDalContext (my-candidates.js 'my-candidates';
 * send-review-reminder.js / cron/reviewer-reminders.js
 * 'review-manager-send-review-reminder' / 'cron-reviewer-reminders';
 * render-emails.js 'review-manager-render'; regenerate-token.js
 * 'regenerate-token-lookup'; upload-review.js / external/review/[token]/upload.js
 * 'review-manager-upload' / 'external-upload'), so the functions' own local
 * withDalContext wrap was redundant nesting — removed.
 *
 * Stage 4b (entry-seam PUSH-UP) — site 48 revoke/external-token-revoke. Its
 * sole caller, pages/api/review-manager/revoke-token.js, established NO
 * context of its own — the function's local wrap was the only thing
 * providing trusted context. The wrap moved TO that route (same label,
 * relocated) and was removed from revoke() itself.
 *
 * Drives the REAL DynamicsService.updateRecord/getRecord (no dynamics-service
 * mock — the existing token-lifecycle.test.js / adapters-caller-id.test.js
 * mock DynamicsService's static methods directly, which bypasses
 * assertTrustedDalContext entirely and would pass identically whether or not
 * the wrap existed/moved; that blind spot is exactly why this file exists).
 * Negative controls prove the removed/relocated wrap was the only thing
 * establishing context for these functions in isolation; positive pins prove
 * the caller's context still reaches the write.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { withDalContext } from '../../lib/dataverse/core/context.js';
import { mintAndStore, ensureToken, extendForPostSubmissionWindow, revoke } from '../../lib/external/token-lifecycle.js';

const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';
const REQUEST_ID = '22222222-2222-2222-2222-222222222222';

beforeAll(() => {
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = 'c';
  process.env.DYNAMICS_CLIENT_SECRET = 's';
  process.env.EXTERNAL_LINK_SECRET = 'test-secret-32-chars-min-aaaaaaaaaaaa';
});

beforeEach(() => {
  DynamicsService.clearCaches();
});

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = jest.fn();
});

function mockFetchOk(body = {}) {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('login.microsoftonline.com')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
}

describe('token-lifecycle nested-redundant wrapper removal (S333 Stage 4a)', () => {
  describe('mintAndStore (site 47)', () => {
    test('negative control: called with no context, the write throws before any network call', async () => {
      const spy = jest.spyOn(global, 'fetch');
      await expect(
        mintAndStore({ suggestionId: SUGGESTION_ID, requestId: REQUEST_ID, expiresAt: new Date(Date.now() + 86400000) }),
      ).rejects.toThrow(/no trusted Dataverse context/);
      expect(spy).not.toHaveBeenCalled();
    });

    test('positive pin: succeeds when the CALLER establishes withDalContext (no local wrap needed)', async () => {
      mockFetchOk({ id: SUGGESTION_ID });
      await expect(
        withDalContext('my-candidates', () =>
          mintAndStore({ suggestionId: SUGGESTION_ID, requestId: REQUEST_ID, expiresAt: new Date(Date.now() + 86400000) }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('ensureToken (site 49, mint branch reaches mintAndStore internally)', () => {
    test('negative control: called with no context, the read itself rejects (no ambient context at all)', async () => {
      // Unlike the write-gate methods (assertTrustedDalContext, "no trusted
      // Dataverse context"), a plain read goes through the older
      // checkRestriction path, which requires SOME context object to exist at
      // all (even an untrusted one) to read ctx.restrictions — with the local
      // wrap removed and no outer context, there is none, so it fails closed
      // via a different message ("Restrictions not initialized"). Either
      // failure proves the same thing: no context, no read/write.
      const spy = jest.spyOn(global, 'fetch');
      await expect(ensureToken(SUGGESTION_ID)).rejects.toThrow(/Restrictions not initialized|no trusted Dataverse context/);
      expect(spy).not.toHaveBeenCalled();
    });

    test('positive pin: succeeds when the CALLER establishes withDalContext', async () => {
      mockFetchOk({ wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_request_value: REQUEST_ID, wmkf_applicantdisposition: null });
      await expect(
        withDalContext('my-candidates', () => ensureToken(SUGGESTION_ID)),
      ).resolves.toEqual({ minted: true });
    });
  });

  describe('extendForPostSubmissionWindow (site 50)', () => {
    test('negative control: called with no context, the write throws before any network call', async () => {
      const spy = jest.spyOn(global, 'fetch');
      await expect(extendForPostSubmissionWindow(SUGGESTION_ID)).rejects.toThrow(/no trusted Dataverse context/);
      expect(spy).not.toHaveBeenCalled();
    });

    test('positive pin: succeeds when the CALLER establishes withDalContext', async () => {
      mockFetchOk({ id: SUGGESTION_ID });
      await expect(
        withDalContext('review-manager-upload', () => extendForPostSubmissionWindow(SUGGESTION_ID)),
      ).resolves.toBeDefined();
    });
  });

  describe('revoke (site 48, Stage 4b entry-seam push-up)', () => {
    test('negative control: called with no context, the write throws before any network call', async () => {
      const spy = jest.spyOn(global, 'fetch');
      await expect(revoke(SUGGESTION_ID)).rejects.toThrow(/no trusted Dataverse context/);
      expect(spy).not.toHaveBeenCalled();
    });

    test('positive pin: succeeds when the CALLER (revoke-token.js) establishes withDalContext', async () => {
      mockFetchOk({ id: SUGGESTION_ID });
      await expect(
        withDalContext('external-token-revoke', () => revoke(SUGGESTION_ID)),
      ).resolves.toBeUndefined();
    });
  });
});
