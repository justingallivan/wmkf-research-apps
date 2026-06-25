/**
 * MultiLLMService - Unified interface for calling multiple LLM providers
 *
 * Supports Claude (Anthropic), GPT (OpenAI), Gemini (Google), and Perplexity.
 * Each provider's response is normalized to a common format.
 * Includes retry with exponential backoff and fan-out helpers.
 */

import { safeFetch } from '../utils/safe-fetch';
import { logUsage } from '../utils/usage-logger';
import { requestCapabilitiesForModel } from './model-capabilities';

const RETRY_CONFIG = {
  MAX_RETRIES: 2,
  INITIAL_DELAY_MS: 1000,
  MAX_DELAY_MS: 10000,
  BACKOFF_MULTIPLIER: 2,
  REQUEST_TIMEOUT_MS: 180000, // 3 minutes per request
};

// Provider configurations
const PROVIDERS = {
  claude: {
    name: 'Claude',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    envKey: 'CLAUDE_API_KEY',
  },
  openai: {
    name: 'GPT',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    envKey: 'OPENAI_API_KEY',
  },
  gemini: {
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    envKey: 'GOOGLE_AI_API_KEY',
  },
  perplexity: {
    name: 'Perplexity',
    apiUrl: 'https://api.perplexity.ai/chat/completions',
    envKey: 'PERPLEXITY_API_KEY',
  },
};

// Default models per provider per stage
const DEFAULT_MODELS = {
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  perplexity: 'sonar-pro',
};

export class MultiLLMService {

  /**
   * Get list of providers that have API keys configured
   * @returns {string[]} Array of available provider keys
   */
  static getAvailableProviders() {
    return Object.entries(PROVIDERS)
      .filter(([, config]) => !!process.env[config.envKey])
      .map(([key]) => key);
  }

  /**
   * Get display name for a provider
   * @param {string} provider
   * @returns {string}
   */
  static getProviderName(provider) {
    return PROVIDERS[provider]?.name || provider;
  }

  /**
   * Get default model for a provider
   * @param {string} provider
   * @returns {string}
   */
  static getDefaultModel(provider) {
    return DEFAULT_MODELS[provider] || null;
  }

