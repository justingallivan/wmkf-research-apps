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
import {
  EMAIL_AUTOMATION_MODE,
  calculateReviewAvailableAt,
  normalizeEmailAutomationPreference,
} from '../../shared/config/emailAutomation';

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

test('normalizes the two explicit modes and rejects unsafe review windows', () => {
  expect(normalizeEmailAutomationPreference({ mode: 'automatic', leadDays: 99 }))
    .toEqual({ mode: EMAIL_AUTOMATION_MODE.AUTOMATIC });
  expect(normalizeEmailAutomationPreference('{"mode":"review","leadDays":3}'))
    .toEqual({ mode: EMAIL_AUTOMATION_MODE.REVIEW, leadDays: 3 });
  expect(normalizeEmailAutomationPreference({ mode: 'review', leadDays: 0 })).toBeNull();
  expect(normalizeEmailAutomationPreference({ mode: 'review', leadDays: 15 })).toBeNull();
});

test('subtracts the PD review period from the established send timestamp', () => {
  expect(calculateReviewAvailableAt('2026-08-30T08:00:00.000Z', { mode: 'review', leadDays: 3 }).toISOString())
    .toBe('2026-08-27T08:00:00.000Z');
  expect(calculateReviewAvailableAt('2026-08-30T08:00:00.000Z', { mode: 'automatic' }).toISOString())
    .toBe('2026-08-30T08:00:00.000Z');
});

test('GET distinguishes an absent choice from automatic mode', async () => {
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
  await handler({ method: 'PUT', query: {}, body: { mode: 'review', leadDays: 3 } }, res);
  expect(res.statusCode).toBe(200);
  expect(inside).toBe(true);
  expect(DatabaseService.setUserPreference).toHaveBeenCalledWith(
    7,
    PREFERENCE_KEYS.EMAIL_AUTOMATION,
    JSON.stringify({ mode: 'review', leadDays: 3 }),
    false,
  );
});

test('PUT rejects an out-of-range review period before persistence', async () => {
  const res = mockRes();
  await handler({ method: 'PUT', query: {}, body: { mode: 'review', leadDays: 40 } }, res);
  expect(res.statusCode).toBe(400);
  expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
});
