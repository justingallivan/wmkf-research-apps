/**
 * Reviewed request-shaping capabilities for Anthropic models.
 *
 * This is the local source of truth for fields the public /v1/models API either
 * cannot answer or cannot answer early enough for safe request construction
 * (for example, whether a model rejects temperature, or whether a successful
 * 200 response may be a classifier refusal). Keep entries keyed by the most
 * stable id/prefix that still represents one compatibility contract.
 *
 * `supportsStructuredOutput` was reviewed 2026-07-27 against Anthropic's GA
 * structured-output matrix (Claude 4.5+):
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 */

export const LAST_CAPABILITY_REVIEWED_AT = '2026-07-27';

export const MODEL_CAPABILITIES = {
  'claude-fable-5': {
    provider: 'anthropic',
    family: 'fable',
    supportsTemperature: false,
    supportsEffort: true,
    defaultEffort: 'high',
    thinkingMode: 'adaptive_always_on',
    supportsStructuredOutput: true,
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    refusalSemantics: 'http_200_stop_reason_refusal',
    requiresRefusalHandling: true,
    zeroDataRetentionEligible: false,
    dataRetentionClass: 'covered_model_30d',
    reviewedAt: '2026-06-25',
    source: 'https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5',
  },
  'claude-mythos-5': {
    provider: 'anthropic',
    family: 'mythos',
    supportsTemperature: false,
    supportsEffort: true,
    defaultEffort: 'high',
    thinkingMode: 'adaptive_always_on',
    supportsStructuredOutput: true,
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    refusalSemantics: 'none',
    requiresRefusalHandling: false,
    zeroDataRetentionEligible: false,
    dataRetentionClass: 'covered_model_30d',
    reviewedAt: '2026-06-25',
    source: 'https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5',
  },
  'claude-opus-4-8': {
    provider: 'anthropic',
    family: 'opus',
    supportsTemperature: false,
    supportsEffort: true,
    defaultEffort: 'high',
    thinkingMode: 'adaptive_default_high_effort',
    supportsStructuredOutput: true,
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    refusalSemantics: 'standard_stop_reason',
    requiresRefusalHandling: false,
    zeroDataRetentionEligible: null,
    dataRetentionClass: 'standard',
    reviewedAt: '2026-06-25',
    source: 'https://platform.claude.com/docs/en/about-claude/models/overview',
  },
  'claude-opus-4-7': {
    provider: 'anthropic',
    family: 'opus',
    supportsTemperature: false,
    supportsEffort: true,
    defaultEffort: 'high',
    thinkingMode: 'adaptive_optional',
    supportsStructuredOutput: true,
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    refusalSemantics: 'standard_stop_reason',
    requiresRefusalHandling: false,
    zeroDataRetentionEligible: null,
    dataRetentionClass: 'standard',
    reviewedAt: '2026-06-25',
    source: 'https://platform.claude.com/docs/en/about-claude/models/migration-guide',
  },
  'claude-opus-4-6': {
    provider: 'anthropic',
    family: 'opus',
    supportsTemperature: true,
    supportsEffort: true,
    defaultEffort: 'high',
    thinkingMode: 'adaptive_optional',
    supportsStructuredOutput: true,
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    refusalSemantics: 'standard_stop_reason',
    requiresRefusalHandling: false,
    zeroDataRetentionEligible: null,
    dataRetentionClass: 'standard',
    reviewedAt: '2026-06-25',
    source: 'https://platform.claude.com/docs/en/build-with-claude/effort',
  },
  'claude-opus-4-5': {
    provider: 'anthropic',
    family: 'opus',
    supportsTemperature: true,
    supportsEffort: true,
    defaultEffort: 'high',
    thinkingMode: 'adaptive_optional',
    supportsStructuredOutput: true,
    maxInputTokens: 200_000,
    maxOutputTokens: 64_000,
    refusalSemantics: 'standard_stop_reason',
    requiresRefusalHandling: false,
    zeroDataRetentionEligible: null,
    dataRetentionClass: 'standard',
    reviewedAt: '2026-06-25',
    source: 'https://platform.claude.com/docs/en/build-with-claude/effort',
  },
  'claude-sonnet-5': {
    provider: 'anthropic',
    family: 'sonnet',
    supportsTemperature: false,
    supportsEffort: true,
    defaultEffort: 'high',
    thinkingMode: 'adaptive_default_on',
    supportsStructuredOutput: true,
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    refusalSemantics: 'standard_stop_reason',
    requiresRefusalHandling: false,
    zeroDataRetentionEligible: null,
    dataRetentionClass: 'standard',
    reviewedAt: '2026-07-04',
    source: 'https://platform.claude.com/docs/en/about-claude/models/overview',
  },
  'claude-sonnet-4-6': {
    provider: 'anthropic',
    family: 'sonnet',
    supportsTemperature: true,
    supportsEffort: true,
    defaultEffort: 'high',
    thinkingMode: 'adaptive_optional',
    supportsStructuredOutput: true,
    maxInputTokens: 1_000_000,
    maxOutputTokens: 128_000,
    refusalSemantics: 'standard_stop_reason',
    requiresRefusalHandling: false,
    zeroDataRetentionEligible: null,
    dataRetentionClass: 'standard',
    reviewedAt: '2026-06-25',
    source: 'https://platform.claude.com/docs/en/about-claude/models/overview',
  },
  'claude-sonnet-4-5': {
    provider: 'anthropic',
    family: 'sonnet',
    supportsTemperature: true,
    supportsEffort: false,
    defaultEffort: null,
    thinkingMode: 'none',
    supportsStructuredOutput: true,
    maxInputTokens: 200_000,
    maxOutputTokens: 64_000,
    refusalSemantics: 'standard_stop_reason',
    requiresRefusalHandling: false,
    zeroDataRetentionEligible: null,
    dataRetentionClass: 'standard',
    reviewedAt: '2026-06-25',
    source: 'https://platform.claude.com/docs/en/about-claude/models/migration-guide',
  },
  'claude-sonnet-4': {
    provider: 'anthropic',
    family: 'sonnet',
    supportsTemperature: true,
    supportsEffort: false,
    defaultEffort: null,
    thinkingMode: 'none',
    supportsStructuredOutput: false,
    maxInputTokens: 200_000,
    maxOutputTokens: 64_000,
    refusalSemantics: 'standard_stop_reason',
    requiresRefusalHandling: false,
    zeroDataRetentionEligible: null,
    dataRetentionClass: 'standard',
    reviewedAt: '2026-06-25',
    source: 'https://platform.claude.com/docs/en/about-claude/models/overview',
  },
  'claude-haiku-4-5': {
    provider: 'anthropic',
    family: 'haiku',
    supportsTemperature: true,
    supportsEffort: false,
    defaultEffort: null,
    thinkingMode: 'none',
    supportsStructuredOutput: true,
    maxInputTokens: 200_000,
    maxOutputTokens: 64_000,
    refusalSemantics: 'standard_stop_reason',
    requiresRefusalHandling: false,
    zeroDataRetentionEligible: null,
    dataRetentionClass: 'standard',
    reviewedAt: '2026-06-25',
    source: 'https://platform.claude.com/docs/en/about-claude/models/overview',
  },
};

