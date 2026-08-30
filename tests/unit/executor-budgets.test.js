import {
  EXECUTOR_BUDGET_DEFAULTS,
  EXECUTOR_BUDGET_DESCRIPTIONS,
} from '../../shared/config/executorBudgets.js';
import { PRE_SITE_VISIT_CONTRACT } from '../../shared/config/requestDocument.js';
import { lookupModelCapabilities } from '../../lib/services/model-capabilities.js';
import { resolveModel } from '../../lib/services/model-resolver.js';
import { BASE_CONFIG } from '../../shared/config/baseConfig.js';
import { resolveMaxTokensForCall } from '../../lib/services/execute-prompt.js';

// Code defaults are the bounded outage fallback and initial Admin values. They
// must use the real prompt names and remain under the reviewed default model's
// output ceiling.

test('registry keys are the prompt names the callers use', () => {
  expect(EXECUTOR_BUDGET_DEFAULTS[PRE_SITE_VISIT_CONTRACT.promptName]).toMatchObject({
    kind: 'standing',
    maxTokensOverride: 32_768,
    timeoutMsOverride: 240_000,
  });
  expect(EXECUTOR_BUDGET_DEFAULTS['review-synthesis.generate']).toMatchObject({
    kind: 'retry',
    floor: 16_000,
    ceiling: 32_000,
  });
});

test('every budget fits inside the default model\'s reviewed output ceiling', () => {
  const defaultId = resolveModel(BASE_CONFIG.CLAUDE.DEFAULT_MODEL) || BASE_CONFIG.CLAUDE.DEFAULT_MODEL;
  const ceiling = lookupModelCapabilities(defaultId)?.maxOutputTokens;
  expect(Number.isInteger(ceiling)).toBe(true);
  for (const [name, entry] of Object.entries(EXECUTOR_BUDGET_DEFAULTS)) {
    const budget = entry.kind === 'standing' ? entry.maxTokensOverride : entry.ceiling;
    expect(Number.isInteger(budget) && budget > 0).toBe(true);
    expect(budget).toBeLessThanOrEqual(ceiling);
    expect(typeof EXECUTOR_BUDGET_DESCRIPTIONS[name].since).toBe('string');
    expect(typeof EXECUTOR_BUDGET_DESCRIPTIONS[name].reason).toBe('string');
    expect(name).toBe(name.trim());
  }
});

test('the panel\'s hand-copied row default matches BASE_CONFIG', () => {
  // shared/components/admin/PromptTemplatesSection.js mirrors this as
  // ROW_DEFAULT_MAX_TOKENS (kept out of the client bundle); a change here must
  // be carried there.
  expect(BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS).toBe(16384);
});

test('the final Executor seam caps a server override to the resolved model ceiling', () => {
  expect(resolveMaxTokensForCall({
    configuredMaxTokens: 16384,
    maxTokensOverride: 96000,
    model: 'claude-limited',
    maxOutputTokens: 64000,
  })).toBe(64000);
  expect(() => resolveMaxTokensForCall({
    configuredMaxTokens: 16384,
    maxTokensOverride: 96000,
    model: 'claude-limited',
    maxOutputTokens: 16000,
    minimumEffectiveMaxTokensExclusive: 16000,
  })).toThrow(/must exceed prior attempt budget/);
  expect(() => resolveMaxTokensForCall({
    configuredMaxTokens: 96000,
    maxTokensOverride: null,
    model: 'claude-limited',
    maxOutputTokens: 64000,
  })).toThrow(/exceeds reviewed limit/);
});
