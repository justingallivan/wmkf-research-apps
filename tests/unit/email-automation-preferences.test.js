/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  requireAuthWithProfile: jest.fn(async () => 7),
}));
jest.mock('../../lib/services/database-service', () => ({
  DatabaseService: {
    getUserPreferences: jest.fn(),
    setUserPreference: jest.fn(),
  },
}));

import handler from '../../pages/api/email-automation-preferences';
import { DatabaseService } from '../../lib/services/database-service';
import { hasTrustedDalContext } from '../../lib/dataverse/core/context';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences';
import { normalizeEmailAutomationPreference } from '../../shared/config/emailAutomation';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(key, value) { this.headers[key] = value; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  DatabaseService.getUserPreferences.mockResolvedValue({});
  DatabaseService.setUserPreference.mockResolvedValue(true);
});

test('normalizes the review-all override and rejects every other shape', () => {
  expect(normalizeEmailAutomationPreference({ reviewAll: true })).toEqual({ reviewAll: true });
  expect(normalizeEmailAutomationPreference('{"reviewAll":false}')).toEqual({ reviewAll: false });
  // The retired mode/leadDays shape must NOT silently normalize.
  expect(normalizeEmailAutomationPreference({ mode: 'automatic' })).toBeNull();
  expect(normalizeEmailAutomationPreference({ mode: 'review', leadDays: 3 })).toBeNull();
  expect(normalizeEmailAutomationPreference({ reviewAll: 'yes' })).toBeNull();
  expect(normalizeEmailAutomationPreference('not json')).toBeNull();
  expect(normalizeEmailAutomationPreference(null)).toBeNull();
});

test('GET distinguishes an absent choice from an explicit override', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: {}, body: {} }, res);
  expect(res.body).toEqual({ configured: false, preference: null });
});

test('PUT validates and persists inside the trusted DAL context', async () => {
  let inside = false;
  DatabaseService.setUserPreference.mockImplementation(async () => {
    inside = hasTrustedDalContext();
    return true;
  });
  const res = mockRes();
  await handler({ method: 'PUT', query: {}, body: { reviewAll: true } }, res);
  expect(res.statusCode).toBe(200);
  expect(inside).toBe(true);
  expect(DatabaseService.setUserPreference).toHaveBeenCalledWith(
    7,
    PREFERENCE_KEYS.EMAIL_AUTOMATION,
    JSON.stringify({ reviewAll: true }),
    false,
  );
});

test('PUT rejects a malformed override before persistence', async () => {
  const res = mockRes();
  await handler({ method: 'PUT', query: {}, body: { mode: 'review', leadDays: 3 } }, res);
  expect(res.statusCode).toBe(400);
  expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
});
