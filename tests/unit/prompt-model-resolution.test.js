/** @jest-environment node */
jest.mock('../../lib/services/model-resolver', () => ({
  loadAvailableModels: jest.fn(async () => []),
  resolveModelWithCapabilities: jest.fn(),
}));
jest.mock('../../shared/config/baseConfig.js', () => ({
  BASE_CONFIG: { CLAUDE: { DEFAULT_MODEL: 'claude-default-x' } },
}));

import { resolvePromptModel } from '../../lib/services/prompt-model-resolution';
import { loadAvailableModels, resolveModelWithCapabilities } from '../../lib/services/model-resolver';

const known = (model, provider = 'anthropic') => ({ model, capabilities: { provider } });

beforeEach(() => {
  jest.clearAllMocks();
  resolveModelWithCapabilities.mockImplementation((raw) =>
    raw === 'sonnet' ? known('claude-sonnet-x')
      : raw === 'gpt-x' ? known('gpt-x', 'openai')
        : raw === 'weird' ? known('weird', 'acme')
          : { model: raw, capabilities: { unknown: true } });
});

test('tier key resolves to a concrete id and warms the model list first', async () => {
  const r = await resolvePromptModel({ wmkf_ai_model: 'sonnet' }, 'p.one');
  expect(loadAvailableModels).toHaveBeenCalledTimes(1);
  expect(r).toMatchObject({ rawModel: 'sonnet', model: 'claude-sonnet-x' });
  expect(r.capabilities.provider).toBe('anthropic');
});

test('row without a model falls back to the default model', async () => {
  resolveModelWithCapabilities.mockImplementation((raw) => known(raw));
  const r = await resolvePromptModel({}, 'p.one');
  expect(r.rawModel).toBe('claude-default-x');
});

test('unreviewed model throws with the callerLabel prefix (default executePrompt)', async () => {
  await expect(resolvePromptModel({ wmkf_ai_model: 'nope' }, 'p.one'))
    .rejects.toThrow('executePrompt: prompt "p.one" resolves to unreviewed Claude model "nope".');
  await expect(resolvePromptModel({ wmkf_ai_model: 'nope' }, 'p.one', { callerLabel: 'resolveToolPrompt' }))
    .rejects.toThrow(/^resolveToolPrompt: prompt "p\.one"/);
});

test('provider outside the wired transports throws', async () => {
  await expect(resolvePromptModel({ wmkf_ai_model: 'weird' }, 'p.one'))
    .rejects.toThrow(/unsupported provider "acme"/);
});

test('provider not in allowedProviders throws naming prompt, model and provider', async () => {
  await expect(resolvePromptModel({ wmkf_ai_model: 'gpt-x' }, 'p.one', { allowedProviders: ['anthropic'] }))
    .rejects.toThrow(/prompt "p\.one" resolves to model "gpt-x" on provider "openai"/);
  await expect(resolvePromptModel({ wmkf_ai_model: 'gpt-x' }, 'p.one')).resolves.toMatchObject({ model: 'gpt-x' });
});
