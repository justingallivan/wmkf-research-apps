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

describe('render-emails — co-PI list renders as a grammatical serial list', () => {
  const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

  function wire(coPINames) {
    findById.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_potentialreviewer_value: 'person-1',
      _wmkf_request_value: REQUEST_ID,
    });
    const { DynamicsService } = require('../../lib/services/dynamics-service');
    DynamicsService.getRecord.mockImplementation(async (set) => {
      if (set === 'wmkf_potentialreviewerses') {
        return { wmkf_name: 'Dr. Rev Iewer', wmkf_emailaddress: 'rev@example.org' };
      }
      if (set === 'akoya_requests') {
        return { akoya_requestid: REQUEST_ID, akoya_title: 'A Proposal', _wmkf_projectleader_value_formatted: 'Dr. Lead PI' };
      }
      return null;
    });
    const { fetchCoPIs } = require('../../lib/services/proposal-participants');
    fetchCoPIs.mockResolvedValue(coPINames);
  }

  async function renderBody(coPINames) {
    wire(coPINames);
    const req = createMockReq({
      method: 'POST',
      body: {
        suggestionIds: [SUGGESTION_ID],
        templateType: 'invitation',
        template: { subject: 'Subject', body: '{{proposalDetails}}' },
      },
    });
    const res = createMockRes();
    await handler(req, res);
    const payload = res.json.mock.calls[0][0];
    return payload.drafts[0].body;
  }

  test('three co-PIs → "A, B, and C" (serial comma), honorifics stripped', async () => {
    const body = await renderBody(['Dr. Alice Adams', 'Prof. Bob Brown', 'Professor Carol Clark']);
    expect(body).toContain('Co-investigators: Alice Adams, Bob Brown, and Carol Clark');
    expect(body).not.toMatch(/Dr\.|Prof/);
  });

  test('two co-PIs → "A and B" (no serial comma)', async () => {
    const body = await renderBody(['Dr. Alice Adams', 'Dr. Bob Brown']);
    expect(body).toContain('Co-investigators: Alice Adams and Bob Brown');
  });

  test('the PI name is also shown without an honorific', async () => {
    const body = await renderBody(['Dr. Alice Adams']);
    // request mock supplies _wmkf_projectleader_value_formatted: 'Dr. Lead PI'
    expect(body).toContain('Principal investigator: Lead PI');
    expect(body).toContain('Co-investigators: Alice Adams');
  });

  test('no co-PIs → the Co-investigators line is dropped entirely', async () => {
    const body = await renderBody([]);
    expect(body).not.toContain('Co-investigators:');
  });
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
