/**
 * model-pricing.test.js
 *
 * The S181 refactor moved the table into its own module and switched
 * matching from `.includes()` (silently wrong for Opus 4.5+) to longest-
 * prefix-first. These tests pin both the bug fixes and the matcher
 * semantics so a future drift can't quietly re-introduce them.
 */

const {
  MODEL_PRICING,
  CACHE_MULTIPLIERS,
  LAST_REVIEWED_AT,
  lookupPricing,
  estimateCostCents,
  _resetUnknownWarnings,
} = require('../../lib/utils/model-pricing.js');

beforeEach(() => {
  _resetUnknownWarnings();
});

describe('pricing table — S181 bug fixes pinned', () => {
  test('Haiku 4.5 is $1/$5 (was $0.80/$4 in the pre-S181 bug)', () => {
    expect(MODEL_PRICING['claude-haiku-4-5']).toEqual({ input: 100, output: 500 });
  });

  test('Haiku 3.5 stays at $0.80/$4', () => {
    expect(MODEL_PRICING['claude-haiku-3-5']).toEqual({ input: 80, output: 400 });
  });

  test('Opus 4.5/4.6/4.7 are at the new $5/$25 tier', () => {
    for (const m of ['claude-opus-4-5', 'claude-opus-4-6', 'claude-opus-4-7']) {
      expect(MODEL_PRICING[m]).toEqual({ input: 500, output: 2500 });
    }
  });

  test('Opus 4 / 4.1 stay at the legacy $15/$75 tier', () => {
    expect(MODEL_PRICING['claude-opus-4']).toEqual({ input: 1500, output: 7500 });
    expect(MODEL_PRICING['claude-opus-4-1']).toEqual({ input: 1500, output: 7500 });
  });
});

describe('cache multipliers', () => {
  test('match Anthropic published values', () => {
    expect(CACHE_MULTIPLIERS.read).toBeCloseTo(0.1, 6);
    expect(CACHE_MULTIPLIERS.write5m).toBeCloseTo(1.25, 6);
    expect(CACHE_MULTIPLIERS.write1h).toBeCloseTo(2.0, 6);
  });
});

describe('lookupPricing — matcher semantics', () => {
  test('exact match wins', () => {
    expect(lookupPricing('claude-opus-4-6')).toEqual({ input: 500, output: 2500 });
  });

  test('longest-prefix-first beats the .includes() bug — dated Opus 4.7 goes to the 4.7 tier, not Opus 4', () => {
    // Pre-S181 this would have matched `claude-opus-4` ($15/$75); the new
    // matcher must hit `claude-opus-4-7` ($5/$25).
    expect(lookupPricing('claude-opus-4-7-20260601')).toEqual({ input: 500, output: 2500 });
  });

  test('dated Opus 4.6 → 4.6 tier (the bug we found)', () => {
    expect(lookupPricing('claude-opus-4-6-20260201')).toEqual({ input: 500, output: 2500 });
  });

  test('dated Opus 4 (deprecated) stays on legacy tier', () => {
    expect(lookupPricing('claude-opus-4-20240620')).toEqual({ input: 1500, output: 7500 });
  });

  test('dated Sonnet 4.x maps correctly regardless of dated suffix', () => {
    expect(lookupPricing('claude-sonnet-4-6-20260201')).toEqual({ input: 300, output: 1500 });
    expect(lookupPricing('claude-sonnet-4-5-20250929')).toEqual({ input: 300, output: 1500 });
    expect(lookupPricing('claude-sonnet-4-20250514')).toEqual({ input: 300, output: 1500 });
  });

  test('dated Haiku 4.5 maps to fixed price', () => {
    expect(lookupPricing('claude-haiku-4-5-20251001')).toEqual({ input: 100, output: 500 });
  });

  test('unknown model returns null', () => {
    expect(lookupPricing('claude-future-99-99')).toBeNull();
    expect(lookupPricing('some-other-vendor-model')).toBeNull();
  });

  test('falsy and non-string inputs return null without throwing', () => {
    expect(lookupPricing(null)).toBeNull();
    expect(lookupPricing(undefined)).toBeNull();
    expect(lookupPricing('')).toBeNull();
    expect(lookupPricing(42)).toBeNull();
    expect(lookupPricing({})).toBeNull();
  });
});

describe('estimateCostCents — arithmetic', () => {
  test('plain input + output, no cache', () => {
    // Sonnet 4.6: $3/Mtok input, $15/Mtok output (cents: 300/1500)
    // 1M input + 1M output = $3 + $15 = $18 = 1800 cents
    expect(estimateCostCents('claude-sonnet-4-6', 1_000_000, 1_000_000)).toBeCloseTo(1800, 6);
  });

  test('cache read at 10% of input', () => {
    // Haiku 4.5: $1/Mtok input (100 cents)
    // 1M cache_read = 0.1 × $1 = $0.10 = 10 cents
    expect(estimateCostCents('claude-haiku-4-5', 0, 0, 0, 1_000_000, 0)).toBeCloseTo(10, 6);
  });

  test('5-minute cache write at 1.25× input', () => {
    // Opus 4.6: $5/Mtok input (500 cents)
    // 1M 5m-write = 1.25 × $5 = $6.25 = 625 cents
    expect(estimateCostCents('claude-opus-4-6', 0, 0, 1_000_000, 0, 0)).toBeCloseTo(625, 6);
  });

  test('1-hour cache write at 2× input (S181 new)', () => {
    // Sonnet 4.6: $3/Mtok input (300 cents)
    // 1M 1h-write = 2 × $3 = $6 = 600 cents
    expect(estimateCostCents('claude-sonnet-4-6', 0, 0, 0, 0, 1_000_000)).toBeCloseTo(600, 6);
  });

  test('combined: input + output + 5m cache + 1h cache + cache read', () => {
    // Sonnet 4.6: 300/1500 input/output
    // 100k input  =  30 cents
    // 50k output  =  75 cents
    // 100k 5m write = 100k × 300 × 1.25 / 1M = 37.5 cents
    // 50k 1h write  = 50k × 300 × 2 / 1M    = 30 cents
    // 200k read    = 200k × 300 × 0.1 / 1M  =  6 cents
    // = 178.5
    expect(
      estimateCostCents('claude-sonnet-4-6', 100_000, 50_000, 100_000, 200_000, 50_000),
    ).toBeCloseTo(178.5, 4);
  });

  test('unknown model returns null + warns once per process', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(estimateCostCents('mystery-model-xyz', 1000, 1000)).toBeNull();
    expect(estimateCostCents('mystery-model-xyz', 5000, 5000)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/mystery-model-xyz/);
    warn.mockRestore();
  });

  test('different unknown models each warn once', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    estimateCostCents('first-unknown', 1, 1);
    estimateCostCents('second-unknown', 1, 1);
    estimateCostCents('first-unknown', 1, 1);  // dedup
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test('missing token counts default to zero', () => {
    expect(estimateCostCents('claude-haiku-4-5')).toBeCloseTo(0, 6);
    expect(estimateCostCents('claude-haiku-4-5', undefined, null)).toBeCloseTo(0, 6);
  });
});

describe('LAST_REVIEWED_AT', () => {
  test('is a valid ISO date string', () => {
    expect(LAST_REVIEWED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date(LAST_REVIEWED_AT + 'T00:00:00Z');
    expect(d.toString()).not.toBe('Invalid Date');
  });
});
