/**
 * Pins the review-synthesis prompt config (the seed's single source of truth).
 *
 * SECURITY: `reviews_digest` is reviewer-authored free text (composed
 * server-side from submitted review answers). It MUST stay declared
 * untrusted (with dataClass + integer maxChars) so the Executor wraps it +
 * injects the A7 preamble. The prompt-injection gate scans marker strings in
 * execute-prompt.js but does NOT assert this declaration, so this test is the
 * fail-closed guard against silently dropping the untrusted boundary. The
 * seed script imports these same constants, so the live wmkf_ai_prompts row
 * cannot drift from what this test pins.
 *
 * @jest-environment node
 */
import { PROMPT_VARIABLES, PROMPT_OUTPUT_SCHEMA } from '../../shared/config/prompts/review-synthesis';
import { validateAiJson } from '../../lib/utils/ai-output-schema';

test('reviews_digest stays untrusted with a dataClass + integer maxChars (A7 boundary)', () => {
  const v = PROMPT_VARIABLES.variables.find((x) => x.name === 'reviews_digest');
  expect(v).toBeDefined();
  expect(v.untrusted).toBe(true);
  expect(typeof v.dataClass).toBe('string');
  expect(v.dataClass.length).toBeGreaterThan(0);
  expect(Number.isInteger(v.maxChars)).toBe(true);
  expect(v.maxChars).toBeGreaterThan(0);
  expect(v.source).toEqual({ kind: 'override' });
});

test('declares exactly the one override variable', () => {
  expect(PROMPT_VARIABLES.variables.map((v) => v.name)).toEqual(['reviews_digest']);
});

test('output schema targets akoya_request.wmkf_reviewsynthesisjson with guard always-overwrite', () => {
  expect(PROMPT_OUTPUT_SCHEMA.parseMode).toBe('json');
  expect(PROMPT_OUTPUT_SCHEMA.generationMode).toBe('native-json-schema');
  expect(PROMPT_OUTPUT_SCHEMA.outputs).toHaveLength(1);
  expect(PROMPT_OUTPUT_SCHEMA.outputs[0]).toMatchObject({
    name: 'synthesis',
    target: { kind: 'akoya_request', field: 'wmkf_reviewsynthesisjson' },
    guard: 'always-overwrite',
  });
  expect(PROMPT_OUTPUT_SCHEMA.jsonSchema.required).toEqual(['synthesis']);
  expect(PROMPT_OUTPUT_SCHEMA.jsonSchema.additionalProperties).toBe(false);
  expect(PROMPT_OUTPUT_SCHEMA.jsonSchema.properties.synthesis.required).toEqual([
    'consensus', 'disagreements', 'keyConcerns', 'ratingSummaries', 'overall',
  ]);
  expect(PROMPT_OUTPUT_SCHEMA.jsonSchema.properties.synthesis.additionalProperties).toBe(false);
  const ratingItem = PROMPT_OUTPUT_SCHEMA.jsonSchema
    .properties.synthesis.properties.ratingSummaries.items;
  expect(ratingItem.additionalProperties).toBe(false);
  expect(ratingItem.required).toEqual(['questionKey', 'questionText', 'summary']);
});

test('validationSchema accepts a well-formed model response and drops injected extra keys', () => {
  const parsed = {
    synthesis: {
      consensus: ['point a'],
      disagreements: ['point b'],
      keyConcerns: ['point c'],
      ratingSummaries: [{ questionKey: 'impact', questionText: 'Rate impact', summary: 's' }],
      overall: 'overall text',
    },
    injectedField: 'should be dropped',
  };
  const result = validateAiJson(parsed, PROMPT_OUTPUT_SCHEMA.validationSchema);
  expect(result.ok).toBe(true);
  expect(result.value).not.toHaveProperty('injectedField');
  expect(result.value.synthesis.consensus).toEqual(['point a']);
});

test('validationSchema defaults missing optional arrays/overall rather than failing', () => {
  const result = validateAiJson({ synthesis: {} }, PROMPT_OUTPUT_SCHEMA.validationSchema);
  expect(result.ok).toBe(true);
  expect(result.value.synthesis).toEqual({
    consensus: [], disagreements: [], keyConcerns: [], ratingSummaries: [], overall: '',
  });
});