const SORTED_CAPABILITY_ENTRIES = Object.entries(MODEL_CAPABILITIES).sort(
  (a, b) => b[0].length - a[0].length,
);

export const UNKNOWN_MODEL_CAPABILITIES = Object.freeze({
  provider: 'anthropic',
  family: 'unknown',
  supportsTemperature: false,
  supportsEffort: false,
  defaultEffort: null,
  thinkingMode: 'unknown',
  supportsStructuredOutput: false,
  maxInputTokens: null,
  maxOutputTokens: null,
  refusalSemantics: 'unknown',
  requiresRefusalHandling: true,
  zeroDataRetentionEligible: null,
  dataRetentionClass: 'unknown',
  reviewedAt: null,
  source: null,
  unknown: true,
});

export function lookupModelCapabilities(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  if (MODEL_CAPABILITIES[modelId]) return MODEL_CAPABILITIES[modelId];
  for (const [key, capabilities] of SORTED_CAPABILITY_ENTRIES) {
    if (!modelId.startsWith(key)) continue;
    const next = modelId[key.length];
    if (next === undefined || next === '-') return capabilities;
  }
  return null;
}

export function requestCapabilitiesForModel(modelId) {
  return lookupModelCapabilities(modelId) || UNKNOWN_MODEL_CAPABILITIES;
}
