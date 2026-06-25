/**
 * @jest-environment node
 */

import { validateReviewedClaudeModelValue } from '../../lib/services/model-review-validation';

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
