/** @jest-environment node */
// Integrity Screener summarization: pinned to the haiku tier (S573) and
// refusal-guarded. Mutation checks: dropping the APP_MODELS row makes the
// first test fail (DEFAULT_MODEL is 'sonnet'); dropping the guard makes the
// refusal tests fail (refusal text would be returned as the analysis).
const mockComplete = jest.fn();
const mockCtor = jest.fn();
jest.mock('../../lib/services/llm-client.js', () => ({
  LLMClient: jest.fn().mockImplementation((opts) => { mockCtor(opts); return { complete: mockComplete }; }),
}));
const { IntegrityService } = require('../../lib/services/integrity-service');
const { resolveModel } = require('../../lib/services/model-resolver');
const RESULTS = [{ title: 'A result', link: 'https://example.org/a', snippet: 'snippet' }];

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockCtor.mockReset();
  mockComplete.mockReset().mockResolvedValue({ text: 'No concerns found.', refused: false, stopReason: 'end_turn' });
});
afterEach(() => jest.restoreAllMocks());

test('constructs the client on the haiku tier with a distinct sonnet fallback', async () => {
  await IntegrityService.analyzeWithHaiku(RESULTS, 'system', 'key');
  expect(mockCtor).toHaveBeenCalledTimes(1);
  const opts = mockCtor.mock.calls[0][0];
  // getModelForApp may hand LLMClient the tier key or a resolved id depending
  // on resolver wiring; LLMClient resolves tiers itself. Assert the family.
  expect(resolveModel(opts.model)).toMatch(/^claude-haiku-/);
  expect(resolveModel(opts.fallbackModel)).toMatch(/^claude-sonnet-/);
  expect(opts.fallbackModel).not.toBe(opts.model);
});

test('refusal in fail-soft mode never surfaces provider text', async () => {
  mockComplete.mockResolvedValue({ text: 'I cannot help with that request.', refused: true, stopReason: 'refusal' });
  const out = await IntegrityService.analyzeWithHaiku(RESULTS, 'system', 'key');
  expect(out).toMatch(/^Unable to analyze search results/);
  expect(out).not.toContain('I cannot help');
});

test('refusal in strict mode throws without provider text', async () => {
  mockComplete.mockResolvedValue({ text: 'I cannot help with that request.', refused: true, stopReason: 'refusal' });
  await expect(IntegrityService.analyzeWithHaiku(RESULTS, 'system', 'key', { strictSourceErrors: true }))
    .rejects.toThrow('Search result analysis failed');
});

test('ordinary response still returns the analysis text', async () => {
  const out = await IntegrityService.analyzeWithHaiku(RESULTS, 'system', 'key');
  expect(out).toBe('No concerns found.');
});
