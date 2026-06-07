/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 'P1' })),
}));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => async () => true,
}));
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(async () => ({})),
}));
jest.mock('../../lib/services/reviewer-time-budget', () => ({
  getReviewerTimeBudgetSeconds: jest.fn(async () => 120),
}));
jest.mock('../../lib/services/claude-reviewer-service', () => ({
  ClaudeReviewerService: {
    analyzeProposal: jest.fn(),
  },
}));
jest.mock('@vercel/blob', () => ({
  put: jest.fn(),
}));

const { ClaudeReviewerService } = require('../../lib/services/claude-reviewer-service');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.headers = {};
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  res.write = jest.fn();
  res.end = jest.fn();
  return res;
}

describe('/api/reviewer-finder/analyze', () => {
  let handler;
  const oldApiKey = process.env.CLAUDE_API_KEY;

  beforeAll(() => {
    handler = require('../../pages/api/reviewer-finder/analyze').default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLAUDE_API_KEY = 'sk-ant-test';
  });

  afterAll(() => {
    process.env.CLAUDE_API_KEY = oldApiKey;
  });

  test('analysis_invalid emits retryable error SSE and no result frame', async () => {
    ClaudeReviewerService.analyzeProposal.mockResolvedValue({
      success: false,
      status: 'analysis_invalid',
      validation: {
        valid: false,
        issues: [{ code: 'below_suggestion_floor', message: 'Too few suggestions', severity: 'error' }],
      },
      attempt: 2,
      maxTokens: 4096,
      stopReason: 'end_turn',
      usedFallback: false,
      model: 'claude-test',
    });

    const req = {
      method: 'POST',
      body: {
        proposalText: 'This proposal has enough text for analysis. '.repeat(10),
        reviewerCount: 6,
      },
    };
    const res = mockRes();

    await handler(req, res);

    const stream = res.write.mock.calls.map(call => call[0]).join('');
    expect(stream).toContain('event: error\n');
    expect(stream).toContain('"status":"analysis_invalid"');
    expect(stream).toContain('"retryable":true');
    expect(stream).not.toContain('event: result\n');
    expect(stream).not.toContain('event: complete\n');
  });
});
