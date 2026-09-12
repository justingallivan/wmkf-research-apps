/**
 * @jest-environment node
 */

const {
  clearAvailableModelsCache,
  getTierCatalog,
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

  it('resolves the fable tier to the reviewed Fable 5.1 fallback with the always-on thinking contract', () => {
    const resolved = resolveModelWithCapabilities('fable');

    expect(resolved).toMatchObject({
      rawModel: 'fable',
      model: 'claude-fable-5-1',
      resolvedId: 'claude-fable-5-1',
      isTier: true,
      capabilities: {
        family: 'fable',
        supportsTemperature: false,
        supportsEffort: true,
        thinkingMode: 'adaptive_always_on',
        requiresRefusalHandling: true,
      },
    });
  });

  it('lists the fable tier first in the admin catalog as "extra high" above Opus', () => {
    const catalog = getTierCatalog();

    expect(catalog.map((t) => t.key)).toEqual(['fable', 'opus', 'sonnet', 'haiku']);
    expect(catalog[0]).toMatchObject({ anthropic: 'Fable', tier: 'extra high', resolvedId: 'claude-fable-5-1' });
    expect(catalog[1]).toMatchObject({ anthropic: 'Opus', tier: 'high' });
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
