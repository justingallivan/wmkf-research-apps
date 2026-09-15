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
    'writeupThemes', 'writeupQuotations',
  ]);
  expect(PROMPT_OUTPUT_SCHEMA.jsonSchema.properties.synthesis.additionalProperties).toBe(false);
  const ratingItem = PROMPT_OUTPUT_SCHEMA.jsonSchema
    .properties.synthesis.properties.ratingSummaries.items;
  expect(ratingItem.additionalProperties).toBe(false);
  expect(ratingItem.required).toEqual(['questionKey', 'questionText', 'summary']);
});

test('Slice 2: writeupThemes/writeupQuotations are present in jsonSchema and required, with NO caps there', () => {
  const props = PROMPT_OUTPUT_SCHEMA.jsonSchema.properties.synthesis.properties;
  expect(props.writeupThemes).toEqual({ type: 'string' });
  const quotationsItem = props.writeupQuotations.items;
  expect(quotationsItem.additionalProperties).toBe(false);
  expect(quotationsItem.required).toEqual(['questionKey', 'quote']);
  // The jsonSchema forwarded to the provider carries no bounding keywords —
  // all caps live in validationSchema only (plan §4.3).
  expect(props.writeupThemes).not.toHaveProperty('maxLength');
  expect(props.writeupQuotations).not.toHaveProperty('maxItems');
  expect(quotationsItem.properties.quote).not.toHaveProperty('maxLength');
  expect(quotationsItem.properties.questionKey).not.toHaveProperty('maxLength');
});

test('Slice 2: validationSchema caps writeupThemes/writeupQuotations and both default when absent', () => {
  const synthesisFields = PROMPT_OUTPUT_SCHEMA.validationSchema.fields.synthesis.fields;
  expect(synthesisFields.writeupThemes).toMatchObject({ type: 'string', maxLength: 2000, required: false, default: '' });
  expect(synthesisFields.writeupQuotations).toMatchObject({ type: 'array', maxItems: 10, required: false, default: [] });
  expect(synthesisFields.writeupQuotations.of.fields.questionKey).toMatchObject({ type: 'string', maxLength: 100 });
  expect(synthesisFields.writeupQuotations.of.fields.quote).toMatchObject({ type: 'string', maxLength: 600 });

  const result = validateAiJson({ synthesis: {} }, PROMPT_OUTPUT_SCHEMA.validationSchema);
  expect(result.ok).toBe(true);
  expect(result.value.synthesis.writeupThemes).toBe('');
  expect(result.value.synthesis.writeupQuotations).toEqual([]);
});

test('Slice 2: validationSchema enforces the caps as a hard failure, not a truncation', () => {
  const overLong = validateAiJson(
    { synthesis: { writeupThemes: 'x'.repeat(2001) } },
    PROMPT_OUTPUT_SCHEMA.validationSchema,
  );
  expect(overLong.ok).toBe(false);

  const tooMany = validateAiJson(
    {
      synthesis: {
        writeupQuotations: Array.from({ length: 11 }, (_, i) => ({ questionKey: 'q', quote: `quote ${i}` })),
      },
    },
    PROMPT_OUTPUT_SCHEMA.validationSchema,
  );
  expect(tooMany.ok).toBe(false);
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
    writeupThemes: '', writeupQuotations: [],
  });
});
