/** @jest-environment node */
const mockComplete = jest.fn();
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 'staff' })) }));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({ nextRateLimiter: () => async () => true }));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: async () => {} }));
jest.mock('../../lib/utils/public-blob-fetch', () => ({ fetchPublicBlob: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }) }));
jest.mock('../../lib/utils/pdf-page-splitter', () => ({ splitPdfToPages: async () => [{ pageNumber: 1, base64: 'test-pdf' }] }));
jest.mock('../../lib/utils/usage-logger', () => ({ logUsage: jest.fn() }));
jest.mock('../../lib/services/llm-client', () => ({ LLMClient: jest.fn(() => ({ complete: (...args) => mockComplete(...args) })) }));
jest.mock('../../lib/utils/ai-output-schema', () => ({ validateAiJson: value => ({ ok: true, value }) }));
import handler from '../../pages/api/evaluate-multi-perspective';

beforeEach(() => { mockComplete.mockReset(); process.env.CLAUDE_API_KEY = 'test-key'; });

test.each([1, 2, 3])('refusal at stage-call %i stops downstream evaluation and fallback', async refusedAt => {
  let call = 0;
  mockComplete.mockImplementation(async () => {
    call++;
    return { text: '{}', content: [{ type: 'text', text: '{}' }], model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 }, stopReason: call === refusedAt ? 'refusal' : 'end_turn' };
  });
  const res = { setHeader: jest.fn(), write: jest.fn(), end: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
  await handler({ method: 'POST', body: { files: [{ filename: 'one.pdf', url: 'https://test.public.blob.vercel-storage.com/one.pdf' }] } }, res);
  const events = res.write.mock.calls.map(([chunk]) => JSON.parse(chunk.replace(/^data: /, '').trim()));
  const result = events.find(event => event.results)?.results;
  expect(result.summary.successfulEvaluations).toBe(0);
  expect(result.summary.errors).toBe(1);
  expect(result.concepts[0].error).toBeTruthy();
  // Perspective fan-out dispatches all three, but a refused one must prevent
  // integrator call six; summary refusal must prevent the entire fan-out.
  expect(mockComplete).toHaveBeenCalledTimes(refusedAt === 3 ? 5 : refusedAt);
});
