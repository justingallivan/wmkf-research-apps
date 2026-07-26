/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({
    session: { user: { dynamicsSystemuserId: 'u-1' } },
  })),
}));

const { requireAppAccess } = require('../../lib/utils/auth');

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

describe('render-emails — characterization: method, auth, envelope, domain error', () => {
  test('GET is rejected with 405 and no Allow header is set', async () => {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  test('unauthenticated request short-circuits with the access layer\'s own response', async () => {
    requireAppAccess.mockImplementationOnce(async (req, res) => {
      res.status(401).json({ error: 'Authentication required' });
      return null;
    });
    const req = createMockReq({
      method: 'POST',
      body: {
        suggestionIds: [SUGGESTION_ID],
        template: { subject: 'Subject', body: 'Body' },
      },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(findById).not.toHaveBeenCalled();
  });

  test('404 when every suggestion lookup returns nothing (business error, not input validation)', async () => {
    findById.mockResolvedValue(null);
    const req = createMockReq({
      method: 'POST',
      body: {
        suggestionIds: [SUGGESTION_ID],
        templateType: 'materials',
        template: { subject: 'Subject', body: 'Body' },
      },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'No reviewers found for the provided IDs' });
  });

  test('200 success pins the full drafts + stats envelope, including a skipped:no_email recipient', async () => {
    const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
    const SUGGESTION_ID_2 = '44444444-4444-4444-8444-444444444444';

    findById.mockImplementation(async (id) => {
      if (id === SUGGESTION_ID) {
        return {
          wmkf_appreviewersuggestionid: SUGGESTION_ID,
          _wmkf_potentialreviewer_value: 'person-1',
          _wmkf_request_value: REQUEST_ID,
        };
      }
      if (id === SUGGESTION_ID_2) {
        return {
          wmkf_appreviewersuggestionid: SUGGESTION_ID_2,
          _wmkf_potentialreviewer_value: 'person-2',
          _wmkf_request_value: REQUEST_ID,
        };
      }
      return null;
    });
    const { DynamicsService } = require('../../lib/services/dynamics-service');
    DynamicsService.getRecord.mockImplementation(async (set, id) => {
      if (set === 'wmkf_potentialreviewerses') {
        if (id === 'person-1') return { wmkf_name: 'Dr. Rev Iewer', wmkf_emailaddress: 'rev@example.org' };
        if (id === 'person-2') return { wmkf_name: 'No Email Reviewer', wmkf_emailaddress: null };
        return null;
      }
      if (set === 'akoya_requests') {
        return {
          akoya_requestid: REQUEST_ID,
          akoya_requestnum: 'REQ-100',
          akoya_title: 'A Proposal',
          _wmkf_projectleader_value_formatted: 'Dr. Lead PI',
        };
      }
      return null;
    });
    const { fetchCoPIs } = require('../../lib/services/proposal-participants');
    fetchCoPIs.mockResolvedValue([]);

    const req = createMockReq({
      method: 'POST',
      body: {
        suggestionIds: [SUGGESTION_ID, SUGGESTION_ID_2],
        templateType: 'materials',
        template: { subject: 'Subject line', body: 'Body {{proposalDetails}}' },
      },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.stats).toEqual({ total: 2, ready: 1, skipped: 1 });
    expect(payload.drafts).toHaveLength(2);

    const ready = payload.drafts.find((d) => d.suggestionId === SUGGESTION_ID);
    expect(ready).toMatchObject({
      suggestionId: SUGGESTION_ID,
      candidateEmail: 'rev@example.org',
      requestNumber: 'REQ-100',
    });
    expect(typeof ready.subject).toBe('string');
    expect(typeof ready.body).toBe('string');
    expect(ready.skipped).toBeUndefined();
    expect('emailConfidence' in ready).toBe(true);

    const skipped = payload.drafts.find((d) => d.suggestionId === SUGGESTION_ID_2);
    expect(skipped).toMatchObject({
      suggestionId: SUGGESTION_ID_2,
      candidateEmail: null,
      requestNumber: 'REQ-100',
      subject: '',
      body: '',
      skipped: 'no_email',
    });
    expect('emailConfidence' in skipped).toBe(true);
  });

  test('materials deadline falls back to the request date when client and cycle settings are blank', async () => {
    const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
    findById.mockResolvedValueOnce({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_potentialreviewer_value: 'person-1',
      _wmkf_request_value: REQUEST_ID,
    });
    const { DynamicsService } = require('../../lib/services/dynamics-service');
    DynamicsService.getRecord.mockImplementation(async (set) => {
      if (set === 'wmkf_potentialreviewerses') {
        return { wmkf_name: 'Dr. Test Reviewer', wmkf_emailaddress: 'reviewer@example.org' };
      }
      if (set === 'akoya_requests') {
        return {
          akoya_requestid: REQUEST_ID,
          akoya_requestnum: 'REQ-200',
          akoya_title: 'A Proposal',
          wmkf_reviewduedate: '2026-09-09',
        };
      }
      return null;
    });
    const { fetchCoPIs } = require('../../lib/services/proposal-participants');
    fetchCoPIs.mockResolvedValue([]);

    const req = createMockReq({
      method: 'POST',
      body: {
        suggestionIds: [SUGGESTION_ID],
        templateType: 'materials',
        template: {
          subject: 'Review Materials',
          body: 'Please submit by {{reviewDueDate}}.',
        },
        settings: {},
      },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].drafts[0].body).toBe('Please submit by September 9, 2026.');
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
