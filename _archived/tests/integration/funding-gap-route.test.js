/**
 * Route tests for /api/analyze-funding-gap (convergence plan Stage 2): frame
 * sequence, resolved model + max tokens, and unavailable-prompt handling.
 */
import { mockAuthenticatedUser, createMockReq, createMockRes, clearAppAccessCache } from '../helpers/auth-mock';

jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../shared/config/baseConfig', () => ({
  BASE_CONFIG: { ERROR_MESSAGES: { PROCESSING_FAILED: 'Processing failed' } },
  getModelForApp: jest.fn(() => 'claude-old-path'),
}));
jest.mock('../../shared/api/handlers/fileProcessor', () => ({
  createFileProcessor: jest.fn(() => ({
    processFile: jest.fn(async () => ({ text: 'P'.repeat(500), metadata: { pages: 3 } })),
  })),
}));
jest.mock('../../lib/utils/public-blob-fetch', () => ({
  fetchPublicBlob: jest.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
}));
jest.mock('../../lib/fundingApis', () => ({
  queryNSFforPI: jest.fn(async () => ({ awards: [], totalCount: 0, totalFunding: 0, error: null })),
  queryNSFforKeywords: jest.fn(async () => ({})),
  queryNIHforPI: jest.fn(async () => ({ projects: [], totalCount: 0, totalFunding: 0, warnings: [], error: null })),
  queryNIHforKeywords: jest.fn(async () => ({})),
  queryUSASpending: jest.fn(async () => ({ awards: [], totalCount: 0, totalFunding: 0, byAgency: {}, error: null })),
  formatCurrency: jest.fn((v) => `$${v}`),
  formatDate: jest.fn((v) => v),
}));

const mockCtorArgs = [];
const mockCompleteArgs = [];
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation((args) => {
    mockCtorArgs.push(args);
    return {
      complete: jest.fn(async (opts) => {
        mockCompleteArgs.push(opts);
        const text = opts.messages[0].content.includes('Return only valid JSON')
          ? JSON.stringify({ pi: 'Jane Researcher', institution: 'Example University', state: 'CA', keywords: ['a', 'b', 'c', 'd', 'e'] })
          : '# Analysis';
        return { text, model: 'm', usage: { inputTokens: 1, outputTokens: 1 } };
      }),
    };
  }),
}));

const mockResolve = jest.fn();
jest.mock('../../lib/services/tool-prompt-resolver', () => ({
  ...jest.requireActual('../../lib/services/tool-prompt-resolver'),
  resolveToolPrompt: (...a) => mockResolve(...a),
}));

const resolvedFrom = (model, bump) => async (_name, def) => ({
  systemPrompt: def.systemPrompt, body: def.body, model, maxTokens: def.maxTokens + bump, source: 'dataverse', version: 3,
});

beforeEach(() => {
  mockCtorArgs.length = 0;
  mockCompleteArgs.length = 0;
  mockResolve.mockReset();
  mockResolve.mockImplementation(resolvedFrom('claude-resolved', 7));
  clearAppAccessCache();
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
});

const frames = (res) =>
  res.write.mock.calls.map((c) => c[0]).join('').split('\n\n').filter(Boolean)
    .map((c) => JSON.parse(c.match(/^data: (.+)$/m)[1]));

async function run(files = [{ url: 'https://x.public.blob.vercel-storage.com/p.pdf', filename: 'p.pdf' }]) {
  mockAuthenticatedUser(9, ['funding-gap-analyzer']);
  const handler = (await import('../../pages/api/analyze-funding-gap')).default;
  const req = createMockReq({
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: { files, searchYears: 5, includeCoPIs: false, includeUSASpending: false },
  });
  const res = createMockRes();
  await handler(req, res);
  return res;
}

