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

describe('validateAiJson — record (dynamic-keyed map)', () => {
  const ratingRecord = {
    type: 'record',
    maxEntries: 10,
    keys: { maxLength: 60 },
    of: { type: 'string', enum: ['Strong', 'Moderate', 'Weak'], coerceEnum: true, default: 'Moderate' },
  };

  test('accepts a dynamic-keyed map and validates each value', () => {
    const r = validateAiJson({ 'Aim 1': 'Strong', 'Aim 2': 'Weak' }, ratingRecord);
    expect(r).toEqual({ ok: true, value: { 'Aim 1': 'Strong', 'Aim 2': 'Weak' } });
  });

  test('coerces an out-of-enum value via the value node', () => {
    const r = validateAiJson({ 'Aim 1': 'bogus' }, ratingRecord);
    expect(r).toEqual({ ok: true, value: { 'Aim 1': 'Moderate' } });
  });

  test('rejects a non-object', () => {
    const r = validateAiJson('not an object', ratingRecord);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/must be an object/);
  });

  test('rejects prototype-pollution keys', () => {
    const r = validateAiJson(
      JSON.parse('{"__proto__":"Strong","constructor":"Weak","ok":"Strong"}'),
      ratingRecord,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /forbidden key/.test(e))).toBe(true);
  });

  test('the result has a clean prototype (no pollution rode through)', () => {
    // Even a rejected payload must not have mutated Object.prototype.
    validateAiJson(JSON.parse('{"__proto__":{"polluted":true}}'), ratingRecord);
    expect({}.polluted).toBeUndefined();
  });

  test('rejects an over-long key', () => {
    const r = validateAiJson({ ['x'.repeat(61)]: 'Strong' }, ratingRecord);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/key exceeds 60 characters/);
  });

  test('rejects too many entries', () => {
    const big = {};
    for (let i = 0; i < 11; i++) big[`k${i}`] = 'Strong';
    const r = validateAiJson(big, ratingRecord);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/max 10 entries/);
  });

  test('enforces a key pattern when declared', () => {
    const schema = {
      type: 'record',
      keys: { pattern: '^[A-Za-z ]+$' },
      of: { type: 'string' },
    };
    const r = validateAiJson({ 'Bad<key>': 'v' }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/allowed pattern/);
  });

  test('nested record-of-record validates two levels deep', () => {
    const schema = {
      type: 'record',
      of: { type: 'record', of: { type: 'string' } },
    };
    const r = validateAiJson({ impact: { Claude: 'Strong', GPT: 'Weak' } }, schema);
    expect(r).toEqual({ ok: true, value: { impact: { Claude: 'Strong', GPT: 'Weak' } } });
  });
});
