/**
 * Unit tests for the reviewer-finder prompt resolver (S222).
 * Covers the three-tier precedence, fail-loud-vs-fallback on store errors,
 * and stale-override detection.
 */
jest.mock('../../lib/services/dynamics-context.js', () => ({
  bypassDynamicsRestrictions: (labelOrFn, maybeFn) =>
    (typeof labelOrFn === 'function' ? labelOrFn() : maybeFn()),
}));
jest.mock('../../lib/services/prompt-store.js', () => ({
  fetchCurrentPrompt: jest.fn(),
  PROMPT_STORE_ERROR_CODES: { NOT_FOUND: 'PROMPT_NOT_FOUND', DUPLICATE_CURRENT: 'PROMPT_DUPLICATE_CURRENT' },
}));
jest.mock('../../lib/services/database-service.js', () => ({
  DatabaseService: { getUserPreferences: jest.fn() },
}));

import { fetchCurrentPrompt } from '../../lib/services/prompt-store.js';
import { DatabaseService } from '../../lib/services/database-service.js';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences.js';
import {
  resolveReviewerPrompt,
  REVIEWER_PROMPT_NAMES,
} from '../../lib/services/reviewer-prompt-resolver.js';
import { ANALYZE_USER_PROMPT_TEMPLATE } from '../../shared/config/prompts/reviewer-finder-dynamics.js';

const NAME = REVIEWER_PROMPT_NAMES.ANALYZE;

function dvRow({ body = 'DV BODY {{proposal_text}}', version = 3, id = 'row-1' } = {}) {
  return { wmkf_ai_promptid: id, wmkf_ai_promptbody: body, wmkf_promptversion: version };
}
function typedError(code) {
  const e = new Error(code); e.code = code; return e;
}
function overridePref(entry) {
  return { [PREFERENCE_KEYS.PROMPT_OVERRIDES]: JSON.stringify({ [NAME]: entry }) };
}

beforeEach(() => {
  fetchCurrentPrompt.mockReset();
  DatabaseService.getUserPreferences.mockReset();
  DatabaseService.getUserPreferences.mockResolvedValue({});
});

describe('resolveReviewerPrompt — tiers', () => {
  it('uses the Dataverse current row when no override', async () => {
    fetchCurrentPrompt.mockResolvedValue(dvRow({ body: 'DV', version: 5, id: 'r5' }));
    const r = await resolveReviewerPrompt(NAME, { userProfileId: 'u1' });
    expect(r).toMatchObject({ body: 'DV', source: 'dataverse', promptId: 'r5', version: 5, overrideUsed: false, staleOverride: null });
  });

  it('per-user override wins over Dataverse', async () => {
    fetchCurrentPrompt.mockResolvedValue(dvRow({ version: 5 }));
    DatabaseService.getUserPreferences.mockResolvedValue(
      overridePref({ body: 'MY BODY', basePromptId: 'r5', baseVersion: 5 }));
    const r = await resolveReviewerPrompt(NAME, { userProfileId: 'u1' });
    expect(r).toMatchObject({ body: 'MY BODY', source: 'override', overrideUsed: true, version: 5, staleOverride: null });
  });

  it('flags a stale override when baseVersion < current', async () => {
    fetchCurrentPrompt.mockResolvedValue(dvRow({ version: 7 }));
    DatabaseService.getUserPreferences.mockResolvedValue(
      overridePref({ body: 'OLD EDIT', basePromptId: 'r3', baseVersion: 3 }));
    const r = await resolveReviewerPrompt(NAME, { userProfileId: 'u1' });
    expect(r.overrideUsed).toBe(true);
    expect(r.staleOverride).toEqual({ baseVersion: 3, currentVersion: 7 });
  });

  it('ignores a malformed override and falls to Dataverse', async () => {
    fetchCurrentPrompt.mockResolvedValue(dvRow({ body: 'DV', version: 2 }));
    DatabaseService.getUserPreferences.mockResolvedValue({ [PREFERENCE_KEYS.PROMPT_OVERRIDES]: '{not json' });
    const r = await resolveReviewerPrompt(NAME, { userProfileId: 'u1' });
    expect(r).toMatchObject({ source: 'dataverse', overrideUsed: false });
  });
});

describe('resolveReviewerPrompt — fail-loud vs fallback', () => {
  it('falls back to the code template on a TRANSIENT Dataverse error (no override)', async () => {
    fetchCurrentPrompt.mockRejectedValue(new Error('network down'));
    const r = await resolveReviewerPrompt(NAME, { userProfileId: null });
    expect(r.source).toBe('code-fallback');
    expect(r.body).toBe(ANALYZE_USER_PROMPT_TEMPLATE);
    expect(r.fallbackReason).toContain('network down');
  });

  it('still applies an override on a transient Dataverse error (staleness unknown)', async () => {
    fetchCurrentPrompt.mockRejectedValue(new Error('timeout'));
    DatabaseService.getUserPreferences.mockResolvedValue(
      overridePref({ body: 'MINE', basePromptId: 'rX', baseVersion: 4 }));
    const r = await resolveReviewerPrompt(NAME, { userProfileId: 'u1' });
    expect(r).toMatchObject({ source: 'override', overrideUsed: true, staleOverride: null });
    expect(r.fallbackReason).toContain('timeout');
  });

  it('FAILS LOUD on PROMPT_DUPLICATE_CURRENT (structural corruption)', async () => {
    fetchCurrentPrompt.mockRejectedValue(typedError('PROMPT_DUPLICATE_CURRENT'));
    await expect(resolveReviewerPrompt(NAME, { userProfileId: 'u1' }))
      .rejects.toMatchObject({ code: 'PROMPT_DUPLICATE_CURRENT' });
  });

  it('FAILS LOUD on PROMPT_NOT_FOUND (0 current rows)', async () => {
    fetchCurrentPrompt.mockRejectedValue(typedError('PROMPT_NOT_FOUND'));
    await expect(resolveReviewerPrompt(NAME, { userProfileId: 'u1' }))
      .rejects.toMatchObject({ code: 'PROMPT_NOT_FOUND' });
  });

  it('throws on an unknown prompt name', async () => {
    await expect(resolveReviewerPrompt('bogus.prompt', {})).rejects.toThrow(/unknown prompt name/);
  });
});