const SUCCESS_FRAMES = [
  [0, 'Processing proposal 1/1: p.pdf'],
  [1, 'Extracting text from p.pdf...'],
  [5, 'Extracting PI information and keywords from p.pdf...'],
  [10, 'Found PI: Jane Researcher at Example University (CA)'],
  [12, 'Identified 5 research keywords'],
  [15, "Querying NSF for Jane Researcher's awards in CA..."],
  [17, 'Trying last name only: Researcher...'],
  [20, 'No NSF awards found for Jane Researcher in CA'],
  [25, 'Analyzing NSF funding landscape for research keywords...'],
  [30, 'NSF landscape analysis complete'],
  [35, "Querying NIH RePORTER for Jane Researcher's projects..."],
  [40, 'No NIH projects found for Jane Researcher'],
  [45, 'Analyzing NIH funding landscape for research keywords...'],
  [55, 'NIH landscape analysis complete'],
  [65, 'USAspending.gov query skipped (disabled in settings)'],
  [70, 'Generating federal funding gap analysis for p.pdf...'],
  [75, 'Analysis complete for p.pdf'],
  [100, 'Complete! Analysis ready.'],
];

describe('/api/analyze-funding-gap route', () => {
  test('success frame sequence is unchanged (characterized before the Stage 2 route change)', async () => {
    const res = await run();
    const f = frames(res);
    expect(f.slice(0, -1).map((x) => [x.progress, x.message])).toEqual(SUCCESS_FRAMES);
    const last = f[f.length - 1];
    expect(Object.keys(last)).toEqual(['complete', 'results', 'metadata']);
    expect(last.results['p.pdf'].formatted).toBe('# Analysis');
  });

  test('uses the resolved model and max tokens, no system, today\'s appName and temperatures', async () => {
    await run();
    expect(mockResolve.mock.calls.map((c) => c[0])).toEqual(['funding-gap.extract', 'funding-gap.analyze']);
    expect(mockCtorArgs).toHaveLength(2);
    for (const c of mockCtorArgs) expect(c).toMatchObject({ model: 'claude-resolved', appName: 'funding-analysis', userProfileId: 9 });
    expect(mockCompleteArgs).toHaveLength(2);
    expect(mockCompleteArgs[0]).toMatchObject({ maxTokens: 1007, temperature: 0.3 });
    expect(mockCompleteArgs[1]).toMatchObject({ maxTokens: 4007, temperature: 0.4 });
    for (const c of mockCompleteArgs) {
      expect(c.system).toBeUndefined();
      expect(c.messages).toHaveLength(1);
      expect(c.messages[0].content).toContain('UNTRUSTED CONTENT RULES:');
    }
  });

  test('resolves each row once per request, not per file', async () => {
    await run([
      { url: 'https://x.public.blob.vercel-storage.com/a.pdf', filename: 'a.pdf' },
      { url: 'https://x.public.blob.vercel-storage.com/b.pdf', filename: 'b.pdf' },
    ]);
    expect(mockResolve).toHaveBeenCalledTimes(2);
    expect(mockCompleteArgs).toHaveLength(4);
  });

  test('each row uses its own resolved model', async () => {
    mockResolve.mockImplementation(async (name, def) => resolvedFrom(name.endsWith('extract') ? 'm-extract' : 'm-analyze', 0)(name, def));
    await run();
    expect(mockCtorArgs.map((c) => c.model)).toEqual(['m-extract', 'm-analyze']);
  });

  test('a non-empty system template is sent as system', async () => {
    mockResolve.mockImplementation(async (_n, def) => ({ systemPrompt: 'SYS RULES', body: def.body, model: 'm', maxTokens: 10 }));
    await run();
    expect(mockCompleteArgs[0].system).toBe('SYS RULES');
  });

  test('PROMPT_NOT_FOUND before streaming returns 503 JSON and never calls the model', async () => {
    mockResolve.mockRejectedValue(Object.assign(new Error('nf'), { code: 'PROMPT_NOT_FOUND' }));
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res._data).toMatchObject({ code: 'tool_prompt_unavailable', error: expect.stringContaining('Prompt Templates') });
    expect(res.write).not.toHaveBeenCalled();
    expect(mockCompleteArgs).toHaveLength(0);
  });

  test('other resolver failure before streaming returns a JSON 500, not an SSE frame', async () => {
    mockResolve.mockRejectedValue(new Error('unreviewed model'));
    const res = await run();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.write).not.toHaveBeenCalled();
  });
});
