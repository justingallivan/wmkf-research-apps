/**
 * PromptResolver — Session 103 holdover that fetches Claude prompt templates
 * from a scratch row on `wmkf_ai_run` ahead of the dedicated prompt-storage
 * table. (The dedicated table later shipped as `wmkf_ai_prompt`, not the
 * originally-proposed `wmkf_prompt_template`; the live Executor service at
 * `lib/services/execute-prompt.js` reads current prompt rows from
 * `wmkf_ai_prompts` and is the production path for `/api/phase-i-dynamics/
 * summarize-v2`. PromptResolver is currently used only by maintenance
 * scripts, not by live API routes.)
 *
 * For the Session 103 experiment, prompts are stored on a scratch row of the
 * `wmkf_ai_run` table:
 *   GUID a03f77d9-913a-f111-88b5-000d3a3065b8
 *   wmkf_ai_notes      → system prompt (plain text)
 *   wmkf_ai_rawoutput  → user prompt template (plain text with {{var}} slots)
 *
 * Fallback behavior: if Dynamics fetch fails (network, auth, empty fields),
 * the resolver loads a bundled `.js` module instead and returns source:'fallback'.
 * This keeps the legacy PromptResolver scripts (audit-system-prompt-sizes.js,
 * ab-phase-i-prompts.js, etc.) functional during CRM outages. Note: the live
 * v2 API path (`/api/phase-i-dynamics/summarize-v2`) does NOT use this
 * resolver — it goes through `execute-prompt.js` which queries
 * `wmkf_ai_prompts` directly with no bundled fallback. Fallback results are
 * cached with a short TTL (FALLBACK_TTL_MS) so the next call retries
 * Dynamics quickly.
 *
 * Set PROMPT_RESOLVER_STRICT=true to disable the fallback and throw on
 * Dynamics failure — useful for the prompt-development loop where silent
 * fallback would hide seeding bugs.
 *
 * Template variable syntax: {{var_name}} (double braces).
 * Undefined variables are left in place so failures are visible in output.
 */

import { bypassDynamicsRestrictions } from './dynamics-context.js';
import * as aiRunAdapter from '../dataverse/adapters/ai-run.js';

const SCRATCH_RECORD = {
  entitySet: 'wmkf_ai_runs',
  guid: 'a03f77d9-913a-f111-88b5-000d3a3065b8',
  systemField: 'wmkf_ai_notes',
  userField: 'wmkf_ai_rawoutput',
};

// Per-app routing. `fallbackModule` is a module path imported dynamically on
// Dynamics failure; it must export { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE }.
const APP_ROUTING = {
  'phase-i-dynamics-v2': {
    ...SCRATCH_RECORD,
    fallbackModule: '../../shared/config/prompts/phase-i-dynamics.js',
  },
};

const CACHE_TTL_MS = 5 * 60 * 1000;   // dynamics fetches
const FALLBACK_TTL_MS = 60 * 1000;    // retry dynamics sooner after a fallback

const cache = new Map(); // appKey → { fetchedAt, ttl, prompt }

export class PromptResolver {
  /**
   * Fetch a prompt template for the given appKey.
   * @param {string} appKey
   * @returns {Promise<{systemPrompt: string, userPromptTemplate: string, source: 'dynamics'|'cache'|'fallback', fetchedAt: number, recordGuid: string|null}>}
   */
  static async getPrompt(appKey) {
    const routing = APP_ROUTING[appKey];
    if (!routing) {
      throw new Error(`PromptResolver: no routing configured for app "${appKey}"`);
    }

    const cached = cache.get(appKey);
    if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
      return { ...cached.prompt, source: 'cache', fetchedAt: cached.fetchedAt };
    }

    try {
      const prompt = await this._fetchFromDynamics(routing);
      const fetchedAt = Date.now();
      cache.set(appKey, { fetchedAt, ttl: CACHE_TTL_MS, prompt });
      return { ...prompt, source: 'dynamics', fetchedAt };
    } catch (err) {
      if (process.env.PROMPT_RESOLVER_STRICT === 'true') throw err;

      if (!routing.fallbackModule) {
        throw new Error(
          `PromptResolver: Dynamics fetch failed for "${appKey}" and no fallback is configured — ${err.message}`
        );
      }

      console.warn(
        `[PromptResolver] Dynamics fetch failed for "${appKey}" — using bundled fallback. Error: ${err.message}`
      );
      const prompt = await this._loadFallback(routing);
      const fetchedAt = Date.now();
      cache.set(appKey, { fetchedAt, ttl: FALLBACK_TTL_MS, prompt });
      return { ...prompt, source: 'fallback', fetchedAt };
    }
  }

  static invalidate(appKey) {
    if (appKey) cache.delete(appKey);
    else cache.clear();
  }

  static async _fetchFromDynamics({ entitySet, guid, systemField, userField }) {
    // Prompts are system data — always read with restrictions bypassed even
    // when the caller is in a restricted context.
    return bypassDynamicsRestrictions('prompt-resolver', async () => {
      const rec = await aiRunAdapter.getByIdWithSelect(guid, `${systemField},${userField}`);

      const systemPrompt = (rec?.[systemField] || '').trim();
      const userPromptTemplate = (rec?.[userField] || '').trim();

      if (!systemPrompt || !userPromptTemplate) {
        throw new Error(
          `empty prompt fields on ${entitySet}(${guid}) — ` +
          `${systemField} has ${systemPrompt.length} chars, ${userField} has ${userPromptTemplate.length} chars`
        );
      }

      return { systemPrompt, userPromptTemplate, recordGuid: guid };
    });
  }

  static async _loadFallback({ fallbackModule }) {
    const mod = await import(fallbackModule);
    const systemPrompt = (mod.SYSTEM_PROMPT || '').trim();
    const userPromptTemplate = (mod.USER_PROMPT_TEMPLATE || '').trim();
    if (!systemPrompt || !userPromptTemplate) {
      throw new Error(
        `PromptResolver: fallback module ${fallbackModule} missing SYSTEM_PROMPT or USER_PROMPT_TEMPLATE`
      );
    }
    return { systemPrompt, userPromptTemplate, recordGuid: null };
  }

  /**
   * Substitute {{var}} slots in a template. Undefined slots are left unchanged
   * (visible in output) rather than silently blanked, so missing vars surface
   * as bugs instead of hiding.
   */
  static interpolate(template, vars = {}) {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => {
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        return String(vars[name]);
      }
      return match;
    });
  }
}
