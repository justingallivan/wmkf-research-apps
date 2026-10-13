/**
 * Pins the reviewed Sonnet 5.5 / Haiku 5.5 registry entries (2026-10-12) so a
 * silent edit of a request-shaping field fails here as well as in
 * `npm run check:model-registry`.
 */
const { MODEL_CAPABILITIES, lookupModelCapabilities } = require('../../lib/services/model-capabilities.js');
const { lookupPricing } = require('../../lib/utils/model-pricing.js');
const { isReviewedModel, TIER_FALLBACK_IDS } = require('../../lib/services/model-resolver.js');

describe.each([
  ['claude-sonnet-5-5', 'sonnet', 'high', 'sonnet-5-5'],
  ['claude-haiku-5-5', 'haiku', 'medium', 'haiku-5-5'],
])('%s capability entry', (id, family, defaultEffort, sourceFragment) => {
  const cap = MODEL_CAPABILITIES[id];

  test('is registered with the documented request-shaping values', () => {
    expect(cap).toBeDefined();
    expect(lookupModelCapabilities(id)).toBe(cap);
    expect(cap).toMatchObject({
      provider: 'anthropic',
      family,
      supportsTemperature: false,
      supportsEffort: true,
      defaultEffort,
      thinkingMode: 'adaptive_default_on',
      supportsStructuredOutput: true,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 128_000,
      refusalSemantics: 'http_200_stop_reason_refusal',
      requiresRefusalHandling: true,
      zeroDataRetentionEligible: null,
      reviewedAt: '2026-10-12',
    });
    expect(cap.source).toContain('https://platform.claude.com/docs/en/models/');
    expect(cap.source).toContain(sourceFragment);
  });

  test('is reviewed in both registries', () => {
    expect(lookupPricing(id)).not.toBeNull();
    expect(isReviewedModel(id)).toBe(true);
  });
});

test('tier fallback ids are unchanged by the 5.5 registry additions', () => {
  expect(TIER_FALLBACK_IDS.sonnet).toBe('claude-sonnet-5');
  expect(TIER_FALLBACK_IDS.haiku).toBe('claude-haiku-4-5-20251001');
});
