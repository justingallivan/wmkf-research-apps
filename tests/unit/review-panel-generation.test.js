/** @jest-environment node */
jest.mock('../../lib/services/review-panel-store', () => ({
  finalizeAttempt: jest.fn().mockResolvedValue({ outcome: 'finalized' }),
}));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../shared/config/baseConfig', () => {
  const actual = jest.requireActual('../../shared/config/baseConfig');
  return { ...actual, getModelForApp: jest.fn() };
});
jest.mock('../../lib/services/prompt-store', () => ({ fetchCurrentPrompt: jest.fn() }));
jest.mock('../../lib/services/multi-llm-service', () => ({ MultiLLMService: { getAvailableProviders: jest.fn(() => ['claude', 'openai']) } }));
jest.mock('../../lib/external/review-question-fetcher', () => ({
  getAuthoritativeQuestionSet: jest.fn(),
  questionSetVersion: jest.fn(() => 'v-fixture'),
}));
jest.mock('../../lib/services/executor-budget-service', () => ({
  getExecutorBudget: jest.fn((promptName) => Promise.resolve(
    promptName === 'review-panel.chair'
      ? { timeoutMsOverride: 150000, maxTokensOverride: 12000 }
      : { timeoutMsOverride: 150000, maxTokensOverride: 16000 },
  )),
}));
jest.mock('../../lib/utils/model-pricing', () => {
  const actual = jest.requireActual('../../lib/utils/model-pricing');
  return { ...actual, lookupPricing: jest.fn(actual.lookupPricing) };
});

import { finalizeAttempt } from '../../lib/services/review-panel-store';
import { loadModelOverrides } from '../../lib/services/model-override-loader';
import { getModelForApp } from '../../shared/config/baseConfig';
import { fetchCurrentPrompt } from '../../lib/services/prompt-store';
import { MultiLLMService } from '../../lib/services/multi-llm-service';
import { getAuthoritativeQuestionSet } from '../../lib/external/review-question-fetcher';
import { lookupPricing } from '../../lib/utils/model-pricing';
import * as seatDefinition from '../../shared/config/prompts/review-panel-seat.js';
import * as chairDefinition from '../../shared/config/prompts/review-panel-chair.js';
import {
  snapshotConfiguration, runSeat, runChair, estimateReservationCost,
  ReviewPanelGenerationError, SEAT_PROMPT_NAME, CHAIR_PROMPT_NAME,
} from '../../lib/services/review-panel-generation';

const QUESTION_FIELDS = [
  { key: 'affiliation', order: 0, type: 'string', maxLength: 300 },
  { key: 'priorWork', order: 1, type: 'richtext', maxLength: 50000 },
  { key: 'teamCapacity', order: 7, type: 'richtext', maxLength: 50000 },
];

// Rows must satisfy snapshotConfiguration's snapshotPrompt drift check: their
// variables/output-schema must be STRUCTURALLY equal (key order/whitespace
// independent) to the CANONICAL static definitions (built from the real
// files, not hand-typed, so this fixture can't silently drift from what the
// gate actually enforces).
const SEAT_ROW_BASE = {
  wmkf_ai_promptname: SEAT_PROMPT_NAME, wmkf_ai_promptid: '11111111-1111-1111-1111-111111111111',
  wmkf_promptversion: 1, wmkf_ai_model: 'claude-fable-5-1', wmkf_ai_systemprompt: seatDefinition.SYSTEM_PROMPT, wmkf_ai_promptbody: seatDefinition.USER_PROMPT_TEMPLATE,
  wmkf_ai_maxtokens: 8000, wmkf_ai_promptvariables: JSON.stringify(seatDefinition.VARIABLES),
  wmkf_ai_promptoutputschema: JSON.stringify(seatDefinition.OUTPUT_SCHEMA),
};
const CHAIR_ROW_BASE = {
  wmkf_ai_promptname: CHAIR_PROMPT_NAME, wmkf_ai_promptid: '22222222-2222-2222-2222-222222222222',
  wmkf_promptversion: 1, wmkf_ai_model: 'claude-fable-5-1', wmkf_ai_systemprompt: chairDefinition.SYSTEM_PROMPT, wmkf_ai_promptbody: chairDefinition.USER_PROMPT_TEMPLATE,
  wmkf_ai_maxtokens: 12000, wmkf_ai_promptvariables: JSON.stringify(chairDefinition.VARIABLES),
  wmkf_ai_promptoutputschema: JSON.stringify(chairDefinition.OUTPUT_SCHEMA),
};

