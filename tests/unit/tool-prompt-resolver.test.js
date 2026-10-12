/** @jest-environment node */
jest.mock('../../lib/services/model-resolver', () => ({
  loadAvailableModels: jest.fn(async () => []),
  resolveModelWithCapabilities: jest.fn(),
}));
jest.mock('../../lib/services/prompt-store', () => ({
  fetchCurrentPrompt: jest.fn(),
  PROMPT_STORE_ERROR_CODES: { NOT_FOUND: 'PROMPT_NOT_FOUND', DUPLICATE_CURRENT: 'PROMPT_DUPLICATE_CURRENT' },
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((label, fn) => fn()),
}));

import { resolveToolPrompt } from '../../lib/services/tool-prompt-resolver';
import { fetchCurrentPrompt } from '../../lib/services/prompt-store';
import { withDalContext } from '../../lib/dataverse/core/context';
import { resolveModelWithCapabilities } from '../../lib/services/model-resolver';

const BUNDLED = { promptName: 'app.step', systemPrompt: 'bundled sys', body: 'bundled body', model: 'sonnet', maxTokens: 1111 };
const ROW = {
  wmkf_ai_systemprompt: 'row sys', wmkf_ai_promptbody: 'row body',
  wmkf_ai_model: 'haiku', wmkf_ai_maxtokens: 2222, wmkf_promptversion: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  resolveModelWithCapabilities.mockImplementation((raw) =>
    raw === 'sonnet' ? { model: 'claude-sonnet-x', capabilities: { provider: 'anthropic' } }
      : raw === 'haiku' ? { model: 'claude-haiku-x', capabilities: { provider: 'anthropic' } }
        : raw === 'gpt-x' ? { model: 'gpt-x', capabilities: { provider: 'openai' } }
          : { model: raw, capabilities: { unknown: true } });
});
afterEach(() => console.warn.mockRestore());

test('row hit: uses row text, model, max tokens, version inside a DAL context', async () => {
  fetchCurrentPrompt.mockResolvedValue(ROW);
  const r = await resolveToolPrompt('app.step', BUNDLED);
  expect(withDalContext).toHaveBeenCalledWith('tool-prompt-resolve', expect.any(Function));
  expect(fetchCurrentPrompt).toHaveBeenCalledWith('app.step');
  expect(r).toEqual({
    systemPrompt: 'row sys', body: 'row body', model: 'claude-haiku-x', rawModel: 'haiku',
    maxTokens: 2222, source: 'dataverse', version: 3,
  });
});

test('transient error falls back to the bundled definition and warns', async () => {
  fetchCurrentPrompt.mockRejectedValue(new Error('ECONNRESET'));
  const r = await resolveToolPrompt('app.step', BUNDLED);
  expect(r).toEqual({
    systemPrompt: 'bundled sys', body: 'bundled body', model: 'claude-sonnet-x', rawModel: 'sonnet',
    maxTokens: 1111, source: 'bundled', version: null,
  });
  expect(console.warn).toHaveBeenCalled();
});

test.each(['PROMPT_NOT_FOUND', 'PROMPT_DUPLICATE_CURRENT'])('%s rethrows (fail loud)', async (code) => {
  fetchCurrentPrompt.mockRejectedValue(Object.assign(new Error('structural'), { code }));
  await expect(resolveToolPrompt('app.step', BUNDLED)).rejects.toThrow('structural');
});

test('unreviewed row model throws', async () => {
  fetchCurrentPrompt.mockResolvedValue({ ...ROW, wmkf_ai_model: 'mystery' });
  await expect(resolveToolPrompt('app.step', BUNDLED)).rejects.toThrow(/resolveToolPrompt: prompt "app.step" resolves to unreviewed/);
});

test('non-anthropic provider throws', async () => {
  fetchCurrentPrompt.mockResolvedValue({ ...ROW, wmkf_ai_model: 'gpt-x' });
  await expect(resolveToolPrompt('app.step', BUNDLED)).rejects.toThrow(/provider "openai"/);
});

test('row without max tokens uses the bundled value', async () => {
  fetchCurrentPrompt.mockResolvedValue({ ...ROW, wmkf_ai_maxtokens: null });
  expect((await resolveToolPrompt('app.step', BUNDLED)).maxTokens).toBe(1111);
});

test('row without a model uses the bundled model', async () => {
  fetchCurrentPrompt.mockResolvedValue({ ...ROW, wmkf_ai_model: '' });
  expect((await resolveToolPrompt('app.step', BUNDLED)).rawModel).toBe('sonnet');
});

describe('fallback only on transient errors', () => {
  const err = (props, msg = 'x') => Object.assign(new Error(msg), props);
  test.each([
    ['503', err({ status: 503 })],
    ['isTransient flag', err({ isTransient: true, status: 500 })],
    ['429', err({ status: 429 })],
    ['408', err({ status: 408 })],
    ['AbortError', err({ name: 'AbortError' })],
    ['TimeoutError', err({ name: 'TimeoutError' })],
    ['ETIMEDOUT code', err({ code: 'ETIMEDOUT' })],
    ['fetch failed', err({}, 'fetch failed')],
    ['no-response service error', err({ status: null, noResponse: true, isTransient: true })],
  ])('%s falls back to bundled', async (_n, e) => {
    fetchCurrentPrompt.mockRejectedValue(e);
    const r = await resolveToolPrompt('app.step', BUNDLED);
    expect(r.source).toBe('bundled');
  });

  test.each([
    ['400', err({ status: 400 })],
    ['401', err({ status: 401 })],
    ['403', err({ status: 403 })],
    ['404', err({ status: 404 })],
    ['missing credentials (explicit non-transient 500)', err({ status: 500, isTransient: false }, 'Missing Dynamics 365 environment variables')],
    ['interlock refusal', err({}, '[dataverse-interlock] denied: deployment=production target=sandbox')],
    ['programming error', new TypeError('x is not a function')],
  ])('%s rethrows', async (_n, e) => {
    fetchCurrentPrompt.mockRejectedValue(e);
    await expect(resolveToolPrompt('app.step', BUNDLED)).rejects.toBe(e);
  });
});

describe('toolPromptUnavailable', () => {
  const { toolPromptUnavailable } = require('../../lib/services/tool-prompt-resolver');
  test('recognizes the structural codes only', () => {
    expect(toolPromptUnavailable({ code: 'PROMPT_NOT_FOUND' })).toMatchObject({ code: 'tool_prompt_unavailable', error: expect.stringContaining('not set up yet') });
    expect(toolPromptUnavailable({ code: 'PROMPT_DUPLICATE_CURRENT' }).error).toContain('more than one current version');
    expect(toolPromptUnavailable(new Error('x'))).toBeNull();
  });
});
