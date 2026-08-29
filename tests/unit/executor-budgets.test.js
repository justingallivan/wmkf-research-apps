import { EXECUTOR_BUDGETS, lookupExecutorBudget } from '../../shared/config/executorBudgets.js';
import { PRE_SITE_VISIT_CONTRACT } from '../../shared/config/requestDocument.js';
import { lookupModelCapabilities } from '../../lib/services/model-capabilities.js';
import { resolveModel } from '../../lib/services/model-resolver.js';
import { BASE_CONFIG } from '../../shared/config/baseConfig.js';

// The registry is what the Admin panel shows AND what the callers send, so its
// keys must be the real prompt names and its numbers must stay under the
// reviewed output ceiling of the model each prompt resolves to by default.

test('registry keys are the prompt names the callers use', () => {
  expect(lookupExecutorBudget(PRE_SITE_VISIT_CONTRACT.promptName)).toMatchObject({
    kind: 'standing',
    maxTokensOverride: 32_768,
    timeoutMsOverride: 240_000,
  });
  expect(lookupExecutorBudget('review-synthesis.generate')).toMatchObject({
    kind: 'retry',
    floor: 16_000,
    ceiling: 32_000,
  });
  expect(lookupExecutorBudget('no-such-prompt')).toBeNull();
  expect(lookupExecutorBudget(null)).toBeNull();
});

test('every budget fits inside the default model\'s reviewed output ceiling', () => {
  const defaultId = resolveModel(BASE_CONFIG.CLAUDE.DEFAULT_MODEL) || BASE_CONFIG.CLAUDE.DEFAULT_MODEL;
  const ceiling = lookupModelCapabilities(defaultId)?.maxOutputTokens;
  expect(Number.isInteger(ceiling)).toBe(true);
  for (const [name, entry] of Object.entries(EXECUTOR_BUDGETS)) {
    const budget = entry.kind === 'standing' ? entry.maxTokensOverride : entry.ceiling;
    expect(Number.isInteger(budget) && budget > 0).toBe(true);
    expect(budget).toBeLessThanOrEqual(ceiling);
    expect(typeof entry.since).toBe('string');
    expect(typeof entry.reason).toBe('string');
    expect(name).toBe(name.trim());
  }
});

test('the panel\'s hand-copied row default matches BASE_CONFIG', () => {
  // shared/components/admin/PromptTemplatesSection.js mirrors this as
  // ROW_DEFAULT_MAX_TOKENS (kept out of the client bundle); a change here must
  // be carried there.
  expect(BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS).toBe(16384);
});
