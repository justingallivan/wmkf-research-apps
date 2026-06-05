/**
 * Unit tests for the prompt-store leaf (S222 extraction from execute-prompt.js).
 * Guards: the helper move preserved the exact fetch contract (fields, filter,
 * top:2, message text) and added stable typed error codes the resolver branches
 * on, without changing the Executor's behavior.
 */
jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: { queryRecords: jest.fn() },
}));

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  fetchCurrentPrompt,
  interpolate,
  PROMPT_STORE_ERROR_CODES,
} from '../../lib/services/prompt-store.js';

describe('interpolate', () => {
  it('substitutes {{var}} and tolerates inner whitespace', () => {
    expect(interpolate('a {{x}} {{ y }} b', { x: '1', y: '2' })).toBe('a 1 2 b');
  });
  it('coerces non-string values', () => {
    expect(interpolate('n={{n}}', { n: 12 })).toBe('n=12');
  });
  it('leaves unresolved slots visible', () => {
    expect(interpolate('keep {{missing}}', { other: 'x' })).toBe('keep {{missing}}');
  });
});

describe('fetchCurrentPrompt', () => {
  beforeEach(() => DynamicsService.queryRecords.mockReset());

  it('queries the exact field set + iscurrent filter with top:2', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'p1' }] });
    await fetchCurrentPrompt('reviewer-finder.analyze');
    const [entity, opts] = DynamicsService.queryRecords.mock.calls[0];
    expect(entity).toBe('wmkf_ai_prompts');
    expect(opts.top).toBe(2);
    expect(opts.filter).toBe("wmkf_ai_promptname eq 'reviewer-finder.analyze' and wmkf_ai_iscurrent eq true");
    for (const f of ['wmkf_ai_promptbody', 'wmkf_ai_promptvariables', 'wmkf_ai_promptoutputschema', 'wmkf_ai_model', 'wmkf_ai_maxtokens', 'wmkf_promptversion']) {
      expect(opts.select).toContain(f);
    }
  });

  it('escapes single quotes in the name', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'p1' }] });
    await fetchCurrentPrompt("o'brien.prompt");
    expect(DynamicsService.queryRecords.mock.calls[0][1].filter).toContain("o''brien.prompt");
  });

  it('returns the single current row', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [{ wmkf_ai_promptid: 'p1', wmkf_ai_promptbody: 'body' }] });
    await expect(fetchCurrentPrompt('x')).resolves.toEqual({ wmkf_ai_promptid: 'p1', wmkf_ai_promptbody: 'body' });
  });

  it('throws PROMPT_NOT_FOUND (typed) on 0 current rows, message preserved', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });
    await expect(fetchCurrentPrompt('x')).rejects.toMatchObject({
      code: PROMPT_STORE_ERROR_CODES.NOT_FOUND,
      message: 'No current prompt found for name "x"',
    });
  });

  it('throws PROMPT_DUPLICATE_CURRENT (typed) on >1 current rows, message preserved', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [{}, {}] });
    await expect(fetchCurrentPrompt('x')).rejects.toMatchObject({
      code: PROMPT_STORE_ERROR_CODES.DUPLICATE_CURRENT,
      message: 'Multiple current prompts for name "x" — resolve in Dynamics',
    });
  });

  it('lets an underlying Dynamics failure surface untyped (transient → caller falls back)', async () => {
    DynamicsService.queryRecords.mockRejectedValue(new Error('network'));
    const err = await fetchCurrentPrompt('x').catch((e) => e);
    expect(err.message).toBe('network');
    expect(err.code).toBeUndefined();
  });
});
