/**
 * Shared write-time guards for reviewed model ids.
 *
 * Tier keys are allowed because the resolver will map them to the current reviewed
 * fallback/latest family member. Concrete Claude ids are accepted only after the
 * capability registry and pricing table both know about them; otherwise admin
 * writes and prompt publishes fail before persisting future-model drift.
 */
import { isTier, TIERS } from './model-resolver';
import { lookupModelCapabilities } from './model-capabilities';
import { lookupPricing } from '../utils/model-pricing';

const TIER_LIST = Object.keys(TIERS).join('/');

export function validateReviewedClaudeModelValue(modelId, options = {}) {
  const {
    allowEmpty = false,
    allowNonClaude = false,
  } = options;

  if (modelId === null || modelId === undefined || modelId === '') {
    if (allowEmpty) {
      return { valid: true, value: null, kind: 'empty' };
    }
    return {
      valid: false,
      code: 'model_required',
      error: `Model value is required. Use a tier (${TIER_LIST}) or a reviewed concrete Claude model id.`,
    };
  }

  const value = String(modelId).trim();
  if (!value) {
    if (allowEmpty) {
      return { valid: true, value: null, kind: 'empty' };
    }
    return {
      valid: false,
      code: 'model_required',
      error: `Model value is required. Use a tier (${TIER_LIST}) or a reviewed concrete Claude model id.`,
    };
  }

  if (isTier(value)) {
    return { valid: true, value: value.toLowerCase(), kind: 'tier' };
  }

  if (!value.startsWith('claude-')) {
    if (allowNonClaude) {
      return { valid: true, value, kind: 'non_claude' };
    }
    return {
      valid: false,
      code: 'invalid_model_value',
      error: `Invalid model value "${value}". Must be a tier (${TIER_LIST}) or a concrete Anthropic model id starting with "claude-".`,
    };
  }

  const capabilities = lookupModelCapabilities(value);
  const pricing = lookupPricing(value);
  if (!capabilities || !pricing) {
    return {
      valid: false,
      code: 'unreviewed_claude_model',
      error: `Unreviewed Claude model "${value}". Add matching entries to lib/services/model-capabilities.js and lib/utils/model-pricing.js before saving it.`,
    };
  }

  return { valid: true, value, kind: 'claude', capabilities, pricing };
}

/**
 * Strict provider-bound validator for governed model slots. Unlike the legacy
 * Claude validator, this never accepts cross-provider values or tier aliases.
 */
export function validateReviewedProviderModelValue(modelId, { provider, allowEmpty = false } = {}) {
  if (modelId === null || modelId === undefined || String(modelId).trim() === '') {
    if (allowEmpty) return { valid: true, value: null, kind: 'empty' };
    return {
      valid: false,
      code: 'model_required',
      error: 'Model value is required.',
    };
  }
  if (!provider) {
    return {
      valid: false,
      code: 'provider_required',
      error: 'A fixed provider is required for provider-bound model validation.',
    };
  }

  const value = String(modelId).trim();
  if (isTier(value)) {
    return {
      valid: false,
      code: 'provider_model_mismatch',
      error: `Tier alias "${value}" is not valid for the fixed ${provider} slot. Select a reviewed concrete model.`,
    };
  }
  const capabilities = lookupModelCapabilities(value);
  if (!capabilities || capabilities.provider !== provider) {
    return {
      valid: false,
      code: capabilities ? 'provider_model_mismatch' : 'unreviewed_provider_model',
      error: capabilities
        ? `Model "${value}" belongs to provider ${capabilities.provider}, not the fixed ${provider} slot.`
        : `Unreviewed ${provider} model "${value}". Add matching capability and pricing entries before saving it.`,
    };
  }
  const pricing = lookupPricing(value);
  if (!pricing) {
    return {
      valid: false,
      code: 'unreviewed_provider_model',
      error: `Model "${value}" has no reviewed pricing entry and cannot be saved.`,
    };
  }
  return { valid: true, value, kind: 'provider_model', capabilities, pricing };
}
