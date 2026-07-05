/**
 * @jest-environment node
 *
 * Tests-before coverage (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md Stages 3-6)
 * for pages/api/reviewer-finder/generate-emails.js ahead of converting its
 * grant-request-owned + reviewer-suggestion-owned raw DynamicsService calls
 * to their adapters (the wmkf_apprequestpersons Co-PI lookup has no owning
 * adapter in this cluster and stays raw). Captures CURRENT behavior: golden
 * path (single candidate, no suggestionId, generates one email) and one
 * failure path (no candidates → SSE error, no email generated).
 */
import { createMockReq } from '../helpers/auth-mock';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 'p-1' })) }));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({ nextRateLimiter: () => async () => true }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn(), queryRecords: jest.fn(), updateRecord: jest.fn() },
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: jest.fn(),
}));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: jest.fn(async () => {}) }));
jest.mock('../../lib/services/reviewer-time-budget', () => ({ getReviewerTimeBudgetSeconds: jest.fn(async () => 600) }));

function mockRes() {
  const events = [];
  const res = {
    setHeader: jest.fn(),
    write: jest.fn((chunk) => {
      const s = String(chunk);
      const m = s.match(/^event: (.+)\n$/);
      if (m) events.push({ event: m[1] });
      const dm = s.match(/^data: (.+)\n\n$/);
      if (dm && events.length) events[events.length - 1].data = JSON.parse(dm[1]);
    }),
    end: jest.fn(),
    events,
  };
  return res;
}

let handler;
beforeAll(() => {
  handler = require('../../pages/api/reviewer-finder/generate-emails').default;
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('golden path: one candidate with no suggestionId generates one email', async () => {
  const req = createMockReq({
    method: 'POST',
    body: {
      candidates: [{ name: 'Dr. Reviewer', email: 'reviewer@example.org' }],
      template: { subject: 'Hi {{name}}', body: 'Please review.' },
      settings: { senderEmail: 'staff@wmkeck.org' },
      options: {},
    },
  });
  const res = mockRes();
  await handler(req, res);

  const result = res.events.find((e) => e.event === 'result');
  expect(result).toBeDefined();
  expect(result.data.stats).toMatchObject({ total: 1, generated: 1, skipped: 0, errors: 0 });
  expect(result.data.emails).toHaveLength(1);
});

test('failure path: no candidates → SSE error event, no emails generated', async () => {
  const req = createMockReq({
    method: 'POST',
    body: { candidates: [], template: { subject: 'x', body: 'y' }, settings: { senderEmail: 'a@b.com' } },
  });
  const res = mockRes();
  await handler(req, res);

  const errorEvent = res.events.find((e) => e.event === 'error');
  expect(errorEvent).toBeDefined();
  expect(errorEvent.data.message).toMatch(/No candidates/);
});
