/**
 * Tool-app prompt resolver (convergence plan Stage 0).
 *
 * Generalizes the Reviewer Finder seam (reviewer-prompt-resolver.js) for the tool
 * apps: prompt text, model and max tokens come from the current Dataverse
 * `wmkf_ai_prompts` row; the route keeps its own LLMClient call.
 *
 * Fallback policy:
 *   - Transient Dataverse error (isTransient, 408/429/5xx, or network/timeout with no
 *     HTTP status) -> the bundled definition
 *     (`source: 'bundled'`), with a console.warn.
 *   - Any other error (400/401/403, interlock refusal, missing credentials, bugs)
 *     rethrows.
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

const NETWORK_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);
const NETWORK_MESSAGE_RE = /\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED)\b|fetch failed|timed? ?out/i;

/**
 * True only for outages worth falling back to the bundled text on. Dataverse
 * errors built by lib/utils/service-error.js carry `isTransient` (an explicit
 * false wins even on a stub 5xx, e.g. missing credentials). Otherwise: HTTP
 * 408/429/5xx; or, with no HTTP status, a network/timeout/abort error. Everything
 * else (400/401/403/404, interlock refusals, programming errors) must rethrow.
 */
export function isTransientDataverseError(err) {
  if (!err) return false;
  if (typeof err.isTransient === 'boolean') return err.isTransient;
  const status = typeof err.status === 'number' ? err.status : null;
  if (status !== null) return status === 408 || status === 429 || (status >= 500 && status < 600);
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  if (NETWORK_CODES.has(err.code)) return true;
  return NETWORK_MESSAGE_RE.test(String(err.message || '')) && !/dataverse-interlock/.test(String(err.message || ''));
}

/**
 * Recognizes the structural "row missing / ambiguous" errors so a route can answer
 * with an actionable 503 instead of a generic failure. Returns the user-facing
 * { error, code } body, or null for any other error.
 */
export function toolPromptUnavailable(err) {
  if (err?.code === PROMPT_STORE_ERROR_CODES.NOT_FOUND) {
    return {
      error: "This tool's prompt is not set up yet. Ask an administrator to publish it in Admin \u2192 Prompt Templates.",
      code: 'tool_prompt_unavailable',
    };
  }
  if (err?.code === PROMPT_STORE_ERROR_CODES.DUPLICATE_CURRENT) {
    return {
      error: "This tool's prompt has more than one current version. Ask an administrator to fix it in Admin \u2192 Prompt Templates.",
      code: 'tool_prompt_unavailable',
    };
  }
  return null;
}

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
    if (STRUCTURAL_ERROR_CODES.has(err?.code) || !isTransientDataverseError(err)) throw err;
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
