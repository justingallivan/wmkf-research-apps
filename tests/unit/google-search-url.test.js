/**
 * @jest-environment node
 */

const { buildGoogleSearchUrl } = require('../../lib/utils/google-search-url');

describe('buildGoogleSearchUrl', () => {
  test('quotes name and institution, both encoded', () => {
    const url = buildGoogleSearchUrl('Jane Shih', 'Dana-Farber Cancer Institute');
    expect(url).toBe(
      'https://www.google.com/search?q=%22Jane+Shih%22+%22Dana-Farber+Cancer+Institute%22',
    );
  });

  test('omits institution cleanly when absent', () => {
    expect(buildGoogleSearchUrl('Jane Shih', null)).toBe(
      'https://www.google.com/search?q=%22Jane+Shih%22',
    );
    expect(buildGoogleSearchUrl('Jane Shih', '')).toBe(
      'https://www.google.com/search?q=%22Jane+Shih%22',
    );
    expect(buildGoogleSearchUrl('Jane Shih', '   ')).toBe(
      'https://www.google.com/search?q=%22Jane+Shih%22',
    );
    expect(buildGoogleSearchUrl('Jane Shih')).toBe(
      'https://www.google.com/search?q=%22Jane+Shih%22',
    );
  });

  test('encodes quotes, ampersands, and diacritics in the name/institution', () => {
    const url = buildGoogleSearchUrl(`Renée O'Brien`, 'Smith & Sons Institute');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('q')).toBe(`"Renée O'Brien" "Smith & Sons Institute"`);
  });

  test('returns null for an empty/missing name', () => {
    expect(buildGoogleSearchUrl('', 'Some Institute')).toBeNull();
    expect(buildGoogleSearchUrl(null, 'Some Institute')).toBeNull();
    expect(buildGoogleSearchUrl(undefined, undefined)).toBeNull();
    expect(buildGoogleSearchUrl('   ', 'Some Institute')).toBeNull();
  });

  test('trims surrounding whitespace on both fields', () => {
    const url = buildGoogleSearchUrl('  Jane Shih  ', '  Dana-Farber Cancer Institute  ');
    expect(url).toBe(
      'https://www.google.com/search?q=%22Jane+Shih%22+%22Dana-Farber+Cancer+Institute%22',
    );
  });
});