  /**
   * Call a single LLM provider with retry logic
   *
   * @param {string} provider - 'claude', 'openai', 'gemini', 'perplexity'
   * @param {string} prompt - The user prompt text
   * @param {Object} options
   * @param {string} options.systemPrompt - System/instruction prompt
   * @param {string} options.model - Override default model
   * @param {number} options.maxTokens - Max response tokens (default 16384)
   * @param {number} options.temperature - Temperature (default 0.3)
   * @param {Object} options.loggingContext - { userProfileId, appName }
   * @returns {Promise<{text: string, inputTokens: number, outputTokens: number, model: string, latencyMs: number}>}
   */
  static async call(provider, prompt, options = {}) {
    const {
      systemPrompt = '',
      model = DEFAULT_MODELS[provider],
      maxTokens = 16384,
      temperature = 0.3,
      effort = null,
      outputConfig = null,
      output_config = null,
      loggingContext = null,
    } = options;

    const config = PROVIDERS[provider];
    if (!config) throw new Error(`Unknown LLM provider: ${provider}`);

    const apiKey = process.env[config.envKey];
    if (!apiKey) throw new Error(`API key not configured for ${config.name} (${config.envKey})`);

    let lastError = null;
    let delay = RETRY_CONFIG.INITIAL_DELAY_MS;

    for (let attempt = 0; attempt <= RETRY_CONFIG.MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[MultiLLMService] ${config.name} retry ${attempt}/${RETRY_CONFIG.MAX_RETRIES} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay = Math.min(delay * RETRY_CONFIG.BACKOFF_MULTIPLIER, RETRY_CONFIG.MAX_DELAY_MS);
        }

        const startTime = Date.now();
        let result;

        // Wrap call with timeout to prevent hanging requests
        const callPromise = (() => {
          switch (provider) {
          case 'claude':
            return this._callClaude(apiKey, prompt, systemPrompt, model, maxTokens, temperature, {
              effort,
              outputConfig: outputConfig || output_config,
            });
          case 'openai':
            return this._callOpenAI(apiKey, prompt, systemPrompt, model, maxTokens, temperature);
          case 'gemini':
            return this._callGemini(apiKey, prompt, systemPrompt, model, maxTokens, temperature);
          case 'perplexity':
            return this._callPerplexity(apiKey, prompt, systemPrompt, model, maxTokens, temperature);
          default:
            throw new Error(`Unsupported provider: ${provider}`);
          }
        })();

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${config.name} request timed out after ${RETRY_CONFIG.REQUEST_TIMEOUT_MS / 1000}s`)),
            RETRY_CONFIG.REQUEST_TIMEOUT_MS)
        );

        result = await Promise.race([callPromise, timeoutPromise]);

        result.latencyMs = Date.now() - startTime;
        result.model = result.model || model;

        if (loggingContext) {
          logUsage({
            userProfileId: loggingContext.userProfileId,
            appName: loggingContext.appName || 'virtual-review-panel',
            model: result.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.latencyMs,
            status: 'success',
          });
        }

        return result;
      } catch (error) {
        lastError = error;
        const isRetryable = this._isRetryableError(error);
        if (!isRetryable) {
          if (loggingContext) {
            logUsage({
              userProfileId: loggingContext.userProfileId,
              appName: loggingContext.appName || 'virtual-review-panel',
              model,
              status: 'error',
              errorMessage: error.message,
            });
          }
          throw error;
        }
        console.warn(`[MultiLLMService] ${config.name} attempt ${attempt + 1} failed: ${error.message}`);
      }
    }

    if (loggingContext) {
      logUsage({
        userProfileId: loggingContext.userProfileId,
        appName: loggingContext.appName || 'virtual-review-panel',
        model,
        status: 'rate_limited',
        errorMessage: lastError?.message,
      });
    }
    throw lastError;
  }

  /**
   * Fan out a prompt to multiple providers in parallel
   *
   * @param {string[]} providers - Array of provider keys
   * @param {Function} promptFn - (provider) => { prompt, systemPrompt } or just string
   * @param {Object} options - Shared options passed to call()
   * @returns {Promise<Object>} { [provider]: { success: true, result } | { success: false, error } }
   */
  static async callAll(providers, promptFn, options = {}) {
    const results = {};

    const settled = await Promise.allSettled(
      providers.map(async (provider) => {
        const promptData = typeof promptFn === 'function' ? promptFn(provider) : { prompt: promptFn };
        const prompt = typeof promptData === 'string' ? promptData : promptData.prompt;
        const systemPrompt = promptData.systemPrompt || options.systemPrompt || '';
        const model = promptData.model || options.models?.[provider] || DEFAULT_MODELS[provider];

        const result = await this.call(provider, prompt, {
          ...options,
          systemPrompt,
          model,
        });
        return { provider, result };
      })
    );

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        const { provider, result } = outcome.value;
        results[provider] = { success: true, ...result };
      } else {
        // Extract provider from the error context
        const errorMsg = outcome.reason?.message || 'Unknown error';
        // Try to find which provider failed from the settled array index
        const idx = settled.indexOf(outcome);
        const provider = providers[idx];
        results[provider] = { success: false, error: errorMsg };
      }
    }

    return results;
  }

  // ============================================
  // PROVIDER-SPECIFIC IMPLEMENTATIONS
  // ============================================

  static async _callClaude(apiKey, prompt, systemPrompt, model, maxTokens, temperature, options = {}) {
    const capabilities = requestCapabilitiesForModel(model);
    const body = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };
    if (capabilities.supportsTemperature === true) {
      body.temperature = temperature;
    }
    if (options.outputConfig && typeof options.outputConfig === 'object') {
      body.output_config = { ...options.outputConfig };
      if (body.output_config.effort != null && capabilities.supportsEffort !== true) {
        delete body.output_config.effort;
      }
    }
    if (options.effort != null && capabilities.supportsEffort === true) {
      body.output_config = { ...(body.output_config || {}), effort: options.effort };
    }
    if (body.output_config && Object.keys(body.output_config).length === 0) {
      delete body.output_config;
    }
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const response = await safeFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Claude API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      text: data.content?.[0]?.text || '',
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
      model: data.model,
      stopReason: data.stop_reason || null,
      stopDetails: data.stop_details || null,
      refused: data.stop_reason === 'refusal',
    };
  }

  static async _callOpenAI(apiKey, prompt, systemPrompt, model, maxTokens, temperature) {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const body = {
      model,
      messages,
      max_completion_tokens: maxTokens,
      temperature,
    };

    const response = await safeFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      model: data.model,
    };
  }

  static async _callGemini(apiKey, prompt, systemPrompt, model, maxTokens, temperature) {
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const isThinkingModel = model.includes('2.5');

    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: isThinkingModel ? undefined : temperature,
      },
    };
    // Gemini 2.5 models use thinking tokens that consume the output budget.
    // Set a thinking budget so the visible output isn't truncated.
    if (isThinkingModel) {
      body.generationConfig.thinkingConfig = { thinkingBudget: 4096 };
    }
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    // API key passed via header, not query string. URL query params land in proxy
    // access logs, browser history, and Referer headers — a Gemini key leaked that
    // way would need full rotation. The `x-goog-api-key` header is the documented
    // alternative for the v1beta generateContent endpoint.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const response = await safeFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      inputTokens: data.usageMetadata?.promptTokenCount || 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      model,
    };
  }

  static async _callPerplexity(apiKey, prompt, systemPrompt, model, maxTokens, temperature) {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const body = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    };

    const response = await safeFetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Perplexity API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      model: data.model || model,
      citations: data.citations || [],
    };
  }

  // ============================================
  // HELPERS
  // ============================================

  static _isRetryableError(error) {
    const msg = error.message?.toLowerCase() || '';
    return msg.includes('overloaded') ||
           msg.includes('rate limit') ||
           msg.includes('429') ||
           msg.includes('529') ||
           msg.includes('503') ||
           msg.includes('too many requests') ||
           msg.includes('timed out');
  }
}
