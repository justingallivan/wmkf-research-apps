/**
 * @jest-environment node
 */
/**
 * /api/reviewer-finder/prompt-override (S222) — grant-gated per-user override
 * GET/PUT/DELETE with body validation, name gating, and stale-override flagging.
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 5 })) }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (labelOrFn, maybeFn) => (typeof labelOrFn === 'function' ? labelOrFn() : maybeFn()),
}));
jest.mock('../../lib/services/prompt-store', () => ({
  fetchCurrentPrompt: jest.fn(),
  PROMPT_STORE_ERROR_CODES: { NOT_FOUND: 'PROMPT_NOT_FOUND', DUPLICATE_CURRENT: 'PROMPT_DUPLICATE_CURRENT' },
}));
jest.mock('../../lib/services/database-service', () => ({
  DatabaseService: { getUserPreferences: jest.fn(async () => ({})), setUserPreference: jest.fn(async () => true) },
}));

import handler from '../../pages/api/reviewer-finder/prompt-override';
import { fetchCurrentPrompt } from '../../lib/services/prompt-store';
import { DatabaseService } from '../../lib/services/database-service';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences';
import { ANALYZE_USER_PROMPT_TEMPLATE } from '../../shared/config/prompts/reviewer-finder-dynamics';

const NAME = 'reviewer-finder.analyze';
const VALID = `${ANALYZE_USER_PROMPT_TEMPLATE}\nEDIT`;

function res() { return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }

beforeEach(() => {
  fetchCurrentPrompt.mockReset().mockResolvedValue({ wmkf_ai_promptbody: ANALYZE_USER_PROMPT_TEMPLATE, wmkf_promptversion: 4, wmkf_ai_promptid: 'r4' });
  DatabaseService.getUserPreferences.mockReset().mockResolvedValue({});
  DatabaseService.setUserPreference.mockReset().mockResolvedValue(true);
});

describe('GET', () => {
  it('returns the base template + null override', async () => {
    const r = res();
    await handler({ method: 'GET', query: { name: NAME } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.templateBody).toBe(ANALYZE_USER_PROMPT_TEMPLATE);
    expect(r.body.version).toBe(4);
    expect(r.body.userOverride).toBeNull();
  });

  it('flags a stale override (baseVersion < current)', async () => {
    DatabaseService.getUserPreferences.mockResolvedValue({
      [PREFERENCE_KEYS.PROMPT_OVERRIDES]: JSON.stringify({ [NAME]: { body: VALID, baseVersion: 2, basePromptId: 'r2' } }),
    });
    const r = res();
    await handler({ method: 'GET', query: { name: NAME } }, r);
    expect(r.body.staleOverride).toEqual({ baseVersion: 2, currentVersion: 4 });
  });

  it('rejects an unknown prompt name (400)', async () => {
    const r = res();
    await handler({ method: 'GET', query: { name: 'bogus' } }, r);
    expect(r.statusCode).toBe(400);
  });
});

describe('PUT', () => {
  it('saves a valid override with base metadata', async () => {
    const r = res();
    await handler({ method: 'PUT', query: {}, body: { name: NAME, body: VALID } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.success).toBe(true);
    const [, key, value] = DatabaseService.setUserPreference.mock.calls[0];
    expect(key).toBe(PREFERENCE_KEYS.PROMPT_OVERRIDES);
    const saved = JSON.parse(value)[NAME];
    expect(saved.body).toBe(VALID);
    expect(saved.baseVersion).toBe(4);
    expect(saved.basePromptId).toBe('r4');
    expect(typeof saved.updatedAt).toBe('string');
  });

  it('rejects an invalid body (400 invalid_body, no write)', async () => {
    const r = res();
    await handler({ method: 'PUT', query: {}, body: { name: NAME, body: 'broke it' } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.status).toBe('invalid_body');
    expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
  });
});

describe('DELETE', () => {
  it('removes the override for the prompt', async () => {
    DatabaseService.getUserPreferences.mockResolvedValue({
      [PREFERENCE_KEYS.PROMPT_OVERRIDES]: JSON.stringify({ [NAME]: { body: VALID, baseVersion: 4 }, 'reviewer-finder.score-candidates': { body: 'x', baseVersion: 1 } }),
    });
    const r = res();
    await handler({ method: 'DELETE', query: {}, body: { name: NAME } }, r);
    expect(r.statusCode).toBe(200);
    const saved = JSON.parse(DatabaseService.setUserPreference.mock.calls[0][2]);
    expect(saved[NAME]).toBeUndefined();
    expect(saved['reviewer-finder.score-candidates']).toBeDefined();
  });
});
