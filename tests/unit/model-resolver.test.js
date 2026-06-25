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
      model: 'claude-sonnet-4-6',
      resolvedId: 'claude-sonnet-4-6',
      isTier: true,
    });
    expect(resolved.capabilities).toMatchObject({
      family: 'sonnet',
      supportsTemperature: true,
    });
    expect(resolved.capabilities).not.toHaveProperty('unknown');
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
