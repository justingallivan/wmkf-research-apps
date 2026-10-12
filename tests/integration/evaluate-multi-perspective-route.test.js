/** @jest-environment node */
/**
 * Route tests for /api/evaluate-multi-perspective (convergence plan Stage 5): success
 * frame sequence, resolved model + max tokens per stage, retry behavior, unavailable prompts.
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
jest.mock('../../lib/utils/pdf-page-splitter', () => ({ splitPdfToPages: async () => [{ pageNumber: 1, base64: 'test-pdf' }] }));
jest.mock('../../lib/utils/usage-logger', () => ({ logUsage: jest.fn() }));
const mockHits = [{ title: 'Hit One', authors: ['A'], year: 2024 }];
jest.mock('../../lib/services/pubmed-service', () => ({ PubMedService: { search: jest.fn(async () => mockHits) } }));
jest.mock('../../lib/services/arxiv-service', () => ({ ArXivService: { search: jest.fn(async () => []) } }));
jest.mock('../../lib/services/biorxiv-service', () => ({ BioRxivService: { search: jest.fn(async () => []) } }));
jest.mock('../../lib/services/chemrxiv-service', () => ({ ChemRxivService: { search: jest.fn(async () => []) } }));

const mockCtorArgs = [];
const mockCompleteArgs = [];
let mockBehavior = null; // optional override: (opts, stage) => result | throws
const stageOf = (content) => {
  if (Array.isArray(content)) return 'initial-analysis';
  if (content.includes('science communicator')) return 'proposal-summary';
  if (content.includes('You are the OPTIMIST')) return 'optimist';
  if (content.includes('You are the SKEPTIC')) return 'skeptic';
  if (content.includes('NEUTRAL ARBITER in')) return 'neutral';
  if (content.includes('You are the INTEGRATOR')) return 'integrator';
  return 'unknown';
};
const JSON_BY_STAGE = {
  'initial-analysis': { eligibility: { isEligible: true }, title: 'Concept T', piName: 'PI', institution: 'U', summary: 'S', researchArea: 'biology', searchQueries: ['q one'], keyMethodologies: ['m'] },
  'proposal-summary': { proposalSummary: { whatTheyreProposing: 'w', potentialImpact: 'i' }, keyInnovation: 'k', fieldContext: 'f' },
  optimist: { perspective: 'optimist', overallImpression: 'o' },
  skeptic: { perspective: 'skeptic', overallImpression: 's' },
  neutral: { perspective: 'neutral', overallImpression: 'n' },
  integrator: { synthesis: { weightedRecommendation: 'Recommend', overallNarrative: 'narr' } },
};
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn().mockImplementation((args) => {
    mockCtorArgs.push(args);
    return {
      complete: jest.fn(async (opts) => {
        mockCompleteArgs.push({ ...opts, __model: args.model });
        const content = opts.messages[0].content;
        const stage = stageOf(content);
        if (mockBehavior) {
          const r = mockBehavior(opts, stage, args);
          if (r) return r;
        }
        const text = JSON.stringify(JSON_BY_STAGE[stage]);
        return { text, content: [{ type: 'text', text }], model: 'm', usage: { inputTokens: 1, outputTokens: 2 }, stopReason: 'end_turn' };
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
  mockBehavior = null;
  mockResolve.mockReset();
  mockResolve.mockImplementation(resolvedFrom('claude-resolved', 7));
  clearAppAccessCache();
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
});

const frames = (res) =>
  res.write.mock.calls.map((c) => c[0]).join('').split('\n\n').filter(Boolean)
    .map((c) => JSON.parse(c.match(/^data: (.+)$/m)[1]));

const ONE_FILE = [{ url: 'https://x.public.blob.vercel-storage.com/a.pdf', filename: 'a.pdf' }];

async function run({ files = ONE_FILE, framework, markSentOnWrite = false } = {}) {
  mockAuthenticatedUser(9, ['multi-perspective-evaluator']);
  const handler = (await import('../../pages/api/evaluate-multi-perspective')).default;
  const req = createMockReq({
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: { files, ...(framework ? { framework } : {}) },
  });
  const res = createMockRes();
  if (markSentOnWrite) res.write.mockImplementation(() => { res.headersSent = true; });
  await handler(req, res);
  return res;
}

const SUCCESS_FRAMES = [
  { progress: 0, message: 'Loading a.pdf...' },
  { progress: 5, message: 'Splitting a.pdf into pages...' },
  { progress: 10, message: 'Found 1 concept(s) in a.pdf' },
  { progress: 10, message: 'Analyzing concept 1 of 1...', stage: 'initial-analysis' },
  { progress: 15, message: 'Searching literature for concept 1...', stage: 'literature-search' },
  { progress: 20, message: 'Generating proposal summary for concept 1...', stage: 'proposal-summary' },
  { progress: 28, message: 'Running multi-perspective analysis (Optimist, Skeptic, Neutral)...', stage: 'perspectives' },
  { progress: 45, message: 'Synthesizing perspectives for concept 1...', stage: 'integration' },
];

describe('/api/evaluate-multi-perspective route', () => {
  test('success frame sequence is unchanged (characterized before the Stage 5 route change)', async () => {
    const res = await run();
    const f = frames(res);
    expect(f.slice(0, -1)).toEqual(SUCCESS_FRAMES);
    const last = f[f.length - 1];
    expect(Object.keys(last)).toEqual(['progress', 'message', 'results']);
    expect(last.progress).toBe(100);
    expect(last.results.framework).toBe('keck');
    expect(Object.keys(last.results.summary)).toEqual(['totalConcepts', 'successfulEvaluations', 'flaggedAsIneligible', 'errors', 'timestamp']);
    expect(last.results.summary).toMatchObject({ totalConcepts: 1, successfulEvaluations: 1, flaggedAsIneligible: 0, errors: 0 });
    const c = last.results.concepts[0];
    expect(c.title).toBe('Concept T');
    expect(Object.keys(c.perspectives)).toEqual(['optimist', 'skeptic', 'neutral']);
    expect(c.synthesis.weightedRecommendation).toBe('Recommend');
    expect(c.proposalSummary.keyInnovation).toBe('k');
    expect(c.literatureSearch.totalFound).toBe(1);
    expect(mockCompleteArgs).toHaveLength(6);
  });

  test('PDF block, temperatures and request shape are unchanged', async () => {
    await run();
    const by = Object.fromEntries(mockCompleteArgs.map((c) => [stageOf(c.messages[0].content), c]));
    expect(Object.keys(by).sort()).toEqual(['initial-analysis', 'integrator', 'neutral', 'optimist', 'proposal-summary', 'skeptic']);
    const s1 = by['initial-analysis'];
    expect(s1.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'test-pdf' } });
    expect(s1.messages[0].content[1].text).toContain('UNTRUSTED CONTENT RULES:');
    expect(s1.temperature).toBeUndefined();
    expect(s1.system).toBeUndefined();
    for (const k of ['proposal-summary', 'optimist', 'skeptic', 'neutral', 'integrator']) {
      expect(by[k].temperature).toBe(0.3);
      expect(by[k].system).toBeUndefined();
      expect(by[k].messages[0].content).toContain('UNTRUSTED CONTENT RULES:');
    }
    for (const c of mockCtorArgs) expect(c.maxRetries).toBe(0);
  });
});
