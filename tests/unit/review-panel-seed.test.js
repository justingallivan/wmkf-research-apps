/** @jest-environment node */
// Dry-run only: planSeed/seedPromptRow (Dataverse I/O) are always mocked here.
// Never invoke this script's --dry-run/--execute directly against .env.local
// (it points at PRODUCTION Dataverse) — see the script's module docstring.
import { validateReviewedClaudeModelValue } from '../../lib/services/model-review-validation';
import {
  DEFINITIONS, PROMPTSTATUS_PUBLISHED, validateDefinition, recordData,
  planReviewPanelSeed, executeReviewPanelSeed,
} from '../../scripts/seed-review-panel-prompts.js';

const SEAT_CLAUDE_DEFAULT_MODEL = 'claude-opus-5';

test('DEFINITIONS carries exactly the seat and chair prompts', () => {
  expect(DEFINITIONS.map((d) => d.definition.PROMPT_NAME).sort()).toEqual(['review-panel.chair', 'review-panel.seat']);
});

test('the seat row seeds a 16000 default maxTokens (headroom only; SEAT_ANSWER_MAX_CHARS is the real output-size control)', () => {
  const seat = DEFINITIONS.find((d) => d.definition.PROMPT_NAME === 'review-panel.seat');
  expect(seat.maxTokens).toBe(16000);
});

describe('validateDefinition', () => {
  test('accepts both definitions with the reviewed seat.claude default model', () => {
    for (const item of DEFINITIONS) {
      expect(() => validateDefinition(item.definition, { validateReviewedClaudeModelValue, model: SEAT_CLAUDE_DEFAULT_MODEL })).not.toThrow();
    }
  });

  test('rejects an unreviewed bootstrap model', () => {
    expect(() => validateDefinition(DEFINITIONS[0].definition, { validateReviewedClaudeModelValue, model: 'claude-nonexistent-9' }))
      .toThrow(/not a reviewed structured-output Claude model/);
  });

  test('rejects a definition whose output declares a persistence target (defense in depth against a future drift)', () => {
    const mutated = { ...DEFINITIONS[0].definition, OUTPUT_SCHEMA: { ...DEFINITIONS[0].definition.OUTPUT_SCHEMA, outputs: [{ name: 'x', target: { kind: 'akoya_request', field: 'y' } }] } };
    expect(() => validateDefinition(mutated, { validateReviewedClaudeModelValue, model: SEAT_CLAUDE_DEFAULT_MODEL })).toThrow(/pass-through only/);
  });

  test('rejects an untrusted variable missing dataClass/maxChars', () => {
    const mutated = { ...DEFINITIONS[0].definition, VARIABLES: { variables: [{ name: 'x', required: true, placement: 'user', source: { kind: 'override' }, untrusted: true }] } };
    expect(() => validateDefinition(mutated, { validateReviewedClaudeModelValue, model: SEAT_CLAUDE_DEFAULT_MODEL })).toThrow(/missing dataClass\/maxChars/);
  });
});

describe('recordData', () => {
  test('pins the requested model, PUBLISHED status, and stringifies the variable/schema contracts', () => {
    const row = recordData(DEFINITIONS[0].definition, 8000, 'test notes', SEAT_CLAUDE_DEFAULT_MODEL);
    expect(row.wmkf_ai_model).toBe(SEAT_CLAUDE_DEFAULT_MODEL);
    expect(row.wmkf_ai_promptstatus).toBe(PROMPTSTATUS_PUBLISHED);
    expect(JSON.parse(row.wmkf_ai_promptvariables)).toEqual(DEFINITIONS[0].definition.VARIABLES);
    expect(JSON.parse(row.wmkf_ai_promptoutputschema)).toEqual(DEFINITIONS[0].definition.OUTPUT_SCHEMA);
  });
});

