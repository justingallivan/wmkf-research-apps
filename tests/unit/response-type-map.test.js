/**
 * @jest-environment node
 *
 * Reviewer "hold step" chunk 8 — the response-type read map must stay symmetric with
 * the write map (derived inverse), so `held` (and `withdrawn_sufficient`) always
 * round-trip and no consumer that maps numeric→string can silently drop a value.
 */
const { RESPONSE_TYPE_MAP, RESPONSE_TYPE_BY_VALUE } = require('../../lib/dataverse/adapters/reviewer-suggestion');

describe('RESPONSE_TYPE_BY_VALUE — derived inverse of RESPONSE_TYPE_MAP', () => {
  test('is the exact inverse (every write entry round-trips)', () => {
    for (const [code, value] of Object.entries(RESPONSE_TYPE_MAP)) {
      expect(RESPONSE_TYPE_BY_VALUE[value]).toBe(code);
    }
    expect(Object.keys(RESPONSE_TYPE_BY_VALUE)).toHaveLength(Object.keys(RESPONSE_TYPE_MAP).length);
  });

  test('covers held (100000004) and withdrawn_sufficient (100000003) — not just the original three', () => {
    expect(RESPONSE_TYPE_BY_VALUE[100000004]).toBe('held');
    expect(RESPONSE_TYPE_BY_VALUE[100000003]).toBe('withdrawn_sufficient');
  });
});