const INPUT = Object.freeze({ requestId: 'r1', requestNumber: '2026-001', narrative: Object.freeze({ text: 'A narrative.', sha256: 'abc', sourcePath: 'x' }), institution: 'Uni', title: 'T' });

function mockModels({ seatClaude = 'claude-fable-5-1', seatOpenai = 'gpt-5.6-sol', chair = 'claude-opus-5' } = {}) {
  getModelForApp.mockImplementation((appKey, slot) => {
    if (slot === 'seat.claude') return seatClaude;
    if (slot === 'seat.openai') return seatOpenai;
    if (slot === 'chair') return chair;
    return null;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  finalizeAttempt.mockResolvedValue({ outcome: 'finalized' });
  fetchCurrentPrompt.mockImplementation(async (name) => (name === SEAT_PROMPT_NAME ? { ...SEAT_ROW_BASE } : { ...CHAIR_ROW_BASE }));
  getAuthoritativeQuestionSet.mockResolvedValue(QUESTION_FIELDS);
  MultiLLMService.getAvailableProviders.mockReturnValue(['claude', 'openai']);
  delete process.env.VRP_ALLOWED_PROVIDERS;
  mockModels();
});

describe('snapshotConfiguration', () => {
  test('awaits loadModelOverrides before resolving any model', async () => {
    const config = await snapshotConfiguration();
    expect(loadModelOverrides).toHaveBeenCalled();
    expect(config.seats['seat.claude'].model).toBe('claude-fable-5-1');
    expect(config.seats['seat.openai'].model).toBe('gpt-5.6-sol');
    expect(config.chair.model).toBe('claude-opus-5');
  });

  test('keys provider on MODEL_CAPABILITIES, not a name regex: an OpenAI-modeled seat gets provider "openai"', async () => {
    const config = await snapshotConfiguration();
    expect(config.seats['seat.openai'].provider).toBe('openai');
    expect(config.seats['seat.claude'].provider).toBe('anthropic');
  });

  test('fails closed when a seat model is absent from MODEL_CAPABILITIES', async () => {
    mockModels({ seatClaude: 'totally-unknown-model-xyz' });
    await expect(snapshotConfiguration()).rejects.toThrow(ReviewPanelGenerationError);
  });

  test('fails closed when a seat model is unknown to both capabilities and pricing', async () => {
    mockModels({ seatOpenai: 'gpt-9-nonexistent' });
    await expect(snapshotConfiguration()).rejects.toThrow(ReviewPanelGenerationError);
  });

  test('fails closed when a seat model HAS reviewed capabilities but pricing is unavailable (exercises the pricing branch specifically, not just the capabilities branch)', async () => {
    lookupPricing.mockImplementationOnce(() => null); // first call is for seat.claude in snapshotConfiguration's loop
    await expect(snapshotConfiguration()).rejects.toThrow(/no reviewed pricing/);
  });

  test('fails closed when the chair model is not anthropic', async () => {
    mockModels({ chair: 'gpt-5.6-sol' });
    await expect(snapshotConfiguration()).rejects.toThrow(/Anthropic/);
  });

  test('fails closed when a model override points a seat at a model from a DIFFERENT vendor than its fixed seat identity (shared/config/reviewPanelSeats.js) — a seat may only be overridden to another reviewed model WITHIN its own vendor', async () => {
    // 'gpt-5.6-sol' is a genuinely reviewed+priced model (the seat.openai
    // default), so this exercises the vendor-identity check specifically,
    // not the capabilities/pricing branches.
    mockModels({ seatClaude: 'gpt-5.6-sol' });
    await expect(snapshotConfiguration()).rejects.toThrow(/fixed to vendor "anthropic"/);
  });

  test('fails closed when a configured seat provider is outside VRP_ALLOWED_PROVIDERS', async () => {
    process.env.VRP_ALLOWED_PROVIDERS = 'claude';
    await expect(snapshotConfiguration()).rejects.toThrow(/allowed provider set/);
  });

  test('question-set fetch failure aborts the whole snapshot/launch', async () => {
    getAuthoritativeQuestionSet.mockRejectedValue(new Error('question set fetch failed'));
    await expect(snapshotConfiguration()).rejects.toThrow('question set fetch failed');
  });

  test('fails closed at launch when the seed has not run (row is null), rather than surfacing a confusing per-attempt error', async () => {
    fetchCurrentPrompt.mockImplementation(async (name) => (name === SEAT_PROMPT_NAME ? null : { ...CHAIR_ROW_BASE }));
    await expect(snapshotConfiguration()).rejects.toThrow(ReviewPanelGenerationError);
  });

  test('fails closed when the seat row has drifted from its seeded static definition (e.g. an admin edit dropped a declared variable)', async () => {
    const drifted = { ...SEAT_ROW_BASE, wmkf_ai_promptvariables: JSON.stringify({ variables: [] }) };
    fetchCurrentPrompt.mockImplementation(async (name) => (name === SEAT_PROMPT_NAME ? drifted : { ...CHAIR_ROW_BASE }));
    await expect(snapshotConfiguration()).rejects.toThrow(/retain its seeded variable/);
  });

  test('fails closed when an admin deletes a template placeholder while its variable stays declared (the model would then silently receive no review_questions text)', async () => {
    const strippedTemplate = { ...SEAT_ROW_BASE, wmkf_ai_promptbody: SEAT_ROW_BASE.wmkf_ai_promptbody.replace('{{review_questions}}', '') };
    fetchCurrentPrompt.mockImplementation(async (name) => (name === SEAT_PROMPT_NAME ? strippedTemplate : { ...CHAIR_ROW_BASE }));
    await expect(snapshotConfiguration()).rejects.toThrow(/declared input names/);
  });

  test('pins the standing Executor budget (max tokens + timeout) per seat and for the chair, frozen at launch', async () => {
    const config = await snapshotConfiguration();
    expect(config.seats['seat.claude'].budget).toEqual({ timeoutMsOverride: 150000, maxTokensOverride: 16000 });
    expect(config.seats['seat.openai'].budget).toEqual({ timeoutMsOverride: 150000, maxTokensOverride: 16000 });
    expect(config.chair.budget).toEqual({ timeoutMsOverride: 150000, maxTokensOverride: 12000 });
    expect(Object.isFrozen(config.chair.budget)).toBe(true);
    expect(Object.isFrozen(config.seats['seat.claude'].budget)).toBe(true);
  });

  test('projects the question set and excludes teamCapacity as a real question (marks it not-assessable)', async () => {
    const config = await snapshotConfiguration();
    expect(config.projectedQuestionSet.some((f) => f.key === 'affiliation')).toBe(false);
    const teamCapacity = config.projectedQuestionSet.find((f) => f.key === 'teamCapacity');
    expect(teamCapacity).toEqual({ key: 'teamCapacity', notAssessable: true });
  });

  // Deep key-reversal: proves the fixture actually has different key order
  // than the canonical definition (JSON.stringify would differ), so a pass
  // here demonstrates the structural comparison, not a fixture that happens
  // to preserve order under both old and new code.
  function reverseKeysDeep(value) {
    if (Array.isArray(value)) return value.map(reverseKeysDeep);
    if (value && typeof value === 'object') {
      return Object.keys(value).reverse().reduce((out, key) => {
        out[key] = reverseKeysDeep(value[key]);
        return out;
      }, {});
    }
    return value;
  }

  test('accepts a variables/output-schema contract that is structurally identical but key-reordered and pretty-printed (canonical parity, not stringified)', async () => {
    const reorderedVariables = reverseKeysDeep(seatDefinition.VARIABLES);
    const reorderedSchema = reverseKeysDeep(seatDefinition.OUTPUT_SCHEMA);
    // Prove the fixture is a genuine discriminator: naive JSON.stringify
    // comparison (the old check) WOULD have rejected this.
    expect(JSON.stringify(reorderedVariables)).not.toBe(JSON.stringify(seatDefinition.VARIABLES));
    expect(JSON.stringify(reorderedSchema)).not.toBe(JSON.stringify(seatDefinition.OUTPUT_SCHEMA));
    const reorderedRow = {
      ...SEAT_ROW_BASE,
      wmkf_ai_promptvariables: JSON.stringify(reorderedVariables, null, 2), // pretty-printed too
      wmkf_ai_promptoutputschema: JSON.stringify(reorderedSchema, null, 2),
    };
    fetchCurrentPrompt.mockImplementation(async (name) => (name === SEAT_PROMPT_NAME ? reorderedRow : { ...CHAIR_ROW_BASE }));
    await expect(snapshotConfiguration()).resolves.toBeDefined();
  });

  test('still fails closed when a variable is missing untrusted:true (a real security-relevant drift, not just key order)', async () => {
    // Drop the `untrusted` key entirely (not just set to false/undefined) —
    // the real-world shape of an admin edit that strips the field.
    const withoutUntrusted = {
      variables: seatDefinition.VARIABLES.variables.map((v) => {
        if (v.name !== 'proposal_narrative') return v;
        const { untrusted, ...rest } = v;
        return rest;
      }),
    };
    const driftedRow = { ...SEAT_ROW_BASE, wmkf_ai_promptvariables: JSON.stringify(withoutUntrusted) };
    fetchCurrentPrompt.mockImplementation(async (name) => (name === SEAT_PROMPT_NAME ? driftedRow : { ...CHAIR_ROW_BASE }));
    await expect(snapshotConfiguration()).rejects.toThrow(/retain its seeded variable/);
  });

  test('D8 rejects a published prompt row pinning a non-Claude concrete model id', async () => {
    const nonClaudeRow = { ...SEAT_ROW_BASE, wmkf_ai_model: 'gpt-5.6-sol' };
    fetchCurrentPrompt.mockImplementation(async (name) => (name === SEAT_PROMPT_NAME ? nonClaudeRow : { ...CHAIR_ROW_BASE }));
    await expect(snapshotConfiguration()).rejects.toThrow(/must pin a concrete Claude model id/);
  });

  test('D8 resolves a tier key (e.g. the editor\'s "opus tier" option) through the same resolver getModelForApp uses, then accepts the resolved concrete id', async () => {
    // Without resolution, the raw "opus" tier key fails D8's concrete-id
    // regex outright and snapshotConfiguration() would reject — so a
    // resolved result here is direct proof the row-level D8 check resolved
    // it (this is independent of the chair's SEPARATE getModelForApp-driven
    // execution model, which mockModels() controls and always overwrites
    // config.chair.model/promptSnapshot.wmkf_ai_model regardless).
    const tierRow = { ...CHAIR_ROW_BASE, wmkf_ai_model: 'opus' };
    fetchCurrentPrompt.mockImplementation(async (name) => (name === CHAIR_PROMPT_NAME ? tierRow : { ...SEAT_ROW_BASE }));
    await expect(snapshotConfiguration()).resolves.toBeDefined();
  });

  test('D8 still fails closed for an unresolvable tier-shaped string that is not a real tier key', async () => {
    const badRow = { ...CHAIR_ROW_BASE, wmkf_ai_model: 'not-a-real-tier' };
    fetchCurrentPrompt.mockImplementation(async (name) => (name === CHAIR_PROMPT_NAME ? badRow : { ...SEAT_ROW_BASE }));
    await expect(snapshotConfiguration()).rejects.toThrow(/must pin a concrete Claude model id/);
  });
});

describe('runSeat', () => {
  async function config() { return snapshotConfiguration(); }

  test('success: finalizeAttempt called with completed and cost_state known when usageComplete===true', async () => {
    const cfg = await config();
    const execute = jest.fn().mockResolvedValue({ parsed: { priorWork: 'x' }, usage: { input_tokens: 100, output_tokens: 50 }, usageComplete: true });
    await runSeat(INPUT, cfg.seats['seat.claude'], { attemptId: 'att-1', dispatchToken: 'tok-1', execute });
    expect(finalizeAttempt).toHaveBeenCalledWith('att-1', 'tok-1', expect.objectContaining({ state: 'completed', costState: 'known' }));
    expect(finalizeAttempt.mock.calls[0][2].costCents).toEqual(expect.any(Number));
  });

  test('success but usageComplete===false: still completed, but cost_state unknown and costCents null', async () => {
    const cfg = await config();
    const execute = jest.fn().mockResolvedValue({ parsed: { priorWork: 'x' }, usage: { input_tokens: 100, output_tokens: 50 }, usageComplete: false });
    await runSeat(INPUT, cfg.seats['seat.claude'], { attemptId: 'att-1', dispatchToken: 'tok-1', execute });
    expect(finalizeAttempt).toHaveBeenCalledWith('att-1', 'tok-1', expect.objectContaining({ state: 'completed', costState: 'unknown', costCents: null }));
  });

  test('provider error with usage and usageComplete:false -> failed, cost_state unknown, costCents null', async () => {
    const cfg = await config();
    const err = Object.assign(new Error('boom'), { usage: { input_tokens: 10, output_tokens: 0 }, usageComplete: false });
    const execute = jest.fn().mockRejectedValue(err);
    await expect(runSeat(INPUT, cfg.seats['seat.claude'], { attemptId: 'att-1', dispatchToken: 'tok-1', execute })).rejects.toThrow('boom');
    expect(finalizeAttempt).toHaveBeenCalledWith('att-1', 'tok-1', expect.objectContaining({ state: 'failed', costState: 'unknown', costCents: null }));
  });

  test('transport error with paidCall:null -> unknown cost even with usage present', async () => {
    const cfg = await config();
    const err = Object.assign(new Error('transport down'), { usage: null, usageComplete: false, paidCall: null });
    const execute = jest.fn().mockRejectedValue(err);
    await expect(runSeat(INPUT, cfg.seats['seat.claude'], { attemptId: 'att-1', dispatchToken: 'tok-1', execute })).rejects.toThrow();
    expect(finalizeAttempt).toHaveBeenCalledWith('att-1', 'tok-1', expect.objectContaining({ costState: 'unknown', costCents: null }));
  });

  test('error path with usageComplete:true but paidCall:null (ambiguous — no confirmed response) -> unknown cost, NOT known: paidCall must be an explicit conjunct alongside usageComplete', async () => {
    const cfg = await config();
    const err = Object.assign(new Error('ambiguous'), { usage: { input_tokens: 100, output_tokens: 50 }, usageComplete: true, paidCall: null });
    const execute = jest.fn().mockRejectedValue(err);
    await expect(runSeat(INPUT, cfg.seats['seat.claude'], { attemptId: 'att-1', dispatchToken: 'tok-1', execute })).rejects.toThrow();
    expect(finalizeAttempt).toHaveBeenCalledWith('att-1', 'tok-1', expect.objectContaining({ costState: 'unknown', costCents: null }));
  });

  test('error path with usageComplete:true AND paidCall:true -> known cost (a confirmed provider response was received and billed)', async () => {
    const cfg = await config();
    const err = Object.assign(new Error('validation failed after response'), { usage: { input_tokens: 100, output_tokens: 50 }, usageComplete: true, paidCall: true });
    const execute = jest.fn().mockRejectedValue(err);
    await expect(runSeat(INPUT, cfg.seats['seat.claude'], { attemptId: 'att-1', dispatchToken: 'tok-1', execute })).rejects.toThrow();
    expect(finalizeAttempt).toHaveBeenCalledWith('att-1', 'tok-1', expect.objectContaining({ costState: 'known' }));
    expect(finalizeAttempt.mock.calls[0][2].costCents).toEqual(expect.any(Number));
  });

  test('a standing maxTokensOverride of 16000 reaches executePrompt as the seat call\'s max tokens, pinned from the snapshot', async () => {
    const cfg = await config();
    const execute = jest.fn().mockResolvedValue({ parsed: {}, usage: {}, usageComplete: true });
    await runSeat(INPUT, cfg.seats['seat.claude'], { attemptId: 'att-1', dispatchToken: 'tok-1', execute });
    expect(execute.mock.calls[0][0].maxTokensOverride).toBe(16000);
  });

  test('a budget missing maxTokensOverride falls back to the prompt row value (executePrompt receives null, not a fabricated number)', async () => {
    const cfg = await config();
    const seatConfigWithoutOverride = { ...cfg.seats['seat.claude'], budget: { timeoutMsOverride: 150000 } };
    const execute = jest.fn().mockResolvedValue({ parsed: {}, usage: {}, usageComplete: true });
    await runSeat(INPUT, seatConfigWithoutOverride, { attemptId: 'att-1', dispatchToken: 'tok-1', execute });
    expect(execute.mock.calls[0][0].maxTokensOverride).toBeNull();
  });

  test('allowedProviders passed to executePrompt equals exactly [seat.provider]', async () => {
    const cfg = await config();
    const execute = jest.fn().mockResolvedValue({ parsed: {}, usage: {}, usageComplete: true });
    await runSeat(INPUT, cfg.seats['seat.openai'], { attemptId: 'att-1', dispatchToken: 'tok-1', execute });
    expect(execute.mock.calls[0][0].allowedProviders).toEqual(['openai']);
  });

  test('DTO-derived variables are exactly {proposal_narrative}; the only other variable is the config-pinned question rendering, and priorAiContext never appears', async () => {
    const cfg = await config();
    const execute = jest.fn().mockResolvedValue({ parsed: {}, usage: {}, usageComplete: true });
    await runSeat(INPUT, cfg.seats['seat.claude'], { attemptId: 'att-1', dispatchToken: 'tok-1', execute });
    const vars = execute.mock.calls[0][0].overrideVariables;
    expect(Object.keys(vars).sort()).toEqual(['proposal_narrative', 'review_questions']);
    expect(vars.proposal_narrative).toBe(INPUT.narrative.text);
    expect(JSON.stringify(vars)).not.toContain('priorAiContext');
  });

  test('an input DTO carrying an extra key outside REVIEW_PANEL_INPUT_KEYS (e.g. priorAiContext) is rejected before any provider call', async () => {
    const cfg = await config();
    const execute = jest.fn().mockResolvedValue({ parsed: {}, usage: {}, usageComplete: true });
    const tainted = { ...INPUT, priorAiContext: { fitRationale: 'leaked' } };
    await expect(runSeat(tainted, cfg.seats['seat.claude'], { attemptId: 'att-1', dispatchToken: 'tok-1', execute })).rejects.toThrow(ReviewPanelGenerationError);
    expect(execute).not.toHaveBeenCalled();
    expect(finalizeAttempt).not.toHaveBeenCalled();
  });
});

describe('runChair', () => {
  test('overrideVariables include the narrative and seat reviews with teamCapacity omitted', async () => {
    const cfg = await snapshotConfiguration();
    const execute = jest.fn().mockResolvedValue({ parsed: { consensus: [] }, usage: { input_tokens: 10, output_tokens: 10 }, usageComplete: true });
    const seatWinners = { 'seat.claude': { priorWork: 'a', teamCapacity: { status: 'not_assessable' } }, 'seat.openai': { priorWork: 'b', teamCapacity: { status: 'not_assessable' } } };
    await runChair(INPUT, seatWinners, cfg.chair, { attemptId: 'att-chair', dispatchToken: 'tok-c', execute });
    const sentReviews = JSON.parse(execute.mock.calls[0][0].overrideVariables.seat_reviews);
    expect(sentReviews['seat.claude']).toEqual({ priorWork: 'a' });
    expect(Object.values(sentReviews).some((r) => 'teamCapacity' in r)).toBe(false);
    expect(execute.mock.calls[0][0].allowedProviders).toEqual(['anthropic']);
    expect(finalizeAttempt).toHaveBeenCalledWith('att-chair', 'tok-c', expect.objectContaining({ state: 'completed' }));
  });

  test('a standing maxTokensOverride of 12000 reaches executePrompt as the chair call\'s max tokens, pinned from the snapshot', async () => {
    const cfg = await snapshotConfiguration();
    const execute = jest.fn().mockResolvedValue({ parsed: { consensus: [] }, usage: { input_tokens: 10, output_tokens: 10 }, usageComplete: true });
    const seatWinners = { 'seat.claude': { priorWork: 'a' }, 'seat.openai': { priorWork: 'b' } };
    await runChair(INPUT, seatWinners, cfg.chair, { attemptId: 'att-chair', dispatchToken: 'tok-c', execute });
    expect(execute.mock.calls[0][0].maxTokensOverride).toBe(12000);
  });

  test('a budget missing maxTokensOverride falls back to the prompt row value (executePrompt receives null)', async () => {
    const cfg = await snapshotConfiguration();
    const chairConfigWithoutOverride = { ...cfg.chair, budget: { timeoutMsOverride: 150000 } };
    const execute = jest.fn().mockResolvedValue({ parsed: { consensus: [] }, usage: { input_tokens: 10, output_tokens: 10 }, usageComplete: true });
    const seatWinners = { 'seat.claude': { priorWork: 'a' }, 'seat.openai': { priorWork: 'b' } };
    await runChair(INPUT, seatWinners, chairConfigWithoutOverride, { attemptId: 'att-chair', dispatchToken: 'tok-c', execute });
    expect(execute.mock.calls[0][0].maxTokensOverride).toBeNull();
  });

  test('refuses to synthesize over a seat_reviews payload that would exceed the declared size cap — executePrompt is never called, so wrapUntrustedContent can never silently truncate it', async () => {
    const cfg = await snapshotConfiguration();
    const execute = jest.fn().mockResolvedValue({ parsed: { consensus: [] }, usage: { input_tokens: 10, output_tokens: 10 }, usageComplete: true });
    // One seat's review alone, well past the declared cap once JSON-stringified.
    const oversizedText = 'x'.repeat(500000);
    const seatWinners = { 'seat.claude': { priorWork: oversizedText }, 'seat.openai': { priorWork: 'b' } };
    await expect(runChair(INPUT, seatWinners, cfg.chair, { attemptId: 'att-chair', dispatchToken: 'tok-c', execute }))
      .rejects.toThrow(/exceeds the declared size cap/);
    expect(execute).not.toHaveBeenCalled();
    expect(finalizeAttempt).toHaveBeenCalledWith('att-chair', 'tok-c', expect.objectContaining({ state: 'failed', costState: 'unknown', costCents: null }));
  });
});

describe('estimateReservationCost', () => {
  test('returns a positive low/high bound scaling with entryCount when pricing is known', async () => {
    const cfg = await snapshotConfiguration();
    const one = estimateReservationCost(cfg, 1);
    const three = estimateReservationCost(cfg, 3);
    expect(one.lowUsd).toBeGreaterThan(0);
    expect(one.highUsd).toBeGreaterThanOrEqual(one.lowUsd);
    expect(three.lowUsd).toBeCloseTo(one.lowUsd * 3, 6);
  });

  test('returns null bounds when pricing is unavailable', () => {
    const result = estimateReservationCost({ seats: {}, chair: null }, 1);
    expect(result.lowUsd).toBeNull();
    expect(result.highUsd).toBeNull();
  });
});
