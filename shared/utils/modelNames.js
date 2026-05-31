/**
 * Model name mapping utility
 * Converts technical model IDs to user-friendly display names
 */

// Map of model IDs to friendly names
const MODEL_DISPLAY_NAMES = {
  // Opus models
  'claude-opus-4-20250514': 'Opus 4',
  'claude-opus-4-0-20250514': 'Opus 4',

  // Sonnet models
  'claude-sonnet-4-20250514': 'Sonnet 4',
  'claude-sonnet-4-0-20250514': 'Sonnet 4',
  'claude-3-5-sonnet-20241022': 'Sonnet 3.5',
  'claude-3-5-sonnet-20240620': 'Sonnet 3.5',
  'claude-3-sonnet-20240229': 'Sonnet 3',

  // Haiku models
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-3-5-haiku-20241022': 'Haiku 3.5',
  'claude-3-haiku-20240307': 'Haiku 3',
};

// Model tier indicators (for potential future use with cost display)
const MODEL_TIERS = {
  'claude-opus-4-20250514': { tier: 'premium', cost: 3 },
  'claude-sonnet-4-20250514': { tier: 'standard', cost: 2 },
  'claude-haiku-4-5-20251001': { tier: 'economy', cost: 1 },
  'claude-3-5-haiku-20241022': { tier: 'economy', cost: 1 },
  'claude-3-haiku-20240307': { tier: 'economy', cost: 1 },
};

/**
 * Get user-friendly display name for a model ID
 * @param {string} modelId - Technical model identifier
 * @returns {string} - Friendly display name
 */
// Tier-key short names (matches lib/services/model-resolver.js TIERS).
const TIER_DISPLAY_NAMES = {
  opus: 'Opus (latest)',
  sonnet: 'Sonnet (latest)',
  haiku: 'Haiku (latest)',
};

export function getModelDisplayName(modelId) {
  if (!modelId) return 'Unknown';

  // Tier key — auto-tracks the latest version in that family.
  const lower = String(modelId).toLowerCase();
  if (TIER_DISPLAY_NAMES[lower]) return TIER_DISPLAY_NAMES[lower];

  // Check exact match first
  if (MODEL_DISPLAY_NAMES[modelId]) {
    return MODEL_DISPLAY_NAMES[modelId];
  }

  // Try to extract a friendly name from the model ID
  // e.g., "claude-opus-4-20250514" → "Opus 4"
  const match = modelId.match(/claude-(\w+)-(\d+)/i);
  if (match) {
    const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    const version = match[2];
    return `${family} ${version}`;
  }

  // Return the raw ID if we can't parse it
  return modelId;
}

/**
 * Get model tier information (for future cost indicators)
 * @param {string} modelId - Technical model identifier
 * @returns {Object} - Tier info { tier: string, cost: number }
 */
export function getModelTier(modelId) {
  return MODEL_TIERS[modelId] || { tier: 'unknown', cost: 0 };
}

/**
 * Check if a model supports vision/image analysis
 * @param {string} modelId - Technical model identifier
 * @returns {boolean}
 */
export function supportsVision(modelId) {
  // All Claude 3+ models support vision except Haiku 3
  if (!modelId) return false;

  // Haiku 3.0 doesn't support vision well
  if (modelId.includes('claude-3-haiku')) return false;

  // All other Claude 3+ models support vision
  return modelId.includes('claude-3') ||
         modelId.includes('claude-opus') ||
         modelId.includes('claude-sonnet') ||
         modelId.includes('claude-haiku');
}

const modelNameUtils = {
  getModelDisplayName,
  getModelTier,
  supportsVision,
  MODEL_DISPLAY_NAMES,
};

export default modelNameUtils;
