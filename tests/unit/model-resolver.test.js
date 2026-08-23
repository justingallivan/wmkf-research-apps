/**
 * @jest-environment node
 */

const {
  clearAvailableModelsCache,
  resolveModelWithCapabilities,
} = require('../../lib/services/model-resolver.js');

describe('resolveModelWithCapabilities', () => {
  afterEach(() => {
    clearAvailableModelsCache();
  });

  it('returns the resolved tier fallback and its reviewed capabilities together', () => {
    const resolved = resolveModelWithCapabilities('sonnet');

    expect(resolved).toMatchObject({
      rawModel: 'sonnet',
      model: 'claude-sonnet-5',
      resolvedId: 'claude-sonnet-5',
      isTier: true,
    });
    expect(resolved.capabilities).toMatchObject({
      family: 'sonnet',
      supportsTemperature: false,
    });
    expect(resolved.capabilities).not.toHaveProperty('unknown');
  });

  it('uses the reviewed Opus 5 fallback when the live model list is unavailable', () => {
    const resolved = resolveModelWithCapabilities('opus');

    expect(resolved).toMatchObject({
      rawModel: 'opus',
      model: 'claude-opus-5',
      resolvedId: 'claude-opus-5',
      isTier: true,
      capabilities: {
        family: 'opus',
        supportsTemperature: false,
        requiresRefusalHandling: true,
      },
    });
  });

  it('passes concrete ids through while returning matching capabilities', () => {
    const resolved = resolveModelWithCapabilities('claude-opus-4-8');

    expect(resolved).toMatchObject({
      rawModel: 'claude-opus-4-8',
      model: 'claude-opus-4-8',
      resolvedId: 'claude-opus-4-8',
      isTier: false,
    });
    expect(resolved.capabilities).toMatchObject({
      family: 'opus',
      supportsTemperature: false,
    });
  });

  it('returns the reviewed Opus 5 request and refusal contract', () => {
    const resolved = resolveModelWithCapabilities('claude-opus-5');

    expect(resolved).toMatchObject({
      rawModel: 'claude-opus-5',
      model: 'claude-opus-5',
      resolvedId: 'claude-opus-5',
      isTier: false,
      capabilities: {
        family: 'opus',
        supportsTemperature: false,
        supportsEffort: true,
        supportsStructuredOutput: true,
        thinkingMode: 'adaptive_default_on',
        maxInputTokens: 1_000_000,
        maxOutputTokens: 128_000,
        refusalSemantics: 'http_200_stop_reason_refusal',
        requiresRefusalHandling: true,
      },
    });
    expect(resolved.capabilities).not.toHaveProperty('unknown');
  });

  it('keeps unknown concrete ids fail-closed for optional request params', () => {
    const resolved = resolveModelWithCapabilities('claude-future-99');

    expect(resolved).toMatchObject({
      rawModel: 'claude-future-99',
      model: 'claude-future-99',
      resolvedId: 'claude-future-99',
      isTier: false,
    });
    expect(resolved.capabilities).toMatchObject({
      unknown: true,
      supportsTemperature: false,
      supportsEffort: false,
    });
  });
});
