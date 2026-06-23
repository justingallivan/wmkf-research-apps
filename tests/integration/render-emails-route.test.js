/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({
    session: { user: { dynamicsSystemuserId: 'u-1' } },
  })),
}));

jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => async () => true,
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

const findById = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
}));

const mintAndStore = jest.fn();
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: (...args) => mintAndStore(...args),
}));

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn() },
}));
jest.mock('../../lib/services/grant-cycles-dataverse', () => ({ findByShortCode: jest.fn() }));
jest.mock('../../lib/services/proposal-participants', () => ({ fetchCoPIs: jest.fn() }));
jest.mock('../../lib/services/honorarium-config', () => ({ getHonorariumAmount: jest.fn(async () => 500) }));

const { createMockReq, createMockRes } = require('../helpers/auth-mock');

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/render-emails')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('render-emails — retired template types fail closed', () => {
  for (const templateType of ['hold', 'finalize']) {
    test(`${templateType} is rejected before recipient hydration/token mint`, async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          suggestionIds: [SUGGESTION_ID],
          templateType,
          template: { subject: 'Subject', body: 'Body {{externalLink}}' },
        },
      });
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: `Unknown templateType: ${templateType}` });
      expect(findById).not.toHaveBeenCalled();
      expect(mintAndStore).not.toHaveBeenCalled();
    });
  }
});
