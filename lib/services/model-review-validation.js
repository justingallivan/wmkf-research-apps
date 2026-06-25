/**
 * Shared write-time guard for Anthropic model ids.
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
