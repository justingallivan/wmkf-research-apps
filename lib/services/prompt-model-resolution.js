/**
 * Prompt-row model resolution, shared by the Executor (execute-prompt.js) and the
 * tool-app prompt resolver (tool-prompt-resolver.js).
 *
 * A prompt row's `wmkf_ai_model` may be a tier key (fable/opus/sonnet/haiku) or a
 * concrete id. Resolution warms the live model list first, maps the value through
 * the reviewed capability registry, and fails loud on an unreviewed model.
 */
import { BASE_CONFIG } from '../../shared/config/baseConfig.js';
import { loadAvailableModels, resolveModelWithCapabilities } from './model-resolver.js';

/**
 * @param {{wmkf_ai_model?: string, wmkf_ai_promptname?: string}} promptRow
 * @param {string} promptName
 * @param {{callerLabel?: string, allowedProviders?: string[]}} [opts]
 * @returns {Promise<{rawModel: string, model: string, capabilities: object}>}
 */
export async function resolvePromptModel(
  promptRow,
  promptName,
  { callerLabel = 'executePrompt', allowedProviders = ['anthropic', 'openai'] } = {},
) {
  // Warm the resolver cache first so tier resolution hits a live model list
  // rather than the hand-maintained fallback table.
  await loadAvailableModels();
  const rawModel = promptRow.wmkf_ai_model || BASE_CONFIG.CLAUDE.DEFAULT_MODEL;
  const modelInfo = resolveModelWithCapabilities(rawModel);
  const model = modelInfo.model || rawModel;
  const capabilities = modelInfo.capabilities;
  if (capabilities.unknown) {
    const label = promptRow.wmkf_ai_promptname || promptName || '(unknown prompt)';
    throw new Error(
      `${callerLabel}: prompt "${label}" resolves to unreviewed Claude model "${model}". ` +
      'Add it to lib/services/model-capabilities.js and lib/utils/model-pricing.js before executing this prompt.',
    );
  }
  // Every registry row declares `provider` (check:model-registry enforces it), but
  // a reviewed row that omits it is by definition the historical Anthropic path,
  // so default rather than reject: the pre-seam behaviour for every existing caller.
  // A declared provider that is not a wired transport still fails closed.
  const provider = capabilities.provider ?? 'anthropic';
  if (!['anthropic', 'openai'].includes(provider)) {
    const label = promptRow.wmkf_ai_promptname || promptName || '(unknown prompt)';
    throw new Error(
      `${callerLabel}: prompt "${label}" resolves to model "${model}" on unsupported provider "${provider}". ` +
      'Only anthropic and openai transports are wired into the Executor.',
    );
  }
  if (!allowedProviders.includes(provider)) {
    const label = promptRow.wmkf_ai_promptname || promptName || '(unknown prompt)';
    throw new Error(
      `${callerLabel}: prompt "${label}" resolves to model "${model}" on provider "${provider}", ` +
      `which is not allowed here (allowed: ${allowedProviders.join(', ')}).`,
    );
  }
  return { rawModel, model, capabilities: provider === capabilities.provider ? capabilities : { ...capabilities, provider } };
}
