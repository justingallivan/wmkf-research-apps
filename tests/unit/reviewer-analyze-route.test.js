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
    MODEL: 'test-primary', FALLBACK_MODEL: 'test-alternate',
    _callLLM: jest.fn(), analyzeProposal: jest.fn(),
  },
}));
jest.mock('../../lib/services/reviewer-request-context', () => ({
  mergeRequestContextIntoAnalysisResult: jest.requireActual('../../lib/services/reviewer-request-context').mergeRequestContextIntoAnalysisResult,
  loadReviewerRequestContext: jest.fn(async () => ({
    title: 'Dataverse Title',
    programArea: 'Science and Engineering Research',
    principalInvestigator: 'Dr. PI',
    proposalAuthors: 'Dr. PI',
    coInvestigators: 'None',
    coInvestigatorCount: '0',
    authorInstitution: 'Applicant University',
    abstract: 'Dataverse abstract',
  })),
}));
jest.mock('@vercel/blob', () => ({
  put: jest.fn(),
}));

jest.mock('../../lib/services/reviewer-request-authorization', () => ({ authorizeReviewerRequestMutation: jest.fn() }));
jest.mock('../../lib/services/reviewer-find-handoff', () => ({ openFindHandoff: jest.fn() }));
const { openFindHandoff } = require('../../lib/services/reviewer-find-handoff');
const { authorizeReviewerRequestMutation } = require('../../lib/services/reviewer-request-authorization');

const { ClaudeReviewerService } = require('../../lib/services/claude-reviewer-service');
const { loadReviewerRequestContext } = require('../../lib/services/reviewer-request-context');

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
  const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

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
        requestId: REQUEST_ID,
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
    expect(loadReviewerRequestContext).toHaveBeenCalledWith(REQUEST_ID);
  });

  test('analysis_refused emits a non-retryable typed error SSE', async () => {
    ClaudeReviewerService.analyzeProposal.mockResolvedValue({
      success: false,
      status: 'analysis_refused',
      attempt: 1,
      stopReason: 'refusal',
      usedFallback: false,
      model: 'claude-test',
    });

    const req = {
      method: 'POST',
      body: {
        requestId: REQUEST_ID,
        proposalText: 'This proposal has enough text for analysis. '.repeat(10),
        reviewerCount: 6,
      },
    };
    const res = mockRes();

    await handler(req, res);

    const stream = res.write.mock.calls.map(call => call[0]).join('');
    expect(stream).toContain('event: error\n');
    expect(stream).toContain('"status":"analysis_refused"');
    expect(stream).toContain('"retryable":false');
    expect(stream).not.toContain('event: result\n');
    expect(stream).not.toContain('event: complete\n');
  });

  const runMode = async analysisMode => {
    const res = mockRes();
    await handler({ method: 'POST', body: {
      requestId: REQUEST_ID, proposalText: 'Surveying distant galaxies and stellar populations. '.repeat(5),
      analysisMode, searchSources: { arxiv: true }, excludeText: 'Already Known', reviewerCount: 8,
    } }, res);
    return res.write.mock.calls.flat().join('');
  };

  test('expertise recovery returns page-grounded literature inputs and trusted investigator context', async () => {
    ClaudeReviewerService._callLLM.mockResolvedValue({ text: '[{"specialty":"Astronomy","source":1,"anchor":"distant galaxies"}]' });
    const stream = await runMode('expertise');
    expect(stream).toContain('"panelExpertise":[{"specialty":"Astronomy","source":1}]');
    expect(stream).toContain('"principalInvestigator":"Dr. PI"');
    expect(stream).toContain('"reviewerSuggestions":[]');
    expect(stream).not.toContain('Dataverse abstract');
    expect(ClaudeReviewerService.analyzeProposal).not.toHaveBeenCalled();
  });

  test('a second refusal durably assigns the authorized staff member before responding', async () => {
    ClaudeReviewerService._callLLM.mockResolvedValue({ refused: true });
    openFindHandoff.mockResolvedValue({ owner: 'Staff Owner', caseId: 'case' });
    const stream = await runMode('expertise');
    expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'P1', requestIds: [REQUEST_ID] }));
    expect(openFindHandoff).toHaveBeenCalledWith(REQUEST_ID, 'P1', expect.objectContaining({ excludeText: 'Already Known', reviewerCount: 8 }));
    expect(stream).toContain('"status":"discovery_handoff"');
    expect(stream).not.toContain('event: complete');
    expect(ClaudeReviewerService.analyzeProposal).not.toHaveBeenCalled();
  });

  test('a handoff cannot be opened by an unauthorized profile', async () => {
    authorizeReviewerRequestMutation.mockRejectedValueOnce(new Error('access denied'));
    const stream = await runMode('staff');
    expect(openFindHandoff).not.toHaveBeenCalled();
    expect(stream).not.toContain('"status":"discovery_handoff"');
  });

  test('alternate retry selects only the configured fallback', async () => {
    ClaudeReviewerService.analyzeProposal.mockResolvedValue({ success: false, status: 'analysis_invalid' });
    await runMode('fallback');
    expect(ClaudeReviewerService.analyzeProposal).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ useFallback: true }));
    ClaudeReviewerService.analyzeProposal.mockClear();
    expect(await runMode('client-model-id')).toContain('Choose a configured');
    expect(ClaudeReviewerService.analyzeProposal).not.toHaveBeenCalled();
  });

  test('missing requestId emits an SSE error without calling Claude', async () => {
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
    expect(stream).toContain('requestId is required for reviewer analysis');
    expect(ClaudeReviewerService.analyzeProposal).not.toHaveBeenCalled();
    expect(loadReviewerRequestContext).not.toHaveBeenCalled();
  });
});
