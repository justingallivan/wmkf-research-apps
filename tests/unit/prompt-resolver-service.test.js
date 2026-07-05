/**
 * Characterization tests for lib/services/prompt-resolver.js's PromptResolver
 * (Session 103 holdover), pinning CURRENT behavior ahead of converting its
 * raw `DynamicsService.getRecord('wmkf_ai_runs', ...)` scratch-row read to
 * the ai-run adapter's `getByIdWithSelect` passthrough (data-access-layer
 * migration, ownership-skip leftover conversion).
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn() },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

const { DynamicsService } = require('../../lib/services/dynamics-service');
const { PromptResolver } = require('../../lib/services/prompt-resolver');

const APP_KEY = 'phase-i-dynamics-v2';
const SCRATCH_GUID = 'a03f77d9-913a-f111-88b5-000d3a3065b8';

beforeEach(() => {
  jest.clearAllMocks();
  PromptResolver.invalidate();
  delete process.env.PROMPT_RESOLVER_STRICT;
});

describe('PromptResolver.getPrompt — golden path', () => {
  test('fetches the wmkf_ai_runs scratch row with the exact entity/guid/select shape', async () => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_ai_notes: 'You are a helpful system.',
      wmkf_ai_rawoutput: 'Summarize {{title}}.',
    });

    const result = await PromptResolver.getPrompt(APP_KEY);

    expect(DynamicsService.getRecord).toHaveBeenCalledWith(
      'wmkf_ai_runs', SCRATCH_GUID,
      { select: 'wmkf_ai_notes,wmkf_ai_rawoutput' },
    );
    expect(result).toMatchObject({
      systemPrompt: 'You are a helpful system.',
      userPromptTemplate: 'Summarize {{title}}.',
      source: 'dynamics',
      recordGuid: SCRATCH_GUID,
    });
  });

  test('unknown appKey throws before any Dynamics call', async () => {
    await expect(PromptResolver.getPrompt('no-such-app')).rejects.toThrow(/no routing configured/);
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  });
});

describe('PromptResolver.getPrompt — failure path (fallback)', () => {
  test('Dynamics fetch failure falls back to the bundled module, source: fallback', async () => {
    DynamicsService.getRecord.mockRejectedValue(new Error('dynamics down'));
    const result = await PromptResolver.getPrompt(APP_KEY);
    expect(result.source).toBe('fallback');
    expect(result.recordGuid).toBeNull();
    expect(result.systemPrompt.length).toBeGreaterThan(0);
    expect(result.userPromptTemplate.length).toBeGreaterThan(0);
  });

  test('PROMPT_RESOLVER_STRICT=true rethrows instead of falling back', async () => {
    process.env.PROMPT_RESOLVER_STRICT = 'true';
    DynamicsService.getRecord.mockRejectedValue(new Error('dynamics down'));
    await expect(PromptResolver.getPrompt(APP_KEY)).rejects.toThrow('dynamics down');
  });
});
