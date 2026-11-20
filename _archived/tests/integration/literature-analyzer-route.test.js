/** @jest-environment node */
/**
 * Route tests for /api/analyze-literature (convergence plan Stage 4): success
 * frame sequence, resolved model + max tokens per call, unavailable-prompt handling.
 */
import { mockAuthenticatedUser, createMockReq, createMockRes, clearAppAccessCache } from '../helpers/auth-mock';

jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../lib/utils/public-blob-fetch', () => ({
  fetchPublicBlob: jest.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('%PDF').buffer })),
}));

const mockCtorArgs = [];
const mockCompleteArgs = [];
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation((args) => {
    mockCtorArgs.push(args);
    return {
      complete: jest.fn(async (opts) => {
        mockCompleteArgs.push(opts);
        const content = opts.messages[0].content;
        let text;
        if (Array.isArray(content)) {
          text = JSON.stringify({ title: 'Paper T', authors: ['A'], year: 2020, abstract: 'abs' });
        } else if (content.includes('"comparisonType"')) {
          text = JSON.stringify({ comparisonType: 'findings', summary: 'cmp' });
        } else {
          text = JSON.stringify({ overview: { paperCount: 2 }, synthesis: 'syn' });
        }
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

const TWO_FILES = [
  { url: 'https://x.public.blob.vercel-storage.com/a.pdf', filename: 'a.pdf' },
  { url: 'https://x.public.blob.vercel-storage.com/b.pdf', filename: 'b.pdf' },
];

async function run({ files = TWO_FILES, options = { focusTopic: 'topic', generateComparison: true }, markSentOnWrite = false } = {}) {
  mockAuthenticatedUser(9, ['literature-analyzer']);
  const handler = (await import('../../pages/api/analyze-literature')).default;
  const req = createMockReq({
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: { files, options },
  });
  const res = createMockRes();
  if (markSentOnWrite) res.write.mockImplementation(() => { res.headersSent = true; });
  await handler(req, res);
  return res;
}

const SUCCESS_FRAMES = [
  { progress: 0, message: 'Starting analysis of 2 paper(s)...' },
  { progress: 30, message: 'Analyzing paper 1 of 2: a.pdf...' },
  { event: 'paper_extracted', index: 0, filename: 'a.pdf', title: 'Paper T', authors: ['A'], year: 2020 },
  { progress: 60, message: 'Analyzing paper 2 of 2: b.pdf...' },
  { event: 'paper_extracted', index: 1, filename: 'b.pdf', title: 'Paper T', authors: ['A'], year: 2020 },
  { progress: 70, message: 'Extracted 2 of 2 papers successfully' },
  { progress: 75, message: 'Generating synthesis across papers...' },
  { event: 'synthesis_complete', success: true },
  { progress: 90, message: 'Generating comparison...' },
];

describe('/api/analyze-literature route', () => {
  test('success frame sequence is unchanged (characterized before the Stage 4 route change)', async () => {
    const res = await run();
    const f = frames(res);
    expect(f.slice(0, -1)).toEqual(SUCCESS_FRAMES);
    const last = f[f.length - 1];
    expect(Object.keys(last)).toEqual(['progress', 'message', 'results']);
    expect(last.progress).toBe(100);
    expect(last.results.papers.map((p) => p.sourceFile)).toEqual(['a.pdf', 'b.pdf']);
    expect(last.results.synthesis).toEqual({ overview: { paperCount: 2 }, synthesis: 'syn' });
    expect(last.results.comparison).toEqual({ comparisonType: 'findings', summary: 'cmp' });
    expect(Object.keys(last.results.summary)).toEqual(['totalPapers', 'successfulExtractions', 'errors', 'timestamp']);
  });

  test('PDF block, appName and temperatures are unchanged', async () => {
    await run();
    expect(mockCompleteArgs).toHaveLength(4);
    const [e1, e2, syn, cmp] = mockCompleteArgs;
    for (const e of [e1, e2]) {
      expect(e.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
      expect(e.messages[0].content[1].text).toContain('UNTRUSTED CONTENT RULES:');
      expect(e.temperature).toBeUndefined();
      expect(e.system).toBeUndefined();
    }
    expect(syn.temperature).toBe(0.3);
    expect(cmp.temperature).toBe(0.3);
    expect(syn.messages[0].content).toContain('focus on: "topic"');
    expect(syn.messages[0].content).toContain('UNTRUSTED CONTENT RULES:');
    for (const c of mockCtorArgs) expect(c).toMatchObject({ appName: 'literature-analyzer', userProfileId: 9 });
  });

  test('uses the resolved model and max tokens per call', async () => {
    await run();
    expect(mockResolve.mock.calls.map((c) => c[0]).sort()).toEqual([
      'literature-analyzer.compare', 'literature-analyzer.extract-paper', 'literature-analyzer.synthesize',
    ]);
    expect(mockCtorArgs.map((c) => c.model)).toEqual(Array(4).fill('claude-resolved'));
    expect(mockCompleteArgs.map((c) => c.maxTokens)).toEqual([4007, 4007, 6007, 4007]);
  });

  test('each row uses its own resolved model; rows resolve once per request', async () => {
    mockResolve.mockImplementation(async (name, def) => resolvedFrom(`m-${name.split('.')[1]}`, 0)(name, def));
    await run();
    expect(mockCtorArgs.map((c) => c.model)).toEqual(['m-extract-paper', 'm-extract-paper', 'm-synthesize', 'm-compare']);
    expect(mockResolve).toHaveBeenCalledTimes(3);
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

  test('an unavailable-prompt error after frames ends the stream with an actionable error event', async () => {
    const files = {
      length: 1,
      *[Symbol.iterator]() {
        yield TWO_FILES[0];
        throw Object.assign(new Error('nf'), { code: 'PROMPT_NOT_FOUND' });
      },
    };
    const res = await run({ files, markSentOnWrite: true });
    expect(res.status).not.toHaveBeenCalled();
    const last = frames(res).at(-1);
    expect(last).toEqual({ event: 'error', message: expect.stringContaining('Prompt Templates'), code: 'tool_prompt_unavailable' });
    expect(res.end).toHaveBeenCalled();
  });
});
