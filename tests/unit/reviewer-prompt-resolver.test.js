/**
 * Unit tests for the reviewer-finder prompt resolver (S222).
 * Covers the three-tier precedence, fail-loud-vs-fallback on store errors,
 * stale-override detection, and runtime validation of resolved bodies.
 *
 * Bodies must be VALID (the resolver now validates them via prompt-validators):
 * an invalid override is ignored and an invalid Dataverse body degrades to the
 * code template. We build valid bodies by appending a marker to the real
 * template (all required labels/placeholders survive).
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
const validBody = (mark) => `${ANALYZE_USER_PROMPT_TEMPLATE}\n${mark}`;
const DV_BODY = validBody('DV-MARK');
const OVERRIDE_BODY = validBody('OVERRIDE-MARK');

function dvRow({ body = DV_BODY, version = 3, id = 'row-1' } = {}) {
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
  it('uses the (valid) Dataverse current row when no override', async () => {
    fetchCurrentPrompt.mockResolvedValue(dvRow({ version: 5, id: 'r5' }));
    const r = await resolveReviewerPrompt(NAME, { userProfileId: 'u1' });
    expect(r).toMatchObject({ body: DV_BODY, source: 'dataverse', promptId: 'r5', version: 5, overrideUsed: false, staleOverride: null });
  });

  it('a valid per-user override wins over Dataverse', async () => {
    fetchCurrentPrompt.mockResolvedValue(dvRow({ version: 5 }));
    DatabaseService.getUserPreferences.mockResolvedValue(
      overridePref({ body: OVERRIDE_BODY, basePromptId: 'r5', baseVersion: 5 }));
    const r = await resolveReviewerPrompt(NAME, { userProfileId: 'u1' });
    expect(r).toMatchObject({ body: OVERRIDE_BODY, source: 'override', overrideUsed: true, version: 5, staleOverride: null });
  });

  it('flags a stale override when baseVersion < current', async () => {
    fetchCurrentPrompt.mockResolvedValue(dvRow({ version: 7 }));
    DatabaseService.getUserPreferences.mockResolvedValue(
      overridePref({ body: OVERRIDE_BODY, basePromptId: 'r3', baseVersion: 3 }));
    const r = await resolveReviewerPrompt(NAME, { userProfileId: 'u1' });
    expect(r.overrideUsed).toBe(true);
    expect(r.staleOverride).toEqual({ baseVersion: 3, currentVersion: 7 });
  });

  it('ignores a malformed (unparseable) override and falls to Dataverse', async () => {
    fetchCurrentPrompt.mockResolvedValue(dvRow());
    DatabaseService.getUserPreferences.mockResolvedValue({ [PREFERENCE_KEYS.PROMPT_OVERRIDES]: '{not json' });
    const r = await resolveReviewerPrompt(NAME, { userProfileId: 'u1' });
    expect(r).toMatchObject({ source: 'dataverse', overrideUsed: false });
  });
});

describe('resolveReviewerPrompt — runtime body validation (Codex post-impl P1)', () => {
  it('IGNORES an invalid override (missing {{proposal_text}}) and falls to Dataverse', async () => {
    fetchCurrentPrompt.mockResolvedValue(dvRow());
    DatabaseService.getUserPreferences.mockResolvedValue(
      overridePref({ body: 'I broke the prompt and removed the placeholder', basePromptId: 'r1', baseVersion: 1 }));
    const r = await resolveReviewerPrompt(NAME, { userProfileId: 'u1' });
    expect(r.overrideUsed).toBe(false);
    expect(r.source).toBe('dataverse');
    expect(Array.isArray(r.overrideRejected)).toBe(true);
  });

  it('DEGRADES to the code template when the Dataverse body is invalid (loud reason)', async () => {
    fetchCurrentPrompt.mockResolvedValue(dvRow({ body: 'garbage body, no labels or placeholders', version: 9 }));
    const r = await resolveReviewerPrompt(NAME, { userProfileId: null });
    expect(r.source).toBe('code-fallback');
    expect(r.body).toBe(ANALYZE_USER_PROMPT_TEMPLATE);
    expect(r.fallbackReason).toMatch(/dataverse-body-invalid/);
  });
});

describe('resolveReviewerPrompt — fail-loud vs transient fallback', () => {
  it('falls back to the code template on a TRANSIENT Dataverse error (no override)', async () => {
    fetchCurrentPrompt.mockRejectedValue(new Error('network down'));
    const r = await resolveReviewerPrompt(NAME, { userProfileId: null });
    expect(r.source).toBe('code-fallback');
    expect(r.body).toBe(ANALYZE_USER_PROMPT_TEMPLATE);
    expect(r.fallbackReason).toContain('network down');
  });

  it('still applies a valid override on a transient Dataverse error (staleness unknown)', async () => {
    fetchCurrentPrompt.mockRejectedValue(new Error('timeout'));
    DatabaseService.getUserPreferences.mockResolvedValue(
      overridePref({ body: OVERRIDE_BODY, basePromptId: 'rX', baseVersion: 4 }));
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