describe('planReviewPanelSeed (dry-run)', () => {
  test('plans both rows via the injected (mocked) planSeed, never touching Dataverse directly', async () => {
    const planSeed = jest.fn().mockResolvedValue({ action: 'create', rows: [] });
    const plans = await planReviewPanelSeed({ planSeed, model: SEAT_CLAUDE_DEFAULT_MODEL, validateReviewedClaudeModelValue });
    expect(planSeed).toHaveBeenCalledTimes(2);
    expect(planSeed).toHaveBeenCalledWith({ promptName: 'review-panel.seat', force: false });
    expect(planSeed).toHaveBeenCalledWith({ promptName: 'review-panel.chair', force: false });
    expect(plans.map((p) => p.name).sort()).toEqual(['review-panel.chair', 'review-panel.seat']);
  });

  test('a plan refusal is surfaced (dry-run reports it; does not throw during planning)', async () => {
    const planSeed = jest.fn().mockResolvedValue({ action: 'refuse', rows: [] });
    const plans = await planReviewPanelSeed({ planSeed, model: SEAT_CLAUDE_DEFAULT_MODEL, validateReviewedClaudeModelValue });
    expect(plans.every((p) => p.plan.action === 'refuse')).toBe(true);
  });

  test('an unreviewed model aborts planning before any planSeed call', async () => {
    const planSeed = jest.fn();
    await expect(planReviewPanelSeed({ planSeed, model: 'claude-nonexistent-9', validateReviewedClaudeModelValue })).rejects.toThrow();
    expect(planSeed).not.toHaveBeenCalled();
  });
});

describe('executeReviewPanelSeed', () => {
  class SeedRefused extends Error { constructor(message, plan) { super(message); this.plan = plan; } }

  test('throws SeedRefused and never calls seedPromptRow when the plan refuses', async () => {
    const planSeed = jest.fn().mockResolvedValue({ action: 'refuse', rows: [] });
    const seedPromptRow = jest.fn();
    const fetchCurrentPrompt = jest.fn();
    await expect(executeReviewPanelSeed({ planSeed, seedPromptRow, fetchCurrentPrompt, SeedRefused, model: SEAT_CLAUDE_DEFAULT_MODEL, validateReviewedClaudeModelValue }))
      .rejects.toBeInstanceOf(SeedRefused);
    expect(seedPromptRow).not.toHaveBeenCalled();
  });

  test('applies both rows and readback-verifies id/version/model', async () => {
    const planSeed = jest.fn().mockResolvedValue({ action: 'create', rows: [] });
    const seedPromptRow = jest.fn().mockResolvedValue({ action: 'create', id: 'prompt-1', version: 1 });
    const fetchCurrentPrompt = jest.fn().mockResolvedValue({ wmkf_ai_promptid: 'prompt-1', wmkf_promptversion: 1, wmkf_ai_model: SEAT_CLAUDE_DEFAULT_MODEL });
    const results = await executeReviewPanelSeed({ planSeed, seedPromptRow, fetchCurrentPrompt, SeedRefused, model: SEAT_CLAUDE_DEFAULT_MODEL, validateReviewedClaudeModelValue });
    expect(seedPromptRow).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { name: 'review-panel.seat', action: 'create', version: 1, id: 'prompt-1' },
      { name: 'review-panel.chair', action: 'create', version: 1, id: 'prompt-1' },
    ]);
  });

  test('throws on a readback mismatch instead of reporting success', async () => {
    const planSeed = jest.fn().mockResolvedValue({ action: 'create', rows: [] });
    const seedPromptRow = jest.fn().mockResolvedValue({ action: 'create', id: 'prompt-1', version: 1 });
    const fetchCurrentPrompt = jest.fn().mockResolvedValue({ wmkf_ai_promptid: 'DIFFERENT-ID', wmkf_promptversion: 1, wmkf_ai_model: SEAT_CLAUDE_DEFAULT_MODEL });
    await expect(executeReviewPanelSeed({ planSeed, seedPromptRow, fetchCurrentPrompt, SeedRefused, model: SEAT_CLAUDE_DEFAULT_MODEL, validateReviewedClaudeModelValue }))
      .rejects.toThrow(/Readback mismatch/);
  });
});
