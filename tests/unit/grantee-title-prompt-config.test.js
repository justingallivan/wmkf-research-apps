/**
 * Pins the grantee-title prompt config (the seed's single source of truth).
 *
 * SECURITY: BOTH source_title and source_abstract are applicant-authored. They
 * MUST stay declared untrusted (with dataClass + integer maxChars) so the
 * Executor wraps them + injects the A7 preamble. The prompt-injection gate scans
 * marker strings in execute-prompt.js but does NOT assert this declaration, so
 * this test is the fail-closed guard against silently dropping the untrusted
 * boundary on either variable. The seed script imports these same constants, so
 * the live wmkf_ai_prompts row cannot drift from what this test pins.
 *
 * @jest-environment node
 */
import { PROMPT_VARIABLES, PROMPT_OUTPUT_SCHEMA } from '../../shared/config/prompts/grantee-title';

test.each(['source_title', 'source_abstract'])(
  '%s stays untrusted with a dataClass + integer maxChars (A7 boundary)',
  (name) => {
    const v = PROMPT_VARIABLES.variables.find((x) => x.name === name);
    expect(v).toBeDefined();
    expect(v.untrusted).toBe(true);
    expect(typeof v.dataClass).toBe('string');
    expect(v.dataClass.length).toBeGreaterThan(0);
    expect(Number.isInteger(v.maxChars)).toBe(true);
    expect(v.maxChars).toBeGreaterThan(0);
    expect(v.source).toEqual({ kind: 'override' });
  }
);

test('declares exactly the two applicant-authored override variables', () => {
  expect(PROMPT_VARIABLES.variables.map((v) => v.name).sort()).toEqual(['source_abstract', 'source_title']);
});

test('output schema is raw with exactly one pass-through output (no jsonSchema)', () => {
  expect(PROMPT_OUTPUT_SCHEMA.parseMode).toBe('raw');
  expect(PROMPT_OUTPUT_SCHEMA.outputs).toHaveLength(1);
  expect(PROMPT_OUTPUT_SCHEMA.outputs[0]).toMatchObject({
    name: 'edited_title',
    target: { kind: 'none' },
  });
  // Raw mode ignores jsonSchema; declaring one would be a seed mistake.
  expect(PROMPT_OUTPUT_SCHEMA.jsonSchema).toBeUndefined();
});
