/**
 * @jest-environment node
 *
 * Q9 Stage 1e: /api/reviewer-finder/prompt-override must cover preference
 * reads/writes with DAL context, not only the base prompt Dataverse read.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 5 })),
}));
jest.mock('../../lib/services/prompt-store', () => ({
  fetchCurrentPrompt: jest.fn(async () => ({
    wmkf_ai_promptbody: 'BASE',
    wmkf_promptversion: 4,
    wmkf_ai_promptid: 'prompt-4',
  })),
  PROMPT_STORE_ERROR_CODES: {
    NOT_FOUND: 'PROMPT_NOT_FOUND',
    DUPLICATE_CURRENT: 'PROMPT_DUPLICATE_CURRENT',
  },
}));
jest.mock('../../lib/services/database-service', () => ({
  DatabaseService: {
    getUserPreferences: jest.fn(),
    setUserPreference: jest.fn(),
  },
}));

import handler from '../../pages/api/reviewer-finder/prompt-override';
import { hasTrustedDalContext } from '../../lib/dataverse/core/context';
import { DatabaseService } from '../../lib/services/database-service';
import { REVIEWER_PROMPT_NAMES } from '../../lib/services/reviewer-prompt-resolver';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences';
import { ANALYZE_USER_PROMPT_TEMPLATE } from '../../shared/config/prompts/reviewer-finder-dynamics';

const NAME = REVIEWER_PROMPT_NAMES.ANALYZE;
const VALID_BODY = `${ANALYZE_USER_PROMPT_TEMPLATE}\nEDIT`;

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  DatabaseService.getUserPreferences.mockResolvedValue({});
  DatabaseService.setUserPreference.mockResolvedValue(true);
});

test('GET override preference read executes inside trusted DAL context', async () => {
  const seen = { inside: null };
  DatabaseService.getUserPreferences.mockImplementation(async () => {
    seen.inside = hasTrustedDalContext();
    return {};
  });

  const res = mockRes();
  await handler({ method: 'GET', query: { name: NAME }, body: {} }, res);

  expect(res.statusCode).toBe(200);
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});

test('PUT override preference write executes inside trusted DAL context', async () => {
  const seen = { readInside: null, writeInside: null };
  DatabaseService.getUserPreferences.mockImplementation(async () => {
    seen.readInside = hasTrustedDalContext();
    return {};
  });
  DatabaseService.setUserPreference.mockImplementation(async () => {
    seen.writeInside = hasTrustedDalContext();
    return true;
  });

  const res = mockRes();
  await handler({ method: 'PUT', query: {}, body: { name: NAME, body: VALID_BODY } }, res);

  expect(res.statusCode).toBe(200);
  expect(DatabaseService.setUserPreference.mock.calls[0][1]).toBe(PREFERENCE_KEYS.PROMPT_OVERRIDES);
  expect(seen.readInside).toBe(true);
  expect(seen.writeInside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});
