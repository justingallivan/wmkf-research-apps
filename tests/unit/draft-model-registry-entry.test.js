const { draftEntries, pickAncestor, thinkingModeFromApi } = require('../../scripts/draft-model-registry-entry');

const CAPABILITIES = {
  'claude-fable-5-1': {
    provider: 'anthropic', family: 'fable', supportsTemperature: false, defaultEffort: 'high',
    maxOutputTokens: 128_000, dataRetentionClass: 'covered_model_30d', reviewedAt: '2026-09-12',
  },
  'claude-fable-5': {
    provider: 'anthropic', family: 'fable', supportsTemperature: false, defaultEffort: 'high',
    maxOutputTokens: 128_000, dataRetentionClass: 'covered_model_30d', reviewedAt: '2026-06-25',
  },
  'claude-opus-5-5': { provider: 'anthropic', family: 'opus', defaultEffort: 'medium', reviewedAt: '2026-10-02' },
};
const PRICING = { 'claude-fable-5-1': { input: 1000, output: 5000, cacheReadMultiplier: 0.025 } };

const MODEL = {
  id: 'claude-fable-5-9',
  line: 'fable',
  max_input_tokens: 1_000_000,
  max_tokens: 64_000,
  capabilities: {
    effort: { supported: true },
    structured_outputs: { supported: true },
    thinking: { supported: true, types: { adaptive: { supported: true }, disabled: { supported: false } } },
  },
};

describe('draft-model-registry-entry', () => {
  it('copies defaults from the most recently reviewed entry in the same family', () => {
    expect(pickAncestor(CAPABILITIES, 'fable', 'claude-fable-5-9')).toBe('claude-fable-5-1');
    expect(pickAncestor(CAPABILITIES, 'haiku', 'claude-haiku-9')).toBeNull();
  });

  it('derives only the always-on and no-thinking modes from the Models API', () => {
    expect(thinkingModeFromApi(MODEL.capabilities.thinking)).toBe('adaptive_always_on');
    expect(thinkingModeFromApi({ supported: false })).toBe('none');
    expect(thinkingModeFromApi({ supported: true, types: { adaptive: { supported: true }, disabled: { supported: true } } }))
      .toBeUndefined();
  });

  it('fills API-answerable fields, flags changes, and marks the rest CONFIRM', () => {
    const draft = draftEntries(MODEL, CAPABILITIES, PRICING);
    const byName = Object.fromEntries(draft.fields.map((f) => [f.name, f]));

    expect(draft.ancestorKey).toBe('claude-fable-5-1');
    expect(byName.maxOutputTokens).toMatchObject({ value: 64_000, origin: 'api', confirm: false });
    expect(byName.maxOutputTokens.note).toMatch(/differs from claude-fable-5-1/);
    expect(byName.supportsTemperature).toMatchObject({ value: false, origin: 'ancestor', confirm: true });
    expect(byName.dataRetentionClass).toMatchObject({ value: 'covered_model_30d', confirm: true });
    expect(draft.pricing).toEqual({ input: 1000, output: 5000, cacheReadMultiplier: 0.025 });
  });

  it('leaves reviewedAt invalid so check:model-registry rejects an unedited paste', () => {
    const draft = draftEntries(MODEL, CAPABILITIES, PRICING);
    expect(draft.entry.reviewedAt).toBe('UNREVIEWED');
    expect(draft.entry.reviewedAt).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reports an id that already has registry entries', () => {
    const draft = draftEntries({ ...MODEL, id: 'claude-fable-5-1' }, CAPABILITIES, PRICING);
    expect(draft.existingCapability).toBe(true);
    expect(draft.existingPricing).toBe(true);
    expect(draft.ancestorKey).toBe('claude-fable-5');
  });
});
