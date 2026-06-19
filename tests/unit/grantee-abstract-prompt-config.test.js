/**
 * Pins the grantee-abstract prompt config (the seed's single source of truth).
 *
 * SECURITY: source_abstract is the applicant-authored abstract. It MUST stay
 * declared untrusted (with dataClass + integer maxChars) so the Executor wraps
 * it + injects the A7 preamble. The prompt-injection gate scans marker strings
 * in execute-prompt.js but does NOT assert this declaration (Codex chunk-2
 * post-impl #5), so this test is the fail-closed guard against silently dropping
 * the untrusted boundary. The seed script imports these same constants, so the
 * live wmkf_ai_prompts row cannot drift from what this test pins.
 *
 * @jest-environment node
 */
import { PROMPT_VARIABLES, PROMPT_OUTPUT_SCHEMA } from '../../shared/config/prompts/grantee-abstract';

test('source_abstract stays untrusted with a dataClass + integer maxChars (A7 boundary)', () => {
  const v = PROMPT_VARIABLES.variables.find((x) => x.name === 'source_abstract');
  expect(v).toBeDefined();
  expect(v.untrusted).toBe(true);
  expect(typeof v.dataClass).toBe('string');
  expect(v.dataClass.length).toBeGreaterThan(0);
  expect(Number.isInteger(v.maxChars)).toBe(true);
  expect(v.maxChars).toBeGreaterThan(0);
  expect(v.source).toEqual({ kind: 'override' });
});

test('output schema is raw with exactly one pass-through output (no jsonSchema)', () => {
  expect(PROMPT_OUTPUT_SCHEMA.parseMode).toBe('raw');
  expect(PROMPT_OUTPUT_SCHEMA.outputs).toHaveLength(1);
  expect(PROMPT_OUTPUT_SCHEMA.outputs[0]).toMatchObject({
    name: 'abstract_formatted',
    target: { kind: 'none' },
  });
  // Raw mode ignores jsonSchema; declaring one would be a seed mistake.
  expect(PROMPT_OUTPUT_SCHEMA.jsonSchema).toBeUndefined();
});
