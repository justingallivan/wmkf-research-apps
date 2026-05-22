/**
 * Tests for the LLM-output schema validator (A7, Slice 0).
 */

import { validateAiJson } from '../../../lib/utils/ai-output-schema.js';

describe('validateAiJson — scalars', () => {
  test('accepts a well-typed string with maxLength', () => {
    const r = validateAiJson('ok', { type: 'string', maxLength: 5 });
    expect(r).toEqual({ ok: true, value: 'ok' });
  });

  test('rejects a string over maxLength', () => {
    const r = validateAiJson('toolong', { type: 'string', maxLength: 3 });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/max 3 characters/);
  });

  test('rejects a non-string for a string node', () => {
    const r = validateAiJson(42, { type: 'string' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/must be a string/);
  });

  test('enforces string enum', () => {
    const node = { type: 'string', enum: ['achieved', 'partial'] };
    expect(validateAiJson('achieved', node).ok).toBe(true);
    const bad = validateAiJson('hacked', node);
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toMatch(/must be one of/);
  });

  test('integer node rejects floats and coerces numeric strings', () => {
    expect(validateAiJson(3, { type: 'integer' })).toEqual({ ok: true, value: 3 });
    expect(validateAiJson('7', { type: 'integer' })).toEqual({ ok: true, value: 7 });
    expect(validateAiJson(3.5, { type: 'integer' }).ok).toBe(false);
  });

  test('number node enforces min/max', () => {
    const node = { type: 'number', min: 0, max: 10 };
    expect(validateAiJson(5, node).ok).toBe(true);
    expect(validateAiJson(-1, node).ok).toBe(false);
    expect(validateAiJson(11, node).ok).toBe(false);
  });
});

describe('validateAiJson — null / required / default', () => {
  test('nullable allows null', () => {
    expect(validateAiJson(null, { type: 'integer', nullable: true })).toEqual({
      ok: true,
      value: null,
    });
  });

  test('non-nullable rejects null', () => {
    expect(validateAiJson(null, { type: 'integer' }).ok).toBe(false);
  });

  test('required field absent is an error', () => {
    const r = validateAiJson(undefined, { type: 'string' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/required/);
  });

  test('optional absent field is omitted', () => {
    const schema = {
      type: 'object',
      fields: { a: { type: 'string', required: false } },
    };
    expect(validateAiJson({}, schema)).toEqual({ ok: true, value: {} });
  });

  test('default is applied when an optional field is absent', () => {
    const schema = {
      type: 'object',
      fields: { a: { type: 'string', required: false, default: 'x' } },
    };
    expect(validateAiJson({}, schema)).toEqual({ ok: true, value: { a: 'x' } });
  });
});

describe('validateAiJson — objects drop undeclared keys (anti-injection)', () => {
  const schema = {
    type: 'object',
    fields: {
      title: { type: 'string', maxLength: 100 },
      count: { type: 'integer', nullable: true },
    },
  };

  test('an injected extra key is dropped, not carried through', () => {
    const r = validateAiJson(
      { title: 'Real', count: 3, __injected: 'rm -rf', exfiltrate: true },
      schema,
    );
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ title: 'Real', count: 3 });
    expect(r.value).not.toHaveProperty('__injected');
  });

  test('allowExtra:"error" flags undeclared keys instead of dropping silently', () => {
    const strict = { ...schema, allowExtra: 'error' };
    const r = validateAiJson({ title: 'Real', count: 1, evil: 1 }, strict);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/unexpected key "evil"/);
  });

  test('rejects a non-object where an object is expected', () => {
    expect(validateAiJson('not-an-object', schema).ok).toBe(false);
  });
});

describe('validateAiJson — arrays and nesting', () => {
  const goalsSchema = {
    type: 'object',
    fields: {
      goals: {
        type: 'array',
        maxItems: 3,
        of: {
          type: 'object',
          fields: {
            goal_number: { type: 'string', maxLength: 20 },
            status: { type: 'string', enum: ['achieved', 'partial', 'not_addressed'] },
          },
        },
      },
    },
  };

  test('validates nested array-of-objects and drops nested extras', () => {
    const r = validateAiJson(
      {
        goals: [
          { goal_number: 'Aim 1', status: 'achieved', sneaky: 'x' },
          { goal_number: 'Aim 2', status: 'partial' },
        ],
      },
      goalsSchema,
    );
    expect(r.ok).toBe(true);
    expect(r.value.goals).toHaveLength(2);
    expect(r.value.goals[0]).toEqual({ goal_number: 'Aim 1', status: 'achieved' });
  });

  test('rejects an over-long array', () => {
    const r = validateAiJson(
      { goals: [1, 2, 3, 4].map(() => ({ goal_number: 'G', status: 'achieved' })) },
      goalsSchema,
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/max 3 items/);
  });

  test('rejects a bad enum value deep in a nested array', () => {
    const r = validateAiJson(
      { goals: [{ goal_number: 'Aim 1', status: 'IGNORE PREVIOUS INSTRUCTIONS' }] },
      goalsSchema,
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/goals\[0\]\.status/);
  });
});
