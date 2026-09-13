/**
 * @jest-environment node
 */

import {
  validateReviewedClaudeModelValue,
  validateReviewedProviderModelValue,
} from '../../lib/services/model-review-validation';

describe('validateReviewedClaudeModelValue', () => {
  it('accepts tier keys and normalizes them to lowercase', () => {
    expect(validateReviewedClaudeModelValue('Sonnet')).toMatchObject({
      valid: true,
      value: 'sonnet',
      kind: 'tier',
    });
  });

  it('accepts concrete Claude ids only when capability and pricing entries exist', () => {
    expect(validateReviewedClaudeModelValue('claude-sonnet-4-6')).toMatchObject({
      valid: true,
      value: 'claude-sonnet-4-6',
      kind: 'claude',
    });

    expect(validateReviewedClaudeModelValue('claude-future-99')).toMatchObject({
      valid: false,
      code: 'unreviewed_claude_model',
    });
  });

  it('rejects non-Claude model ids by default', () => {
    expect(validateReviewedClaudeModelValue('gpt-4o-mini')).toMatchObject({
      valid: false,
      code: 'invalid_model_value',
    });
  });

  it('can treat empty model values as an allowed default-model fallback', () => {
    expect(validateReviewedClaudeModelValue('', { allowEmpty: true })).toEqual({
      valid: true,
      value: null,
      kind: 'empty',
    });
  });
});

describe('validateReviewedProviderModelValue', () => {
  it('accepts only a reviewed, priced model owned by the fixed provider', () => {
    expect(validateReviewedProviderModelValue('gpt-5.6-sol', { provider: 'openai' }))
      .toMatchObject({ valid: true, value: 'gpt-5.6-sol' });
  });

  it('rejects provider mismatch, tier aliases, and unreviewed models', () => {
    expect(validateReviewedProviderModelValue('claude-sonnet-5', { provider: 'openai' }).code)
      .toBe('provider_model_mismatch');
    expect(validateReviewedProviderModelValue('sonnet', { provider: 'anthropic' }).code)
      .toBe('provider_model_mismatch');
    expect(validateReviewedProviderModelValue('gpt-future', { provider: 'openai' }).code)
      .toBe('unreviewed_provider_model');
  });
});
