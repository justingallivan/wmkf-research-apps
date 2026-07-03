/**
 * @jest-environment node
 *
 * Regression: `wmkf_programarea` is capped at 100 chars in Dataverse. The old
 * write-boundary guard truncated overlong LLM prose, which avoided a 400 but
 * made bad inferred text durable. Normalization now preserves short request
 * labels and drops overlong/placeholder values instead.
 */

const {
  normalizeSuggestionProgramArea,
  PROGRAM_AREA_MAX_LENGTH,
} = require('../../lib/dataverse/adapters/reviewer-suggestion');

describe('normalizeSuggestionProgramArea', () => {
  test('drops a >100-char value instead of truncating it', () => {
    const long = 'A'.repeat(180);
    expect(PROGRAM_AREA_MAX_LENGTH).toBe(100);
    expect(normalizeSuggestionProgramArea(long)).toBeNull();
  });

  test('maps the legacy prompt labels to canonical Dataverse labels', () => {
    expect(normalizeSuggestionProgramArea('Science and Engineering Research Program'))
      .toBe('Science and Engineering Research');
    expect(normalizeSuggestionProgramArea('  Medical Research Program  ')).toBe('Medical Research');
  });

  test('preserves short Dataverse-derived labels', () => {
    expect(normalizeSuggestionProgramArea('Science')).toBe('Science');
    expect(normalizeSuggestionProgramArea('Medical Research')).toBe('Medical Research');
    expect(normalizeSuggestionProgramArea('Bridge Funding')).toBe('Bridge Funding');
  });

  test('drops placeholders and empty values', () => {
    expect(normalizeSuggestionProgramArea('Not specified')).toBeNull();
    expect(normalizeSuggestionProgramArea(' unknown ')).toBeNull();
    expect(normalizeSuggestionProgramArea('   ')).toBeNull();
  });

  test('passes nullish values through for pruneEmpty and clear semantics', () => {
    expect(normalizeSuggestionProgramArea(null)).toBeNull();
    expect(normalizeSuggestionProgramArea(undefined)).toBeUndefined();
  });

  test('the 1002916-style overlong value is not made durable', () => {
    const gnome = 'Geosciences: Greenland Oldest ice exploration and modeling - cryosphere, '
      + 'paleoclimate, ice-sheet dynamics and subglacial processes program area';
    expect(gnome.length).toBeGreaterThan(100);
    expect(normalizeSuggestionProgramArea(gnome)).toBeNull();
  });
});
