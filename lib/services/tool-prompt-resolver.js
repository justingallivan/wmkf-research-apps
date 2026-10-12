/**
 * Tool-app prompt resolver (convergence plan Stage 0).
 *
 * Generalizes the Reviewer Finder seam (reviewer-prompt-resolver.js) for the tool
 * apps: prompt text, model and max tokens come from the current Dataverse
 * `wmkf_ai_prompts` row; the route keeps its own LLMClient call.
 *
 * Fallback policy:
 *   - Transient / unreachable Dataverse error -> the bundled definition
 *     (`source: 'bundled'`), with a console.warn.
 *   - 0 current rows (PROMPT_NOT_FOUND) or >=2 (PROMPT_DUPLICATE_CURRENT) -> rethrow
 *     (fail loud; a structural admin error must not silently degrade).
 *   - An unreviewed model, or any non-Anthropic provider, throws (the tool routes
 *     call LLMClient, which is Anthropic only).
 *
 * The A7 preamble is NOT part of the row; see tool-prompt-composer.js.
 */
import { withDalContext } from '../dataverse/core/context.js';
import { fetchCurrentPrompt, PROMPT_STORE_ERROR_CODES } from './prompt-store.js';
import { resolvePromptModel } from './prompt-model-resolution.js';

const STRUCTURAL_ERROR_CODES = new Set([
  PROMPT_STORE_ERROR_CODES.NOT_FOUND,
  PROMPT_STORE_ERROR_CODES.DUPLICATE_CURRENT,
]);

/**
 * @param {string} promptName
 * @param {{ systemPrompt?: string, body?: string, model: string, maxTokens?: number }} bundledDefinition
 * @returns {Promise<{systemPrompt: string, body: string, model: string, rawModel: string,
 *   maxTokens: number|undefined, source: 'dataverse'|'bundled', version: number|null}>}
 */
export async function resolveToolPrompt(promptName, bundledDefinition) {
  let row = null;
  try {
    row = await withDalContext('tool-prompt-resolve', () => fetchCurrentPrompt(promptName));
  } catch (err) {
    if (STRUCTURAL_ERROR_CODES.has(err?.code)) throw err;
    console.warn(`[tool-prompt-resolver] Dataverse unavailable for "${promptName}", using bundled definition: ${err?.message}`);
  }

  const modelInfo = await resolvePromptModel(
    { wmkf_ai_model: row?.wmkf_ai_model || bundledDefinition.model, wmkf_ai_promptname: promptName },
    promptName,
    { callerLabel: 'resolveToolPrompt', allowedProviders: ['anthropic'] },
  );

  if (row) {
    return {
      systemPrompt: row.wmkf_ai_systemprompt || '',
      body: row.wmkf_ai_promptbody || '',
      model: modelInfo.model,
      rawModel: modelInfo.rawModel,
      maxTokens: row.wmkf_ai_maxtokens || bundledDefinition.maxTokens,
      source: 'dataverse',
      version: row.wmkf_promptversion ?? null,
    };
  }
  return {
    systemPrompt: bundledDefinition.systemPrompt || '',
    body: bundledDefinition.body || '',
    model: modelInfo.model,
    rawModel: modelInfo.rawModel,
    maxTokens: bundledDefinition.maxTokens,
    source: 'bundled',
    version: null,
  };
}
